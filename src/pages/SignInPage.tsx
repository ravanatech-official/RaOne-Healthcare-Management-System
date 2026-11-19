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

function InteractiveDeskLamp({
  lampOn,
  cordPulling,
  onToggle,
}: {
  lampOn: boolean;
  cordPulling: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="relative flex flex-col items-center select-none">
      {/* Ambient aura behind the lamp when ON */}
      <div
        className={`pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 w-80 h-80 rounded-full blur-3xl transition-opacity duration-500 ${
          lampOn ? 'opacity-65 bg-cyan-400/25' : 'opacity-10 bg-sky-900/20'
        }`}
      />

      <svg
        viewBox="0 0 380 390"
        className="w-full max-w-[340px] sm:max-w-[380px] h-auto overflow-visible"
        role="img"
        aria-label={lampOn ? 'Desk lamp illuminated' : 'Desk lamp switched off'}
      >
        <defs>
          <linearGradient id="lampBeam" x1="42%" y1="32%" x2="95%" y2="95%">
            <stop offset="0%" stopColor="#4ef2ff" stopOpacity="0.48" />
            <stop offset="45%" stopColor="#22d3ee" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="lampShadeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1e355c" />
            <stop offset="55%" stopColor="#0c182f" />
            <stop offset="100%" stopColor="#060d1c" />
          </linearGradient>
          <linearGradient id="lampArmGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#1c3156" />
            <stop offset="60%" stopColor="#0a162b" />
            <stop offset="100%" stopColor="#050b18" />
          </linearGradient>
          <radialGradient id="bulbGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="45%" stopColor="#a5f3fc" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Volumetric Cyan Light Beam cast diagonally onto the Auth Card */}
        <polygon
          points="154,158 258,136 470,355 215,390"
          fill="url(#lampBeam)"
          className={`transition-opacity duration-500 ${lampOn ? 'opacity-100' : 'opacity-0'}`}
        />

        {/* Floor shadow under base */}
        <ellipse cx="118" cy="358" rx="82" ry="12" fill="rgba(0,0,0,0.65)" />

        {/* Metallic Dark Navy Base */}
        <ellipse
          cx="118"
          cy="348"
          rx="66"
          ry="14"
          fill="#071022"
          stroke={lampOn ? 'rgba(34,211,238,0.45)' : 'rgba(148,163,184,0.2)'}
          strokeWidth="1.5"
        />
        <path d="M56 346 C56 332, 180 332, 180 346 L176 352 C176 361, 60 361, 60 352 Z" fill="#0d1b36" />
        <ellipse cx="118" cy="340" rx="52" ry="9" fill="#172c52" />

        {/* Lower Arm */}
        <path
          d="M114 334 L82 212 L96 208 L128 332 Z"
          fill="url(#lampArmGrad)"
          stroke="rgba(56,189,248,0.2)"
          strokeWidth="1"
        />
        {/* Upper Arm */}
        <path
          d="M84 205 L162 128 L171 137 L94 214 Z"
          fill="url(#lampArmGrad)"
          stroke="rgba(56,189,248,0.2)"
          strokeWidth="1"
        />

        {/* Golden-Amber Articulated Pivot Joints */}
        <g>
          <circle cx="118" cy="330" r="14" fill="#d97706" stroke="#fde68a" strokeWidth="1.5" />
          <circle cx="118" cy="330" r="6" fill="#fef08a" />
          <circle cx="88" cy="210" r="13" fill="#d97706" stroke="#fde68a" strokeWidth="1.5" />
          <circle cx="88" cy="210" r="5" fill="#fef08a" />
          <circle cx="168" cy="130" r="9" fill="#d97706" stroke="#fde68a" strokeWidth="1.2" />
        </g>

        {/* Clickable Lamp Head & Hood */}
        <g
          onClick={onToggle}
          className="cursor-pointer group"
          role="button"
          tabIndex={0}
          aria-label="Toggle lamp power"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggle();
            }
          }}
        >
          {/* Inner glowing cyan hood cavity */}
          <ellipse
            cx="206"
            cy="148"
            rx="58"
            ry="20"
            transform="rotate(-14 206 148)"
            fill={lampOn ? '#164e63' : '#081122'}
            stroke="#fbbf24"
            strokeWidth="2.5"
          />
          {lampOn && (
            <ellipse
              cx="206"
              cy="148"
              rx="50"
              ry="15"
              transform="rotate(-14 206 148)"
              fill="#22d3ee"
              opacity="0.72"
            />
          )}

          {/* Outer Lamp Dome */}
          <path
            d="M144 156 C140 82, 232 54, 260 128 C236 142, 180 156, 144 156 Z"
            fill="url(#lampShadeGrad)"
            stroke={lampOn ? 'rgba(78,242,255,0.55)' : 'rgba(148,163,184,0.22)'}
            strokeWidth="1.5"
          />

          {/* Glowing Bulb */}
          <circle
            cx="204"
            cy="148"
            r={lampOn ? 24 : 11}
            fill={lampOn ? 'url(#bulbGlow)' : '#1e293b'}
            className="transition-all duration-300"
          />
          <circle
            cx="204"
            cy="148"
            r="9"
            fill={lampOn ? '#ffffff' : '#334155'}
          />
        </g>

        {/* Interactive Dangling Pull-Cord + Glowing Gold/Cyan Knob */}
        <g
          onClick={onToggle}
          className={`cursor-pointer ${cordPulling ? 'animate-cord-pull' : ''}`}
          role="button"
          tabIndex={0}
          aria-label="Pull lamp cord"
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              onToggle();
            }
          }}
        >
          <rect x="192" y="156" width="24" height="106" fill="transparent" />
          <line
            x1="204"
            y1="156"
            x2="204"
            y2="246"
            stroke={lampOn ? '#a5f3fc' : '#64748b'}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <path
            d="M198 245 L210 245 L213 262 C213 266, 195 266, 195 262 Z"
            fill={lampOn ? '#fbbf24' : '#475569'}
            stroke={lampOn ? '#fef3c7' : '#94a3b8'}
            strokeWidth="1.2"
          />
          {lampOn && (
            <circle cx="204" cy="254" r="14" fill="rgba(251,191,36,0.28)" />
          )}
        </g>
      </svg>

      <button
        type="button"
        onClick={onToggle}
        className="mt-1 px-3.5 py-1.5 rounded-full text-xs font-medium border border-cyan-400/30 bg-cyan-950/40 text-cyan-200 hover:border-cyan-300/60 hover:bg-cyan-900/40 transition-colors"
      >
        {lampOn ? 'Lamp: ON (Click cord to dim)' : 'Lamp: OFF (Click cord to illuminate)'}
      </button>
    </div>
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

  const [lampOn, setLampOn] = useState(true);
  const [cordPulling, setCordPulling] = useState(false);
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

  const handleToggleLamp = () => {
    setCordPulling(true);
    setLampOn((prev) => !prev);
    window.setTimeout(() => setCordPulling(false), 450);
  };

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
      <header className="max-w-6xl w-full mx-auto flex flex-wrap items-center justify-between gap-4 relative z-10">
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

      {/* Main Split Stage: Interactive Lamp Left + Neon Glass Auth Card Right */}
      <main className="max-w-5xl w-full mx-auto my-8 grid lg:grid-cols-12 gap-8 lg:gap-10 items-center relative z-10">
        {/* Left: Interactive Desk Lamp */}
        <section className="lg:col-span-6 flex flex-col items-center justify-center space-y-3">
          <InteractiveDeskLamp
            lampOn={lampOn}
            cordPulling={cordPulling}
            onToggle={handleToggleLamp}
          />
          <p className="text-xs text-cyan-200/70 text-center max-w-xs">{t('auth.lampHint')}</p>
        </section>

        {/* Right: Glowing Translucent Navy Auth Card */}
        <section className="lg:col-span-6">
          <div
            className={`rounded-3xl p-6 sm:p-8 space-y-5 transition-all duration-500 ${
              lampOn
                ? 'neon-card-glow opacity-100'
                : 'bg-[#050e20]/85 border border-slate-800/80 shadow-xl opacity-80'
            }`}
          >
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
        </section>
      </main>

      <footer className="max-w-5xl w-full mx-auto text-xs text-slate-400 flex flex-wrap justify-between gap-2 border-t border-cyan-500/15 pt-4 relative z-10">
        <span>
          <span className="font-semibold text-white">Suwa</span>
          <span className="font-semibold neon-text-cyan">Seva</span> · Sri Lanka Healthcare OS
        </span>
        <span className="font-mono-tabular">Asia/Colombo · LKR · Administrative ERP</span>
      </footer>
    </div>
  );
}
