import 'dotenv/config';
import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { isDatabaseConfigured } from '../src/db/index.ts';
import { getOrCreateUser } from '../src/db/users.ts';
import { grantProfessionalAuthority } from '../src/domain/capabilities.ts';
import { broadcastDoctorDelay, createDoctorSchedule } from '../src/domain/clinic-ops.ts';
import { createAppointmentForTenant, createPersonForTenant } from '../src/domain/clinic-writes.ts';
import { ConflictError, ForbiddenError, NotFoundError } from '../src/domain/errors.ts';
import { generateMonthlyPayroll, upsertHrProfile } from '../src/domain/hr-admin-ops.ts';
import { getMemoryStore } from '../src/domain/memory-store.ts';
import { createProduct } from '../src/domain/pharmacy-catalogue.ts';
import {
  createSupplier,
  getStockAndLotSummary,
  postGoodsReceipt,
  transitionLotQuality,
} from '../src/domain/pharmacy-inventory.ts';
import {
  createDispenseOrder,
  createStockTransfer,
  getCombinedZReport,
  listDispenseOrders,
  receiveStockTransfer,
} from '../src/domain/pharmacy-ops.ts';
import {
  checkoutPosSale,
  createPosReturn,
  openTillShift,
} from '../src/domain/pharmacy-pos.ts';
import {
  approvePurchaseOrder,
  convertPurchaseOrderToGrn,
  createPurchaseOrder,
  createSupplierDebitNote,
} from '../src/domain/purchasing-ops.ts';
import {
  acceptStaffInvite,
  createStaffInvite,
  createWorkspaceBranch,
  listTeamMembers,
  setStaffShiftPin,
  updateMemberRoleOrBranch,
  verifyStaffShiftPin,
} from '../src/domain/team-ops.ts';
import {
  bootstrapClinicWorkspace,
  getBusinessDateInTimezone,
  requireActiveWorkspace,
  type ActiveWorkspaceContext,
} from '../src/domain/tenancy.ts';

describe.skipIf(isDatabaseConfigured)(
  'Launch Readiness Audit: Financial, Inventory, Payroll, Contracts & Security Invariants',
  () => {
    const tag = crypto.randomBytes(4).toString('hex');
    let ownerCtx: ActiveWorkspaceContext;
    let staffCtx: ActiveWorkspaceContext;
    let staffUserId: number;
    let tenantId: string;
    let branch1Id: string;
    let branch2Id: string;
    let supplierId: string;
    let serviceId: string;
    let resourceId: string;
    let patientId: string;
    let productId: string;
    let packVariantId: string;
    let todayDate: string;

    beforeAll(async () => {
      const ownerUser = await getOrCreateUser(
        `audit_owner_${tag}`,
        `audit_owner_${tag}@suwaseva.lk`,
        'Dr. Ruwan Perera'
      );

      ownerCtx = await bootstrapClinicWorkspace(
        {
          id: ownerUser.id,
          uid: ownerUser.uid,
          email: ownerUser.email,
          displayName: ownerUser.displayName,
          preferredLocale: 'en-LK',
        },
        {
          preferredLocale: 'en-LK',
          productMode: 'combo',
          clinicName: `Audit Medical & Pharmacy ${tag}`,
          legalEntityName: `Audit Healthcare ${tag} (Pvt) Ltd`,
          branchName: 'Colombo Flagship',
          countryCode: 'LK',
          timezone: 'Asia/Colombo',
          currency: 'LKR',
          confirmLocaleAndCurrency: true,
          primaryPractitionerName: 'Dr. Ruwan Perera',
          primaryPractitionerSpecialty: 'Internal Medicine',
          openingHoursSummary: '08:00 - 20:00',
          services: [
            {
              name: 'Specialist Channeling',
              nameSi: 'විශේෂඥ වෛද්‍ය උපදේශනය',
              durationMinutes: 20,
              priceLkr: 3000,
            },
          ],
          includeSampleData: false,
        },
        `audit_boot_${tag}`
      );

      tenantId = ownerCtx.tenantId;
      branch1Id = ownerCtx.branchId;
      todayDate = getBusinessDateInTimezone('Asia/Colombo');

      await grantProfessionalAuthority(
        ownerCtx,
        {
          userId: ownerUser.id,
          grantType: 'pharmacist',
          licenseNumber: `SLMC-AUDIT-${tag}`,
        },
        `audit_grant_${tag}`
      );

      ownerCtx = await requireActiveWorkspace(
        {
          id: ownerUser.id,
          uid: ownerUser.uid,
          email: ownerUser.email,
          displayName: ownerUser.displayName,
          preferredLocale: 'en-LK',
        },
        tenantId
      );

      const store = getMemoryStore();
      serviceId = store.services.find((s) => s.tenantId === tenantId)!.id;
      resourceId = store.resources.find((r) => r.tenantId === tenantId)!.id;

      const branch2Res = await createWorkspaceBranch(
        ownerCtx,
        {
          name: 'Kandy Branch',
          code: `KDY-${tag.slice(0, 4).toUpperCase()}`,
          openingHoursSummary: '08:30 - 18:00',
        },
        `audit_br2_${tag}`
      );
      branch2Id = branch2Res.id;

      const supRes = (await createSupplier(
        ownerCtx,
        {
          name: `Lanka Med Distributors ${tag}`,
          registrationRef: `NMRA-SUP-${tag}`,
          contactName: 'Sunil Silva',
          phone: '0112699999',
          email: 'supply@lankamed.lk',
          status: 'approved',
        },
        `audit_sup_${tag}`
      )) as { id: string };
      supplierId = supRes.id;

      const prodRes = await createProduct(
        ownerCtx,
        {
          skuCode: `AUDIT-TAB-${tag}`,
          displayName: 'Cetirizine 10mg Tablet',
          genericName: 'Cetirizine',
          brandName: 'Zyrtec',
          strengthValue: '10',
          strengthUnit: 'mg',
          dosageForm: 'tablet',
          route: 'oral',
          manufacturer: 'GSK Sri Lanka',
          regulatoryClass: 'otc',
          storageCondition: 'ambient',
          baseUnit: 'tablet',
          minShelfLifeDays: 30,
          initialPack: {
            variantName: 'Strip of 10 Tablets',
            packUnit: 'strip',
            baseQtyPerPack: 10,
            defaultSalePriceMinor: 50000, // LKR 500 per strip (LKR 50/tablet)
            barcodeType: 'ean13',
          },
        },
        `audit_prod_${tag}`
      );

      productId = prodRes.product.id;
      packVariantId = prodRes.initialPackVariant!.id;

      const person = await createPersonForTenant(
        ownerCtx,
        {
          displayName: 'Nadeesha Fernando',
          phone: '0778889999',
          aliases: ['Nadeesha'],
          notes: '',
          confirmDuplicate: false,
        },
        `audit_person_${tag}`
      );
      patientId = person.id;

      // Invite & accept a receptionist/staff user
      const staffEmail = `staff_${tag}@suwaseva.lk`;
      const staffUser = await getOrCreateUser(`audit_staff_${tag}`, staffEmail, 'Kasuni Perera');
      staffUserId = staffUser.id;
      const invite = await createStaffInvite(
        ownerCtx,
        {
          branchId: branch1Id,
          email: staffEmail,
          displayName: 'Kasuni Perera',
          role: 'receptionist',
        },
        `audit_inv_${tag}`
      );
      await acceptStaffInvite(
        {
          id: staffUser.id,
          uid: staffUser.uid,
          email: staffUser.email,
          displayName: staffUser.displayName,
          preferredLocale: 'en-LK',
        },
        invite.inviteToken,
        `audit_acc_${tag}`
      );
      staffCtx = await requireActiveWorkspace(
        {
          id: staffUser.id,
          uid: staffUser.uid,
          email: staffUser.email,
          displayName: staffUser.displayName,
          preferredLocale: 'en-LK',
        },
        tenantId
      );
    });

    it('1. Enforces multi-lot FEFO return allocation splits, duplicate-line guard, and cumulative discounted refund cap', async () => {
      // Receive 20 units (2 packs) in early lot & 20 units (2 packs) in late lot
      const grnEarly = (await postGoodsReceipt(
        ownerCtx,
        {
          idempotencyKey: `audit-grn-early-${tag}`,
          supplierId,
          supplierDocRef: `INV-EARLY-${tag}`,
          docType: 'grn',
          receivedDate: todayDate,
          notes: 'Early FEFO batch',
          lines: [
            {
              productId,
              packVariantId,
              batchNumber: `LOT-EARLY-${tag}`,
              printedExpiry: '2026-12-31',
              expiryPrecision: 'day',
              orderedPacks: 2,
              receivedPacks: 2,
              bonusPacks: 0,
              quarantinedPacks: 0,
              unitPackCostMinor: 25000,
              isProvisionalCost: false,
              condition: 'good',
              releaseImmediately: true,
            },
          ],
        },
        `audit_grn_e_${tag}`
      )) as { lines: Array<{ lotId: string }> };

      const grnLate = (await postGoodsReceipt(
        ownerCtx,
        {
          idempotencyKey: `audit-grn-late-${tag}`,
          supplierId,
          supplierDocRef: `INV-LATE-${tag}`,
          docType: 'grn',
          receivedDate: todayDate,
          notes: 'Late FEFO batch',
          lines: [
            {
              productId,
              packVariantId,
              batchNumber: `LOT-LATE-${tag}`,
              printedExpiry: '2028-06-30',
              expiryPrecision: 'day',
              orderedPacks: 2,
              receivedPacks: 2,
              bonusPacks: 0,
              quarantinedPacks: 0,
              unitPackCostMinor: 25000,
              isProvisionalCost: false,
              condition: 'good',
              releaseImmediately: true,
            },
          ],
        },
        `audit_grn_l_${tag}`
      )) as { lines: Array<{ lotId: string }> };

      const lotEarlyId = grnEarly.lines[0].lotId;
      const lotLateId = grnLate.lines[0].lotId;

      const shiftRes = (await openTillShift(
        ownerCtx,
        { openingFloatMinor: 100000 },
        `audit_shift_${tag}`
      )) as { shift: { id: string } };

      // Sell 3 packs (30 base units): 20 from lotEarly + 10 from lotLate
      // Subtotal = 150,000 minor, Discount = 5,000 minor, Total Paid = 145,000 minor
      // Split Tender: Cash 100,000 + Card 65,000 -> Change = 20,000 minor
      const saleRes = (await checkoutPosSale(
        ownerCtx,
        {
          idempotencyKey: `audit-sale-${tag}`,
          shiftId: shiftRes.shift.id,
          items: [{ productId, packVariantId, qtyPacks: 3, unitSalePriceMinor: 50000 }],
          discountMinor: 5000,
          payments: [
            { method: 'cash', amountMinor: 100000, referenceNumber: '' },
            { method: 'card', amountMinor: 65000, referenceNumber: 'CARD-01' },
          ],
        },
        `audit_pos_sale_${tag}`
      )) as { sale: { id: string; changeMinor: number; totalMinor: number }; lines: Array<{ saleLineId: string }> };

      expect(saleRes.sale.totalMinor).toBe(145000);
      expect(saleRes.sale.changeMinor).toBe(20000);
      const saleLineId = saleRes.lines[0].saleLineId;

      // Return #1: 15 units -> routes to lotEarly (returnedQuarantine = 15), raw refund = 75,000
      const ret1 = (await createPosReturn(
        ownerCtx,
        saleRes.sale.id,
        {
          idempotencyKey: `audit-ret1-${tag}`,
          shiftId: shiftRes.shift.id,
          reason: 'Customer allergic',
          refundMethod: 'cash',
          lines: [{ saleLineId, qtyBase: 15 }],
        },
        `audit_ret1_${tag}`
      )) as { refundAmountMinor: number };
      expect(ret1.refundAmountMinor).toBe(75000);

      // Duplicate saleLineId bypass check: requesting remaining 15 twice as (10 + 10 = 20) MUST fail!
      await expect(
        createPosReturn(
          ownerCtx,
          saleRes.sale.id,
          {
            idempotencyKey: `audit-ret-dup-${tag}`,
            shiftId: shiftRes.shift.id,
            reason: 'Over-return attempt',
            refundMethod: 'cash',
            lines: [
              { saleLineId, qtyBase: 10 },
              { saleLineId, qtyBase: 10 },
            ],
          },
          `audit_ret_dup_${tag}`
        )
      ).rejects.toThrow(ConflictError);

      // Return #2: remaining 15 units -> MUST split 5 to lotEarly (reaching 20) + 10 to lotLate,
      // AND cap cumulative refund at sale.totalMinor (145,000 - 75,000 = 70,000, NOT 75,000!)
      const ret2 = (await createPosReturn(
        ownerCtx,
        saleRes.sale.id,
        {
          idempotencyKey: `audit-ret2-${tag}`,
          shiftId: shiftRes.shift.id,
          reason: 'Balance return',
          refundMethod: 'cash',
          lines: [{ saleLineId, qtyBase: 15 }],
        },
        `audit_ret2_${tag}`
      )) as { refundAmountMinor: number };
      expect(ret2.refundAmountMinor).toBe(70000);
      expect(ret1.refundAmountMinor + ret2.refundAmountMinor).toBe(145000);

      // Verify inventory balances per lot
      const stock = await getStockAndLotSummary(ownerCtx);
      const earlyBal = stock.balances.find((b) => b.lotId === lotEarlyId);
      const lateBal = stock.balances.find((b) => b.lotId === lotLateId);
      expect(earlyBal?.sellableOnHand).toBe(0);
      expect(earlyBal?.returnedQuarantineQty).toBe(20);
      expect(lateBal?.sellableOnHand).toBe(10);
      expect(lateBal?.returnedQuarantineQty).toBe(10);

      // Z-Report tender byMethod reconciliation:
      // Sale Cash net after 20,000 change = 80,000; Refunds Cash = 145,000 -> Cash clamped to 0,
      // Card = 65,000, Pharmacy netSalesMinor = 145,000 - 145,000 = 0!
      const zRep = await getCombinedZReport(ownerCtx, todayDate);
      expect(zRep.pharmacy.netSalesMinor).toBe(0);
      expect(zRep.combined.byMethod.cardMinor).toBe(65000);
      expect(zRep.combined.byMethod.cashMinor).toBe(0);
    });

    it('2. Z-Report accurately nets split-tender change and cash refunds against net revenue', async () => {
      const store = getMemoryStore();
      const shift = store.tillShifts.find((s) => s.tenantId === tenantId && s.status === 'open')!;

      // Clean sale of 50,000 paid with Cash 60,000 (change 10,000) -> net cash +50,000!
      await checkoutPosSale(
        ownerCtx,
        {
          idempotencyKey: `audit-sale2-${tag}`,
          shiftId: shift.id,
          items: [{ productId, packVariantId, qtyPacks: 1, unitSalePriceMinor: 50000 }],
          discountMinor: 0,
          payments: [{ method: 'cash', amountMinor: 60000, referenceNumber: '' }],
        },
        `audit_pos_sale2_${tag}`
      );

      const zRep = await getCombinedZReport(ownerCtx, todayDate);
      expect(zRep.pharmacy.netSalesMinor).toBe(50000);
      // Cumulative net cash = Sale1(80,000) + Sale2(50,000) - Returns(145,000) = clamped 0; Card = 65,000
      expect(zRep.combined.byMethod.cardMinor).toBe(65000);
      expect(zRep.combined.byMethod.cashMinor).toBe(0);
      expect(shift.cashSalesMinor).toBe(80000 + 50000); // cashSalesMinor records net cash (amount - change)
    });

    it('3. Enforces case-insensitive manufacturer recall guard & exact partial lot quality release', async () => {
      const grnQuar = (await postGoodsReceipt(
        ownerCtx,
        {
          idempotencyKey: `audit-grn-quar-${tag}`,
          supplierId,
          supplierDocRef: `INV-QUAR-${tag}`,
          docType: 'grn',
          receivedDate: todayDate,
          notes: 'Quarantined lot for partial release',
          lines: [
            {
              productId,
              packVariantId,
              batchNumber: `LOT-QUAR-${tag}`,
              printedExpiry: '2027-09-30',
              expiryPrecision: 'day',
              orderedPacks: 2,
              receivedPacks: 2,
              bonusPacks: 0,
              quarantinedPacks: 2,
              unitPackCostMinor: 25000,
              isProvisionalCost: false,
              condition: 'good',
              releaseImmediately: false,
            },
          ],
        },
        `audit_grn_q_${tag}`
      )) as { lines: Array<{ lotId: string }> };

      const qLotId = grnQuar.lines[0].lotId;

      // Partial release of 5 units from 20 quarantined units
      const partialRel = (await transitionLotQuality(
        ownerCtx,
        qLotId,
        {
          action: 'release_to_sellable',
          reason: 'Sample QA passed for 5 units',
          qtyBase: 5,
        },
        `audit_part_rel_${tag}`
      )) as { qtyBaseReleased: number };
      expect(partialRel.qtyBaseReleased).toBe(5);

      const stockAfter = await getStockAndLotSummary(ownerCtx);
      const qBal = stockAfter.balances.find((b) => b.lotId === qLotId)!;
      expect(qBal.sellableOnHand).toBe(5);
      expect(qBal.quarantineQty).toBe(15);

      // Add lowercase manufacturer recall and verify uppercase product manufacturer is blocked!
      const store = getMemoryStore();
      store.recalls.push({
        id: crypto.randomUUID(),
        tenantId,
        scopeType: 'manufacturer',
        productId: null,
        lotId: null,
        manufacturer: 'gsk sri lanka',
        referenceCode: `REC-MFR-${tag}`,
        reason: 'Manufacturer QA recall',
        status: 'active',
        effectiveAt: new Date(),
        activatedByUserId: ownerCtx.userId,
        createdAt: new Date(),
      });

      await expect(
        transitionLotQuality(
          ownerCtx,
          qLotId,
          { action: 'release_to_sellable', reason: 'Attempt release under recall', qtyBase: 5 },
          `audit_rec_blk_${tag}`
        )
      ).rejects.toThrow(ConflictError);

      // Clear test recall so purchasing tests can receive freely
      store.recalls = store.recalls.filter((r) => r.tenantId !== tenantId);
    });

    it('4. Enforces PO approval before GRN conversion & logs accurate quarantine/sellable debit note buckets', async () => {
      const poRes = await createPurchaseOrder(
        ownerCtx,
        {
          supplierId,
          expectedDate: todayDate,
          notes: 'Audit PO workflow test',
          lines: [{ productId, packVariantId, orderedPacks: 1, estimatedUnitPackCostMinor: 25000 }],
        },
        `audit_po_create_${tag}`
      );

      // Draft PO must NOT convert to GRN directly!
      await expect(
        convertPurchaseOrderToGrn(
          ownerCtx,
          poRes.purchaseOrder.id,
          {
            batchNumber: `PO-BATCH-${tag}`,
            printedExpiry: '2027-11-30',
            releaseImmediately: true,
            notes: 'Premature GRN attempt',
          },
          `audit_po_unapproved_${tag}`
        )
      ).rejects.toThrow(ConflictError);

      // Approve then convert
      await approvePurchaseOrder(ownerCtx, poRes.purchaseOrder.id, `audit_po_approve_${tag}`);
      await convertPurchaseOrderToGrn(
        ownerCtx,
        poRes.purchaseOrder.id,
        {
          batchNumber: `PO-BATCH-${tag}`,
          printedExpiry: '2027-11-30',
          releaseImmediately: false, // lands in quarantine (10 units)
          notes: 'Approved GRN',
        },
        `audit_po_convert_${tag}`
      );

      const store = getMemoryStore();
      const poLot = store.lots.find(
        (l) => l.tenantId === tenantId && l.batchNumber === `PO-BATCH-${tag}-1`
      )!;
      expect(poLot).toBeTruthy();

      // Release 4 units so lot has 6 quarantine + 4 sellable, then debit-note return 8 units
      await transitionLotQuality(
        ownerCtx,
        poLot.id,
        { action: 'release_to_sellable', reason: 'Partial release', qtyBase: 4 },
        `audit_po_partrel_${tag}`
      );

      const dnRes = await createSupplierDebitNote(
        ownerCtx,
        {
          supplierId,
          productId,
          lotId: poLot.id,
          qtyBase: 8,
          amountLkr: 200,
          reason: 'damaged',
          notes: 'Return 6 quarantine + 2 sellable',
        },
        `audit_dn_split_${tag}`
      );

      const dnMovements = store.stockMovements.filter(
        (m) => m.tenantId === tenantId && m.sourceDocId === dnRes.debitNote.id
      );
      expect(dnMovements).toHaveLength(2);
      expect(dnMovements.find((m) => m.fromBucket === 'quarantine')?.qtyBase).toBe(6);
      expect(dnMovements.find((m) => m.fromBucket === 'sellable')?.qtyBase).toBe(2);
    });

    it('5. Aggregates full-month OT, month-overlapping no-pay leave, and monthly doctor commissions in Payroll', async () => {
      const payrollMonth = '2026-04';
      await upsertHrProfile(
        ownerCtx,
        {
          userId: staffUserId,
          designation: 'Front Desk Officer',
          basicSalaryLkr: 52000, // 5,200,000 minor => 200,000 minor/day (26-day divisor)
          allowancesLkr: 8000, // 800,000 minor
          epfApplicable: true,
          etfApplicable: true,
          bankName: 'Commercial Bank',
          bankAccountNo: '100200300',
        },
        `audit_hr_prof_${tag}`
      );

      const store = getMemoryStore();
      // Inject 2 historical attendance logs across 2026-04 (60m + 120m = 180m = 3h @ LKR 450/hr = 135,000 minor)
      store.hrAttendanceLogs.push(
        {
          id: crypto.randomUUID(),
          tenantId,
          branchId: branch1Id,
          userId: staffUserId,
          businessDate: '2026-04-05',
          clockInAt: new Date('2026-04-05T08:30:00+05:30'),
          clockOutAt: new Date('2026-04-05T18:30:00+05:30'),
          lateMinutes: 0,
          overtimeMinutes: 60,
          status: 'completed',
          notes: 'Audit OT Day 1',
        },
        {
          id: crypto.randomUUID(),
          tenantId,
          branchId: branch1Id,
          userId: staffUserId,
          businessDate: '2026-04-12',
          clockInAt: new Date('2026-04-12T08:30:00+05:30'),
          clockOutAt: new Date('2026-04-12T19:30:00+05:30'),
          lateMinutes: 0,
          overtimeMinutes: 120,
          status: 'completed',
          notes: 'Audit OT Day 2',
        }
      );

      // Inject an approved no_pay leave spanning Mar 30 -> Apr 02 (4 days total, 2 days inside 2026-04!)
      store.hrLeaveRequests.push({
        id: crypto.randomUUID(),
        tenantId,
        branchId: branch1Id,
        userId: staffUserId,
        leaveType: 'no_pay',
        startDate: '2026-03-30',
        endDate: '2026-04-02',
        daysCount: 4,
        reason: 'Cross-month personal leave',
        status: 'approved',
        reviewedByUserId: ownerCtx.userId,
        reviewedAt: new Date(),
        createdAt: new Date(),
      });

      const payrollRes = await generateMonthlyPayroll(ownerCtx, payrollMonth, `audit_pay_${tag}`);
      const staffSlip = payrollRes.slips.find((s) => s.userId === staffUserId)!;
      expect(staffSlip.overtimeMinor).toBe(135000); // 3h * 450 LKR
      // 2 overlapping no-pay days in April: 5,200,000 / 26 * 2 = 400,000 minor
      expect(staffSlip.noPayDeductionMinor).toBe(400000);
      // EPF base = 5,200,000 - 400,000 = 4,800,000; 8% = 384,000; 12% = 576,000; 3% ETF = 144,000
      expect(staffSlip.epfEmployee8Minor).toBe(384000);
      expect(staffSlip.epfEmployer12Minor).toBe(576000);
      expect(staffSlip.etfEmployer3Minor).toBe(144000);
      // Net pay = (5,200,000 + 800,000 + 135,000) - 400,000 - 384,000 = 5,351,000
      expect(staffSlip.netPayMinor).toBe(5351000);
    });

    it('6. Blocks revoked staff from Shift PIN unlock and rejects foreign branchId updates', async () => {
      await setStaffShiftPin(staffCtx, '7788', `audit_pin_set_${tag}`);
      const okUnlock = await verifyStaffShiftPin(ownerCtx, '7788', `audit_pin_ok_${tag}`);
      expect(okUnlock.verified).toBe(true);
      expect(okUnlock.userId).toBe(staffUserId);

      // Cannot move member to non-existent/foreign branchId
      const members = await listTeamMembers(ownerCtx);
      const staffMem = members.find((m) => m.userId === staffUserId)!;
      await expect(
        updateMemberRoleOrBranch(
          ownerCtx,
          staffMem.membershipId,
          { branchId: crypto.randomUUID() },
          `audit_bad_br_${tag}`
        )
      ).rejects.toThrow(NotFoundError);

      // Deactivate staff membership -> Shift PIN unlock MUST fail with ForbiddenError!
      await updateMemberRoleOrBranch(
        ownerCtx,
        staffMem.membershipId,
        { active: false },
        `audit_revoke_mem_${tag}`
      );

      await expect(
        verifyStaffShiftPin(ownerCtx, '7788', `audit_pin_revoked_${tag}`)
      ).rejects.toThrow(ForbiddenError);
    });

    it('7. Verifies clinic delay broadcast, transfer status, and dispense queue field contracts', async () => {
      const colomboDay = new Date(`${todayDate}T12:00:00+05:30`).getDay();
      await createDoctorSchedule(
        ownerCtx,
        {
          resourceId,
          dayOfWeek: colomboDay,
          startTime: '18:00',
          endTime: '19:00',
          slotDurationMinutes: 30,
        },
        `audit_sched_${tag}`
      );
      await createAppointmentForTenant(
        ownerCtx,
        {
          idempotencyKey: `audit-apt-${tag}`,
          personId: patientId,
          serviceId,
          resourceId,
          startsAt: new Date(`${todayDate}T18:00:00+05:30`).toISOString(),
          notes: 'Queue delay check',
        },
        `audit_apt_${tag}`
      );

      const delayRes = await broadcastDoctorDelay(ownerCtx, resourceId, 20, `audit_delay_${tag}`);
      expect(delayRes.affectedTokens).toBeGreaterThanOrEqual(1);
      expect(delayRes.delayMinutes).toBe(20);

      // Dispense order exposes patientName
      await createDispenseOrder(
        ownerCtx,
        {
          personId: patientId,
          prescriberName: 'Dr. Ruwan Perera',
          clinicalNotes: 'Take after dinner',
          lines: [
            {
              productId,
              packVariantId,
              qtyPacks: 1,
              dosageInstruction: '1 tab nocte',
            },
          ],
        },
        `audit_disp_${tag}`
      );
      const dispOrders = await listDispenseOrders(ownerCtx);
      expect(dispOrders[0].patientName).toBe('Nadeesha Fernando');

      // Transfer dispatches as 'dispatched' and receives as 'received'
      const stock = await getStockAndLotSummary(ownerCtx);
      const sellableBal = stock.balances.find((b) => b.sellableOnHand >= 2)!;
      const trf = (await createStockTransfer(
        ownerCtx,
        {
          idempotencyKey: `audit-trf-${tag}`,
          toBranchId: branch2Id,
          notes: 'Audit transfer',
          lines: [{ productId: sellableBal.productId, lotId: sellableBal.lotId, qtyBase: 2 }],
        },
        `audit_trf_${tag}`
      )) as { transfer: { id: string; status: string } };
      expect(trf.transfer.status).toBe('dispatched');

      const recRes = (await receiveStockTransfer(
        ownerCtx,
        trf.transfer.id,
        { receiveIntoSellable: false, notes: 'Receive at Kandy' },
        `audit_trf_rec_${tag}`
      )) as { transfer: { status: string } };
      expect(recRes.transfer.status).toBe('received');
    });
  }
);
