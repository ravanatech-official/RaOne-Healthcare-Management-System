import crypto from 'node:crypto';
import { GoogleGenAI, Type, type FunctionDeclaration } from '@google/genai';
import type {
  JarvisConverseInput,
  JarvisConverseResponse,
  SupportedLocale,
} from '../contracts/api.ts';
import { isClinicalBoundaryRequest } from './gemini.ts';
import { listPeopleForTenant, prepareActionProposal } from '../domain/clinic-writes.ts';
import { getWaitingRoomDisplay } from '../domain/clinic-ops.ts';
import { addMemAuditEvent } from '../domain/memory-store.ts';
import { listCatalogueProducts } from '../domain/pharmacy-catalogue.ts';
import { getStockAndLotSummary } from '../domain/pharmacy-inventory.ts';
import {
  getCombinedZReport,
  getPharmacyAlertsDashboard,
} from '../domain/pharmacy-ops.ts';
import { assertWithinQuota, incrementQuotaUsage } from '../domain/subscription-billing.ts';
import {
  assertCapability,
  getBusinessDateInTimezone,
  type ActiveWorkspaceContext,
} from '../domain/tenancy.ts';
import { getTodayWorkspaceSummary } from '../domain/today.ts';
import { db, isDatabaseConfigured } from '../db/index.ts';
import { auditEvents } from '../db/schema.ts';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function formatLkr(minor: number): string {
  return `LKR ${(minor / 100).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function detectLanguage(text: string, fallback: SupportedLocale): 'si-LK' | 'en-LK' | 'mixed' {
  const hasSinhala = /[\u0D80-\u0DFF]/.test(text);
  const hasLatin = /[a-zA-Z]/.test(text);
  if (hasSinhala && hasLatin) return 'mixed';
  if (hasSinhala) return 'si-LK';
  if (hasLatin) return 'en-LK';
  return fallback;
}

const JARVIS_TOOLS: FunctionDeclaration[] = [
  {
    name: 'get_today_summary',
    description:
      'Fetch live clinic appointments, waiting queue tokens, available services, doctors, and daily clinic collections.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'search_pharmacy_stock',
    description:
      'Read-only search of pharmacy medicine stock levels, batch expiry dates, and pack retail prices by drug or brand name.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        query: {
          type: Type.STRING,
          description: 'Medicine name, generic name, or SKU (e.g. Paracetamol, Amoxicillin)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_expiring_and_low_stock',
    description:
      'Get medicines expiring in 30/60/90 days, already expired batches, low-stock SKUs, and dead stock.',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'get_z_report_summary',
    description:
      'Get combined daily financial reconciliation summary (clinic collections, doctor payouts, pharmacy POS sales, profit, net operating cashflow).',
    parameters: {
      type: Type.OBJECT,
      properties: {},
    },
  },
  {
    name: 'prepare_appointment_draft',
    description:
      'Prepare a safe Draft->Confirm appointment booking card for a patient. Never commits directly.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        patientQuery: { type: Type.STRING },
        timeHHMM: { type: Type.STRING, description: '24h time like 15:00' },
        dateISO: { type: Type.STRING, description: 'YYYY-MM-DD' },
      },
      required: ['patientQuery'],
    },
  },
  {
    name: 'prepare_payment_draft',
    description:
      'Prepare a safe Draft->Confirm clinic payment collection card in LKR. Never commits directly.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        patientQuery: { type: Type.STRING },
        amountLkr: { type: Type.NUMBER },
        method: { type: Type.STRING, description: 'cash | card | bank' },
      },
      required: ['amountLkr'],
    },
  },
];

async function executeJarvisTool(
  context: ActiveWorkspaceContext,
  toolName: string,
  args: Record<string, unknown>,
  correlationId: string
): Promise<{
  summary: string;
  data: unknown;
  proposedAction?: JarvisConverseResponse['proposedAction'];
}> {
  if (toolName === 'get_today_summary') {
    if (!context.capabilities['appointments.manage']) {
      return { summary: 'Clinic appointments module disabled in current package.', data: { enabled: false } };
    }
    const [today, queue] = await Promise.all([
      getTodayWorkspaceSummary(context),
      getWaitingRoomDisplay(context),
    ]);
    return {
      summary: `Loaded ${today.counts.total} appointments & ${queue.nowServing.length} serving token(s)`,
      data: {
        businessDate: today.businessDate,
        counts: today.counts,
        recordedReceiptsLkr: (today.recordedReceiptsMinor ?? 0) / 100,
        nowServing: queue.nowServing,
        nextWaiting: queue.upNext.slice(0, 3),
        appointments: today.appointments.slice(0, 6),
      },
    };
  }

  if (toolName === 'search_pharmacy_stock') {
    if (!context.capabilities['pharmacy.inventory']) {
      return { summary: 'Pharmacy inventory module disabled.', data: { enabled: false } };
    }
    const q = String(args.query || '').trim();
    const [{ items }, stock] = await Promise.all([
      listCatalogueProducts(context, q || undefined),
      getStockAndLotSummary(context),
    ]);
    const matched = items.map((item) => {
      const lots = stock.balances.filter((b) => b.productId === item.id);
      const sellableTotal = lots.reduce((a, b) => a + b.sellableOnHand, 0);
      const quarantineTotal = lots.reduce((a, b) => a + b.quarantineQty, 0);
      return {
        skuCode: item.skuCode,
        displayName: item.displayName,
        baseUnit: item.baseUnit,
        sellableTotal,
        quarantineTotal,
        variants: item.variants.map((v) => ({
          variantName: v.variantName,
          priceLkr: v.defaultSalePriceMinor / 100,
        })),
        nearestExpiry: lots[0]?.expiryCutoffDate ?? null,
      };
    });
    return {
      summary: `Checked stock for "${q || 'all'}": ${matched.length} matching SKU(s)`,
      data: { query: q, matches: matched.slice(0, 5) },
    };
  }

  if (toolName === 'get_expiring_and_low_stock') {
    if (!context.capabilities['pharmacy.inventory']) {
      return { summary: 'Pharmacy inventory module disabled.', data: { enabled: false } };
    }
    const alerts = await getPharmacyAlertsDashboard(context);
    return {
      summary: `Found ${alerts.summary.expiring30Count + alerts.summary.expiredCount} urgent expiry lot(s) & ${alerts.summary.lowStockCount} low-stock SKU(s)`,
      data: alerts,
    };
  }

  if (toolName === 'get_z_report_summary') {
    const report = await getCombinedZReport(context);
    return {
      summary: `Combined daily revenue ${formatLkr(report.combined.totalRevenueMinor)}`,
      data: report,
    };
  }

  const resolveMatchedPerson = async (rawQuery: string) => {
    const qTrim = rawQuery.trim();
    const direct = await listPeopleForTenant(context, qTrim);
    if (direct[0]) return direct[0];
    const allPeople = await listPeopleForTenant(context, '');
    const qLower = qTrim.toLowerCase();
    return (
      allPeople.find((p) => {
        const nameLower = p.displayName.toLowerCase();
        const firstPart = nameLower.split(/\s+/)[0] || '';
        return qLower.includes(nameLower) || (firstPart.length >= 3 && qLower.includes(firstPart));
      }) ?? null
    );
  };

  if (toolName === 'prepare_appointment_draft') {
    if (!context.capabilities['appointments.manage']) {
      return { summary: 'Clinic appointments disabled', data: null };
    }
    const today = await getTodayWorkspaceSummary(context);
    const person = await resolveMatchedPerson(String(args.patientQuery || ''));
    const service = today.services[0];
    const resource = today.resources[0];
    if (!person || !service || !resource) {
      return {
        summary: 'Missing matching patient, service, or practitioner',
        data: { foundPatient: Boolean(person), serviceCount: today.services.length },
      };
    }
    const dateISO = String(args.dateISO || today.businessDate);
    const hhmm = String(args.timeHHMM || '16:00');
    const startsAt = new Date(`${dateISO}T${hhmm}:00+05:30`).toISOString();
    const payload = {
      personId: person.id,
      serviceId: service.id,
      resourceId: resource.id,
      startsAt,
      notes: 'Prepared via J.A.R.V.I.S. voice assistant',
    };
    const proposal = await prepareActionProposal(
      context,
      { actionType: 'create_appointment', payload, inputSource: 'voice' },
      correlationId
    );
    return {
      summary: `Prepared appointment draft for ${person.displayName}`,
      data: proposal,
      proposedAction: {
        actionType: 'create_appointment',
        proposalId: proposal.id,
        nonce: proposal.nonce,
        payload,
        summaryLabel: `${person.displayName} • ${service.name} (${resource.name}) • ${dateISO} ${hhmm}`,
      },
    };
  }

  if (toolName === 'prepare_payment_draft') {
    if (!context.capabilities['collections.record']) {
      return { summary: 'Clinic collections disabled', data: null };
    }
    const person = await resolveMatchedPerson(String(args.patientQuery || ''));
    const amountLkr = Number(args.amountLkr || 2500);
    const methodRaw = String(args.method || 'cash').toLowerCase();
    const method: 'cash' | 'card' | 'bank' =
      methodRaw === 'card' || methodRaw === 'bank' ? methodRaw : 'cash';

    if (!person || amountLkr <= 0) {
      return { summary: 'Could not resolve patient or LKR amount', data: null };
    }
    const payload = {
      personId: person.id,
      appointmentId: null,
      description: 'Clinic consultation fee (J.A.R.V.I.S. Voice)',
      amountMinor: Math.round(amountLkr * 100),
      method,
      referenceNumber: '',
    };
    const proposal = await prepareActionProposal(
      context,
      { actionType: 'record_payment', payload, inputSource: 'voice' },
      correlationId
    );
    return {
      summary: `Prepared LKR ${amountLkr} (${method}) draft for ${person.displayName}`,
      data: proposal,
      proposedAction: {
        actionType: 'record_payment',
        proposalId: proposal.id,
        nonce: proposal.nonce,
        payload,
        summaryLabel: `${person.displayName} • ${formatLkr(payload.amountMinor)} (${method.toUpperCase()})`,
      },
    };
  }

  return { summary: 'Unknown tool', data: null };
}

async function runDeterministicJarvisFallback(
  context: ActiveWorkspaceContext,
  input: JarvisConverseInput,
  correlationId: string
): Promise<Omit<JarvisConverseResponse, 'quota'>> {
  const lower = input.message.toLowerCase();
  const lang = detectLanguage(input.message, input.locale);
  const isSi = lang === 'si-LK' || (lang === 'mixed' && input.locale === 'si-LK');
  const toolCalls: Array<{ tool: string; summary: string }> = [];
  let proposedAction: JarvisConverseResponse['proposedAction'] = null;

  // 1. Pharmacy expiry / low stock alerts
  if (
    lower.includes('expire') ||
    lower.includes('expiry') ||
    lower.includes('expiring') ||
    lower.includes('කල් ඉකුත්') ||
    lower.includes('low stock') ||
    lower.includes('dead stock') ||
    lower.includes('අඩු තොග')
  ) {
    const res = await executeJarvisTool(context, 'get_expiring_and_low_stock', {}, correlationId);
    toolCalls.push({ tool: 'get_expiring_and_low_stock', summary: res.summary });
    const alerts = res.data as Awaited<ReturnType<typeof getPharmacyAlertsDashboard>>;
    const expNames = alerts.expiringLots
      .slice(0, 3)
      .map((l) => `${l.productName} (${l.batchNumber}: ${l.expiryCutoffDate}, ${l.sellableOnHand} ${l.baseUnit})`)
      .join('; ');
    const lowNames = alerts.lowStockSkus
      .slice(0, 3)
      .map((s) => `${s.productName} (${s.sellableOnHand} ${s.baseUnit})`)
      .join('; ');

    const reply = isSi
      ? `ඉදිරි දින 90 තුළ කල් ඉකුත් වන තොග ${alerts.expiringLots.length}ක් සහ අඩු තොග SKU ${alerts.lowStockSkus.length}ක් ඇත.${expNames ? ` කල් ඉකුත් වීම්: ${expNames}.` : ''}${lowNames ? ` අඩු තොග: ${lowNames}.` : ''}`
      : `There are ${alerts.expiringLots.length} lot(s) expiring within 90 days and ${alerts.lowStockSkus.length} low-stock SKU(s).${expNames ? ` Expiring: ${expNames}.` : ''}${lowNames ? ` Low stock: ${lowNames}.` : ''}`;

    return {
      sessionId: input.sessionId,
      replyText: reply,
      replySpeechText: reply,
      detectedLanguage: lang,
      intent: 'pharmacy_alerts_query',
      toolCallsExecuted: toolCalls,
      proposedAction: null,
      quickFollowUps: isSi
        ? ['Paracetamol තොග කීයක් තියෙනවද?', 'අද මුළු ආදායම කීයද?']
        : ['Check Paracetamol stock', 'What is today total Z-report revenue?'],
      modelVersion: 'jarvis-deterministic-lk-v1',
    };
  }

  // 2. Pharmacy stock quantity / price lookup
  if (
    lower.includes('paracetamol') ||
    lower.includes('panadol') ||
    lower.includes('amoxicillin') ||
    lower.includes('amoxil') ||
    lower.includes('stock') ||
    lower.includes('කීයක්') ||
    lower.includes('තියෙනවද') ||
    lower.includes('තොග') ||
    lower.includes('බෙහෙත්')
  ) {
    const queryTerm = lower.includes('amox')
      ? 'amoxicillin'
      : lower.includes('para') || lower.includes('panadol')
        ? 'paracetamol'
        : '';
    const res = await executeJarvisTool(
      context,
      'search_pharmacy_stock',
      { query: queryTerm },
      correlationId
    );
    toolCalls.push({ tool: 'search_pharmacy_stock', summary: res.summary });
    const payload = res.data as {
      matches?: Array<{
        displayName: string;
        sellableTotal: number;
        quarantineTotal: number;
        baseUnit: string;
        variants: Array<{ variantName: string; priceLkr: number }>;
      }>;
    };
    const matches = payload.matches ?? [];
    const summaryText = matches
      .slice(0, 3)
      .map(
        (m) =>
          `${m.displayName}: ${m.sellableTotal} ${m.baseUnit} (${m.variants[0] ? `LKR ${m.variants[0].priceLkr}/${m.variants[0].variantName}` : 'ready'})`
      )
      .join(' | ');

    const reply =
      matches.length > 0
        ? isSi
          ? `දැනට පවතින ෆාමසි තොග: ${summaryText}`
          : `Current sellable pharmacy stock: ${summaryText}`
        : isSi
          ? 'එම ඖෂධය සඳහා ගැලපෙන තොගයක් හමු නොවීය.'
          : 'No matching pharmacy stock item was found.';

    return {
      sessionId: input.sessionId,
      replyText: reply,
      replySpeechText: reply,
      detectedLanguage: lang,
      intent: 'pharmacy_stock_query',
      toolCallsExecuted: toolCalls,
      proposedAction: null,
      quickFollowUps: isSi
        ? ['මේ මාසේ expire වෙන ඒවා මොනවද?', 'අද Appointments කීයක් තියෙනවද?']
        : ['What medicines are expiring soon?', 'How many appointments today?'],
      modelVersion: 'jarvis-deterministic-lk-v1',
    };
  }

  // 3. Combined / Mode-Aware Z-Report & Net P&L
  if (
    lower.includes('revenue') ||
    lower.includes('income') ||
    lower.includes('collection') ||
    lower.includes('z-report') ||
    lower.includes('z report') ||
    lower.includes('profit') ||
    lower.includes('pnl') ||
    lower.includes('expense') ||
    lower.includes('ආදායම') ||
    lower.includes('ලාභය') ||
    lower.includes('වියදම') ||
    lower.includes('මුදල්') ||
    lower.includes('කීයද')
  ) {
    const res = await executeJarvisTool(context, 'get_z_report_summary', {}, correlationId);
    toolCalls.push({ tool: 'get_z_report_summary', summary: res.summary });
    const report = res.data as Awaited<ReturnType<typeof getCombinedZReport>>;

    const hasClinic = report.modeFlags?.hasClinic ?? Boolean(context.capabilities['appointments.manage']);
    const hasPharmacy =
      report.modeFlags?.hasPharmacy ??
      Boolean(context.capabilities['pharmacy.inventory'] || context.capabilities['pharmacy.pos']);

    let reply: string;
    if (hasPharmacy && !hasClinic) {
      reply = isSi
        ? `අද (${report.businessDate}) ෆාමසි මුළු ආදායම ${formatLkr(report.pharmacy.netSalesMinor)} කි. (දළ ලාභය: ${formatLkr(report.pharmacy.grossProfitMinor)}, දවසේ වියදම්: ${formatLkr(report.expenses.opexMinor)}, ශුද්ධ ලාභය: ${formatLkr(report.combined.netProfitMinor)}).`
        : `Today (${report.businessDate}) pharmacy revenue is ${formatLkr(report.pharmacy.netSalesMinor)} (Gross profit: ${formatLkr(report.pharmacy.grossProfitMinor)}, Daily OpEx: ${formatLkr(report.expenses.opexMinor)}, True Net Profit: ${formatLkr(report.combined.netProfitMinor)}).`;
    } else if (hasClinic && !hasPharmacy) {
      reply = isSi
        ? `අද (${report.businessDate}) සායන මුළු ආදායම ${formatLkr(report.clinic.netCollectionsMinor)} කි. (වෛද්‍ය කොමිස් කොටස: ${formatLkr(report.clinic.doctorPayoutsMinor)}, දවසේ වියදම්: ${formatLkr(report.expenses.opexMinor)}, සායන ශුද්ධ ලාභය: ${formatLkr(report.combined.netProfitMinor)}).`
        : `Today (${report.businessDate}) clinic revenue is ${formatLkr(report.clinic.netCollectionsMinor)} (Doctor payouts: ${formatLkr(report.clinic.doctorPayoutsMinor)}, Daily OpEx: ${formatLkr(report.expenses.opexMinor)}, Clinic Net Profit: ${formatLkr(report.combined.netProfitMinor)}).`;
    } else {
      reply = isSi
        ? `අද (${report.businessDate}) මුළු ඒකාබද්ධ ආදායම ${formatLkr(report.combined.totalRevenueMinor)} කි. (සායන ගෙවීම්: ${formatLkr(report.clinic.netCollectionsMinor)}, ෆාමසි POS: ${formatLkr(report.pharmacy.netSalesMinor)}, වියදම්/OpEx: ${formatLkr(report.expenses.opexMinor)}, ශුද්ධ ලාභය: ${formatLkr(report.combined.netProfitMinor)}).`
        : `Today (${report.businessDate}) combined revenue is ${formatLkr(report.combined.totalRevenueMinor)} (Clinic: ${formatLkr(report.clinic.netCollectionsMinor)}, Pharmacy POS: ${formatLkr(report.pharmacy.netSalesMinor)}, OpEx: ${formatLkr(report.expenses.opexMinor)}, Net Profit: ${formatLkr(report.combined.netProfitMinor)}).`;
    }

    return {
      sessionId: input.sessionId,
      replyText: reply,
      replySpeechText: reply,
      detectedLanguage: lang,
      intent: 'financial_z_report',
      toolCallsExecuted: toolCalls,
      proposedAction: null,
      quickFollowUps:
        hasPharmacy && !hasClinic
          ? isSi
            ? ['මේ මාසේ expire වෙන ඒවා මොනවද?', 'Paracetamol 500mg කීයක් තියෙනවද?']
            : ['Show expiring stock', 'How much Paracetamol 500mg is in stock?']
          : isSi
            ? ['අද Appointments සහ Token විස්තර දෙන්න', 'මේ මාසේ expire වෙන ඒවා මොනවද?']
            : ['Show today appointments and active token', 'Show expiring stock'],
      modelVersion: 'jarvis-deterministic-lk-v1',
    };
  }

  // 4. Draft Payment Collection Proposal
  if (
    (lower.includes('collect') ||
      lower.includes('payment') ||
      lower.includes('pay ') ||
      lower.includes('ගෙවීම') ||
      lower.includes('අය කරන්න')) &&
    /\d{3,6}/.test(lower)
  ) {
    const amtMatch = lower.match(/(\d{3,6})/);
    const amountLkr = amtMatch ? Number(amtMatch[1]) : 2500;
    const method = lower.includes('card') ? 'card' : lower.includes('bank') ? 'bank' : 'cash';
    const res = await executeJarvisTool(
      context,
      'prepare_payment_draft',
      { patientQuery: input.message, amountLkr, method },
      correlationId
    );
    toolCalls.push({ tool: 'prepare_payment_draft', summary: res.summary });
    proposedAction = res.proposedAction ?? null;

    const reply = proposedAction
      ? isSi
        ? `${proposedAction.summaryLabel} සඳහා ගෙවීම් කෙටුම්පත සූදානම් කර ඇත. කරුණාකර පහත Confirm බොත්තම ඔබා තහවුරු කරන්න.`
        : `Payment draft prepared: ${proposedAction.summaryLabel}. Please tap Confirm below to record the receipt.`
      : isSi
        ? 'ගෙවීම සකස් කිරීමට රෝගියාගේ නම සහ මුදල පැහැදිලිව සඳහන් කරන්න.'
        : 'Please specify the patient name and LKR amount to prepare the payment draft.';

    return {
      sessionId: input.sessionId,
      replyText: reply,
      replySpeechText: reply,
      detectedLanguage: lang,
      intent: 'prepare_payment',
      toolCallsExecuted: toolCalls,
      proposedAction,
      quickFollowUps: isSi
        ? ['අද මුළු ආදායම කීයද?', 'අද පෝලිමේ අංකය කීයද?']
        : ['What is today total revenue?', 'Who is next in the queue?'],
      modelVersion: 'jarvis-deterministic-lk-v1',
    };
  }

  // 5. Draft Appointment Booking Proposal
  if (
    lower.includes('book') ||
    lower.includes('schedule appointment') ||
    lower.includes('වෙන් කරන්න') ||
    lower.includes('දමාගන්න')
  ) {
    const timeMatch = lower.match(/(\d{1,2})[:.]?(\d{2})?\s*(am|pm)?/i);
    let timeHHMM = '16:00';
    if (timeMatch) {
      let hr = Number(timeMatch[1]);
      const min = Number(timeMatch[2] || '0');
      const ampm = (timeMatch[3] || '').toLowerCase();
      if (ampm === 'pm' && hr < 12) hr += 12;
      if (hr >= 7 && hr <= 21) {
        timeHHMM = `${String(hr).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
      }
    }
    const cleanPatient = input.message
      .replace(/book|appointment|for|at|pm|am|වෙන්|කරන්න|සඳහා/gi, ' ')
      .trim()
      .split(/\s+/)[0] || '';

    const res = await executeJarvisTool(
      context,
      'prepare_appointment_draft',
      {
        patientQuery: cleanPatient,
        timeHHMM,
        dateISO: getBusinessDateInTimezone(context.timezone),
      },
      correlationId
    );
    toolCalls.push({ tool: 'prepare_appointment_draft', summary: res.summary });
    proposedAction = res.proposedAction ?? null;

    const reply = proposedAction
      ? isSi
        ? `Appointment කෙටුම්පත සූදානම්යි: ${proposedAction.summaryLabel}. තහවුරු කිරීමට Confirm ඔබන්න.`
        : `Appointment draft ready: ${proposedAction.summaryLabel}. Tap Confirm to finalize and issue queue token.`
      : isSi
        ? 'Appointment එකක් සකස් කිරීමට ලියාපදිංචි රෝගියෙකුගේ නමක් සඳහන් කරන්න.'
        : 'Please mention a registered patient name to prepare the appointment draft.';

    return {
      sessionId: input.sessionId,
      replyText: reply,
      replySpeechText: reply,
      detectedLanguage: lang,
      intent: 'prepare_appointment',
      toolCallsExecuted: toolCalls,
      proposedAction,
      quickFollowUps: isSi
        ? ['අද Appointments කීයක් තියෙනවද?']
        : ['How many appointments today?'],
      modelVersion: 'jarvis-deterministic-lk-v1',
    };
  }

  // 6. Default: Today Board, Token Queue & Operational Briefing
  const res = await executeJarvisTool(context, 'get_today_summary', {}, correlationId);
  toolCalls.push({ tool: 'get_today_summary', summary: res.summary });
  const data = res.data as {
    enabled?: boolean;
    businessDate?: string;
    counts?: { total: number; arrived: number; scheduled: number; completed: number };
    recordedReceiptsLkr?: number;
    nowServing?: Array<{ tokenNumber: number; patientName: string }>;
  };

  const servingStr =
    data.nowServing && data.nowServing.length > 0
      ? `Token #${data.nowServing[0].tokenNumber} (${data.nowServing[0].patientName})`
      : isSi
        ? 'තවම කැඳවා නැත'
        : 'none currently called';

  const reply =
    data.enabled === false
      ? isSi
        ? `ආයුබෝවන්! මම J.A.R.V.I.S. (${context.tenantName}). ඔබට ෆාමසි තොග, කල් ඉකුත් වීම් හෝ දෛනික ආදායම් වාර්තා ගැන මගෙන් විමසිය හැක.`
        : `Hello! I am J.A.R.V.I.S. for ${context.tenantName}. Ask me about pharmacy stock, expiry alerts, or daily revenue reports.`
      : isSi
        ? `ආයුබෝවන්! අද (${data.businessDate}) සායන Appointments ${data.counts?.total ?? 0}ක් ඇත (පැමිණි: ${data.counts?.arrived ?? 0}, සම්පූර්ණ: ${data.counts?.completed ?? 0}). දැනට කැඳවන අංකය: ${servingStr}. සායන ආදායම LKR ${(data.recordedReceiptsLkr ?? 0).toLocaleString('en-LK')}.`
        : `Good day! Today (${data.businessDate}) there are ${data.counts?.total ?? 0} appointments (${data.counts?.arrived ?? 0} arrived, ${data.counts?.completed ?? 0} completed). Now serving: ${servingStr}. Clinic receipts: LKR ${(data.recordedReceiptsLkr ?? 0).toLocaleString('en-LK')}.`;

  return {
    sessionId: input.sessionId,
    replyText: reply,
    replySpeechText: reply,
    detectedLanguage: lang,
    intent: 'today_briefing',
    toolCallsExecuted: toolCalls,
    proposedAction: null,
    quickFollowUps: isSi
      ? ['Paracetamol 500mg කීයක් තියෙනවද?', 'මේ මාසේ expire වෙන ඒවා මොනවද?', 'අද මුළු ආදායම කීයද?']
      : ['Check Paracetamol 500mg stock', 'Any medicines expiring soon?', 'What is today total revenue?'],
    modelVersion: 'jarvis-deterministic-lk-v1',
  };
}

export async function runJarvisConversationalTurn(
  context: ActiveWorkspaceContext,
  input: JarvisConverseInput,
  correlationId: string
): Promise<JarvisConverseResponse> {
  assertCapability(context, 'assistant.text');
  if (input.source === 'voice') {
    assertCapability(context, 'assistant.voice');
  }

  const lang = detectLanguage(input.message, input.locale);

  // Clinical boundary safety check (does NOT charge voice turn quota)
  if (isClinicalBoundaryRequest(input.message)) {
    const msg =
      input.locale === 'si-LK'
        ? 'මෙම පද්ධතිය සායන පාලනය, පෝලිම් අංක, ගෙවීම් සහ ඖෂධ තොග පරීක්ෂාව සඳහා පමණයි. වෛද්‍ය රෝග විනිශ්චය හෝ බෙහෙත් නියම කිරීම සඳහා සහාය නොදක්වයි.'
        : 'J.A.R.V.I.S. only assists with clinic operations, queue status, billing, and read-only pharmacy inventory checks. Clinical diagnosis or prescribing advice is strictly out of scope.';
    return {
      sessionId: input.sessionId,
      replyText: msg,
      replySpeechText: msg,
      detectedLanguage: lang,
      intent: 'out_of_scope_clinical',
      toolCallsExecuted: [],
      proposedAction: null,
      quickFollowUps: ['Show today appointments', 'Check Paracetamol stock'],
      quota: { voiceTurnsUsed: 0, voiceTurnsLimit: 250 },
      modelVersion: 'boundary_policy_v1',
    };
  }

  const quotaBefore = await assertWithinQuota(context, 'voice_turns');
  await incrementQuotaUsage(context.tenantId, context.timezone, 'aiVoiceTurnsUsed', 1);
  const quotaAfter = {
    voiceTurnsUsed: quotaBefore.voiceTurnsUsed + 1,
    voiceTurnsLimit: quotaBefore.voiceTurnsLimit,
  };

  let result: Omit<JarvisConverseResponse, 'quota'> | null = null;
  const ai = getGeminiClient();

  if (ai) {
    try {
      const modelId = 'gemini-4-hydrogen';
      const businessDate = getBusinessDateInTimezone(context.timezone);
      const historyContents = (input.history ?? []).map((h) => ({
        role: h.role === 'assistant' ? ('model' as const) : ('user' as const),
        parts: [{ text: h.text }],
      }));

      const firstResp = await ai.models.generateContent({
        model: modelId,
        contents: [
          ...historyContents,
          { role: 'user', parts: [{ text: input.message }] },
        ],
        config: {
          systemInstruction: [
            `You are J.A.R.V.I.S., the intelligent Sri Lankan medical centre & pharmacy operations voice assistant for "${context.tenantName}" (${context.branchName}).`,
            `Today is ${businessDate} (Asia/Colombo, currency LKR). User preferred locale: ${input.locale}.`,
            'You speak naturally and concisely in Sinhala, English, or Singlish matching the user language, polite like an executive clinical aide.',
            'ALWAYS use the provided tools to read real live numbers—never invent stock quantities, expiries, patients, or LKR totals.',
            'For appointments or payments, ONLY prepare Draft proposals via tools; the operator must confirm in UI.',
            'Strictly refuse medical diagnosis, dosage, or treatment advice.',
          ].join(' '),
          tools: [{ functionDeclarations: JARVIS_TOOLS }],
        },
      });

      const toolCallsExecuted: Array<{ tool: string; summary: string }> = [];
      let proposedAction: JarvisConverseResponse['proposedAction'] = null;

      if (firstResp.functionCalls && firstResp.functionCalls.length > 0) {
        const functionResponses = [];
        for (const fc of firstResp.functionCalls) {
          const toolName = fc.name || '';
          const args = (fc.args as Record<string, unknown>) || {};
          const exec = await executeJarvisTool(context, toolName, args, correlationId);
          toolCallsExecuted.push({ tool: toolName, summary: exec.summary });
          if (exec.proposedAction) {
            proposedAction = exec.proposedAction;
          }
          functionResponses.push({
            functionResponse: {
              name: toolName,
              response: { result: exec.data },
            },
          });
        }

        const finalResp = await ai.models.generateContent({
          model: modelId,
          contents: [
            ...historyContents,
            { role: 'user', parts: [{ text: input.message }] },
            { role: 'model', parts: firstResp.candidates?.[0]?.content?.parts ?? [] },
            { role: 'user', parts: functionResponses },
          ],
          config: {
            systemInstruction: `Summarize the tool results naturally and concisely in ${input.locale === 'si-LK' ? 'Sinhala/English as spoken' : 'concise English'} suitable for speech readout.`,
          },
        });

        const text = (finalResp.text || 'Completed request.').trim();
        result = {
          sessionId: input.sessionId,
          replyText: text,
          replySpeechText: text,
          detectedLanguage: lang,
          intent: toolCallsExecuted.map((t) => t.tool).join('+'),
          toolCallsExecuted,
          proposedAction,
          quickFollowUps:
            input.locale === 'si-LK'
              ? ['තව විස්තර පෙන්වන්න', 'අද මුළු ආදායම කීයද?']
              : ['Show today Z-report', 'Check expiring stock'],
          modelVersion: modelId,
        };
      } else if (firstResp.text) {
        const text = firstResp.text.trim();
        result = {
          sessionId: input.sessionId,
          replyText: text,
          replySpeechText: text,
          detectedLanguage: lang,
          intent: 'conversational_reply',
          toolCallsExecuted: [],
          proposedAction: null,
          quickFollowUps:
            input.locale === 'si-LK'
              ? ['අද Appointments කීයද?', 'Paracetamol තොග කීයද?']
              : ['How many appointments today?', 'Check Paracetamol stock'],
          modelVersion: modelId,
        };
      }
    } catch (err) {
      console.warn('Gemini J.A.R.V.I.S. fallback triggered:', err);
    }
  }

  if (!result) {
    result = await runDeterministicJarvisFallback(context, input, correlationId);
  }

  if (!isDatabaseConfigured) {
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'jarvis.conversational_turn',
      entityType: 'assistant_session',
      entityId: crypto.randomUUID(),
      inputSource: input.source,
      correlationId,
      metadataJson: {
        intent: result.intent,
        modelVersion: result.modelVersion,
        toolsCount: result.toolCallsExecuted.length,
      },
    });
  } else {
    await db.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'jarvis.conversational_turn',
      entityType: 'assistant_session',
      entityId: crypto.randomUUID(),
      inputSource: input.source,
      correlationId,
      metadataJson: {
        intent: result.intent,
        modelVersion: result.modelVersion,
        toolsCount: result.toolCallsExecuted.length,
      },
    });
  }

  return {
    ...result,
    quota: quotaAfter,
  };
}

export async function synthesizeJarvisSpeech(
  text: string,
  locale: SupportedLocale
): Promise<
  | { mode: 'audio_wav'; audioBase64: string; mimeType: string }
  | { mode: 'browser_tts'; text: string; lang: SupportedLocale }
> {
  const cleanText = text.trim().slice(0, 600);
  const ai = getGeminiClient();
  if (!ai || !cleanText) {
    return { mode: 'browser_tts', text: cleanText, lang: locale };
  }

  try {
    const resp = await ai.models.generateContent({
      model: 'gemini-3.8-flash-lite-tts',
      contents: cleanText,
      config: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: locale === 'si-LK' ? 'Kore' : 'Puck',
            },
          },
        },
      },
    });

    const inlineData =
      resp.candidates?.[0]?.content?.parts?.[0]?.inlineData;
    if (inlineData?.data) {
      return {
        mode: 'audio_wav',
        audioBase64: inlineData.data,
        mimeType: inlineData.mimeType || 'audio/wav',
      };
    }
  } catch (err) {
    console.warn('Gemini TTS fallback to browser speechSynthesis:', err);
  }

  return { mode: 'browser_tts', text: cleanText, lang: locale };
}
