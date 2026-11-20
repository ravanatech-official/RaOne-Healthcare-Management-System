import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Banknote,
  CalendarCheck2,
  ClipboardList,
  FileBarChart2,
  Package,
  Receipt,
  ShieldCheck,
  ShoppingCart,
  Truck,
  Users,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient, formatLkrMinor } from '../lib/api-client.ts';
import { JarvisVoiceConsole } from '../components/JarvisVoiceConsole.tsx';

export function HomeAssistantPage() {
  const { t } = useTranslation();
  const { session, activeTenantId } = useAuth();

  const caps = session?.workspace?.capabilities ?? {};
  const hasClinic = Boolean(caps['appointments.manage']);
  const hasPos = Boolean(caps['pharmacy.pos']);
  const hasStock = Boolean(caps['pharmacy.inventory']);
  const hasReceiving = Boolean(caps['pharmacy.receiving']);
  const hasPharmacy = hasPos || hasStock || hasReceiving || Boolean(caps['pharmacy.catalogue']);
  const hasAccounts = Boolean(caps['accounts.ledger']);
  const hasPurchasing = Boolean(caps['purchasing.orders']) && hasPharmacy;
  const hasHrAdmin = Boolean(caps['hr.management']) || Boolean(caps['admin.operations']);
  const canViewReports =
    (session?.workspace?.permissions.includes('reports.branch_summary') ||
      session?.workspace?.permissions.includes('reports.all_financials')) ??
    false;

  const { data: today, isLoading: todayLoading, error: todayError } = useQuery({
    queryKey: ['today', activeTenantId],
    queryFn: () => apiClient.getTodaySummary(activeTenantId!),
    enabled: Boolean(activeTenantId && hasClinic),
  });

  const stockQuery = useQuery({
    queryKey: ['pharmacy-stock', activeTenantId],
    queryFn: () => apiClient.getStockSummary(activeTenantId!),
    enabled: Boolean(activeTenantId && hasStock),
  });

  const totalSellableBase =
    stockQuery.data?.balances.reduce((sum, b) => sum + b.availableQty, 0) ?? 0;
  const totalQuarantineBase =
    stockQuery.data?.balances.reduce(
      (sum, b) => sum + b.quarantineQty + b.returnedQuarantineQty,
      0
    ) ?? 0;

  return (
    <div className="space-y-8">
      {/* J.A.R.V.I.S. Bilingual Conversational Voice & Tool-Calling Console */}
      <JarvisVoiceConsole />

      {/* Capability-Aware Operational Cards */}
      <section className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
        <Link
          to="/autopilot"
          className="neon-card-glow hover:border-cyan-400/70 rounded-xl p-6 flex items-center justify-between gap-4 transition-all"
        >
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 neon-text-cyan font-semibold text-base">
              <ShieldCheck className="w-5 h-5" aria-hidden="true" />
              <span>{t('nav.autopilot')} &amp; Shift SOP</span>
            </div>
            <p className="text-sm text-slate-300 line-clamp-2">
              Opening/Closing SOP checklists, Anti-Fraud Alerts, Smart Auto-Reorder &amp; Patient QR Kiosk
            </p>
          </div>
          <ArrowRight className="w-5 h-5 text-cyan-400/70 shrink-0" aria-hidden="true" />
        </Link>

        {hasClinic && (
          <>
            <Link
              to="/today"
              className="neon-card hover:border-cyan-400/60 rounded-xl p-6 flex items-center justify-between gap-4 transition-all"
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 neon-text-cyan font-semibold text-base">
                  <CalendarCheck2 className="w-5 h-5" aria-hidden="true" />
                  <span>{t('home.todayWork')}</span>
                </div>
                {todayLoading ? (
                  <p className="text-sm text-slate-400">{t('common.loading')}</p>
                ) : todayError ? (
                  <p className="text-sm text-rose-300">{t('common.errorTitle')}</p>
                ) : (
                  <p className="text-sm text-slate-300 tabular-nums">
                    {today?.businessDate} · {today?.counts.total ?? 0} {t('today.total')} ·{' '}
                    {today?.counts.arrived ?? 0} {t('today.arrived')}
                  </p>
                )}
              </div>
              <ArrowRight className="w-5 h-5 text-cyan-400/70 shrink-0" aria-hidden="true" />
            </Link>

            <div className="neon-card rounded-xl p-6 flex items-center justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-white font-semibold text-base">
                  <Banknote className="w-5 h-5 text-cyan-300" aria-hidden="true" />
                  <span>{t('home.todayMoney')}</span>
                </div>
                {todayLoading ? (
                  <p className="text-sm text-slate-400">{t('common.loading')}</p>
                ) : todayError ? (
                  <p className="text-sm text-rose-300">{t('common.errorTitle')}</p>
                ) : (
                  <div className="space-y-0.5">
                    <p className="text-2xl font-bold font-mono-tabular neon-text-cyan">
                      {formatLkrMinor(today?.recordedReceiptsMinor ?? 0, today?.currency ?? 'LKR')}
                    </p>
                    <p className="text-xs text-slate-400">
                      {today?.financialScope === 'branch_all'
                        ? t('today.scopeBranch')
                        : t('today.scopeOwn')}
                    </p>
                  </div>
                )}
              </div>
              <span className="text-xs font-mono-tabular text-cyan-300 whitespace-nowrap">
                {session?.workspace?.currency || 'LKR'}
              </span>
            </div>
          </>
        )}

        {hasPos && (
          <Link
            to="/pharmacy/pos"
            className="neon-card hover:border-cyan-400/60 rounded-xl p-6 flex items-center justify-between gap-4 transition-all"
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 neon-text-cyan font-semibold text-base">
                <ShoppingCart className="w-5 h-5" aria-hidden="true" />
                <span>{t('home.pharmacyPosCard')}</span>
              </div>
              <p className="text-sm text-slate-300 line-clamp-2">{t('pharmacy.posDesc')}</p>
            </div>
            <ArrowRight className="w-5 h-5 text-cyan-400/70 shrink-0" aria-hidden="true" />
          </Link>
        )}

        {hasStock && (
          <Link
            to="/pharmacy/stock"
            className="neon-card hover:border-cyan-400/60 rounded-xl p-6 flex items-center justify-between gap-4 transition-all"
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-white font-semibold text-base">
                <Package className="w-5 h-5 text-cyan-300" aria-hidden="true" />
                <span>{t('home.pharmacyStockCard')}</span>
              </div>
              <p className="text-sm text-cyan-200 font-mono-tabular">
                Sellable: {totalSellableBase} · Quarantine: {totalQuarantineBase}
              </p>
            </div>
            <ArrowRight className="w-5 h-5 text-cyan-400/70 shrink-0" aria-hidden="true" />
          </Link>
        )}

        {!hasClinic && hasReceiving && (
          <Link
            to="/pharmacy/receiving"
            className="neon-card hover:border-cyan-400/60 rounded-xl p-6 flex items-center justify-between gap-4 transition-all"
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-white font-semibold text-base">
                <Truck className="w-5 h-5 text-cyan-300" aria-hidden="true" />
                <span>{t('home.pharmacyReceivingCard')}</span>
              </div>
              <p className="text-sm text-slate-300 line-clamp-2">{t('pharmacy.receivingDesc')}</p>
            </div>
            <ArrowRight className="w-5 h-5 text-cyan-400/70 shrink-0" aria-hidden="true" />
          </Link>
        )}

        {hasAccounts && (
          <Link
            to="/accounts"
            className="neon-card hover:border-cyan-400/60 rounded-xl p-6 flex items-center justify-between gap-4 transition-all"
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-white font-semibold text-base">
                <Receipt className="w-5 h-5 text-cyan-300" aria-hidden="true" />
                <span>{t('nav.accounts')}</span>
              </div>
              <p className="text-sm text-slate-300">
                Daily Net P&amp;L, Operating Expenses, Receivables &amp; Supplier Payables
              </p>
            </div>
            <ArrowRight className="w-5 h-5 text-cyan-400/70 shrink-0" aria-hidden="true" />
          </Link>
        )}

        {hasPurchasing && (
          <Link
            to="/purchasing"
            className="neon-card hover:border-cyan-400/60 rounded-xl p-6 flex items-center justify-between gap-4 transition-all"
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-white font-semibold text-base">
                <ClipboardList className="w-5 h-5 text-cyan-300" aria-hidden="true" />
                <span>{t('nav.purchasing')}</span>
              </div>
              <p className="text-sm text-slate-300">
                Low-Stock Purchase Orders, 1-Click GRN &amp; Supplier Debit Notes
              </p>
            </div>
            <ArrowRight className="w-5 h-5 text-cyan-400/70 shrink-0" aria-hidden="true" />
          </Link>
        )}

        {hasHrAdmin && (
          <Link
            to="/hr-admin"
            className="neon-card hover:border-cyan-400/60 rounded-xl p-6 flex items-center justify-between gap-4 transition-all"
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-white font-semibold text-base">
                <Users className="w-5 h-5 text-cyan-300" aria-hidden="true" />
                <span>{t('nav.hrAdmin')}</span>
              </div>
              <p className="text-sm text-slate-300">
                Attendance PIN, Leaves, EPF/ETF Payroll &amp; Compliance Vault
              </p>
            </div>
            <ArrowRight className="w-5 h-5 text-cyan-400/70 shrink-0" aria-hidden="true" />
          </Link>
        )}

        {canViewReports && (
          <Link
            to="/reports"
            className="neon-card hover:border-cyan-400/60 rounded-xl p-6 flex items-center justify-between gap-4 transition-all"
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-white font-semibold text-base">
                <FileBarChart2 className="w-5 h-5 text-cyan-300" aria-hidden="true" />
                <span>{t('reports.title')}</span>
              </div>
              <p className="text-sm text-slate-300 line-clamp-2">{t('reports.desc')}</p>
            </div>
            <ArrowRight className="w-5 h-5 text-cyan-400/70 shrink-0" aria-hidden="true" />
          </Link>
        )}
      </section>
    </div>
  );
}
