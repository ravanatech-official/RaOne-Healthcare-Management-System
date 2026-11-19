import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { HelpCircle, Lock, LogOut, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.tsx';
import type { SupportedLocale } from '../contracts/api.ts';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t, i18n } = useTranslation();
  const location = useLocation();
  const { session, signOut, lockScreen, changeLanguage } = useAuth();
  const [helpOpen, setHelpOpen] = useState(false);

  const currentLocale = (i18n.language === 'en-LK' ? 'en-LK' : 'si-LK') as SupportedLocale;
  const workspace = session?.workspace;
  const canViewAudit = workspace?.permissions.includes('audit.read') ?? false;
  const canManageModules =
    (workspace?.permissions.includes('platform.capabilities.manage') ||
      workspace?.permissions.includes('platform.grants.manage')) ??
    false;
  const hasClinic = Boolean(workspace?.capabilities?.['appointments.manage']);
  const hasPos = Boolean(workspace?.capabilities?.['pharmacy.pos']);
  const hasCatalogue = Boolean(workspace?.capabilities?.['pharmacy.catalogue']);
  const hasReceiving = Boolean(workspace?.capabilities?.['pharmacy.receiving']);
  const hasStock = Boolean(workspace?.capabilities?.['pharmacy.inventory']);

  const navItems = [
    { to: '/', label: t('nav.home') },
    ...(hasClinic ? [{ to: '/today', label: t('nav.today') }] : []),
    ...(hasPos ? [{ to: '/pharmacy/pos', label: t('nav.pos') }] : []),
    ...(hasCatalogue ? [{ to: '/pharmacy/catalogue', label: t('nav.catalogue') }] : []),
    ...(hasReceiving ? [{ to: '/pharmacy/receiving', label: t('nav.receiving') }] : []),
    ...(hasStock ? [{ to: '/pharmacy/stock', label: t('nav.stock') }] : []),
    { to: '/team', label: t('nav.team') },
    ...(canManageModules ? [{ to: '/modules', label: t('nav.modules') }] : []),
    ...(canViewAudit ? [{ to: '/audit', label: t('nav.audit') }] : []),
  ];

  const examples = t('help.examples', { returnObjects: true }) as string[];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4 sm:gap-8">
          <Link
            to="/"
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 rounded"
          >
            {t('brand')}
          </Link>

          <nav aria-label="Primary" className="hidden md:flex items-center gap-6">
            {navItems.map((item) => {
              const active = location.pathname === item.to;
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`text-sm font-medium whitespace-nowrap shrink-0 py-2 border-b-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 ${
                    active
                      ? 'border-teal-700 text-teal-800'
                      : 'border-transparent text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 sm:gap-3 shrink-0">
            <div
              role="group"
              aria-label="Language"
              className="flex items-center p-1 bg-slate-100 rounded-lg"
            >
              <button
                type="button"
                onClick={() => changeLanguage('si-LK')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 ${
                  currentLocale === 'si-LK'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                සිංහල
              </button>
              <button
                type="button"
                onClick={() => changeLanguage('en-LK')}
                className={`px-2.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 ${
                  currentLocale === 'en-LK'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                English
              </button>
            </div>

            <button
              type="button"
              onClick={() => setHelpOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 min-h-[40px] text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
            >
              <HelpCircle className="w-4 h-4 text-slate-600" aria-hidden="true" />
              <span className="hidden sm:inline">{t('nav.help')}</span>
            </button>

            <button
              type="button"
              onClick={lockScreen}
              title={t('auth.lockDevice')}
              className="inline-flex items-center gap-1.5 px-3 min-h-[40px] text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
            >
              <Lock className="w-4 h-4 text-slate-600" aria-hidden="true" />
              <span className="hidden lg:inline">{t('auth.lockDevice')}</span>
            </button>

            <button
              type="button"
              onClick={signOut}
              className="inline-flex items-center gap-1.5 px-3 min-h-[40px] text-xs font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
            >
              <LogOut className="w-4 h-4" aria-hidden="true" />
              <span className="hidden sm:inline">{t('auth.signOut')}</span>
            </button>
          </div>
        </div>

        {/* Mobile navigation row */}
        <nav
          aria-label="Mobile Primary"
          className="md:hidden border-t border-slate-100 px-4 flex items-center gap-4 overflow-x-auto"
        >
          {navItems.map((item) => {
            const active = location.pathname === item.to;
            return (
              <Link
                key={item.to}
                to={item.to}
                className={`text-sm font-medium whitespace-nowrap shrink-0 py-2.5 border-b-2 ${
                  active
                    ? 'border-teal-700 text-teal-800'
                    : 'border-transparent text-slate-600'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* Active clinic identity context strip (unboxed typographic metadata, zero pills) */}
      {workspace && (
        <div className="bg-white border-b border-slate-200">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-slate-900">{workspace.tenantName}</span>
              {workspace.legalEntityName && workspace.legalEntityName !== workspace.tenantName && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>{workspace.legalEntityName}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>{workspace.branchName}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular">{workspace.productMode}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular">{workspace.timezone}</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono-tabular">{workspace.currency}</span>
            </div>
            <div className="flex items-center gap-2">
              <span>{session?.user.displayName || session?.user.email}</span>
              <span aria-hidden="true">·</span>
              <span className="capitalize font-medium text-slate-800">{workspace.role}</span>
              {workspace.professionalGrants.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-medium text-teal-800">
                    {workspace.professionalGrants.map((g) => `${g.grantType} (${g.licenseNumber})`).join(', ')}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {children}
      </main>

      {helpOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="help-dialog-title"
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-xl max-w-lg w-full p-6 shadow-lg space-y-5">
            <div className="flex items-center justify-between gap-4">
              <h2 id="help-dialog-title" className="text-lg font-semibold text-slate-900">
                {t('help.title')}
              </h2>
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className="min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
                aria-label={t('help.close')}
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <p className="text-sm font-medium text-slate-700">{t('help.examplesTitle')}</p>
              <ul className="space-y-2 text-sm text-slate-700">
                {Array.isArray(examples) &&
                  examples.map((ex) => (
                    <li key={ex} className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
                      {ex}
                    </li>
                  ))}
              </ul>
            </div>

            <p className="text-xs text-slate-600 leading-relaxed">{t('help.boundaryNote')}</p>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setHelpOpen(false)}
                className="px-5 min-h-[44px] bg-teal-700 text-white text-sm font-medium rounded-lg hover:bg-teal-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
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
