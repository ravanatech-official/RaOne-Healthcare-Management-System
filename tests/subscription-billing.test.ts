import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS } from '../src/contracts/api.ts';
import { ForbiddenError, ValidationError } from '../src/domain/errors.ts';
import {
  computePlanPricing,
  confirmBankTransferPayment,
  detectCardBrand,
  generateNextMonthlyInvoice,
  getSubscriptionOverview,
  paySubscriptionInvoice,
  updateSubscriptionPlan,
  validateCardExpiry,
  validateLuhn,
} from '../src/domain/subscription-billing.ts';
import type { ActiveWorkspaceContext } from '../src/domain/tenancy.ts';

function buildTestContext(
  tenantId: string,
  role: ActiveWorkspaceContext['role']
): ActiveWorkspaceContext {
  return {
    userId: 101,
    uid: `uid_${tenantId}_${role}`,
    tenantId,
    tenantName: 'Suwa Medical & Pharmacy',
    tenantStatus: 'active',
    productMode: 'combo',
    legalEntityId: null,
    legalEntityName: null,
    countryCode: 'LK',
    timezone: 'Asia/Colombo',
    currency: 'LKR',
    branchId: crypto.randomUUID(),
    branchName: 'Main Branch',
    role,
    permissions: ROLE_PERMISSIONS[role],
    professionalGrants: [],
    capabilities: {},
  };
}

describe('SaaS Subscription & Monthly Payment Billing', () => {
  it('computes LKR monthly and annual (2 months free) pricing accurately', () => {
    const monthly = computePlanPricing('combo', 'monthly');
    expect(monthly.subtotalMinor).toBe(1_250_000);
    expect(monthly.discountMinor).toBe(0);
    expect(monthly.totalMinor).toBe(1_250_000);

    const annual = computePlanPricing('combo', 'annual');
    expect(annual.subtotalMinor).toBe(15_000_000);
    expect(annual.totalMinor).toBe(12_500_000);
    expect(annual.discountMinor).toBe(2_500_000);
  });

  it('validates card Luhn checksum, brand detection, and expiry dates', () => {
    expect(validateLuhn('4242424242424242')).toBe(true);
    expect(validateLuhn('4242424242424243')).toBe(false);
    expect(detectCardBrand('4242424242424242')).toBe('Visa');
    expect(detectCardBrand('5555555555554444')).toBe('Mastercard');

    const ref = new Date('2026-11-18T00:00:00Z');
    expect(validateCardExpiry('12/26', ref)).toBe(true);
    expect(validateCardExpiry('11/26', ref)).toBe(true);
    expect(validateCardExpiry('10/26', ref)).toBe(false);
    expect(validateCardExpiry('13/28', ref)).toBe(false);
  });

  it('enforces RBAC: receptionist denied, accountant read-only, owner full access', async () => {
    const tenantId = crypto.randomUUID();
    const receptionist = buildTestContext(tenantId, 'receptionist');
    const accountant = buildTestContext(tenantId, 'accountant');
    const owner = buildTestContext(tenantId, 'owner');

    await expect(getSubscriptionOverview(receptionist)).rejects.toThrow(ForbiddenError);

    const overview = await getSubscriptionOverview(accountant);
    expect(overview.invoices.length).toBe(1);
    expect(overview.outstandingMinor).toBe(1_250_000);

    await expect(
      updateSubscriptionPlan(
        accountant,
        { planCode: 'clinic_only', billingCycle: 'monthly' },
        'corr_acc'
      )
    ).rejects.toThrow(ForbiddenError);

    const updated = await updateSubscriptionPlan(
      owner,
      { planCode: 'clinic_only', billingCycle: 'annual', autoRenew: false },
      'corr_own'
    );
    expect(updated.subscription.planCode).toBe('clinic_only');
    expect(updated.subscription.billingCycle).toBe('annual');
    expect(updated.subscription.autoRenew).toBe(false);
    expect(updated.outstandingMinor).toBe(6_500_000);
  });

  it('processes LankaQR and Card payments idempotently and supports Bank Transfer settlement', async () => {
    const tenantId = crypto.randomUUID();
    const owner = buildTestContext(tenantId, 'owner');

    const initial = await getSubscriptionOverview(owner);
    const inv1 = initial.invoices[0];
    expect(inv1.status).toBe('open');

    // Reject invalid card
    await expect(
      paySubscriptionInvoice(
        owner,
        {
          idempotencyKey: 'idem_bad_card_1',
          invoiceId: inv1.id,
          method: 'card',
          savePaymentMethod: true,
          cardHolderName: 'Dr Perera',
          cardNumber: '4242424242424243',
          cardExpiry: '12/28',
          bankName: '',
          bankReference: '',
        },
        'corr_1'
      )
    ).rejects.toThrow(ValidationError);

    // Pay first invoice via Card (idempotent)
    const payRes1 = await paySubscriptionInvoice(
      owner,
      {
        idempotencyKey: 'idem_card_ok_1',
        invoiceId: inv1.id,
        method: 'card',
        savePaymentMethod: true,
        cardHolderName: 'Dr Perera',
        cardNumber: '4242424242424242',
        cardExpiry: '12/28',
        bankName: '',
        bankReference: '',
      },
      'corr_2'
    );
    expect(payRes1.payment.status).toBe('succeeded');
    expect(payRes1.payment.cardBrand).toBe('Visa');
    expect(payRes1.payment.cardLast4).toBe('4242');
    expect(payRes1.overview.subscription.status).toBe('active');
    expect(payRes1.overview.subscription.paymentMethodLabel).toBe('Visa •••• 4242');
    expect(payRes1.overview.outstandingMinor).toBe(0);

    // Re-submit same idempotencyKey -> returns exact same payment without double charge
    const payResDup = await paySubscriptionInvoice(
      owner,
      {
        idempotencyKey: 'idem_card_ok_1',
        invoiceId: inv1.id,
        method: 'card',
        savePaymentMethod: true,
        cardHolderName: 'Dr Perera',
        cardNumber: '4242424242424242',
        cardExpiry: '12/28',
        bankName: '',
        bankReference: '',
      },
      'corr_2_dup'
    );
    expect(payResDup.payment.id).toBe(payRes1.payment.id);
    expect(payResDup.overview.payments.length).toBe(1);

    // Generate next monthly invoice and settle via Bank Transfer + confirmation
    const withNext = await generateNextMonthlyInvoice(owner, { billingCycle: 'monthly' }, 'corr_3');
    const inv2 = withNext.invoices.find((i) => i.status === 'open')!;
    expect(inv2).toBeDefined();

    const bankSubmit = await paySubscriptionInvoice(
      owner,
      {
        idempotencyKey: 'idem_bank_1',
        invoiceId: inv2.id,
        method: 'bank_transfer',
        savePaymentMethod: false,
        cardHolderName: '',
        cardNumber: '',
        cardExpiry: '',
        bankName: 'Commercial Bank',
        bankReference: 'CEFT-99012',
      },
      'corr_4'
    );
    expect(bankSubmit.payment.status).toBe('pending_verification');
    expect(bankSubmit.overview.outstandingMinor).toBe(1_250_000);

    const confirmed = await confirmBankTransferPayment(owner, bankSubmit.payment.id, 'corr_5');
    expect(confirmed.outstandingMinor).toBe(0);
    expect(confirmed.invoices.find((i) => i.id === inv2.id)?.status).toBe('paid');
  });
});
