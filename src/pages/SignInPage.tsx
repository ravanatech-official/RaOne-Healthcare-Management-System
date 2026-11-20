import React, { useState } from 'react';
import { ArrowRight, CheckCircle2, Eye, EyeOff, Lock, Mail, Sparkles, User } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.tsx';
import type { SupportedLocale } from '../contracts/api.ts';

function GoogleLogoSvg() {
  return (
    <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M12 10.2v3.9h5.5c-.24 1.25-.96 2.3-2.05 3.01l3.31 2.57c1.93-1.78 3.04-4.4 3.04-7.5 0-.72-.06-1.41-.19-2.08H12z"
      />
      <path
        fill="#4285F4"
        d="M12 22c2.75 0 5.06-.91 6.75-2.46l-3.31-2.57c-.91.61-2.08.98-3.44.98-2.64 0-4.88-1.78-5.68-4.18H2.9v2.63C4.58 19.74 8.02 22 12 22z"
      />
      <path
        fill="#FBBC05"
        d="M6.32 13.77A5.97 5.97 0 0 1 6 12c0-.61.11-1.21.32-1.77V7.6H2.9A9.97 9.97 0 0 0 2 12c0 1.61.39 3.14 1.08 4.4l3.24-2.63z"
      />
      <path
        fill="#34A853"
        d="M12 6.05c1.5 0 2.84.52 3.9 1.53l2.92-2.92C17.05 3.01 14.74 2 12 2 8.02 2 4.58 4.26 2.9 7.6l3.42 2.63c.8-2.4 3.04-4.18 5.68-4.18z"
      />
    </svg>
  );
}

export function SignInPage({ mode = 'signin' }: { mode?: 'signin' | 'locked' }) {
  const { t, i18n } = useTranslation();
  const {
    signInWithGoogle,
    signInWithEmail,
    signUpWithEmail,
    resetPassword,
    unlockWithGoogle,
    unlockWithShiftPin,
    signOut,
    changeLanguage,
  } = useAuth();

  const [authTab, setAuthTab] = useState<'signin' | 'signup'>('signin');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  const [busy, setBusy] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const currentLocale = (i18n.language === 'en-LK' ? 'en-LK' : 'si-LK') as SupportedLocale;
  const isSinhala = currentLocale === 'si-LK';

  const handleGoogleAuth = async () => {
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      if (mode === 'locked') {
        await unlockWithGoogle();
      } else {
        await signInWithGoogle(rememberMe);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Google authentication failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrorMsg(null);
    setInfoMsg(null);
    try {
      if (authTab === 'signup') {
        if (password.length < 6) {
          throw new Error('Password must be at least 6 characters.');
        }
        await signUpWithEmail(email, password, fullName, rememberMe);
      } else {
        await signInWithEmail(email, password, rememberMe);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message.replace(/^Firebase:\s*/i, '')
          : 'Unable to authenticate with email and password.'
      );
    } finally {
      setBusy(false);
    }
  };

  const handleForgotPassword = async () => {
    setErrorMsg(null);
    setInfoMsg(null);
    if (!email.trim()) {
      setErrorMsg(
        isSinhala
          ? 'මුරපදය නැවත සැකසීමට කරුණාකර ඉහත Email ලිපිනය ඇතුළත් කරන්න.'
          : 'Enter your email address above first, then click Forgot?.'
      );
      return;
    }
    setBusy(true);
    try {
      await resetPassword(email);
      setInfoMsg(
        isSinhala
          ? `${email.trim()} වෙත මුරපදය නැවත සැකසීමේ සබැඳිය යවන ලදී.`
          : `Password reset instructions sent to ${email.trim()}.`
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message.replace(/^Firebase:\s*/i, '') : 'Unable to send reset email.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen neon-canvas text-slate-100 flex flex-col justify-between p-4 sm:p-8 relative overflow-hidden">
      {/* Top Bar */}
      <header className="max-w-5xl w-full mx-auto flex flex-wrap items-center justify-between gap-4 relative z-10 animate-auth-reveal">
        <div className="inline-flex items-center gap-3 px-4 py-2 rounded-2xl border border-cyan-400/35 bg-[#06132b]/85 shadow-[0_0_24px_-6px_rgba(34,211,238,0.4)]">
          <Sparkles className="w-5 h-5 text-cyan-300" aria-hidden="true" />
          <div className="flex items-baseline gap-2.5">
            <span className="font-display text-lg font-extrabold tracking-tight text-white">
              {t('brand')}
            </span>
            <span className="text-xs font-semibold neon-text-cyan hidden sm:inline">
              Clinic &amp; Pharmacy OS
            </span>
          </div>
        </div>

        <div
          role="group"
          aria-label="Language"
          className="flex items-center p-1 bg-[#071530]/90 border border-cyan-500/25 rounded-xl"
        >
          <button
            type="button"
            onClick={() => changeLanguage('si-LK')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-all ${
              currentLocale === 'si-LK'
                ? 'bg-cyan-400 text-[#021324] shadow-[0_0_14px_rgba(34,211,238,0.6)]'
                : 'text-slate-300 hover:text-cyan-200'
            }`}
          >
            සිංහල
          </button>
          <button
            type="button"
            onClick={() => changeLanguage('en-LK')}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg whitespace-nowrap transition-all ${
              currentLocale === 'en-LK'
                ? 'bg-cyan-400 text-[#021324] shadow-[0_0_14px_rgba(34,211,238,0.6)]'
                : 'text-slate-300 hover:text-cyan-200'
            }`}
          >
            English
          </button>
        </div>
      </header>

      {/* Centered Neon Glass Auth Card */}
      <main className="max-w-md w-full mx-auto my-8 relative z-10 animate-auth-reveal">
        <div className="neon-card-glow rounded-3xl p-6 sm:p-8 space-y-5">
          <div className="space-y-1.5">
            {mode === 'locked' && (
              <div className="inline-flex items-center gap-2 text-amber-300 text-xs font-semibold">
                <Lock className="w-4 h-4" aria-hidden="true" />
                <span>{t('auth.lockDevice')}</span>
              </div>
            )}
            <h1 className="font-display text-3xl font-extrabold tracking-tight neon-heading-glow">
              {mode === 'locked'
                ? t('auth.lockedTitle')
                : authTab === 'signup'
                  ? t('auth.signUpTitle')
                  : t('auth.signInTitle')}
            </h1>
            <p className="text-sm text-cyan-100/75">
              {mode === 'locked' ? t('auth.lockedDesc') : t('auth.signInSubtitle')}
            </p>
          </div>

          {mode !== 'locked' && (
            <div
              role="tablist"
              aria-label="Authentication mode"
              className="grid grid-cols-2 p-1 rounded-full bg-[#040d1e] border border-cyan-500/25"
            >
              <button
                type="button"
                role="tab"
                aria-selected={authTab === 'signin'}
                onClick={() => {
                  setAuthTab('signin');
                  setErrorMsg(null);
                  setInfoMsg(null);
                }}
                className={`py-2.5 text-sm font-bold rounded-full transition-all ${
                  authTab === 'signin'
                    ? 'bg-cyan-400 text-[#021324] shadow-[0_0_18px_rgba(34,211,238,0.65)]'
                    : 'text-slate-300 hover:text-cyan-200'
                }`}
              >
                {isSinhala ? 'ඇතුළු වන්න' : 'Sign In'}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={authTab === 'signup'}
                onClick={() => {
                  setAuthTab('signup');
                  setErrorMsg(null);
                  setInfoMsg(null);
                }}
                className={`py-2.5 text-sm font-bold rounded-full transition-all ${
                  authTab === 'signup'
                    ? 'bg-cyan-400 text-[#021324] shadow-[0_0_18px_rgba(34,211,238,0.65)]'
                    : 'text-slate-300 hover:text-cyan-200'
                }`}
              >
                {isSinhala ? 'ලියාපදිංචිය' : 'Sign Up'}
              </button>
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              className="p-3 bg-rose-950/70 border border-rose-400/50 rounded-xl text-xs sm:text-sm text-rose-200"
            >
              {errorMsg}
            </div>
          )}
          {infoMsg && (
            <div className="p-3 bg-cyan-950/70 border border-cyan-400/50 rounded-xl text-xs sm:text-sm text-cyan-200 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-cyan-300 shrink-0" aria-hidden="true" />
              <span>{infoMsg}</span>
            </div>
          )}

          {mode === 'locked' ? (
            <div className="space-y-4">
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!pinInput.trim()) return;
                  setBusy(true);
                  setErrorMsg(null);
                  try {
                    await unlockWithShiftPin(pinInput.trim());
                    setPinInput('');
                  } catch (err) {
                    setErrorMsg(err instanceof Error ? err.message : 'Invalid Shift PIN.');
                  } finally {
                    setBusy(false);
                  }
                }}
                className="flex gap-2"
              >
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder={t('auth.pinPlaceholder')}
                  className="flex-1 min-h-[46px] px-4 rounded-xl text-sm font-mono-tabular neon-input"
                />
                <button
                  type="submit"
                  disabled={busy || pinInput.length < 4}
                  className="min-h-[46px] px-5 rounded-xl text-xs font-bold neon-btn-primary disabled:opacity-50 whitespace-nowrap"
                >
                  {t('auth.unlockPinBtn')}
                </button>
              </form>

              <button
                type="button"
                disabled={busy}
                onClick={handleGoogleAuth}
                className="w-full min-h-[46px] px-5 rounded-full neon-btn-primary inline-flex items-center justify-center gap-2.5 text-sm"
              >
                <GoogleLogoSvg />
                <span>{busy ? t('auth.signingIn') : t('auth.unlockButton')}</span>
              </button>

              <button
                type="button"
                onClick={signOut}
                className="w-full min-h-[42px] px-4 rounded-full neon-btn-secondary text-sm font-medium"
              >
                {t('auth.signOut')}
              </button>
            </div>
          ) : (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              {authTab === 'signup' && (
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-cyan-100/85">
                    {isSinhala ? 'සම්පූර්ණ නම' : 'Full Name'}
                  </span>
                  <div className="relative">
                    <User
                      className="w-4 h-4 text-cyan-400/80 absolute left-3.5 top-1/2 -translate-y-1/2"
                      aria-hidden="true"
                    />
                    <input
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      placeholder="Dr. Kasun Perera"
                      className="w-full min-h-[46px] pl-10 pr-4 rounded-xl text-sm neon-input"
                    />
                  </div>
                </label>
              )}

              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-cyan-100/85">
                  {isSinhala ? 'ඊමේල් ලිපිනය (Email)' : 'Work Email'}
                </span>
                <div className="relative">
                  <Mail
                    className="w-4 h-4 text-cyan-400/80 absolute left-3.5 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    required
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="owner@suwaseva.lk"
                    className="w-full min-h-[46px] pl-10 pr-4 rounded-xl text-sm neon-input"
                  />
                </div>
              </label>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-cyan-100/85">
                    {isSinhala ? 'මුරපදය (Password)' : 'Password'}
                  </span>
                  {authTab === 'signin' && (
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      disabled={busy}
                      className="text-xs font-semibold neon-text-cyan hover:underline"
                    >
                      {isSinhala ? 'මතක නැද්ද?' : 'Forgot?'}
                    </button>
                  )}
                </div>
                <div className="relative">
                  <Lock
                    className="w-4 h-4 text-cyan-400/80 absolute left-3.5 top-1/2 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    required
                    type={showPassword ? 'text' : 'password'}
                    autoComplete={authTab === 'signup' ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full min-h-[46px] pl-10 pr-11 rounded-xl text-sm neon-input"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((prev) => !prev)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-slate-400 hover:text-cyan-300 rounded-lg"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <label className="flex items-center gap-2.5 text-xs text-cyan-100/80 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded accent-cyan-400"
                />
                <span>{isSinhala ? 'මාව මතක තබා ගන්න (Remember me)' : 'Remember me'}</span>
              </label>

              <button
                type="submit"
                disabled={busy}
                className="w-full min-h-[48px] px-5 rounded-full neon-btn-primary text-sm inline-flex items-center justify-center gap-2 disabled:opacity-60"
              >
                <span>
                  {busy
                    ? t('auth.signingIn')
                    : authTab === 'signup'
                      ? t('auth.signUpButton')
                      : t('auth.signInButton')}
                </span>
                <ArrowRight className="w-4 h-4" aria-hidden="true" />
              </button>

              <div className="relative py-2 flex items-center">
                <div className="flex-grow border-t border-cyan-500/20" />
                <span className="shrink mx-3 text-[11px] font-semibold tracking-wider uppercase text-slate-400">
                  {isSinhala ? 'හෝ' : 'OR CONTINUE WITH'}
                </span>
                <div className="flex-grow border-t border-cyan-500/20" />
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={handleGoogleAuth}
                className="w-full min-h-[46px] px-5 rounded-xl neon-btn-secondary text-sm font-semibold inline-flex items-center justify-center gap-3 disabled:opacity-60"
              >
                <GoogleLogoSvg />
                <span>{isSinhala ? 'Google ගිණුමෙන් පිවිසෙන්න' : 'Continue with Google'}</span>
              </button>
            </form>
          )}
        </div>
      </main>

      <footer className="max-w-5xl w-full mx-auto text-xs text-slate-400 flex flex-wrap justify-between gap-2 border-t border-cyan-500/15 pt-4 relative z-10 animate-auth-reveal">
        <span>
          <span className="font-semibold text-white">Suwa</span>
          <span className="font-semibold neon-text-cyan">Seva</span> · Sri Lanka Healthcare OS
        </span>
        <span className="font-mono-tabular">Asia/Colombo · LKR · Administrative ERP</span>
      </footer>
    </div>
  );
}
