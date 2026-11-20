import crypto from 'node:crypto';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db, isDatabaseConfigured } from '../db/index.ts';
import {
  appointmentQueueTokens,
  appointments,
  auditEvents,
  branches,
  coldChainLogs,
  complianceLicenses,
  inventoryBalances,
  operatingExpenses,
  ownerBriefings,
  packVariants,
  people,
  posSales,
  products,
  purchaseOrderLines,
  purchaseOrders,
  resources,
  services,
  shiftChecklistRuns,
  stockMovements,
  suppliers,
  tenants,
  workspaceGovernanceRules,
} from '../db/schema.ts';
import type {
  AutopilotAnomalyItem,
  AutopilotCockpitResponse,
  CompleteShiftChecklistInput,
  PublicKioskInfoResponse,
  PublicSelfCheckInInput,
  PublicSelfCheckInResponse,
  ShiftChecklistRunView,
  SmartReorderSuggestionItem,
  ToggleChecklistItemInput,
  UpdateGovernanceRulesInput,
  WorkspaceGovernanceRuleView,
} from '../contracts/api.ts';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
} from './errors.ts';
import {
  addMemAuditEvent,
  getMemoryStore,
  type MemChecklistItemRecord,
} from './memory-store.ts';
import { sendNotificationDispatch } from './notifications.ts';
import { getPharmacyAlertsDashboard, getCombinedZReport } from './pharmacy-ops.ts';
import { assertWorkspaceNotReadOnlyGrace } from './subscription-billing.ts';
import { verifyStaffShiftPin } from './team-ops.ts';
import {
  assertPermission,
  getBusinessDateInTimezone,
  type ActiveWorkspaceContext,
} from './tenancy.ts';

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizePhoneLast4(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : digits;
}

function buildDefaultChecklistItems(
  shiftType: 'opening' | 'closing',
  hasClinic: boolean,
  hasPharmacy: boolean
): MemChecklistItemRecord[] {
  const items: MemChecklistItemRecord[] = [];
  if (shiftType === 'opening') {
    items.push({
      key: 'open_cash_float',
      labelEn: 'Count & verify opening cash drawer float (LKR)',
      labelSi: 'ආරම්භක මුදල් ලාච්චුවේ ශේෂය (Float) ගණන් කර තහවුරු කරන්න',
      category: 'cash',
      required: true,
      completed: false,
      completedByName: '',
      completedAt: null,
    });
    if (hasPharmacy) {
      items.push(
        {
          key: 'open_cold_chain',
          labelEn: 'Log morning vaccine/insulin fridge temperature (2°C – 8°C)',
          labelSi: 'ශීතකරණ උෂ්ණත්වය (2°C – 8°C) උදෑසන සටහන් කරන්න',
          category: 'safety',
          required: true,
          completed: false,
          completedByName: '',
          completedAt: null,
        },
        {
          key: 'open_pos_sync',
          labelEn: 'Verify barcode scanner, thermal printer & offline POS snapshot',
          labelSi: 'බාර්කෝඩ් ස්කෑනරය, තර්මල් ප්‍රින්ටරය සහ POS පද්ධතිය පරීක්ෂා කරන්න',
          category: 'pharmacy',
          required: true,
          completed: false,
          completedByName: '',
          completedAt: null,
        }
      );
    }
    if (hasClinic) {
      items.push({
        key: 'open_queue_kiosk',
        labelEn: 'Confirm doctor roster & enable Patient QR Check-In Kiosk',
        labelSi: 'වෛද්‍ය කාලසටහන සහ රෝගී QR කියෝස්ක් පුවරුව පරීක්ෂා කරන්න',
        category: 'clinic',
        required: true,
        completed: false,
        completedByName: '',
        completedAt: null,
      });
    }
    items.push({
      key: 'open_staff_attendance',
      labelEn: 'Confirm active staff clocked in with Shift PIN',
      labelSi: 'සේවකයින් Shift PIN හරහා Clock-In වී ඇති බව තහවුරු කරන්න',
      category: 'safety',
      required: false,
      completed: false,
      completedByName: '',
      completedAt: null,
    });
  } else {
    items.push({
      key: 'close_till_reconcile',
      labelEn: 'Count physical cash drawer & close active Till Shift',
      labelSi: 'දවස අවසානයේ මුදල් ගණන් කර Till Shift එක වසන්න',
      category: 'cash',
      required: true,
      completed: false,
      completedByName: '',
      completedAt: null,
    });
    if (hasPharmacy) {
      items.push(
        {
          key: 'close_expiry_quarantine',
          labelEn: 'Move any expired / damaged units into Quarantine Cage',
          labelSi: 'කල් ඉකුත් වූ හෝ හානි වූ ඖෂධ Quarantine වෙත මාරු කරන්න',
          category: 'safety',
          required: true,
          completed: false,
          completedByName: '',
          completedAt: null,
        },
        {
          key: 'close_cold_chain',
          labelEn: 'Record evening fridge temperature & lock dangerous drug cabinet',
          labelSi: 'සවස ශීතකරණ උෂ්ණත්වය සටහන් කර ඖෂධ කබඩ් අගුළු දමන්න',
          category: 'safety',
          required: true,
          completed: false,
          completedByName: '',
          completedAt: null,
        }
      );
    }
    if (hasClinic) {
      items.push({
        key: 'close_doctor_payout',
        labelEn: 'Settle daily doctor channeling payouts & finalize pending tokens',
        labelSi: 'වෛද්‍ය ගෙවීම් (Doctor Payouts) සහ පෝලිම් ටෝකන් අවසන් කරන්න',
        category: 'clinic',
        required: true,
        completed: false,
        completedByName: '',
        completedAt: null,
      });
    }
    items.push({
      key: 'close_z_briefing',
      labelEn: 'Generate Z-Report & send Owner Daily WhatsApp Briefing',
      labelSi: 'Z-Report පරීක්ෂා කර හිමිකරුගේ දෛනික වාර්තාව යවන්න',
      category: 'cash',
      required: true,
      completed: false,
      completedByName: '',
      completedAt: null,
    });
  }
  return items;
}

const DEFAULT_GOVERNANCE_VALUES = {
  maxCashierDiscountPercent: 10,
  maxExpenseWithoutPinMinor: 1_500_000, // Rs 15,000
  maxStockWriteoffWithoutPin: 25,
  requireClosingChecklist: false,
  autoReorderEnabled: true,
  ownerDigestEnabled: true,
  ownerWhatsappPhone: '',
};

// ---------------------------------------------------------------------------
// 1. Maker-Checker Governance Rules & PIN Enforcement
// ---------------------------------------------------------------------------
export async function getGovernanceRules(
  context: ActiveWorkspaceContext
): Promise<WorkspaceGovernanceRuleView> {
  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const existing = store.governanceRules.find((g) => g.tenantId === context.tenantId);
    if (existing) {
      return {
        maxCashierDiscountPercent: existing.maxCashierDiscountPercent,
        maxExpenseWithoutPinMinor: existing.maxExpenseWithoutPinMinor,
        maxStockWriteoffWithoutPin: existing.maxStockWriteoffWithoutPin,
        requireClosingChecklist: existing.requireClosingChecklist,
        autoReorderEnabled: existing.autoReorderEnabled,
        ownerDigestEnabled: existing.ownerDigestEnabled,
        ownerWhatsappPhone: existing.ownerWhatsappPhone,
        updatedAt: existing.updatedAt.toISOString(),
      };
    }
    const now = new Date();
    const created = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      ...DEFAULT_GOVERNANCE_VALUES,
      updatedAt: now,
    };
    store.governanceRules.push(created);
    return {
      ...DEFAULT_GOVERNANCE_VALUES,
      updatedAt: now.toISOString(),
    };
  }

  const [existing] = await db
    .select()
    .from(workspaceGovernanceRules)
    .where(eq(workspaceGovernanceRules.tenantId, context.tenantId))
    .limit(1);

  if (existing) {
    return {
      maxCashierDiscountPercent: existing.maxCashierDiscountPercent,
      maxExpenseWithoutPinMinor: existing.maxExpenseWithoutPinMinor,
      maxStockWriteoffWithoutPin: existing.maxStockWriteoffWithoutPin,
      requireClosingChecklist: existing.requireClosingChecklist,
      autoReorderEnabled: existing.autoReorderEnabled,
      ownerDigestEnabled: existing.ownerDigestEnabled,
      ownerWhatsappPhone: existing.ownerWhatsappPhone,
      updatedAt: existing.updatedAt.toISOString(),
    };
  }

  const [inserted] = await db
    .insert(workspaceGovernanceRules)
    .values({
      tenantId: context.tenantId,
      ...DEFAULT_GOVERNANCE_VALUES,
    })
    .onConflictDoNothing()
    .returning();

  const row =
    inserted ??
    (
      await db
        .select()
        .from(workspaceGovernanceRules)
        .where(eq(workspaceGovernanceRules.tenantId, context.tenantId))
        .limit(1)
    )[0];

  return {
    maxCashierDiscountPercent: row.maxCashierDiscountPercent,
    maxExpenseWithoutPinMinor: row.maxExpenseWithoutPinMinor,
    maxStockWriteoffWithoutPin: row.maxStockWriteoffWithoutPin,
    requireClosingChecklist: row.requireClosingChecklist,
    autoReorderEnabled: row.autoReorderEnabled,
    ownerDigestEnabled: row.ownerDigestEnabled,
    ownerWhatsappPhone: row.ownerWhatsappPhone,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function updateGovernanceRules(
  context: ActiveWorkspaceContext,
  input: UpdateGovernanceRulesInput,
  correlationId: string
): Promise<WorkspaceGovernanceRuleView> {
  if (context.role !== 'owner' && context.role !== 'manager') {
    throw new ForbiddenError(
      'Only Owner or Manager can update workspace governance rules',
      'PERMISSION_DENIED'
    );
  }
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const existing = await getGovernanceRules(context);
  const now = new Date();
  const nextValues = {
    maxCashierDiscountPercent:
      input.maxCashierDiscountPercent ?? existing.maxCashierDiscountPercent,
    maxExpenseWithoutPinMinor:
      input.maxExpenseWithoutPinMinor ?? existing.maxExpenseWithoutPinMinor,
    maxStockWriteoffWithoutPin:
      input.maxStockWriteoffWithoutPin ?? existing.maxStockWriteoffWithoutPin,
    requireClosingChecklist: input.requireClosingChecklist ?? existing.requireClosingChecklist,
    autoReorderEnabled: input.autoReorderEnabled ?? existing.autoReorderEnabled,
    ownerDigestEnabled: input.ownerDigestEnabled ?? existing.ownerDigestEnabled,
    ownerWhatsappPhone:
      input.ownerWhatsappPhone !== undefined
        ? input.ownerWhatsappPhone.trim()
        : existing.ownerWhatsappPhone,
  };

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const rec = store.governanceRules.find((g) => g.tenantId === context.tenantId);
    if (rec) {
      Object.assign(rec, nextValues, { updatedAt: now });
    } else {
      store.governanceRules.push({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        ...nextValues,
        updatedAt: now,
      });
    }
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'governance.rules_updated',
      entityType: 'governance_rule',
      entityId: context.tenantId,
      correlationId,
      metadataJson: nextValues,
    });
    return { ...nextValues, updatedAt: now.toISOString() };
  }

  await db
    .insert(workspaceGovernanceRules)
    .values({ tenantId: context.tenantId, ...nextValues })
    .onConflictDoUpdate({
      target: workspaceGovernanceRules.tenantId,
      set: { ...nextValues, updatedAt: now },
    });

  await db.insert(auditEvents).values({
    tenantId: context.tenantId,
    actorUserId: context.userId,
    actorUid: context.uid,
    action: 'governance.rules_updated',
    entityType: 'governance_rule',
    entityId: context.tenantId,
    inputSource: 'ui',
    correlationId,
    metadataJson: nextValues,
  });

  return { ...nextValues, updatedAt: now.toISOString() };
}

export async function assertGovernancePinIfRequired(
  context: ActiveWorkspaceContext,
  check: {
    type: 'pos_discount' | 'opex';
    discountPercent?: number;
    amountMinor?: number;
    managerOverridePin?: string;
  },
  correlationId: string
): Promise<{ overrideRequired: boolean; approvedByName: string | null }> {
  if (context.role === 'owner') {
    return { overrideRequired: false, approvedByName: null };
  }

  const rules = await getGovernanceRules(context);
  let exceeded = false;
  let reason = '';

  if (
    check.type === 'pos_discount' &&
    (check.discountPercent ?? 0) > rules.maxCashierDiscountPercent
  ) {
    exceeded = true;
    reason = `Discount (${check.discountPercent}%) exceeds staff limit of ${rules.maxCashierDiscountPercent}%`;
  } else if (
    check.type === 'opex' &&
    (check.amountMinor ?? 0) > rules.maxExpenseWithoutPinMinor
  ) {
    exceeded = true;
    reason = `Expense Rs ${((check.amountMinor ?? 0) / 100).toFixed(2)} exceeds staff limit of Rs ${(rules.maxExpenseWithoutPinMinor / 100).toFixed(2)}`;
  }

  if (!exceeded) {
    return { overrideRequired: false, approvedByName: null };
  }

  const pin = check.managerOverridePin?.trim();
  if (!pin) {
    throw new ForbiddenError(
      `${reason}. Owner or Manager Shift PIN override is required.`,
      'GOVERNANCE_PIN_REQUIRED',
      'errors.governance_pin_required'
    );
  }

  const verified = await verifyStaffShiftPin(context, pin, correlationId);
  if (verified.role !== 'owner' && verified.role !== 'manager') {
    throw new ForbiddenError(
      'Override PIN belongs to a non-supervisor role. Owner or Manager Shift PIN is required.',
      'GOVERNANCE_PIN_REQUIRED',
      'errors.governance_pin_required'
    );
  }

  if (!isDatabaseConfigured) {
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'governance.override_verified',
      entityType: check.type,
      entityId: context.branchId,
      correlationId,
      metadataJson: {
        reason,
        approvedByUserId: verified.userId,
        approvedByName: verified.displayName,
        approvedByRole: verified.role,
      },
    });
  } else {
    await db.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'governance.override_verified',
      entityType: check.type,
      entityId: context.branchId,
      inputSource: 'ui',
      correlationId,
      metadataJson: {
        reason,
        approvedByUserId: verified.userId,
        approvedByName: verified.displayName,
        approvedByRole: verified.role,
      },
    });
  }

  return { overrideRequired: true, approvedByName: verified.displayName };
}

// ---------------------------------------------------------------------------
// 2. Opening & Closing Digital SOP Checklists & Handover
// ---------------------------------------------------------------------------
function toChecklistView(row: {
  id: string;
  businessDate: string;
  shiftType: 'opening' | 'closing';
  status: 'in_progress' | 'completed';
  itemsJson: MemChecklistItemRecord[];
  handoverNotes: string;
  cashDrawerCountMinor: number | null;
  completedByName: string;
  completedAt: Date | null;
}): ShiftChecklistRunView {
  const rawItems = Array.isArray(row.itemsJson) ? row.itemsJson : [];
  const items = rawItems.map((i) => ({
    key: i.key,
    labelEn: i.labelEn,
    labelSi: i.labelSi,
    category: i.category,
    required: i.required !== false,
    completed: Boolean(i.completed),
    completedByName: i.completedByName || '',
    completedAt: i.completedAt ?? null,
  }));
  const completedCount = items.filter((i) => i.completed).length;
  return {
    id: row.id,
    businessDate: row.businessDate,
    shiftType: row.shiftType,
    status: row.status,
    items,
    completedCount,
    totalCount: items.length,
    handoverNotes: row.handoverNotes || '',
    cashDrawerCountMinor: row.cashDrawerCountMinor ?? null,
    completedByName: row.completedByName || '',
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

export async function getOrCreateDailyChecklists(
  context: ActiveWorkspaceContext,
  requestedDate?: string
): Promise<{ opening: ShiftChecklistRunView; closing: ShiftChecklistRunView }> {
  const businessDate = requestedDate || getBusinessDateInTimezone(context.timezone);
  const hasClinic = Boolean(context.capabilities['appointments.manage']);
  const hasPharmacy = Boolean(
    context.capabilities['pharmacy.inventory'] || context.capabilities['pharmacy.pos']
  );

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const ensure = (shiftType: 'opening' | 'closing') => {
      let existing = store.shiftChecklistRuns.find(
        (r) =>
          r.tenantId === context.tenantId &&
          r.branchId === context.branchId &&
          r.businessDate === businessDate &&
          r.shiftType === shiftType
      );
      if (!existing) {
        const now = new Date();
        existing = {
          id: crypto.randomUUID(),
          tenantId: context.tenantId,
          branchId: context.branchId,
          businessDate,
          shiftType,
          status: 'in_progress',
          itemsJson: buildDefaultChecklistItems(shiftType, hasClinic, hasPharmacy),
          handoverNotes: '',
          cashDrawerCountMinor: null,
          completedByUserId: null,
          completedByName: '',
          completedAt: null,
          createdAt: now,
          updatedAt: now,
        };
        store.shiftChecklistRuns.push(existing);
      }
      return toChecklistView(existing);
    };
    return { opening: ensure('opening'), closing: ensure('closing') };
  }

  const rows = await db
    .select()
    .from(shiftChecklistRuns)
    .where(
      and(
        eq(shiftChecklistRuns.tenantId, context.tenantId),
        eq(shiftChecklistRuns.branchId, context.branchId),
        eq(shiftChecklistRuns.businessDate, businessDate)
      )
    );

  const ensureDb = async (shiftType: 'opening' | 'closing') => {
    const found = rows.find((r) => r.shiftType === shiftType);
    if (found) {
      return toChecklistView({
        id: found.id,
        businessDate: found.businessDate,
        shiftType: found.shiftType as 'opening' | 'closing',
        status: found.status as 'in_progress' | 'completed',
        itemsJson: (found.itemsJson ?? []) as MemChecklistItemRecord[],
        handoverNotes: found.handoverNotes,
        cashDrawerCountMinor: found.cashDrawerCountMinor,
        completedByName: found.completedByName,
        completedAt: found.completedAt,
      });
    }
    const items = buildDefaultChecklistItems(shiftType, hasClinic, hasPharmacy);
    const [inserted] = await db
      .insert(shiftChecklistRuns)
      .values({
        tenantId: context.tenantId,
        branchId: context.branchId,
        businessDate,
        shiftType,
        status: 'in_progress',
        itemsJson: items,
        handoverNotes: '',
      })
      .returning();
    return toChecklistView({
      id: inserted.id,
      businessDate: inserted.businessDate,
      shiftType: inserted.shiftType as 'opening' | 'closing',
      status: inserted.status as 'in_progress' | 'completed',
      itemsJson: (inserted.itemsJson ?? []) as MemChecklistItemRecord[],
      handoverNotes: inserted.handoverNotes,
      cashDrawerCountMinor: inserted.cashDrawerCountMinor,
      completedByName: inserted.completedByName,
      completedAt: inserted.completedAt,
    });
  };

  const [opening, closing] = await Promise.all([ensureDb('opening'), ensureDb('closing')]);
  return { opening, closing };
}

export async function toggleShiftChecklistItem(
  context: ActiveWorkspaceContext,
  checklistId: string,
  input: ToggleChecklistItemInput,
  actorDisplayName: string,
  correlationId: string
): Promise<ShiftChecklistRunView> {
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);
  const now = new Date();

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const run = store.shiftChecklistRuns.find(
      (r) =>
        r.id === checklistId &&
        r.tenantId === context.tenantId &&
        r.branchId === context.branchId
    );
    if (!run) throw new NotFoundError('Shift checklist not found');
    const target = run.itemsJson.find((i) => i.key === input.itemKey);
    if (!target) throw new NotFoundError('Checklist step not found');
    target.completed = input.completed;
    target.completedByName = input.completed ? actorDisplayName : '';
    target.completedAt = input.completed ? now.toISOString() : null;
    if (!input.completed && run.status === 'completed') {
      run.status = 'in_progress';
      run.completedAt = null;
    }
    run.updatedAt = now;
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'sop.checklist_item_toggled',
      entityType: 'shift_checklist',
      entityId: run.id,
      correlationId,
      metadataJson: {
        itemKey: input.itemKey,
        completed: input.completed,
        shiftType: run.shiftType,
      },
    });
    return toChecklistView(run);
  }

  const [run] = await db
    .select()
    .from(shiftChecklistRuns)
    .where(
      and(
        eq(shiftChecklistRuns.id, checklistId),
        eq(shiftChecklistRuns.tenantId, context.tenantId),
        eq(shiftChecklistRuns.branchId, context.branchId)
      )
    )
    .limit(1);

  if (!run) throw new NotFoundError('Shift checklist not found');
  const items = [...((run.itemsJson ?? []) as MemChecklistItemRecord[])];
  const idx = items.findIndex((i) => i.key === input.itemKey);
  if (idx === -1) throw new NotFoundError('Checklist step not found');

  items[idx] = {
    ...items[idx],
    completed: input.completed,
    completedByName: input.completed ? actorDisplayName : '',
    completedAt: input.completed ? now.toISOString() : null,
  };
  const nextStatus =
    !input.completed && run.status === 'completed' ? 'in_progress' : run.status;

  const [updated] = await db
    .update(shiftChecklistRuns)
    .set({
      itemsJson: items,
      status: nextStatus,
      completedAt: nextStatus === 'in_progress' ? null : run.completedAt,
      updatedAt: now,
    })
    .where(eq(shiftChecklistRuns.id, run.id))
    .returning();

  await db.insert(auditEvents).values({
    tenantId: context.tenantId,
    actorUserId: context.userId,
    actorUid: context.uid,
    action: 'sop.checklist_item_toggled',
    entityType: 'shift_checklist',
    entityId: run.id,
    inputSource: 'ui',
    correlationId,
    metadataJson: {
      itemKey: input.itemKey,
      completed: input.completed,
      shiftType: run.shiftType,
    },
  });

  return toChecklistView({
    id: updated.id,
    businessDate: updated.businessDate,
    shiftType: updated.shiftType as 'opening' | 'closing',
    status: updated.status as 'in_progress' | 'completed',
    itemsJson: (updated.itemsJson ?? []) as MemChecklistItemRecord[],
    handoverNotes: updated.handoverNotes,
    cashDrawerCountMinor: updated.cashDrawerCountMinor,
    completedByName: updated.completedByName,
    completedAt: updated.completedAt,
  });
}

export async function completeShiftChecklist(
  context: ActiveWorkspaceContext,
  checklistId: string,
  input: CompleteShiftChecklistInput,
  correlationId: string,
  actorDisplayName = 'Shift Supervisor'
): Promise<ShiftChecklistRunView> {
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);
  const now = new Date();
  const cashDrawerCountMinor =
    input.cashDrawerCountLkr !== undefined && input.cashDrawerCountLkr !== null
      ? Math.round(input.cashDrawerCountLkr * 100)
      : null;

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const run = store.shiftChecklistRuns.find(
      (r) =>
        r.id === checklistId &&
        r.tenantId === context.tenantId &&
        r.branchId === context.branchId
    );
    if (!run) throw new NotFoundError('Shift checklist not found');
    const incompleteRequired = run.itemsJson.filter((i) => i.required !== false && !i.completed);
    if (incompleteRequired.length > 0) {
      throw new ConflictError(
        `Complete all mandatory SOP steps first (${incompleteRequired.length} remaining: ${incompleteRequired[0].labelEn}).`,
        'SOP_STEPS_INCOMPLETE'
      );
    }
    run.status = 'completed';
    run.handoverNotes = (input.handoverNotes || '').trim();
    run.cashDrawerCountMinor = cashDrawerCountMinor;
    run.completedByUserId = context.userId;
    run.completedByName = actorDisplayName;
    run.completedAt = now;
    run.updatedAt = now;
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: `sop.${run.shiftType}_shift_signed_off`,
      entityType: 'shift_checklist',
      entityId: run.id,
      correlationId,
      metadataJson: {
        businessDate: run.businessDate,
        cashDrawerCountMinor,
        handoverNotes: run.handoverNotes,
      },
    });
    return toChecklistView(run);
  }

  const [run] = await db
    .select()
    .from(shiftChecklistRuns)
    .where(
      and(
        eq(shiftChecklistRuns.id, checklistId),
        eq(shiftChecklistRuns.tenantId, context.tenantId),
        eq(shiftChecklistRuns.branchId, context.branchId)
      )
    )
    .limit(1);

  if (!run) throw new NotFoundError('Shift checklist not found');
  const items = (run.itemsJson ?? []) as MemChecklistItemRecord[];
  const incompleteRequired = items.filter((i) => i.required !== false && !i.completed);
  if (incompleteRequired.length > 0) {
    throw new ConflictError(
      `Complete all mandatory SOP steps first (${incompleteRequired.length} remaining: ${incompleteRequired[0].labelEn}).`,
      'SOP_STEPS_INCOMPLETE'
    );
  }

  const [updated] = await db
    .update(shiftChecklistRuns)
    .set({
      status: 'completed',
      handoverNotes: (input.handoverNotes || '').trim(),
      cashDrawerCountMinor,
      completedByUserId: context.userId,
      completedByName: actorDisplayName,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(shiftChecklistRuns.id, run.id))
    .returning();

  await db.insert(auditEvents).values({
    tenantId: context.tenantId,
    actorUserId: context.userId,
    actorUid: context.uid,
    action: `sop.${run.shiftType}_shift_signed_off`,
    entityType: 'shift_checklist',
    entityId: run.id,
    inputSource: 'ui',
    correlationId,
    metadataJson: {
      businessDate: run.businessDate,
      cashDrawerCountMinor,
      handoverNotes: updated.handoverNotes,
    },
  });

  return toChecklistView({
    id: updated.id,
    businessDate: updated.businessDate,
    shiftType: updated.shiftType as 'opening' | 'closing',
    status: updated.status as 'in_progress' | 'completed',
    itemsJson: (updated.itemsJson ?? []) as MemChecklistItemRecord[],
    handoverNotes: updated.handoverNotes,
    cashDrawerCountMinor: updated.cashDrawerCountMinor,
    completedByName: updated.completedByName,
    completedAt: updated.completedAt,
  });
}

// ---------------------------------------------------------------------------
// 3. Smart Auto-Reorder Engine (30-Day Velocity + Supplier-Grouped Draft PO)
// ---------------------------------------------------------------------------
export async function getSmartReorderSuggestions(
  context: ActiveWorkspaceContext
): Promise<SmartReorderSuggestionItem[]> {
  const hasPharmacy = Boolean(
    context.capabilities['pharmacy.inventory'] || context.capabilities['pharmacy.pos']
  );
  if (!hasPharmacy) return [];

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const tenantProducts = store.products.filter(
      (p) => p.tenantId === context.tenantId && p.active
    );
    const activeSuppliers = store.suppliers.filter(
      (s) => s.tenantId === context.tenantId && s.status === 'approved'
    );
    const defaultSupplier = activeSuppliers[0] ?? null;

    const productSupplierMap = new Map<string, { id: string; name: string; costMinor: number }>();
    for (const grn of store.goodsReceipts.filter((g) => g.tenantId === context.tenantId)) {
      const sup = activeSuppliers.find((s) => s.id === grn.supplierId);
      if (!sup) continue;
      for (const gl of store.goodsReceiptLines.filter((l) => l.goodsReceiptId === grn.id)) {
        if (!productSupplierMap.has(gl.productId)) {
          productSupplierMap.set(gl.productId, {
            id: sup.id,
            name: sup.name,
            costMinor: gl.unitPackCostMinor,
          });
        }
      }
    }

    const suggestions: SmartReorderSuggestionItem[] = [];
    for (const p of tenantProducts) {
      const sellableOnHand = store.inventoryBalances
        .filter(
          (b) =>
            b.tenantId === context.tenantId &&
            b.branchId === context.branchId &&
            b.productId === p.id
        )
        .reduce((acc, b) => acc + Math.max(0, b.sellableOnHand - b.reservedQty), 0);

      const sales30dBase = store.stockMovements
        .filter(
          (m) =>
            m.tenantId === context.tenantId &&
            m.branchId === context.branchId &&
            m.productId === p.id &&
            m.movementType === 'pos_sale' &&
            m.occurredAt >= thirtyDaysAgo
        )
        .reduce((acc, m) => acc + Math.abs(m.qtyBase), 0);

      const avgDailyUsage = Number((sales30dBase / 30).toFixed(2));
      const configuredReorder = p.reorderPointBase ?? 50;
      const configuredPar = p.targetParBase ?? 200;
      const dynamicReorderPoint = Math.max(configuredReorder, Math.ceil(avgDailyUsage * 7));
      const targetParBase = Math.max(
        configuredPar,
        dynamicReorderPoint * 2,
        Math.ceil(avgDailyUsage * 21)
      );

      if (sellableOnHand < dynamicReorderPoint) {
        const suggestedOrderBase = Math.max(1, targetParBase - sellableOnHand);
        const primaryPack =
          store.packVariants.find((v) => v.productId === p.id && v.active) ?? null;
        const basePerPack = Math.max(1, primaryPack?.currentBaseQty ?? 1);
        const suggestedOrderPacks = Math.max(1, Math.ceil(suggestedOrderBase / basePerPack));
        const supInfo = productSupplierMap.get(p.id);
        const estimatedPackCostMinor =
          supInfo?.costMinor ??
          Math.max(100, Math.round((primaryPack?.defaultSalePriceMinor ?? 5000) * 0.72));

        suggestions.push({
          productId: p.id,
          skuCode: p.skuCode,
          productName: p.displayName,
          baseUnit: p.baseUnit,
          sellableOnHand,
          avgDailyUsage,
          dynamicReorderPoint,
          targetParBase,
          suggestedOrderBase,
          preferredSupplierId: supInfo?.id ?? defaultSupplier?.id ?? null,
          preferredSupplierName: supInfo?.name ?? defaultSupplier?.name ?? 'Default Supplier',
          packVariantId: primaryPack?.id ?? null,
          variantName: primaryPack?.variantName ?? p.baseUnit,
          packUnit: primaryPack?.packUnit ?? p.baseUnit,
          suggestedOrderPacks,
          estimatedPackCostMinor,
        });
      }
    }

    return suggestions.sort(
      (a, b) =>
        a.sellableOnHand / Math.max(1, a.dynamicReorderPoint) -
        b.sellableOnHand / Math.max(1, b.dynamicReorderPoint)
    );
  }

  const [prodRows, balRows, packRows, movRows, supRows] = await Promise.all([
    db
      .select()
      .from(products)
      .where(and(eq(products.tenantId, context.tenantId), eq(products.active, true))),
    db
      .select()
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, context.tenantId),
          eq(inventoryBalances.branchId, context.branchId)
        )
      ),
    db
      .select()
      .from(packVariants)
      .where(and(eq(packVariants.tenantId, context.tenantId), eq(packVariants.active, true))),
    db
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.tenantId, context.tenantId),
          eq(stockMovements.branchId, context.branchId),
          eq(stockMovements.movementType, 'pos_sale'),
          gte(stockMovements.occurredAt, thirtyDaysAgo)
        )
      ),
    db
      .select()
      .from(suppliers)
      .where(and(eq(suppliers.tenantId, context.tenantId), eq(suppliers.status, 'approved'))),
  ]);

  const defaultSupplier = supRows[0] ?? null;
  const suggestions: SmartReorderSuggestionItem[] = [];

  for (const p of prodRows) {
    const sellableOnHand = balRows
      .filter((b) => b.productId === p.id)
      .reduce((acc, b) => acc + Math.max(0, b.sellableOnHand - b.reservedQty), 0);

    const sales30dBase = movRows
      .filter((m) => m.productId === p.id)
      .reduce((acc, m) => acc + Math.abs(m.qtyBase), 0);

    const avgDailyUsage = Number((sales30dBase / 30).toFixed(2));
    const configuredReorder = p.reorderPointBase ?? 50;
    const configuredPar = p.targetParBase ?? 200;
    const dynamicReorderPoint = Math.max(configuredReorder, Math.ceil(avgDailyUsage * 7));
    const targetParBase = Math.max(
      configuredPar,
      dynamicReorderPoint * 2,
      Math.ceil(avgDailyUsage * 21)
    );

    if (sellableOnHand < dynamicReorderPoint) {
      const suggestedOrderBase = Math.max(1, targetParBase - sellableOnHand);
      const primaryPack = packRows.find((v) => v.productId === p.id) ?? null;
      const basePerPack = Math.max(1, primaryPack?.currentBaseQty ?? 1);
      const suggestedOrderPacks = Math.max(1, Math.ceil(suggestedOrderBase / basePerPack));
      const estimatedPackCostMinor = Math.max(
        100,
        Math.round((primaryPack?.defaultSalePriceMinor ?? 5000) * 0.72)
      );

      suggestions.push({
        productId: p.id,
        skuCode: p.skuCode,
        productName: p.displayName,
        baseUnit: p.baseUnit,
        sellableOnHand,
        avgDailyUsage,
        dynamicReorderPoint,
        targetParBase,
        suggestedOrderBase,
        preferredSupplierId: defaultSupplier?.id ?? null,
        preferredSupplierName: defaultSupplier?.name ?? 'Default Supplier',
        packVariantId: primaryPack?.id ?? null,
        variantName: primaryPack?.variantName ?? p.baseUnit,
        packUnit: primaryPack?.packUnit ?? p.baseUnit,
        suggestedOrderPacks,
        estimatedPackCostMinor,
      });
    }
  }

  return suggestions.sort(
    (a, b) =>
      a.sellableOnHand / Math.max(1, a.dynamicReorderPoint) -
      b.sellableOnHand / Math.max(1, b.dynamicReorderPoint)
  );
}

export async function generateAutoDraftPurchaseOrders(
  context: ActiveWorkspaceContext,
  correlationId: string
): Promise<{
  createdCount: number;
  purchaseOrders: Array<{
    id: string;
    poNumber: string;
    supplierName: string;
    totalEstimatedMinor: number;
    lineCount: number;
  }>;
}> {
  assertPermission(context, 'purchasing.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const suggestions = await getSmartReorderSuggestions(context);
  const eligible = suggestions.filter(
    (s) => s.preferredSupplierId && s.packVariantId && s.suggestedOrderPacks > 0
  );
  if (eligible.length === 0) {
    throw new ConflictError(
      'No low-stock SKUs with linked supplier and pack variant require auto-reordering right now.',
      'NO_REORDER_ITEMS'
    );
  }

  const bySupplier = new Map<string, SmartReorderSuggestionItem[]>();
  for (const s of eligible) {
    const key = s.preferredSupplierId!;
    const list = bySupplier.get(key) ?? [];
    list.push(s);
    bySupplier.set(key, list);
  }

  const businessDate = getBusinessDateInTimezone(context.timezone);
  const createdSummaries: Array<{
    id: string;
    poNumber: string;
    supplierName: string;
    totalEstimatedMinor: number;
    lineCount: number;
  }> = [];

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    for (const [supplierId, lines] of bySupplier.entries()) {
      const poNumber = `PO-AUTO-${businessDate.replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const totalEstimatedMinor = lines.reduce(
        (sum, l) => sum + l.suggestedOrderPacks * l.estimatedPackCostMinor,
        0
      );
      const po = {
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        branchId: context.branchId,
        supplierId,
        poNumber,
        status: 'draft' as const,
        expectedDate: businessDate,
        notes: 'Auto-generated from Smart Par-Level Reorder Engine',
        totalEstimatedMinor,
        approvedByUserId: null,
        approvedAt: null,
        convertedGrnId: null,
        createdByUserId: context.userId,
        createdAt: new Date(),
      };
      store.purchaseOrders.unshift(po);

      for (const l of lines) {
        store.purchaseOrderLines.push({
          id: crypto.randomUUID(),
          tenantId: context.tenantId,
          purchaseOrderId: po.id,
          productId: l.productId,
          packVariantId: l.packVariantId!,
          orderedPacks: l.suggestedOrderPacks,
          estimatedUnitPackCostMinor: l.estimatedPackCostMinor,
        });
      }

      addMemAuditEvent({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorUid: context.uid,
        action: 'purchasing.auto_draft_po_created',
        entityType: 'purchase_order',
        entityId: po.id,
        correlationId,
        metadataJson: { poNumber, supplierId, lineCount: lines.length, totalEstimatedMinor },
      });

      createdSummaries.push({
        id: po.id,
        poNumber,
        supplierName: lines[0].preferredSupplierName,
        totalEstimatedMinor,
        lineCount: lines.length,
      });
    }
    return { createdCount: createdSummaries.length, purchaseOrders: createdSummaries };
  }

  await db.transaction(async (tx) => {
    for (const [supplierId, lines] of bySupplier.entries()) {
      const poNumber = `PO-AUTO-${businessDate.replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
      const totalEstimatedMinor = lines.reduce(
        (sum, l) => sum + l.suggestedOrderPacks * l.estimatedPackCostMinor,
        0
      );
      const [po] = await tx
        .insert(purchaseOrders)
        .values({
          tenantId: context.tenantId,
          branchId: context.branchId,
          supplierId,
          poNumber,
          status: 'draft',
          expectedDate: businessDate,
          notes: 'Auto-generated from Smart Par-Level Reorder Engine',
          totalEstimatedMinor,
          createdByUserId: context.userId,
        })
        .returning();

      await tx.insert(purchaseOrderLines).values(
        lines.map((l) => ({
          tenantId: context.tenantId,
          purchaseOrderId: po.id,
          productId: l.productId,
          packVariantId: l.packVariantId!,
          orderedPacks: l.suggestedOrderPacks,
          estimatedUnitPackCostMinor: l.estimatedPackCostMinor,
        }))
      );

      await tx.insert(auditEvents).values({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorUid: context.uid,
        action: 'purchasing.auto_draft_po_created',
        entityType: 'purchase_order',
        entityId: po.id,
        inputSource: 'ui',
        correlationId,
        metadataJson: { poNumber, supplierId, lineCount: lines.length, totalEstimatedMinor },
      });

      createdSummaries.push({
        id: po.id,
        poNumber,
        supplierName: lines[0].preferredSupplierName,
        totalEstimatedMinor,
        lineCount: lines.length,
      });
    }
  });

  return { createdCount: createdSummaries.length, purchaseOrders: createdSummaries };
}

// ---------------------------------------------------------------------------
// 4. Anomaly & Fraud Guard Scanner
// ---------------------------------------------------------------------------
export async function scanWorkspaceAnomalies(
  context: ActiveWorkspaceContext,
  requestedDate?: string
): Promise<AutopilotAnomalyItem[]> {
  const businessDate = requestedDate || getBusinessDateInTimezone(context.timezone);
  const anomalies: AutopilotAnomalyItem[] = [];
  const rules = await getGovernanceRules(context);
  const hasPharmacy = Boolean(
    context.capabilities['pharmacy.inventory'] || context.capabilities['pharmacy.pos']
  );

  let zReport = null;
  try {
    zReport = await getCombinedZReport(context, businessDate);
  } catch {
    zReport = null;
  }

  if (zReport && Math.abs(zReport.pharmacy.tillVarianceMinor) > 50_000) {
    const varianceLkr = (zReport.pharmacy.tillVarianceMinor / 100).toFixed(2);
    anomalies.push({
      id: `till-variance-${businessDate}`,
      code: 'TILL_VARIANCE',
      severity: 'critical',
      category: 'till_variance',
      titleEn: 'Cash Till Variance Detected (> LKR 500)',
      titleSi: 'මුදල් ලාච්චු වෙනසක් (Till Variance > LKR 500) හඳුනා ගන්නා ලදී',
      detail: `Branch till shift variance is LKR ${varianceLkr} on ${businessDate}. Verify physical drawer & Z-Report.`,
      metricValue: `LKR ${varianceLkr}`,
      actionPath: '/pharmacy/pos',
    });
  }

  if (hasPharmacy) {
    try {
      const stockAlerts = await getPharmacyAlertsDashboard(context);
      if (stockAlerts.summary.expiredCount > 0) {
        anomalies.push({
          id: `expired-stock-${businessDate}`,
          code: 'EXPIRED_SELLABLE_STOCK',
          severity: 'critical',
          category: 'expiry',
          titleEn: `${stockAlerts.summary.expiredCount} Expired Batch(es) Still in Sellable Stock`,
          titleSi: `කල් ඉකුත් වූ බෙහෙත් තොග ${stockAlerts.summary.expiredCount}ක් තවමත් විකුණුම් අංශයේ ඇත`,
          detail: 'Move expired batches immediately to Quarantine Cage to prevent unsafe dispensing.',
          metricValue: `${stockAlerts.summary.expiredCount} batch(es)`,
          actionPath: '/pharmacy/stock',
        });
      }
      if (stockAlerts.summary.expiring30Count > 0) {
        anomalies.push({
          id: `expiring-30d-${businessDate}`,
          code: 'EXPIRING_30D',
          severity: 'warning',
          category: 'expiry',
          titleEn: `${stockAlerts.summary.expiring30Count} Lot(s) Expiring Within 30 Days`,
          titleSi: `දින 30ක් ඇතුළත කල් ඉකුත් වන තොග ${stockAlerts.summary.expiring30Count}ක් ඇත`,
          detail: 'Prioritize FEFO dispensing or raise supplier debit/credit return.',
          metricValue: `${stockAlerts.summary.expiring30Count} lot(s)`,
          actionPath: '/pharmacy/stock',
        });
      }
    } catch {
      // Ignore if pharmacy permission restricted for caller role
    }
  }

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();

    const highDiscountSales = store.posSales.filter((s) => {
      if (s.tenantId !== context.tenantId || s.branchId !== context.branchId) return false;
      const pct = s.subtotalMinor > 0 ? Math.round((s.discountMinor / s.subtotalMinor) * 100) : 0;
      return pct > rules.maxCashierDiscountPercent;
    });
    if (highDiscountSales.length > 0) {
      anomalies.push({
        id: `high-discounts-${businessDate}`,
        code: 'DISCOUNT_SPIKE',
        severity: 'warning',
        category: 'discount_spike',
        titleEn: `${highDiscountSales.length} High-Discount POS Sale(s) Exceeding ${rules.maxCashierDiscountPercent}%`,
        titleSi: `${rules.maxCashierDiscountPercent}% ට වැඩි විශේෂ වට්ටම් ලබා දුන් POS බිල්පත් ${highDiscountSales.length}ක්`,
        detail: `Latest sale ${highDiscountSales[0].saleNumber} applied Rs ${(highDiscountSales[0].discountMinor / 100).toFixed(2)} discount.`,
        metricValue: `${highDiscountSales.length} sale(s)`,
        actionPath: '/reports',
      });
    }

    const outOfRange = store.coldChainLogs.filter(
      (c) =>
        c.tenantId === context.tenantId &&
        c.branchId === context.branchId &&
        !c.inRange
    );
    if (outOfRange.length > 0) {
      anomalies.push({
        id: `cold-chain-excursion-${businessDate}`,
        code: 'COLD_CHAIN_EXCURSION',
        severity: 'critical',
        category: 'cold_chain',
        titleEn: `Cold-Chain Excursion Alert (${outOfRange[0].fridgeName})`,
        titleSi: `ශීතකරණ උෂ්ණත්ව අනතුරු ඇඟවීම (${outOfRange[0].fridgeName})`,
        detail: `Recorded ${(outOfRange[0].tempTenthsC / 10).toFixed(1)}°C outside safe 2°C–8°C band.`,
        metricValue: `${(outOfRange[0].tempTenthsC / 10).toFixed(1)}°C`,
        actionPath: '/hr-admin',
      });
    }

    const expLicenses = store.complianceLicenses.filter((l) => {
      if (l.tenantId !== context.tenantId || l.branchId !== context.branchId) return false;
      const days = Math.round(
        (new Date(`${l.expiresOn}T00:00:00Z`).getTime() -
          new Date(`${businessDate}T00:00:00Z`).getTime()) /
          86_400_000
      );
      return days <= l.alertDaysBefore;
    });
    if (expLicenses.length > 0) {
      anomalies.push({
        id: `license-expiry-${businessDate}`,
        code: 'LICENSE_EXPIRING',
        severity: 'warning',
        category: 'license',
        titleEn: `${expLicenses.length} Regulatory License(s) Expiring Soon / Expired`,
        titleSi: `බලපත්‍ර ${expLicenses.length}ක් අලුත් කිරීමේ කාලය ආසන්නයි`,
        detail: `${expLicenses[0].authority} · ${expLicenses[0].title} expires ${expLicenses[0].expiresOn}.`,
        metricValue: expLicenses[0].expiresOn,
        actionPath: '/hr-admin',
      });
    }

    const overdueAr = store.creditAccounts.filter((a) => {
      if (a.tenantId !== context.tenantId || a.branchId !== context.branchId || a.balanceMinor <= 0)
        return false;
      const days = Math.round(
        (new Date(`${businessDate}T00:00:00Z`).getTime() -
          a.lastTransactionAt.getTime()) /
          86_400_000
      );
      return days >= 60;
    });
    if (overdueAr.length > 0) {
      const totalMinor = overdueAr.reduce((s, a) => s + a.balanceMinor, 0);
      anomalies.push({
        id: `overdue-ar-${businessDate}`,
        code: 'OVERDUE_RECEIVABLES',
        severity: 'warning',
        category: 'receivables',
        titleEn: `${overdueAr.length} Credit Account(s) Overdue 60+ Days`,
        titleSi: `දින 60 ඉක්මවූ ණය ගිණුම් ${overdueAr.length}ක් පවතී`,
        detail: `Outstanding overdue receivables total LKR ${(totalMinor / 100).toFixed(2)}.`,
        metricValue: `LKR ${(totalMinor / 100).toFixed(2)}`,
        actionPath: '/accounts',
      });
    }

    const voidedExps = store.operatingExpenses.filter(
      (e) =>
        e.tenantId === context.tenantId &&
        e.branchId === context.branchId &&
        e.expenseDate === businessDate &&
        e.status === 'voided'
    );
    if (voidedExps.length > 0) {
      anomalies.push({
        id: `void-opex-${businessDate}`,
        code: 'VOIDED_OPEX',
        severity: 'info',
        category: 'voids',
        titleEn: `${voidedExps.length} Voided Operating Expense Entry on ${businessDate}`,
        titleSi: `අද දින අවලංගු කළ වියදම් වාර්තා ${voidedExps.length}ක් ඇත`,
        detail: 'Review audit trail to verify void authorization.',
        metricValue: `${voidedExps.length} void(s)`,
        actionPath: '/audit',
      });
    }

    return anomalies;
  }

  const [recentSales, coldExcursions, licRows, voidExpenses] = await Promise.all([
    db
      .select()
      .from(posSales)
      .where(
        and(eq(posSales.tenantId, context.tenantId), eq(posSales.branchId, context.branchId))
      )
      .orderBy(desc(posSales.soldAt))
      .limit(50),
    db
      .select()
      .from(coldChainLogs)
      .where(
        and(
          eq(coldChainLogs.tenantId, context.tenantId),
          eq(coldChainLogs.branchId, context.branchId),
          eq(coldChainLogs.inRange, false)
        )
      )
      .orderBy(desc(coldChainLogs.loggedAt))
      .limit(5),
    db
      .select()
      .from(complianceLicenses)
      .where(
        and(
          eq(complianceLicenses.tenantId, context.tenantId),
          eq(complianceLicenses.branchId, context.branchId)
        )
      ),
    db
      .select()
      .from(operatingExpenses)
      .where(
        and(
          eq(operatingExpenses.tenantId, context.tenantId),
          eq(operatingExpenses.branchId, context.branchId),
          eq(operatingExpenses.expenseDate, businessDate),
          eq(operatingExpenses.status, 'voided')
        )
      ),
  ]);

  const highDiscounts = recentSales.filter((s) => {
    const pct = s.subtotalMinor > 0 ? Math.round((s.discountMinor / s.subtotalMinor) * 100) : 0;
    return pct > rules.maxCashierDiscountPercent;
  });
  if (highDiscounts.length > 0) {
    anomalies.push({
      id: `high-discounts-${businessDate}`,
      code: 'DISCOUNT_SPIKE',
      severity: 'warning',
      category: 'discount_spike',
      titleEn: `${highDiscounts.length} High-Discount POS Sale(s) Exceeding ${rules.maxCashierDiscountPercent}%`,
      titleSi: `${rules.maxCashierDiscountPercent}% ට වැඩි වට්ටම් POS බිල්පත් ${highDiscounts.length}ක්`,
      detail: `Latest sale ${highDiscounts[0].saleNumber} applied Rs ${(highDiscounts[0].discountMinor / 100).toFixed(2)} discount.`,
      metricValue: `${highDiscounts.length} sale(s)`,
      actionPath: '/reports',
    });
  }

  if (coldExcursions.length > 0) {
    anomalies.push({
      id: `cold-chain-excursion-${businessDate}`,
      code: 'COLD_CHAIN_EXCURSION',
      severity: 'critical',
      category: 'cold_chain',
      titleEn: `Cold-Chain Excursion Alert (${coldExcursions[0].fridgeName})`,
      titleSi: `ශීතකරණ උෂ්ණත්ව අනතුරු ඇඟවීම (${coldExcursions[0].fridgeName})`,
      detail: `Recorded ${(coldExcursions[0].tempTenthsC / 10).toFixed(1)}°C outside safe 2°C–8°C band.`,
      metricValue: `${(coldExcursions[0].tempTenthsC / 10).toFixed(1)}°C`,
      actionPath: '/hr-admin',
    });
  }

  const expLicenses = licRows.filter((l) => {
    const days = Math.round(
      (new Date(`${l.expiresOn}T00:00:00Z`).getTime() -
        new Date(`${businessDate}T00:00:00Z`).getTime()) /
        86_400_000
    );
    return days <= l.alertDaysBefore;
  });
  if (expLicenses.length > 0) {
    anomalies.push({
      id: `license-expiry-${businessDate}`,
      code: 'LICENSE_EXPIRING',
      severity: 'warning',
      category: 'license',
      titleEn: `${expLicenses.length} Regulatory License(s) Expiring Soon`,
      titleSi: `බලපත්‍ර ${expLicenses.length}ක් අලුත් කිරීමේ කාලය ආසන්නයි`,
      detail: `${expLicenses[0].authority} · ${expLicenses[0].title} expires ${expLicenses[0].expiresOn}.`,
      metricValue: expLicenses[0].expiresOn,
      actionPath: '/hr-admin',
    });
  }

  if (voidExpenses.length > 0) {
    anomalies.push({
      id: `void-opex-${businessDate}`,
      code: 'VOIDED_OPEX',
      severity: 'info',
      category: 'voids',
      titleEn: `${voidExpenses.length} Voided Operating Expense Entry on ${businessDate}`,
      titleSi: `අද දින අවලංගු කළ වියදම් වාර්තා ${voidExpenses.length}ක් ඇත`,
      detail: 'Review audit trail to verify void authorization.',
      metricValue: `${voidExpenses.length} void(s)`,
      actionPath: '/audit',
    });
  }

  return anomalies;
}

// ---------------------------------------------------------------------------
// 5. Autopilot Cockpit Aggregator & Bilingual Daily Owner Briefing
// ---------------------------------------------------------------------------
export async function getAutopilotCockpit(
  context: ActiveWorkspaceContext,
  requestedDate?: string
): Promise<AutopilotCockpitResponse> {
  const businessDate = requestedDate || getBusinessDateInTimezone(context.timezone);

  const [rules, checklists, anomalies, smartReorders, zReport] = await Promise.all([
    getGovernanceRules(context),
    getOrCreateDailyChecklists(context, businessDate),
    scanWorkspaceAnomalies(context, businessDate),
    getSmartReorderSuggestions(context),
    getCombinedZReport(context, businessDate).catch(() => null),
  ]);

  let tenantSlug = context.tenantName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  let totalAppointmentsToday = 0;
  let waitingAppointmentsCount = 0;
  let operatingExpensesMinor = 0;
  let nextWaitingPatient: AutopilotCockpitResponse['soloSnapshot']['nextWaitingPatient'] = null;
  let latestBriefing: AutopilotCockpitResponse['latestBriefing'] = null;

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const tenant = store.tenants.find((t) => t.id === context.tenantId);
    if (tenant) tenantSlug = tenant.slug;

    operatingExpensesMinor = store.operatingExpenses
      .filter(
        (e) =>
          e.tenantId === context.tenantId &&
          e.branchId === context.branchId &&
          e.expenseDate === businessDate &&
          e.status === 'posted'
      )
      .reduce((sum, e) => sum + e.amountMinor, 0);

    const allTodayAppts = store.appointments.filter(
      (a) =>
        a.tenantId === context.tenantId &&
        a.branchId === context.branchId &&
        a.businessDate === businessDate
    );
    totalAppointmentsToday = allTodayAppts.length;
    const waitingAppts = allTodayAppts
      .filter((a) => a.status === 'arrived' || a.status === 'scheduled')
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    waitingAppointmentsCount = waitingAppts.length;

    if (waitingAppts.length > 0) {
      const next = waitingAppts[0];
      const person = store.people.find((p) => p.id === next.personId);
      const tok = store.appointmentQueueTokens.find((t) => t.appointmentId === next.id);
      nextWaitingPatient = {
        appointmentId: next.id,
        personName: person?.displayName ?? 'Walk-in Patient',
        tokenNumber: tok?.tokenNumber ?? 1,
        status: next.status,
      };
    }

    const briefings = store.ownerBriefings
      .filter(
        (b) =>
          b.tenantId === context.tenantId &&
          b.branchId === context.branchId &&
          b.businessDate === businessDate
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    if (briefings[0]) {
      latestBriefing = {
        id: briefings[0].id,
        businessDate: briefings[0].businessDate,
        summaryTextEn: briefings[0].summaryTextEn,
        summaryTextSi: briefings[0].summaryTextSi,
        anomalyCount: Array.isArray(briefings[0].anomaliesJson)
          ? briefings[0].anomaliesJson.length
          : 0,
        dispatchedChannel: briefings[0].dispatchedChannel,
        createdAt: briefings[0].createdAt.toISOString(),
        metricsJson: briefings[0].metricsJson,
      };
    }
  } else {
    const [tenantRow] = await db
      .select({ slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, context.tenantId))
      .limit(1);
    if (tenantRow) tenantSlug = tenantRow.slug;

    const opexRows = await db
      .select({ amountMinor: operatingExpenses.amountMinor, status: operatingExpenses.status })
      .from(operatingExpenses)
      .where(
        and(
          eq(operatingExpenses.tenantId, context.tenantId),
          eq(operatingExpenses.branchId, context.branchId),
          eq(operatingExpenses.expenseDate, businessDate)
        )
      );
    operatingExpensesMinor = opexRows
      .filter((e) => e.status === 'posted')
      .reduce((sum, e) => sum + e.amountMinor, 0);

    const openAppts = await db
      .select({
        id: appointments.id,
        status: appointments.status,
        personName: people.displayName,
        startsAt: appointments.startsAt,
      })
      .from(appointments)
      .innerJoin(people, eq(appointments.personId, people.id))
      .where(
        and(
          eq(appointments.tenantId, context.tenantId),
          eq(appointments.branchId, context.branchId),
          eq(appointments.businessDate, businessDate)
        )
      )
      .orderBy(appointments.startsAt);

    totalAppointmentsToday = openAppts.length;
    const waitingAppts = openAppts.filter(
      (a) => a.status === 'arrived' || a.status === 'scheduled'
    );
    waitingAppointmentsCount = waitingAppts.length;
    const waiting = waitingAppts[0];
    if (waiting) {
      const [tok] = await db
        .select({ tokenNumber: appointmentQueueTokens.tokenNumber })
        .from(appointmentQueueTokens)
        .where(eq(appointmentQueueTokens.appointmentId, waiting.id))
        .limit(1);
      nextWaitingPatient = {
        appointmentId: waiting.id,
        personName: waiting.personName,
        tokenNumber: tok?.tokenNumber ?? 1,
        status: waiting.status,
      };
    }

    const [latest] = await db
      .select()
      .from(ownerBriefings)
      .where(
        and(
          eq(ownerBriefings.tenantId, context.tenantId),
          eq(ownerBriefings.branchId, context.branchId),
          eq(ownerBriefings.businessDate, businessDate)
        )
      )
      .orderBy(desc(ownerBriefings.createdAt))
      .limit(1);

    if (latest) {
      const anomArr = Array.isArray(latest.anomaliesJson) ? latest.anomaliesJson : [];
      latestBriefing = {
        id: latest.id,
        businessDate: latest.businessDate,
        summaryTextEn: latest.summaryTextEn,
        summaryTextSi: latest.summaryTextSi,
        anomalyCount: anomArr.length,
        dispatchedChannel: latest.dispatchedChannel === 'whatsapp' ? 'whatsapp' : 'in_app',
        createdAt: latest.createdAt.toISOString(),
        metricsJson: (latest.metricsJson ?? {}) as Record<string, unknown>,
      };
    }
  }

  const expiringSoonCount = anomalies.filter((a) => a.category === 'expiry').length;
  const trueNetProfitMinor = zReport
    ? zReport.clinic.clinicNetAfterPayoutMinor +
      zReport.pharmacy.grossProfitMinor -
      operatingExpensesMinor
    : 0;

  return {
    businessDate,
    currency: context.currency,
    tenantSlug,
    kioskPath: `/kiosk/${tenantSlug}`,
    modeFlags: {
      hasClinic: Boolean(context.capabilities['appointments.manage']),
      hasPharmacy: Boolean(
        context.capabilities['pharmacy.inventory'] || context.capabilities['pharmacy.pos']
      ),
    },
    governance: rules,
    checklists,
    anomalies,
    smartReorders,
    latestBriefing,
    soloSnapshot: {
      totalAppointmentsToday,
      waitingAppointmentsCount,
      nextWaitingPatient,
      clinicCollectionsMinor: zReport?.clinic.netCollectionsMinor ?? 0,
      pharmacyNetSalesMinor: zReport?.pharmacy.netSalesMinor ?? 0,
      operatingExpensesMinor,
      todayRevenueMinor: zReport?.combined.totalRevenueMinor ?? 0,
      trueNetProfitMinor,
      lowStockCount: smartReorders.length,
      expiringSoonCount,
    },
  };
}

export async function generateAndDispatchOwnerBriefing(
  context: ActiveWorkspaceContext,
  options: { sendWhatsapp?: boolean },
  correlationId: string
): Promise<NonNullable<AutopilotCockpitResponse['latestBriefing']>> {
  const businessDate = getBusinessDateInTimezone(context.timezone);
  const [rules, zReport, anomalies, reorders, checklists] = await Promise.all([
    getGovernanceRules(context),
    getCombinedZReport(context, businessDate),
    scanWorkspaceAnomalies(context, businessDate),
    getSmartReorderSuggestions(context),
    getOrCreateDailyChecklists(context, businessDate),
  ]);

  const fmtLkr = (minor: number) =>
    `LKR ${(minor / 100).toLocaleString('en-LK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const summaryTextEn = [
    `${context.tenantName} (${context.branchName}) · Daily Briefing ${businessDate}`,
    `Total Revenue: ${fmtLkr(zReport.combined.totalRevenueMinor)} | True Net Profit: ${fmtLkr(zReport.combined.netProfitMinor)}`,
    `Clinic Appointments: ${zReport.clinic.completedCount}/${zReport.clinic.appointmentCount} completed | Pharmacy Sales: ${zReport.pharmacy.saleCount}`,
    `SOP Status: Opening ${checklists.opening.status} (${checklists.opening.completedCount}/${checklists.opening.totalCount}) · Closing ${checklists.closing.status} (${checklists.closing.completedCount}/${checklists.closing.totalCount})`,
    `Alerts: ${anomalies.length} risk item(s), ${reorders.length} SKU(s) below par reorder level.`,
  ].join('\n');

  const summaryTextSi = [
    `${context.tenantName} (${context.branchName}) · දෛනික සාරාංශය (${businessDate})`,
    `මුළු ආදායම: ${fmtLkr(zReport.combined.totalRevenueMinor)} | සැබෑ ශුද්ධ ලාභය: ${fmtLkr(zReport.combined.netProfitMinor)}`,
    `රෝගීන්: ${zReport.clinic.completedCount}/${zReport.clinic.appointmentCount} සම්පූර්ණයි | ෆාමසි බිල්: ${zReport.pharmacy.saleCount}`,
    `SOP තත්ත්වය: ආරම්භක ${checklists.opening.completedCount}/${checklists.opening.totalCount} · අවසන් ${checklists.closing.completedCount}/${checklists.closing.totalCount}`,
    `අවදානම් ඇඟවීම්: ${anomalies.length} | නැවත ඇණවුම් කළ යුතු ඖෂධ (Low Stock): ${reorders.length}`,
  ].join('\n');

  const metricsJson: Record<string, unknown> = {
    totalRevenueMinor: zReport.combined.totalRevenueMinor,
    trueNetProfitMinor: zReport.combined.netProfitMinor,
    anomalyCount: anomalies.length,
    reorderCount: reorders.length,
  };

  let dispatchedChannel: 'in_app' | 'whatsapp' = 'in_app';
  if (options.sendWhatsapp && rules.ownerWhatsappPhone.trim().length >= 9) {
    try {
      await sendNotificationDispatch(
        context,
        {
          channel: 'whatsapp',
          provider: 'whatsapp_cloud',
          templateType: 'appointment_reminder',
          recipientPhone: rules.ownerWhatsappPhone.trim(),
          recipientName: 'Workspace Owner',
          messageBody: `${summaryTextSi}\n\n${summaryTextEn}`,
          entityType: 'owner_briefing',
          entityId: businessDate,
        },
        correlationId,
        { bypassGraceCheck: true }
      );
      dispatchedChannel = 'whatsapp';
    } catch {
      dispatchedChannel = 'in_app';
    }
  }

  const now = new Date();
  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const record = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      businessDate,
      summaryTextEn,
      summaryTextSi,
      metricsJson,
      anomaliesJson: anomalies.map((a) => ({
        id: a.id,
        code: a.code,
        severity: a.severity,
        category: a.category,
        titleEn: a.titleEn,
        titleSi: a.titleSi,
        detail: a.detail,
        metricValue: a.metricValue,
        actionPath: a.actionPath,
      })),
      dispatchedChannel,
      createdAt: now,
    };
    store.ownerBriefings.unshift(record);
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'autopilot.owner_briefing_generated',
      entityType: 'owner_briefing',
      entityId: record.id,
      correlationId,
      metadataJson: { businessDate, anomalyCount: anomalies.length, dispatchedChannel },
    });
    return {
      id: record.id,
      businessDate: record.businessDate,
      summaryTextEn: record.summaryTextEn,
      summaryTextSi: record.summaryTextSi,
      anomalyCount: anomalies.length,
      dispatchedChannel: record.dispatchedChannel,
      createdAt: record.createdAt.toISOString(),
      metricsJson: record.metricsJson,
    };
  }

  const [created] = await db
    .insert(ownerBriefings)
    .values({
      tenantId: context.tenantId,
      branchId: context.branchId,
      businessDate,
      summaryTextEn,
      summaryTextSi,
      metricsJson,
      anomaliesJson: anomalies,
      dispatchedChannel,
    })
    .returning();

  await db.insert(auditEvents).values({
    tenantId: context.tenantId,
    actorUserId: context.userId,
    actorUid: context.uid,
    action: 'autopilot.owner_briefing_generated',
    entityType: 'owner_briefing',
    entityId: created.id,
    inputSource: 'ui',
    correlationId,
    metadataJson: { businessDate, anomalyCount: anomalies.length, dispatchedChannel },
  });

  return {
    id: created.id,
    businessDate: created.businessDate,
    summaryTextEn: created.summaryTextEn,
    summaryTextSi: created.summaryTextSi,
    anomalyCount: anomalies.length,
    dispatchedChannel: created.dispatchedChannel === 'whatsapp' ? 'whatsapp' : 'in_app',
    createdAt: created.createdAt.toISOString(),
    metricsJson: (created.metricsJson ?? {}) as Record<string, unknown>,
  };
}

// ---------------------------------------------------------------------------
// 6. Public Patient Self Check-In / QR Token Kiosk (Zero PII Exposed)
// ---------------------------------------------------------------------------
export async function getPublicKioskInfo(
  tenantSlug: string,
  branchId?: string
): Promise<PublicKioskInfoResponse> {
  const cleanSlug = tenantSlug.trim().toLowerCase();

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const tenant = store.tenants.find((t) => t.slug.toLowerCase() === cleanSlug);
    if (!tenant || tenant.status !== 'active') {
      throw new NotFoundError('Clinic self check-in kiosk not found');
    }
    const tenantBranches = store.branches.filter(
      (b) => b.tenantId === tenant.id && b.active
    );
    const branch =
      (branchId ? tenantBranches.find((b) => b.id === branchId) : null) ??
      tenantBranches.find((b) => b.isDefault) ??
      tenantBranches[0];
    if (!branch) throw new NotFoundError('No active clinic branch available');

    const businessDate = getBusinessDateInTimezone(tenant.timezone);
    const waitingCount = store.appointments.filter(
      (a) =>
        a.tenantId === tenant.id &&
        a.branchId === branch.id &&
        a.businessDate === businessDate &&
        (a.status === 'arrived' || a.status === 'scheduled')
    ).length;

    return {
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      branchId: branch.id,
      branchName: branch.name,
      timezone: tenant.timezone,
      currency: tenant.currency,
      businessDate,
      waitingCount,
      estimatedWaitMinutes: waitingCount * 10,
      services: store.services
        .filter((s) => s.tenantId === tenant.id && s.branchId === branch.id && s.active)
        .map((s) => ({
          id: s.id,
          name: s.name,
          nameSi: s.nameSi,
          durationMinutes: s.durationMinutes,
          priceMinor: s.priceMinor,
        })),
      resources: store.resources
        .filter((r) => r.tenantId === tenant.id && r.branchId === branch.id && r.active)
        .map((r) => ({
          id: r.id,
          name: r.name,
          specialty: r.specialty,
        })),
    };
  }

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, cleanSlug))
    .limit(1);

  if (!tenant || tenant.status !== 'active') {
    throw new NotFoundError('Clinic self check-in kiosk not found');
  }

  const branchRows = await db
    .select()
    .from(branches)
    .where(and(eq(branches.tenantId, tenant.id), eq(branches.active, true)));

  const branch =
    (branchId ? branchRows.find((b) => b.id === branchId) : null) ??
    branchRows.find((b) => b.isDefault) ??
    branchRows[0];
  if (!branch) throw new NotFoundError('No active clinic branch available');

  const businessDate = getBusinessDateInTimezone(tenant.timezone);
  const [svcRows, resRows, openAppts] = await Promise.all([
    db
      .select({
        id: services.id,
        name: services.name,
        nameSi: services.nameSi,
        durationMinutes: services.durationMinutes,
        priceMinor: services.priceMinor,
      })
      .from(services)
      .where(
        and(
          eq(services.tenantId, tenant.id),
          eq(services.branchId, branch.id),
          eq(services.active, true)
        )
      ),
    db
      .select({
        id: resources.id,
        name: resources.name,
        specialty: resources.specialty,
      })
      .from(resources)
      .where(
        and(
          eq(resources.tenantId, tenant.id),
          eq(resources.branchId, branch.id),
          eq(resources.active, true)
        )
      ),
    db
      .select({ id: appointments.id, status: appointments.status })
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, tenant.id),
          eq(appointments.branchId, branch.id),
          eq(appointments.businessDate, businessDate)
        )
      ),
  ]);

  const waitingCount = openAppts.filter(
    (a) => a.status === 'arrived' || a.status === 'scheduled'
  ).length;

  return {
    tenantId: tenant.id,
    tenantName: tenant.name,
    tenantSlug: tenant.slug,
    branchId: branch.id,
    branchName: branch.name,
    timezone: tenant.timezone,
    currency: tenant.currency,
    businessDate,
    waitingCount,
    estimatedWaitMinutes: waitingCount * 10,
    services: svcRows,
    resources: resRows,
  };
}

export async function submitPublicSelfCheckIn(
  tenantSlug: string,
  input: PublicSelfCheckInInput,
  correlationId: string
): Promise<PublicSelfCheckInResponse> {
  const cleanSlug = tenantSlug.trim().toLowerCase();
  const normName = normalizeName(input.patientName);
  const phoneClean = input.phone.trim();
  const last4 = normalizePhoneLast4(phoneClean);
  const now = new Date();

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const tenant = store.tenants.find((t) => t.slug.toLowerCase() === cleanSlug);
    if (!tenant || tenant.status !== 'active') {
      throw new NotFoundError('Clinic self check-in kiosk not found');
    }

    const branch =
      (input.branchId
        ? store.branches.find(
            (b) => b.tenantId === tenant.id && b.id === input.branchId && b.active
          )
        : null) ??
      store.branches.find((b) => b.tenantId === tenant.id && b.isDefault && b.active) ??
      store.branches.find((b) => b.tenantId === tenant.id && b.active);
    if (!branch) throw new NotFoundError('Clinic branch not found');

    const svc = store.services.find(
      (s) => s.id === input.serviceId && s.tenantId === tenant.id && s.active
    );
    if (!svc) throw new NotFoundError('Selected service not found');

    const res = store.resources.find(
      (r) => r.id === input.resourceId && r.tenantId === tenant.id && r.active
    );
    if (!res) throw new NotFoundError('Selected practitioner not found');

    let person = store.people.find(
      (p) =>
        p.tenantId === tenant.id &&
        p.normalizedName === normName &&
        p.phoneLast4 === last4
    );
    if (!person) {
      person = {
        id: crypto.randomUUID(),
        tenantId: tenant.id,
        branchId: branch.id,
        displayName: input.patientName.trim(),
        normalizedName: normName,
        aliasesJson: [],
        phone: phoneClean,
        phoneLast4: last4,
        notes: 'Registered via Patient QR Self Check-In',
        isSample: false,
        version: 1,
        createdAt: now,
      };
      store.people.push(person);
    }

    const businessDate = getBusinessDateInTimezone(tenant.timezone);
    const sameResAppts = store.appointments.filter(
      (a) =>
        a.tenantId === tenant.id &&
        a.resourceId === res.id &&
        a.businessDate === businessDate &&
        a.status !== 'cancelled' &&
        a.status !== 'no_show'
    );
    const maxEndMs = sameResAppts.reduce(
      (max, a) => Math.max(max, a.endsAt.getTime()),
      now.getTime()
    );
    const startsAt = new Date(Math.max(now.getTime(), maxEndMs + 60_000));
    const endsAt = new Date(startsAt.getTime() + svc.durationMinutes * 60_000);

    const apptId = crypto.randomUUID();
    store.appointments.push({
      id: apptId,
      tenantId: tenant.id,
      branchId: branch.id,
      personId: person.id,
      serviceId: svc.id,
      resourceId: res.id,
      startsAt,
      endsAt,
      businessDate,
      status: 'arrived',
      bookedDurationMinutes: svc.durationMinutes,
      bookedPriceMinor: svc.priceMinor,
      currency: tenant.currency,
      notes: (input.notes || '').trim() || 'Self Check-In Kiosk',
      isSample: false,
      version: 1,
      createdByUserId: 1,
      createdAt: now,
      updatedAt: now,
    });

    const todayTokens = store.appointmentQueueTokens.filter(
      (t) =>
        t.tenantId === tenant.id &&
        t.branchId === branch.id &&
        t.businessDate === businessDate
    );
    const nextToken =
      todayTokens.reduce((max, t) => Math.max(max, t.tokenNumber), 0) + 1;

    store.appointmentQueueTokens.push({
      id: crypto.randomUUID(),
      tenantId: tenant.id,
      branchId: branch.id,
      appointmentId: apptId,
      resourceId: res.id,
      businessDate,
      tokenNumber: nextToken,
      queueState: 'waiting',
      delayMinutes: 0,
      calledAt: null,
      createdAt: now,
    });

    addMemAuditEvent({
      tenantId: tenant.id,
      actorUserId: null,
      actorUid: 'public-kiosk',
      action: 'clinic.qr_self_checkin',
      entityType: 'appointment',
      entityId: apptId,
      inputSource: 'api',
      correlationId,
      metadataJson: { tokenNumber: nextToken, businessDate, serviceName: svc.name },
    });

    return {
      appointmentId: apptId,
      tokenNumber: nextToken,
      businessDate,
      startsAt: startsAt.toISOString(),
      clinicName: tenant.name,
      branchName: branch.name,
      serviceName: svc.name,
      doctorName: res.name,
      patientName: person.displayName,
    };
  }

  const [tenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, cleanSlug))
    .limit(1);
  if (!tenant || tenant.status !== 'active') {
    throw new NotFoundError('Clinic self check-in kiosk not found');
  }

  return db.transaction(async (tx) => {
    const branchRows = await tx
      .select()
      .from(branches)
      .where(and(eq(branches.tenantId, tenant.id), eq(branches.active, true)));
    const branch =
      (input.branchId ? branchRows.find((b) => b.id === input.branchId) : null) ??
      branchRows.find((b) => b.isDefault) ??
      branchRows[0];
    if (!branch) throw new NotFoundError('Clinic branch not found');

    const [svc] = await tx
      .select()
      .from(services)
      .where(and(eq(services.id, input.serviceId), eq(services.tenantId, tenant.id)))
      .limit(1);
    if (!svc) throw new NotFoundError('Selected service not found');

    const [res] = await tx
      .select()
      .from(resources)
      .where(and(eq(resources.id, input.resourceId), eq(resources.tenantId, tenant.id)))
      .limit(1);
    if (!res) throw new NotFoundError('Selected practitioner not found');

    let [person] = await tx
      .select()
      .from(people)
      .where(
        and(
          eq(people.tenantId, tenant.id),
          eq(people.normalizedName, normName),
          eq(people.phoneLast4, last4)
        )
      )
      .limit(1);

    if (!person) {
      [person] = await tx
        .insert(people)
        .values({
          tenantId: tenant.id,
          branchId: branch.id,
          displayName: input.patientName.trim(),
          normalizedName: normName,
          aliasesJson: [],
          phone: phoneClean,
          phoneLast4: last4,
          notes: 'Registered via Patient QR Self Check-In',
          isSample: false,
        })
        .returning();
    }

    const businessDate = getBusinessDateInTimezone(tenant.timezone);
    const sameResAppts = await tx
      .select({ endsAt: appointments.endsAt, status: appointments.status })
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, tenant.id),
          eq(appointments.resourceId, res.id),
          eq(appointments.businessDate, businessDate)
        )
      );
    const maxEndMs = sameResAppts
      .filter((a) => a.status !== 'cancelled' && a.status !== 'no_show')
      .reduce((max, a) => Math.max(max, a.endsAt.getTime()), now.getTime());

    const startsAt = new Date(Math.max(now.getTime(), maxEndMs + 60_000));
    const endsAt = new Date(startsAt.getTime() + svc.durationMinutes * 60_000);

    const [appt] = await tx
      .insert(appointments)
      .values({
        tenantId: tenant.id,
        branchId: branch.id,
        personId: person.id,
        serviceId: svc.id,
        resourceId: res.id,
        startsAt,
        endsAt,
        businessDate,
        status: 'arrived',
        bookedDurationMinutes: svc.durationMinutes,
        bookedPriceMinor: svc.priceMinor,
        currency: tenant.currency,
        notes: (input.notes || '').trim() || 'Self Check-In Kiosk',
        isSample: false,
        createdByUserId: 1,
      })
      .returning();

    const [maxTok] = await tx
      .select({
        maxToken: sql<number>`COALESCE(MAX(${appointmentQueueTokens.tokenNumber}), 0)::int`,
      })
      .from(appointmentQueueTokens)
      .where(
        and(
          eq(appointmentQueueTokens.tenantId, tenant.id),
          eq(appointmentQueueTokens.branchId, branch.id),
          eq(appointmentQueueTokens.businessDate, businessDate)
        )
      );

    const nextToken = (maxTok?.maxToken ?? 0) + 1;
    await tx.insert(appointmentQueueTokens).values({
      tenantId: tenant.id,
      branchId: branch.id,
      appointmentId: appt.id,
      resourceId: res.id,
      businessDate,
      tokenNumber: nextToken,
      queueState: 'waiting',
    });

    await tx.insert(auditEvents).values({
      tenantId: tenant.id,
      actorUserId: null,
      actorUid: 'public-kiosk',
      action: 'clinic.qr_self_checkin',
      entityType: 'appointment',
      entityId: appt.id,
      inputSource: 'api',
      correlationId,
      metadataJson: { tokenNumber: nextToken, businessDate, serviceName: svc.name },
    });

    return {
      appointmentId: appt.id,
      tokenNumber: nextToken,
      businessDate,
      startsAt: startsAt.toISOString(),
      clinicName: tenant.name,
      branchName: branch.name,
      serviceName: svc.name,
      doctorName: res.name,
      patientName: person.displayName,
    };
  });
}
