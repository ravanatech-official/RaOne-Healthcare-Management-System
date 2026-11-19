import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Printer } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient, ApiClientError, formatLkrMinor } from '../lib/api-client.ts';

export function CombinedReportsPage() {
  const { activeTenantId } = useAuth();
  const { t } = useTranslation();
  const [date, setDate] = useState('');
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const reportQuery = useQuery({
    queryKey: ['z-report', activeTenantId, date || 'today'],
    queryFn: () => apiClient.getCombinedZReport(activeTenantId!, date || undefined),
    enabled: Boolean(activeTenantId),
  });

  const handleDownloadCsv = async () => {
    if (!activeTenantId) return;
    setDownloadError(null);
    setDownloading(true);
    try {
      const csvText = await apiClient.fetchCombinedZReportCsv(activeTenantId, date || undefined);
      const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `suwaseva-z-report-${reportQuery.data?.report.businessDate || 'today'}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setDownloadError(err instanceof Error ? err.message : 'Unable to export CSV');
    } finally {
      setDownloading(false);
    }
  };

  const report = reportQuery.data?.report;
  const hasClinic = report?.modeFlags?.hasClinic ?? true;
  const hasPharmacy = report?.modeFlags?.hasPharmacy ?? true;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 no-print">
        <div className="space-y-1 max-w-2xl">
          <h1 className="font-display text-2xl font-bold neon-heading-glow">
            {t('reports.title')}
          </h1>
          <p className="text-sm text-cyan-100/75">{t('reports.desc')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <input
            type="date"
            aria-label="Business date"
            value={date || report?.businessDate || ''}
            onChange={(e) => setDate(e.target.value)}
            className="min-h-[40px] px-3 rounded-lg text-xs font-mono-tabular neon-input"
          />
          <button
            type="button"
            disabled={downloading || !report}
            onClick={handleDownloadCsv}
            className="min-h-[40px] px-4 rounded-lg text-xs neon-btn-primary inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
          >
            <Download className="w-4 h-4" aria-hidden="true" />
            <span>{downloading ? 'Exporting...' : t('reports.exportCsv')}</span>
          </button>
          <button
            type="button"
            disabled={!report}
            onClick={() => window.print()}
            className="min-h-[40px] px-4 rounded-lg text-xs font-medium neon-btn-secondary inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
          >
            <Printer className="w-4 h-4" aria-hidden="true" />
            <span>{t('reports.printPdf')}</span>
          </button>
        </div>
      </div>

      {downloadError && (
        <div
          role="alert"
          className="p-3 bg-rose-950/60 border border-rose-400/50 rounded-lg text-sm text-rose-200"
        >
          {downloadError}
        </div>
      )}

      {reportQuery.isLoading ? (
        <div className="p-8 neon-card rounded-xl text-sm text-cyan-200/75">{t('common.loading')}</div>
      ) : reportQuery.error ? (
        <div
          role="alert"
          className="p-6 neon-card rounded-xl border-rose-400/40 text-sm text-rose-200"
        >
          {reportQuery.error instanceof ApiClientError
            ? reportQuery.error.envelope.message
            : t('common.errorTitle')}
        </div>
      ) : report ? (
        <div className="space-y-6">
          {/* Dynamic Mode-Filtered KPI Headline Strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="neon-card rounded-xl p-5 space-y-1">
              <div className="text-xs text-cyan-200/70">
                {!hasClinic
                  ? t('reports.pharmacyNet')
                  : !hasPharmacy
                    ? t('reports.clinicNet')
                    : t('reports.combinedRevenue')}
              </div>
              <div className="text-2xl font-bold font-mono-tabular neon-text-cyan">
                {formatLkrMinor(report.combined.totalRevenueMinor, report.currency)}
              </div>
              <div className="text-xs text-slate-400 font-mono-tabular">{report.businessDate}</div>
            </div>

            {hasClinic && (
              <div className="neon-card rounded-xl p-5 space-y-1">
                <div className="text-xs text-cyan-200/70">{t('reports.clinicNet')}</div>
                <div className="text-2xl font-bold font-mono-tabular text-white">
                  {formatLkrMinor(report.clinic.netCollectionsMinor, report.currency)}
                </div>
                <div className="text-xs font-mono-tabular text-amber-300">
                  Doctor Share: {formatLkrMinor(report.clinic.doctorPayoutsMinor, report.currency)}
                </div>
              </div>
            )}

            {hasPharmacy && (
              <div className="neon-card rounded-xl p-5 space-y-1">
                <div className="text-xs text-cyan-200/70">{t('reports.pharmacyNet')}</div>
                <div className="text-2xl font-bold font-mono-tabular text-white">
                  {formatLkrMinor(report.pharmacy.netSalesMinor, report.currency)}
                </div>
                <div className="text-xs font-mono-tabular text-emerald-300">
                  Gross Profit: {formatLkrMinor(report.pharmacy.grossProfitMinor, report.currency)}
                </div>
              </div>
            )}

            <div className="neon-card rounded-xl p-5 space-y-1">
              <div className="text-xs text-cyan-200/70">{t('reports.opexTotal')}</div>
              <div className="text-2xl font-bold font-mono-tabular text-amber-300">
                -{formatLkrMinor(report.expenses?.opexMinor ?? 0, report.currency)}
              </div>
              <div className="text-xs font-mono-tabular text-slate-400">
                {report.expenses?.expenseCount ?? 0} expense entries
              </div>
            </div>

            <div className="neon-card-glow rounded-xl p-5 space-y-1">
              <div className="text-xs text-cyan-200/80">{t('reports.netProfit')}</div>
              <div
                className={`text-2xl font-bold font-mono-tabular ${
                  (report.combined.netProfitMinor ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'
                }`}
              >
                {formatLkrMinor(report.combined.netProfitMinor ?? 0, report.currency)}
              </div>
              <div className="text-xs font-mono-tabular text-slate-400">
                {hasPharmacy
                  ? `Till Variance: ${formatLkrMinor(report.pharmacy.tillVarianceMinor, report.currency)}`
                  : 'Net After Doctor Share & OpEx'}
              </div>
            </div>
          </div>

          {/* Mode-Specific Breakdown Sections */}
          <div className={`grid ${hasClinic && hasPharmacy ? 'lg:grid-cols-2' : 'grid-cols-1'} gap-6`}>
            {hasClinic && (
              <section className="neon-card rounded-xl p-6 space-y-4">
                <h2 className="text-base font-semibold text-white">
                  Clinic Collections &amp; Doctor Commission Settlement
                </h2>
                <dl className="divide-y divide-cyan-500/15 text-sm">
                  <div className="py-2.5 flex justify-between">
                    <dt className="text-slate-300">Appointments (Total / Completed)</dt>
                    <dd className="font-mono-tabular font-medium text-white">
                      {report.clinic.appointmentCount} / {report.clinic.completedCount}
                    </dd>
                  </div>
                  <div className="py-2.5 flex justify-between">
                    <dt className="text-slate-300">Gross Clinic Receipts</dt>
                    <dd className="font-mono-tabular text-white">
                      {formatLkrMinor(report.clinic.grossReceiptsMinor, report.currency)}
                    </dd>
                  </div>
                  <div className="py-2.5 flex justify-between">
                    <dt className="text-slate-300">Voided Clinic Receipts</dt>
                    <dd className="font-mono-tabular text-rose-300">
                      -{formatLkrMinor(report.clinic.voidedMinor, report.currency)}
                    </dd>
                  </div>
                  <div className="py-2.5 flex justify-between font-semibold">
                    <dt className="text-white">Net Clinic Collections</dt>
                    <dd className="font-mono-tabular text-white">
                      {formatLkrMinor(report.clinic.netCollectionsMinor, report.currency)}
                    </dd>
                  </div>
                  <div className="py-2.5 flex justify-between">
                    <dt className="text-slate-300">Doctor Channeling Payouts</dt>
                    <dd className="font-mono-tabular text-amber-300">
                      -{formatLkrMinor(report.clinic.doctorPayoutsMinor, report.currency)}
                    </dd>
                  </div>
                  <div className="py-2.5 flex justify-between font-bold">
                    <dt className="neon-text-cyan">Clinic Share After Doctor Payouts</dt>
                    <dd className="font-mono-tabular neon-text-cyan">
                      {formatLkrMinor(report.clinic.clinicNetAfterPayoutMinor, report.currency)}
                    </dd>
                  </div>
                </dl>
              </section>
            )}

            {hasPharmacy && (
              <section className="neon-card rounded-xl p-6 space-y-4">
                <h2 className="text-base font-semibold text-white">
                  Pharmacy POS, FEFO COGS &amp; Supplier Payables
                </h2>
                <dl className="divide-y divide-cyan-500/15 text-sm">
                  <div className="py-2.5 flex justify-between">
                    <dt className="text-slate-300">POS Transactions</dt>
                    <dd className="font-mono-tabular font-medium text-white">
                      {report.pharmacy.saleCount}
                    </dd>
                  </div>
                  <div className="py-2.5 flex justify-between">
                    <dt className="text-slate-300">Gross POS Sales</dt>
                    <dd className="font-mono-tabular text-white">
                      {formatLkrMinor(report.pharmacy.grossSalesMinor, report.currency)}
                    </dd>
                  </div>
                  <div className="py-2.5 flex justify-between">
                    <dt className="text-slate-300">Discounts &amp; Customer Returns</dt>
                    <dd className="font-mono-tabular text-rose-300">
                      -{formatLkrMinor(report.pharmacy.discountsMinor + report.pharmacy.returnsMinor, report.currency)}
                    </dd>
                  </div>
                  <div className="py-2.5 flex justify-between font-semibold">
                    <dt className="text-white">Net Pharmacy Sales</dt>
                    <dd className="font-mono-tabular text-white">
                      {formatLkrMinor(report.pharmacy.netSalesMinor, report.currency)}
                    </dd>
                  </div>
                  <div className="py-2.5 flex justify-between">
                    <dt className="text-slate-300">FEFO Cost of Goods Sold (COGS)</dt>
                    <dd className="font-mono-tabular text-slate-300">
                      -{formatLkrMinor(report.pharmacy.estimatedCogsMinor, report.currency)}
                    </dd>
                  </div>
                  <div className="py-2.5 flex justify-between">
                    <dt className="text-slate-300">Supplier Invoices Posted</dt>
                    <dd className="font-mono-tabular text-amber-300">
                      {formatLkrMinor(report.pharmacy.supplierInvoicesMinor, report.currency)}
                    </dd>
                  </div>
                  <div className="py-2.5 flex justify-between font-bold">
                    <dt className="neon-text-cyan">Pharmacy Gross Margin</dt>
                    <dd className="font-mono-tabular neon-text-cyan">
                      {formatLkrMinor(report.pharmacy.grossProfitMinor, report.currency)}
                    </dd>
                  </div>
                </dl>
              </section>
            )}
          </div>

          {/* Payment Tender Split */}
          <section className="neon-card rounded-xl p-6 space-y-3">
            <h2 className="text-base font-semibold text-white">
              {hasClinic && hasPharmacy
                ? 'Combined Collections by Tender Method'
                : 'Recorded Collections by Tender Method'}
            </h2>
            <div className="grid sm:grid-cols-3 gap-4 font-mono-tabular text-sm">
              <div className="p-4 bg-[#040e22]/90 border border-cyan-500/20 rounded-lg">
                <div className="text-xs text-cyan-200/70">Cash</div>
                <div className="text-lg font-bold text-white">
                  {formatLkrMinor(report.combined.byMethod.cashMinor, report.currency)}
                </div>
              </div>
              <div className="p-4 bg-[#040e22]/90 border border-cyan-500/20 rounded-lg">
                <div className="text-xs text-cyan-200/70">Card</div>
                <div className="text-lg font-bold text-white">
                  {formatLkrMinor(report.combined.byMethod.cardMinor, report.currency)}
                </div>
              </div>
              <div className="p-4 bg-[#040e22]/90 border border-cyan-500/20 rounded-lg">
                <div className="text-xs text-cyan-200/70">Bank Transfer</div>
                <div className="text-lg font-bold text-white">
                  {formatLkrMinor(report.combined.byMethod.bankMinor, report.currency)}
                </div>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
