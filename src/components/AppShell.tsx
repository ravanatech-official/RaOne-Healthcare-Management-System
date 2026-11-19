import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, HelpCircle, Lock, LogOut, Sparkles, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient } from '../lib/api-client.ts';
import type { SupportedLocale } from '../contracts/api.ts';
import { OfflineIndicator } from './OfflineIndicator.tsx';
import { PWAInstallButton } from './PWAInstallButton.tsx';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { session, activeTenantId, signOut, lockScreen, changeLanguage } = useAuth();
  const [helpOpen, setHelpOpen] = useState(false);

  const currentLocale = (i18n.language === 'en-LK' ? 'en-LK' : 'si-LK') as SupportedLocale;
  const workspace = session?.workspace;
  const canViewReports =
    (workspace?.permissions.includes('reports.branch_summary') ||
      workspace?.permissions.includes('reports.all_financials')) ??
    false;
  const canViewAudit = workspace?.permissions.includes('audit.read') ?? false;
  const canManageModules =
    (workspace?.permissions.includes('platform.capabilities.manage') ||
      workspace?.permissions.includes('platform.grants.manage')) ??
    false;
  const canViewBilling = workspace?.permissions.includes('billing.read') ?? false;

  const hasClinic = Boolean(workspace?.capabilities?.['appointments.manage']);
  const hasPos = Boolean(workspace?.capabilities?.['pharmacy.pos']);
  const hasCatalogue = Boolean(workspace?.capabilities?.['pharmacy.catalogue']);
  const hasReceiving = Boolean(workspace?.capabilities?.['pharmacy.receiving']);
  const hasStock = Boolean(workspace?.capabilities?.['pharmacy.inventory']);
  const hasPharmacy = hasPos || hasCatalogue || hasReceiving || hasStock;

  const hasAccounts =
    Boolean(workspace?.capabilities?.['accounts.ledger']) &&
    (workspace?.permissions.includes('accounts.read') || canViewReports);
  const hasPurchasing =
    Boolean(workspace?.capabilities?.['purchasing.orders']) &&
    hasPharmacy &&
    (workspace?.permissions.includes('purchasing.read') || hasReceiving);
  const hasHrAdmin =
    (Boolean(workspace?.capabilities?.['hr.management']) ||
      Boolean(workspace?.capabilities?.['admin.operations'])) &&
    (workspace?.permissions.includes('hr.attendance.self') ||
      workspace?.permissions.includes('hr.manage') ||
      workspace?.permissions.includes('admin.ops.manage') ||
      canViewReports);

  const billingBannerQuery = useQuery({
    queryKey: ['billing-overview', activeTenantId],
    queryFn: () => apiClient.getBillingOverview(activeTenantId!),
    enabled: Boolean(activeTenantId && canViewBilling),
    staleTime: 60_000,
  });

  const navItems = [
    { to: '/', label: t('nav.home') },
    ...(hasClinic ? [{ to: '/today', label: t('nav.today') }] : []),
    ...(hasPos ? [{ to: '/pharmacy/pos', label: t('nav.pos') }] : []),
    ...(hasCatalogue ? [{ to: '/pharmacy/catalogue', label: t('nav.catalogue') }] : []),
    ...(hasReceiving ? [{ to: '/pharmacy/receiving', label: t('nav.receiving') }] : []),
    ...(hasStock ? [{ to: '/pharmacy/stock', label: t('nav.stock') }] : []),
    ...(hasPurchasing ? [{ to: '/purchasing', label: t('nav.purchasing') }] : []),
    ...(hasAccounts ? [{ to: '/accounts', label: t('nav.accounts') }] : []),
    ...(hasHrAdmin ? [{ to: '/hr-admin', label: t('nav.hrAdmin') }] : []),
    ...(canViewReports ? [{ to: '/reports', label: t('nav.reports') }] : []),
    { to: '/team', label: t('nav.team') },
    ...(canManageModules ? [{ to: '/modules', label: t('nav.modules') }] : []),
    ...(canViewBilling ? [{ to: '/billing', label: t('nav.billing') }] : []),
    ...(canViewAudit ? [{ to: '/audit', label: t('nav.audit') }] : []),
  ];

  const trialGrace = billingBannerQuery.data?.trialGrace;
  const examples = t('help.examples', { returnObjects: true }) as string[];

  return (
    <div className="min-h-screen neon-canvas text-slate-100 flex flex-col">
      <header className="bg-[#030c1f]/90 backdrop-blur-xl border-b border-cyan-500/20 sticky top-0 z-30 shadow-[0_6px_30px_-10px_rgba(0,0,0,0.8)] no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
          <Link
            to="/"
            className="font-display text-lg font-extrabold tracking-tight text-white whitespace-nowrap shrink-0 inline-flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 rounded"
          >
            <Sparkles className="w-4 h-4 text-cyan-300" aria-hidden="true" />
            <span>
              Suwa<span className="neon-text-cyan">Seva</span>
            </span>
          </Link>

          <nav
            aria-label="Primary"
            className="hidden md:flex items-center gap-5 overflow-x-auto no-scrollbar py-1"
          >
            {navItems.map((item) => {
              const active = location.pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`text-xs lg:text-sm font-medium whitespace-nowrap shrink-0 py-2 border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400 ${
                    active
                      ? 'border-cyan-400 neon-text-cyan font-semibold'
                      : 'border-transparent text-slate-300 hover:text-cyan-200'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <div
              role="group"
              aria-label="Language"
              className="flex items-center p-1 bg-[#06132b] border border-cyan-500/25 rounded-lg"
            >
              <button
                type="button"
                onClick={() => changeLanguage('si-LK')}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 transition-all ${
                  currentLocale === 'si-LK'
                    ? 'bg-cyan-400 text-[#021324] shadow-[0_0_12px_rgba(34,211,238,0.5)]'
                    : 'text-slate-300 hover:text-cyan-200'
                }`}
              >
                සිංහල
              </button>
              <button
                type="button"
                onClick={() => changeLanguage('en-LK')}
                className={`px-2.5 py-1.5 text-xs font-semibold rounded-md whitespace-nowrap shrink-0 transition-all ${
                  currentLocale === 'en-LK'
                    ? 'bg-cyan-400 text-[#021324] shadow-[0_0_12px_rgba(34,211,238,0.5)]'
                    : 'text-slate-300 hover:text-cyan-200'
                }`}
              >
                English
              </button>
            </div>

            <PWAInstallButton />

            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 min-h-[38px] text-xs font-medium rounded-lg neon-btn-secondary whitespace-nowrap shrink-0"
            >
              <HelpCircle className="w-4 h-4 text-cyan-300" aria-hidden="true" />
              <span className="hidden xl:inline">{t('nav.help')}</span>
            </button>

            <button
              type="button"
              onClick={lockScreen}
              title={t('auth.lockDevice')}
              className="inline-flex items-center gap-1.5 px-3 min-h-[38px] text-xs font-medium rounded-lg neon-btn-secondary whitespace-nowrap shrink-0"
            >
              <Lock className="w-4 h-4 text-cyan-300" aria-hidden="true" />
              <span className="hidden xl:inline">{t('auth.lockDevice')}</span>
            </button>

            <button
              type="button"
              onClick={signOut}
              className="inline-flex items-center gap-1.5 px-3 min-h-[38px] text-xs font-semibold text-rose-200 bg-rose-950/50 border border-rose-400/30 rounded-lg hover:bg-rose-900/60 whitespace-nowrap shrink-0"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t('auth.signOut')}</span>
            </button>
          </div>
        </div>

        {/* Mobile navigation row */}
        <nav
          aria-label="Mobile Primary"
          className="md:hidden border-t border-cyan-500/15 px-4 flex items-center gap-4 overflow-x-auto"
        >
          {navItems.map((item) => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`text-sm font-medium whitespace-nowrap shrink-0 py-2.5 border-b-2 ${
                  active ? 'border-cyan-400 neon-text-cyan' : 'border-transparent text-slate-300'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* Active clinic/pharmacy identity context strip */}
      {workspace && (
        <div className="bg-[#040f24]/85 border-b border-cyan-500/15 no-print">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-white">{workspace.tenantName}</span>
              {workspace.legalEntityName && workspace.legalEntityName !== workspace.tenantName && (
                <>
                  <span aria-hidden="true" className="text-cyan-500/50">·</span>
                  <span>{workspace.legalEntityName}</span>
                </>
              )}
              <span aria-hidden="true" className="text-cyan-500/50">·</span>
              <span>{workspace.branchName}</span>
              <span aria-hidden="true" className="text-cyan-500/50">·</span>
              <span className="font-mono-tabular text-cyan-300">{workspace.productMode}</span>
              <span aria-hidden="true" className="text-cyan-500/50">·</span>
              <span className="font-mono-tabular">{workspace.timezone}</span>
              <span aria-hidden="true" className="text-cyan-500/50">·</span>
              <span className="font-mono-tabular">{workspace.currency}</span>
            </div>
            <div className="flex items-center gap-2">
              <span>{session?.user.displayName || session?.user.email}</span>
              <span aria-hidden="true" className="text-cyan-500/50">·</span>
              <span className="capitalize font-medium text-cyan-200">{workspace.role}</span>
              {workspace.professionalGrants.length > 0 && (
                <>
                  <span aria-hidden="true" className="text-cyan-500/50">·</span>
                  <span className="font-medium text-emerald-300">
                    {workspace.professionalGrants
                      .map((g) => `${g.grantType} (${g.licenseNumber})`)
                      .join(', ')}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Automated Trial Countdown & Read-Only Grace-Period Banner */}
      {trialGrace && (trialGrace.isReadOnlyGrace || trialGrace.status === 'trialing') && (
        <div
          className={`border-b px-4 py-2.5 text-xs no-print ${
            trialGrace.isReadOnlyGrace
              ? 'bg-rose-950/70 border-rose-400/40 text-rose-100'
              : 'bg-cyan-950/60 border-cyan-400/35 text-cyan-100'
          }`}
        >
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2 font-medium">
              <AlertTriangle
                className={`w-4 h-4 shrink-0 ${
                  trialGrace.isReadOnlyGrace ? 'text-rose-300' : 'text-cyan-300'
                }`}
                aria-hidden="true"
              />
              <span>
                {currentLocale === 'si-LK'
                  ? trialGrace.bannerMessageSi
                  : trialGrace.bannerMessageEn}
              </span>
            </div>
            <Link
              to="/billing"
              className={`px-3 py-1 rounded text-xs font-bold whitespace-nowrap ${
                trialGrace.isReadOnlyGrace
                  ? 'bg-rose-500 text-white hover:bg-rose-400'
                  : 'neon-btn-primary'
              }`}
            >
              {t('nav.billing')}
            </Link>
          </div>
        </div>
      )}

      <OfflineIndicator />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">{children}</main>

      {helpOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-dialog-title"
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="neon-card-glow rounded-2xl max-w-lg w-full p-6 space-y-5">
            <div className="flex items-center justify-between gap-4">
              <h2 id="help-dialog-title" className="text-lg font-semibold text-white">
                {t('help.title')}
              </h2>
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-slate-300 hover:bg-cyan-900/40"
                aria-label={t('help.close')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium text-cyan-200">{t('help.examplesTitle')}</p>
              <ul className="space-y-2 text-sm text-slate-200">
                {Array.isArray(examples) &&
                  examples.map((ex) => (
                    <li
                      key={ex}
                      className="p-3 bg-[#040e22]/90 border border-cyan-500/20 rounded-lg"
                    >
                      {ex}
                    </li>
                  ))}
              </ul>
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">{t('help.boundaryNote')}</p>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className="px-5 min-h-[44px] rounded-lg text-sm neon-btn-primary"
              >
                {t('help.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
