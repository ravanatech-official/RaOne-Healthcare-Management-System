import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Clock, Monitor, Volume2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient, formatTimeColombo } from '../lib/api-client.ts';

export function WaitingRoomDisplayPage() {
  const { activeTenantId } = useAuth();
  const { t } = useTranslation();

  const displayQuery = useQuery({
    queryKey: ['waiting-room-display', activeTenantId],
    queryFn: () => apiClient.getWaitingRoomDisplay(activeTenantId!),
    enabled: Boolean(activeTenantId),
    refetchInterval: 5_000,
  });

  const data = displayQuery.data;
  const maxDelay = Math.max(
    0,
    ...(data?.allActive.map((item) => item.delayMinutes || 0) ?? [0])
  );

  return (
    <div className="min-h-screen neon-canvas text-white p-6 sm:p-10 flex flex-col justify-between space-y-8">
      {/* Top TV Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-cyan-500/20 pb-6">
        <div className="space-y-1">
          <div className="flex items-center gap-2 neon-text-cyan text-xs font-semibold uppercase tracking-wider">
            <Monitor className="w-4 h-4" aria-hidden="true" />
            <span>{t('queue.tvBadge')}</span>
          </div>
          <h1 className="font-display text-3xl sm:text-4xl font-bold tracking-tight neon-heading-glow">
            {data?.tenantName || 'SuwaSeva'} · {data?.branchName || 'Main Branch'}
          </h1>
        </div>

        <div className="flex items-center gap-4">
          {data && (
            <div className="text-right font-mono-tabular text-sm text-cyan-100">
              <div>{data.businessDate}</div>
              <div className="text-xs text-slate-400">
                Updated {formatTimeColombo(data.updatedAt)}
              </div>
            </div>
          )}
          <Link
            to="/today"
            className="min-h-[40px] px-4 neon-btn-secondary text-xs font-medium rounded-lg inline-flex items-center gap-2 whitespace-nowrap"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span>{t('queue.backToDesk')}</span>
          </Link>
        </div>
      </div>

      {maxDelay > 0 && (
        <div
          role="status"
          className="bg-amber-950/60 border border-amber-400/50 rounded-xl px-6 py-4 flex items-center gap-3 text-amber-100 shadow-[0_0_24px_-8px_rgba(251,191,36,0.45)]"
        >
          <Clock className="w-6 h-6 text-amber-300 shrink-0" aria-hidden="true" />
          <p className="text-lg font-medium">
            {t('queue.delayNotice', { minutes: maxDelay })}
          </p>
        </div>
      )}

      {/* Main Split Display: Now Serving vs Up Next */}
      {displayQuery.isLoading ? (
        <div className="py-20 text-center text-slate-400 text-lg">{t('common.loading')}</div>
      ) : (
        <div className="grid lg:grid-cols-12 gap-8 flex-1 items-start">
          {/* Now Serving */}
          <section className="lg:col-span-7 space-y-4">
            <div className="flex items-center gap-2 neon-text-cyan text-lg font-semibold">
              <Volume2 className="w-5 h-5" aria-hidden="true" />
              <h2>{t('queue.nowServingHeading')}</h2>
            </div>

            {!data || data.nowServing.length === 0 ? (
              <div className="neon-card rounded-2xl p-10 text-center text-slate-300 text-lg">
                {t('queue.noServing')}
              </div>
            ) : (
              <div className="space-y-4">
                {data.nowServing.map((item) => (
                  <div
                    key={item.appointmentId}
                    className="neon-card-glow rounded-2xl p-6 sm:p-8 flex items-center justify-between gap-6"
                  >
                    <div className="space-y-2">
                      <div className="text-sm text-cyan-300 font-medium">
                        {item.resourceName} · {item.serviceName}
                      </div>
                      <div className="text-2xl sm:text-3xl font-bold text-white">
                        {item.patientName}
                      </div>
                      <div className="text-xs font-mono-tabular text-slate-300">
                        {formatTimeColombo(item.startsAt)}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-xs text-cyan-300 uppercase tracking-wider">Token</div>
                      <div className="font-mono-tabular text-5xl sm:text-6xl font-bold neon-text-cyan">
                        #{String(item.tokenNumber).padStart(2, '0')}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Up Next */}
          <section className="lg:col-span-5 space-y-4">
            <h2 className="text-lg font-semibold text-cyan-100">{t('queue.upNextHeading')}</h2>
            {!data || data.upNext.length === 0 ? (
              <div className="neon-card rounded-2xl p-8 text-center text-slate-300">
                {t('queue.noWaiting')}
              </div>
            ) : (
              <div className="neon-card rounded-2xl divide-y divide-cyan-500/15">
                {data.upNext.slice(0, 8).map((item) => (
                  <div
                    key={item.appointmentId}
                    className="px-5 py-4 flex items-center justify-between gap-4"
                  >
                    <div className="space-y-0.5 min-w-0">
                      <div className="text-base font-semibold text-white truncate">
                        {item.patientName}
                      </div>
                      <div className="text-xs text-slate-300 truncate">
                        {item.resourceName} · {formatTimeColombo(item.startsAt)}
                      </div>
                    </div>
                    <div className="font-mono-tabular text-2xl font-bold neon-text-cyan shrink-0">
                      #{String(item.tokenNumber).padStart(2, '0')}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      <footer className="border-t border-cyan-500/20 pt-4 text-xs text-slate-400 flex flex-wrap justify-between gap-2">
        <span>SuwaSeva Patient Queue Display</span>
        <span>Auto-refreshing live queue · Asia/Colombo</span>
      </footer>
    </div>
  );
}
