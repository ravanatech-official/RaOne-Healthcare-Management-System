import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  CreditCard,
  FileText,
  MessageSquare,
  Printer,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Webhook,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient, ApiClientError, formatLkrMinor } from '../lib/api-client.ts';
import type {
  BillingCycle,
  ProductMode,
  SubscriptionInvoiceItem,
  SubscriptionPaymentItem,
  SubscriptionPaymentMethod,
} from '../contracts/api.ts';

function formatCardDigits(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 16);
  return digits.replace(/(\d{4})(?=\d)/g, '$1 ');
}

function formatExpiryInput(raw: string): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

function DeterministicQrSvg({ seed }: { seed: string }) {
  // Deterministic 21x21 matrix visual for LankaQR sandbox checkout (no external network call)
  const size = 21;
  const cells: Array<{ x: number; y: number }> = [];
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }

  const isFinder = (r: number, c: number) =>
    (r < 7 && c < 7) || (r < 7 && c >= size - 7) || (r >= size - 7 && c < 7);

  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (isFinder(r, c)) continue;
      const bit = ((hash >>> ((r * size + c) % 24)) ^ (r * 7 + c * 13)) & 1;
      if (bit === 1) cells.push({ x: c, y: r });
    }
  }

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className="w-36 h-36 bg-white p-2 border border-slate-200 rounded-lg"
      role="img"
      aria-label="LankaQR payment code"
    >
      {/* Three finder patterns */}
      {[
        { x: 0, y: 0 },
        { x: size - 7, y: 0 },
        { x: 0, y: size - 7 },
      ].map((pos, idx) => (
        <g key={idx} transform={`translate(${pos.x}, ${pos.y})`}>
          <rect width="7" height="7" fill="#0f172a" />
          <rect x="1" y="1" width="5" height="5" fill="#ffffff" />
          <rect x="2" y="2" width="3" height="3" fill="#0f172a" />
        </g>
      ))}
      {cells.map((cell) => (
        <rect
          key={`${cell.x}-${cell.y}`}
          x={cell.x}
          y={cell.y}
          width="1"
          height="1"
          fill="#0f172a"
        />
      ))}
    </svg>
  );
}

export function BillingPage() {
  const { activeTenantId, session, refetchSession } = useAuth();
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();
  const isSinhala = i18n.language !== 'en-LK';

  const canManageBilling = session?.workspace?.permissions.includes('billing.manage') ?? false;

  const [selectedCycle, setSelectedCycle] = useState<BillingCycle>('monthly');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<SubscriptionPaymentMethod>('card');
  const [savePaymentMethod, setSavePaymentMethod] = useState(true);

  // Card inputs (PAN/CVV are never persisted; sent only for validation & last4 tokenization)
  const [cardHolderName, setCardHolderName] = useState(session?.user.displayName || '');
  const [cardNumber, setCardNumber] = useState('');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');

  // Bank slip inputs
  const [bankName, setBankName] = useState('Commercial Bank of Ceylon');
  const [bankReference, setBankReference] = useState('');

  // Webhook & Reminder state
  const [webhookProvider, setWebhookProvider] = useState<'payhere' | 'webxpay' | 'genie'>('payhere');
  const [reminderPhone, setReminderPhone] = useState('0771234567');
  const [reminderChannel, setReminderChannel] = useState<'whatsapp' | 'sms'>('whatsapp');
  const [lastWhatsappLink, setLastWhatsappLink] = useState<string | null>(null);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [receiptModal, setReceiptModal] = useState<{
    invoice: SubscriptionInvoiceItem;
    payment?: SubscriptionPaymentItem;
  } | null>(null);

  const billingQuery = useQuery({
    queryKey: ['billing-overview', activeTenantId],
    queryFn: () => apiClient.getBillingOverview(activeTenantId!),
    enabled: Boolean(activeTenantId),
  });

  const overview = billingQuery.data;

  useEffect(() => {
    if (overview?.subscription.billingCycle) {
      setSelectedCycle(overview.subscription.billingCycle);
    }
  }, [overview?.subscription.billingCycle]);

  const openInvoices = useMemo(
    () =>
      (overview?.invoices ?? []).filter(
        (inv) => inv.status === 'open' || inv.status === 'past_due'
      ),
    [overview?.invoices]
  );

  useEffect(() => {
    if (openInvoices.length > 0 && !openInvoices.some((i) => i.id === selectedInvoiceId)) {
      setSelectedInvoiceId(openInvoices[0].id);
    }
  }, [openInvoices, selectedInvoiceId]);

  const activeInvoice = useMemo(
    () => openInvoices.find((i) => i.id === selectedInvoiceId) ?? openInvoices[0] ?? null,
    [openInvoices, selectedInvoiceId]
  );

  const planMutation = useMutation({
    mutationFn: (payload: {
      planCode: ProductMode;
      billingCycle: BillingCycle;
      autoRenew?: boolean;
    }) => apiClient.updateBillingPlan(activeTenantId!, payload),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg(
        isSinhala
          ? 'දායකත්ව පැකේජය සහ බිල්පත් විස්තර යාවත්කාලීන කරන ලදී.'
          : 'Subscription plan and billing preferences updated.'
      );
      await queryClient.invalidateQueries({ queryKey: ['billing-overview', activeTenantId] });
      await queryClient.invalidateQueries({ queryKey: ['platform-capabilities', activeTenantId] });
      await refetchSession();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to update plan.');
    },
  });

  const generateInvoiceMutation = useMutation({
    mutationFn: () =>
      apiClient.generateBillingInvoice(activeTenantId!, { billingCycle: selectedCycle }),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg(
        isSinhala ? 'ඊළඟ මාසික බිල්පත සාදන ලදී.' : 'Generated next billing cycle invoice.'
      );
      await queryClient.invalidateQueries({ queryKey: ['billing-overview', activeTenantId] });
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(
        err instanceof ApiClientError ? err.envelope.message : 'Unable to generate invoice.'
      );
    },
  });

  const payMutation = useMutation({
    mutationFn: () => {
      if (!activeInvoice) {
        throw new Error('No open invoice selected');
      }
      return apiClient.payBillingInvoice(activeTenantId!, {
        idempotencyKey: `subpay_${crypto.randomUUID()}`,
        invoiceId: activeInvoice.id,
        method: paymentMethod,
        savePaymentMethod,
        cardHolderName: cardHolderName.trim(),
        cardNumber: cardNumber.replace(/\s+/g, ''),
        cardExpiry: cardExpiry.trim(),
        bankName: bankName.trim(),
        bankReference: bankReference.trim(),
      });
    },
    onSuccess: async (res) => {
      setErrorMsg(null);
      setCardNumber('');
      setCardCvv('');
      setBankReference('');
      setSuccessMsg(
        res.payment.status === 'succeeded'
          ? isSinhala
            ? `ගෙවීම සාර්ථකයි! රිසිට්පත් අංකය: ${res.payment.receiptNumber}`
            : `Payment settled successfully. Receipt ${res.payment.receiptNumber} issued.`
          : isSinhala
            ? `බැංකු හුවමාරු විස්තර (${res.payment.receiptNumber}) ඇතුළත් කරන ලදී. තහවුරු කිරීම සඳහා පහත බලන්න.`
            : `Bank transfer submitted (${res.payment.receiptNumber}). Confirm below once verified on statement.`
      );
      await queryClient.invalidateQueries({ queryKey: ['billing-overview', activeTenantId] });
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(
        err instanceof ApiClientError
          ? err.envelope.message
          : 'Unable to process payment. Please check your details.'
      );
    },
  });

  const confirmBankMutation = useMutation({
    mutationFn: (paymentId: string) =>
      apiClient.confirmBankTransferPayment(activeTenantId!, paymentId),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg(
        isSinhala
          ? 'බැංකු ගෙවීම තහවුරු කර බිල්පත පියවන ලදී.'
          : 'Bank transfer verified and invoice marked paid.'
      );
      await queryClient.invalidateQueries({ queryKey: ['billing-overview', activeTenantId] });
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(
        err instanceof ApiClientError ? err.envelope.message : 'Unable to confirm bank payment.'
      );
    },
  });

  const webhookMutation = useMutation({
    mutationFn: (statusCode: '2' | '-1' | '-2') =>
      apiClient.triggerSandboxPayHereWebhook(activeTenantId!, {
        invoiceId: activeInvoice!.id,
        statusCode,
        gatewayProvider: webhookProvider,
      }),
    onSuccess: async (res) => {
      setErrorMsg(null);
      setSuccessMsg(
        `Webhook (${webhookProvider.toUpperCase()}) verified via MD5 (${res.gatewayReference}) · Status: ${res.status}`
      );
      await queryClient.invalidateQueries({ queryKey: ['billing-overview', activeTenantId] });
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(
        err instanceof ApiClientError ? err.envelope.message : 'Unable to process gateway webhook.'
      );
    },
  });

  const reminderMutation = useMutation({
    mutationFn: () => {
      const targetInvoice = activeInvoice ?? overview?.invoices[0];
      return apiClient.sendBillingInvoiceReminder(activeTenantId!, {
        invoiceId: targetInvoice!.id,
        recipientPhone: reminderPhone.trim(),
        channel: reminderChannel,
        provider: reminderChannel === 'whatsapp' ? 'whatsapp_cloud' : 'notify_lk',
      });
    },
    onSuccess: (res) => {
      setErrorMsg(null);
      setLastWhatsappLink(res.dispatch.whatsappDeepLink ?? null);
      setSuccessMsg(
        `Dispatched ${res.dispatch.channel.toUpperCase()} reminder (${res.dispatch.externalRef}).`
      );
      queryClient.invalidateQueries({ queryKey: ['billing-overview', activeTenantId] });
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(
        err instanceof ApiClientError ? err.envelope.message : 'Unable to dispatch reminder.'
      );
    },
  });

  const handleCheckoutSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeInvoice) return;
    if (paymentMethod === 'card' && cardCvv.replace(/\D/g, '').length < 3) {
      setErrorMsg(
        isSinhala
          ? 'කරුණාකර කාඩ්පතේ ඉලක්කම් 3-4 CVV අංකය ඇතුළත් කරන්න.'
          : 'Please enter the 3 or 4 digit card security code (CVV).'
      );
      return;
    }
    payMutation.mutate();
  };

  if (billingQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-cyan-950/60 rounded animate-pulse" />
        <div className="grid sm:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-24 neon-card rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-64 neon-card rounded-xl animate-pulse" />
      </div>
    );
  }

  if (billingQuery.error || !overview) {
    return (
      <div className="neon-card rounded-xl p-6 space-y-4">
        <h1 className="font-display text-xl font-bold text-white">{t('billing.title')}</h1>
        <p className="text-sm text-rose-300">
          {billingQuery.error instanceof ApiClientError
            ? billingQuery.error.envelope.message
            : t('common.errorTitle')}
        </p>
        <button
          type="button"
          onClick={() => billingQuery.refetch()}
          className="min-h-[44px] px-4 text-sm rounded-lg neon-btn-primary"
        >
          {t('common.retry')}
        </button>
      </div>
    );
  }

  const activePlan =
    overview.plans.find((p) => p.planCode === overview.subscription.planCode) ?? overview.plans[3];

  const statusTextColor =
    overview.subscription.status === 'active'
      ? 'text-emerald-300'
      : overview.subscription.status === 'past_due' || overview.subscription.status === 'suspended'
        ? 'text-rose-300'
        : 'text-amber-300';

  const paymentByInvoiceId = new Map<string, SubscriptionPaymentItem>();
  for (const p of overview.payments) {
    if (!paymentByInvoiceId.has(p.invoiceId)) {
      paymentByInvoiceId.set(p.invoiceId, p);
    }
  }

  return (
    <div className="space-y-8">
      {/* Header Row */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1 max-w-2xl">
          <h1 className="font-display text-2xl font-bold neon-heading-glow text-balance">
            {t('billing.title')}
          </h1>
          <p className="text-sm text-cyan-100/75">{t('billing.desc')}</p>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {canManageBilling && openInvoices.length === 0 && (
            <button
              type="button"
              disabled={generateInvoiceMutation.isPending}
              onClick={() => generateInvoiceMutation.mutate()}
              className="min-h-[44px] px-4 rounded-lg text-sm neon-btn-primary inline-flex items-center gap-2 whitespace-nowrap shrink-0 disabled:opacity-60"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              <span>{t('billing.generateNextBtn')}</span>
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="p-3.5 bg-rose-950/70 border border-rose-400/50 rounded-xl text-sm text-rose-200"
        >
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="p-3.5 bg-cyan-950/70 border border-cyan-400/50 rounded-xl text-sm text-cyan-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-cyan-300 shrink-0" aria-hidden="true" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* 1. KPI Summary Strip */}
      <section aria-label="Subscription summary" className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="neon-card rounded-xl p-5 space-y-1">
          <div className="text-xs font-medium text-cyan-200/75">{t('billing.activePlanLabel')}</div>
          <div className="text-base font-semibold text-white">
            {isSinhala ? activePlan.nameSi : activePlan.nameEn}
          </div>
          <div className="text-xs font-mono-tabular text-cyan-300">
            {formatLkrMinor(overview.subscription.effectiveCycleAmountMinor)} /{' '}
            {overview.subscription.billingCycle === 'annual' ? 'year' : 'month'}
          </div>
        </div>

        <div className="neon-card rounded-xl p-5 space-y-1">
          <div className="text-xs font-medium text-cyan-200/75">
            {t('billing.statusNextBillingLabel')}
          </div>
          <div className={`text-base font-semibold capitalize ${statusTextColor}`}>
            {overview.subscription.status.replace('_', ' ')}
          </div>
          <div className="text-xs font-mono-tabular text-slate-300">
            Next · {overview.subscription.nextBillingDate}
          </div>
        </div>

        <div className="neon-card rounded-xl p-5 space-y-1">
          <div className="text-xs font-medium text-cyan-200/75">{t('billing.balanceDueLabel')}</div>
          <div
            className={`text-lg font-bold font-mono-tabular ${
              overview.outstandingMinor > 0 ? 'text-amber-300' : 'text-emerald-300'
            }`}
          >
            {formatLkrMinor(overview.outstandingMinor)}
          </div>
          <div className="text-xs text-slate-300">
            {openInvoices.length > 0
              ? `${openInvoices.length} open invoice(s)`
              : t('billing.allSettledMsg')}
          </div>
        </div>

        <div className="neon-card rounded-xl p-5 space-y-1">
          <div className="text-xs font-medium text-cyan-200/75">{t('billing.savedMethodLabel')}</div>
          <div className="text-base font-semibold text-white truncate">
            {overview.subscription.paymentMethodLabel || t('billing.notSet')}
          </div>
          <div className="text-xs text-slate-300">
            Auto-renew: {overview.subscription.autoRenew ? 'On' : 'Off'}
            {overview.subscription.recurringTokenActive ? ' · Recurring Token Active' : ''}
          </div>
        </div>
      </section>

      {/* 1b. Seat, Branch, Counter & Monthly AI Voice Quota Metering */}
      <section className="neon-card rounded-xl p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="space-y-0.5">
            <h2 className="font-display text-base font-semibold text-white">
              Seat, Branch, POS Counter &amp; AI Voice Quota Metering ({overview.quotas.periodMonth})
            </h2>
            <p className="text-xs text-slate-300">
              WhatsApp sent: {overview.quotas.whatsappSentCount} · SMS sent:{' '}
              {overview.quotas.smsSentCount}
              {overview.trialGrace.status === 'trialing'
                ? ` · Trial ends in ${overview.trialGrace.trialDaysRemaining} day(s)`
                : ''}
            </p>
          </div>
          {overview.trialGrace.isReadOnlyGrace && (
            <span className="text-xs font-semibold text-rose-300 inline-flex items-center gap-1">
              <AlertTriangle className="w-4 h-4" aria-hidden="true" />
              <span>Read-Only Grace ({overview.trialGrace.graceDaysRemaining}d remaining)</span>
            </span>
          )}
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          {[
            { label: 'Active Staff Seats', used: overview.quotas.staffUsed, limit: overview.quotas.staffLimit },
            { label: 'Clinic / Pharmacy Branches', used: overview.quotas.branchesUsed, limit: overview.quotas.branchLimit },
            { label: 'POS Counters', used: overview.quotas.countersUsed, limit: overview.quotas.counterLimit },
            { label: 'Monthly J.A.R.V.I.S. AI Turns', used: overview.quotas.voiceTurnsUsed, limit: overview.quotas.voiceTurnsLimit },
          ].map((meter) => {
            const pct = Math.min(100, Math.round((meter.used / Math.max(1, meter.limit)) * 100));
            const exceeded = meter.used >= meter.limit;
            const warn = !exceeded && pct >= 80;
            return (
              <div key={meter.label} className="space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-slate-300 font-medium">{meter.label}</span>
                  <span
                    className={`font-mono-tabular font-semibold ${
                      exceeded ? 'text-rose-300' : warn ? 'text-amber-300' : 'neon-text-cyan'
                    }`}
                  >
                    {meter.used}/{meter.limit}
                  </span>
                </div>
                <div className="h-2 bg-[#040d21] border border-cyan-500/20 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all ${
                      exceeded ? 'bg-rose-500' : warn ? 'bg-amber-400' : 'bg-cyan-400'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {overview.quotas.overageAlerts.length > 0 && (
          <div className="p-3 bg-amber-950/60 border border-amber-400/40 rounded-lg space-y-1 text-xs text-amber-200">
            {overview.quotas.overageAlerts.map((alert) => (
              <div key={alert.resource} className="font-medium">
                {alert.message}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 2. Monthly / Annual Checkout Section */}
      <section className="neon-card-glow rounded-2xl p-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-cyan-500/20 pb-4">
          <div className="space-y-1">
            <h2 className="font-display text-lg font-semibold text-white">
              {t('billing.checkoutHeading')}
            </h2>
            <p className="text-xs text-slate-300">
              Instant settlement in LKR · Automated receipt generation · Idempotent checkout protection
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-xs font-medium neon-text-cyan">
            <ShieldCheck className="w-4 h-4" aria-hidden="true" />
            <span>Encrypted Gateway Tokenization</span>
          </div>
        </div>

        {openInvoices.length === 0 ? (
          <div className="py-6 flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <div className="text-sm font-semibold text-emerald-300">
                {t('billing.allSettledMsg')}
              </div>
              <p className="text-xs text-slate-300">
                Current period runs through{' '}
                <span className="font-mono-tabular font-medium text-cyan-300">
                  {overview.subscription.currentPeriodEnd}
                </span>
                . Need to renew early or pre-pay the next cycle?
              </p>
            </div>
            {canManageBilling && (
              <button
                type="button"
                disabled={generateInvoiceMutation.isPending}
                onClick={() => generateInvoiceMutation.mutate()}
                className="min-h-[44px] px-4 rounded-lg text-sm font-semibold neon-btn-secondary whitespace-nowrap shrink-0"
              >
                {t('billing.generateNextBtn')}
              </button>
            )}
          </div>
        ) : (
          <form onSubmit={handleCheckoutSubmit} className="grid lg:grid-cols-12 gap-8">
            <div className="lg:col-span-7 space-y-5">
              {openInvoices.length > 1 && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-cyan-100/80">Select Invoice</span>
                  <select
                    value={activeInvoice?.id || ''}
                    onChange={(e) => setSelectedInvoiceId(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                  >
                    {openInvoices.map((inv) => (
                      <option key={inv.id} value={inv.id}>
                        {inv.invoiceNumber} — {formatLkrMinor(inv.totalMinor - inv.paidMinor)} (Due{' '}
                        {inv.dueDate})
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="space-y-2">
                <span className="text-xs font-medium text-cyan-100/80">Payment Method</span>
                <div className="grid sm:grid-cols-3 gap-2.5">
                  {(
                    [
                      { id: 'card', label: t('billing.methodCard'), Icon: CreditCard },
                      { id: 'lankaqr', label: t('billing.methodLankaQr'), Icon: QrCode },
                      { id: 'bank_transfer', label: t('billing.methodBank'), Icon: Building2 },
                    ] as const
                  ).map(({ id, label, Icon }) => {
                    const active = paymentMethod === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => {
                          setPaymentMethod(id);
                          setErrorMsg(null);
                        }}
                        className={`min-h-[48px] px-3.5 py-2.5 rounded-lg border text-left text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap ${
                          active
                            ? 'neon-btn-primary border-transparent'
                            : 'bg-[#040e22]/90 border-cyan-500/20 text-slate-200 hover:border-cyan-400/50'
                        }`}
                      >
                        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span className="truncate">{label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {paymentMethod === 'card' && (
                <div className="space-y-4 pt-1">
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-cyan-100/80">Cardholder Name *</span>
                    <input
                      required
                      value={cardHolderName}
                      onChange={(e) => setCardHolderName(e.target.value)}
                      placeholder="e.g. Dr. K. Perera"
                      className="w-full min-h-[44px] px-3 rounded-lg text-sm neon-input"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-cyan-100/80">Card Number *</span>
                    <input
                      required
                      inputMode="numeric"
                      value={cardNumber}
                      onChange={(e) => setCardNumber(formatCardDigits(e.target.value))}
                      placeholder="4242 4242 4242 4242"
                      className="w-full min-h-[44px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                    />
                  </label>
                  <div className="grid grid-cols-2 gap-4">
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-cyan-100/80">Expiry (MM/YY) *</span>
                      <input
                        required
                        inputMode="numeric"
                        value={cardExpiry}
                        onChange={(e) => setCardExpiry(formatExpiryInput(e.target.value))}
                        placeholder="12/28"
                        className="w-full min-h-[44px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-cyan-100/80">CVV *</span>
                      <input
                        required
                        type="password"
                        inputMode="numeric"
                        maxLength={4}
                        value={cardCvv}
                        onChange={(e) => setCardCvv(e.target.value.replace(/\D/g, '').slice(0, 4))}
                        placeholder="•••"
                        className="w-full min-h-[44px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                      />
                    </label>
                  </div>
                </div>
              )}

              {paymentMethod === 'lankaqr' && activeInvoice && (
                <div className="pt-2 flex flex-col sm:flex-row items-start sm:items-center gap-5 border-t border-cyan-500/20">
                  <DeterministicQrSvg
                    seed={`${activeInvoice.invoiceNumber}-${activeInvoice.totalMinor}`}
                  />
                  <div className="space-y-2 text-xs text-slate-300">
                    <div className="text-sm font-semibold text-white">
                      Scan with any Sri Lankan Bank App / LankaQR Wallet
                    </div>
                    <p>
                      Compatible with FriMi, Solo, Genie, BOC SmartPay, ComBank Q+, Sampath WePay,
                      and HNB FIT.
                    </p>
                    <div className="font-mono-tabular text-cyan-300">
                      Merchant: SUWASEVA HEALTH · Ref: {activeInvoice.invoiceNumber}
                    </div>
                  </div>
                </div>
              )}

              {paymentMethod === 'bank_transfer' && (
                <div className="space-y-4 pt-2 border-t border-cyan-500/20">
                  <div className="text-xs text-slate-300 space-y-1">
                    <div className="font-semibold text-white">
                      Bank Transfer Destination (CEFT / SLIPS)
                    </div>
                    <div>
                      {overview.bankTransferInstructions.bankName} ·{' '}
                      {overview.bankTransferInstructions.branchName}
                    </div>
                    <div className="font-mono-tabular text-cyan-300">
                      Account: {overview.bankTransferInstructions.accountNumber} ·{' '}
                      {overview.bankTransferInstructions.accountName}
                    </div>
                    <div className="text-slate-400">
                      {overview.bankTransferInstructions.referenceHint}
                    </div>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-4">
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-cyan-100/80">Sender Bank *</span>
                      <input
                        required
                        value={bankName}
                        onChange={(e) => setBankName(e.target.value)}
                        className="w-full min-h-[44px] px-3 rounded-lg text-sm neon-input"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-cyan-100/80">
                        Transfer / Slip Reference *
                      </span>
                      <input
                        required
                        minLength={4}
                        value={bankReference}
                        onChange={(e) => setBankReference(e.target.value)}
                        placeholder="e.g. CEFT-884129"
                        className="w-full min-h-[44px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                      />
                    </label>
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={savePaymentMethod}
                  onChange={(e) => setSavePaymentMethod(e.target.checked)}
                  className="w-4 h-4 accent-cyan-400"
                />
                <span>Save masked payment preference for future monthly renewals</span>
              </label>
            </div>

            {/* Right Column: Order Summary & Pay CTA */}
            {activeInvoice && (
              <div className="lg:col-span-5 lg:border-l lg:border-cyan-500/20 lg:pl-8 flex flex-col justify-between space-y-5">
                <div className="space-y-3">
                  <div className="text-xs font-medium text-cyan-200/75">Invoice Summary</div>
                  <div className="text-sm font-semibold text-white">
                    {activeInvoice.description}
                  </div>
                  <div className="text-xs font-mono-tabular text-slate-300">
                    {activeInvoice.invoiceNumber} · Due {activeInvoice.dueDate}
                  </div>

                  <div className="border-t border-cyan-500/20 pt-3 space-y-2 text-sm">
                    <div className="flex justify-between text-slate-300">
                      <span>Subtotal</span>
                      <span className="font-mono-tabular">
                        {formatLkrMinor(activeInvoice.subtotalMinor)}
                      </span>
                    </div>
                    {activeInvoice.discountMinor > 0 && (
                      <div className="flex justify-between text-emerald-300">
                        <span>Annual Discount (2 months free)</span>
                        <span className="font-mono-tabular">
                          -{formatLkrMinor(activeInvoice.discountMinor)}
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between font-bold text-white text-base border-t border-cyan-500/20 pt-2">
                      <span>Total Due</span>
                      <span className="font-mono-tabular neon-text-cyan">
                        {formatLkrMinor(activeInvoice.totalMinor - activeInvoice.paidMinor)}
                      </span>
                    </div>
                  </div>
                </div>

                {canManageBilling ? (
                  <button
                    type="submit"
                    disabled={payMutation.isPending}
                    className="w-full min-h-[48px] px-5 rounded-xl text-sm neon-btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                    <span>
                      {payMutation.isPending
                        ? 'Processing...'
                        : paymentMethod === 'bank_transfer'
                          ? 'Submit Bank Transfer Reference'
                          : `${t('billing.payNowBtn')} · ${formatLkrMinor(
                              activeInvoice.totalMinor - activeInvoice.paidMinor
                            )}`}
                    </span>
                  </button>
                ) : (
                  <p className="text-xs text-slate-400">
                    Only the workspace Owner can authorize subscription payments.
                  </p>
                )}
              </div>
            )}
          </form>
        )}

        {/* Live Sri Lankan Payment Gateway MD5 Webhook & WhatsApp/SMS Billing Reminders */}
        <div className="grid md:grid-cols-2 gap-6 pt-4 border-t border-cyan-500/20">
          {canManageBilling && activeInvoice && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Webhook className="w-4 h-4 text-cyan-300" aria-hidden="true" />
                <span>Sri Lankan Payment Gateway Webhook (MD5 Verified)</span>
              </div>
              <p className="text-xs text-slate-300">
                Simulate an instant signed server-to-server callback (PayHere / WebXPay / Genie) for{' '}
                <span className="font-mono-tabular font-semibold text-cyan-300">
                  {activeInvoice.invoiceNumber}
                </span>
                .
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={webhookProvider}
                  onChange={(e) =>
                    setWebhookProvider(e.target.value as 'payhere' | 'webxpay' | 'genie')
                  }
                  className="min-h-[38px] px-2.5 rounded-lg text-xs neon-input"
                >
                  <option value="payhere">PayHere (LKR)</option>
                  <option value="webxpay">WebXPay</option>
                  <option value="genie">Dialog Genie</option>
                </select>
                <button
                  type="button"
                  disabled={webhookMutation.isPending}
                  onClick={() => webhookMutation.mutate('2')}
                  className="min-h-[38px] px-3 rounded-lg text-xs neon-btn-primary"
                >
                  Trigger Paid Webhook (MD5 Valid)
                </button>
                <button
                  type="button"
                  disabled={webhookMutation.isPending}
                  onClick={() => webhookMutation.mutate('-2')}
                  className="min-h-[38px] px-3 bg-rose-950/60 border border-rose-400/40 text-rose-200 text-xs font-medium rounded-lg hover:bg-rose-900/60"
                >
                  Simulate Failed (-2)
                </button>
              </div>
            </div>
          )}

          {overview.invoices.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <MessageSquare className="w-4 h-4 text-cyan-300" aria-hidden="true" />
                <span>WhatsApp / SMS Invoice Due &amp; Receipt Reminder</span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  value={reminderPhone}
                  onChange={(e) => setReminderPhone(e.target.value)}
                  placeholder="0771234567"
                  className="min-h-[38px] w-36 px-2.5 rounded-lg text-xs font-mono-tabular neon-input"
                />
                <select
                  value={reminderChannel}
                  onChange={(e) => setReminderChannel(e.target.value as 'whatsapp' | 'sms')}
                  className="min-h-[38px] px-2.5 rounded-lg text-xs neon-input"
                >
                  <option value="whatsapp">WhatsApp</option>
                  <option value="sms">Sri Lanka SMS (Notify.lk)</option>
                </select>
                <button
                  type="button"
                  disabled={reminderMutation.isPending || !reminderPhone.trim()}
                  onClick={() => reminderMutation.mutate()}
                  className="min-h-[38px] px-3 rounded-lg text-xs font-semibold neon-btn-secondary"
                >
                  Send Reminder
                </button>
                {lastWhatsappLink && (
                  <a
                    href={lastWhatsappLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs font-medium neon-text-cyan underline"
                  >
                    Open WhatsApp Web
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* 3. Plan & Billing Cycle Comparison */}
      <section className="neon-card rounded-xl p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-display text-lg font-semibold text-white">
              {t('billing.plansHeading')}
            </h2>
            <p className="text-xs text-slate-300">
              Switching plans automatically synchronizes workspace module capabilities without losing data.
            </p>
          </div>

          <div
            role="group"
            aria-label="Billing cycle"
            className="flex items-center gap-1 p-1 bg-[#040e22] border border-cyan-500/25 rounded-lg"
          >
            <button
              type="button"
              onClick={() => setSelectedCycle('monthly')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap transition-all ${
                selectedCycle === 'monthly'
                  ? 'bg-cyan-400 text-[#021324]'
                  : 'text-slate-300 hover:text-cyan-200'
              }`}
            >
              {t('billing.monthlyCycle')}
            </button>
            <button
              type="button"
              onClick={() => setSelectedCycle('annual')}
              className={`px-3 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap transition-all ${
                selectedCycle === 'annual'
                  ? 'bg-cyan-400 text-[#021324]'
                  : 'text-slate-300 hover:text-cyan-200'
              }`}
            >
              {t('billing.annualCycle')}
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {overview.plans.map((plan) => {
            const isCurrent =
              overview.subscription.planCode === plan.planCode &&
              overview.subscription.billingCycle === selectedCycle;
            const priceMinor =
              selectedCycle === 'annual' ? plan.annualMinor : plan.monthlyMinor;
            const highlights = isSinhala ? plan.highlightsSi : plan.highlightsEn;

            return (
              <div
                key={plan.planCode}
                className={`p-5 rounded-xl border flex flex-col justify-between space-y-5 ${
                  isCurrent
                    ? 'neon-card-glow'
                    : 'bg-[#040e22]/85 border-cyan-500/20'
                }`}
              >
                <div className="space-y-3">
                  <div className="space-y-1">
                    <div className="text-xs text-cyan-300/80">{plan.audienceEn}</div>
                    <div className="text-base font-bold text-white">
                      {isSinhala ? plan.nameSi : plan.nameEn}
                    </div>
                  </div>
                  <div className="font-mono-tabular text-xl font-bold neon-text-cyan">
                    {formatLkrMinor(priceMinor)}
                    <span className="text-xs font-normal text-slate-400">
                      /{selectedCycle === 'annual' ? 'yr' : 'mo'}
                    </span>
                  </div>
                  <div className="text-xs text-slate-300 font-mono-tabular border-t border-cyan-500/15 pt-3">
                    {plan.staffLimit} users · {plan.branchLimit} branch(es) · {plan.counterLimit}{' '}
                    counter(s)
                  </div>
                  <ul className="space-y-1.5 text-xs text-slate-200">
                    {highlights.map((h) => (
                      <li key={h} className="leading-snug">
                        • {h}
                      </li>
                    ))}
                  </ul>
                </div>

                {canManageBilling && (
                  <button
                    type="button"
                    disabled={isCurrent || planMutation.isPending}
                    onClick={() =>
                      planMutation.mutate({
                        planCode: plan.planCode,
                        billingCycle: selectedCycle,
                      })
                    }
                    className={`w-full min-h-[42px] px-3 rounded-lg text-xs font-semibold transition-all ${
                      isCurrent ? 'neon-btn-primary opacity-90 cursor-default' : 'neon-btn-secondary'
                    }`}
                  >
                    {isCurrent ? 'Current Plan' : 'Switch to This Plan'}
                  </button>
                )}
              </div>
            );
          })}
        </div>

        {canManageBilling && (
          <div className="border-t border-cyan-500/20 pt-4 flex items-center justify-between gap-4">
            <label className="flex items-center gap-2.5 text-sm text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                checked={overview.subscription.autoRenew}
                disabled={planMutation.isPending}
                onChange={(e) =>
                  planMutation.mutate({
                    planCode: overview.subscription.planCode,
                    billingCycle: overview.subscription.billingCycle,
                    autoRenew: e.target.checked,
                  })
                }
                className="w-4 h-4 accent-cyan-400"
              />
              <span>{t('billing.autoRenewLabel')}</span>
            </label>
          </div>
        )}
      </section>

      {/* 4. Invoices & Payment Receipts Ledger */}
      <section className="neon-card rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-cyan-300" aria-hidden="true" />
          <h2 className="font-display text-lg font-semibold text-white">
            {t('billing.invoicesHeading')}
          </h2>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-cyan-500/20 text-cyan-200/75">
                <th className="py-2.5 px-3">Invoice</th>
                <th className="py-2.5 px-3">Period</th>
                <th className="py-2.5 px-3">Plan / Cycle</th>
                <th className="py-2.5 px-3 text-right">Amount</th>
                <th className="py-2.5 px-3">Status</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cyan-500/15">
              {overview.invoices.map((inv) => {
                const matchedPayment = paymentByInvoiceId.get(inv.id);
                const statusColor =
                  inv.status === 'paid'
                    ? 'text-emerald-300'
                    : inv.status === 'past_due'
                      ? 'text-rose-300'
                      : 'text-amber-300';

                return (
                  <tr key={inv.id} className="hover:bg-cyan-950/20">
                    <td className="py-3 px-3 font-mono-tabular font-semibold text-white">
                      {inv.invoiceNumber}
                    </td>
                    <td className="py-3 px-3 font-mono-tabular text-slate-300">
                      {inv.billingPeriodStart} → {inv.billingPeriodEnd}
                    </td>
                    <td className="py-3 px-3 text-slate-300">
                      {inv.planCode} · {inv.billingCycle}
                    </td>
                    <td className="py-3 px-3 text-right font-mono-tabular font-semibold text-white">
                      {formatLkrMinor(inv.totalMinor)}
                    </td>
                    <td className={`py-3 px-3 font-medium capitalize ${statusColor}`}>
                      {inv.status.replace('_', ' ')}
                      {matchedPayment?.status === 'pending_verification' && ' (Bank slip pending)'}
                    </td>
                    <td className="py-3 px-3 text-right space-x-2">
                      {canManageBilling &&
                        matchedPayment?.status === 'pending_verification' &&
                        inv.status !== 'paid' && (
                          <button
                            type="button"
                            disabled={confirmBankMutation.isPending}
                            onClick={() => confirmBankMutation.mutate(matchedPayment.id)}
                            className="px-2.5 py-1.5 text-xs font-medium rounded-md neon-btn-secondary whitespace-nowrap"
                          >
                            {t('billing.confirmBankPaid')}
                          </button>
                        )}
                      <button
                        type="button"
                        onClick={() =>
                          setReceiptModal({ invoice: inv, payment: matchedPayment })
                        }
                        className="px-2.5 py-1.5 text-xs font-medium rounded-md neon-btn-secondary inline-flex items-center gap-1 whitespace-nowrap"
                      >
                        <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{t('billing.printReceipt')}</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Printable Invoice / Payment Receipt Modal */}
      {receiptModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="receipt-modal-title"
          className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="neon-card-glow rounded-2xl max-w-lg w-full p-6 space-y-5">
            <div className="flex items-center justify-between gap-4 border-b border-cyan-500/20 pb-3">
              <div>
                <h3 id="receipt-modal-title" className="text-base font-bold text-white">
                  SuwaSeva Subscription Tax Invoice &amp; Receipt
                </h3>
                <div className="text-xs font-mono-tabular text-cyan-300">
                  {receiptModal.invoice.invoiceNumber}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setReceiptModal(null)}
                className="min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg text-slate-300 hover:bg-cyan-950/60"
                aria-label="Close"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-200">
              <div className="flex justify-between">
                <span className="text-slate-400">Workspace</span>
                <span className="font-semibold text-white">{session?.workspace?.tenantName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Description</span>
                <span className="text-right font-medium text-white max-w-xs">
                  {receiptModal.invoice.description}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Billing Period</span>
                <span className="font-mono-tabular">
                  {receiptModal.invoice.billingPeriodStart} to{' '}
                  {receiptModal.invoice.billingPeriodEnd}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Total Amount</span>
                <span className="font-mono-tabular font-bold neon-text-cyan">
                  {formatLkrMinor(receiptModal.invoice.totalMinor)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Status</span>
                <span className="font-semibold uppercase">{receiptModal.invoice.status}</span>
              </div>

              {receiptModal.payment && (
                <div className="border-t border-cyan-500/20 pt-3 space-y-2">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Payment Receipt #</span>
                    <span className="font-mono-tabular font-semibold neon-text-cyan">
                      {receiptModal.payment.receiptNumber}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Gateway Ref</span>
                    <span className="font-mono-tabular">
                      {receiptModal.payment.gatewayReference}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Method</span>
                    <span className="capitalize">
                      {receiptModal.payment.method.replace('_', ' ')}
                      {receiptModal.payment.cardLast4
                        ? ` (${receiptModal.payment.cardBrand} •••• ${receiptModal.payment.cardLast4})`
                        : ''}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3 border-t border-cyan-500/20 pt-4 no-print">
              <button
                type="button"
                onClick={() => window.print()}
                className="min-h-[42px] px-4 rounded-lg text-xs neon-btn-primary inline-flex items-center gap-1.5"
              >
                <Printer className="w-4 h-4" aria-hidden="true" />
                <span>Print Receipt</span>
              </button>
              <button
                type="button"
                onClick={() => setReceiptModal(null)}
                className="min-h-[42px] px-4 rounded-lg text-xs font-medium neon-btn-secondary"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

