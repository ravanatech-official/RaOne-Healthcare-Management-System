import 'dotenv/config';
import crypto from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { isDatabaseConfigured } from '../src/db/index.ts';
import { getOrCreateUser } from '../src/db/users.ts';
import {
  bootstrapClinicWorkspace,
  getBusinessDateInTimezone,
  requireActiveWorkspace,
  type ActiveWorkspaceContext,
} from '../src/domain/tenancy.ts';
import { grantProfessionalAuthority } from '../src/domain/capabilities.ts';
import { ConflictError, ForbiddenError } from '../src/domain/errors.ts';
import { getTodayWorkspaceSummary } from '../src/domain/today.ts';
import {
  acceptStaffInvite,
  createStaffInvite,
  setStaffShiftPin,
} from '../src/domain/team-ops.ts';
import { createProduct } from '../src/domain/pharmacy-catalogue.ts';
import { createSupplier, postGoodsReceipt } from '../src/domain/pharmacy-inventory.ts';
import { checkoutPosSale, closeTillShift, openTillShift } from '../src/domain/pharmacy-pos.ts';
import {
  formatAccountsTaxSummaryCsv,
  getAccountsOverview,
  recordOperatingExpense,
} from '../src/domain/accounts-ops.ts';
import { getPurchasingOverview } from '../src/domain/purchasing-ops.ts';
import {
  createComplianceLicense,
  formatSlipsBankPayrollCsv,
  generateMonthlyPayroll,
  getHrAdminOverview,
  recordColdChainTemp,
  upsertHrProfile,
} from '../src/domain/hr-admin-ops.ts';
import {
  completeShiftChecklist,
  generateAndDispatchOwnerBriefing,
  generateAutoDraftPurchaseOrders,
  getAutopilotCockpit,
  getGovernanceRules,
  getOrCreateDailyChecklists,
  getPublicKioskInfo,
  submitPublicSelfCheckIn,
  toggleShiftChecklistItem,
  updateGovernanceRules,
} from '../src/domain/autopilot-ops.ts';

describe.skipIf(isDatabaseConfigured)(
  'SuwaSeva 0-to-100 Staff Autopilot & Silicon Valley Launch Suite',
  () => {
    const tag = crypto.randomBytes(4).toString('hex');
    let ownerCtx: ActiveWorkspaceContext;
    let cashierCtx: ActiveWorkspaceContext;
    let accountantCtx: ActiveWorkspaceContext;
    let tenantId: string;
    let tenantSlug: string;
    let branchId: string;
    let serviceId: string;
    let resourceId: string;
    let productId: string;
    let packVariantId: string;
    let todayDate: string;

    beforeAll(async () => {
      const ownerUser = await getOrCreateUser(
        `sv_owner_${tag}`,
        `owner_${tag}@suwaseva.lk`,
        'Dr. Amal Jayawardena'
      );

      ownerCtx = await bootstrapClinicWorkspace(
        {
          id: ownerUser.id,
          uid: ownerUser.uid,
          email: ownerUser.email,
          displayName: ownerUser.displayName,
          preferredLocale: 'si-LK',
        },
        {
          preferredLocale: 'si-LK',
          productMode: 'combo',
          clinicName: `SuwaSeva Autopilot Med ${tag}`,
          legalEntityName: `SuwaSeva Autopilot ${tag} (Pvt) Ltd`,
          branchName: 'Colombo Flagship',
          countryCode: 'LK',
          timezone: 'Asia/Colombo',
          currency: 'LKR',
          confirmLocaleAndCurrency: true,
          primaryPractitionerName: 'Dr. Amal Jayawardena',
          primaryPractitionerSpecialty: 'General Medicine',
          openingHoursSummary: '08:00 - 21:00',
          services: [
            {
              name: 'OPD Consultation',
              nameSi: 'බාහිර රෝගී උපදේශනය',
              durationMinutes: 15,
              priceLkr: 2000,
            },
          ],
          includeSampleData: false,
        },
        `corr_sv_boot_${tag}`
      );

      tenantId = ownerCtx.tenantId;
      branchId = ownerCtx.branchId;
      todayDate = getBusinessDateInTimezone('Asia/Colombo');

      await grantProfessionalAuthority(
        ownerCtx,
        {
          userId: ownerUser.id,
          grantType: 'pharmacist',
          licenseNumber: `SLMC-SV-${tag}`,
        },
        `corr_sv_grant_${tag}`
      );
      ownerCtx = await requireActiveWorkspace(
        {
          id: ownerUser.id,
          uid: ownerUser.uid,
          email: ownerUser.email,
          displayName: ownerUser.displayName,
          preferredLocale: 'si-LK',
        },
        tenantId
      );

      // Set Owner Shift PIN for Maker-Checker Overrides
      await setStaffShiftPin(ownerCtx, '4321', `corr_sv_pin_${tag}`);

      // Invite and activate Cashier & Accountant
      const cashierInvite = await createStaffInvite(
        ownerCtx,
        {
          email: `cashier_${tag}@suwaseva.lk`,
          displayName: 'Kasun Cashier',
          role: 'cashier',
          branchId,
        },
        `corr_sv_inv_c_${tag}`
      );
      const cashierUser = await getOrCreateUser(
        `sv_cashier_${tag}`,
        `cashier_${tag}@suwaseva.lk`,
        'Kasun Cashier'
      );
      await acceptStaffInvite(
        {
          id: cashierUser.id,
          uid: cashierUser.uid,
          email: cashierUser.email,
          displayName: cashierUser.displayName,
          preferredLocale: 'si-LK',
        },
        cashierInvite.inviteToken,
        `corr_sv_acc_c_${tag}`
      );
      cashierCtx = await requireActiveWorkspace(
        {
          id: cashierUser.id,
          uid: cashierUser.uid,
          email: cashierUser.email,
          displayName: cashierUser.displayName,
          preferredLocale: 'si-LK',
        },
        tenantId
      );

      const accountantInvite = await createStaffInvite(
        ownerCtx,
        {
          email: `acc_${tag}@suwaseva.lk`,
          displayName: 'Nethmi Accountant',
          role: 'accountant',
          branchId,
        },
        `corr_sv_inv_a_${tag}`
      );
      const accUser = await getOrCreateUser(
        `sv_acc_${tag}`,
        `acc_${tag}@suwaseva.lk`,
        'Nethmi Accountant'
      );
      await acceptStaffInvite(
        {
          id: accUser.id,
          uid: accUser.uid,
          email: accUser.email,
          displayName: accUser.displayName,
          preferredLocale: 'si-LK',
        },
        accountantInvite.inviteToken,
        `corr_sv_acc_a_${tag}`
      );
      accountantCtx = await requireActiveWorkspace(
        {
          id: accUser.id,
          uid: accUser.uid,
          email: accUser.email,
          displayName: accUser.displayName,
          preferredLocale: 'si-LK',
        },
        tenantId
      );

      const today = await getTodayWorkspaceSummary(ownerCtx, todayDate);
      serviceId = today.services[0].id;
      resourceId = today.resources[0].id;

      const cockpit = await getAutopilotCockpit(ownerCtx, todayDate);
      tenantSlug = cockpit.tenantSlug;
    });

    it('P0.1 SOP Checklists: enforces mandatory steps before completion and persists cash drawer + handover sign-off', async () => {
      const lists = await getOrCreateDailyChecklists(ownerCtx, todayDate);
      expect(lists.opening.status).toBe('in_progress');
      expect(lists.opening.items.some((i) => i.required)).toBe(true);

      // Cannot complete while required items are unchecked
      await expect(
        completeShiftChecklist(
          ownerCtx,
          lists.opening.id,
          { handoverNotes: 'Try early finish', cashDrawerCountLkr: 5000 },
          `corr_sop_fail_${tag}`
        )
      ).rejects.toThrow(ConflictError);

      // Complete all required items
      for (const item of lists.opening.items.filter((i) => i.required)) {
        await toggleShiftChecklistItem(
          ownerCtx,
          lists.opening.id,
          { itemKey: item.key, completed: true },
          ownerCtx.tenantName,
          `corr_sop_tog_${item.key}_${tag}`
        );
      }

      const signedOpening = await completeShiftChecklist(
        ownerCtx,
        lists.opening.id,
        {
          handoverNotes: 'Morning float verified; cold chain 4C.',
          cashDrawerCountLkr: 5000,
        },
        `corr_sop_done_${tag}`
      );
      expect(signedOpening.status).toBe('completed');
      expect(signedOpening.cashDrawerCountMinor).toBe(500000);
      expect(signedOpening.handoverNotes).toContain('Morning float verified');
    });

    it('P0.2 Maker-Checker Anti-Fraud Governance: blocks excessive cashier POS discount & high-value OpEx without Owner Shift PIN, and succeeds with valid PIN', async () => {
      const rules = await updateGovernanceRules(
        ownerCtx,
        {
          maxCashierDiscountPercent: 10,
          maxExpenseWithoutPinMinor: 1_500_000, // LKR 15,000
          maxStockWriteoffWithoutPin: 20,
          requireClosingChecklist: true,
          autoReorderEnabled: true,
          ownerDigestEnabled: true,
          ownerWhatsappPhone: '0771122334',
        },
        `corr_gov_upd_${tag}`
      );
      expect(rules.maxCashierDiscountPercent).toBe(10);
      expect((await getGovernanceRules(ownerCtx)).ownerWhatsappPhone).toBe('0771122334');

      // Seed supplier, OTC product w/ par levels, and GRN stock
      const sup = await createSupplier(
        ownerCtx,
        { name: `Lanka Meds ${tag}`, registrationRef: `LM-${tag}`, status: 'approved' },
        `corr_sup_sv_${tag}`
      );
      const prod = await createProduct(
        ownerCtx,
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
          regulatoryClass: 'otc',
          storageCondition: 'ambient',
          baseUnit: 'tablet',
          minShelfLifeDays: 10,
          reorderPointBase: 50,
          targetParBase: 200,
          initialPack: {
            variantName: 'Box of 10',
            packUnit: 'pack',
            baseQtyPerPack: 10,
            defaultSalePriceMinor: 100000, // LKR 1,000
            barcodeType: 'ean13',
          },
        },
        `corr_prod_sv_${tag}`
      );
      productId = prod.product.id;
      packVariantId = prod.initialPackVariant!.id;

      const dExp = new Date(`${todayDate}T00:00:00Z`);
      dExp.setUTCDate(dExp.getUTCDate() + 180);

      await postGoodsReceipt(
        ownerCtx,
        {
          idempotencyKey: `grn-sv-${tag}`,
          supplierId: sup.id,
          supplierDocRef: `SV-GRN-${tag}`,
          docType: 'grn',
          receivedDate: todayDate,
          notes: 'Initial autopilot batch',
          lines: [
            {
              productId,
              packVariantId,
              batchNumber: `AUG-B1-${tag}`,
              printedExpiry: dExp.toISOString().slice(0, 10),
              expiryPrecision: 'day',
              orderedPacks: 4, // 40 tablets (< 50 reorderPointBase -> triggers Smart Reorder!)
              receivedPacks: 4,
              bonusPacks: 0,
              quarantinedPacks: 0,
              unitPackCostMinor: 75000,
              isProvisionalCost: false,
              condition: 'good',
              releaseImmediately: true,
            },
          ],
        },
        `corr_grn_sv_${tag}`
      );

      const shift = await openTillShift(
        cashierCtx,
        { openingFloatMinor: 500000 },
        `corr_sh_sv_${tag}`
      );

      // 1. Cashier attempts 25% discount (LKR 250 on LKR 1000) without Owner PIN -> BLOCKED
      await expect(
        checkoutPosSale(
          cashierCtx,
          {
            idempotencyKey: `pos-block-${tag}`,
            shiftId: shift.shift.id,
            items: [{ productId, packVariantId, qtyPacks: 1 }],
            discountMinor: 25000,
            payments: [{ method: 'cash', amountMinor: 75000, referenceNumber: '' }],
          },
          `corr_pos_blk_${tag}`
        )
      ).rejects.toMatchObject({ code: 'GOVERNANCE_PIN_REQUIRED' });

      // 2. Cashier provides WRONG override PIN -> REJECTED
      await expect(
        checkoutPosSale(
          cashierCtx,
          {
            idempotencyKey: `pos-badpin-${tag}`,
            shiftId: shift.shift.id,
            items: [{ productId, packVariantId, qtyPacks: 1 }],
            discountMinor: 25000,
            managerOverridePin: '0000',
            payments: [{ method: 'cash', amountMinor: 75000, referenceNumber: '' }],
          },
          `corr_pos_badpin_${tag}`
        )
      ).rejects.toThrow(ForbiddenError);

      // 3. Cashier provides valid Owner Shift PIN ('4321') -> SUCCEEDS!
      const approvedSale = (await checkoutPosSale(
        cashierCtx,
        {
          idempotencyKey: `pos-okpin-${tag}`,
          shiftId: shift.shift.id,
          items: [{ productId, packVariantId, qtyPacks: 1 }],
          discountMinor: 25000,
          managerOverridePin: '4321',
          payments: [{ method: 'cash', amountMinor: 75000, referenceNumber: '' }],
        },
        `corr_pos_okpin_${tag}`
      )) as { sale: { id: string; totalMinor: number } };
      expect(approvedSale.sale.totalMinor).toBe(75000);

      // 4. Close till shift with > Rs 500 shortage to trigger till_variance anomaly
      await closeTillShift(
        ownerCtx,
        shift.shift.id,
        { countedCashMinor: 10000, closeNotes: 'Shortage test' },
        `corr_sh_close_${tag}`
      );

      // 5. Accountant tries LKR 20,000 OpEx (> 15,000 limit) without PIN -> BLOCKED; with '4321' -> SUCCEEDS
      await expect(
        recordOperatingExpense(
          accountantCtx,
          {
            category: 'maintenance',
            description: 'Generator repair',
            amountLkr: 20000,
            paymentMethod: 'bank',
            referenceNo: `GEN-${tag}`,
          },
          `corr_opex_blk_${tag}`
        )
      ).rejects.toMatchObject({ code: 'GOVERNANCE_PIN_REQUIRED' });

      const opexOk = await recordOperatingExpense(
        accountantCtx,
        {
          category: 'maintenance',
          description: 'Generator repair',
          amountLkr: 20000,
          paymentMethod: 'bank',
          referenceNo: `GEN-OK-${tag}`,
          managerOverridePin: '4321',
        },
        `corr_opex_ok_${tag}`
      );
      expect(opexOk.expense.amountMinor).toBe(2000000);
    });

    it('P1 & P2: Smart Auto-Reorder Velocity Engine, Anomaly Guard Scanner, Bilingual Owner Briefing, Public QR Kiosk, SLIPS & IRD Tax CSV', async () => {
      // Trigger cold-chain excursion & expiring license so Anomaly Guard detects all risk dimensions
      await recordColdChainTemp(
        ownerCtx,
        { fridgeName: 'Insulin Fridge A', temperatureC: 11.4 },
        `corr_cc_sv_${tag}`
      );

      const dLic = new Date(`${todayDate}T00:00:00Z`);
      dLic.setUTCDate(dLic.getUTCDate() + 5);
      await createComplianceLicense(
        ownerCtx,
        {
          title: 'SLMC Clinic Registration',
          authority: 'SLMC',
          licenseNumber: `SLMC-LIC-${tag}`,
          expiresOn: dLic.toISOString().slice(0, 10),
          alertDaysBefore: 30,
        },
        `corr_lic_sv_${tag}`
      );

      // Public Patient QR Check-In Kiosk (unauthenticated, zero PII leaked)
      const kioskInfo = await getPublicKioskInfo(tenantSlug);
      expect(kioskInfo.tenantSlug).toBe(tenantSlug);
      expect(kioskInfo.services.length).toBeGreaterThanOrEqual(1);
      expect((kioskInfo as unknown as Record<string, unknown>).patients).toBeUndefined();

      const checkin = await submitPublicSelfCheckIn(
        tenantSlug,
        {
          patientName: 'Kamal Gunasekara',
          phone: '0719988776',
          serviceId,
          resourceId,
          notes: 'QR kiosk walk-in',
        },
        `corr_kiosk_${tag}`
      );
      expect(checkin.tokenNumber).toBe(1);
      expect(checkin.patientName).toBe('Kamal Gunasekara');

      // Cockpit verification: anomalies + smart reorder + solo snapshot
      const cockpit = await getAutopilotCockpit(ownerCtx, todayDate);
      expect(cockpit.anomalies.some((a) => a.category === 'till_variance')).toBe(true);
      expect(cockpit.anomalies.some((a) => a.category === 'cold_chain')).toBe(true);
      expect(cockpit.anomalies.some((a) => a.category === 'license')).toBe(true);
      expect(cockpit.smartReorders.some((r) => r.productId === productId)).toBe(true);
      expect(cockpit.soloSnapshot.nextWaitingPatient?.personName).toBe('Kamal Gunasekara');

      // 1-Click Auto-Draft PO from Smart Reorder Velocity Engine
      const autoPo = await generateAutoDraftPurchaseOrders(ownerCtx, `corr_autopo_${tag}`);
      expect(autoPo.createdCount).toBeGreaterThanOrEqual(1);
      const purchOverview = await getPurchasingOverview(ownerCtx);
      expect(purchOverview.purchaseOrders.some((p) => p.status === 'draft')).toBe(true);

      // Bilingual Daily Owner Briefing (EN + සිංහල + WhatsApp dispatch)
      const briefing = await generateAndDispatchOwnerBriefing(
        ownerCtx,
        { sendWhatsapp: true },
        `corr_brief_${tag}`
      );
      expect(briefing.summaryTextSi).toContain('මුළු ආදායම');
      expect(briefing.summaryTextEn).toContain('Total Revenue');
      expect(briefing.dispatchedChannel).toBe('whatsapp');

      // Sri Lanka SLIPS Bank Payroll CSV & IRD Tax Summary CSV
      await upsertHrProfile(
        ownerCtx,
        {
          userId: ownerCtx.userId,
          designation: 'Clinic Owner',
          basicSalaryLkr: 150000,
          allowancesLkr: 25000,
          epfApplicable: true,
          etfApplicable: true,
          bankName: 'Sampath Bank PLC',
          bankAccountNo: '002910099887',
        },
        `corr_hr_sv_${tag}`
      );
      const month = todayDate.slice(0, 7);
      await generateMonthlyPayroll(ownerCtx, month, `corr_pr_sv_${tag}`);
      const hrOverview = await getHrAdminOverview(ownerCtx);
      const slipsCsv = formatSlipsBankPayrollCsv(hrOverview, month);
      expect(slipsCsv).toContain('Bank Name');
      expect(slipsCsv).toContain('Sampath Bank PLC');
      expect(slipsCsv).toContain('002910099887');
      expect(slipsCsv).toContain('Net SLIPS Credit (LKR)');

      const accOverview = await getAccountsOverview(ownerCtx, todayDate);
      const taxCsv = formatAccountsTaxSummaryCsv(ownerCtx.tenantName, accOverview);
      expect(taxCsv).toContain('Estimated SSCL Reference (2.5% Gross)');
      expect(taxCsv).toContain('True Daily Net Profit (Taxable Base Est.)');
    });
  }
);
