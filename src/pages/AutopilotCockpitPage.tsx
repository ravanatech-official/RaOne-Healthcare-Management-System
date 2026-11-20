import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  PackagePlus,
  QrCode,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type {
  AutopilotCockpitResponse,
  ShiftChecklistRunView,
} from '../contracts/api.ts';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient, formatLkrMinor } from '../lib/api-client.ts';

function ChecklistPanel({
  title,
  checklist,
  isSi,
  busyKey,
  onToggle,
  onComplete,
}: {
  title: string;
  checklist: ShiftChecklistRunView;
  isSi: boolean;
  busyKey: string | null;
  onToggle: (checklistId: string, itemKey: string, completed: boolean) => Promise<void>;
  onComplete: (
    checklistId: string,
    handoverNotes: string,
    cashDrawerCountLkr?: number
  ) => Promise<void>;
}) {
  const [notes, setNotes] = useState(checklist.handoverNotes || '');
  const [cashLkr, setCashLkr] = useState(
    checklist.cashDrawerCountMinor !== null
      ? String((checklist.cashDrawerCountMinor / 100).toFixed(2))
      : ''
  );

  useEffect(() => {
    setNotes(checklist.handoverNotes || '');
    setCashLkr(
      checklist.cashDrawerCountMinor !== null
        ? String((checklist.cashDrawerCountMinor / 100).toFixed(2))
        : ''
    );
  }, [checklist.id, checklist.handoverNotes, checklist.cashDrawerCountMinor]);

  const isCompleted = checklist.status === 'completed';

  return (
    <div className="neon-card rounded-2xl p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-500/20 pb-3">
        <div className="flex items-center gap-2.5">
          <ClipboardCheck className="w-5 h-5 text-cyan-300" aria-hidden="true" />
          <div>
            <h3 className="text-base font-bold text-white">{title}</h3>
            <p className="text-xs text-slate-400 font-mono-tabular">
              {checklist.businessDate} · {checklist.completedCount}/{checklist.totalCount} steps ·{' '}
              <span
                className={
                  isCompleted ? 'text-emerald-300 font-semibold' : 'text-amber-300 font-semibold'
                }
              >
                {isCompleted
                  ? isSi
                    ? 'සම්පූර්ණයි (Signed Off)'
                    : 'Signed Off'
                  : isSi
                    ? 'ක්‍රියාත්මකයි'
                    : 'In Progress'}
              </span>
            </p>
          </div>
        </div>
      </div>

      <ul className="space-y-2">
        {checklist.items.map((item) => {
          const itemBusy = busyKey === `${checklist.id}:${item.key}`;
          return (
            <li
              key={item.key}
              className="flex items-start justify-between gap-3 p-3 rounded-xl bg-[#040d1e]/75 border border-cyan-500/15"
            >
              <label className="flex items-start gap-3 cursor-pointer flex-1">
                <input
                  type="checkbox"
                  checked={item.completed}
                  disabled={itemBusy}
                  onChange={(e) => void onToggle(checklist.id, item.key, e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded accent-cyan-400"
                />
                <div className="space-y-0.5">
                  <p
                    className={`text-sm font-medium ${
                      item.completed ? 'line-through text-slate-400' : 'text-slate-100'
                    }`}
                  >
                    {isSi ? item.labelSi : item.labelEn}
                  </p>
                  <p className="text-[11px] text-slate-400">
                    {item.category.toUpperCase()}
                    {item.required ? ' · Mandatory' : ' · Optional'}
                    {item.completedByName ? ` · ✓ ${item.completedByName}` : ''}
                  </p>
                </div>
              </label>
            </li>
          );
        })}
      </ul>

      <div className="pt-2 border-t border-cyan-500/15 space-y-3">
        <div className="grid sm:grid-cols-3 gap-3">
          <label className="sm:col-span-2 block space-y-1">
            <span className="text-xs text-cyan-100/80">
              {isSi ? 'මුර මාරු සටහන (Shift Handover Notes)' : 'Shift Handover Notes'}
            </span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={
                isSi
                  ? 'ඊළඟ සේවකයාට වැදගත් සටහන්...'
                  : 'Pending deliveries, doctor updates, till notes...'
              }
              className="w-full min-h-[40px] px-3 rounded-xl text-xs neon-input"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-cyan-100/80">
              {isSi ? 'ගණන් කළ මුදල් (LKR)' : 'Cash Counted (LKR)'}
            </span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={cashLkr}
              onChange={(e) => setCashLkr(e.target.value)}
              placeholder="0.00"
              className="w-full min-h-[40px] px-3 rounded-xl text-xs font-mono-tabular neon-input"
            />
          </label>
        </div>
        <button
          type="button"
          disabled={busyKey === `complete:${checklist.id}`}
          onClick={() =>
            void onComplete(
              checklist.id,
              notes,
              cashLkr.trim() ? Number(cashLkr) : undefined
            )
          }
          className="min-h-[42px] px-4 rounded-xl neon-btn-primary text-xs font-bold inline-flex items-center gap-2 disabled:opacity-50"
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>
            {isCompleted
              ? isSi
                ? 'අත්සන් තබා අවසන් (නැවත සුරකින්න)'
                : 'Signed Off (Update Notes)'
              : isSi
                ? 'SOP අත්සන් කර මුරය සම්පූර්ණ කරන්න'
                : 'Sign Off Shift Checklist'}
          </span>
        </button>
      </div>
    </div>
  );
}

export function AutopilotCockpitPage() {
  const { i18n } = useTranslation();
  const { activeTenantId, session } = useAuth();
  const isSi = i18n.language !== 'en-LK';

  const [cockpit, setCockpit] = useState<AutopilotCockpitResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [noticeMsg, setNoticeMsg] = useState<string | null>(null);

  // Governance form state
  const [maxDiscountPct, setMaxDiscountPct] = useState(10);
  const [maxOpexLkr, setMaxOpexLkr] = useState(15000);
  const [maxWriteoffQty, setMaxWriteoffQty] = useState(25);
  const [ownerPhone, setOwnerPhone] = useState('');
  const [reqClosing, setReqClosing] = useState(false);
  const [autoReorder, setAutoReorder] = useState(true);
  const [ownerDigest, setOwnerDigest] = useState(true);

  const role = session?.workspace?.role;
  const canManageRules = role === 'owner' || role === 'manager';

  const loadCockpit = async () => {
    if (!activeTenantId) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await apiClient.getAutopilotCockpit(activeTenantId);
      setCockpit(res.cockpit);
      setMaxDiscountPct(res.cockpit.governance.maxCashierDiscountPercent);
      setMaxOpexLkr(Math.round(res.cockpit.governance.maxExpenseWithoutPinMinor / 100));
      setMaxWriteoffQty(res.cockpit.governance.maxStockWriteoffWithoutPin);
      setOwnerPhone(res.cockpit.governance.ownerWhatsappPhone);
      setReqClosing(res.cockpit.governance.requireClosingChecklist);
      setAutoReorder(res.cockpit.governance.autoReorderEnabled);
      setOwnerDigest(res.cockpit.governance.ownerDigestEnabled);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load Autopilot cockpit.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCockpit();
  }, [activeTenantId]);

  const handleToggleItem = async (
    checklistId: string,
    itemKey: string,
    completed: boolean
  ) => {
    if (!activeTenantId) return;
    setBusyKey(`${checklistId}:${itemKey}`);
    setErrorMsg(null);
    try {
      await apiClient.toggleChecklistItem(activeTenantId, checklistId, { itemKey, completed });
      await loadCockpit();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update checklist item.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleCompleteChecklist = async (
    checklistId: string,
    handoverNotes: string,
    cashDrawerCountLkr?: number
  ) => {
    if (!activeTenantId) return;
    setBusyKey(`complete:${checklistId}`);
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      await apiClient.completeChecklist(activeTenantId, checklistId, {
        handoverNotes,
        cashDrawerCountLkr,
      });
      setNoticeMsg(
        isSi
          ? 'මුර SOP පිරික්සුම් ලැයිස්තුව සාර්ථකව අත්සන් කරන ලදී.'
          : 'Shift SOP checklist signed off and recorded to audit trail.'
      );
      await loadCockpit();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Cannot sign off checklist yet.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleAutoDraftPos = async () => {
    if (!activeTenantId) return;
    setBusyKey('draft-pos');
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const res = await apiClient.generateAutoDraftPos(activeTenantId);
      setNoticeMsg(
        isSi
          ? `සැපයුම්කරුවන් අනුව Draft ඇණවුම් (PO) ${res.createdCount}ක් ස්වයංක්‍රීයව සෑදිණි.`
          : `Generated ${res.createdCount} draft Purchase Order(s) grouped by supplier.`
      );
      await loadCockpit();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to generate auto draft POs.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleGenerateBriefing = async () => {
    if (!activeTenantId) return;
    setBusyKey('briefing');
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      const res = await apiClient.generateOwnerBriefing(activeTenantId, true);
      setNoticeMsg(
        res.briefing.dispatchedChannel === 'whatsapp'
          ? 'Daily Owner Briefing compiled & dispatched via WhatsApp.'
          : 'Daily Owner Briefing compiled cleanly.'
      );
      await loadCockpit();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to generate daily briefing.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleSaveGovernance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeTenantId) return;
    setBusyKey('governance');
    setErrorMsg(null);
    setNoticeMsg(null);
    try {
      await apiClient.updateGovernanceRules(activeTenantId, {
        maxCashierDiscountPercent: Number(maxDiscountPct),
        maxExpenseWithoutPinMinor: Math.round(Number(maxOpexLkr) * 100),
        maxStockWriteoffWithoutPin: Number(maxWriteoffQty),
        ownerWhatsappPhone: ownerPhone,
        requireClosingChecklist: reqClosing,
        autoReorderEnabled: autoReorder,
        ownerDigestEnabled: ownerDigest,
      });
      setNoticeMsg(
        isSi
          ? 'ආරක්ෂිත පාලන නීති (Maker-Checker Governance) යාවත්කාලීන කරන ලදී.'
          : 'Maker-Checker governance thresholds updated.'
      );
      await loadCockpit();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save governance settings.');
    } finally {
      setBusyKey(null);
    }
  };

  const handleCopyKioskLink = async () => {
    if (!cockpit) return;
    const url = `${window.location.origin}${cockpit.kioskPath}`;
    try {
      await navigator.clipboard.writeText(url);
      setNoticeMsg(`Copied QR Check-In URL: ${url}`);
    } catch {
      setNoticeMsg(`Patient QR Kiosk Path: ${url}`);
    }
  };

  if (loading && !cockpit) {
    return (
      <div className="neon-card rounded-2xl p-8 text-center text-sm text-cyan-200/80">
        {isSi
          ? 'ස්වයංක්‍රීය පාලන පුවරුව පූරණය වෙමින්...'
          : 'Loading Autopilot & Solo Rescue Cockpit...'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-white flex items-center gap-2.5">
            <Sparkles className="w-6 h-6 text-cyan-300" aria-hidden="true" />
            <span>
              {isSi
                ? 'ස්වයංක්‍රීය ව්‍යාපාර පාලන පුවරුව (0–100 Staff OS)'
                : '0–100 Staff Autopilot & Solo Rescue Cockpit'}
            </span>
          </h1>
          <p className="text-xs sm:text-sm text-slate-300 mt-1">
            {isSi
              ? 'සේවකයෝ 0 සිට 100 දක්වා සිටියත් එකම ප්‍රමිතියෙන් වැඩ පවත්වාගෙන යන SOP, Maker-Checker අගුළු සහ AI ඇඟවීම්.'
              : 'Consistent operations with 0 or 100 staff · Mandatory shift SOPs · Maker-Checker PIN locks · Smart Auto-Reorder.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {cockpit && (
            <>
              <button
                type="button"
                onClick={() => void handleCopyKioskLink()}
                className="min-h-[40px] px-3.5 rounded-xl neon-btn-secondary text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <Copy className="w-3.5 h-3.5 text-cyan-300" />
                <span>Copy QR Kiosk Link</span>
              </button>
              <a
                href={cockpit.kioskPath}
                target="_blank"
                rel="noreferrer"
                className="min-h-[40px] px-3.5 rounded-xl neon-btn-secondary text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <QrCode className="w-3.5 h-3.5 text-cyan-300" />
                <span>{isSi ? 'රෝගී QR කියෝස්ක් විවෘත කරන්න' : 'Open Patient QR Kiosk'}</span>
              </a>
            </>
          )}
          <button
            type="button"
            onClick={() => void loadCockpit()}
            className="min-h-[40px] px-3.5 rounded-xl neon-btn-primary text-xs font-bold inline-flex items-center gap-1.5"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-rose-950/75 border border-rose-400/50 text-xs sm:text-sm text-rose-200"
        >
          {errorMsg}
        </div>
      )}
      {noticeMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-950/70 border border-emerald-400/45 text-xs sm:text-sm text-emerald-200">
          {noticeMsg}
        </div>
      )}

      {cockpit && (
        <>
          {/* Solo-Owner Rescue KPI Strip (Zero Pills, Tabular Numerals) */}
          <section className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="neon-card rounded-2xl p-4 space-y-1">
              <p className="text-[11px] uppercase tracking-wider text-slate-400">
                {isSi ? 'ඊළඟ රෝගියා (Solo Queue)' : 'Next Waiting Patient'}
              </p>
              {cockpit.soloSnapshot.nextWaitingPatient ? (
                <>
                  <p className="text-lg font-extrabold text-white font-mono-tabular">
                    #{cockpit.soloSnapshot.nextWaitingPatient.tokenNumber ?? 1} ·{' '}
                    {cockpit.soloSnapshot.nextWaitingPatient.personName}
                  </p>
                  <Link
                    to="/today"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-300 hover:underline"
                  >
                    <span>Open Today Board</span>
                    <ArrowRight className="w-3 h-3" />
                  </Link>
                </>
              ) : (
                <p className="text-sm font-semibold text-slate-300">No patients waiting</p>
              )}
            </div>

            <div className="neon-card rounded-2xl p-4 space-y-1">
              <p className="text-[11px] uppercase tracking-wider text-slate-400">
                {isSi ? 'අද මුළු ආදායම / ශුද්ධ ලාභය' : 'Today Revenue · True Net Profit'}
              </p>
              <p className="text-xl font-extrabold text-cyan-300 font-mono-tabular">
                {formatLkrMinor(cockpit.soloSnapshot.todayRevenueMinor)}
              </p>
              <p className="text-xs text-slate-300 font-mono-tabular">
                Net Profit:{' '}
                <strong>{formatLkrMinor(cockpit.soloSnapshot.trueNetProfitMinor)}</strong>
              </p>
            </div>

            <div className="neon-card rounded-2xl p-4 space-y-1">
              <p className="text-[11px] uppercase tracking-wider text-slate-400">
                {isSi ? 'අවදානම් ඇඟවීම් (Anomalies)' : 'Fraud & Safety Alerts'}
              </p>
              <p className="text-2xl font-extrabold font-mono-tabular text-white">
                {cockpit.anomalies.length}
              </p>
              <p className="text-xs text-slate-400">
                Expiry Alerts: {cockpit.soloSnapshot.expiringSoonCount} · Till/Audit Guards Active
              </p>
            </div>

            <div className="neon-card rounded-2xl p-4 space-y-1">
              <p className="text-[11px] uppercase tracking-wider text-slate-400">
                {isSi ? 'අඩු තොග (Smart Reorder SKUs)' : 'Auto-Reorder Candidates'}
              </p>
              <p className="text-2xl font-extrabold font-mono-tabular text-amber-300">
                {cockpit.soloSnapshot.lowStockCount}
              </p>
              <p className="text-xs text-slate-400">30-Day Velocity + Safety Par Active</p>
            </div>
          </section>

          {/* Opening & Closing Mandatory Shift Checklists */}
          <section className="grid lg:grid-cols-2 gap-5">
            <ChecklistPanel
              title={isSi ? 'උදෑසන විවෘත කිරීමේ SOP (Opening Shift)' : 'Mandatory Shift Opening SOP'}
              checklist={cockpit.checklists.opening}
              isSi={isSi}
              busyKey={busyKey}
              onToggle={handleToggleItem}
              onComplete={handleCompleteChecklist}
            />
            <ChecklistPanel
              title={
                isSi
                  ? 'දවස අවසන් කිරීමේ SOP (Closing & Handover)'
                  : 'Mandatory Shift Closing & Handover SOP'
              }
              checklist={cockpit.checklists.closing}
              isSi={isSi}
              busyKey={busyKey}
              onToggle={handleToggleItem}
              onComplete={handleCompleteChecklist}
            />
          </section>

          {/* Fraud / Anomaly Guard + Bilingual Daily Owner Briefing */}
          <section className="grid lg:grid-cols-2 gap-5">
            <div className="neon-card rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between gap-2 border-b border-cyan-500/20 pb-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-amber-300" aria-hidden="true" />
                  <h2 className="text-base font-bold text-white">
                    {isSi ? 'ස්වයංක්‍රීය අවදානම් සහ වංචා පරීක්ෂාව' : 'Live Anomaly & Fraud Guard'}
                  </h2>
                </div>
                <span className="text-xs font-mono-tabular text-slate-400">
                  {cockpit.anomalies.length} item(s)
                </span>
              </div>

              {cockpit.anomalies.length === 0 ? (
                <div className="p-4 rounded-xl bg-emerald-950/35 border border-emerald-400/30 text-xs text-emerald-200">
                  {isSi
                    ? 'අද දින කිසිදු මුදල් වෙනසක්, කල් ඉකුත් වූ තොගයක් හෝ අවදානමක් හමු නොවීය.'
                    : 'Zero anomalies detected today. Till cash, expiry, cold-chain, and discount thresholds are clean.'}
                </div>
              ) : (
                <ul className="space-y-2.5">
                  {cockpit.anomalies.map((anom) => (
                    <li
                      key={anom.id}
                      className={`p-3.5 rounded-xl bg-[#040d1e]/80 border-l-4 ${
                        anom.severity === 'critical'
                          ? 'border-l-rose-400 border border-rose-500/25'
                          : anom.severity === 'warning'
                            ? 'border-l-amber-400 border border-amber-500/25'
                            : 'border-l-cyan-400 border border-cyan-500/25'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-0.5">
                          <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">
                            {anom.severity} · {anom.category} · {anom.metricValue}
                          </p>
                          <p className="text-sm font-bold text-white">
                            {isSi ? anom.titleSi : anom.titleEn}
                          </p>
                          <p className="text-xs text-slate-300">{anom.detail}</p>
                        </div>
                        <Link
                          to={anom.actionPath}
                          className="shrink-0 text-xs font-semibold text-cyan-300 hover:underline whitespace-nowrap"
                        >
                          Inspect →
                        </Link>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="neon-card rounded-2xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-500/20 pb-3">
                <div className="flex items-center gap-2">
                  <Send className="w-5 h-5 text-cyan-300" aria-hidden="true" />
                  <h2 className="text-base font-bold text-white">
                    {isSi
                      ? 'හිමිකරුගේ දෛනික WhatsApp සාරාංශය'
                      : 'Owner Daily Briefing (EN + සිංහල)'}
                  </h2>
                </div>
                <button
                  type="button"
                  disabled={busyKey === 'briefing'}
                  onClick={() => void handleGenerateBriefing()}
                  className="min-h-[36px] px-3.5 rounded-xl neon-btn-primary text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{busyKey === 'briefing' ? 'Dispatching...' : 'Generate & Send'}</span>
                </button>
              </div>

              {cockpit.latestBriefing ? (
                <div className="space-y-3 text-xs">
                  <p className="text-slate-400 font-mono-tabular">
                    Channel: {cockpit.latestBriefing.dispatchedChannel} · Anomalies:{' '}
                    {cockpit.latestBriefing.anomalyCount}
                  </p>
                  <pre className="whitespace-pre-wrap p-3.5 rounded-xl bg-[#040d1e]/85 border border-cyan-500/20 text-cyan-100 font-sans leading-relaxed">
                    {isSi
                      ? cockpit.latestBriefing.summaryTextSi
                      : cockpit.latestBriefing.summaryTextEn}
                  </pre>
                </div>
              ) : (
                <p className="text-xs text-slate-400">
                  {isSi
                    ? 'අද දින හිමිකරු සාරාංශය තවමත් සාදා නොමැත. "Generate & Send" ඔබා ක්ෂණිකව WhatsApp / In-App වාර්තාව ලබා ගන්න.'
                    : 'No briefing generated for today yet. Click "Generate & Send" to compile and dispatch your evening executive summary.'}
                </p>
              )}
            </div>
          </section>

          {/* Smart Auto-Reorder Par Table */}
          <section className="neon-card rounded-2xl p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-cyan-500/20 pb-3">
              <div className="flex items-center gap-2.5">
                <PackagePlus className="w-5 h-5 text-cyan-300" aria-hidden="true" />
                <div>
                  <h2 className="text-base font-bold text-white">
                    {isSi
                      ? 'ස්වයංක්‍රීය තොග ඇණවුම් යෝජනා (Velocity Par Engine)'
                      : 'Smart Auto-Reorder Engine (30-Day Velocity + Safety Par)'}
                  </h2>
                  <p className="text-xs text-slate-400">
                    Calculates dynamic reorder levels from 30-day POS sales speed and drafts supplier POs in 1 click.
                  </p>
                </div>
              </div>
              <button
                type="button"
                disabled={busyKey === 'draft-pos' || cockpit.smartReorders.length === 0}
                onClick={() => void handleAutoDraftPos()}
                className="min-h-[40px] px-4 rounded-xl neon-btn-primary text-xs font-bold inline-flex items-center gap-2 disabled:opacity-50"
              >
                <PackagePlus className="w-4 h-4" />
                <span>
                  {busyKey === 'draft-pos'
                    ? 'Drafting POs...'
                    : isSi
                      ? '1-Click Draft PO සාදන්න'
                      : 'Auto-Generate Draft POs'}
                </span>
              </button>
            </div>

            {cockpit.smartReorders.length === 0 ? (
              <p className="text-xs text-slate-400">
                All active pharmacy SKUs are above dynamic reorder thresholds.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-cyan-500/20 text-slate-400 uppercase text-[11px]">
                      <th className="py-2 pr-3">Product</th>
                      <th className="py-2 px-3">Supplier</th>
                      <th className="py-2 px-3 text-right">On Hand</th>
                      <th className="py-2 px-3 text-right">30d Avg/Day</th>
                      <th className="py-2 px-3 text-right">Reorder At</th>
                      <th className="py-2 pl-3 text-right">Order Packs</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cyan-500/10">
                    {cockpit.smartReorders.map((item) => (
                      <tr key={item.productId}>
                        <td className="py-2.5 pr-3 font-medium text-white">
                          {item.productName}{' '}
                          <span className="text-slate-400 font-mono-tabular">({item.skuCode})</span>
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">{item.preferredSupplierName}</td>
                        <td className="py-2.5 px-3 text-right font-mono-tabular text-rose-300">
                          {item.sellableOnHand} {item.baseUnit}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-tabular text-slate-300">
                          {item.avgDailyUsage}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-tabular text-amber-300">
                          {item.dynamicReorderPoint}
                        </td>
                        <td className="py-2.5 pl-3 text-right font-mono-tabular font-bold text-cyan-300">
                          {item.suggestedOrderPacks} {item.packUnit}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Maker-Checker Governance Rules */}
          <section className="neon-card rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2.5 border-b border-cyan-500/20 pb-3">
              <ShieldCheck className="w-5 h-5 text-cyan-300" aria-hidden="true" />
              <div>
                <h2 className="text-base font-bold text-white">
                  {isSi
                    ? 'Maker-Checker පාලන සීමාවන් (Anti-Fraud PIN Locks)'
                    : 'Maker-Checker Anti-Fraud Governance'}
                </h2>
                <p className="text-xs text-slate-400">
                  Any non-owner staff exceeding these limits must enter an Owner/Manager Shift PIN before completing POS discount or OpEx entry.
                </p>
              </div>
            </div>

            <form
              onSubmit={handleSaveGovernance}
              className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4"
            >
              <label className="block space-y-1">
                <span className="text-xs text-cyan-100/80">Max Cashier Discount (%)</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  disabled={!canManageRules}
                  value={maxDiscountPct}
                  onChange={(e) => setMaxDiscountPct(Number(e.target.value))}
                  className="w-full min-h-[42px] px-3 rounded-xl text-sm font-mono-tabular neon-input disabled:opacity-60"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs text-cyan-100/80">Max Expense Without PIN (LKR)</span>
                <input
                  type="number"
                  min={0}
                  disabled={!canManageRules}
                  value={maxOpexLkr}
                  onChange={(e) => setMaxOpexLkr(Number(e.target.value))}
                  className="w-full min-h-[42px] px-3 rounded-xl text-sm font-mono-tabular neon-input disabled:opacity-60"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs text-cyan-100/80">Max Stock Writeoff (Units)</span>
                <input
                  type="number"
                  min={0}
                  disabled={!canManageRules}
                  value={maxWriteoffQty}
                  onChange={(e) => setMaxWriteoffQty(Number(e.target.value))}
                  className="w-full min-h-[42px] px-3 rounded-xl text-sm font-mono-tabular neon-input disabled:opacity-60"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs text-cyan-100/80">Owner WhatsApp Number</span>
                <input
                  type="tel"
                  disabled={!canManageRules}
                  value={ownerPhone}
                  onChange={(e) => setOwnerPhone(e.target.value)}
                  placeholder="0771234567"
                  className="w-full min-h-[42px] px-3 rounded-xl text-sm font-mono-tabular neon-input disabled:opacity-60"
                />
              </label>

              <div className="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center justify-between gap-4 pt-2">
                <div className="flex flex-wrap items-center gap-5 text-xs text-slate-200">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canManageRules}
                      checked={reqClosing}
                      onChange={(e) => setReqClosing(e.target.checked)}
                      className="w-4 h-4 accent-cyan-400"
                    />
                    <span>Require Closing SOP Sign-Off</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canManageRules}
                      checked={autoReorder}
                      onChange={(e) => setAutoReorder(e.target.checked)}
                      className="w-4 h-4 accent-cyan-400"
                    />
                    <span>Enable Smart Auto-Reorder</span>
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      disabled={!canManageRules}
                      checked={ownerDigest}
                      onChange={(e) => setOwnerDigest(e.target.checked)}
                      className="w-4 h-4 accent-cyan-400"
                    />
                    <span>Enable Daily Owner Digest</span>
                  </label>
                </div>

                {canManageRules && (
                  <button
                    type="submit"
                    disabled={busyKey === 'governance'}
                    className="min-h-[42px] px-5 rounded-xl neon-btn-primary text-xs font-bold disabled:opacity-50"
                  >
                    {busyKey === 'governance' ? 'Saving...' : 'Save Governance Rules'}
                  </button>
                )}
              </div>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
