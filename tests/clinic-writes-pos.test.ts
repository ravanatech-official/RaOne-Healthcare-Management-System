import 'dotenv/config';
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import {
  charges,
  inventoryBalances,
  memberships,
  pharmacistCheckoutApprovals,
  posReceipts,
  posSales,
  recalls,
  resources,
  services,
  stockMovements,
  tenants,
  tillShifts,
  users,
} from '../src/db/schema.ts';
import {
  confirmActionProposal,
  createAppointmentForTenant,
  createPersonForTenant,
  listClinicPaymentsAndReceipts,
  prepareActionProposal,
  recordClinicPaymentForTenant,
  rescheduleAppointmentForTenant,
  transitionAppointmentStatusForTenant,
  updatePersonForTenant,
  voidClinicPaymentForTenant,
} from '../src/domain/clinic-writes.ts';
import { ConflictError, ForbiddenError } from '../src/domain/errors.ts';
import { grantProfessionalAuthority } from '../src/domain/capabilities.ts';
import { createProduct } from '../src/domain/pharmacy-catalogue.ts';
import { createSupplier, postGoodsReceipt } from '../src/domain/pharmacy-inventory.ts';
import {
  approvePosCart,
  checkoutPosSale,
  closeTillShift,
  computeCartHash,
  createPosReturn,
  openTillShift,
  recordTillCashEvent,
} from '../src/domain/pharmacy-pos.ts';
import {
  type ActiveWorkspaceContext,
  bootstrapClinicWorkspace,
  requireActiveWorkspace,
} from '../src/domain/tenancy.ts';

describe('Unit Invariants: POS Cart-Hash Integrity', () => {
  it('produces identical cart hash regardless of item order and changes on qty or discount mutation', () => {
    const prodA = crypto.randomUUID();
    const varA = crypto.randomUUID();
    const prodB = crypto.randomUUID();
    const varB = crypto.randomUUID();

    const hash1 = computeCartHash(
      [
        { productId: prodA, packVariantId: varA, qtyPacks: 2, unitSalePriceMinor: 50000 },
        { productId: prodB, packVariantId: varB, qtyPacks: 1, unitSalePriceMinor: 25000 },
      ],
      5000
    );
    const hash2 = computeCartHash(
      [
        { productId: prodB, packVariantId: varB, qtyPacks: 1, unitSalePriceMinor: 25000 },
        { productId: prodA, packVariantId: varA, qtyPacks: 2, unitSalePriceMinor: 50000 },
      ],
      5000
    );
    expect(hash1).toBe(hash2);

    const mutatedQty = computeCartHash(
      [
        { productId: prodA, packVariantId: varA, qtyPacks: 3, unitSalePriceMinor: 50000 },
        { productId: prodB, packVariantId: varB, qtyPacks: 1, unitSalePriceMinor: 25000 },
      ],
      5000
    );
    const mutatedDiscount = computeCartHash(
      [
        { productId: prodA, packVariantId: varA, qtyPacks: 2, unitSalePriceMinor: 50000 },
        { productId: prodB, packVariantId: varB, qtyPacks: 1, unitSalePriceMinor: 25000 },
      ],
      6000
    );

    expect(mutatedQty).not.toBe(hash1);
    expect(mutatedDiscount).not.toBe(hash1);
  });
});

const hasSqlEnv = Boolean(
  process.env.SQL_HOST && process.env.SQL_USER && process.env.SQL_PASSWORD && process.env.SQL_DB_NAME
);

describe.skipIf(!hasSqlEnv)('Clinic Write Slice & Pharmacy Phase 2 POS Integration (Cloud SQL)', () => {
  const tag = crypto.randomBytes(4).toString('hex');
  let ownerUserId: number;
  let receptionistUserId: number;
  let tenantId: string;
  let ownerCtx: ActiveWorkspaceContext;
  let receptionistCtx: ActiveWorkspaceContext;
  let serviceId: string;
  let resourceId: string;

  beforeAll(async () => {
    const [owner] = await db
      .insert(users)
      .values({
        uid: `combo_owner_${tag}`,
        email: `owner_${tag}@example.test`,
        displayName: 'Combo Owner',
        preferredLocale: 'si-LK',
      })
      .returning();

    const [receptionist] = await db
      .insert(users)
      .values({
        uid: `combo_recep_${tag}`,
        email: `recep_${tag}@example.test`,
        displayName: 'Front Desk Receptionist',
        preferredLocale: 'si-LK',
      })
      .returning();

    ownerUserId = owner.id;
    receptionistUserId = receptionist.id;

    ownerCtx = await bootstrapClinicWorkspace(
      {
        id: owner.id,
        uid: owner.uid,
        email: owner.email,
        displayName: owner.displayName,
        preferredLocale: 'si-LK',
      },
      {
        preferredLocale: 'si-LK',
        productMode: 'combo',
        clinicName: `SuwaSeva Combo ${tag}`,
        legalEntityName: `SuwaSeva Medical ${tag} (Pvt) Ltd`,
        branchName: 'Colombo Main',
        countryCode: 'LK',
        timezone: 'Asia/Colombo',
        currency: 'LKR',
        confirmLocaleAndCurrency: true,
        primaryPractitionerName: 'Dr. Perera',
        primaryPractitionerSpecialty: 'General Medicine',
        openingHoursSummary: '08:00 - 21:00',
        services: [{ name: 'OPD Consultation', nameSi: 'OPD උපදේශනය', durationMinutes: 30, priceLkr: 2000 }],
        includeSampleData: false,
      },
      `corr_boot_${tag}`
    );

    tenantId = ownerCtx.tenantId;

    await db.insert(memberships).values({
      tenantId,
      branchId: ownerCtx.branchId,
      userId: receptionistUserId,
      role: 'receptionist',
      active: true,
    });

    receptionistCtx = await requireActiveWorkspace(
      {
        id: receptionist.id,
        uid: receptionist.uid,
        email: receptionist.email,
        displayName: receptionist.displayName,
        preferredLocale: 'si-LK',
      },
      tenantId
    );

    const [svc] = await db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.tenantId, tenantId))
      .limit(1);
    const [res] = await db
      .select({ id: resources.id })
      .from(resources)
      .where(eq(resources.tenantId, tenantId))
      .limit(1);

    serviceId = svc.id;
    resourceId = res.id;
  }, 25_000);

  afterAll(async () => {
    if (tenantId) await db.delete(tenants).where(eq(tenants.id, tenantId));
    if (ownerUserId) await db.delete(users).where(eq(users.id, ownerUserId));
    if (receptionistUserId) await db.delete(users).where(eq(users.id, receptionistUserId));
  }, 25_000);

  it('enforces patient duplicate disambiguation, optimistic locking, btree_gist overlap protection, draft->confirm proposals, and step-up payment void (U05/U07/T04-T10)', async () => {
    // 1. Create patient + duplicate detection -> confirmDuplicate
    const p1 = await createPersonForTenant(
      receptionistCtx,
      {
        displayName: 'Kamal Silva',
        phone: '0771234567',
        aliases: [],
        notes: 'Regular OPD',
        confirmDuplicate: false,
      },
      `corr_p1_${tag}`
    );
    expect(p1.version).toBe(1);

    await expect(
      createPersonForTenant(
        receptionistCtx,
        {
          displayName: 'Kamal Silva Jr',
          phone: '0771234567', // matching last 4 digits!
          aliases: [],
          notes: '',
          confirmDuplicate: false,
        },
        `corr_pdup_${tag}`
      )
    ).rejects.toThrow(ConflictError);

    const p2 = await createPersonForTenant(
      receptionistCtx,
      {
        displayName: 'Nimal Perera',
        phone: '0771234567',
        aliases: [],
        notes: 'Family shared phone',
        confirmDuplicate: true,
      },
      `corr_p2_${tag}`
    );
    expect(p2.displayName).toBe('Nimal Perera');

    // Optimistic version check on update
    const updatedP1 = await updatePersonForTenant(
      receptionistCtx,
      p1.id,
      { notes: 'Updated note', expectedVersion: 1 },
      `corr_pupd_${tag}`
    );
    expect(updatedP1.version).toBe(2);

    await expect(
      updatePersonForTenant(
        receptionistCtx,
        p1.id,
        { notes: 'Stale write', expectedVersion: 1 },
        `corr_pstale_${tag}`
      )
    ).rejects.toThrow(ConflictError);

    // 2. Book appointment & verify PostgreSQL btree_gist exclusion rejects overlaps
    const slot1Start = '2026-12-10T03:30:00.000Z'; // 09:00 Asia/Colombo (30 min -> 09:30)
    const overlapStart = '2026-12-10T03:45:00.000Z'; // 09:15 -> overlaps!
    const adjacentStart = '2026-12-10T04:00:00.000Z'; // 09:30 -> exact boundary [), allowed!

    const apt1Res = (await createAppointmentForTenant(
      receptionistCtx,
      {
        idempotencyKey: `apt-1-${tag}`,
        personId: p1.id,
        serviceId,
        resourceId,
        startsAt: slot1Start,
        notes: 'Slot 1',
      },
      `corr_apt1_${tag}`
    )) as { appointment: { id: string; version: number; status: string } };
    expect(apt1Res.appointment.status).toBe('scheduled');

    await expect(
      createAppointmentForTenant(
        receptionistCtx,
        {
          idempotencyKey: `apt-ovl-${tag}`,
          personId: p2.id,
          serviceId,
          resourceId,
          startsAt: overlapStart,
          notes: 'Should collide at DB gist level',
        },
        `corr_ovl_${tag}`
      )
    ).rejects.toThrow(ConflictError);

    // Draft -> Confirm Action Proposal creates adjacent appointment cleanly
    const proposal = await prepareActionProposal(
      receptionistCtx,
      {
        actionType: 'create_appointment',
        payload: {
          personId: p2.id,
          serviceId,
          resourceId,
          startsAt: adjacentStart,
          notes: 'Voice draft booking',
        },
        inputSource: 'voice',
      },
      `corr_prop_${tag}`
    );

    await expect(
      confirmActionProposal(
        receptionistCtx,
        proposal.id,
        { idempotencyKey: `conf-bad-${tag}`, nonce: 'wrong-nonce' },
        `corr_conf_bad_${tag}`
      )
    ).rejects.toThrow(ConflictError);

    const confirmed = (await confirmActionProposal(
      receptionistCtx,
      proposal.id,
      { idempotencyKey: `conf-ok-${tag}`, nonce: proposal.nonce },
      `corr_conf_ok_${tag}`
    )) as { result: { appointment: { id: string; version: number } } };
    expect(confirmed.result.appointment.id).toBeTruthy();

    // Reschedule apt1 into apt2's slot -> rejected by btree_gist
    await expect(
      rescheduleAppointmentForTenant(
        receptionistCtx,
        apt1Res.appointment.id,
        {
          idempotencyKey: `resch-ovl-${tag}`,
          startsAt: adjacentStart,
          expectedVersion: apt1Res.appointment.version,
        },
        `corr_resch_ovl_${tag}`
      )
    ).rejects.toThrow(ConflictError);

    // Cancel apt2 -> slot frees up in gist WHERE (status IN ('scheduled', 'arrived'))
    await transitionAppointmentStatusForTenant(
      receptionistCtx,
      confirmed.result.appointment.id,
      {
        idempotencyKey: `cancel-apt2-${tag}`,
        status: 'cancelled',
        expectedVersion: confirmed.result.appointment.version,
      },
      `corr_cancel_${tag}`
    );

    const reschOk = (await rescheduleAppointmentForTenant(
      receptionistCtx,
      apt1Res.appointment.id,
      {
        idempotencyKey: `resch-ok-${tag}`,
        startsAt: adjacentStart,
        expectedVersion: apt1Res.appointment.version,
      },
      `corr_resch_ok_${tag}`
    )) as { appointment: { version: number } };
    expect(reschOk.appointment.version).toBe(2);

    // 3. Record clinic payment -> Receipt issued -> Receptionist blocked from void -> Owner voids
    const payRes = (await recordClinicPaymentForTenant(
      receptionistCtx,
      {
        idempotencyKey: `pay-1-${tag}`,
        personId: p1.id,
        appointmentId: apt1Res.appointment.id,
        description: 'OPD Consultation Fee',
        amountMinor: 200000,
        method: 'cash',
        referenceNumber: '',
      },
      `corr_pay1_${tag}`
    )) as { charge: { id: string }; payment: { id: string }; receipt: { receiptNumber: string } };

    expect(payRes.receipt.receiptNumber.startsWith('CLN-')).toBe(true);

    const recepList = await listClinicPaymentsAndReceipts(receptionistCtx);
    expect(recepList.length).toBeGreaterThanOrEqual(1);

    await expect(
      voidClinicPaymentForTenant(
        receptionistCtx,
        payRes.payment.id,
        { idempotencyKey: `void-recep-${tag}`, reason: 'Testing permission guard' },
        `corr_void_recep_${tag}`
      )
    ).rejects.toThrow(ForbiddenError);

    const voidRes = await voidClinicPaymentForTenant(
      ownerCtx,
      payRes.payment.id,
      { idempotencyKey: `void-owner-${tag}`, reason: 'Patient refunded before visit' },
      `corr_void_owner_${tag}`
    );
    expect(voidRes.payment.status).toBe('voided');

    const [updatedCharge] = await db
      .select()
      .from(charges)
      .where(and(eq(charges.tenantId, tenantId), eq(charges.id, payRes.charge.id)));
    expect(updatedCharge.creditedAmountMinor).toBe(0);
  }, 30_000);

  it('executes Pharmacy Phase 2: Till shift drops & blind variance, strict FEFO across lots (skipping recalled), Cart-Hash Pharmacist Gate invalidation, split tender & quarantine customer return (P04-P06/P10-P14/U17)', async () => {
    // 1. Till Shift #1: Open float LKR 5,000 -> Cash drop LKR 1,000 -> Blind close LKR 3,850 (variance -150)
    const s1 = await openTillShift(ownerCtx, { openingFloatMinor: 500000 }, `corr_s1_${tag}`);
    await recordTillCashEvent(
      ownerCtx,
      s1.shift.id,
      { eventType: 'drop', amountMinor: 100000, reason: 'Safe drop' },
      `corr_drop1_${tag}`
    );
    const s1Closed = await closeTillShift(
      ownerCtx,
      s1.shift.id,
      { countedCashMinor: 385000, closeNotes: 'Short by LKR 150' },
      `corr_close1_${tag}`
    );
    expect(s1Closed.shift.expectedCashMinor).toBe(400000);
    expect(s1Closed.shift.varianceMinor).toBe(-15000);

    // 2. Open Shift #2 with LKR 5,000 float & grant pharmacist authority to ownerCtx
    const s2 = await openTillShift(ownerCtx, { openingFloatMinor: 500000 }, `corr_s2_${tag}`);
    await grantProfessionalAuthority(
      ownerCtx,
      { userId: ownerUserId, grantType: 'pharmacist', licenseNumber: `SLMC-POS-${tag}` },
      `corr_ph_grant_${tag}`
    );
    const refreshedOwner = await requireActiveWorkspace(
      {
        id: ownerUserId,
        uid: `combo_owner_${tag}`,
        email: `owner_${tag}@example.test`,
        displayName: 'Combo Owner',
        preferredLocale: 'si-LK',
      },
      tenantId
    );

    // 3. Create supplier + Rx SKU (Box/Strip of 10 tablets @ LKR 450/strip)
    const sup = await createSupplier(
      refreshedOwner,
      { name: `NMRA Wholesale ${tag}`, registrationRef: `REG-${tag}`, status: 'approved' },
      `corr_pos_sup_${tag}`
    );

    const rxProd = await createProduct(
      refreshedOwner,
      {
        skuCode: `AUG-625-${tag}`,
        displayName: 'Augmentin 625mg Tablet',
        genericName: 'Co-amoxiclav',
        brandName: 'Augmentin',
        strengthValue: '625',
        strengthUnit: 'mg',
        dosageForm: 'tablet',
        route: 'oral',
        manufacturer: 'GSK',
        regulatoryClass: 'prescription_only',
        storageCondition: 'ambient',
        baseUnit: 'tablet',
        minShelfLifeDays: 30,
        initialPack: {
          variantName: 'Strip of 10',
          packUnit: 'strip',
          baseQtyPerPack: 10,
          defaultSalePriceMinor: 45000, // LKR 450.00
          barcodeType: 'internal',
        },
      },
      `corr_rxprod_${tag}`
    );
    const productId = rxProd.product.id;
    const variantId = rxProd.initialPackVariant!.id;

    // Receive 3 lots:
    // - Lot Recalled (earliest expiry 2027-01, 10 tabs, recalled -> MUST BE SKIPPED)
    // - Lot Early (2027-04, 2 strips = 20 tabs -> MUST BE ALLOCATED FIRST)
    // - Lot Late (2028-10, 3 strips = 30 tabs -> ALLOCATED SECOND)
    const grnRes = (await postGoodsReceipt(
      refreshedOwner,
      {
        idempotencyKey: `grn-fefo-${tag}`,
        supplierId: sup.id,
        supplierDocRef: `DN-FEFO-${tag}`,
        docType: 'grn',
        receivedDate: '2026-11-18',
        notes: 'FEFO + Recall test lots',
        lines: [
          {
            productId,
            packVariantId: variantId,
            batchNumber: `LOT-REC-${tag}`,
            printedExpiry: '2027-01',
            expiryPrecision: 'month',
            orderedPacks: 1,
            receivedPacks: 1,
            bonusPacks: 0,
            quarantinedPacks: 0,
            unitPackCostMinor: 30000,
            isProvisionalCost: false,
            condition: 'good',
            releaseImmediately: true,
          },
          {
            productId,
            packVariantId: variantId,
            batchNumber: `LOT-EARLY-${tag}`,
            printedExpiry: '2027-04',
            expiryPrecision: 'month',
            orderedPacks: 2,
            receivedPacks: 2,
            bonusPacks: 0,
            quarantinedPacks: 0,
            unitPackCostMinor: 31000,
            isProvisionalCost: false,
            condition: 'good',
            releaseImmediately: true,
          },
          {
            productId,
            packVariantId: variantId,
            batchNumber: `LOT-LATE-${tag}`,
            printedExpiry: '2028-10',
            expiryPrecision: 'month',
            orderedPacks: 3,
            receivedPacks: 3,
            bonusPacks: 0,
            quarantinedPacks: 0,
            unitPackCostMinor: 32000,
            isProvisionalCost: false,
            condition: 'good',
            releaseImmediately: true,
          },
        ],
      },
      `corr_grn_fefo_${tag}`
    )) as { lines: Array<{ lotId: string }> };

    const lotRecalledId = grnRes.lines[0].lotId;
    const lotEarlyId = grnRes.lines[1].lotId;
    const lotLateId = grnRes.lines[2].lotId;

    // Place active recall on Lot Recalled
    await db.insert(recalls).values({
      tenantId,
      scopeType: 'lot',
      lotId: lotRecalledId,
      referenceCode: `REC-${tag}`,
      reason: 'Manufacturer batch recall test',
      status: 'active',
      activatedByUserId: ownerUserId,
    });

    // 4. Attempting Rx checkout without pharmacist approval throws PHARMACIST_APPROVAL_REQUIRED
    await expect(
      checkoutPosSale(
        refreshedOwner,
        {
          idempotencyKey: `pos-nogate-${tag}`,
          shiftId: s2.shift.id,
          items: [{ productId, packVariantId: variantId, qtyPacks: 3 }],
          discountMinor: 0,
          payments: [{ method: 'cash', amountMinor: 135000, referenceNumber: '' }],
        },
        `corr_pos_nogate_${tag}`
      )
    ).rejects.toThrow(ConflictError);

    // 5. Approve cart for qtyPacks=2, then attempt checkout with qtyPacks=3 -> CART_HASH_MISMATCH invalidates approval!
    const badApproval = await approvePosCart(
      refreshedOwner,
      {
        items: [{ productId, packVariantId: variantId, qtyPacks: 2 }],
        discountMinor: 0,
        prescriptionRef: 'RX-991',
        notes: '',
      },
      `corr_app_bad_${tag}`
    );

    await expect(
      checkoutPosSale(
        refreshedOwner,
        {
          idempotencyKey: `pos-tamper-${tag}`,
          shiftId: s2.shift.id,
          items: [{ productId, packVariantId: variantId, qtyPacks: 3 }], // tampered qty!
          discountMinor: 0,
          approvalId: badApproval.approval.id,
          payments: [{ method: 'cash', amountMinor: 135000, referenceNumber: '' }],
        },
        `corr_pos_tamper_${tag}`
      )
    ).rejects.toThrow(ConflictError);

    const [invApp] = await db
      .select()
      .from(pharmacistCheckoutApprovals)
      .where(eq(pharmacistCheckoutApprovals.id, badApproval.approval.id));
    expect(invApp.status).toBe('invalidated');

    // 6. Fresh approval for exact 3 strips (30 tabs, total 135,000 minor, discount 5,000 -> 130,000 net)
    // Split tender: LKR 1,000 cash (100,000) + LKR 500 card (50,000) => LKR 200 change (20,000)
    // Net cash added to shift drawer = 100,000 - 20,000 = 80,000!
    const goodApproval = await approvePosCart(
      refreshedOwner,
      {
        items: [{ productId, packVariantId: variantId, qtyPacks: 3 }],
        discountMinor: 5000,
        prescriptionRef: 'RX-992',
        notes: '3 strips verified',
      },
      `corr_app_ok_${tag}`
    );

    const checkoutRes = (await checkoutPosSale(
      refreshedOwner,
      {
        idempotencyKey: `pos-ok-${tag}`,
        shiftId: s2.shift.id,
        items: [{ productId, packVariantId: variantId, qtyPacks: 3 }],
        discountMinor: 5000,
        approvalId: goodApproval.approval.id,
        payments: [
          { method: 'cash', amountMinor: 100000, referenceNumber: '' },
          { method: 'card', amountMinor: 50000, referenceNumber: 'CARD-4412' },
        ],
      },
      `corr_pos_ok_${tag}`
    )) as {
      sale: { id: string; totalMinor: number; changeMinor: number };
      receipt: { receiptNumber: string };
      lines: Array<{ saleLineId: string; allocations: Array<{ lotId: string; qtyBase: number }> }>;
    };

    expect(checkoutRes.sale.totalMinor).toBe(130000);
    expect(checkoutRes.sale.changeMinor).toBe(20000);
    expect(checkoutRes.receipt.receiptNumber.startsWith('PRCP-')).toBe(true);

    // Strict FEFO check: took 20 from LOT-EARLY, 10 from LOT-LATE, 0 from LOT-RECALLED
    const allocs = checkoutRes.lines[0].allocations;
    expect(allocs).toEqual([
      expect.objectContaining({ lotId: lotEarlyId, qtyBase: 20 }),
      expect.objectContaining({ lotId: lotLateId, qtyBase: 10 }),
    ]);

    const [balEarly] = await db
      .select()
      .from(inventoryBalances)
      .where(and(eq(inventoryBalances.tenantId, tenantId), eq(inventoryBalances.lotId, lotEarlyId)));
    const [balLate] = await db
      .select()
      .from(inventoryBalances)
      .where(and(eq(inventoryBalances.tenantId, tenantId), eq(inventoryBalances.lotId, lotLateId)));
    expect(balEarly.sellableOnHand).toBe(0);
    expect(balLate.sellableOnHand).toBe(20);

    // Check shift expected cash = 500,000 + 80,000 = 580,000
    const [shiftAfterSale] = await db
      .select()
      .from(tillShifts)
      .where(eq(tillShifts.id, s2.shift.id));
    expect(shiftAfterSale.expectedCashMinor).toBe(580000);

    // 7. Customer Return of 10 base units (cash refund) -> MUST increment returnedQuarantineQty and NEVER sellableOnHand!
    const retRes = (await createPosReturn(
      refreshedOwner,
      checkoutRes.sale.id,
      {
        idempotencyKey: `ret-1-${tag}`,
        shiftId: s2.shift.id,
        reason: 'Customer unopened strip return',
        refundMethod: 'cash',
        lines: [{ saleLineId: checkoutRes.lines[0].saleLineId, qtyBase: 10 }],
      },
      `corr_ret_${tag}`
    )) as { refundAmountMinor: number };

    expect(retRes.refundAmountMinor).toBe(45000);

    const [balEarlyAfterReturn] = await db
      .select()
      .from(inventoryBalances)
      .where(and(eq(inventoryBalances.tenantId, tenantId), eq(inventoryBalances.lotId, lotEarlyId)));
    expect(balEarlyAfterReturn.sellableOnHand).toBe(0); // NEVER returned to sellable!
    expect(balEarlyAfterReturn.returnedQuarantineQty).toBe(10); // Strictly quarantined!

    const [saleAfterReturn] = await db
      .select()
      .from(posSales)
      .where(eq(posSales.id, checkoutRes.sale.id));
    expect(saleAfterReturn.status).toBe('partially_returned');

    const [rcpRow] = await db
      .select()
      .from(posReceipts)
      .where(eq(posReceipts.saleId, checkoutRes.sale.id));
    expect(rcpRow.receiptNumber).toBe(checkoutRes.receipt.receiptNumber);

    const returnMovs = await db
      .select()
      .from(stockMovements)
      .where(
        and(
          eq(stockMovements.tenantId, tenantId),
          eq(stockMovements.movementType, 'customer_return_quarantine')
        )
      );
    expect(returnMovs.length).toBe(1);
    expect(returnMovs[0].toBucket).toBe('returned_quarantine');
  }, 35_000);
});
