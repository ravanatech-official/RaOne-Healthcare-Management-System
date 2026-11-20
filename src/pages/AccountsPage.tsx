import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowDownRight,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Download,
  Plus,
  Receipt,
  Trash2,
  Users,
  Wallet,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient, ApiClientError, formatLkrMinor } from '../lib/api-client.ts';

type TabId = 'pnl' | 'receivables' | 'payables';

const EXPENSE_CATEGORIES = [
  { value: 'utilities', label: 'Electricity / Water / Internet' },
  { value: 'rent', label: 'Premises Rent' },
  { value: 'salaries', label: 'Staff / Casual Wages' },
  { value: 'supplies', label: 'Clinic / Pharmacy Supplies' },
  { value: 'maintenance', label: 'Equipment / AC Maintenance' },
  { value: 'courier', label: 'Courier / Delivery' },
  { value: 'petty_cash', label: 'Petty Cash' },
  { value: 'other', label: 'Other Operating Expense' },
] as const;

export function AccountsPage() {
  const { activeTenantId, session } = useAuth();
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const isSinhala = i18n.language !== 'en-LK';

  const canWriteAccounts =
    (session?.workspace?.permissions.includes('accounts.write') ||
      session?.workspace?.permissions.includes('billing.manage')) ??
    false;

  const [tab, setTab] = useState<TabId>('pnl');
  const [date, setDate] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // OpEx Form
  const [expCategory, setExpCategory] =
    useState<(typeof EXPENSE_CATEGORIES)[number]['value']>('utilities');
  const [expDesc, setExpDesc] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expMethod, setExpMethod] = useState<'cash' | 'card' | 'bank'>('cash');
  const [expRef, setExpRef] = useState('');
  const [expManagerPin, setExpManagerPin] = useState('');
  const [showExpManagerPin, setShowExpManagerPin] = useState(false);

  // Receivable Account Form
  const [accName, setAccName] = useState('');
  const [accType, setAccType] = useState<'patient' | 'corporate' | 'customer'>('customer');
  const [accPhone, setAccPhone] = useState('');
  const [accLimit, setAccLimit] = useState('50000');

  // Receivable Entry Form
  const [activeAccId, setActiveAccId] = useState<string | null>(null);
  const [entryType, setEntryType] = useState<'charge' | 'payment'>('payment');
  const [entryAmount, setEntryAmount] = useState('');
  const [entryMethod, setEntryMethod] = useState<'cash' | 'card' | 'bank' | 'credit'>('cash');
  const [entryNotes, setEntryNotes] = useState('');

  // Supplier Payment Form
  const [paySupplierId, setPaySupplierId] = useState('');
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState<'bank' | 'cash' | 'cheque'>('bank');
  const [payRef, setPayRef] = useState('');
  const [payNotes, setPayNotes] = useState('');

  const overviewQuery = useQuery({
    queryKey: ['accounts-overview', activeTenantId, date || 'today'],
    queryFn: () => apiClient.getAccountsOverview(activeTenantId!, date || undefined),
    enabled: Boolean(activeTenantId),
  });

  const invalidateAccounts = async () => {
    await queryClient.invalidateQueries({ queryKey: ['accounts-overview', activeTenantId] });
    await queryClient.invalidateQueries({ queryKey: ['z-report', activeTenantId] });
  };

  const expenseMutation = useMutation({
    mutationFn: () =>
      apiClient.recordOperatingExpense(activeTenantId!, {
        expenseDate: date || undefined,
        category: expCategory,
        description: expDesc.trim(),
        amountLkr: Number(expAmount),
        paymentMethod: expMethod,
        referenceNo: expRef.trim(),
        managerOverridePin: expManagerPin.trim() || undefined,
      }),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg('Operating expense recorded and deducted from Daily Net P&L.');
      setExpDesc('');
      setExpAmount('');
      setExpRef('');
      setExpManagerPin('');
      setShowExpManagerPin(false);
      await invalidateAccounts();
    },
    onError: (err) => {
      setSuccessMsg(null);
      if (err instanceof ApiClientError && err.envelope.code === 'GOVERNANCE_PIN_REQUIRED') {
        setShowExpManagerPin(true);
      }
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to record expense.');
    },
  });

  const voidExpenseMutation = useMutation({
    mutationFn: (expenseId: string) => apiClient.voidOperatingExpense(activeTenantId!, expenseId),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg('Expense voided and Daily Net P&L updated.');
      await invalidateAccounts();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to void expense.');
    },
  });

  const createAccMutation = useMutation({
    mutationFn: () =>
      apiClient.createReceivableAccount(activeTenantId!, {
        accountName: accName.trim(),
        accountType: accType,
        phone: accPhone.trim(),
        creditLimitLkr: Number(accLimit || 0),
      }),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg('Credit receivable account created.');
      setAccName('');
      setAccPhone('');
      await invalidateAccounts();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(
        err instanceof ApiClientError ? err.envelope.message : 'Unable to create credit account.'
      );
    },
  });

  const entryMutation = useMutation({
    mutationFn: () =>
      apiClient.recordReceivableEntry(activeTenantId!, activeAccId!, {
        entryType,
        amountLkr: Number(entryAmount),
        method: entryType === 'charge' ? 'credit' : entryMethod,
        referenceNo: '',
        notes: entryNotes.trim(),
      }),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg(
        entryType === 'payment'
          ? 'Credit collection recorded and balance updated.'
          : 'Credit charge posted to customer/patient account.'
      );
      setEntryAmount('');
      setEntryNotes('');
      setActiveAccId(null);
      await invalidateAccounts();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(
        err instanceof ApiClientError ? err.envelope.message : 'Unable to post credit entry.'
      );
    },
  });

  const supplierPayMutation = useMutation({
    mutationFn: () =>
      apiClient.recordSupplierPayment(activeTenantId!, {
        supplierId: paySupplierId,
        amountLkr: Number(payAmount),
        method: payMethod,
        referenceNo: payRef.trim(),
        notes: payNotes.trim(),
      }),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg('Supplier settlement recorded and Accounts Payable updated.');
      setPayAmount('');
      setPayRef('');
      setPayNotes('');
      await invalidateAccounts();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(
        err instanceof ApiClientError ? err.envelope.message : 'Unable to record supplier payment.'
      );
    },
  });

  const overview = overviewQuery.data?.overview;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold neon-heading-glow">
            {isSinhala
              ? 'ගිණුම් අංශය — Daily Net P&L, වියදම් සහ ණය ලේඛනය'
              : 'Accounts Department — Daily Net P&L, OpEx & Credit Ledger'}
          </h1>
          <p className="text-sm text-cyan-100/75">
            {isSinhala
              ? 'සත්‍ය දෛනික ශුද්ධ ලාභය, දෛනික වියදම් (OpEx), රෝගීන්ගෙන් ලැබෙන්න ඇති ණය (AR) සහ සැපයුම්කරු ගෙවීම් (AP) එකම තැනකින්.'
              : 'Track operating expenses, true daily Net Profit & Loss, customer/patient credit aging (AR), and supplier payables (AP).'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={async () => {
              if (!activeTenantId) return;
              try {
                const csv = await apiClient.fetchAccountsTaxSummaryCsv(
                  activeTenantId,
                  date || undefined
                );
                const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `suwaseva-ird-tax-pnl-${date || overview?.businessDate || 'today'}.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
              } catch (err) {
                setErrorMsg(
                  err instanceof Error ? err.message : 'Unable to download IRD Tax / P&L CSV.'
                );
              }
            }}
            className="min-h-[40px] px-3.5 rounded-lg text-xs font-medium neon-btn-secondary inline-flex items-center gap-1.5"
          >
            <Download className="w-4 h-4 text-cyan-300" aria-hidden="true" />
            <span>IRD Tax / P&amp;L CSV</span>
          </button>
          <input
            type="date"
            aria-label="Business date"
            value={date || overview?.businessDate || ''}
            onChange={(e) => setDate(e.target.value)}
            className="min-h-[40px] px-3 rounded-lg text-xs font-mono-tabular neon-input"
          />
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div
        role="tablist"
        aria-label="Accounts sections"
        className="flex flex-wrap gap-2 p-1.5 bg-[#051126] border border-cyan-500/25 rounded-xl w-fit"
      >
        {[
          { id: 'pnl' as const, label: 'Daily Net P&L & OpEx', Icon: Receipt },
          { id: 'receivables' as const, label: 'Credit Receivables (AR)', Icon: Users },
          { id: 'payables' as const, label: 'Supplier Payables (AP)', Icon: Building2 },
        ].map(({ id, label, Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(id)}
              className={`min-h-[40px] px-4 rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-all ${
                active
                  ? 'neon-btn-primary'
                  : 'text-slate-300 hover:text-cyan-200 hover:bg-cyan-950/40'
              }`}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
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

      {overviewQuery.isLoading ? (
        <div className="p-8 neon-card rounded-xl text-sm text-cyan-200/75">
          Loading accounts ledger...
        </div>
      ) : overviewQuery.error ? (
        <div className="p-6 neon-card rounded-xl border-rose-400/40 text-sm text-rose-200">
          {overviewQuery.error instanceof ApiClientError
            ? overviewQuery.error.envelope.message
            : 'Unable to load accounts overview.'}
        </div>
      ) : overview ? (
        <>
          {/* TAB 1: DAILY NET P&L & OPEX */}
          {tab === 'pnl' && (
            <div className="space-y-6">
              {/* P&L Waterfall Cards */}
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {overview.modeFlags.hasClinic && (
                  <div className="neon-card rounded-xl p-5 space-y-1">
                    <div className="text-xs text-cyan-200/70">Clinic Net After Doctor Payout</div>
                    <div className="text-xl font-bold font-mono-tabular text-white">
                      {formatLkrMinor(
                        overview.dailyPnl.clinicNetAfterDoctorMinor,
                        overview.currency
                      )}
                    </div>
                    <div className="text-xs font-mono-tabular text-amber-300">
                      Collections {formatLkrMinor(overview.dailyPnl.clinicCollectionsMinor)} − Dr{' '}
                      {formatLkrMinor(overview.dailyPnl.doctorPayoutsMinor)}
                    </div>
                  </div>
                )}

                {overview.modeFlags.hasPharmacy && (
                  <div className="neon-card rounded-xl p-5 space-y-1">
                    <div className="text-xs text-cyan-200/70">Pharmacy Gross Profit (Margin)</div>
                    <div className="text-xl font-bold font-mono-tabular text-white">
                      {formatLkrMinor(
                        overview.dailyPnl.pharmacyGrossProfitMinor,
                        overview.currency
                      )}
                    </div>
                    <div className="text-xs font-mono-tabular text-slate-400">
                      Sales {formatLkrMinor(overview.dailyPnl.pharmacyNetSalesMinor)} − COGS{' '}
                      {formatLkrMinor(overview.dailyPnl.pharmacyCogsMinor)}
                    </div>
                  </div>
                )}

                <div className="neon-card rounded-xl p-5 space-y-1">
                  <div className="text-xs text-cyan-200/70">Daily Operating Expenses (OpEx)</div>
                  <div className="text-xl font-bold font-mono-tabular text-amber-300">
                    -{formatLkrMinor(overview.dailyPnl.operatingExpensesMinor, overview.currency)}
                  </div>
                  <div className="text-xs text-slate-400">
                    {overview.expenses.filter((e) => e.status === 'posted').length} active entries
                  </div>
                </div>

                <div className="neon-card-glow rounded-xl p-5 space-y-1">
                  <div className="text-xs text-cyan-200 font-semibold">True Daily Net Profit</div>
                  <div
                    className={`text-2xl font-extrabold font-mono-tabular ${
                      overview.dailyPnl.trueNetProfitMinor >= 0
                        ? 'neon-text-cyan'
                        : 'text-rose-300'
                    }`}
                  >
                    {formatLkrMinor(overview.dailyPnl.trueNetProfitMinor, overview.currency)}
                  </div>
                  <div className="text-xs text-slate-300 font-mono-tabular">
                    Business Date: {overview.businessDate}
                  </div>
                </div>
              </div>

              {/* Record Expense + OpEx Ledger */}
              <div className="grid lg:grid-cols-12 gap-6">
                <section className="lg:col-span-5 neon-card rounded-xl p-6 space-y-4">
                  <div className="flex items-center gap-2 text-base font-semibold text-white">
                    <Wallet className="w-5 h-5 text-cyan-300" aria-hidden="true" />
                    <h2>Record Operating Expense / Petty Cash</h2>
                  </div>

                  {!canWriteAccounts ? (
                    <p className="text-xs text-slate-400">
                      Read-only view. Owner or Manager permission required to post expenses.
                    </p>
                  ) : (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        expenseMutation.mutate();
                      }}
                      className="space-y-3"
                    >
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-cyan-100/80">Category *</span>
                        <select
                          value={expCategory}
                          onChange={(e) =>
                            setExpCategory(
                              e.target.value as (typeof EXPENSE_CATEGORIES)[number]['value']
                            )
                          }
                          className="w-full min-h-[42px] px-3 rounded-lg text-sm neon-input"
                        >
                          {EXPENSE_CATEGORIES.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                      </label>

                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-cyan-100/80">Description *</span>
                        <input
                          required
                          value={expDesc}
                          onChange={(e) => setExpDesc(e.target.value)}
                          placeholder="e.g. CEB Electricity Bill / Cleaning"
                          className="w-full min-h-[42px] px-3 rounded-lg text-sm neon-input"
                        />
                      </label>

                      <div className="grid grid-cols-2 gap-3">
                        <label className="block space-y-1">
                          <span className="text-xs font-medium text-cyan-100/80">Amount (LKR) *</span>
                          <input
                            required
                            type="number"
                            min="1"
                            step="0.01"
                            value={expAmount}
                            onChange={(e) => setExpAmount(e.target.value)}
                            placeholder="4500"
                            className="w-full min-h-[42px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                          />
                        </label>
                        <label className="block space-y-1">
                          <span className="text-xs font-medium text-cyan-100/80">Paid Via</span>
                          <select
                            value={expMethod}
                            onChange={(e) =>
                              setExpMethod(e.target.value as 'cash' | 'card' | 'bank')
                            }
                            className="w-full min-h-[42px] px-3 rounded-lg text-sm neon-input"
                          >
                            <option value="cash">Cash / Till</option>
                            <option value="bank">Bank Transfer</option>
                            <option value="card">Card</option>
                          </select>
                        </label>
                      </div>

                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-cyan-100/80">
                          Voucher / Bill Reference
                        </span>
                        <input
                          value={expRef}
                          onChange={(e) => setExpRef(e.target.value)}
                          placeholder="BILL-2026-09"
                          className="w-full min-h-[42px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                        />
                      </label>

                      {(showExpManagerPin || Number(expAmount || 0) > 15000) && (
                        <label className="block space-y-1">
                          <span className="text-xs font-medium text-amber-300">
                            Owner / Manager Override PIN (High-Value OpEx Control)
                          </span>
                          <input
                            type="password"
                            inputMode="numeric"
                            maxLength={6}
                            value={expManagerPin}
                            onChange={(e) =>
                              setExpManagerPin(e.target.value.replace(/\D/g, '').slice(0, 6))
                            }
                            placeholder="4–6 digit Shift PIN"
                            className="w-full min-h-[42px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                          />
                        </label>
                      )}

                      <button
                        type="submit"
                        disabled={expenseMutation.isPending}
                        className="w-full min-h-[44px] px-4 rounded-lg text-sm neon-btn-primary inline-flex items-center justify-center gap-2"
                      >
                        <Plus className="w-4 h-4" aria-hidden="true" />
                        <span>
                          {expenseMutation.isPending ? 'Recording...' : 'Record Expense'}
                        </span>
                      </button>
                    </form>
                  )}
                </section>

                <section className="lg:col-span-7 neon-card rounded-xl p-6 space-y-4">
                  <h2 className="text-base font-semibold text-white">
                    Operating Expenses Ledger ({overview.businessDate})
                  </h2>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-cyan-500/20 text-cyan-200/75">
                          <th className="py-2.5 px-3">Date</th>
                          <th className="py-2.5 px-3">Category</th>
                          <th className="py-2.5 px-3">Description</th>
                          <th className="py-2.5 px-3">Method</th>
                          <th className="py-2.5 px-3 text-right">Amount</th>
                          <th className="py-2.5 px-3 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-cyan-500/15">
                        {overview.expenses.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-8 text-center text-slate-400">
                              No operating expenses recorded yet.
                            </td>
                          </tr>
                        ) : (
                          overview.expenses.map((exp) => (
                            <tr key={exp.id} className="hover:bg-cyan-950/20">
                              <td className="py-2.5 px-3 font-mono-tabular text-slate-300">
                                {exp.expenseDate}
                              </td>
                              <td className="py-2.5 px-3 uppercase font-medium text-cyan-300">
                                {exp.category}
                              </td>
                              <td className="py-2.5 px-3 text-white">
                                {exp.description}
                                {exp.referenceNo ? (
                                  <span className="ml-2 text-slate-400 font-mono-tabular">
                                    ({exp.referenceNo})
                                  </span>
                                ) : null}
                              </td>
                              <td className="py-2.5 px-3 capitalize text-slate-300">
                                {exp.paymentMethod}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono-tabular font-semibold text-amber-300">
                                {formatLkrMinor(exp.amountMinor, overview.currency)}
                              </td>
                              <td className="py-2.5 px-3 text-right">
                                {exp.status === 'posted' && canWriteAccounts ? (
                                  <button
                                    type="button"
                                    onClick={() => voidExpenseMutation.mutate(exp.id)}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded border border-rose-400/40 text-rose-300 hover:bg-rose-950/60"
                                  >
                                    <Trash2 className="w-3 h-3" />
                                    <span>Void</span>
                                  </button>
                                ) : (
                                  <span className="text-slate-500 capitalize">{exp.status}</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            </div>
          )}

          {/* TAB 2: RECEIVABLES (AR) */}
          {tab === 'receivables' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="neon-card-glow rounded-xl p-5 space-y-1">
                  <div className="text-xs text-cyan-200/80">Total Receivables Due</div>
                  <div className="text-2xl font-bold font-mono-tabular neon-text-cyan">
                    {formatLkrMinor(
                      overview.receivables.totalOutstandingMinor,
                      overview.currency
                    )}
                  </div>
                </div>
                <div className="neon-card rounded-xl p-5 space-y-1">
                  <div className="text-xs text-slate-300">Current (0–30 Days)</div>
                  <div className="text-xl font-bold font-mono-tabular text-emerald-300">
                    {formatLkrMinor(
                      overview.receivables.aging.current0To30Minor,
                      overview.currency
                    )}
                  </div>
                </div>
                <div className="neon-card rounded-xl p-5 space-y-1">
                  <div className="text-xs text-slate-300">Overdue (31–60 Days)</div>
                  <div className="text-xl font-bold font-mono-tabular text-amber-300">
                    {formatLkrMinor(
                      overview.receivables.aging.days31To60Minor,
                      overview.currency
                    )}
                  </div>
                </div>
                <div className="neon-card rounded-xl p-5 space-y-1">
                  <div className="text-xs text-slate-300">Critical (60+ Days)</div>
                  <div className="text-xl font-bold font-mono-tabular text-rose-300">
                    {formatLkrMinor(
                      overview.receivables.aging.days60PlusMinor,
                      overview.currency
                    )}
                  </div>
                </div>
              </div>

              <div className="grid lg:grid-cols-12 gap-6">
                <section className="lg:col-span-4 neon-card rounded-xl p-6 space-y-4">
                  <h2 className="text-base font-semibold text-white">New Credit Account</h2>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      createAccMutation.mutate();
                    }}
                    className="space-y-3"
                  >
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-cyan-100/80">
                        Patient / Customer / Corporate Name *
                      </span>
                      <input
                        required
                        value={accName}
                        onChange={(e) => setAccName(e.target.value)}
                        placeholder="e.g. Kamal Jayawardena"
                        className="w-full min-h-[42px] px-3 rounded-lg text-sm neon-input"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-cyan-100/80">Account Type</span>
                        <select
                          value={accType}
                          onChange={(e) =>
                            setAccType(e.target.value as 'patient' | 'corporate' | 'customer')
                          }
                          className="w-full min-h-[42px] px-3 rounded-lg text-sm neon-input"
                        >
                          <option value="customer">Pharmacy Customer</option>
                          <option value="patient">Clinic Patient</option>
                          <option value="corporate">Corporate / Insurance</option>
                        </select>
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-cyan-100/80">Credit Limit</span>
                        <input
                          type="number"
                          min="0"
                          value={accLimit}
                          onChange={(e) => setAccLimit(e.target.value)}
                          className="w-full min-h-[42px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                        />
                      </label>
                    </div>
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-cyan-100/80">Phone Number</span>
                      <input
                        value={accPhone}
                        onChange={(e) => setAccPhone(e.target.value)}
                        placeholder="0771234567"
                        className="w-full min-h-[42px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={createAccMutation.isPending || !canWriteAccounts}
                      className="w-full min-h-[44px] rounded-lg text-sm neon-btn-primary disabled:opacity-50"
                    >
                      Create Credit Account
                    </button>
                  </form>
                </section>

                <section className="lg:col-span-8 neon-card rounded-xl p-6 space-y-4">
                  <h2 className="text-base font-semibold text-white">
                    Customer &amp; Patient Credit Accounts
                  </h2>

                  <div className="space-y-3">
                    {overview.receivables.accounts.map((acc) => {
                      const isExpanded = activeAccId === acc.id;
                      return (
                        <div
                          key={acc.id}
                          className="p-4 rounded-xl bg-[#040e22]/90 border border-cyan-500/20 space-y-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-white">
                                {acc.accountName}{' '}
                                <span className="text-xs font-normal text-cyan-300 capitalize">
                                  ({acc.accountType})
                                </span>
                              </div>
                              <div className="text-xs text-slate-400 font-mono-tabular">
                                {acc.phone || 'No phone'} · Limit:{' '}
                                {formatLkrMinor(acc.creditLimitMinor)} · Aging: {acc.agingBucket}
                              </div>
                            </div>

                            <div className="flex items-center gap-3">
                              <div className="text-right">
                                <div className="text-[11px] text-slate-400">Balance Due</div>
                                <div
                                  className={`text-base font-bold font-mono-tabular ${
                                    acc.balanceMinor > 0 ? 'text-amber-300' : 'text-emerald-300'
                                  }`}
                                >
                                  {formatLkrMinor(acc.balanceMinor)}
                                </div>
                              </div>
                              {canWriteAccounts && (
                                <button
                                  type="button"
                                  onClick={() => setActiveAccId(isExpanded ? null : acc.id)}
                                  className="min-h-[36px] px-3 rounded-lg text-xs font-semibold neon-btn-secondary"
                                >
                                  {isExpanded ? 'Close' : 'Charge / Collect'}
                                </button>
                              )}
                            </div>
                          </div>

                          {isExpanded && (
                            <form
                              onSubmit={(e) => {
                                e.preventDefault();
                                entryMutation.mutate();
                              }}
                              className="pt-3 border-t border-cyan-500/20 grid sm:grid-cols-4 gap-2.5 items-end"
                            >
                              <label className="block space-y-1">
                                <span className="text-[11px] text-cyan-200/80">Action</span>
                                <select
                                  value={entryType}
                                  onChange={(e) =>
                                    setEntryType(e.target.value as 'charge' | 'payment')
                                  }
                                  className="w-full min-h-[38px] px-2.5 rounded-lg text-xs neon-input"
                                >
                                  <option value="payment">Collect Payment (-)</option>
                                  <option value="charge">Add Credit Charge (+)</option>
                                </select>
                              </label>
                              <label className="block space-y-1">
                                <span className="text-[11px] text-cyan-200/80">Amount (LKR)</span>
                                <input
                                  required
                                  type="number"
                                  min="1"
                                  step="0.01"
                                  value={entryAmount}
                                  onChange={(e) => setEntryAmount(e.target.value)}
                                  placeholder="1500"
                                  className="w-full min-h-[38px] px-2.5 rounded-lg text-xs font-mono-tabular neon-input"
                                />
                              </label>
                              {entryType === 'payment' ? (
                                <label className="block space-y-1">
                                  <span className="text-[11px] text-cyan-200/80">Method</span>
                                  <select
                                    value={entryMethod}
                                    onChange={(e) =>
                                      setEntryMethod(e.target.value as 'cash' | 'card' | 'bank')
                                    }
                                    className="w-full min-h-[38px] px-2.5 rounded-lg text-xs neon-input"
                                  >
                                    <option value="cash">Cash</option>
                                    <option value="bank">Bank</option>
                                    <option value="card">Card</option>
                                  </select>
                                </label>
                              ) : (
                                <label className="block space-y-1">
                                  <span className="text-[11px] text-cyan-200/80">Notes</span>
                                  <input
                                    value={entryNotes}
                                    onChange={(e) => setEntryNotes(e.target.value)}
                                    placeholder="Invoice ref"
                                    className="w-full min-h-[38px] px-2.5 rounded-lg text-xs neon-input"
                                  />
                                </label>
                              )}
                              <button
                                type="submit"
                                disabled={entryMutation.isPending}
                                className="min-h-[38px] px-3 rounded-lg text-xs neon-btn-primary"
                              >
                                Post Entry
                              </button>
                            </form>
                          )}

                          {acc.recentEntries.length > 0 && (
                            <div className="text-[11px] text-slate-400 space-y-1 pt-1">
                              {acc.recentEntries.slice(0, 3).map((en) => (
                                <div key={en.id} className="flex justify-between">
                                  <span className="inline-flex items-center gap-1">
                                    {en.entryType === 'charge' ? (
                                      <ArrowUpRight className="w-3 h-3 text-amber-300" />
                                    ) : (
                                      <ArrowDownRight className="w-3 h-3 text-emerald-300" />
                                    )}
                                    <span className="capitalize">{en.entryType}</span> ·{' '}
                                    {en.notes || en.method}
                                  </span>
                                  <span className="font-mono-tabular text-slate-200">
                                    {en.entryType === 'charge' ? '+' : '-'}
                                    {formatLkrMinor(en.amountMinor)}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              </div>
            </div>
          )}

          {/* TAB 3: SUPPLIER PAYABLES (AP) */}
          {tab === 'payables' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="neon-card-glow rounded-xl p-5 space-y-1">
                  <div className="text-xs text-cyan-200/80">Total Supplier Payables</div>
                  <div className="text-2xl font-bold font-mono-tabular neon-text-cyan">
                    {formatLkrMinor(overview.payables.totalPayableMinor, overview.currency)}
                  </div>
                </div>
                <div className="neon-card rounded-xl p-5 space-y-1">
                  <div className="text-xs text-slate-300">Current (0–30 Days)</div>
                  <div className="text-xl font-bold font-mono-tabular text-emerald-300">
                    {formatLkrMinor(
                      overview.payables.aging.current0To30Minor,
                      overview.currency
                    )}
                  </div>
                </div>
                <div className="neon-card rounded-xl p-5 space-y-1">
                  <div className="text-xs text-slate-300">31–60 Days</div>
                  <div className="text-xl font-bold font-mono-tabular text-amber-300">
                    {formatLkrMinor(overview.payables.aging.days31To60Minor, overview.currency)}
                  </div>
                </div>
                <div className="neon-card rounded-xl p-5 space-y-1">
                  <div className="text-xs text-slate-300">60+ Days</div>
                  <div className="text-xl font-bold font-mono-tabular text-rose-300">
                    {formatLkrMinor(overview.payables.aging.days60PlusMinor, overview.currency)}
                  </div>
                </div>
              </div>

              <div className="grid lg:grid-cols-12 gap-6">
                <section className="lg:col-span-4 neon-card rounded-xl p-6 space-y-4">
                  <h2 className="text-base font-semibold text-white">Record Supplier Settlement</h2>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      supplierPayMutation.mutate();
                    }}
                    className="space-y-3"
                  >
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-cyan-100/80">Supplier *</span>
                      <select
                        required
                        value={paySupplierId}
                        onChange={(e) => setPaySupplierId(e.target.value)}
                        className="w-full min-h-[42px] px-3 rounded-lg text-sm neon-input"
                      >
                        <option value="">Select supplier...</option>
                        {overview.payables.suppliers.map((s) => (
                          <option key={s.supplierId} value={s.supplierId}>
                            {s.supplierName} (Due {formatLkrMinor(s.outstandingMinor)})
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-cyan-100/80">Amount (LKR) *</span>
                        <input
                          required
                          type="number"
                          min="1"
                          step="0.01"
                          value={payAmount}
                          onChange={(e) => setPayAmount(e.target.value)}
                          placeholder="25000"
                          className="w-full min-h-[42px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-cyan-100/80">Method</span>
                        <select
                          value={payMethod}
                          onChange={(e) =>
                            setPayMethod(e.target.value as 'bank' | 'cash' | 'cheque')
                          }
                          className="w-full min-h-[42px] px-3 rounded-lg text-sm neon-input"
                        >
                          <option value="bank">Bank Transfer / SLIPS</option>
                          <option value="cheque">Cheque</option>
                          <option value="cash">Cash</option>
                        </select>
                      </label>
                    </div>
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-cyan-100/80">
                        Cheque / Slip Reference
                      </span>
                      <input
                        value={payRef}
                        onChange={(e) => setPayRef(e.target.value)}
                        placeholder="CHQ-409182"
                        className="w-full min-h-[42px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                      />
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-cyan-100/80">Notes</span>
                      <input
                        value={payNotes}
                        onChange={(e) => setPayNotes(e.target.value)}
                        placeholder="Partial invoice settlement"
                        className="w-full min-h-[42px] px-3 rounded-lg text-sm neon-input"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={supplierPayMutation.isPending || !canWriteAccounts}
                      className="w-full min-h-[44px] rounded-lg text-sm neon-btn-primary disabled:opacity-50"
                    >
                      Record Supplier Payment
                    </button>
                  </form>
                </section>

                <section className="lg:col-span-8 neon-card rounded-xl p-6 space-y-5">
                  <h2 className="text-base font-semibold text-white">Supplier Balance Summary</h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-cyan-500/20 text-cyan-200/75">
                          <th className="py-2.5 px-3">Supplier</th>
                          <th className="py-2.5 px-3 text-right">Invoiced</th>
                          <th className="py-2.5 px-3 text-right">Debit Notes</th>
                          <th className="py-2.5 px-3 text-right">Paid</th>
                          <th className="py-2.5 px-3 text-right">Outstanding</th>
                          <th className="py-2.5 px-3 text-right">Aging</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-cyan-500/15">
                        {overview.payables.suppliers.length === 0 ? (
                          <tr>
                            <td colSpan={6} className="py-8 text-center text-slate-400">
                              No supplier payable balances recorded.
                            </td>
                          </tr>
                        ) : (
                          overview.payables.suppliers.map((s) => (
                            <tr key={s.supplierId} className="hover:bg-cyan-950/20">
                              <td className="py-2.5 px-3 font-medium text-white">
                                {s.supplierName}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono-tabular text-slate-300">
                                {formatLkrMinor(s.totalInvoicedMinor)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono-tabular text-cyan-300">
                                -{formatLkrMinor(s.totalDebitNotesMinor)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono-tabular text-emerald-300">
                                -{formatLkrMinor(s.totalPaidMinor)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono-tabular font-bold text-amber-300">
                                {formatLkrMinor(s.outstandingMinor)}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono-tabular text-slate-300">
                                {s.agingBucket}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  {overview.payables.recentPayments.length > 0 && (
                    <div className="pt-4 border-t border-cyan-500/15 space-y-2">
                      <h3 className="text-xs font-semibold uppercase tracking-wider text-cyan-200/80">
                        Recent Supplier Settlements
                      </h3>
                      <div className="space-y-1.5 text-xs">
                        {overview.payables.recentPayments.slice(0, 6).map((p) => (
                          <div
                            key={p.id}
                            className="flex justify-between py-1.5 px-3 rounded-lg bg-[#040e22]/75"
                          >
                            <span className="text-slate-200">
                              {p.supplierName} · <span className="uppercase">{p.method}</span>{' '}
                              {p.referenceNo ? `(${p.referenceNo})` : ''}
                            </span>
                            <span className="font-mono-tabular text-emerald-300">
                              {formatLkrMinor(p.amountMinor)} · {p.paidDate}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
