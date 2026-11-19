import React, { useState } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient, ApiClientError } from '../lib/api-client.ts';
import type { ProductMode, SupportedLocale } from '../contracts/api.ts';

const PRODUCT_MODES: Array<{
  mode: ProductMode;
  labelEn: string;
  labelSi: string;
  descEn: string;
}> = [
  {
    mode: 'combo',
    labelEn: 'Clinic + Pharmacy Combo',
    labelSi: 'සායනය + ඖෂධහල (සම්පූර්ණ)',
    descEn: 'Appointments, collections, pharmacy catalogue, GRN receiving, lot stock & POS.',
  },
  {
    mode: 'clinic_only',
    labelEn: 'Clinic Only',
    labelSi: 'සායනය පමණි',
    descEn: 'Appointments, attendance, collections & daily reports without pharmacy stock.',
  },
  {
    mode: 'pharmacy_inventory_only',
    labelEn: 'Pharmacy Inventory Only',
    labelSi: 'ඖෂධ ගබඩා පමණි',
    descEn: 'SKU master, suppliers, GRN receiving, expiry/quarantine & lot balances.',
  },
  {
    mode: 'pharmacy_retail_only',
    labelEn: 'Pharmacy Retail Only',
    labelSi: 'ඖෂධහල් අලෙවිය',
    descEn: 'Retail dispensary & POS backed automatically by receiving & lot inventory.',
  },
];

export function OnboardingPage() {
  const { t, i18n } = useTranslation();
  const { session, changeLanguage, refetchSession, signOut } = useAuth();

  const [preferredLocale, setPreferredLocale] = useState<SupportedLocale>(
    (i18n.language === 'en-LK' ? 'en-LK' : 'si-LK') as SupportedLocale
  );
  const [productMode, setProductMode] = useState<ProductMode>('combo');
  const [clinicName, setClinicName] = useState('');
  const [legalEntityName, setLegalEntityName] = useState('');
  const [branchName, setBranchName] = useState('Main Branch');
  const [confirmRegion, setConfirmRegion] = useState(false);
  const [practitionerName, setPractitionerName] = useState('Dr. Perera');
  const [specialty, setSpecialty] = useState('General Practice');
  const [openingHours, setOpeningHours] = useState('08:30 - 17:30');
  const [serviceName, setServiceName] = useState('General Consultation');
  const [serviceNameSi, setServiceNameSi] = useState('සාමාන්‍ය වෛද්‍ය උපදේශනය');
  const [durationMinutes, setDurationMinutes] = useState(20);
  const [priceLkr, setPriceLkr] = useState(2500);
  const [includeSampleData, setIncludeSampleData] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const hasClinic = productMode === 'clinic_only' || productMode === 'combo';

  const handleLocaleSelect = async (loc: SupportedLocale) => {
    setPreferredLocale(loc);
    await changeLanguage(loc);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!confirmRegion) {
      setErrorMsg(
        preferredLocale === 'si-LK'
          ? 'කරුණාකර රට, වේලා කලාපය සහ මුදල් ඒකකය (LK / Asia/Colombo / LKR) තහවුරු කරන්න.'
          : 'Please confirm the country, timezone, and currency (LK / Asia/Colombo / LKR).'
      );
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      await apiClient.bootstrapOnboarding({
        preferredLocale,
        productMode,
        clinicName: clinicName.trim(),
        legalEntityName: legalEntityName.trim() || undefined,
        branchName: branchName.trim() || 'Main Branch',
        countryCode: 'LK',
        timezone: 'Asia/Colombo',
        currency: 'LKR',
        confirmLocaleAndCurrency: true,
        primaryPractitionerName: practitionerName.trim() || 'Primary Provider',
        primaryPractitionerSpecialty: specialty.trim() || 'General Practice',
        openingHoursSummary: openingHours.trim() || '08:30 - 17:30',
        services: hasClinic
          ? [
              {
                name: serviceName.trim(),
                nameSi: serviceNameSi.trim() || serviceName.trim(),
                durationMinutes: Number(durationMinutes),
                priceLkr: Number(priceLkr),
              },
            ]
          : [],
        includeSampleData: hasClinic ? includeSampleData : false,
      });
      await refetchSession();
    } catch (err) {
      if (err instanceof ApiClientError) {
        setErrorMsg(`${err.envelope.message} (${err.envelope.correlationId})`);
      } else {
        setErrorMsg('Unable to create workspace. Please check your details and retry.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen neon-canvas py-8 px-4 sm:px-6 text-slate-100">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <span className="font-display text-lg font-extrabold text-white">
            Suwa<span className="neon-text-cyan">Seva</span>
          </span>
          <button
            type="button"
            onClick={signOut}
            className="text-xs font-medium text-slate-300 hover:text-cyan-200 min-h-[40px] px-3 rounded-lg neon-btn-secondary"
          >
            {t('auth.signOut')} ({session?.user.email})
          </button>
        </div>

        <form onSubmit={handleSubmit} className="neon-card-glow rounded-2xl p-6 sm:p-8 space-y-6">
          <div className="space-y-2">
            <h1 className="font-display text-2xl font-bold neon-heading-glow">
              {t('onboarding.title')}
            </h1>
            <p className="text-sm text-cyan-100/75">{t('onboarding.subtitle')}</p>
          </div>

          {errorMsg && (
            <div
              role="alert"
              className="p-3 bg-rose-950/70 border border-rose-400/50 rounded-xl text-sm text-rose-200"
            >
              {errorMsg}
            </div>
          )}

          {/* 1. Language */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-cyan-100">{t('onboarding.languageLabel')}</legend>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleLocaleSelect('si-LK')}
                className={`min-h-[48px] px-4 rounded-xl border text-sm font-semibold text-left transition-all ${
                  preferredLocale === 'si-LK'
                    ? 'neon-card-glow neon-text-cyan'
                    : 'bg-[#040e22]/80 border-cyan-500/20 text-slate-300 hover:border-cyan-400/50'
                }`}
              >
                සිංහල (Sinhala)
              </button>
              <button
                type="button"
                onClick={() => handleLocaleSelect('en-LK')}
                className={`min-h-[48px] px-4 rounded-xl border text-sm font-semibold text-left transition-all ${
                  preferredLocale === 'en-LK'
                    ? 'neon-card-glow neon-text-cyan'
                    : 'bg-[#040e22]/80 border-cyan-500/20 text-slate-300 hover:border-cyan-400/50'
                }`}
              >
                English (Sri Lanka)
              </button>
            </div>
          </fieldset>

          {/* 2. Modular Product Package Mode */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-cyan-100">{t('onboarding.productModeLabel')}</legend>
            <div className="grid sm:grid-cols-2 gap-3">
              {PRODUCT_MODES.map((opt) => (
                <button
                  key={opt.mode}
                  type="button"
                  onClick={() => setProductMode(opt.mode)}
                  className={`p-3.5 rounded-xl border text-left transition-all space-y-1 ${
                    productMode === opt.mode
                      ? 'neon-card-glow'
                      : 'bg-[#040e22]/80 border-cyan-500/20 text-slate-300 hover:border-cyan-400/50'
                  }`}
                >
                  <div className={`text-sm font-semibold ${productMode === opt.mode ? 'neon-text-cyan' : 'text-white'}`}>
                    {preferredLocale === 'si-LK' ? opt.labelSi : opt.labelEn}
                  </div>
                  <div className="text-xs text-slate-300 leading-snug">{opt.descEn}</div>
                </button>
              ))}
            </div>
          </fieldset>

          {/* 3. Organization, Legal Entity & Branch */}
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-cyan-100">{t('onboarding.clinicNameLabel')} *</span>
              <input
                required
                minLength={2}
                value={clinicName}
                onChange={(e) => setClinicName(e.target.value)}
                placeholder="e.g. Suwa Medical & Pharmacy"
                className="w-full min-h-[44px] px-3 rounded-lg text-sm neon-input"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-cyan-100">{t('onboarding.branchNameLabel')} *</span>
              <input
                required
                minLength={2}
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                className="w-full min-h-[44px] px-3 rounded-lg text-sm neon-input"
              />
            </label>
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-sm font-medium text-cyan-100">{t('onboarding.legalEntityLabel')}</span>
              <input
                value={legalEntityName}
                onChange={(e) => setLegalEntityName(e.target.value)}
                placeholder="Defaults to Business Name if left blank"
                className="w-full min-h-[44px] px-3 rounded-lg text-sm neon-input"
              />
            </label>
          </div>

          {/* 4. Explicit Country / Timezone / Currency Confirmation */}
          <div className="p-4 bg-[#040e22]/90 border border-cyan-500/25 rounded-xl space-y-3">
            <p className="text-xs font-mono-tabular text-cyan-300">{t('onboarding.countryRegionBox')}</p>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmRegion}
                onChange={(e) => setConfirmRegion(e.target.checked)}
                className="mt-1 w-4 h-4 accent-cyan-400"
              />
              <span className="text-sm text-slate-200">{t('onboarding.confirmRegionCheck')}</span>
            </label>
          </div>

          {/* 5. Clinic Practitioner & Primary Service */}
          {hasClinic && (
            <>
              <div className="grid sm:grid-cols-3 gap-4">
                <label className="block space-y-1.5 sm:col-span-1">
                  <span className="text-sm font-medium text-cyan-100">{t('onboarding.practitionerLabel')} *</span>
                  <input
                    required
                    minLength={2}
                    value={practitionerName}
                    onChange={(e) => setPractitionerName(e.target.value)}
                    placeholder="Dr. Perera"
                    className="w-full min-h-[44px] px-3 rounded-lg text-sm neon-input"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-cyan-100">{t('onboarding.specialtyLabel')}</span>
                  <input
                    value={specialty}
                    onChange={(e) => setSpecialty(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-lg text-sm neon-input"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-cyan-100">{t('onboarding.hoursLabel')}</span>
                  <input
                    value={openingHours}
                    onChange={(e) => setOpeningHours(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                  />
                </label>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-cyan-100">{t('onboarding.serviceNameLabel')} *</span>
                  <input
                    required
                    value={serviceName}
                    onChange={(e) => setServiceName(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-lg text-sm neon-input"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-cyan-100">{t('onboarding.serviceNameSiLabel')}</span>
                  <input
                    value={serviceNameSi}
                    onChange={(e) => setServiceNameSi(e.target.value)}
                    className="w-full min-h-[44px] px-3 rounded-lg text-sm neon-input"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-cyan-100">{t('onboarding.durationLabel')} *</span>
                  <input
                    type="number"
                    min={5}
                    max={240}
                    required
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                    className="w-full min-h-[44px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-cyan-100">{t('onboarding.priceLabel')} *</span>
                  <input
                    type="number"
                    min={0}
                    step="50"
                    required
                    value={priceLkr}
                    onChange={(e) => setPriceLkr(Number(e.target.value))}
                    className="w-full min-h-[44px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                  />
                </label>
              </div>

              <label className="flex items-start gap-3 p-4 bg-[#040e22]/90 border border-cyan-500/20 rounded-xl cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeSampleData}
                  onChange={(e) => setIncludeSampleData(e.target.checked)}
                  className="mt-1 w-4 h-4 accent-cyan-400"
                />
                <span className="text-sm text-slate-200">{t('onboarding.sampleToggle')}</span>
              </label>
            </>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[48px] px-5 rounded-xl neon-btn-primary inline-flex items-center justify-center gap-2 disabled:opacity-60"
          >
            <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
            <span>{submitting ? t('onboarding.submitting') : t('onboarding.submitButton')}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
