import crypto from 'node:crypto';
import { and, asc, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import { db, isDatabaseConfigured } from '../db/index.ts';
import {
  auditEvents,
  commands,
  costLayers,
  counters,
  inventoryBalances,
  lots,
  outboxEvents,
  packVariants,
  pharmacistCheckoutApprovals,
  posPayments,
  posReceipts,
  posReturnLines,
  posReturns,
  posSaleAllocations,
  posSaleLines,
  posSales,
  products,
  recalls,
  stockMovements,
  stockReservations,
  storageLocations,
  tillCashEvents,
  tillShifts,
} from '../db/schema.ts';
import type {
  ApprovePosCartInput,
  CheckoutPosSaleInput,
  CloseTillShiftInput,
  CreatePosReturnInput,
  OpenTillShiftInput,
  PosCartItemInput,
  TillCashEventInput,
} from '../contracts/pharmacy.ts';
import { assertGovernancePinIfRequired } from './autopilot-ops.ts';
import { assertProfessionalGrant } from './capabilities.ts';
import { ConflictError, NotFoundError, ValidationError } from './errors.ts';
import { addMemAuditEvent, getMemoryStore } from './memory-store.ts';
import { assertWorkspaceNotReadOnlyGrace } from './subscription-billing.ts';
import {
  type ActiveWorkspaceContext,
  assertCapability,
  assertPermission,
  getBusinessDateInTimezone,
} from './tenancy.ts';

export function computeCartHash(items: PosCartItemInput[], discountMinor: number): string {
  const canonicalItems = [...items]
    .map((item) => ({
      productId: item.productId,
      packVariantId: item.packVariantId,
      qtyPacks: item.qtyPacks,
      unitSalePriceMinor: item.unitSalePriceMinor ?? null,
    }))
    .sort((a, b) =>
      `${a.productId}:${a.packVariantId}`.localeCompare(`${b.productId}:${b.packVariantId}`)
    );

  return crypto
    .createHash('sha256')
    .update(JSON.stringify({ items: canonicalItems, discountMinor }))
    .digest('hex');
}

// ------------------------------------------------------------
// 1. Till Shifts (Open, Cash Drops/Paid-outs, Blind Close Variance)
// ------------------------------------------------------------
export async function listTillShifts(context: ActiveWorkspaceContext) {
  assertCapability(context, 'pharmacy.pos');
  assertPermission(context, 'pharmacy.stock.read');

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    return {
      shifts: store.tillShifts
        .filter((s) => s.tenantId === context.tenantId && s.branchId === context.branchId)
        .sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime())
        .slice(0, 20),
      counters: store.counters.filter(
        (c) => c.tenantId === context.tenantId && c.branchId === context.branchId && c.active
      ),
    };
  }

  const shiftRows = await db
    .select()
    .from(tillShifts)
    .where(and(eq(tillShifts.tenantId, context.tenantId), eq(tillShifts.branchId, context.branchId)))
    .orderBy(desc(tillShifts.openedAt))
    .limit(20);

  const counterRows = await db
    .select()
    .from(counters)
    .where(
      and(
        eq(counters.tenantId, context.tenantId),
        eq(counters.branchId, context.branchId),
        eq(counters.active, true)
      )
    );

  return { shifts: shiftRows, counters: counterRows };
}

export async function openTillShift(
  context: ActiveWorkspaceContext,
  input: OpenTillShiftInput,
  correlationId: string
) {
  assertCapability(context, 'pharmacy.pos');
  assertPermission(context, 'pharmacy.pos.sell');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const counter = input.counterId
      ? store.counters.find(
          (c) =>
            c.tenantId === context.tenantId &&
            c.branchId === context.branchId &&
            c.id === input.counterId &&
            c.active
        )
      : store.counters.find(
          (c) => c.tenantId === context.tenantId && c.branchId === context.branchId && c.active
        );
    if (!counter) throw new NotFoundError(input.counterId ? 'Counter not found in this branch' : 'No active counter configured for branch');
    if (store.tillShifts.some((s) => s.tenantId === context.tenantId && s.counterId === counter.id && s.status === 'open')) {
      throw new ConflictError('An open till shift already exists for this counter');
    }
    const shift = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      counterId: counter.id,
      openedByUserId: context.userId,
      closedByUserId: null,
      openingFloatMinor: input.openingFloatMinor,
      cashSalesMinor: 0,
      cashRefundsMinor: 0,
      cashDropsMinor: 0,
      paidOutsMinor: 0,
      expectedCashMinor: input.openingFloatMinor,
      countedCashMinor: null,
      varianceMinor: null,
      closeNotes: '',
      status: 'open' as const,
      openedAt: new Date(),
      closedAt: null,
    };
    store.tillShifts.push(shift);
    addMemAuditEvent({
      tenantId: context.tenantId, actorUserId: context.userId, actorUid: context.uid,
      action: 'pharmacy.shift.opened', entityType: 'till_shift', entityId: shift.id, correlationId,
      metadataJson: { counterId: counter.id, openingFloatMinor: input.openingFloatMinor },
    });
    return { shift };
  }

  return db.transaction(async (tx) => {
    let counterId = input.counterId;
    if (counterId) {
      const [c] = await tx
        .select()
        .from(counters)
        .where(
          and(
            eq(counters.tenantId, context.tenantId),
            eq(counters.branchId, context.branchId),
            eq(counters.id, counterId),
            eq(counters.active, true)
          )
        )
        .limit(1);
      if (!c) throw new NotFoundError('Counter not found in this branch');
    } else {
      const [defaultCounter] = await tx
        .select()
        .from(counters)
        .where(
          and(
            eq(counters.tenantId, context.tenantId),
            eq(counters.branchId, context.branchId),
            eq(counters.active, true)
          )
        )
        .limit(1);
      if (!defaultCounter) throw new NotFoundError('No active counter configured for branch');
      counterId = defaultCounter.id;
    }

    const [openExisting] = await tx
      .select({ id: tillShifts.id })
      .from(tillShifts)
      .where(
        and(
          eq(tillShifts.tenantId, context.tenantId),
          eq(tillShifts.counterId, counterId),
          eq(tillShifts.status, 'open')
        )
      )
      .limit(1);

    if (openExisting) {
      throw new ConflictError('An open till shift already exists for this counter');
    }

    const [shift] = await tx
      .insert(tillShifts)
      .values({
        tenantId: context.tenantId,
        branchId: context.branchId,
        counterId,
        openedByUserId: context.userId,
        openingFloatMinor: input.openingFloatMinor,
        expectedCashMinor: input.openingFloatMinor,
        status: 'open',
      })
      .returning();

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.shift.opened',
      entityType: 'till_shift',
      entityId: shift.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: { counterId, openingFloatMinor: input.openingFloatMinor },
    });

    return { shift };
  });
}

export async function recordTillCashEvent(
  context: ActiveWorkspaceContext,
  shiftId: string,
  input: TillCashEventInput,
  correlationId: string
) {
  assertCapability(context, 'pharmacy.pos');
  assertPermission(context, 'pharmacy.pos.sell');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const shift = store.tillShifts.find((s) => s.tenantId === context.tenantId && s.id === shiftId);
    if (!shift) throw new NotFoundError('Till shift not found');
    if (shift.status !== 'open') throw new ConflictError('Till shift is already closed');
    const dropsDelta = input.eventType === 'drop' ? input.amountMinor : 0;
    const paidOutsDelta = input.eventType === 'paid_out' ? input.amountMinor : 0;
    const topUpDelta = input.eventType === 'top_up' ? input.amountMinor : 0;
    const nextExpected = shift.expectedCashMinor + topUpDelta - dropsDelta - paidOutsDelta;
    if (nextExpected < 0) throw new ValidationError('Till cash balance cannot drop below zero');
    shift.cashDropsMinor += dropsDelta;
    shift.paidOutsMinor += paidOutsDelta;
    shift.expectedCashMinor = nextExpected;
    const evt = {
      id: crypto.randomUUID(), tenantId: context.tenantId, shiftId: shift.id,
      eventType: input.eventType, amountMinor: input.amountMinor, reason: input.reason.trim(),
      actorUserId: context.userId, occurredAt: new Date(),
    };
    store.tillCashEvents.push(evt);
    addMemAuditEvent({
      tenantId: context.tenantId, actorUserId: context.userId, actorUid: context.uid,
      action: `pharmacy.shift.cash_${input.eventType}`, entityType: 'till_shift', entityId: shift.id, correlationId,
      metadataJson: { amountMinor: input.amountMinor, reason: input.reason },
    });
    return { shift, event: evt };
  }

  return db.transaction(async (tx) => {
    const lockedRows = await tx
      .select()
      .from(tillShifts)
      .where(and(eq(tillShifts.tenantId, context.tenantId), eq(tillShifts.id, shiftId)))
      .for('update');
    const shift = lockedRows[0];
    if (!shift) throw new NotFoundError('Till shift not found');
    if (shift.status !== 'open') {
      throw new ConflictError('Till shift is already closed');
    }

    const [evt] = await tx
      .insert(tillCashEvents)
      .values({
        tenantId: context.tenantId,
        shiftId: shift.id,
        eventType: input.eventType,
        amountMinor: input.amountMinor,
        reason: input.reason.trim(),
        actorUserId: context.userId,
      })
      .returning();

    const dropsDelta = input.eventType === 'drop' ? input.amountMinor : 0;
    const paidOutsDelta = input.eventType === 'paid_out' ? input.amountMinor : 0;
    const topUpDelta = input.eventType === 'top_up' ? input.amountMinor : 0;

    const nextExpected = shift.expectedCashMinor + topUpDelta - dropsDelta - paidOutsDelta;
    if (nextExpected < 0) {
      throw new ValidationError('Till cash balance cannot drop below zero');
    }

    const [updatedShift] = await tx
      .update(tillShifts)
      .set({
        cashDropsMinor: shift.cashDropsMinor + dropsDelta,
        paidOutsMinor: shift.paidOutsMinor + paidOutsDelta,
        expectedCashMinor: nextExpected,
      })
      .where(eq(tillShifts.id, shift.id))
      .returning();

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: `pharmacy.shift.cash_${input.eventType}`,
      entityType: 'till_shift',
      entityId: shift.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: { amountMinor: input.amountMinor, reason: input.reason },
    });

    return { shift: updatedShift, event: evt };
  });
}

export async function closeTillShift(
  context: ActiveWorkspaceContext,
  shiftId: string,
  input: CloseTillShiftInput,
  correlationId: string
) {
  assertCapability(context, 'pharmacy.pos');
  assertPermission(context, 'pharmacy.pos.sell');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const shift = store.tillShifts.find((s) => s.tenantId === context.tenantId && s.id === shiftId);
    if (!shift) throw new NotFoundError('Till shift not found');
    if (shift.status !== 'open') throw new ConflictError('Till shift is already closed');
    shift.countedCashMinor = input.countedCashMinor;
    shift.varianceMinor = input.countedCashMinor - shift.expectedCashMinor;
    shift.closeNotes = input.closeNotes.trim();
    shift.closedByUserId = context.userId;
    shift.closedAt = new Date();
    shift.status = 'closed';
    addMemAuditEvent({
      tenantId: context.tenantId, actorUserId: context.userId, actorUid: context.uid,
      action: 'pharmacy.shift.closed', entityType: 'till_shift', entityId: shift.id, correlationId,
      metadataJson: { expectedCashMinor: shift.expectedCashMinor, countedCashMinor: input.countedCashMinor, varianceMinor: shift.varianceMinor },
    });
    return { shift };
  }

  return db.transaction(async (tx) => {
    const lockedRows = await tx
      .select()
      .from(tillShifts)
      .where(and(eq(tillShifts.tenantId, context.tenantId), eq(tillShifts.id, shiftId)))
      .for('update');
    const shift = lockedRows[0];
    if (!shift) throw new NotFoundError('Till shift not found');
    if (shift.status !== 'open') {
      throw new ConflictError('Till shift is already closed');
    }

    const varianceMinor = input.countedCashMinor - shift.expectedCashMinor;

    const [closed] = await tx
      .update(tillShifts)
      .set({
        countedCashMinor: input.countedCashMinor,
        varianceMinor,
        closeNotes: input.closeNotes.trim(),
        closedByUserId: context.userId,
        closedAt: new Date(),
        status: 'closed',
      })
      .where(eq(tillShifts.id, shift.id))
      .returning();

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.shift.closed',
      entityType: 'till_shift',
      entityId: shift.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: {
        expectedCashMinor: shift.expectedCashMinor,
        countedCashMinor: input.countedCashMinor,
        varianceMinor,
      },
    });

    await tx.insert(outboxEvents).values({
      tenantId: context.tenantId,
      eventType: 'pharmacy.shift.closed',
      payloadJson: { shiftId: shift.id, varianceMinor },
    });

    return { shift: closed };
  });
}

// ------------------------------------------------------------
// 2. Cart-Hash-Bound Pharmacist Checkout Approval Gate (P10-P11)
// ------------------------------------------------------------
export async function approvePosCart(
  context: ActiveWorkspaceContext,
  input: ApprovePosCartInput,
  correlationId: string
) {
  assertCapability(context, 'pharmacy.pos');
  assertCapability(context, 'pharmacy.professional_gate');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const pharmacistGrant = await assertProfessionalGrant(context, 'pharmacist');

  const cartHash = computeCartHash(input.items, input.discountMinor);
  const expiresAt = new Date(Date.now() + 30 * 60_000);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const approval = {
      id: crypto.randomUUID(), tenantId: context.tenantId, branchId: context.branchId, cartHash,
      pharmacistUserId: context.userId, grantId: pharmacistGrant.id, licenseNumber: pharmacistGrant.licenseNumber,
      prescriptionRef: input.prescriptionRef.trim(), notes: input.notes.trim(), itemsSnapshotJson: input.items,
      status: 'active' as const, expiresAt, consumedAt: null, createdAt: new Date(),
    };
    store.approvals.push(approval);
    addMemAuditEvent({
      tenantId: context.tenantId, actorUserId: context.userId, actorUid: context.uid,
      action: 'pharmacy.pos.cart_approved', entityType: 'pharmacist_checkout_approval', entityId: approval.id, correlationId,
      metadataJson: { cartHash, grantId: pharmacistGrant.id, licenseNumber: pharmacistGrant.licenseNumber },
    });
    return { approval };
  }

  const [approval] = await db
    .insert(pharmacistCheckoutApprovals)
    .values({
      tenantId: context.tenantId,
      branchId: context.branchId,
      cartHash,
      pharmacistUserId: context.userId,
      grantId: pharmacistGrant.id,
      licenseNumber: pharmacistGrant.licenseNumber,
      prescriptionRef: input.prescriptionRef.trim(),
      notes: input.notes.trim(),
      itemsSnapshotJson: input.items,
      status: 'active',
      expiresAt,
    })
    .returning();

  await db.insert(auditEvents).values({
    tenantId: context.tenantId,
    actorUserId: context.userId,
    actorUid: context.uid,
    action: 'pharmacy.pos.cart_approved',
    entityType: 'pharmacist_checkout_approval',
    entityId: approval.id,
    inputSource: 'ui',
    correlationId,
    metadataJson: {
      cartHash,
      grantId: pharmacistGrant.id,
      licenseNumber: pharmacistGrant.licenseNumber,
    },
  });

  return { approval };
}

// ------------------------------------------------------------
// 3. Retail POS Checkout (FEFO + Deterministic Lock Ordering + Split Tender)
// ------------------------------------------------------------
export async function checkoutPosSale(
  context: ActiveWorkspaceContext,
  input: CheckoutPosSaleInput,
  correlationId: string
) {
  assertCapability(context, 'pharmacy.pos');
  assertCapability(context, 'pharmacy.inventory');
  assertPermission(context, 'pharmacy.pos.sell');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const cartHash = computeCartHash(input.items, input.discountMinor);
  const commandHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ shiftId: input.shiftId, cartHash, payments: input.payments }))
    .digest('hex');

  const todayColombo = getBusinessDateInTimezone(context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const existingCmd = store.commands.find(
      (c) => c.tenantId === context.tenantId && c.actorUserId === context.userId && c.commandType === 'pharmacy.pos.checkout' && c.idempotencyKey === input.idempotencyKey
    );
    if (existingCmd && existingCmd.state === 'committed' && existingCmd.resultJson) {
      if (existingCmd.payloadHash !== commandHash) {
        throw new ConflictError('Idempotency key already used with different POS checkout payload');
      }
      return existingCmd.resultJson;
    }

    const shift = store.tillShifts.find(
      (s) => s.tenantId === context.tenantId && s.branchId === context.branchId && s.id === input.shiftId
    );
    if (!shift) throw new NotFoundError('Till shift not found');
    if (shift.status !== 'open') throw new ConflictError('Cannot complete POS sale on a closed till shift');

    let subtotalMinor = 0;
    let requiresGate = false;
    const resolvedLines = input.items.map((item) => {
      const product = store.products.find((p) => p.tenantId === context.tenantId && p.id === item.productId);
      if (!product || !product.active) throw new NotFoundError(`Product ${item.productId} not found or inactive`);
      const variant = store.packVariants.find((v) => v.tenantId === context.tenantId && v.id === item.packVariantId);
      if (!variant || variant.productId !== product.id || !variant.allowPosSale) {
        throw new ValidationError(`Pack variant is unavailable for POS sale (${product.displayName})`);
      }
      const unitSalePriceMinor = item.unitSalePriceMinor ?? variant.defaultSalePriceMinor;
      const lineTotalMinor = unitSalePriceMinor * item.qtyPacks;
      const qtyBase = item.qtyPacks * variant.currentBaseQty;
      subtotalMinor += lineTotalMinor;
      if (product.requiresPharmacistRelease) requiresGate = true;
      return { product, variant, qtyPacks: item.qtyPacks, qtyBase, unitSalePriceMinor, lineTotalMinor };
    });

    if (input.discountMinor > subtotalMinor) throw new ValidationError('Discount cannot exceed subtotal');
    const discountPercent =
      subtotalMinor > 0 ? Math.round((input.discountMinor / subtotalMinor) * 100) : 0;
    await assertGovernancePinIfRequired(
      context,
      {
        type: 'pos_discount',
        discountPercent,
        managerOverridePin: input.managerOverridePin,
      },
      correlationId
    );
    const totalMinor = subtotalMinor - input.discountMinor;
    const paidMinor = input.payments.reduce((acc, p) => acc + p.amountMinor, 0);
    if (paidMinor < totalMinor) {
      throw new ValidationError(`Insufficient payment tendered (${paidMinor} < ${totalMinor})`, 'errors.insufficient_payment');
    }
    const changeMinor = paidMinor - totalMinor;

    let approvalRecord = null;
    if (requiresGate) {
      if (!input.approvalId) {
        throw new ConflictError('Prescription/restricted items require active pharmacist approval bound to this exact cart.', 'PHARMACIST_APPROVAL_REQUIRED', 'errors.pharmacist_approval_required');
      }
      approvalRecord = store.approvals.find((a) => a.tenantId === context.tenantId && a.id === input.approvalId) ?? null;
      if (!approvalRecord) throw new NotFoundError('Pharmacist checkout approval not found');
      if (approvalRecord.status !== 'active') throw new ConflictError(`Pharmacist approval is already ${approvalRecord.status}`);
      if (approvalRecord.expiresAt.getTime() < Date.now()) {
        approvalRecord.status = 'expired';
        throw new ConflictError('Pharmacist approval expired. Re-verify cart with pharmacist.', 'APPROVAL_EXPIRED');
      }
      if (approvalRecord.cartHash !== cartHash) {
        approvalRecord.status = 'invalidated';
        throw new ConflictError('Cart contents or discount changed after pharmacist approval. Approval invalidated; obtain fresh sign-off.', 'CART_HASH_MISMATCH', 'errors.cart_hash_mismatch');
      }
    }

    const activeRecalls = store.recalls.filter((r) => r.tenantId === context.tenantId && r.status === 'active');

    // Dry-run FEFO plan before mutating memory balances so insufficient stock fails cleanly
    const plannedAllocations: Array<{
      lineIdx: number;
      balance: (typeof store.inventoryBalances)[number];
      lot: (typeof store.lots)[number];
      layer: (typeof store.costLayers)[number];
      takeFromLayer: number;
    }> = [];
    const balanceRemaining = new Map<string, number>();
    const layerRemaining = new Map<string, number>();

    resolvedLines.forEach((line, lineIdx) => {
      const eligible = store.inventoryBalances
        .map((bal) => ({
          bal,
          lot: store.lots.find((l) => l.id === bal.lotId && l.tenantId === context.tenantId),
          loc: store.storageLocations.find((loc) => loc.id === bal.locationId && loc.tenantId === context.tenantId),
        }))
        .filter((b): b is { bal: typeof b.bal; lot: NonNullable<typeof b.lot>; loc: NonNullable<typeof b.loc> } => {
          if (!b.lot || !b.loc) return false;
          if (b.bal.tenantId !== context.tenantId || b.bal.branchId !== context.branchId) return false;
          if (b.bal.productId !== line.product.id) return false;
          if (b.loc.locationType === 'quarantine') return false;
          if (b.lot.qualityStatus !== 'released') return false;
          if (!b.lot.expiryCutoffDate || b.lot.expiryCutoffDate < todayColombo) return false;
          const recalled = activeRecalls.some(
            (r) =>
              (r.scopeType === 'product' && r.productId === b.lot!.productId) ||
              (r.scopeType === 'lot' && r.lotId === b.lot!.id) ||
              (r.scopeType === 'manufacturer' && r.manufacturer?.toLowerCase() === b.lot!.manufacturer.toLowerCase())
          );
          if (recalled) return false;
          const curFree = balanceRemaining.get(b.bal.id) ?? (b.bal.sellableOnHand - b.bal.reservedQty);
          return curFree > 0;
        })
        .sort((a, b) => (a.lot.expiryCutoffDate || '').localeCompare(b.lot.expiryCutoffDate || '') || a.lot.id.localeCompare(b.lot.id));

      let remaining = line.qtyBase;
      for (const cand of eligible) {
        if (remaining <= 0) break;
        const curFree = balanceRemaining.get(cand.bal.id) ?? (cand.bal.sellableOnHand - cand.bal.reservedQty);
        const takeBal = Math.min(remaining, curFree);
        const lotLayers = store.costLayers
          .filter((l) => l.tenantId === context.tenantId && l.lotId === cand.lot.id)
          .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
        let allocatedLot = 0;
        for (const layer of lotLayers) {
          if (allocatedLot >= takeBal) break;
          const curLayerRem = layerRemaining.get(layer.id) ?? layer.remainingQtyBase;
          if (curLayerRem <= 0) continue;
          const take = Math.min(takeBal - allocatedLot, curLayerRem);
          layerRemaining.set(layer.id, curLayerRem - take);
          allocatedLot += take;
          plannedAllocations.push({ lineIdx, balance: cand.bal, lot: cand.lot, layer, takeFromLayer: take });
        }
        if (allocatedLot > 0) {
          balanceRemaining.set(cand.bal.id, curFree - allocatedLot);
          remaining -= allocatedLot;
        }
      }
      if (remaining > 0) {
        throw new ConflictError(
          `Insufficient unexpired, released sellable stock for ${line.product.displayName} (short by ${remaining} ${line.product.baseUnit})`,
          'INSUFFICIENT_SELLABLE_STOCK',
          'errors.insufficient_stock'
        );
      }
    });

    const cmdId = crypto.randomUUID();
    const now = new Date();
    const saleNumber = `POS-${todayColombo.replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const sale = {
      id: crypto.randomUUID(), tenantId: context.tenantId, legalEntityId: context.legalEntityId!, branchId: context.branchId,
      counterId: shift.counterId, shiftId: shift.id, personId: input.personId ?? null, saleNumber, cartHash,
      approvalId: approvalRecord?.id ?? null, subtotalMinor, discountMinor: input.discountMinor, totalMinor, paidMinor, changeMinor,
      currency: context.currency, status: 'completed' as const, commandId: cmdId, cashierUserId: context.userId, soldAt: now, createdAt: now,
    };
    store.posSales.push(sale);

    const saleLineSummaries: Array<Record<string, unknown>> = [];
    resolvedLines.forEach((line, lineIdx) => {
      const saleLineId = crypto.randomUUID();
      store.posSaleLines.push({
        id: saleLineId, tenantId: context.tenantId, saleId: sale.id, productId: line.product.id,
        packVariantId: line.variant.id, uomConversionVersion: line.variant.currentConversionVersion,
        qtyPacks: line.qtyPacks, qtyBase: line.qtyBase, returnedQtyBase: 0,
        unitSalePriceMinor: line.unitSalePriceMinor, lineTotalMinor: line.lineTotalMinor,
        requiresPharmacistRelease: line.product.requiresPharmacistRelease, createdAt: now,
      });
      const lineAllocations: Array<Record<string, unknown>> = [];
      for (const p of plannedAllocations.filter((x) => x.lineIdx === lineIdx)) {
        p.layer.remainingQtyBase -= p.takeFromLayer;
        p.balance.sellableOnHand -= p.takeFromLayer;
        p.balance.version += 1;
        p.balance.updatedAt = now;
        store.posSaleAllocations.push({
          id: crypto.randomUUID(), tenantId: context.tenantId, saleId: sale.id, saleLineId,
          lotId: p.lot.id, costLayerId: p.layer.id, storageLocationId: p.balance.locationId,
          qtyBase: p.takeFromLayer, unitCostMinor: p.layer.unitCostMinor,
          totalCostMinor: p.takeFromLayer * p.layer.unitCostMinor, createdAt: now,
        });
        store.stockMovements.push({
          id: crypto.randomUUID(), tenantId: context.tenantId, branchId: context.branchId, locationId: p.balance.locationId,
          productId: line.product.id, lotId: p.lot.id, costLayerId: p.layer.id, movementType: 'pos_sale',
          qtyBase: p.takeFromLayer, fromBucket: 'sellable', toBucket: 'dispensed', reason: `POS sale ${saleNumber}`,
          sourceDocType: 'pos_sale', sourceDocId: sale.id, commandId: cmdId, packVariantId: line.variant.id,
          uomConversionVersion: line.variant.currentConversionVersion, actorUserId: context.userId, occurredAt: now, createdAt: now,
        });
        lineAllocations.push({
          lotId: p.lot.id, batchNumber: p.lot.batchNumber, printedExpiry: p.lot.printedExpiry,
          qtyBase: p.takeFromLayer, unitCostMinor: p.layer.unitCostMinor,
        });
      }
      saleLineSummaries.push({
        saleLineId, productName: line.product.displayName, variantName: line.variant.variantName,
        qtyPacks: line.qtyPacks, qtyBase: line.qtyBase, lineTotalMinor: line.lineTotalMinor, allocations: lineAllocations,
      });
    });

    let cashInDrawerDelta = 0;
    for (const p of input.payments) {
      store.posPayments.push({
        id: crypto.randomUUID(), tenantId: context.tenantId, saleId: sale.id,
        method: p.method, amountMinor: p.amountMinor, referenceNumber: (p.referenceNumber ?? '').trim(), createdAt: now,
      });
      if (p.method === 'cash') cashInDrawerDelta += p.amountMinor;
    }
    const netCashToShift = Math.max(0, cashInDrawerDelta - changeMinor);
    shift.cashSalesMinor += netCashToShift;
    shift.expectedCashMinor += netCashToShift;
    if (approvalRecord) {
      approvalRecord.status = 'consumed';
      approvalRecord.consumedAt = now;
    }

    const receiptNumber = `PRCP-${saleNumber.replace('POS-', '')}`;
    const receipt = {
      id: crypto.randomUUID(), tenantId: context.tenantId, saleId: sale.id, receiptNumber, issuedAt: now,
      snapshotJson: {
        receiptNumber, saleNumber, tenantName: context.tenantName, branchName: context.branchName,
        soldAt: sale.soldAt.toISOString(), subtotalMinor, discountMinor: input.discountMinor,
        totalMinor, paidMinor, changeMinor, currency: context.currency, lines: saleLineSummaries, payments: input.payments,
      },
    };
    store.posReceipts.push(receipt);

    const result = { sale, receipt, lines: saleLineSummaries };
    store.commands.push({
      id: cmdId, tenantId: context.tenantId, actorUserId: context.userId, commandType: 'pharmacy.pos.checkout',
      idempotencyKey: input.idempotencyKey, payloadHash: commandHash, proposalId: null, state: 'committed', resultJson: result, committedAt: now,
    });
    addMemAuditEvent({
      tenantId: context.tenantId, actorUserId: context.userId, actorUid: context.uid,
      action: 'pharmacy.pos.sale_completed', entityType: 'pos_sale', entityId: sale.id, correlationId,
      metadataJson: { saleNumber, receiptNumber, totalMinor, requiresGate, approvalId: approvalRecord?.id ?? null },
    });
    return result;
  }

  // 1. Idempotency check
  const [existingCmd] = await db
    .select()
    .from(commands)
    .where(
      and(
        eq(commands.tenantId, context.tenantId),
        eq(commands.actorUserId, context.userId),
        eq(commands.commandType, 'pharmacy.pos.checkout'),
        eq(commands.idempotencyKey, input.idempotencyKey)
      )
    )
    .limit(1);

  if (existingCmd && existingCmd.state === 'committed' && existingCmd.resultJson) {
    if (existingCmd.payloadHash !== commandHash) {
      throw new ConflictError('Idempotency key already used with different POS checkout payload');
    }
    return existingCmd.resultJson;
  }

  try {
    return await db.transaction(async (tx) => {
    const [cmd] = await tx
      .insert(commands)
      .values({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        commandType: 'pharmacy.pos.checkout',
        idempotencyKey: input.idempotencyKey,
        payloadHash: commandHash,
        state: 'accepted',
      })
      .returning();

    // 2. Lock open till shift
    const shiftRows = await tx
      .select()
      .from(tillShifts)
      .where(
        and(
          eq(tillShifts.tenantId, context.tenantId),
          eq(tillShifts.branchId, context.branchId),
          eq(tillShifts.id, input.shiftId)
        )
      )
      .for('update');
    const shift = shiftRows[0];
    if (!shift) throw new NotFoundError('Till shift not found');
    if (shift.status !== 'open') {
      throw new ConflictError('Cannot complete POS sale on a closed till shift');
    }

    // 3. Resolve products & pack variants
    const productIds = Array.from(new Set(input.items.map((i) => i.productId)));
    const variantIds = Array.from(new Set(input.items.map((i) => i.packVariantId)));

    const productRows = await tx
      .select()
      .from(products)
      .where(and(eq(products.tenantId, context.tenantId), inArray(products.id, productIds)));
    const productMap = new Map(productRows.map((p) => [p.id, p]));

    const variantRows = await tx
      .select()
      .from(packVariants)
      .where(
        and(eq(packVariants.tenantId, context.tenantId), inArray(packVariants.id, variantIds))
      );
    const variantMap = new Map(variantRows.map((v) => [v.id, v]));

    let subtotalMinor = 0;
    let requiresGate = false;

    const resolvedLines = input.items.map((item) => {
      const product = productMap.get(item.productId);
      if (!product || !product.active) {
        throw new NotFoundError(`Product ${item.productId} not found or inactive`);
      }
      const variant = variantMap.get(item.packVariantId);
      if (!variant || variant.productId !== product.id || !variant.allowPosSale) {
        throw new ValidationError(`Pack variant is unavailable for POS sale (${product.displayName})`);
      }
      const unitSalePriceMinor = item.unitSalePriceMinor ?? variant.defaultSalePriceMinor;
      const lineTotalMinor = unitSalePriceMinor * item.qtyPacks;
      const qtyBase = item.qtyPacks * variant.currentBaseQty;
      subtotalMinor += lineTotalMinor;
      if (product.requiresPharmacistRelease) {
        requiresGate = true;
      }
      return {
        product,
        variant,
        qtyPacks: item.qtyPacks,
        qtyBase,
        unitSalePriceMinor,
        lineTotalMinor,
      };
    });

    if (input.discountMinor > subtotalMinor) {
      throw new ValidationError('Discount cannot exceed subtotal');
    }
    const discountPercent =
      subtotalMinor > 0 ? Math.round((input.discountMinor / subtotalMinor) * 100) : 0;
    await assertGovernancePinIfRequired(
      context,
      {
        type: 'pos_discount',
        discountPercent,
        managerOverridePin: input.managerOverridePin,
      },
      correlationId
    );
    const totalMinor = subtotalMinor - input.discountMinor;
    const paidMinor = input.payments.reduce((acc, p) => acc + p.amountMinor, 0);
    if (paidMinor < totalMinor) {
      throw new ValidationError(
        `Insufficient payment tendered (${paidMinor} < ${totalMinor})`,
        'errors.insufficient_payment'
      );
    }
    const changeMinor = paidMinor - totalMinor;

    // 4. Cart-Hash-Bound Pharmacist Checkout Gate (P10-P11)
    let consumedApprovalId: string | null = null;
    if (requiresGate) {
      if (!input.approvalId) {
        throw new ConflictError(
          'Prescription/restricted items require active pharmacist approval bound to this exact cart.',
          'PHARMACIST_APPROVAL_REQUIRED',
          'errors.pharmacist_approval_required'
        );
      }
      const approvalRows = await tx
        .select()
        .from(pharmacistCheckoutApprovals)
        .where(
          and(
            eq(pharmacistCheckoutApprovals.tenantId, context.tenantId),
            eq(pharmacistCheckoutApprovals.id, input.approvalId)
          )
        )
        .for('update');
      const approval = approvalRows[0];
      if (!approval) {
        throw new NotFoundError('Pharmacist checkout approval not found');
      }
      if (approval.status !== 'active') {
        throw new ConflictError(`Pharmacist approval is already ${approval.status}`);
      }
      if (approval.expiresAt.getTime() < Date.now()) {
        throw new ConflictError(
          'Pharmacist approval expired. Re-verify cart with pharmacist.',
          'APPROVAL_EXPIRED'
        );
      }
      if (approval.cartHash !== cartHash) {
        throw new ConflictError(
          'Cart contents or discount changed after pharmacist approval. Approval invalidated; obtain fresh sign-off.',
          'CART_HASH_MISMATCH',
          'errors.cart_hash_mismatch'
        );
      }
      consumedApprovalId = approval.id;
    }

    // 5. Active recalls check
    const activeRecalls = await tx
      .select()
      .from(recalls)
      .where(and(eq(recalls.tenantId, context.tenantId), eq(recalls.status, 'active')));

    // 6. Lock candidate inventory balances deterministically (tenant_id, lot_id ASC) for FEFO allocation
    // Ordering lock acquisition by lotId ASC prevents deadlocks across concurrent cashiers (P05)
    const candidateBalances = await tx
      .select({
        balance: inventoryBalances,
        lot: lots,
        locationType: storageLocations.locationType,
      })
      .from(inventoryBalances)
      .innerJoin(
        lots,
        and(eq(inventoryBalances.lotId, lots.id), eq(lots.tenantId, inventoryBalances.tenantId))
      )
      .innerJoin(
        storageLocations,
        and(
          eq(inventoryBalances.locationId, storageLocations.id),
          eq(storageLocations.tenantId, inventoryBalances.tenantId)
        )
      )
      .where(
        and(
          eq(inventoryBalances.tenantId, context.tenantId),
          eq(inventoryBalances.branchId, context.branchId),
          inArray(inventoryBalances.productId, productIds),
          sql`${inventoryBalances.sellableOnHand} > ${inventoryBalances.reservedQty}`
        )
      )
      .orderBy(asc(inventoryBalances.lotId), asc(inventoryBalances.locationId))
      .for('update', { of: inventoryBalances });

    // Lock eligible cost layers deterministically
    const lotIds = Array.from(new Set(candidateBalances.map((r) => r.lot.id)));
    const layerRows =
      lotIds.length > 0
        ? await tx
            .select()
            .from(costLayers)
            .where(
              and(
                eq(costLayers.tenantId, context.tenantId),
                inArray(costLayers.lotId, lotIds),
                sql`${costLayers.remainingQtyBase} > 0`
              )
            )
            .orderBy(asc(costLayers.receivedAt), asc(costLayers.id))
            .for('update')
        : [];

    const layersByLot = new Map<string, Array<(typeof layerRows)[number]>>();
    for (const l of layerRows) {
      const list = layersByLot.get(l.lotId) ?? [];
      list.push(l);
      layersByLot.set(l.lotId, list);
    }

    // 7. Create POS Sale Header
    const businessDate = getBusinessDateInTimezone(context.timezone);
    const saleNumber = `POS-${businessDate.replace(/-/g, '')}-${crypto
      .randomBytes(3)
      .toString('hex')
      .toUpperCase()}`;

    const [sale] = await tx
      .insert(posSales)
      .values({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId!,
        branchId: context.branchId,
        counterId: shift.counterId,
        shiftId: shift.id,
        personId: input.personId ?? null,
        saleNumber,
        cartHash,
        approvalId: consumedApprovalId,
        subtotalMinor,
        discountMinor: input.discountMinor,
        totalMinor,
        paidMinor,
        changeMinor,
        currency: context.currency,
        status: 'completed',
        commandId: cmd.id,
        cashierUserId: context.userId,
      })
      .returning();

    // 8. Allocate each cart item using strict FEFO (earliest unexpired released lot first)
    const saleLineSummaries: Array<Record<string, unknown>> = [];

    for (const line of resolvedLines) {
      const [saleLine] = await tx
        .insert(posSaleLines)
        .values({
          tenantId: context.tenantId,
          saleId: sale.id,
          productId: line.product.id,
          packVariantId: line.variant.id,
          uomConversionVersion: line.variant.currentConversionVersion,
          qtyPacks: line.qtyPacks,
          qtyBase: line.qtyBase,
          unitSalePriceMinor: line.unitSalePriceMinor,
          lineTotalMinor: line.lineTotalMinor,
          requiresPharmacistRelease: line.product.requiresPharmacistRelease,
        })
        .returning();

      // Filter eligible sellable balances & sort strictly by FEFO (earliest expiryCutoffDate ASC)
      const eligible = candidateBalances
        .filter((b) => {
          if (b.balance.productId !== line.product.id) return false;
          if (b.locationType === 'quarantine') return false;
          if (b.lot.qualityStatus !== 'released') return false;
          if (!b.lot.expiryCutoffDate || b.lot.expiryCutoffDate < todayColombo) return false;
          const recalled = activeRecalls.some(
            (r) =>
              (r.scopeType === 'product' && r.productId === b.lot.productId) ||
              (r.scopeType === 'lot' && r.lotId === b.lot.id) ||
              (r.scopeType === 'manufacturer' &&
                r.manufacturer?.toLowerCase() === b.lot.manufacturer.toLowerCase())
          );
          if (recalled) return false;
          return b.balance.sellableOnHand - b.balance.reservedQty > 0;
        })
        .sort((a, b) => {
          const expCmp = (a.lot.expiryCutoffDate || '').localeCompare(
            b.lot.expiryCutoffDate || ''
          );
          if (expCmp !== 0) return expCmp;
          return a.lot.id.localeCompare(b.lot.id);
        });

      let remainingToAllocate = line.qtyBase;
      const lineAllocations: Array<Record<string, unknown>> = [];

      for (const cand of eligible) {
        if (remainingToAllocate <= 0) break;
        const freeQty = cand.balance.sellableOnHand - cand.balance.reservedQty;
        if (freeQty <= 0) continue;

        const takeFromBalance = Math.min(remainingToAllocate, freeQty);
        const lotLayers = layersByLot.get(cand.lot.id) ?? [];
        let allocatedFromLot = 0;

        for (const layer of lotLayers) {
          if (allocatedFromLot >= takeFromBalance) break;
          if (layer.remainingQtyBase <= 0) continue;
          const takeFromLayer = Math.min(takeFromBalance - allocatedFromLot, layer.remainingQtyBase);

          layer.remainingQtyBase -= takeFromLayer;
          allocatedFromLot += takeFromLayer;

          await tx
            .update(costLayers)
            .set({ remainingQtyBase: layer.remainingQtyBase })
            .where(eq(costLayers.id, layer.id));

          await tx.insert(posSaleAllocations).values({
            tenantId: context.tenantId,
            saleId: sale.id,
            saleLineId: saleLine.id,
            lotId: cand.lot.id,
            costLayerId: layer.id,
            storageLocationId: cand.balance.locationId,
            qtyBase: takeFromLayer,
            unitCostMinor: layer.unitCostMinor,
            totalCostMinor: takeFromLayer * layer.unitCostMinor,
          });

          lineAllocations.push({
            lotId: cand.lot.id,
            batchNumber: cand.lot.batchNumber,
            printedExpiry: cand.lot.printedExpiry,
            qtyBase: takeFromLayer,
            unitCostMinor: layer.unitCostMinor,
          });
        }

        if (allocatedFromLot === 0) continue;

        cand.balance.sellableOnHand -= allocatedFromLot;
        cand.balance.version += 1;

        await tx
          .update(inventoryBalances)
          .set({
            sellableOnHand: cand.balance.sellableOnHand,
            version: cand.balance.version,
            updatedAt: new Date(),
          })
          .where(eq(inventoryBalances.id, cand.balance.id));

        await tx.insert(stockMovements).values({
          tenantId: context.tenantId,
          branchId: context.branchId,
          locationId: cand.balance.locationId,
          productId: line.product.id,
          lotId: cand.lot.id,
          movementType: 'pos_sale',
          qtyBase: allocatedFromLot,
          fromBucket: 'sellable',
          toBucket: 'dispensed',
          reason: `POS sale ${saleNumber}`,
          sourceDocType: 'pos_sale',
          sourceDocId: sale.id,
          commandId: cmd.id,
          packVariantId: line.variant.id,
          uomConversionVersion: line.variant.currentConversionVersion,
          actorUserId: context.userId,
        });

        remainingToAllocate -= allocatedFromLot;
      }

      if (remainingToAllocate > 0) {
        throw new ConflictError(
          `Insufficient unexpired, released sellable stock for ${line.product.displayName} (short by ${remainingToAllocate} ${line.product.baseUnit})`,
          'INSUFFICIENT_SELLABLE_STOCK',
          'errors.insufficient_stock'
        );
      }

      saleLineSummaries.push({
        saleLineId: saleLine.id,
        productName: line.product.displayName,
        variantName: line.variant.variantName,
        qtyPacks: line.qtyPacks,
        qtyBase: line.qtyBase,
        lineTotalMinor: line.lineTotalMinor,
        allocations: lineAllocations,
      });
    }

    // 9. Record split payments + update shift expected cash (net cash tendered minus change)
    let cashInDrawerDelta = 0;
    for (const p of input.payments) {
      await tx.insert(posPayments).values({
        tenantId: context.tenantId,
        saleId: sale.id,
        method: p.method,
        amountMinor: p.amountMinor,
        referenceNumber: (p.referenceNumber ?? '').trim(),
      });
      if (p.method === 'cash') {
        cashInDrawerDelta += p.amountMinor;
      }
    }
    const netCashToShift = Math.max(0, cashInDrawerDelta - changeMinor);

    await tx
      .update(tillShifts)
      .set({
        cashSalesMinor: shift.cashSalesMinor + netCashToShift,
        expectedCashMinor: shift.expectedCashMinor + netCashToShift,
      })
      .where(eq(tillShifts.id, shift.id));

    if (consumedApprovalId) {
      await tx
        .update(pharmacistCheckoutApprovals)
        .set({ status: 'consumed', consumedAt: new Date() })
        .where(eq(pharmacistCheckoutApprovals.id, consumedApprovalId));
    }

    // 10. Issue immutable POS Receipt
    const receiptNumber = `PRCP-${saleNumber.replace('POS-', '')}`;
    const receiptSnapshot = {
      receiptNumber,
      saleNumber,
      tenantName: context.tenantName,
      branchName: context.branchName,
      soldAt: sale.soldAt.toISOString(),
      subtotalMinor,
      discountMinor: input.discountMinor,
      totalMinor,
      paidMinor,
      changeMinor,
      currency: context.currency,
      lines: saleLineSummaries,
      payments: input.payments,
    };

    const [receipt] = await tx
      .insert(posReceipts)
      .values({
        tenantId: context.tenantId,
        saleId: sale.id,
        receiptNumber,
        snapshotJson: receiptSnapshot,
      })
      .returning();

    const result = { sale, receipt, lines: saleLineSummaries };

    await tx
      .update(commands)
      .set({ state: 'committed', resultJson: result, committedAt: new Date() })
      .where(eq(commands.id, cmd.id));

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.pos.sale_completed',
      entityType: 'pos_sale',
      entityId: sale.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: {
        saleNumber,
        receiptNumber,
        totalMinor,
        requiresGate,
        approvalId: consumedApprovalId,
      },
    });

    await tx.insert(outboxEvents).values({
      tenantId: context.tenantId,
      eventType: 'pharmacy.pos.sale_completed',
      payloadJson: { saleId: sale.id, saleNumber, totalMinor },
    });

      return result;
    });
  } catch (error) {
    if (error instanceof ConflictError && input.approvalId) {
      if (error.code === 'CART_HASH_MISMATCH') {
        await db
          .update(pharmacistCheckoutApprovals)
          .set({ status: 'invalidated' })
          .where(
            and(
              eq(pharmacistCheckoutApprovals.tenantId, context.tenantId),
              eq(pharmacistCheckoutApprovals.id, input.approvalId)
            )
          );
      } else if (error.code === 'APPROVAL_EXPIRED') {
        await db
          .update(pharmacistCheckoutApprovals)
          .set({ status: 'expired' })
          .where(
            and(
              eq(pharmacistCheckoutApprovals.tenantId, context.tenantId),
              eq(pharmacistCheckoutApprovals.id, input.approvalId)
            )
          );
      }
    }
    throw error;
  }
}

export async function listPosSales(context: ActiveWorkspaceContext) {
  assertCapability(context, 'pharmacy.pos');
  assertPermission(context, 'pharmacy.stock.read');

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const sales = store.posSales
      .filter((s) => s.tenantId === context.tenantId && s.branchId === context.branchId)
      .sort((a, b) => b.soldAt.getTime() - a.soldAt.getTime())
      .slice(0, 25);
    return {
      sales: sales.map((s) => ({
        ...s,
        receipt: store.posReceipts.find((r) => r.saleId === s.id && r.tenantId === context.tenantId) ?? null,
        lines: store.posSaleLines
          .filter((l) => l.saleId === s.id && l.tenantId === context.tenantId)
          .map((l) => {
            const p = store.products.find((prod) => prod.id === l.productId);
            return { ...l, productName: p?.displayName ?? 'Product', baseUnit: p?.baseUnit ?? 'unit' };
          }),
      })),
    };
  }

  const sales = await db
    .select()
    .from(posSales)
    .where(and(eq(posSales.tenantId, context.tenantId), eq(posSales.branchId, context.branchId)))
    .orderBy(desc(posSales.soldAt))
    .limit(25);

  if (sales.length === 0) return { sales: [] };

  const saleIds = sales.map((s) => s.id);
  const lines = await db
    .select({
      line: posSaleLines,
      productName: products.displayName,
      baseUnit: products.baseUnit,
    })
    .from(posSaleLines)
    .innerJoin(
      products,
      and(eq(posSaleLines.productId, products.id), eq(products.tenantId, posSaleLines.tenantId))
    )
    .where(and(eq(posSaleLines.tenantId, context.tenantId), inArray(posSaleLines.saleId, saleIds)));

  const receiptRows = await db
    .select()
    .from(posReceipts)
    .where(and(eq(posReceipts.tenantId, context.tenantId), inArray(posReceipts.saleId, saleIds)));

  const linesBySale = new Map<string, typeof lines>();
  for (const l of lines) {
    const arr = linesBySale.get(l.line.saleId) ?? [];
    arr.push(l);
    linesBySale.set(l.line.saleId, arr);
  }
  const receiptBySale = new Map(receiptRows.map((r) => [r.saleId, r]));

  return {
    sales: sales.map((s) => ({
      ...s,
      receipt: receiptBySale.get(s.id) ?? null,
      lines: (linesBySale.get(s.id) ?? []).map((entry) => ({
        ...entry.line,
        productName: entry.productName,
        baseUnit: entry.baseUnit,
      })),
    })),
  };
}

// ------------------------------------------------------------
// 4. Customer Returns (Strictly routes to returnedQuarantineQty — NEVER auto-sellable)
// ------------------------------------------------------------
export async function createPosReturn(
  context: ActiveWorkspaceContext,
  saleId: string,
  input: CreatePosReturnInput,
  correlationId: string
) {
  assertCapability(context, 'pharmacy.returns');
  assertCapability(context, 'pharmacy.inventory');
  assertPermission(context, 'pharmacy.pos.sell');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const payloadHash = crypto
    .createHash('sha256')
    .update(JSON.stringify({ saleId, ...input }))
    .digest('hex');

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const existingCmd = store.commands.find(
      (c) => c.tenantId === context.tenantId && c.actorUserId === context.userId && c.commandType === 'pharmacy.pos.return' && c.idempotencyKey === input.idempotencyKey
    );
    if (existingCmd && existingCmd.state === 'committed' && existingCmd.resultJson) return existingCmd.resultJson;

    const sale = store.posSales.find((s) => s.tenantId === context.tenantId && s.id === saleId);
    if (!sale) throw new NotFoundError('POS sale not found');
    const shift = store.tillShifts.find((s) => s.tenantId === context.tenantId && s.branchId === context.branchId && s.id === input.shiftId);
    if (!shift || shift.status !== 'open') throw new ConflictError('An open till shift is required to process a refund');

    const saleLines = store.posSaleLines.filter((l) => l.tenantId === context.tenantId && l.saleId === sale.id);
    const allocs = store.posSaleAllocations.filter((a) => a.tenantId === context.tenantId && a.saleId === sale.id);

    const priorReturns = store.posReturns.filter(
      (r) => r.tenantId === context.tenantId && r.saleId === sale.id
    );
    const priorRefundedMinor = priorReturns.reduce((s, r) => s + r.refundAmountMinor, 0);

    const requestedByLine = new Map<string, number>();
    let rawTotalRefundMinor = 0;
    const returnItemsPrep: Array<{
      saleLine: (typeof saleLines)[number];
      qtyBase: number;
      refundMinor: number;
      lotId: string;
      storageLocationId: string;
    }> = [];

    for (const reqLine of input.lines) {
      if (reqLine.qtyBase <= 0) {
        throw new ValidationError('Return quantity must be positive');
      }
      const saleLine = saleLines.find((l) => l.id === reqLine.saleLineId);
      if (!saleLine) throw new NotFoundError('POS sale line not found');

      const priorBatchQty = requestedByLine.get(saleLine.id) ?? 0;
      const remainingReturnable = saleLine.qtyBase - saleLine.returnedQtyBase - priorBatchQty;
      if (reqLine.qtyBase > remainingReturnable) {
        throw new ConflictError(
          `Return quantity (${reqLine.qtyBase}) exceeds remaining returnable quantity (${remainingReturnable})`
        );
      }
      requestedByLine.set(saleLine.id, priorBatchQty + reqLine.qtyBase);

      const lineAllocs = allocs.filter((a) => a.saleLineId === saleLine.id);
      if (lineAllocs.length === 0) {
        throw new NotFoundError('Original lot allocation for sale line not found');
      }

      const rawLineRefundMinor = Math.round((saleLine.lineTotalMinor * reqLine.qtyBase) / saleLine.qtyBase);
      rawTotalRefundMinor += rawLineRefundMinor;

      let offset = saleLine.returnedQtyBase + priorBatchQty;
      let remainingToAllocate = reqLine.qtyBase;
      const lineChunks: Array<{ lotId: string; storageLocationId: string; qtyBase: number }> = [];
      for (const a of lineAllocs) {
        const skip = Math.min(a.qtyBase, offset);
        offset -= skip;
        const availableCap = a.qtyBase - skip;
        if (availableCap <= 0 || remainingToAllocate <= 0) continue;
        const take = Math.min(availableCap, remainingToAllocate);
        lineChunks.push({ lotId: a.lotId, storageLocationId: a.storageLocationId, qtyBase: take });
        remainingToAllocate -= take;
        if (remainingToAllocate <= 0) break;
      }
      if (remainingToAllocate > 0) {
        throw new NotFoundError('Original lot allocation for sale line not found');
      }

      let allocatedRefund = 0;
      lineChunks.forEach((chunk, idx) => {
        const isLast = idx === lineChunks.length - 1;
        const chunkRefund = isLast
          ? rawLineRefundMinor - allocatedRefund
          : Math.round((rawLineRefundMinor * chunk.qtyBase) / reqLine.qtyBase);
        allocatedRefund += chunkRefund;
        returnItemsPrep.push({
          saleLine,
          qtyBase: chunk.qtyBase,
          refundMinor: chunkRefund,
          lotId: chunk.lotId,
          storageLocationId: chunk.storageLocationId,
        });
      });
    }

    const maxRemainingRefundMinor = Math.max(0, sale.totalMinor - priorRefundedMinor);
    const totalRefundMinor = Math.min(rawTotalRefundMinor, maxRemainingRefundMinor);
    if (totalRefundMinor < rawTotalRefundMinor && rawTotalRefundMinor > 0 && returnItemsPrep.length > 0) {
      let runningScaled = 0;
      returnItemsPrep.forEach((item, idx) => {
        const isLast = idx === returnItemsPrep.length - 1;
        const scaled = isLast
          ? totalRefundMinor - runningScaled
          : Math.round((item.refundMinor * totalRefundMinor) / rawTotalRefundMinor);
        item.refundMinor = scaled;
        runningScaled += scaled;
      });
    }

    const businessDate = getBusinessDateInTimezone(context.timezone);
    const returnNumber = `RET-${businessDate.replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const cmdId = crypto.randomUUID();
    const now = new Date();
    const posReturn = {
      id: crypto.randomUUID(), tenantId: context.tenantId, branchId: context.branchId, saleId: sale.id, shiftId: shift.id,
      returnNumber, reason: input.reason.trim(), refundMethod: input.refundMethod, refundAmountMinor: totalRefundMinor,
      currency: sale.currency, commandId: cmdId, processedByUserId: context.userId, returnedAt: now,
    };
    store.posReturns.push(posReturn);

    for (const item of returnItemsPrep) {
      item.saleLine.returnedQtyBase += item.qtyBase;
      const bal = store.inventoryBalances.find(
        (b) => b.tenantId === context.tenantId && b.branchId === context.branchId && b.locationId === item.storageLocationId && b.productId === item.saleLine.productId && b.lotId === item.lotId
      );
      if (!bal) {
        store.inventoryBalances.push({
          id: crypto.randomUUID(), tenantId: context.tenantId, branchId: context.branchId, locationId: item.storageLocationId,
          productId: item.saleLine.productId, lotId: item.lotId, sellableOnHand: 0, reservedQty: 0,
          quarantineQty: 0, returnedQuarantineQty: item.qtyBase, damagedQty: 0, expiredQty: 0, recalledQty: 0, disposedQty: 0, version: 1, updatedAt: now,
        });
      } else {
        bal.returnedQuarantineQty += item.qtyBase;
        bal.version += 1;
        bal.updatedAt = now;
      }
      store.stockMovements.push({
        id: crypto.randomUUID(), tenantId: context.tenantId, branchId: context.branchId, locationId: item.storageLocationId,
        productId: item.saleLine.productId, lotId: item.lotId, costLayerId: null, movementType: 'customer_return_quarantine',
        qtyBase: item.qtyBase, fromBucket: 'customer', toBucket: 'returned_quarantine', reason: input.reason.trim(),
        sourceDocType: 'pos_return', sourceDocId: posReturn.id, commandId: cmdId, packVariantId: null, uomConversionVersion: null,
        actorUserId: context.userId, occurredAt: now, createdAt: now,
      });
    }

    sale.status = saleLines.every((l) => l.returnedQtyBase >= l.qtyBase) ? 'returned' : 'partially_returned';
    if (input.refundMethod === 'cash') {
      shift.cashRefundsMinor += totalRefundMinor;
      shift.expectedCashMinor -= totalRefundMinor;
    }

    const result = { posReturn, refundAmountMinor: totalRefundMinor };
    store.commands.push({
      id: cmdId, tenantId: context.tenantId, actorUserId: context.userId, commandType: 'pharmacy.pos.return',
      idempotencyKey: input.idempotencyKey, payloadHash, proposalId: null, state: 'committed', resultJson: result, committedAt: now,
    });
    addMemAuditEvent({
      tenantId: context.tenantId, actorUserId: context.userId, actorUid: context.uid,
      action: 'pharmacy.pos.return_processed', entityType: 'pos_return', entityId: posReturn.id, correlationId,
      metadataJson: { returnNumber, saleId: sale.id, refundAmountMinor: totalRefundMinor, routedTo: 'returned_quarantine' },
    });
    return result;
  }

  const [existingCmd] = await db
    .select()
    .from(commands)
    .where(
      and(
        eq(commands.tenantId, context.tenantId),
        eq(commands.actorUserId, context.userId),
        eq(commands.commandType, 'pharmacy.pos.return'),
        eq(commands.idempotencyKey, input.idempotencyKey)
      )
    )
    .limit(1);

  if (existingCmd && existingCmd.state === 'committed' && existingCmd.resultJson) {
    return existingCmd.resultJson;
  }

  return db.transaction(async (tx) => {
    const [cmd] = await tx
      .insert(commands)
      .values({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        commandType: 'pharmacy.pos.return',
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        state: 'accepted',
      })
      .returning();

    const [sale] = await tx
      .select()
      .from(posSales)
      .where(and(eq(posSales.tenantId, context.tenantId), eq(posSales.id, saleId)))
      .for('update');
    if (!sale) throw new NotFoundError('POS sale not found');

    const [shift] = await tx
      .select()
      .from(tillShifts)
      .where(
        and(
          eq(tillShifts.tenantId, context.tenantId),
          eq(tillShifts.branchId, context.branchId),
          eq(tillShifts.id, input.shiftId)
        )
      )
      .for('update');
    if (!shift || shift.status !== 'open') {
      throw new ConflictError('An open till shift is required to process a refund');
    }

    const saleLines = await tx
      .select()
      .from(posSaleLines)
      .where(and(eq(posSaleLines.tenantId, context.tenantId), eq(posSaleLines.saleId, sale.id)))
      .for('update');
    const lineMap = new Map(saleLines.map((l) => [l.id, l]));

    const allocs = await tx
      .select()
      .from(posSaleAllocations)
      .where(
        and(eq(posSaleAllocations.tenantId, context.tenantId), eq(posSaleAllocations.saleId, sale.id))
      );

    const priorReturns = await tx
      .select({ refundAmountMinor: posReturns.refundAmountMinor })
      .from(posReturns)
      .where(and(eq(posReturns.tenantId, context.tenantId), eq(posReturns.saleId, sale.id)));
    const priorRefundedMinor = priorReturns.reduce((s, r) => s + r.refundAmountMinor, 0);

    const requestedByLine = new Map<string, number>();
    let rawTotalRefundMinor = 0;
    const returnItemsPrep: Array<{
      saleLine: (typeof saleLines)[number];
      qtyBase: number;
      refundMinor: number;
      lotId: string;
      storageLocationId: string;
    }> = [];

    for (const reqLine of input.lines) {
      if (reqLine.qtyBase <= 0) {
        throw new ValidationError('Return quantity must be positive');
      }
      const saleLine = lineMap.get(reqLine.saleLineId);
      if (!saleLine) throw new NotFoundError('POS sale line not found');
      const priorBatchQty = requestedByLine.get(saleLine.id) ?? 0;
      const remainingReturnable = saleLine.qtyBase - saleLine.returnedQtyBase - priorBatchQty;
      if (reqLine.qtyBase > remainingReturnable) {
        throw new ConflictError(
          `Return quantity (${reqLine.qtyBase}) exceeds remaining returnable quantity (${remainingReturnable})`
        );
      }
      requestedByLine.set(saleLine.id, priorBatchQty + reqLine.qtyBase);

      const lineAllocs = allocs.filter((a) => a.saleLineId === saleLine.id);
      if (lineAllocs.length === 0) {
        throw new NotFoundError('Original lot allocation for sale line not found');
      }

      const rawLineRefundMinor = Math.round((saleLine.lineTotalMinor * reqLine.qtyBase) / saleLine.qtyBase);
      rawTotalRefundMinor += rawLineRefundMinor;

      let offset = saleLine.returnedQtyBase + priorBatchQty;
      let remainingToAllocate = reqLine.qtyBase;
      const lineChunks: Array<{ lotId: string; storageLocationId: string; qtyBase: number }> = [];
      for (const a of lineAllocs) {
        const skip = Math.min(a.qtyBase, offset);
        offset -= skip;
        const availableCap = a.qtyBase - skip;
        if (availableCap <= 0 || remainingToAllocate <= 0) continue;
        const take = Math.min(availableCap, remainingToAllocate);
        lineChunks.push({ lotId: a.lotId, storageLocationId: a.storageLocationId, qtyBase: take });
        remainingToAllocate -= take;
        if (remainingToAllocate <= 0) break;
      }
      if (remainingToAllocate > 0) {
        throw new NotFoundError('Original lot allocation for sale line not found');
      }

      let allocatedRefund = 0;
      lineChunks.forEach((chunk, idx) => {
        const isLast = idx === lineChunks.length - 1;
        const chunkRefund = isLast
          ? rawLineRefundMinor - allocatedRefund
          : Math.round((rawLineRefundMinor * chunk.qtyBase) / reqLine.qtyBase);
        allocatedRefund += chunkRefund;
        returnItemsPrep.push({
          saleLine,
          qtyBase: chunk.qtyBase,
          refundMinor: chunkRefund,
          lotId: chunk.lotId,
          storageLocationId: chunk.storageLocationId,
        });
      });
    }

    const maxRemainingRefundMinor = Math.max(0, sale.totalMinor - priorRefundedMinor);
    const totalRefundMinor = Math.min(rawTotalRefundMinor, maxRemainingRefundMinor);
    if (totalRefundMinor < rawTotalRefundMinor && rawTotalRefundMinor > 0 && returnItemsPrep.length > 0) {
      let runningScaled = 0;
      returnItemsPrep.forEach((item, idx) => {
        const isLast = idx === returnItemsPrep.length - 1;
        const scaled = isLast
          ? totalRefundMinor - runningScaled
          : Math.round((item.refundMinor * totalRefundMinor) / rawTotalRefundMinor);
        item.refundMinor = scaled;
        runningScaled += scaled;
      });
    }

    const businessDate = getBusinessDateInTimezone(context.timezone);
    const returnNumber = `RET-${businessDate.replace(/-/g, '')}-${crypto
      .randomBytes(3)
      .toString('hex')
      .toUpperCase()}`;

    const [posReturn] = await tx
      .insert(posReturns)
      .values({
        tenantId: context.tenantId,
        branchId: context.branchId,
        saleId: sale.id,
        shiftId: shift.id,
        returnNumber,
        reason: input.reason.trim(),
        refundMethod: input.refundMethod,
        refundAmountMinor: totalRefundMinor,
        currency: sale.currency,
        commandId: cmd.id,
        processedByUserId: context.userId,
      })
      .returning();

    for (const item of returnItemsPrep) {
      await tx.insert(posReturnLines).values({
        tenantId: context.tenantId,
        returnId: posReturn.id,
        saleLineId: item.saleLine.id,
        productId: item.saleLine.productId,
        lotId: item.lotId,
        storageLocationId: item.storageLocationId,
        qtyBase: item.qtyBase,
        refundMinor: item.refundMinor,
      });

      await tx
        .update(posSaleLines)
        .set({ returnedQtyBase: item.saleLine.returnedQtyBase + item.qtyBase })
        .where(eq(posSaleLines.id, item.saleLine.id));
      item.saleLine.returnedQtyBase += item.qtyBase;

      // CRITICAL SAFETY INVARIANT (P13, U17):
      // Returned items strictly increment returnedQuarantineQty and NEVER sellableOnHand!
      const [bal] = await tx
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, context.tenantId),
            eq(inventoryBalances.branchId, context.branchId),
            eq(inventoryBalances.locationId, item.storageLocationId),
            eq(inventoryBalances.productId, item.saleLine.productId),
            eq(inventoryBalances.lotId, item.lotId)
          )
        )
        .for('update');

      if (!bal) {
        await tx.insert(inventoryBalances).values({
          tenantId: context.tenantId,
          branchId: context.branchId,
          locationId: item.storageLocationId,
          productId: item.saleLine.productId,
          lotId: item.lotId,
          returnedQuarantineQty: item.qtyBase,
        });
      } else {
        await tx
          .update(inventoryBalances)
          .set({
            returnedQuarantineQty: bal.returnedQuarantineQty + item.qtyBase,
            version: bal.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(inventoryBalances.id, bal.id));
      }

      await tx.insert(stockMovements).values({
        tenantId: context.tenantId,
        branchId: context.branchId,
        locationId: item.storageLocationId,
        productId: item.saleLine.productId,
        lotId: item.lotId,
        movementType: 'customer_return_quarantine',
        qtyBase: item.qtyBase,
        fromBucket: 'customer',
        toBucket: 'returned_quarantine',
        reason: input.reason.trim(),
        sourceDocType: 'pos_return',
        sourceDocId: posReturn.id,
        commandId: cmd.id,
        actorUserId: context.userId,
      });
    }

    const allReturned = saleLines.every((l) => l.returnedQtyBase >= l.qtyBase);
    await tx
      .update(posSales)
      .set({ status: allReturned ? 'returned' : 'partially_returned' })
      .where(eq(posSales.id, sale.id));

    if (input.refundMethod === 'cash') {
      await tx
        .update(tillShifts)
        .set({
          cashRefundsMinor: shift.cashRefundsMinor + totalRefundMinor,
          expectedCashMinor: shift.expectedCashMinor - totalRefundMinor,
        })
        .where(eq(tillShifts.id, shift.id));
    }

    const result = { posReturn, refundAmountMinor: totalRefundMinor };

    await tx
      .update(commands)
      .set({ state: 'committed', resultJson: result, committedAt: new Date() })
      .where(eq(commands.id, cmd.id));

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.pos.return_processed',
      entityType: 'pos_return',
      entityId: posReturn.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: {
        returnNumber,
        saleId: sale.id,
        refundAmountMinor: totalRefundMinor,
        routedTo: 'returned_quarantine',
      },
    });

    await tx.insert(outboxEvents).values({
      tenantId: context.tenantId,
      eventType: 'pharmacy.pos.return_processed',
      payloadJson: { returnId: posReturn.id, saleId: sale.id, refundAmountMinor: totalRefundMinor },
    });

    return result;
  });
}
