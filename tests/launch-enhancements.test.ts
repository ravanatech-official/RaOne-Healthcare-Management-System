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
import { DomainError, ForbiddenError } from '../src/domain/errors.ts';
import { getTodayWorkspaceSummary } from '../src/domain/today.ts';
import {
  createAppointmentForTenant,
  createPersonForTenant,
  recordClinicPaymentForTenant,
} from '../src/domain/clinic-writes.ts';
import {
  broadcastDoctorDelay,
  createDoctorHolidayBlock,
  createDoctorSchedule,
  getAvailableDoctorSlots,
  getDoctorPayoutReport,
  getPatientVisitHistory,
  getWaitingRoomDisplay,
  updateAppointmentQueueState,
  upsertDoctorCommissionRule,
} from '../src/domain/clinic-ops.ts';
import {
  assertWorkspaceNotReadOnlyGrace,
  assertWithinQuota,
  computePayHereMd5Sig,
  getSubscriptionOverview,
  getWorkspaceQuotaSummary,
  processPayHereWebhook,
  setMemorySubscriptionStateForTest,
  triggerSandboxPayHereWebhook,
} from '../src/domain/subscription-billing.ts';
import { listNotificationDispatches, sendNotificationDispatch } from '../src/domain/notifications.ts';
import { createProduct } from '../src/domain/pharmacy-catalogue.ts';
import {
  createSupplier,
  getStockAndLotSummary,
  postGoodsReceipt,
} from '../src/domain/pharmacy-inventory.ts';
import { checkoutPosSale, openTillShift } from '../src/domain/pharmacy-pos.ts';
import {
  createDispenseOrder,
  createStocktake,
  createStockTransfer,
  formatCombinedZReportCsv,
  getCombinedZReport,
  getPharmacyAlertsDashboard,
  listDispenseOrders,
  listStocktakes,
  receiveStockTransfer,
  reconcileStocktake,
  submitStocktakeCounts,
  updateDispenseOrderStatus,
} from '../src/domain/pharmacy-ops.ts';
import {
  createStaffInvite,
  createWorkspaceBranch,
  revokeStaffInvite,
  setStaffShiftPin,
  verifyStaffShiftPin,
} from '../src/domain/team-ops.ts';
import { runJarvisConversationalTurn } from '../src/adapters/gemini-jarvis.ts';
import {
  createReceivableAccount,
  getAccountsOverview,
  recordOperatingExpense,
  recordReceivableEntry,
  recordSupplierPayment,
  voidOperatingExpense,
} from '../src/domain/accounts-ops.ts';
import {
  approvePurchaseOrder,
  convertPurchaseOrderToGrn,
  createPurchaseOrder,
  createSupplierDebitNote,
  getPurchasingOverview,
} from '../src/domain/purchasing-ops.ts';
import {
  clockInStaff,
  clockOutStaff,
  createComplianceLicense,
  createLabOrder,
  generateMonthlyPayroll,
  getHrAdminOverview,
  recordColdChainTemp,
  requestLeave,
  reviewLeaveRequest,
  updateLabOrderStatus,
  upsertHrProfile,
} from '../src/domain/hr-admin-ops.ts';

describe.skipIf(isDatabaseConfigured)(
  'SuwaSeva Launch Suite (Categories A-D + J.A.R.V.I.S. Conversational Voice Engine)',
  () => {
    const tag = crypto.randomBytes(4).toString('hex');
    let ownerCtx: ActiveWorkspaceContext;
    let tenantId: string;
    let branch1Id: string;
    let branch2Id: string;
    let serviceId: string;
    let resourceId: string;
    let patientId: string;
    let productId: string;
    let packVariantId: string;
    let lotId: string;
    let todayDate: string;

    beforeAll(async () => {
      const ownerUser = await getOrCreateUser(
        `launch_owner_${tag}`,
        `owner_${tag}@suwaseva.lk`,
        'Dr. Kasun Jayasinghe'
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
          clinicName: `SuwaSeva Launch Centre ${tag}`,
          legalEntityName: `SuwaSeva Medical ${tag} (Pvt) Ltd`,
          branchName: 'Colombo Main',
          countryCode: 'LK',
          timezone: 'Asia/Colombo',
          currency: 'LKR',
          confirmLocaleAndCurrency: true,
          primaryPractitionerName: 'Dr. Chaminda Silva',
          primaryPractitionerSpecialty: 'General Physician',
          openingHoursSummary: '08:00 - 20:00',
          services: [
            {
              name: 'Channeling Consultation',
              nameSi: 'වෛද්‍ය උපදේශනය',
              durationMinutes: 20,
              priceLkr: 2500,
            },
          ],
          includeSampleData: false,
        },
        `corr_boot_${tag}`
      );

      tenantId = ownerCtx.tenantId;
      branch1Id = ownerCtx.branchId;
      todayDate = getBusinessDateInTimezone('Asia/Colombo');

      // Grant pharmacist authority to owner for full release & transfer verification
      await grantProfessionalAuthority(
        ownerCtx,
        {
          userId: ownerUser.id,
          grantType: 'pharmacist',
          licenseNumber: `SLMC-LAUNCH-${tag}`,
        },
        `corr_grant_${tag}`
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

      const summary = await getTodayWorkspaceSummary(ownerCtx, todayDate);
      serviceId = summary.services[0].id;
      resourceId = summary.resources[0].id;
    });

    it('Category A: verifies PayHere MD5 webhook, recurring token activation, read-only grace lock, usage quotas, and WA/SMS dispatch', async () => {
      const overview = await getSubscriptionOverview(ownerCtx);
      const openInv = overview.invoices[0];
      expect(openInv).toBeTruthy();

      // 1. Invalid MD5 signature must fail cleanly
      await expect(
        processPayHereWebhook(
          {
            merchant_id: '1228490',
            order_id: openInv.invoiceNumber,
            payment_id: `PH-BAD-${tag}`,
            payhere_amount: '12500.00',
            payhere_currency: 'LKR',
            status_code: '2',
            md5sig: 'DEADBEEF12345678',
            method: 'VISA',
            card_holder_name: 'Dr Kasun',
            card_no: '4242********4242',
            card_expiry: '12/29',
            recurring_token: 'tok_bad',
            gateway_provider: 'payhere',
          },
          `corr_wh_bad_${tag}`
        )
      ).rejects.toThrow(DomainError);

      // 2. Simulate overdue grace period -> operational writes blocked with 402 GRACE_READ_ONLY
      setMemorySubscriptionStateForTest(tenantId, {
        status: 'past_due',
        trialEndsAt: '2020-01-01',
        graceEndsAt: '2020-01-08',
      });
      await expect(assertWorkspaceNotReadOnlyGrace(tenantId, 'Asia/Colombo')).rejects.toMatchObject({
        code: 'GRACE_READ_ONLY',
        statusCode: 402,
      });

      // 3. Valid PayHere sandbox webhook settles invoice, saves recurring token, and unlocks writes!
      const settled = await triggerSandboxPayHereWebhook(
        ownerCtx,
        { invoiceId: openInv.id, statusCode: '2', gatewayProvider: 'payhere' },
        `corr_wh_ok_${tag}`
      );
      expect(settled.webhookResult.verified).toBe(true);
      expect(settled.webhookResult.settled).toBe(true);
      expect(settled.overview.subscription.status).toBe('active');
      expect(settled.overview.subscription.recurringTokenActive).toBe(true);

      await expect(assertWorkspaceNotReadOnlyGrace(tenantId, 'Asia/Colombo')).resolves.toBeUndefined();

      // 4. Quota metering check & deterministic signature helper
      const quotas = await getWorkspaceQuotaSummary(ownerCtx);
      expect(quotas.staffLimit).toBe(15);
      expect(quotas.branchLimit).toBe(2);
      await assertWithinQuota(ownerCtx, 'branches');

      const md5Sig = computePayHereMd5Sig({
        merchantId: '1228490',
        orderId: openInv.invoiceNumber,
        payhereAmount: '12500.00',
        payhereCurrency: 'LKR',
        statusCode: '2',
      });
      expect(md5Sig).toMatch(/^[A-F0-9]{32}$/);

      // 5. WhatsApp & SMS notification dispatch
      const wa = await sendNotificationDispatch(
        ownerCtx,
        {
          channel: 'whatsapp',
          provider: 'whatsapp_cloud',
          templateType: 'invoice_due',
          recipientPhone: '0771234567',
          recipientName: 'Owner',
          messageBody: `Reminder: Invoice ${openInv.invoiceNumber} settled.`,
          entityType: 'subscription_invoice',
          entityId: openInv.id,
        },
        `corr_wa_${tag}`
      );
      expect(wa.whatsappDeepLink).toContain('https://wa.me/94771234567');
      const dispatches = await listNotificationDispatches(ownerCtx);
      expect(dispatches.length).toBeGreaterThanOrEqual(1);
    });

    it('Category B: manages doctor schedules, holiday blocks, slot availability, waiting room TV queue, patient visit history & commission payouts', async () => {
      // 1. Register patient & create weekly schedule for today's weekday
      const person = await createPersonForTenant(
        ownerCtx,
        {
          displayName: 'Saman Kumara',
          phone: '0775551234',
          aliases: ['Saman'],
          notes: 'Hypertension follow-up',
          confirmDuplicate: false,
        },
        `corr_person_${tag}`
      );
      patientId = person.id;

      // Get Colombo day of week for todayDate
      const dtColombo = new Date(`${todayDate}T12:00:00+05:30`);
      const dayOfWeek = dtColombo.getDay();

      await createDoctorSchedule(
        ownerCtx,
        {
          resourceId,
          dayOfWeek,
          startTime: '16:00',
          endTime: '17:00',
          slotDurationMinutes: 30,
        },
        `corr_sched_${tag}`
      );

      // Book 16:00 Colombo slot
      const firstSlotStartIso = `${todayDate}T16:00:00+05:30`;
      const apt = (await createAppointmentForTenant(
        ownerCtx,
        {
          idempotencyKey: `apt-launch-${tag}`,
          personId: patientId,
          serviceId,
          resourceId,
          startsAt: new Date(firstSlotStartIso).toISOString(),
          notes: 'Channeling token #1',
        },
        `corr_apt_${tag}`
      )) as { appointment: { id: string } };

      // Quick slot picker marks 16:00 unavailable and 16:30 available
      const slotsResp = await getAvailableDoctorSlots(ownerCtx, resourceId, todayDate);
      expect(slotsResp.isHoliday).toBe(false);
      expect(slotsResp.slots.length).toBe(2);
      expect(slotsResp.slots[0].available).toBe(false);
      expect(slotsResp.slots[1].available).toBe(true);

      // Holiday block on another date marks that entire date blocked
      const nextDay = '2026-12-25';
      await createDoctorHolidayBlock(
        ownerCtx,
        {
          resourceId,
          blockDate: nextDay,
          reason: 'Christmas Public Holiday',
        },
        `corr_hol_${tag}`
      );
      const blockedResp = await getAvailableDoctorSlots(ownerCtx, resourceId, nextDay);
      expect(blockedResp.isHoliday).toBe(true);
      expect(blockedResp.holidayReason).toContain('Christmas');

      // Waiting room TV queue & delay broadcast
      await updateAppointmentQueueState(
        ownerCtx,
        apt.appointment.id,
        { queueState: 'waiting' },
        `corr_tok_w_${tag}`
      );
      await broadcastDoctorDelay(ownerCtx, resourceId, 15, `corr_delay_${tag}`);
      await updateAppointmentQueueState(
        ownerCtx,
        apt.appointment.id,
        { queueState: 'serving' },
        `corr_tok_${tag}`
      );
      const tv = await getWaitingRoomDisplay(ownerCtx, todayDate);
      expect(tv.nowServing.length).toBe(1);
      expect(tv.nowServing[0].patientName).toBe('Saman Kumara');
      expect(tv.nowServing[0].delayMinutes).toBe(15);

      // Clinic payment -> Patient Visit History + Doctor Payout Commission Split (80% / 20%)
      await recordClinicPaymentForTenant(
        ownerCtx,
        {
          idempotencyKey: `pay-launch-${tag}`,
          personId: patientId,
          appointmentId: apt.appointment.id,
          description: 'Channeling Consultation Fee',
          amountMinor: 250000,
          method: 'cash',
          referenceNumber: '',
        },
        `corr_pay_${tag}`
      );

      const history = await getPatientVisitHistory(ownerCtx, patientId);
      expect(history.totalVisits).toBe(1);
      expect(history.totalPaidMinor).toBe(250000);
      expect(history.unpaidBalanceMinor).toBe(0);

      await upsertDoctorCommissionRule(
        ownerCtx,
        { resourceId, doctorSharePercent: 80 },
        `corr_comm_${tag}`
      );
      const payouts = await getDoctorPayoutReport(ownerCtx, todayDate);
      expect(payouts.totalGrossMinor).toBe(250000);
      expect(payouts.totalDoctorShareMinor).toBe(200000);
      expect(payouts.totalClinicShareMinor).toBe(50000);
    });

    it('Category C & D: executes alerts (30/60/90d), stocktake reconciliation, inter-branch quarantine transfer, Rx dispense handoff, Combined Z-Report & CSV, Staff Invites, Shift PIN & J.A.R.V.I.S.', async () => {
      // 1. Setup Pharmacy Supplier, SKU (Paracetamol 500mg), and Receive near-expiry stock (within 20 days)
      const sup = await createSupplier(
        ownerCtx,
        { name: `SPC Lanka ${tag}`, registrationRef: `SPC-${tag}`, status: 'approved' },
        `corr_sup_${tag}`
      );

      const prod = await createProduct(
        ownerCtx,
        {
          skuCode: `PCM-500-${tag}`,
          displayName: 'Paracetamol 500mg Tablet',
          genericName: 'Paracetamol',
          brandName: 'Panadol',
          strengthValue: '500',
          strengthUnit: 'mg',
          dosageForm: 'tablet',
          route: 'oral',
          manufacturer: 'SPC',
          regulatoryClass: 'otc',
          storageCondition: 'ambient',
          baseUnit: 'tablet',
          minShelfLifeDays: 10,
          initialPack: {
            variantName: 'Card of 10',
            packUnit: 'pack',
            baseQtyPerPack: 10,
            defaultSalePriceMinor: 15000, // LKR 150
            barcodeType: 'ean13',
          },
        },
        `corr_prod_${tag}`
      );
      productId = prod.product.id;
      packVariantId = prod.initialPackVariant!.id;

      // Calculate YYYY-MM-DD 20 days from todayDate
      const dNear = new Date(`${todayDate}T00:00:00Z`);
      dNear.setUTCDate(dNear.getUTCDate() + 20);
      const nearExpiryIso = dNear.toISOString().slice(0, 10);

      const grn = (await postGoodsReceipt(
        ownerCtx,
        {
          idempotencyKey: `grn-launch-${tag}`,
          supplierId: sup.id,
          supplierDocRef: `GRN-${tag}`,
          docType: 'grn',
          receivedDate: todayDate,
          notes: 'Near-expiry batch check',
          lines: [
            {
              productId,
              packVariantId,
              batchNumber: `PCM-BATCH-${tag}`,
              printedExpiry: nearExpiryIso,
              expiryPrecision: 'day',
              orderedPacks: 4, // 40 tablets (<50 low stock threshold)
              receivedPacks: 4,
              bonusPacks: 0,
              quarantinedPacks: 0,
              unitPackCostMinor: 10000, // LKR 100/card = LKR 10/tab
              isProvisionalCost: false,
              condition: 'good',
              releaseImmediately: true,
            },
          ],
        },
        `corr_grn_${tag}`
      )) as { lines: Array<{ lotId: string }> };
      lotId = grn.lines[0].lotId;

      // Alerts dashboard must surface both within_30d expiry & low-stock SKU
      const alerts = await getPharmacyAlertsDashboard(ownerCtx);
      expect(alerts.summary.expiring30Count).toBeGreaterThanOrEqual(1);
      expect(alerts.summary.lowStockCount).toBeGreaterThanOrEqual(1);

      // 2. Physical Stocktake: count 38 instead of 40 -> variance -2 -> reconcile
      const stRes = await createStocktake(ownerCtx, 'Evening shelf audit', `corr_st_${tag}`);
      const allSt = await listStocktakes(ownerCtx);
      const createdSt = allSt.find((s) => s.id === stRes.stocktake.id)!;
      const targetLine = createdSt.lines.find((l) => l.lotId === lotId);
      expect(targetLine).toBeTruthy();
      expect(targetLine!.systemQtyBase).toBe(40);

      await submitStocktakeCounts(
        ownerCtx,
        stRes.stocktake.id,
        {
          counts: [{ lineId: targetLine!.id, countedQtyBase: 38, reason: '2 tablets damaged blister' }],
        },
        `corr_stc_${tag}`
      );
      await reconcileStocktake(ownerCtx, stRes.stocktake.id, `corr_str_${tag}`);

      const stockAfterReconcile = await getStockAndLotSummary(ownerCtx);
      const recBal = stockAfterReconcile.balances.find((b) => b.lotId === lotId);
      expect(recBal?.sellableOnHand).toBe(38);

      // 3. Multi-Branch Setup & Inter-Branch Transfer (Quarantine-Safe Default Receiving)
      const br2 = await createWorkspaceBranch(
        ownerCtx,
        { name: 'Kandy Branch', code: 'KDY', openingHoursSummary: '08:30 - 18:00' },
        `corr_br2_${tag}`
      );
      branch2Id = br2.id;

      // Creating 3rd branch when plan limit is 2 must throw QUOTA_EXCEEDED
      await expect(assertWithinQuota(ownerCtx, 'branches')).rejects.toMatchObject({
        code: 'QUOTA_EXCEEDED',
        statusCode: 403,
      });

      const transferRes = await createStockTransfer(
        ownerCtx,
        {
          idempotencyKey: `trf-${tag}`,
          toBranchId: branch2Id,
          notes: 'Transfer 8 tablets to Kandy quarantine',
          lines: [{ productId, lotId, qtyBase: 8 }],
        },
        `corr_trf_${tag}`
      );
      await receiveStockTransfer(
        ownerCtx,
        transferRes.transfer.id,
        { receiveIntoSellable: false, notes: 'Pending branch inspection' },
        `corr_trf_rcv_${tag}`
      );

      // Source branch balance reduced 38 -> 30 sellable
      const stockAfterTrf = await getStockAndLotSummary(ownerCtx);
      const srcBalAfterTrf = stockAfterTrf.balances.find((b) => b.lotId === lotId);
      expect(srcBalAfterTrf?.sellableOnHand).toBe(30);

      // 4. Doctor -> Pharmacy Dispense Queue Handoff & POS Sale
      const rxRes = await createDispenseOrder(
        ownerCtx,
        {
          personId: patientId,
          prescriberName: 'Dr. Chaminda Silva',
          clinicalNotes: 'Take with warm water',
          lines: [
            {
              productId,
              packVariantId,
              qtyPacks: 1,
              dosageInstruction: '1 tab TDS PRN',
            },
          ],
        },
        `corr_rx_${tag}`
      );
      const orders = await listDispenseOrders(ownerCtx);
      expect(orders.some((o) => o.id === rxRes.order.id && o.status === 'pending')).toBe(true);

      const shift = await openTillShift(ownerCtx, { openingFloatMinor: 500000 }, `corr_shift_${tag}`);
      const posRes = (await checkoutPosSale(
        ownerCtx,
        {
          idempotencyKey: `pos-launch-${tag}`,
          shiftId: shift.shift.id,
          personId: patientId,
          items: [{ productId, packVariantId, qtyPacks: 1 }],
          discountMinor: 0,
          payments: [{ method: 'cash', amountMinor: 15000, referenceNumber: '' }],
        },
        `corr_pos_${tag}`
      )) as { sale: { id: string } };

      await updateDispenseOrderStatus(
        ownerCtx,
        rxRes.order.id,
        'dispensed',
        posRes.sale.id,
        `corr_rx_done_${tag}`
      );

      // 5. Combined Daily Profit & Z-Report + CSV
      const zReport = await getCombinedZReport(ownerCtx, todayDate);
      expect(zReport.clinic.netCollectionsMinor).toBe(250000);
      expect(zReport.clinic.doctorPayoutsMinor).toBe(200000);
      expect(zReport.pharmacy.netSalesMinor).toBe(15000);
      expect(zReport.combined.totalRevenueMinor).toBe(265000);

      const csv = formatCombinedZReportCsv(zReport);
      expect(zReport.modeFlags.hasClinic).toBe(true);
      expect(zReport.modeFlags.hasPharmacy).toBe(true);
      expect(csv).toContain('Clinic Net Collections');
      expect(csv).toContain('Pharmacy Net Sales');
      expect(csv).toContain('Total Revenue');

      // 6. Staff Invites & Shift PIN Lock Verification
      const invite = await createStaffInvite(
        ownerCtx,
        {
          email: `cashier_${tag}@suwaseva.lk`,
          displayName: 'Nethmi Cashier',
          role: 'cashier',
          branchId: branch1Id,
        },
        `corr_inv_${tag}`
      );
      expect(invite.status).toBe('pending');
      await revokeStaffInvite(ownerCtx, invite.id, `corr_inv_rev_${tag}`);

      await setStaffShiftPin(ownerCtx, '2580', `corr_pin_set_${tag}`);
      await expect(verifyStaffShiftPin(ownerCtx, '2580', `corr_pin_ok_${tag}`)).resolves.toMatchObject({
        verified: true,
        role: 'owner',
      });
      await expect(verifyStaffShiftPin(ownerCtx, '9999', `corr_pin_bad_${tag}`)).rejects.toThrow(
        ForbiddenError
      );

      // 7. J.A.R.V.I.S. Bilingual Voice Engine (Stock query, Expiry query, Draft proposal, Clinical refusal)
      const jStock = await runJarvisConversationalTurn(
        ownerCtx,
        {
          sessionId: `jarvis-${tag}`,
          message: 'Paracetamol 500mg කීයක් තියෙනවද?',
          locale: 'si-LK',
          source: 'voice',
          history: [],
        },
        `corr_j_stock_${tag}`
      );
      expect(jStock.toolCallsExecuted.length).toBeGreaterThanOrEqual(1);
      expect(jStock.replyText).toMatch(/Paracetamol|20|tablet/i);

      const jExpiry = await runJarvisConversationalTurn(
        ownerCtx,
        {
          sessionId: `jarvis-${tag}`,
          message: 'මේ මාසේ expire වෙන ඒවා මොනවද?',
          locale: 'si-LK',
          source: 'voice',
          history: [],
        },
        `corr_j_exp_${tag}`
      );
      expect(jExpiry.toolCallsExecuted.length).toBeGreaterThanOrEqual(1);
      expect(jExpiry.replyText).toMatch(/Paracetamol|expire|PCM-BATCH/i);

      const jDraftPay = await runJarvisConversationalTurn(
        ownerCtx,
        {
          sessionId: `jarvis-${tag}`,
          message: 'Collect LKR 2500 from Saman Kumara in cash',
          locale: 'en-LK',
          source: 'voice',
          history: [],
        },
        `corr_j_pay_${tag}`
      );
      expect(jDraftPay.proposedAction?.actionType).toBe('record_payment');

      const jRefusal = await runJarvisConversationalTurn(
        ownerCtx,
        {
          sessionId: `jarvis-${tag}`,
          message: 'What antibiotic dosage should I prescribe for high fever?',
          locale: 'en-LK',
          source: 'voice',
          history: [],
        },
        `corr_j_refuse_${tag}`
      );
      expect(jRefusal.intent).toBe('out_of_scope_clinical');
      expect(jRefusal.proposedAction).toBeNull();
    });

    it('Departmental Packs: verifies Accounts (True Net P&L, AR/AP Aging), Purchasing (PO -> Approve -> 1-Click GRN + Debit Notes), and HR & Admin (Attendance, Leave, Payroll EPF/ETF, Lab, Cold-Chain, Licenses)', async () => {
      // 1. Accounts: Record OpEx + Void + AR Credit Charge/Payment + Supplier AP Payment
      const expActive = await recordOperatingExpense(
        ownerCtx,
        {
          category: 'utilities',
          description: 'CEB Monthly Electricity Bill',
          amountLkr: 500,
          paymentMethod: 'cash',
          referenceNo: `CEB-${tag}`,
        },
        `corr_exp1_${tag}`
      );
      const expToVoid = await recordOperatingExpense(
        ownerCtx,
        {
          category: 'courier',
          description: 'Duplicate courier voucher',
          amountLkr: 250,
          paymentMethod: 'cash',
          referenceNo: `DUP-${tag}`,
        },
        `corr_exp2_${tag}`
      );
      await voidOperatingExpense(ownerCtx, expToVoid.expense.id, `corr_exp_void_${tag}`);

      const arAcc = await createReceivableAccount(
        ownerCtx,
        {
          accountName: `Ceylinco Corporate ${tag}`,
          accountType: 'corporate',
          phone: '0112699999',
          creditLimitLkr: 100000,
        },
        `corr_ar_${tag}`
      );
      await recordReceivableEntry(
        ownerCtx,
        arAcc.account.id,
        {
          entryType: 'charge',
          amountLkr: 3000,
          method: 'credit',
          referenceNo: `INV-CORP-${tag}`,
          notes: 'Staff medical bill on credit',
        },
        `corr_ar_chg_${tag}`
      );
      const arPaid = await recordReceivableEntry(
        ownerCtx,
        arAcc.account.id,
        {
          entryType: 'payment',
          amountLkr: 1000,
          method: 'bank',
          referenceNo: `FT-${tag}`,
          notes: 'Partial settlement',
        },
        `corr_ar_pay_${tag}`
      );
      expect(arPaid.account.balanceMinor).toBe(200000);

      // Lookup supplier created in prior test
      const supRes = await createSupplier(
        ownerCtx,
        { name: `Hemas Pharma ${tag}`, registrationRef: `HEM-${tag}`, status: 'approved' },
        `corr_sup_dept_${tag}`
      );

      // 2. Purchasing: Create PO -> Approve -> 1-Click Convert to GRN -> Supplier Debit Note
      const poCreated = await createPurchaseOrder(
        ownerCtx,
        {
          supplierId: supRes.id,
          expectedDate: todayDate,
          notes: 'Restock Paracetamol cards',
          lines: [
            {
              productId,
              packVariantId,
              orderedPacks: 5, // 50 tablets
              estimatedUnitPackCostMinor: 10000, // LKR 100/pack
            },
          ],
        },
        `corr_po_new_${tag}`
      );
      expect(poCreated.purchaseOrder.status).toBe('draft');

      const poApproved = await approvePurchaseOrder(
        ownerCtx,
        poCreated.purchaseOrder.id,
        `corr_po_app_${tag}`
      );
      expect(poApproved.purchaseOrder.status).toBe('approved');

      const dFuture = new Date(`${todayDate}T00:00:00Z`);
      dFuture.setUTCDate(dFuture.getUTCDate() + 180);
      const futureExpiry = dFuture.toISOString().slice(0, 10);

      const poGrn = await convertPurchaseOrderToGrn(
        ownerCtx,
        poCreated.purchaseOrder.id,
        {
          batchNumber: `POB-${tag}`,
          printedExpiry: futureExpiry,
          releaseImmediately: true,
          notes: '1-click PO conversion',
        },
        `corr_po_grn_${tag}`
      );
      expect(poGrn.convertedGrnId).toBeTruthy();

      const stockPostPo = await getStockAndLotSummary(ownerCtx);
      const poLotBal = stockPostPo.balances.find((b) => b.batchNumber.startsWith(`POB-${tag}`));
      expect(poLotBal?.sellableOnHand).toBe(50);

      // Supplier debit note for 5 damaged tablets
      const dn = await createSupplierDebitNote(
        ownerCtx,
        {
          supplierId: supRes.id,
          productId,
          lotId: poLotBal!.lotId,
          qtyBase: 5,
          reason: 'damaged',
          amountLkr: 50,
          notes: 'Damaged blister return',
        },
        `corr_dn_${tag}`
      );
      expect(dn.debitNote.amountMinor).toBe(5000);

      const purchOverview = await getPurchasingOverview(ownerCtx);
      const receivedPo = purchOverview.purchaseOrders.find((p) => p.id === poCreated.purchaseOrder.id);
      expect(receivedPo?.status).toBe('received');
      expect(purchOverview.debitNotes.some((d) => d.id === dn.debitNote.id)).toBe(true);

      await recordSupplierPayment(
        ownerCtx,
        {
          supplierId: supRes.id,
          amountLkr: 150,
          method: 'bank',
          referenceNo: `AP-${tag}`,
          notes: 'Advance payment',
        },
        `corr_ap_pay_${tag}`
      );

      // Verify Accounts overview math: True Net = Clinic Net + Pharmacy Gross - Active OpEx (voided excluded)
      const accOverview = await getAccountsOverview(ownerCtx, todayDate);
      expect(accOverview.dailyPnl.operatingExpensesMinor).toBe(50000); // only expActive
      expect(accOverview.dailyPnl.trueNetProfitMinor).toBe(
        accOverview.dailyPnl.clinicNetAfterDoctorMinor +
          accOverview.dailyPnl.pharmacyGrossProfitMinor -
          accOverview.dailyPnl.operatingExpensesMinor
      );
      expect(accOverview.receivables.totalOutstandingMinor).toBe(200000);
      expect(accOverview.expenses.some((e) => e.id === expActive.expense.id && e.status === 'posted')).toBe(
        true
      );

      // 3. HR & Admin: Shift PIN Attendance, Leave, Payroll w/ EPF/ETF, Lab Order, Cold-Chain & Compliance License
      await clockInStaff(ownerCtx, { pin: '2580', notes: 'Morning duty' }, `corr_hr_in_${tag}`);
      await clockOutStaff(ownerCtx, { pin: '2580', notes: 'Shift complete' }, `corr_hr_out_${tag}`);

      const leaveReq = await requestLeave(
        ownerCtx,
        {
          leaveType: 'casual',
          startDate: todayDate,
          endDate: todayDate,
          daysCount: 1,
          reason: 'Family errand',
        },
        `corr_lv_req_${tag}`
      );
      const leaveApp = await reviewLeaveRequest(
        ownerCtx,
        leaveReq.leave.id,
        'approved',
        `corr_lv_app_${tag}`
      );
      expect(leaveApp.leave.status).toBe('approved');

      await upsertHrProfile(
        ownerCtx,
        {
          userId: ownerCtx.userId,
          designation: 'Medical Director',
          basicSalaryLkr: 100000,
          allowancesLkr: 10000,
          epfApplicable: true,
          etfApplicable: true,
          bankName: 'Commercial Bank PLC',
          bankAccountNo: '8001234567',
        },
        `corr_hr_prof_${tag}`
      );

      const payroll = await generateMonthlyPayroll(ownerCtx, todayDate.slice(0, 7), `corr_payrun_${tag}`);
      const ownerSlip = payroll.slips.find((s) => s.userId === ownerCtx.userId)!;
      expect(ownerSlip).toBeTruthy();
      expect(ownerSlip.epfEmployee8Minor).toBe(800000); // 8% of 100,000 LKR
      expect(ownerSlip.epfEmployer12Minor).toBe(1200000); // 12% of 100,000 LKR
      expect(ownerSlip.etfEmployer3Minor).toBe(300000); // 3% of 100,000 LKR
      expect(ownerSlip.commissionMinor).toBe(200000); // Doctor commission pool included

      const lab = await createLabOrder(
        ownerCtx,
        {
          personId: patientId,
          testName: 'Full Blood Count (FBC)',
          labProvider: 'Lanka Diagnostics',
          feeLkr: 1200,
        },
        `corr_lab_${tag}`
      );
      const labDone = await updateLabOrderStatus(
        ownerCtx,
        lab.order.id,
        { status: 'report_ready', resultSummary: 'Hb 13.8 g/dL, WBC Normal' },
        `corr_lab_up_${tag}`
      );
      expect(labDone.order.status).toBe('report_ready');

      const coldSafe = await recordColdChainTemp(
        ownerCtx,
        { fridgeName: 'Vaccine Fridge #1', temperatureC: 4.5 },
        `corr_cc_ok_${tag}`
      );
      expect(coldSafe.log.inRange).toBe(true);

      const coldAlert = await recordColdChainTemp(
        ownerCtx,
        { fridgeName: 'Vaccine Fridge #1', temperatureC: 11.2 },
        `corr_cc_bad_${tag}`
      );
      expect(coldAlert.log.inRange).toBe(false);

      await createComplianceLicense(
        ownerCtx,
        {
          title: 'NMRA Retail Pharmacy Permit',
          authority: 'NMRA',
          licenseNumber: `NMRA-${tag}`,
          expiresOn: futureExpiry,
          alertDaysBefore: 30,
        },
        `corr_lic_${tag}`
      );

      const hrOverview = await getHrAdminOverview(ownerCtx);
      expect(hrOverview.attendanceToday.length).toBeGreaterThanOrEqual(1);
      expect(hrOverview.payrollRuns.length).toBeGreaterThanOrEqual(1);
      expect(hrOverview.labOrders.length).toBeGreaterThanOrEqual(1);
      expect(hrOverview.coldChainLogs.length).toBeGreaterThanOrEqual(2);
      expect(hrOverview.licenses.length).toBeGreaterThanOrEqual(1);
    });

    it('Pure-Pharmacy Mode Separation: hides clinic metrics from Z-Report CSV and keeps J.A.R.V.I.S. revenue responses strictly pharmacy-scoped', async () => {
      const pharmUser = await getOrCreateUser(
        `pharm_only_${tag}`,
        `pharm_${tag}@suwaseva.lk`,
        'Nimali Perera'
      );

      let pharmCtx = await bootstrapClinicWorkspace(
        {
          id: pharmUser.id,
          uid: pharmUser.uid,
          email: pharmUser.email,
          displayName: pharmUser.displayName,
          preferredLocale: 'si-LK',
        },
        {
          preferredLocale: 'si-LK',
          productMode: 'pharmacy_retail_only',
          clinicName: `Galle Pharmacy ${tag}`,
          legalEntityName: `Galle Pharmacy ${tag} (Pvt) Ltd`,
          branchName: 'Galle Fort Main',
          countryCode: 'LK',
          timezone: 'Asia/Colombo',
          currency: 'LKR',
          confirmLocaleAndCurrency: true,
          primaryPractitionerName: 'Nimali Perera',
          primaryPractitionerSpecialty: 'Retail Pharmacy',
          openingHoursSummary: '08:00 - 21:00',
          services: [],
          includeSampleData: false,
        },
        `corr_p_boot_${tag}`
      );

      expect(pharmCtx.capabilities['appointments.manage']).toBe(false);
      expect(pharmCtx.capabilities['pharmacy.pos']).toBe(true);

      await grantProfessionalAuthority(
        pharmCtx,
        {
          userId: pharmUser.id,
          grantType: 'pharmacist',
          licenseNumber: `SLMC-PHARM-${tag}`,
        },
        `corr_p_grant_${tag}`
      );
      pharmCtx = await requireActiveWorkspace(
        {
          id: pharmUser.id,
          uid: pharmUser.uid,
          email: pharmUser.email,
          displayName: pharmUser.displayName,
          preferredLocale: 'si-LK',
        },
        pharmCtx.tenantId
      );

      const pSup = await createSupplier(
        pharmCtx,
        { name: `Galle Distributors ${tag}`, registrationRef: `GD-${tag}`, status: 'approved' },
        `corr_p_sup_${tag}`
      );
      const pProd = await createProduct(
        pharmCtx,
        {
          skuCode: `AMX-500-${tag}`,
          displayName: 'Amoxicillin 500mg Capsule',
          genericName: 'Amoxicillin',
          brandName: 'Amoxil',
          strengthValue: '500',
          strengthUnit: 'mg',
          dosageForm: 'capsule',
          route: 'oral',
          manufacturer: 'SPC',
          regulatoryClass: 'otc',
          storageCondition: 'ambient',
          baseUnit: 'capsule',
          minShelfLifeDays: 10,
          initialPack: {
            variantName: 'Strip of 10',
            packUnit: 'pack',
            baseQtyPerPack: 10,
            defaultSalePriceMinor: 32000, // LKR 320
            barcodeType: 'ean13',
          },
        },
        `corr_p_prod_${tag}`
      );

      const dExp = new Date(`${todayDate}T00:00:00Z`);
      dExp.setUTCDate(dExp.getUTCDate() + 120);
      await postGoodsReceipt(
        pharmCtx,
        {
          idempotencyKey: `p-grn-${tag}`,
          supplierId: pSup.id,
          supplierDocRef: `P-GRN-${tag}`,
          docType: 'grn',
          receivedDate: todayDate,
          notes: 'Pure pharmacy initial stock',
          lines: [
            {
              productId: pProd.product.id,
              packVariantId: pProd.initialPackVariant!.id,
              batchNumber: `AMX-B1-${tag}`,
              printedExpiry: dExp.toISOString().slice(0, 10),
              expiryPrecision: 'day',
              orderedPacks: 5,
              receivedPacks: 5,
              bonusPacks: 0,
              quarantinedPacks: 0,
              unitPackCostMinor: 20000,
              isProvisionalCost: false,
              condition: 'good',
              releaseImmediately: true,
            },
          ],
        },
        `corr_p_grn_${tag}`
      );

      const pShift = await openTillShift(pharmCtx, { openingFloatMinor: 200000 }, `corr_p_sh_${tag}`);
      await checkoutPosSale(
        pharmCtx,
        {
          idempotencyKey: `p-sale-${tag}`,
          shiftId: pShift.shift.id,
          items: [{ productId: pProd.product.id, packVariantId: pProd.initialPackVariant!.id, qtyPacks: 1 }],
          discountMinor: 0,
          payments: [{ method: 'cash', amountMinor: 32000, referenceNumber: '' }],
        },
        `corr_p_sale_${tag}`
      );

      const pZReport = await getCombinedZReport(pharmCtx, todayDate);
      expect(pZReport.modeFlags.hasClinic).toBe(false);
      expect(pZReport.modeFlags.hasPharmacy).toBe(true);
      expect(pZReport.pharmacy.netSalesMinor).toBe(32000);
      expect(pZReport.combined.totalRevenueMinor).toBe(32000);

      const pCsv = formatCombinedZReportCsv(pZReport);
      expect(pCsv).not.toContain('Clinic Net Collections');
      expect(pCsv).not.toContain('Doctor Channeling Payouts');
      expect(pCsv).toContain('Pharmacy Net Sales');

      const jPharmRev = await runJarvisConversationalTurn(
        pharmCtx,
        {
          sessionId: `jarvis-pharm-${tag}`,
          message: 'අද මුළු ආදායම කීයද?',
          locale: 'si-LK',
          source: 'voice',
          history: [],
        },
        `corr_p_jarvis_${tag}`
      );
      expect(jPharmRev.intent).toBe('financial_z_report');
      expect(jPharmRev.replyText).toContain('320.00');
      expect(jPharmRev.replyText).not.toMatch(/සායන ගෙවීම්|Doctor payouts|වෛද්‍ය කොමිස්/i);
    });
  }
);
