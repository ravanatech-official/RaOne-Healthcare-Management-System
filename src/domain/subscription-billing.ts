import crypto from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db, isDatabaseConfigured } from '../db/index.ts';
import {
  auditEvents,
  branches,
  counters,
  memberships,
  subscriptionInvoices,
  subscriptionPayments,
  tenantCapabilities,
  tenantSubscriptions,
  tenants,
  workspaceQuotaUsage,
} from '../db/schema.ts';
import type {
  BillingCycle,
  GenerateSubscriptionInvoiceInput,
  PayHereWebhookInput,
  PaySubscriptionInvoiceInput,
  ProductMode,
  SubscriptionInvoiceItem,
  SubscriptionPaymentItem,
  SubscriptionPlanDefinition,
  TenantSubscriptionOverview,
  TrialGraceStatus,
  UpdateSubscriptionPlanInput,
  WorkspaceQuotaSummary,
} from '../contracts/api.ts';
import { resolveCapabilitiesForMode } from './capabilities.ts';
import { ConflictError, DomainError, NotFoundError, ValidationError } from './errors.ts';
import { addMemAuditEvent, getMemoryStore } from './memory-store.ts';
import { assertPermission, getBusinessDateInTimezone, type ActiveWorkspaceContext } from './tenancy.ts';

export const SUBSCRIPTION_PLANS: readonly SubscriptionPlanDefinition[] = [
  {
    planCode: 'clinic_only',
    nameEn: 'Clinic Essentials',
    nameSi: 'සායන මූලික පැකේජය',
    audienceEn: 'For private clinics & consultation rooms',
    monthlyMinor: 650_000, // LKR 6,500
    annualMinor: 6_500_000, // LKR 65,000 (2 months free)
    currency: 'LKR',
    staffLimit: 5,
    branchLimit: 1,
    counterLimit: 1,
    voiceTurnsLimit: 100,
    highlightsEn: [
      'Up to 5 staff accounts, 1 branch & 100 J.A.R.V.I.S. AI turns/mo',
      'Appointments, token queue TV, doctor schedules & commission split',
      'Clinic receipts, patient history & WhatsApp/SMS reminders',
    ],
    highlightsSi: [
      'සේවක ගිණුම් 5ක්, ශාඛා 1ක් සහ J.A.R.V.I.S. වාර 100/මසකට',
      'Appointments, Waiting TV පුවරුව, වෛද්‍ය කාලසටහන් සහ කොමිස් වාර්තා',
      'සායන රිසිට්පත්, රෝගී ඉතිහාසය සහ WhatsApp/SMS සිහිකැඳවීම්',
    ],
  },
  {
    planCode: 'pharmacy_inventory_only',
    nameEn: 'Pharmacy Stock & GRN',
    nameSi: 'ඖෂධ ගබඩා පැකේජය',
    audienceEn: 'For wholesale dispensaries & drug stores',
    monthlyMinor: 750_000, // LKR 7,500
    annualMinor: 7_500_000, // LKR 75,000
    currency: 'LKR',
    staffLimit: 5,
    branchLimit: 1,
    counterLimit: 1,
    voiceTurnsLimit: 100,
    highlightsEn: [
      'Up to 5 staff accounts & 3 storage locations',
      'SKU master, versioned UOMs, stocktakes & expiry alerts',
      'GRN receiving, cost layers, quarantine & barcode scan',
    ],
    highlightsSi: [
      'සේවක ගිණුම් 5ක් සහ ගබඩා ස්ථාන 3ක්',
      'ඖෂධ SKU, stocktake ගණන් කිරීම සහ කල් ඉකුත් වීම් ඇඟවීම්',
      'GRN භාණ්ඩ ලැබීම්, barcode සහ quarantine පාලනය',
    ],
  },
  {
    planCode: 'pharmacy_retail_only',
    nameEn: 'Pharmacy Retail POS',
    nameSi: 'ෆාමසි POS පැකේජය',
    audienceEn: 'For retail pharmacies with counter POS',
    monthlyMinor: 950_000, // LKR 9,500
    annualMinor: 9_500_000, // LKR 95,000
    currency: 'LKR',
    staffLimit: 8,
    branchLimit: 1,
    counterLimit: 2,
    voiceTurnsLimit: 150,
    highlightsEn: [
      'Up to 8 staff accounts, 2 POS counters & 150 J.A.R.V.I.S. turns/mo',
      'Strict FEFO dispensing, 80mm thermal print & offline PWA queue',
      'Pharmacist Cart-Hash gate, blind till variance & quarantine returns',
    ],
    highlightsSi: [
      'සේවක ගිණුම් 8ක්, POS කවුන්ටර 2ක් සහ J.A.R.V.I.S. වාර 150/මසකට',
      'FEFO තේරීම, 80mm තාප රිසිට්පත් සහ offline POS පහසුකම',
      'Pharmacist Cart-Hash අනුමැතිය සහ quarantine ආපසු භාරගැනීම්',
    ],
  },
  {
    planCode: 'combo',
    nameEn: 'Clinic + Pharmacy Pro',
    nameSi: 'සායන + ඖෂධහල් සම්පූර්ණ පැකේජය',
    audienceEn: 'For integrated medical centres & pharmacies',
    monthlyMinor: 1_250_000, // LKR 12,500
    annualMinor: 12_500_000, // LKR 125,000
    currency: 'LKR',
    staffLimit: 15,
    branchLimit: 2,
    counterLimit: 3,
    voiceTurnsLimit: 250,
    highlightsEn: [
      'Up to 15 staff accounts, 2 branches, 3 POS counters & 250 J.A.R.V.I.S. turns',
      'Clinical dispense handoff + Inter-branch transfers + Combined Z-Report',
      'PayHere/LankaQR recurring billing & full Sri Lanka launch suite',
    ],
    highlightsSi: [
      'සේවක ගිණුම් 15ක්, ශාඛා 2ක්, POS කවුන්ටර 3ක් සහ J.A.R.V.I.S. වාර 250ක්',
      'වෛද්‍ය dispense පෝලිම + ශාඛා අතර තොග හුවමාරු + ඒකාබද්ධ Z-වාර්තා',
      'PayHere/LankaQR මාසික ගෙවීම් සහ සම්පූර්ණ විශේෂාංග',
    ],
  },
];

const BANK_TRANSFER_INSTRUCTIONS = {
  accountName: 'SuwaSeva Health Systems (Pvt) Ltd',
  bankName: 'Commercial Bank of Ceylon PLC',
  branchName: 'Colombo 03 (Kollupitiya)',
  accountNumber: '1100849201',
  referenceHint: 'Include your invoice number (e.g. INV-202611-0001) in bank remarks',
};

export function getPlanDefinition(planCode: ProductMode): SubscriptionPlanDefinition {
  const found = SUBSCRIPTION_PLANS.find((p) => p.planCode === planCode);
  return found ?? SUBSCRIPTION_PLANS[3];
}

export function computePlanPricing(planCode: ProductMode, billingCycle: BillingCycle) {
  const plan = getPlanDefinition(planCode);
  if (billingCycle === 'annual') {
    const subtotalMinor = plan.monthlyMinor * 12;
    const totalMinor = plan.annualMinor;
    const discountMinor = Math.max(0, subtotalMinor - totalMinor);
    return { plan, subtotalMinor, discountMinor, totalMinor };
  }
  return {
    plan,
    subtotalMinor: plan.monthlyMinor,
    discountMinor: 0,
    totalMinor: plan.monthlyMinor,
  };
}

export function validateLuhn(rawCardNumber: string): boolean {
  const digits = rawCardNumber.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

export function detectCardBrand(rawCardNumber: string): string {
  const digits = rawCardNumber.replace(/\D/g, '');
  if (/^4/.test(digits)) return 'Visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'Mastercard';
  if (/^3[47]/.test(digits)) return 'Amex';
  return 'Card';
}

export function validateCardExpiry(expiry: string, referenceDate = new Date()): boolean {
  const match = expiry.trim().match(/^(\d{2})\s*\/\s*(\d{2}|\d{4})$/);
  if (!match) return false;
  const month = Number(match[1]);
  let year = Number(match[2]);
  if (month < 1 || month > 12) return false;
  if (year < 100) {
    year += 2000;
  }
  const currentYear = referenceDate.getUTCFullYear();
  const currentMonth = referenceDate.getUTCMonth() + 1;
  return year > currentYear || (year === currentYear && month >= currentMonth);
}

function addDaysToIsoDate(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function diffDaysBetweenIso(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso}T00:00:00Z`).getTime();
  const b = new Date(`${toIso}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

function addBillingPeriod(startDate: string, cycle: BillingCycle): string {
  return addDaysToIsoDate(startDate, cycle === 'annual' ? 365 : 30);
}

function formatInvoiceNumber(businessDate: string, sequence: number): string {
  const yyyymm = businessDate.replace(/-/g, '').slice(0, 6);
  return `INV-${yyyymm}-${String(sequence).padStart(4, '0')}`;
}

function formatReceiptNumber(businessDate: string, tag: string): string {
  const yyyymmdd = businessDate.replace(/-/g, '');
  return `SUB-RCP-${yyyymmdd}-${tag.toUpperCase()}`;
}

export function computeTrialGraceStatus(params: {
  status: string;
  trialEndsAt: string;
  graceEndsAt: string;
  businessDate: string;
}): TrialGraceStatus {
  const trialEnds = params.trialEndsAt || addDaysToIsoDate(params.businessDate, 14);
  const graceEnds = params.graceEndsAt || addDaysToIsoDate(trialEnds, 7);
  const trialDaysRemaining = Math.max(0, diffDaysBetweenIso(params.businessDate, trialEnds));
  const graceDaysRemaining = Math.max(0, diffDaysBetweenIso(params.businessDate, graceEnds));

  if (params.status === 'active') {
    return {
      status: 'active',
      trialDaysRemaining: 0,
      graceDaysRemaining: 0,
      isReadOnlyGrace: false,
      trialEndsAt: trialEnds,
      graceEndsAt: graceEnds,
      bannerMessageEn: 'Subscription active and up to date.',
      bannerMessageSi: 'දායකත්වය සක්‍රීයයි.',
    };
  }

  if (params.status === 'suspended') {
    return {
      status: 'suspended',
      trialDaysRemaining: 0,
      graceDaysRemaining: 0,
      isReadOnlyGrace: true,
      trialEndsAt: trialEnds,
      graceEndsAt: graceEnds,
      bannerMessageEn: 'Workspace subscription suspended — billing payment required to resume writes.',
      bannerMessageSi: 'දායකත්වය තාවකාලිකව අත්හිටුවා ඇත — දිගටම භාවිතයට බිල්පත ගෙවන්න.',
    };
  }

  if (params.status === 'past_due' || (params.status === 'trialing' && params.businessDate > trialEnds)) {
    const isPastGrace = params.businessDate > graceEnds;
    return {
      status: isPastGrace ? 'past_due' : 'grace_read_only',
      trialDaysRemaining: 0,
      graceDaysRemaining,
      isReadOnlyGrace: true,
      trialEndsAt: trialEnds,
      graceEndsAt: graceEnds,
      bannerMessageEn: isPastGrace
        ? 'Trial/invoice grace period expired — workspace is in read-only mode until payment is settled.'
        : `Read-only grace period (${graceDaysRemaining} day(s) left). All existing data is safe; settle your LKR invoice to re-enable edits.`,
      bannerMessageSi: isPastGrace
        ? 'සහන කාලය අවසන් — දත්ත ආරක්ෂිතයි, නව ඇතුළත් කිරීම් සඳහා කරුණාකර මාසික ගෙවීම සිදු කරන්න.'
        : `සහන කාලය (දින ${graceDaysRemaining}ක් ඉතිරියි) — Read-only ප්‍රකාරය ක්‍රියාත්මකයි. නැවත සක්‍රීය කිරීමට බිල්පත ගෙවන්න.`,
    };
  }

  return {
    status: 'trialing',
    trialDaysRemaining,
    graceDaysRemaining,
    isReadOnlyGrace: false,
    trialEndsAt: trialEnds,
    graceEndsAt: graceEnds,
    bannerMessageEn: `${trialDaysRemaining}-day free trial remaining. Activate monthly LKR billing anytime.`,
    bannerMessageSi: `දින ${trialDaysRemaining}ක නොමිලේ අත්හදා බැලීමේ කාලය ඉතිරියි.`,
  };
}

// ---------------------------------------------------------------------------
// In-memory store fallback when Cloud SQL is not yet provisioned
// ---------------------------------------------------------------------------
interface MemoryBillingState {
  subscription: TenantSubscriptionOverview['subscription'] & {
    recurringToken: string;
  };
  invoices: SubscriptionInvoiceItem[];
  payments: Array<SubscriptionPaymentItem & { idempotencyKey: string }>;
}

declare global {
  var _memoryBillingByTenant: Map<string, MemoryBillingState> | undefined;
}

function getMemoryBillingMap(): Map<string, MemoryBillingState> {
  if (!global._memoryBillingByTenant) {
    global._memoryBillingByTenant = new Map<string, MemoryBillingState>();
  }
  return global._memoryBillingByTenant;
}

export function resetMemoryBillingStore(): void {
  global._memoryBillingByTenant = new Map<string, MemoryBillingState>();
}

function ensureMemoryBillingState(
  tenantId: string,
  productMode: ProductMode,
  timezone = 'Asia/Colombo'
): MemoryBillingState {
  const map = getMemoryBillingMap();
  const existing = map.get(tenantId);
  if (existing) return existing;

  const today = getBusinessDateInTimezone(timezone);
  const periodEnd = addBillingPeriod(today, 'monthly');
  const trialEndsAt = addDaysToIsoDate(today, 14);
  const graceEndsAt = addDaysToIsoDate(trialEndsAt, 7);
  const { plan, subtotalMinor, discountMinor, totalMinor } = computePlanPricing(
    productMode,
    'monthly'
  );
  const subId = crypto.randomUUID();
  const invId = crypto.randomUUID();

  const initialState: MemoryBillingState = {
    subscription: {
      id: subId,
      tenantId,
      planCode: productMode,
      billingCycle: 'monthly',
      status: 'trialing',
      monthlyAmountMinor: plan.monthlyMinor,
      effectiveCycleAmountMinor: totalMinor,
      currency: 'LKR',
      currentPeriodStart: today,
      currentPeriodEnd: periodEnd,
      nextBillingDate: periodEnd,
      autoRenew: true,
      paymentMethodType: 'none',
      paymentMethodLabel: '',
      gatewayProvider: 'payhere',
      recurringTokenActive: false,
      recurringToken: '',
      trialEndsAt,
      graceEndsAt,
      lastWebhookAt: null,
    },
    invoices: [
      {
        id: invId,
        invoiceNumber: formatInvoiceNumber(today, 1),
        planCode: productMode,
        billingCycle: 'monthly',
        description: `${plan.nameEn} — Monthly Subscription (${today} to ${periodEnd})`,
        billingPeriodStart: today,
        billingPeriodEnd: periodEnd,
        dueDate: addDaysToIsoDate(today, 7),
        subtotalMinor,
        discountMinor,
        totalMinor,
        paidMinor: 0,
        currency: 'LKR',
        status: 'open',
        issuedAt: new Date().toISOString(),
        paidAt: null,
      },
    ],
    payments: [],
  };

  map.set(tenantId, initialState);
  return initialState;
}

export function setMemorySubscriptionStateForTest(
  tenantId: string,
  patch: Partial<MemoryBillingState['subscription']>
): void {
  const state = getMemoryBillingMap().get(tenantId);
  if (state) {
    Object.assign(state.subscription, patch);
  }
}

export async function assertWorkspaceNotReadOnlyGrace(
  tenantId: string,
  timezone = 'Asia/Colombo'
): Promise<void> {
  const today = getBusinessDateInTimezone(timezone);
  let status = 'trialing';
  let trialEndsAt = addDaysToIsoDate(today, 14);
  let graceEndsAt = addDaysToIsoDate(trialEndsAt, 7);

  if (!isDatabaseConfigured) {
    const state = getMemoryBillingMap().get(tenantId);
    if (!state) return; // Freshly created before billing checked -> active trial
    status = state.subscription.status;
    trialEndsAt = state.subscription.trialEndsAt;
    graceEndsAt = state.subscription.graceEndsAt;
  } else {
    const [sub] = await db
      .select()
      .from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.tenantId, tenantId))
      .limit(1);
    if (!sub) return;
    status = sub.status;
    trialEndsAt = sub.trialEndsAt || addDaysToIsoDate(sub.currentPeriodStart, 14);
    graceEndsAt = sub.graceEndsAt || addDaysToIsoDate(trialEndsAt, 7);
  }

  const tg = computeTrialGraceStatus({
    status,
    trialEndsAt,
    graceEndsAt,
    businessDate: today,
  });

  if (tg.isReadOnlyGrace) {
    throw new DomainError({
      statusCode: 402,
      code: 'GRACE_READ_ONLY',
      messageKey: 'errors.grace_read_only',
      message: tg.bannerMessageEn,
      retryable: false,
      nextStep: 'billing_pay',
    });
  }
}

// ---------------------------------------------------------------------------
// Usage Quota Metering (Staff, Branches, POS Counters, J.A.R.V.I.S. Turns, SMS/WA)
// ---------------------------------------------------------------------------
export async function getWorkspaceQuotaSummary(
  context: ActiveWorkspaceContext,
  overridePlanCode?: ProductMode
): Promise<WorkspaceQuotaSummary> {
  const plan = getPlanDefinition(overridePlanCode ?? context.productMode);
  const periodMonth = getBusinessDateInTimezone(context.timezone).slice(0, 7);

  let staffUsed = 1;
  let branchesUsed = 1;
  let countersUsed = 1;
  let voiceTurnsUsed = 0;
  let whatsappSentCount = 0;
  let smsSentCount = 0;

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    staffUsed = store.memberships.filter(
      (m) => m.tenantId === context.tenantId && m.active
    ).length;
    branchesUsed = store.branches.filter(
      (b) => b.tenantId === context.tenantId && b.active
    ).length;
    countersUsed = store.counters.filter(
      (c) => c.tenantId === context.tenantId && c.active
    ).length;
    const usage = store.workspaceQuotaUsage.find(
      (q) => q.tenantId === context.tenantId && q.periodMonth === periodMonth
    );
    if (usage) {
      voiceTurnsUsed = usage.aiVoiceTurnsUsed;
      whatsappSentCount = usage.whatsappSentCount;
      smsSentCount = usage.smsSentCount;
    }
  } else {
    const memRows = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(and(eq(memberships.tenantId, context.tenantId), eq(memberships.active, true)));
    const branchRows = await db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.tenantId, context.tenantId), eq(branches.active, true)));
    const counterRows = await db
      .select({ id: counters.id })
      .from(counters)
      .where(and(eq(counters.tenantId, context.tenantId), eq(counters.active, true)));
    const [usage] = await db
      .select()
      .from(workspaceQuotaUsage)
      .where(
        and(
          eq(workspaceQuotaUsage.tenantId, context.tenantId),
          eq(workspaceQuotaUsage.periodMonth, periodMonth)
        )
      )
      .limit(1);

    staffUsed = memRows.length;
    branchesUsed = branchRows.length;
    countersUsed = counterRows.length;
    voiceTurnsUsed = usage?.aiVoiceTurnsUsed ?? 0;
    whatsappSentCount = usage?.whatsappSentCount ?? 0;
    smsSentCount = usage?.smsSentCount ?? 0;
  }

  const overageAlerts: WorkspaceQuotaSummary['overageAlerts'] = [];
  const checkMetric = (
    resource: WorkspaceQuotaSummary['overageAlerts'][number]['resource'],
    used: number,
    limit: number,
    label: string
  ) => {
    if (limit <= 0) return;
    if (used >= limit) {
      overageAlerts.push({
        resource,
        used,
        limit,
        severity: 'exceeded',
        message: `${label} limit reached (${used}/${limit}). Upgrade plan to unlock more capacity.`,
      });
    } else if (used / limit >= 0.8) {
      overageAlerts.push({
        resource,
        used,
        limit,
        severity: 'warning',
        message: `${label} usage is at ${Math.round((used / limit) * 100)}% (${used}/${limit}).`,
      });
    }
  };

  checkMetric('staff', staffUsed, plan.staffLimit, 'Staff seats');
  checkMetric('branches', branchesUsed, plan.branchLimit, 'Branches');
  checkMetric('counters', countersUsed, plan.counterLimit, 'POS counters');
  checkMetric('voice_turns', voiceTurnsUsed, plan.voiceTurnsLimit, 'J.A.R.V.I.S. AI turns');

  return {
    periodMonth,
    staffUsed,
    staffLimit: plan.staffLimit,
    branchesUsed,
    branchLimit: plan.branchLimit,
    countersUsed,
    counterLimit: plan.counterLimit,
    voiceTurnsUsed,
    voiceTurnsLimit: plan.voiceTurnsLimit,
    whatsappSentCount,
    smsSentCount,
    overageAlerts,
  };
}

export async function incrementQuotaUsage(
  tenantId: string,
  timezone: string,
  field: 'aiVoiceTurnsUsed' | 'whatsappSentCount' | 'smsSentCount',
  delta = 1
): Promise<void> {
  const periodMonth = getBusinessDateInTimezone(timezone).slice(0, 7);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    let row = store.workspaceQuotaUsage.find(
      (q) => q.tenantId === tenantId && q.periodMonth === periodMonth
    );
    if (!row) {
      row = {
        id: crypto.randomUUID(),
        tenantId,
        periodMonth,
        aiVoiceTurnsUsed: 0,
        whatsappSentCount: 0,
        smsSentCount: 0,
        updatedAt: new Date(),
      };
      store.workspaceQuotaUsage.push(row);
    }
    row[field] += delta;
    row.updatedAt = new Date();
    return;
  }

  const [existing] = await db
    .select()
    .from(workspaceQuotaUsage)
    .where(
      and(
        eq(workspaceQuotaUsage.tenantId, tenantId),
        eq(workspaceQuotaUsage.periodMonth, periodMonth)
      )
    )
    .limit(1);

  if (!existing) {
    await db.insert(workspaceQuotaUsage).values({
      tenantId,
      periodMonth,
      aiVoiceTurnsUsed: field === 'aiVoiceTurnsUsed' ? delta : 0,
      whatsappSentCount: field === 'whatsappSentCount' ? delta : 0,
      smsSentCount: field === 'smsSentCount' ? delta : 0,
    });
  } else {
    await db
      .update(workspaceQuotaUsage)
      .set({
        aiVoiceTurnsUsed:
          field === 'aiVoiceTurnsUsed'
            ? existing.aiVoiceTurnsUsed + delta
            : existing.aiVoiceTurnsUsed,
        whatsappSentCount:
          field === 'whatsappSentCount'
            ? existing.whatsappSentCount + delta
            : existing.whatsappSentCount,
        smsSentCount:
          field === 'smsSentCount' ? existing.smsSentCount + delta : existing.smsSentCount,
        updatedAt: new Date(),
      })
      .where(eq(workspaceQuotaUsage.id, existing.id));
  }
}

export async function assertWithinQuota(
  context: ActiveWorkspaceContext,
  resource: 'staff' | 'branches' | 'counters' | 'voice_turns'
): Promise<WorkspaceQuotaSummary> {
  const summary = await getWorkspaceQuotaSummary(context);
  if (resource === 'staff' && summary.staffUsed >= summary.staffLimit) {
    throw new DomainError({
      statusCode: 403,
      code: 'QUOTA_EXCEEDED',
      messageKey: 'errors.quota_exceeded',
      message: `Staff seat limit (${summary.staffLimit}) reached on current plan. Upgrade plan on Billing page.`,
      nextStep: 'upgrade_plan',
    });
  }
  if (resource === 'branches' && summary.branchesUsed >= summary.branchLimit) {
    throw new DomainError({
      statusCode: 403,
      code: 'QUOTA_EXCEEDED',
      messageKey: 'errors.quota_exceeded',
      message: `Branch limit (${summary.branchLimit}) reached on current plan. Upgrade to Clinic + Pharmacy Pro for multi-branch scale.`,
      nextStep: 'upgrade_plan',
    });
  }
  if (resource === 'counters' && summary.countersUsed >= summary.counterLimit) {
    throw new DomainError({
      statusCode: 403,
      code: 'QUOTA_EXCEEDED',
      messageKey: 'errors.quota_exceeded',
      message: `POS counter limit (${summary.counterLimit}) reached on current plan.`,
      nextStep: 'upgrade_plan',
    });
  }
  if (resource === 'voice_turns' && summary.voiceTurnsUsed >= summary.voiceTurnsLimit) {
    throw new DomainError({
      statusCode: 429,
      code: 'VOICE_QUOTA_EXCEEDED',
      messageKey: 'errors.quota_exceeded',
      message: `Monthly J.A.R.V.I.S. voice turn quota (${summary.voiceTurnsLimit}) exhausted. Upgrade plan to continue.`,
      nextStep: 'upgrade_plan',
    });
  }
  return summary;
}

function buildOverviewFromState(
  state: MemoryBillingState,
  trialGrace: TrialGraceStatus,
  quotas: WorkspaceQuotaSummary
): TenantSubscriptionOverview {
  const outstandingMinor = state.invoices
    .filter((inv) => inv.status === 'open' || inv.status === 'past_due')
    .reduce((acc, inv) => acc + Math.max(0, inv.totalMinor - inv.paidMinor), 0);

  const { recurringToken, ...pubSub } = state.subscription;
  return {
    subscription: {
      ...pubSub,
      recurringTokenActive: Boolean(recurringToken),
    },
    trialGrace,
    quotas,
    plans: [...SUBSCRIPTION_PLANS],
    invoices: [...state.invoices].sort((a, b) => (a.issuedAt < b.issuedAt ? 1 : -1)),
    payments: state.payments
      .map(({ idempotencyKey: _ignored, ...rest }) => rest)
      .sort((a, b) => (a.paidAt < b.paidAt ? 1 : -1)),
    outstandingMinor,
    bankTransferInstructions: BANK_TRANSFER_INSTRUCTIONS,
  };
}

// ---------------------------------------------------------------------------
// PayHere / WebXPay / Genie MD5 Webhook Signature Verification
// ---------------------------------------------------------------------------
function getPayHereMerchantSecret(): string {
  return process.env.PAYHERE_MERCHANT_SECRET?.trim() || 'suwaseva-payhere-sandbox-secret';
}

export function computePayHereMd5Sig(params: {
  merchantId: string;
  orderId: string;
  payhereAmount: string;
  payhereCurrency: string;
  statusCode: string;
  merchantSecret?: string;
}): string {
  const secret = params.merchantSecret ?? getPayHereMerchantSecret();
  const hashedSecret = crypto.createHash('md5').update(secret).digest('hex').toUpperCase();
  const raw = `${params.merchantId}${params.orderId}${params.payhereAmount}${params.payhereCurrency}${params.statusCode}${hashedSecret}`;
  return crypto.createHash('md5').update(raw).digest('hex').toUpperCase();
}

export async function processPayHereWebhook(
  input: PayHereWebhookInput,
  correlationId: string
): Promise<{
  verified: boolean;
  settled: boolean;
  invoiceNumber: string;
  gatewayProvider: string;
  receiptNumber: string | null;
}> {
  const expectedSig = computePayHereMd5Sig({
    merchantId: input.merchant_id,
    orderId: input.order_id,
    payhereAmount: input.payhere_amount,
    payhereCurrency: input.payhere_currency,
    statusCode: input.status_code,
  });

  if (expectedSig !== input.md5sig.trim().toUpperCase()) {
    throw new DomainError({
      statusCode: 401,
      code: 'WEBHOOK_SIGNATURE_INVALID',
      messageKey: 'errors.validation_failed',
      message: 'PayHere MD5 webhook signature verification failed.',
      retryable: false,
    });
  }

  const isSuccess = input.status_code === '2';
  const now = new Date();
  const nowIso = now.toISOString();
  const businessDate = getBusinessDateInTimezone('Asia/Colombo', now);
  const idempotencyKey = `wh-${input.gateway_provider}-${input.payment_id}`;

  if (!isDatabaseConfigured) {
    let targetTenantId: string | null = null;
    let targetState: MemoryBillingState | null = null;
    let targetInvoice: SubscriptionInvoiceItem | undefined;

    for (const [tid, st] of getMemoryBillingMap().entries()) {
      const inv = st.invoices.find(
        (i) => i.invoiceNumber === input.order_id || i.id === input.order_id
      );
      if (inv) {
        targetTenantId = tid;
        targetState = st;
        targetInvoice = inv;
        break;
      }
    }

    if (!targetState || !targetInvoice || !targetTenantId) {
      throw new NotFoundError(`Invoice matching order_id ${input.order_id} not found`);
    }

    const existingPay = targetState.payments.find((p) => p.idempotencyKey === idempotencyKey);
    if (existingPay) {
      return {
        verified: true,
        settled: existingPay.status === 'succeeded',
        invoiceNumber: targetInvoice.invoiceNumber,
        gatewayProvider: input.gateway_provider,
        receiptNumber: existingPay.receiptNumber,
      };
    }

    const receiptNumber = formatReceiptNumber(
      businessDate,
      crypto.randomBytes(3).toString('hex')
    );
    const cardBrand = input.method || 'Visa';
    const cardLast4 = (input.card_no || '4242').slice(-4);
    const amountMinor = Math.max(
      1,
      Math.round(Number.parseFloat(input.payhere_amount) * 100) ||
        targetInvoice.totalMinor - targetInvoice.paidMinor
    );

    targetState.payments.unshift({
      id: crypto.randomUUID(),
      invoiceId: targetInvoice.id,
      invoiceNumber: targetInvoice.invoiceNumber,
      idempotencyKey,
      amountMinor,
      currency: input.payhere_currency || 'LKR',
      method: 'card',
      gatewayProvider: `${input.gateway_provider}_webhook`,
      gatewayReference: input.payment_id,
      cardBrand,
      cardLast4,
      bankName: '',
      bankReference: '',
      status: isSuccess ? 'succeeded' : 'failed',
      receiptNumber,
      paidAt: nowIso,
    });

    targetState.subscription.gatewayProvider = input.gateway_provider;
    targetState.subscription.lastWebhookAt = nowIso;

    if (isSuccess) {
      targetInvoice.paidMinor = targetInvoice.totalMinor;
      targetInvoice.status = 'paid';
      targetInvoice.paidAt = nowIso;
      targetState.subscription.status = 'active';
      targetState.subscription.currentPeriodStart = targetInvoice.billingPeriodStart;
      targetState.subscription.currentPeriodEnd = targetInvoice.billingPeriodEnd;
      targetState.subscription.nextBillingDate = targetInvoice.billingPeriodEnd;
      targetState.subscription.paymentMethodType = 'card';
      targetState.subscription.paymentMethodLabel = `${cardBrand} •••• ${cardLast4}`;
      if (input.recurring_token) {
        targetState.subscription.recurringToken = input.recurring_token;
        targetState.subscription.recurringTokenActive = true;
      }
    } else {
      targetState.subscription.status = 'past_due';
    }

    addMemAuditEvent({
      tenantId: targetTenantId,
      action: isSuccess ? 'subscription.webhook_settled' : 'subscription.webhook_failed',
      entityType: 'subscription_invoice',
      entityId: targetInvoice.id,
      inputSource: 'webhook',
      correlationId,
      metadataJson: {
        provider: input.gateway_provider,
        paymentId: input.payment_id,
        statusCode: input.status_code,
        receiptNumber,
      },
    });

    return {
      verified: true,
      settled: isSuccess,
      invoiceNumber: targetInvoice.invoiceNumber,
      gatewayProvider: input.gateway_provider,
      receiptNumber,
    };
  }

  return db.transaction(async (tx) => {
    const [inv] = await tx
      .select()
      .from(subscriptionInvoices)
      .where(eq(subscriptionInvoices.invoiceNumber, input.order_id))
      .limit(1);

    if (!inv) {
      throw new NotFoundError(`Invoice matching order_id ${input.order_id} not found`);
    }

    const [existingPay] = await tx
      .select()
      .from(subscriptionPayments)
      .where(
        and(
          eq(subscriptionPayments.tenantId, inv.tenantId),
          eq(subscriptionPayments.idempotencyKey, idempotencyKey)
        )
      )
      .limit(1);

    if (existingPay) {
      return {
        verified: true,
        settled: existingPay.status === 'succeeded',
        invoiceNumber: inv.invoiceNumber,
        gatewayProvider: input.gateway_provider,
        receiptNumber: existingPay.receiptNumber,
      };
    }

    const receiptNumber = formatReceiptNumber(
      businessDate,
      crypto.randomBytes(3).toString('hex')
    );
    const cardBrand = input.method || 'Visa';
    const cardLast4 = (input.card_no || '4242').slice(-4);
    const amountMinor = Math.max(
      1,
      Math.round(Number.parseFloat(input.payhere_amount) * 100) ||
        inv.totalMinor - inv.paidMinor
    );

    const [ownerMember] = await tx
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(and(eq(memberships.tenantId, inv.tenantId), eq(memberships.role, 'owner')))
      .limit(1);

    await tx.insert(subscriptionPayments).values({
      tenantId: inv.tenantId,
      invoiceId: inv.id,
      idempotencyKey,
      amountMinor,
      currency: input.payhere_currency || 'LKR',
      method: 'card',
      gatewayProvider: `${input.gateway_provider}_webhook`,
      gatewayReference: input.payment_id,
      cardBrand,
      cardLast4,
      bankName: '',
      bankReference: '',
      status: isSuccess ? 'succeeded' : 'failed',
      receiptNumber,
      paidByUserId: ownerMember?.userId ?? 1,
      paidAt: now,
      metadataJson: {
        correlationId,
        statusCode: input.status_code,
        recurringTokenPresent: Boolean(input.recurring_token),
      },
    });

    if (isSuccess) {
      await tx
        .update(subscriptionInvoices)
        .set({ paidMinor: inv.totalMinor, status: 'paid', paidAt: now })
        .where(eq(subscriptionInvoices.id, inv.id));

      await tx
        .update(tenantSubscriptions)
        .set({
          status: 'active',
          currentPeriodStart: inv.billingPeriodStart,
          currentPeriodEnd: inv.billingPeriodEnd,
          nextBillingDate: inv.billingPeriodEnd,
          gatewayProvider: input.gateway_provider,
          paymentMethodType: 'card',
          paymentMethodLabel: `${cardBrand} •••• ${cardLast4}`,
          ...(input.recurring_token ? { recurringToken: input.recurring_token } : {}),
          lastWebhookAt: now,
          updatedAt: now,
        })
        .where(eq(tenantSubscriptions.id, inv.subscriptionId));
    } else {
      await tx
        .update(tenantSubscriptions)
        .set({
          status: 'past_due',
          gatewayProvider: input.gateway_provider,
          lastWebhookAt: now,
          updatedAt: now,
        })
        .where(eq(tenantSubscriptions.id, inv.subscriptionId));
    }

    await tx.insert(auditEvents).values({
      tenantId: inv.tenantId,
      actorUserId: ownerMember?.userId ?? null,
      actorUid: 'payhere_webhook',
      action: isSuccess ? 'subscription.webhook_settled' : 'subscription.webhook_failed',
      entityType: 'subscription_invoice',
      entityId: inv.id,
      inputSource: 'webhook',
      correlationId,
      metadataJson: {
        provider: input.gateway_provider,
        paymentId: input.payment_id,
        statusCode: input.status_code,
        receiptNumber,
      },
    });

    return {
      verified: true,
      settled: isSuccess,
      invoiceNumber: inv.invoiceNumber,
      gatewayProvider: input.gateway_provider,
      receiptNumber,
    };
  });
}

export async function triggerSandboxPayHereWebhook(
  context: ActiveWorkspaceContext,
  params: {
    invoiceId: string;
    statusCode?: '2' | '-1' | '-2';
    gatewayProvider?: 'payhere' | 'webxpay' | 'genie';
  },
  correlationId: string
) {
  assertPermission(context, 'billing.manage');
  const overview = await getSubscriptionOverview(context);
  const inv =
    overview.invoices.find((i) => i.id === params.invoiceId) ??
    overview.invoices.find((i) => i.status === 'open' || i.status === 'past_due');

  if (!inv) {
    throw new NotFoundError('No open invoice available for sandbox webhook test');
  }

  const merchantId = process.env.PAYHERE_MERCHANT_ID?.trim() || '1228490';
  const payhereAmount = (Math.max(100, inv.totalMinor - inv.paidMinor) / 100).toFixed(2);
  const statusCode = params.statusCode ?? '2';
  const md5sig = computePayHereMd5Sig({
    merchantId,
    orderId: inv.invoiceNumber,
    payhereAmount,
    payhereCurrency: inv.currency,
    statusCode,
  });

  const webhookRes = await processPayHereWebhook(
    {
      merchant_id: merchantId,
      order_id: inv.invoiceNumber,
      payment_id: `PHW-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      payhere_amount: payhereAmount,
      payhere_currency: inv.currency,
      status_code: statusCode,
      md5sig,
      method: 'VISA',
      card_holder_name: context.tenantName,
      card_no: '4242********4242',
      card_expiry: '12/29',
      recurring_token: `tok_${crypto.randomBytes(8).toString('hex')}`,
      gateway_provider: params.gatewayProvider ?? 'payhere',
    },
    correlationId
  );

  const updatedOverview = await getSubscriptionOverview(context);
  return { webhookResult: webhookRes, overview: updatedOverview };
}

// ---------------------------------------------------------------------------
// Public Domain Functions
// ---------------------------------------------------------------------------
export async function getSubscriptionOverview(
  context: ActiveWorkspaceContext
): Promise<TenantSubscriptionOverview> {
  assertPermission(context, 'billing.read');
  const today = getBusinessDateInTimezone(context.timezone);

  if (!isDatabaseConfigured) {
    const state = ensureMemoryBillingState(context.tenantId, context.productMode, context.timezone);
    const trialGrace = computeTrialGraceStatus({
      status: state.subscription.status,
      trialEndsAt: state.subscription.trialEndsAt,
      graceEndsAt: state.subscription.graceEndsAt,
      businessDate: today,
    });
    const quotas = await getWorkspaceQuotaSummary(context, state.subscription.planCode);
    return buildOverviewFromState(state, trialGrace, quotas);
  }

  return db.transaction(async (tx) => {
    let [sub] = await tx
      .select()
      .from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.tenantId, context.tenantId))
      .limit(1);

    if (!sub) {
      const periodEnd = addBillingPeriod(today, 'monthly');
      const trialEndsAt = addDaysToIsoDate(today, 14);
      const graceEndsAt = addDaysToIsoDate(trialEndsAt, 7);
      const { plan, subtotalMinor, discountMinor, totalMinor } = computePlanPricing(
        context.productMode,
        'monthly'
      );

      [sub] = await tx
        .insert(tenantSubscriptions)
        .values({
          tenantId: context.tenantId,
          planCode: context.productMode,
          billingCycle: 'monthly',
          status: 'trialing',
          monthlyAmountMinor: plan.monthlyMinor,
          currency: 'LKR',
          currentPeriodStart: today,
          currentPeriodEnd: periodEnd,
          nextBillingDate: periodEnd,
          autoRenew: true,
          paymentMethodType: 'none',
          paymentMethodLabel: '',
          gatewayProvider: 'payhere',
          recurringToken: '',
          trialEndsAt,
          graceEndsAt,
        })
        .returning();

      await tx.insert(subscriptionInvoices).values({
        tenantId: context.tenantId,
        subscriptionId: sub.id,
        invoiceNumber: formatInvoiceNumber(today, 1),
        planCode: context.productMode,
        billingCycle: 'monthly',
        description: `${plan.nameEn} — Monthly Subscription (${today} to ${periodEnd})`,
        billingPeriodStart: today,
        billingPeriodEnd: periodEnd,
        dueDate: addDaysToIsoDate(today, 7),
        subtotalMinor,
        discountMinor,
        totalMinor,
        paidMinor: 0,
        currency: 'LKR',
        status: 'open',
      });
    }

    const invoiceRows = await tx
      .select()
      .from(subscriptionInvoices)
      .where(eq(subscriptionInvoices.tenantId, context.tenantId))
      .orderBy(desc(subscriptionInvoices.issuedAt));

    const paymentRows = await tx
      .select()
      .from(subscriptionPayments)
      .where(eq(subscriptionPayments.tenantId, context.tenantId))
      .orderBy(desc(subscriptionPayments.paidAt));

    const invoiceNumberById = new Map(invoiceRows.map((i) => [i.id, i.invoiceNumber]));
    const pricing = computePlanPricing(
      sub.planCode as ProductMode,
      sub.billingCycle as BillingCycle
    );

    const invoices: SubscriptionInvoiceItem[] = invoiceRows.map((row) => ({
      id: row.id,
      invoiceNumber: row.invoiceNumber,
      planCode: row.planCode as ProductMode,
      billingCycle: row.billingCycle as BillingCycle,
      description: row.description,
      billingPeriodStart: row.billingPeriodStart,
      billingPeriodEnd: row.billingPeriodEnd,
      dueDate: row.dueDate,
      subtotalMinor: row.subtotalMinor,
      discountMinor: row.discountMinor,
      totalMinor: row.totalMinor,
      paidMinor: row.paidMinor,
      currency: row.currency,
      status: row.status as SubscriptionInvoiceItem['status'],
      issuedAt: row.issuedAt.toISOString(),
      paidAt: row.paidAt ? row.paidAt.toISOString() : null,
    }));

    const payments: SubscriptionPaymentItem[] = paymentRows.map((row) => ({
      id: row.id,
      invoiceId: row.invoiceId,
      invoiceNumber: invoiceNumberById.get(row.invoiceId) ?? '',
      amountMinor: row.amountMinor,
      currency: row.currency,
      method: row.method as SubscriptionPaymentItem['method'],
      gatewayProvider: row.gatewayProvider,
      gatewayReference: row.gatewayReference,
      cardBrand: row.cardBrand,
      cardLast4: row.cardLast4,
      bankName: row.bankName,
      bankReference: row.bankReference,
      status: row.status as SubscriptionPaymentItem['status'],
      receiptNumber: row.receiptNumber,
      paidAt: row.paidAt.toISOString(),
    }));

    const outstandingMinor = invoices
      .filter((inv) => inv.status === 'open' || inv.status === 'past_due')
      .reduce((acc, inv) => acc + Math.max(0, inv.totalMinor - inv.paidMinor), 0);

    const trialEndsAt = sub.trialEndsAt || addDaysToIsoDate(sub.currentPeriodStart, 14);
    const graceEndsAt = sub.graceEndsAt || addDaysToIsoDate(trialEndsAt, 7);
    const trialGrace = computeTrialGraceStatus({
      status: sub.status,
      trialEndsAt,
      graceEndsAt,
      businessDate: today,
    });
    const quotas = await getWorkspaceQuotaSummary(context, sub.planCode as ProductMode);

    return {
      subscription: {
        id: sub.id,
        tenantId: sub.tenantId,
        planCode: sub.planCode as ProductMode,
        billingCycle: sub.billingCycle as BillingCycle,
        status: sub.status as TenantSubscriptionOverview['subscription']['status'],
        monthlyAmountMinor: sub.monthlyAmountMinor,
        effectiveCycleAmountMinor: pricing.totalMinor,
        currency: sub.currency,
        currentPeriodStart: sub.currentPeriodStart,
        currentPeriodEnd: sub.currentPeriodEnd,
        nextBillingDate: sub.nextBillingDate,
        autoRenew: sub.autoRenew,
        paymentMethodType:
          (sub.paymentMethodType as TenantSubscriptionOverview['subscription']['paymentMethodType']) ||
          'none',
        paymentMethodLabel: sub.paymentMethodLabel,
        gatewayProvider: sub.gatewayProvider || 'payhere',
        recurringTokenActive: Boolean(sub.recurringToken),
        trialEndsAt,
        graceEndsAt,
        lastWebhookAt: sub.lastWebhookAt ? sub.lastWebhookAt.toISOString() : null,
      },
      trialGrace,
      quotas,
      plans: [...SUBSCRIPTION_PLANS],
      invoices,
      payments,
      outstandingMinor,
      bankTransferInstructions: BANK_TRANSFER_INSTRUCTIONS,
    };
  });
}

export async function updateSubscriptionPlan(
  context: ActiveWorkspaceContext,
  input: UpdateSubscriptionPlanInput,
  correlationId: string
): Promise<TenantSubscriptionOverview> {
  assertPermission(context, 'billing.manage');

  const pricing = computePlanPricing(input.planCode, input.billingCycle);

  if (!isDatabaseConfigured) {
    const state = ensureMemoryBillingState(context.tenantId, context.productMode, context.timezone);
    state.subscription.planCode = input.planCode;
    state.subscription.billingCycle = input.billingCycle;
    state.subscription.monthlyAmountMinor = pricing.plan.monthlyMinor;
    state.subscription.effectiveCycleAmountMinor = pricing.totalMinor;
    if (typeof input.autoRenew === 'boolean') {
      state.subscription.autoRenew = input.autoRenew;
    }

    const openInv = state.invoices.find((inv) => inv.status === 'open' && inv.paidMinor === 0);
    if (openInv) {
      const periodEnd = addBillingPeriod(openInv.billingPeriodStart, input.billingCycle);
      openInv.planCode = input.planCode;
      openInv.billingCycle = input.billingCycle;
      openInv.billingPeriodEnd = periodEnd;
      openInv.subtotalMinor = pricing.subtotalMinor;
      openInv.discountMinor = pricing.discountMinor;
      openInv.totalMinor = pricing.totalMinor;
      openInv.description = `${pricing.plan.nameEn} — ${
        input.billingCycle === 'annual' ? 'Annual' : 'Monthly'
      } Subscription (${openInv.billingPeriodStart} to ${periodEnd})`;
      state.subscription.currentPeriodEnd = periodEnd;
      state.subscription.nextBillingDate = periodEnd;
    }

    // Also sync productMode & capabilities in memory store if tenant exists there
    const store = getMemoryStore();
    const tenant = store.tenants.find((t) => t.id === context.tenantId);
    if (tenant && tenant.productMode !== input.planCode) {
      tenant.productMode = input.planCode;
      tenant.updatedAt = new Date();
      const resolved = resolveCapabilitiesForMode(input.planCode);
      for (const [key, enabled] of Object.entries(resolved)) {
        const cap = store.capabilities.find(
          (c) => c.tenantId === context.tenantId && c.capabilityKey === key
        );
        if (cap) {
          cap.enabled = enabled;
          cap.planTier = input.planCode;
          cap.updatedAt = new Date();
        } else {
          store.capabilities.push({
            tenantId: context.tenantId,
            capabilityKey: key,
            enabled,
            planTier: input.planCode,
            quotaLimit: key === 'assistant.voice' ? pricing.plan.voiceTurnsLimit : null,
            updatedAt: new Date(),
          });
        }
      }
    }

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'subscription.plan_updated',
      entityType: 'tenant_subscription',
      entityId: state.subscription.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: { newPlan: input.planCode, billingCycle: input.billingCycle },
    });

    return getSubscriptionOverview(context);
  }

  await getSubscriptionOverview(context);

  await db.transaction(async (tx) => {
    const [sub] = await tx
      .select()
      .from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.tenantId, context.tenantId))
      .limit(1);

    if (!sub) {
      throw new NotFoundError('Subscription record not found');
    }

    const nextPeriodEnd = addBillingPeriod(sub.currentPeriodStart, input.billingCycle);
    await tx
      .update(tenantSubscriptions)
      .set({
        planCode: input.planCode,
        billingCycle: input.billingCycle,
        monthlyAmountMinor: pricing.plan.monthlyMinor,
        currentPeriodEnd: nextPeriodEnd,
        nextBillingDate: nextPeriodEnd,
        autoRenew: typeof input.autoRenew === 'boolean' ? input.autoRenew : sub.autoRenew,
        updatedAt: new Date(),
      })
      .where(eq(tenantSubscriptions.id, sub.id));

    const [openInv] = await tx
      .select()
      .from(subscriptionInvoices)
      .where(
        and(
          eq(subscriptionInvoices.tenantId, context.tenantId),
          eq(subscriptionInvoices.status, 'open')
        )
      )
      .orderBy(desc(subscriptionInvoices.issuedAt))
      .limit(1);

    if (openInv && openInv.paidMinor === 0) {
      const invEnd = addBillingPeriod(openInv.billingPeriodStart, input.billingCycle);
      await tx
        .update(subscriptionInvoices)
        .set({
          planCode: input.planCode,
          billingCycle: input.billingCycle,
          billingPeriodEnd: invEnd,
          subtotalMinor: pricing.subtotalMinor,
          discountMinor: pricing.discountMinor,
          totalMinor: pricing.totalMinor,
          description: `${pricing.plan.nameEn} — ${
            input.billingCycle === 'annual' ? 'Annual' : 'Monthly'
          } Subscription (${openInv.billingPeriodStart} to ${invEnd})`,
        })
        .where(eq(subscriptionInvoices.id, openInv.id));
    }

    if (context.productMode !== input.planCode) {
      const resolved = resolveCapabilitiesForMode(input.planCode);
      await tx
        .update(tenants)
        .set({ productMode: input.planCode, updatedAt: new Date() })
        .where(eq(tenants.id, context.tenantId));

      for (const [capabilityKey, enabled] of Object.entries(resolved)) {
        await tx
          .insert(tenantCapabilities)
          .values({
            tenantId: context.tenantId,
            capabilityKey,
            enabled,
            planTier: input.planCode,
            quotaLimit: capabilityKey === 'assistant.voice' ? pricing.plan.voiceTurnsLimit : null,
            updatedAt: new Date(),
          })
          .onConflictDoUpdate({
            target: [tenantCapabilities.tenantId, tenantCapabilities.capabilityKey],
            set: { enabled, planTier: input.planCode, updatedAt: new Date() },
          });
      }
    }

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'subscription.plan_updated',
      entityType: 'tenant_subscription',
      entityId: sub.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: {
        previousPlan: sub.planCode,
        newPlan: input.planCode,
        billingCycle: input.billingCycle,
      },
    });
  });

  return getSubscriptionOverview(context);
}

export async function generateNextMonthlyInvoice(
  context: ActiveWorkspaceContext,
  input: GenerateSubscriptionInvoiceInput,
  correlationId: string
): Promise<TenantSubscriptionOverview> {
  assertPermission(context, 'billing.manage');

  if (!isDatabaseConfigured) {
    const state = ensureMemoryBillingState(context.tenantId, context.productMode, context.timezone);
    const hasOpen = state.invoices.some((i) => i.status === 'open' || i.status === 'past_due');
    if (hasOpen) {
      throw new ConflictError(
        'An open subscription invoice already exists. Please pay the open invoice before generating the next cycle.',
        'OPEN_INVOICE_EXISTS'
      );
    }

    const cycle = input.billingCycle ?? state.subscription.billingCycle;
    const pricing = computePlanPricing(state.subscription.planCode, cycle);
    const periodStart = state.subscription.nextBillingDate;
    const periodEnd = addBillingPeriod(periodStart, cycle);
    const nextSeq = state.invoices.length + 1;

    state.invoices.unshift({
      id: crypto.randomUUID(),
      invoiceNumber: formatInvoiceNumber(periodStart, nextSeq),
      planCode: state.subscription.planCode,
      billingCycle: cycle,
      description: `${pricing.plan.nameEn} — ${
        cycle === 'annual' ? 'Annual' : 'Monthly'
      } Renewal (${periodStart} to ${periodEnd})`,
      billingPeriodStart: periodStart,
      billingPeriodEnd: periodEnd,
      dueDate: addDaysToIsoDate(periodStart, 7),
      subtotalMinor: pricing.subtotalMinor,
      discountMinor: pricing.discountMinor,
      totalMinor: pricing.totalMinor,
      paidMinor: 0,
      currency: 'LKR',
      status: 'open',
      issuedAt: new Date().toISOString(),
      paidAt: null,
    });

    return getSubscriptionOverview(context);
  }

  await getSubscriptionOverview(context);

  await db.transaction(async (tx) => {
    const [sub] = await tx
      .select()
      .from(tenantSubscriptions)
      .where(eq(tenantSubscriptions.tenantId, context.tenantId))
      .limit(1);

    if (!sub) {
      throw new NotFoundError('Subscription not found');
    }

    const existingInvoices = await tx
      .select()
      .from(subscriptionInvoices)
      .where(eq(subscriptionInvoices.tenantId, context.tenantId));

    const hasOpen = existingInvoices.some((i) => i.status === 'open' || i.status === 'past_due');
    if (hasOpen) {
      throw new ConflictError(
        'An open subscription invoice already exists. Please pay the open invoice before generating the next cycle.',
        'OPEN_INVOICE_EXISTS'
      );
    }

    const cycle = input.billingCycle ?? (sub.billingCycle as BillingCycle);
    const pricing = computePlanPricing(sub.planCode as ProductMode, cycle);
    const periodStart = sub.nextBillingDate;
    const periodEnd = addBillingPeriod(periodStart, cycle);
    const invNumber = formatInvoiceNumber(periodStart, existingInvoices.length + 1);

    const [createdInv] = await tx
      .insert(subscriptionInvoices)
      .values({
        tenantId: context.tenantId,
        subscriptionId: sub.id,
        invoiceNumber: invNumber,
        planCode: sub.planCode,
        billingCycle: cycle,
        description: `${pricing.plan.nameEn} — ${
          cycle === 'annual' ? 'Annual' : 'Monthly'
        } Renewal (${periodStart} to ${periodEnd})`,
        billingPeriodStart: periodStart,
        billingPeriodEnd: periodEnd,
        dueDate: addDaysToIsoDate(periodStart, 7),
        subtotalMinor: pricing.subtotalMinor,
        discountMinor: pricing.discountMinor,
        totalMinor: pricing.totalMinor,
        paidMinor: 0,
        currency: 'LKR',
        status: 'open',
      })
      .returning();

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'subscription.invoice_generated',
      entityType: 'subscription_invoice',
      entityId: createdInv.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: {
        invoiceNumber: invNumber,
        totalMinor: pricing.totalMinor,
      },
    });
  });

  return getSubscriptionOverview(context);
}

function validateAndSanitizePaymentInput(input: PaySubscriptionInvoiceInput) {
  if (input.method === 'card') {
    const digits = (input.cardNumber || '').replace(/\D/g, '');
    if (!validateLuhn(digits)) {
      throw new ValidationError(
        'Please enter a valid Visa, Mastercard, or Amex card number.',
        'errors.invalid_card'
      );
    }
    if (!validateCardExpiry(input.cardExpiry || '')) {
      throw new ValidationError(
        'Card expiry must be in MM/YY format and not expired.',
        'errors.invalid_card_expiry'
      );
    }
    if (!input.cardHolderName?.trim()) {
      throw new ValidationError(
        'Cardholder name is required.',
        'errors.cardholder_required'
      );
    }
    const brand = detectCardBrand(digits);
    const last4 = digits.slice(-4);
    return {
      gatewayProvider: 'payhere_lk_card',
      gatewayReference: `PH-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      cardBrand: brand,
      cardLast4: last4,
      bankName: '',
      bankReference: '',
      paymentMethodLabel: `${brand} •••• ${last4}`,
      paymentStatus: 'succeeded' as const,
    };
  }

  if (input.method === 'lankaqr') {
    return {
      gatewayProvider: 'lankaqr_justpay',
      gatewayReference: `LQR-${crypto.randomBytes(5).toString('hex').toUpperCase()}`,
      cardBrand: '',
      cardLast4: '',
      bankName: 'LankaQR',
      bankReference: '',
      paymentMethodLabel: 'LankaQR / JustPay',
      paymentStatus: 'succeeded' as const,
    };
  }

  const bankName = input.bankName?.trim() || '';
  const bankReference = input.bankReference?.trim() || '';
  if (bankName.length < 2 || bankReference.length < 4) {
    throw new ValidationError(
      'Bank name and transfer slip reference (min 4 chars) are required for bank transfers.',
      'errors.bank_reference_required'
    );
  }
  return {
    gatewayProvider: 'manual_bank_slip',
    gatewayReference: `BNK-${bankReference.toUpperCase()}`,
    cardBrand: '',
    cardLast4: '',
    bankName,
    bankReference,
    paymentMethodLabel: `${bankName} (${bankReference})`,
    paymentStatus: 'pending_verification' as const,
  };
}

export async function paySubscriptionInvoice(
  context: ActiveWorkspaceContext,
  input: PaySubscriptionInvoiceInput,
  correlationId: string
): Promise<{
  overview: TenantSubscriptionOverview;
  payment: SubscriptionPaymentItem;
}> {
  assertPermission(context, 'billing.manage');

  const today = getBusinessDateInTimezone(context.timezone);

  if (!isDatabaseConfigured) {
    const state = ensureMemoryBillingState(context.tenantId, context.productMode, context.timezone);

    const existingPay = state.payments.find((p) => p.idempotencyKey === input.idempotencyKey);
    if (existingPay) {
      const { idempotencyKey: _ignored, ...payment } = existingPay;
      return { overview: await getSubscriptionOverview(context), payment };
    }

    const invoice = state.invoices.find((inv) => inv.id === input.invoiceId);
    if (!invoice) {
      throw new NotFoundError('Subscription invoice not found');
    }
    if (invoice.status === 'paid' || invoice.status === 'void') {
      throw new ConflictError('This invoice is already settled or voided.', 'INVOICE_ALREADY_PAID');
    }

    const sanitized = validateAndSanitizePaymentInput(input);
    const amountMinor = Math.max(1, invoice.totalMinor - invoice.paidMinor);
    const receiptTag = crypto.randomBytes(3).toString('hex');
    const nowIso = new Date().toISOString();

    const createdPayment = {
      id: crypto.randomUUID(),
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      idempotencyKey: input.idempotencyKey,
      amountMinor,
      currency: invoice.currency,
      method: input.method,
      gatewayProvider: sanitized.gatewayProvider,
      gatewayReference: sanitized.gatewayReference,
      cardBrand: sanitized.cardBrand,
      cardLast4: sanitized.cardLast4,
      bankName: sanitized.bankName,
      bankReference: sanitized.bankReference,
      status: sanitized.paymentStatus,
      receiptNumber: formatReceiptNumber(today, receiptTag),
      paidAt: nowIso,
    };

    state.payments.unshift(createdPayment);

    if (sanitized.paymentStatus === 'succeeded') {
      invoice.paidMinor = invoice.totalMinor;
      invoice.status = 'paid';
      invoice.paidAt = nowIso;
      state.subscription.status = 'active';
      state.subscription.currentPeriodStart = invoice.billingPeriodStart;
      state.subscription.currentPeriodEnd = invoice.billingPeriodEnd;
      state.subscription.nextBillingDate = invoice.billingPeriodEnd;
      if (input.method === 'card' && input.savePaymentMethod) {
        state.subscription.recurringToken = `tok_${crypto.randomBytes(6).toString('hex')}`;
        state.subscription.recurringTokenActive = true;
      }
    }

    if (input.savePaymentMethod) {
      state.subscription.paymentMethodType = input.method;
      state.subscription.paymentMethodLabel = sanitized.paymentMethodLabel;
    }

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action:
        sanitized.paymentStatus === 'succeeded'
          ? 'subscription.payment_succeeded'
          : 'subscription.payment_submitted_bank',
      entityType: 'subscription_payment',
      entityId: createdPayment.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: {
        invoiceNumber: invoice.invoiceNumber,
        amountMinor,
        method: input.method,
        receiptNumber: createdPayment.receiptNumber,
      },
    });

    const { idempotencyKey: _ignored, ...payment } = createdPayment;
    return { overview: await getSubscriptionOverview(context), payment };
  }

  const sanitized = validateAndSanitizePaymentInput(input);

  const createdPayment = await db.transaction(async (tx) => {
    const [existingPay] = await tx
      .select()
      .from(subscriptionPayments)
      .where(
        and(
          eq(subscriptionPayments.tenantId, context.tenantId),
          eq(subscriptionPayments.idempotencyKey, input.idempotencyKey)
        )
      )
      .limit(1);

    if (existingPay) {
      const [inv] = await tx
        .select({ invoiceNumber: subscriptionInvoices.invoiceNumber })
        .from(subscriptionInvoices)
        .where(eq(subscriptionInvoices.id, existingPay.invoiceId))
        .limit(1);
      return {
        id: existingPay.id,
        invoiceId: existingPay.invoiceId,
        invoiceNumber: inv?.invoiceNumber ?? '',
        amountMinor: existingPay.amountMinor,
        currency: existingPay.currency,
        method: existingPay.method as SubscriptionPaymentItem['method'],
        gatewayProvider: existingPay.gatewayProvider,
        gatewayReference: existingPay.gatewayReference,
        cardBrand: existingPay.cardBrand,
        cardLast4: existingPay.cardLast4,
        bankName: existingPay.bankName,
        bankReference: existingPay.bankReference,
        status: existingPay.status as SubscriptionPaymentItem['status'],
        receiptNumber: existingPay.receiptNumber,
        paidAt: existingPay.paidAt.toISOString(),
      };
    }

    const [invoice] = await tx
      .select()
      .from(subscriptionInvoices)
      .where(
        and(
          eq(subscriptionInvoices.id, input.invoiceId),
          eq(subscriptionInvoices.tenantId, context.tenantId)
        )
      )
      .limit(1);

    if (!invoice) {
      throw new NotFoundError('Subscription invoice not found');
    }
    if (invoice.status === 'paid' || invoice.status === 'void') {
      throw new ConflictError('This invoice is already settled or voided.', 'INVOICE_ALREADY_PAID');
    }

    const amountMinor = Math.max(1, invoice.totalMinor - invoice.paidMinor);
    const receiptNumber = formatReceiptNumber(today, crypto.randomBytes(3).toString('hex'));
    const now = new Date();

    const [payRow] = await tx
      .insert(subscriptionPayments)
      .values({
        tenantId: context.tenantId,
        invoiceId: invoice.id,
        idempotencyKey: input.idempotencyKey,
        amountMinor,
        currency: invoice.currency,
        method: input.method,
        gatewayProvider: sanitized.gatewayProvider,
        gatewayReference: sanitized.gatewayReference,
        cardBrand: sanitized.cardBrand,
        cardLast4: sanitized.cardLast4,
        bankName: sanitized.bankName,
        bankReference: sanitized.bankReference,
        status: sanitized.paymentStatus,
        receiptNumber,
        paidByUserId: context.userId,
        paidAt: now,
        metadataJson: {
          correlationId,
          invoiceNumber: invoice.invoiceNumber,
        },
      })
      .returning();

    if (sanitized.paymentStatus === 'succeeded') {
      await tx
        .update(subscriptionInvoices)
        .set({
          paidMinor: invoice.totalMinor,
          status: 'paid',
          paidAt: now,
        })
        .where(eq(subscriptionInvoices.id, invoice.id));

      await tx
        .update(tenantSubscriptions)
        .set({
          status: 'active',
          currentPeriodStart: invoice.billingPeriodStart,
          currentPeriodEnd: invoice.billingPeriodEnd,
          nextBillingDate: invoice.billingPeriodEnd,
          ...(input.savePaymentMethod
            ? {
                paymentMethodType: input.method,
                paymentMethodLabel: sanitized.paymentMethodLabel,
                ...(input.method === 'card'
                  ? { recurringToken: `tok_${crypto.randomBytes(6).toString('hex')}` }
                  : {}),
              }
            : {}),
          updatedAt: now,
        })
        .where(eq(tenantSubscriptions.id, invoice.subscriptionId));
    } else if (input.savePaymentMethod) {
      await tx
        .update(tenantSubscriptions)
        .set({
          paymentMethodType: input.method,
          paymentMethodLabel: sanitized.paymentMethodLabel,
          updatedAt: now,
        })
        .where(eq(tenantSubscriptions.id, invoice.subscriptionId));
    }

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action:
        sanitized.paymentStatus === 'succeeded'
          ? 'subscription.payment_succeeded'
          : 'subscription.payment_submitted_bank',
      entityType: 'subscription_payment',
      entityId: payRow.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: {
        invoiceNumber: invoice.invoiceNumber,
        amountMinor,
        method: input.method,
        receiptNumber,
      },
    });

    return {
      id: payRow.id,
      invoiceId: payRow.invoiceId,
      invoiceNumber: invoice.invoiceNumber,
      amountMinor: payRow.amountMinor,
      currency: payRow.currency,
      method: payRow.method as SubscriptionPaymentItem['method'],
      gatewayProvider: payRow.gatewayProvider,
      gatewayReference: payRow.gatewayReference,
      cardBrand: payRow.cardBrand,
      cardLast4: payRow.cardLast4,
      bankName: payRow.bankName,
      bankReference: payRow.bankReference,
      status: payRow.status as SubscriptionPaymentItem['status'],
      receiptNumber: payRow.receiptNumber,
      paidAt: payRow.paidAt.toISOString(),
    };
  });

  const overview = await getSubscriptionOverview(context);
  return { overview, payment: createdPayment };
}

export async function confirmBankTransferPayment(
  context: ActiveWorkspaceContext,
  paymentId: string,
  correlationId: string
): Promise<TenantSubscriptionOverview> {
  assertPermission(context, 'billing.manage');

  if (!isDatabaseConfigured) {
    const state = ensureMemoryBillingState(context.tenantId, context.productMode, context.timezone);
    const pay = state.payments.find((p) => p.id === paymentId);
    if (!pay) {
      throw new NotFoundError('Subscription payment not found');
    }
    if (pay.status === 'succeeded') {
      return getSubscriptionOverview(context);
    }

    pay.status = 'succeeded';
    const inv = state.invoices.find((i) => i.id === pay.invoiceId);
    if (inv) {
      inv.paidMinor = inv.totalMinor;
      inv.status = 'paid';
      inv.paidAt = new Date().toISOString();
      state.subscription.status = 'active';
      state.subscription.currentPeriodStart = inv.billingPeriodStart;
      state.subscription.currentPeriodEnd = inv.billingPeriodEnd;
      state.subscription.nextBillingDate = inv.billingPeriodEnd;
    }

    return getSubscriptionOverview(context);
  }

  await db.transaction(async (tx) => {
    const [pay] = await tx
      .select()
      .from(subscriptionPayments)
      .where(
        and(
          eq(subscriptionPayments.id, paymentId),
          eq(subscriptionPayments.tenantId, context.tenantId)
        )
      )
      .limit(1);

    if (!pay) {
      throw new NotFoundError('Subscription payment not found');
    }
    if (pay.status === 'succeeded') {
      return;
    }

    const [inv] = await tx
      .select()
      .from(subscriptionInvoices)
      .where(
        and(
          eq(subscriptionInvoices.id, pay.invoiceId),
          eq(subscriptionInvoices.tenantId, context.tenantId)
        )
      )
      .limit(1);

    const now = new Date();
    await tx
      .update(subscriptionPayments)
      .set({ status: 'succeeded' })
      .where(eq(subscriptionPayments.id, pay.id));

    if (inv) {
      await tx
        .update(subscriptionInvoices)
        .set({ paidMinor: inv.totalMinor, status: 'paid', paidAt: now })
        .where(eq(subscriptionInvoices.id, inv.id));

      await tx
        .update(tenantSubscriptions)
        .set({
          status: 'active',
          currentPeriodStart: inv.billingPeriodStart,
          currentPeriodEnd: inv.billingPeriodEnd,
          nextBillingDate: inv.billingPeriodEnd,
          updatedAt: now,
        })
        .where(eq(tenantSubscriptions.id, inv.subscriptionId));
    }

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'subscription.bank_transfer_confirmed',
      entityType: 'subscription_payment',
      entityId: pay.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: {
        receiptNumber: pay.receiptNumber,
        amountMinor: pay.amountMinor,
      },
    });
  });

  return getSubscriptionOverview(context);
}
