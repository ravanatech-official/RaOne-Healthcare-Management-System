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
    <div className="min-h-screen bg-slate-50 py-8 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <span className="font-display text-lg font-bold text-slate-900">{t('brand')}</span>
          <button
            type="button"
            onClick={signOut}
            className="text-xs font-medium text-slate-600 hover:text-slate-900 min-h-[40px] px-3"
          >
            {t('auth.signOut')} ({session?.user.email})
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6"
        >
          <div className="space-y-2">
            <h1 className="font-display text-2xl font-bold text-slate-900">{t('onboarding.title')}</h1>
            <p className="text-sm text-slate-600">{t('onboarding.subtitle')}</p>
          </div>

          {errorMsg && (
            <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
              {errorMsg}
            </div>
          )}

          {/* 1. Language */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-900">{t('onboarding.languageLabel')}</legend>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleLocaleSelect('si-LK')}
                className={`min-h-[48px] px-4 rounded-lg border text-sm font-medium text-left transition-colors ${
                  preferredLocale === 'si-LK'
                    ? 'border-teal-700 bg-teal-50 text-teal-900'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                සිංහල (Sinhala)
              </button>
              <button
                type="button"
                onClick={() => handleLocaleSelect('en-LK')}
                className={`min-h-[48px] px-4 rounded-lg border text-sm font-medium text-left transition-colors ${
                  preferredLocale === 'en-LK'
                    ? 'border-teal-700 bg-teal-50 text-teal-900'
                    : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                }`}
              >
                English (Sri Lanka)
              </button>
            </div>
          </fieldset>

          {/* 2. Modular Product Package Mode */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium text-slate-900">{t('onboarding.productModeLabel')}</legend>
            <div className="grid sm:grid-cols-2 gap-3">
              {PRODUCT_MODES.map((opt) => (
                <button
                  key={opt.mode}
                  type="button"
                  onClick={() => setProductMode(opt.mode)}
                  className={`p-3.5 rounded-lg border text-left transition-colors space-y-1 ${
                    productMode === opt.mode
                      ? 'border-teal-700 bg-teal-50 text-teal-950'
                      : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  <div className="text-sm font-semibold">
                    {preferredLocale === 'si-LK' ? opt.labelSi : opt.labelEn}
                  </div>
                  <div className="text-xs text-slate-600 leading-snug">{opt.descEn}</div>
                </button>
              ))}
            </div>
          </fieldset>

          {/* 3. Organization, Legal Entity & Branch */}
          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-900">{t('onboarding.clinicNameLabel')} *</span>
              <input
                required
                minLength={2}
                value={clinicName}
                onChange={(e) => setClinicName(e.target.value)}
                placeholder="e.g. Suwa Medical & Pharmacy"
                className="w-full min-h-[44px] px-3 bg-white border border-slate-300 rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-sm font-medium text-slate-900">{t('onboarding.branchNameLabel')} *</span>
              <input
                required
                minLength={2}
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                className="w-full min-h-[44px] px-3 bg-white border border-slate-300 rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
              />
            </label>
            <label className="block space-y-1.5 sm:col-span-2">
              <span className="text-sm font-medium text-slate-900">{t('onboarding.legalEntityLabel')}</span>
              <input
                value={legalEntityName}
                onChange={(e) => setLegalEntityName(e.target.value)}
                placeholder="Defaults to Business Name if left blank"
                className="w-full min-h-[44px] px-3 bg-white border border-slate-300 rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
              />
            </label>
          </div>

          {/* 4. Explicit Country / Timezone / Currency Confirmation */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-3">
            <p className="text-xs font-mono-tabular text-slate-700">{t('onboarding.countryRegionBox')}</p>
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmRegion}
                onChange={(e) => setConfirmRegion(e.target.checked)}
                className="mt-1 w-4 h-4 accent-teal-700"
              />
              <span className="text-sm text-slate-800">{t('onboarding.confirmRegionCheck')}</span>
            </label>
          </div>

          {/* 5. Clinic Practitioner & Primary Service (shown only when Clinic module enabled) */}
          {hasClinic && (
            <>
              <div className="grid sm:grid-cols-3 gap-4">
                <label className="block space-y-1.5 sm:col-span-1">
                  <span className="text-sm font-medium text-slate-900">{t('onboarding.practitionerLabel')} *</span>
                  <input
                    required
                    minLength={2}
                    value={practitionerName}
                    onChange={(e) => setPractitionerName(e.target.value)}
                    placeholder="Dr. Perera"
                    className="w-full min-h-[44px] px-3 bg-white border border-slate-300 rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-900">{t('onboarding.specialtyLabel')}</span>
                  <input
                    value={specialty}
                    onChange={(e) => setSpecialty(e.target.value)}
                    className="w-full min-h-[44px] px-3 bg-white border border-slate-300 rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-900">{t('onboarding.hoursLabel')}</span>
                  <input
                    value={openingHours}
                    onChange={(e) => setOpeningHours(e.target.value)}
                    className="w-full min-h-[44px] px-3 bg-white border border-slate-300 rounded-lg text-sm font-mono-tabular focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
                  />
                </label>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-900">{t('onboarding.serviceNameLabel')} *</span>
                  <input
                    required
                    value={serviceName}
                    onChange={(e) => setServiceName(e.target.value)}
                    className="w-full min-h-[44px] px-3 bg-white border border-slate-300 rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-900">{t('onboarding.serviceNameSiLabel')}</span>
                  <input
                    value={serviceNameSi}
                    onChange={(e) => setServiceNameSi(e.target.value)}
                    className="w-full min-h-[44px] px-3 bg-white border border-slate-300 rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-900">{t('onboarding.durationLabel')} *</span>
                  <input
                    type="number"
                    min={5}
                    max={240}
                    required
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(Number(e.target.value))}
                    className="w-full min-h-[44px] px-3 bg-white border border-slate-300 rounded-lg text-sm font-mono-tabular focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
                  />
                </label>
                <label className="block space-y-1.5">
                  <span className="text-sm font-medium text-slate-900">{t('onboarding.priceLabel')} *</span>
                  <input
                    type="number"
                    min={0}
                    step="50"
                    required
                    value={priceLkr}
                    onChange={(e) => setPriceLkr(Number(e.target.value))}
                    className="w-full min-h-[44px] px-3 bg-white border border-slate-300 rounded-lg text-sm font-mono-tabular focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
                  />
                </label>
              </div>

              <label className="flex items-start gap-3 p-4 bg-slate-50 border border-slate-200 rounded-lg cursor-pointer">
                <input
                  type="checkbox"
                  checked={includeSampleData}
                  onChange={(e) => setIncludeSampleData(e.target.checked)}
                  className="mt-1 w-4 h-4 accent-teal-700"
                />
                <span className="text-sm text-slate-800">{t('onboarding.sampleToggle')}</span>
              </label>
            </>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full min-h-[48px] px-5 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white font-medium rounded-lg inline-flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
          >
            <CheckCircle2 className="w-5 h-5" aria-hidden="true" />
            <span>{submitting ? t('onboarding.submitting') : t('onboarding.submitButton')}</span>
          </button>
        </form>
      </div>
    </div>
  );
}
