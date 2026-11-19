import { useState } from 'react';
import { Lock, LogIn } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.tsx';
import type { SupportedLocale } from '../contracts/api.ts';

export function SignInPage({ mode = 'signin' }: { mode?: 'signin' | 'locked' }) {
  const { t, i18n } = useTranslation();
  const { signInWithGoogle, unlockWithGoogle, signOut, changeLanguage } = useAuth();
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const currentLocale = (i18n.language === 'en-LK' ? 'en-LK' : 'si-LK') as SupportedLocale;

  const handleAuth = async () => {
    setBusy(true);
    setErrorMsg(null);
    try {
      if (mode === 'locked') {
        await unlockWithGoogle();
      } else {
        await signInWithGoogle();
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Sign-in could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col justify-between p-4 sm:p-8">
      <div className="max-w-5xl w-full mx-auto flex items-center justify-between">
        <span className="font-display text-xl font-bold text-slate-900">{t('brand')}</span>
        <div role="group" aria-label="Language" className="flex items-center p-1 bg-slate-200/70 rounded-lg">
          <button
            type="button"
            onClick={() => changeLanguage('si-LK')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              currentLocale === 'si-LK' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-700'
            }`}
          >
            සිංහල
          </button>
          <button
            type="button"
            onClick={() => changeLanguage('en-LK')}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap ${
              currentLocale === 'en-LK' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-700'
            }`}
          >
            English
          </button>
        </div>
      </div>

      <main className="max-w-lg w-full mx-auto my-12 bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
        <div className="space-y-3">
          {mode === 'locked' && (
            <div className="inline-flex items-center gap-2 text-amber-700 text-sm font-medium">
              <Lock className="w-4 h-4" aria-hidden="true" />
              <span>{t('auth.lockDevice')}</span>
            </div>
          )}
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 text-balance leading-tight">
            {mode === 'locked' ? t('auth.lockedTitle') : t('auth.signInTitle')}
          </h1>
          <p className="text-sm sm:text-base text-slate-600 leading-relaxed">
            {mode === 'locked' ? t('auth.lockedDesc') : t('auth.signInSubtitle')}
          </p>
        </div>

        {errorMsg && (
          <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
            {errorMsg}
          </div>
        )}

        <div className="space-y-3">
          <button
            type="button"
            disabled={busy}
            onClick={handleAuth}
            className="w-full min-h-[48px] px-5 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white font-medium rounded-lg inline-flex items-center justify-center gap-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
          >
            <LogIn className="w-5 h-5" aria-hidden="true" />
            <span>
              {busy
                ? t('auth.signingIn')
                : mode === 'locked'
                  ? t('auth.unlockButton')
                  : t('auth.signInButton')}
            </span>
          </button>

          {mode === 'locked' && (
            <button
              type="button"
              onClick={signOut}
              className="w-full min-h-[44px] px-4 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 text-sm font-medium rounded-lg"
            >
              {t('auth.signOut')}
            </button>
          )}
        </div>

        <p className="text-xs text-slate-500 pt-2 border-t border-slate-100">
          Sri Lanka Clinic Pilot · Asia/Colombo · LKR · Administrative operations only
        </p>
      </main>

      <footer className="max-w-5xl w-full mx-auto text-xs text-slate-500 flex justify-between">
        <span>{t('brand')}</span>
        <span>v1 Pilot Workspace</span>
      </footer>
    </div>
  );
}
