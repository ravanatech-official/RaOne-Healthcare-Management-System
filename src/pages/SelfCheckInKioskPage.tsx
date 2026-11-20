import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Printer, QrCode, RefreshCw, Sparkles, UserCheck } from 'lucide-react';
import type { PublicKioskInfoResponse, PublicSelfCheckInResponse } from '../contracts/api.ts';
import { apiClient, formatLkrMinor, formatTimeColombo } from '../lib/api-client.ts';

export function SelfCheckInKioskPage({ tenantSlug }: { tenantSlug: string }) {
  const [locale, setLocale] = useState<'si-LK' | 'en-LK'>('si-LK');
  const isSi = locale === 'si-LK';

  const [info, setInfo] = useState<PublicKioskInfoResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [patientName, setPatientName] = useState('');
  const [phone, setPhone] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [resourceId, setResourceId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [ticket, setTicket] = useState<PublicSelfCheckInResponse | null>(null);

  const loadInfo = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await apiClient.getPublicKioskInfo(tenantSlug);
      setInfo(data);
      if (data.services.length > 0 && !serviceId) {
        setServiceId(data.services[0].id);
      }
      if (data.resources.length > 0 && !resourceId) {
        setResourceId(data.resources[0].id);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load clinic check-in kiosk.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadInfo();
  }, [tenantSlug]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serviceId || !resourceId) return;
    setSubmitting(true);
    setErrorMsg(null);
    try {
      const res = await apiClient.submitPublicSelfCheckIn(tenantSlug, {
        branchId: info?.branchId,
        patientName,
        phone,
        serviceId,
        resourceId,
        notes,
      });
      setTicket(res);
      setPatientName('');
      setPhone('');
      setNotes('');
      await loadInfo();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Check-in failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleThermalTokenPrint = () => {
    document.body.classList.add('printing-thermal-80mm');
    window.setTimeout(() => {
      window.print();
      document.body.classList.remove('printing-thermal-80mm');
    }, 80);
  };

  return (
    <div className="min-h-screen neon-canvas text-slate-100 flex flex-col justify-between p-4 sm:p-8">
      <header className="max-w-3xl w-full mx-auto flex flex-wrap items-center justify-between gap-3 no-print">
        <div className="inline-flex items-center gap-2.5 px-3.5 py-2 rounded-xl border border-cyan-400/35 bg-[#06132b]/85">
          <Sparkles className="w-5 h-5 text-cyan-300" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold text-white leading-tight">
              {info?.tenantName ?? 'SuwaSeva Patient Kiosk'}
            </p>
            <p className="text-[11px] text-cyan-300/90">
              {info ? `${info.branchName} · ${info.businessDate}` : 'QR Self Check-In'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void loadInfo()}
            className="p-2 rounded-lg border border-cyan-500/30 bg-[#071530] text-cyan-200 hover:bg-cyan-500/15"
            aria-label="Refresh kiosk"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <div className="flex items-center p-1 bg-[#071530] border border-cyan-500/25 rounded-lg">
            <button
              type="button"
              onClick={() => setLocale('si-LK')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md ${
                isSi ? 'bg-cyan-400 text-[#021324]' : 'text-slate-300'
              }`}
            >
              සිංහල
            </button>
            <button
              type="button"
              onClick={() => setLocale('en-LK')}
              className={`px-2.5 py-1 text-xs font-semibold rounded-md ${
                !isSi ? 'bg-cyan-400 text-[#021324]' : 'text-slate-300'
              }`}
            >
              English
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-xl w-full mx-auto my-6">
        {loading && !info ? (
          <div className="neon-card-glow rounded-2xl p-8 text-center text-sm text-cyan-200/80">
            {isSi ? 'සායන තොරතුරු ලබා ගනිමින් පවතී...' : 'Loading self check-in kiosk...'}
          </div>
        ) : ticket ? (
          <>
            <div className="neon-card-glow rounded-2xl p-6 sm:p-8 space-y-5 text-center no-print">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-500/15 border border-emerald-400/40 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8 text-emerald-300" />
              </div>
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-widest text-cyan-300 font-semibold">
                  {isSi ? 'ඔබගේ පෝලිම් අංකය' : 'YOUR QUEUE TOKEN'}
                </p>
                <p className="text-6xl font-extrabold font-mono-tabular text-white">
                  #{ticket.tokenNumber}
                </p>
                <p className="text-sm text-slate-300">
                  {ticket.patientName} · {ticket.serviceName}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-left p-4 rounded-xl bg-[#040d1e]/80 border border-cyan-500/20 text-xs">
                <div>
                  <p className="text-slate-400">{isSi ? 'වෛද්‍යවරයා' : 'Practitioner'}</p>
                  <p className="font-semibold text-white mt-0.5">{ticket.doctorName}</p>
                </div>
                <div>
                  <p className="text-slate-400">{isSi ? 'ඇස්තමේන්තු වේලාව' : 'Estimated Slot'}</p>
                  <p className="font-semibold text-cyan-300 font-mono-tabular mt-0.5">
                    {formatTimeColombo(ticket.startsAt)}
                  </p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  type="button"
                  onClick={handleThermalTokenPrint}
                  className="flex-1 min-h-[44px] px-4 rounded-xl neon-btn-primary text-sm inline-flex items-center justify-center gap-2"
                >
                  <Printer className="w-4 h-4" />
                  <span>{isSi ? 'ටෝකන් පත මුද්‍රණය (80mm)' : 'Print 80mm Token Slip'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setTicket(null)}
                  className="flex-1 min-h-[44px] px-4 rounded-xl neon-btn-secondary text-sm font-semibold"
                >
                  {isSi ? 'තවත් රෝගියෙකු ඇතුළත් කරන්න' : 'Check In Another Patient'}
                </button>
              </div>
            </div>

            <div className="thermal-80mm-only thermal-80mm-root">
              <div style={{ textAlign: 'center', borderBottom: '1px dashed #000', paddingBottom: 6 }}>
                <strong>{info?.tenantName ?? ticket.clinicName}</strong>
                <div>{ticket.branchName}</div>
                <div>{ticket.businessDate}</div>
              </div>
              <div style={{ textAlign: 'center', padding: '10px 0' }}>
                <div style={{ fontSize: 11 }}>QUEUE TOKEN</div>
                <div style={{ fontSize: 32, fontWeight: 800 }}>#{ticket.tokenNumber}</div>
                <div>{ticket.patientName}</div>
              </div>
              <div style={{ borderTop: '1px dashed #000', paddingTop: 6, fontSize: 10 }}>
                <div>Doctor: {ticket.doctorName}</div>
                <div>Service: {ticket.serviceName}</div>
                <div>Est. Time: {formatTimeColombo(ticket.startsAt)}</div>
              </div>
            </div>
          </>
        ) : (
          <div className="neon-card-glow rounded-2xl p-6 sm:p-8 space-y-5 no-print">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="font-display text-2xl font-extrabold text-white">
                  {isSi ? 'ස්වයං රෝගී ලියාපදිංචිය (Check-In)' : 'Patient Self Check-In Kiosk'}
                </h1>
                <p className="text-xs sm:text-sm text-cyan-100/75 mt-1">
                  {isSi
                    ? 'කවුන්ටරයේ පෝලිමේ රැඳී නොසිට ඔබගේ ටෝකන් අංකය ක්ෂණිකව ලබා ගන්න.'
                    : 'Enter your details to join today’s queue instantly and receive a token.'}
                </p>
              </div>
              <QrCode className="w-7 h-7 text-cyan-300 shrink-0" aria-hidden="true" />
            </div>

            {info && (
              <div className="flex flex-wrap items-center gap-3 text-xs text-cyan-200 border-y border-cyan-500/20 py-2.5">
                <span className="inline-flex items-center gap-1.5 font-mono-tabular">
                  <Clock className="w-3.5 h-3.5 text-cyan-400" />
                  Waiting in queue: <strong>{info.waitingCount}</strong>
                </span>
                <span>·</span>
                <span>{info.branchName}</span>
                <span>·</span>
                <span className="font-mono-tabular">{info.businessDate}</span>
              </div>
            )}

            {errorMsg && (
              <div className="p-3 rounded-xl bg-rose-950/70 border border-rose-400/50 text-xs text-rose-200">
                {errorMsg}
              </div>
            )}

            {info && (
              <form onSubmit={handleSubmit} className="space-y-4">
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-cyan-100/85">
                    {isSi ? 'රෝගියාගේ නම *' : 'Patient Full Name *'}
                  </span>
                  <input
                    required
                    minLength={2}
                    value={patientName}
                    onChange={(e) => setPatientName(e.target.value)}
                    placeholder={isSi ? 'උදා: කමල් පෙරේරා' : 'e.g. Kamal Perera'}
                    className="w-full min-h-[46px] px-3.5 rounded-xl text-sm neon-input"
                  />
                </label>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-cyan-100/85">
                    {isSi ? 'දුරකථන අංකය (WhatsApp/SMS සඳහා) *' : 'Mobile Phone Number *'}
                  </span>
                  <input
                    required
                    minLength={7}
                    inputMode="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="0771234567"
                    className="w-full min-h-[46px] px-3.5 rounded-xl text-sm font-mono-tabular neon-input"
                  />
                </label>

                <div className="grid sm:grid-cols-2 gap-3">
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-cyan-100/85">
                      {isSi ? 'අවශ්‍ය සේවාව' : 'Consultation / Service'}
                    </span>
                    <select
                      required
                      value={serviceId}
                      onChange={(e) => setServiceId(e.target.value)}
                      className="w-full min-h-[46px] px-3 rounded-xl text-sm neon-input"
                    >
                      {info.services.map((s) => (
                        <option key={s.id} value={s.id}>
                          {isSi && s.nameSi ? s.nameSi : s.name} ({formatLkrMinor(s.priceMinor, info.currency)})
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-cyan-100/85">
                      {isSi ? 'වෛද්‍යවරයා' : 'Doctor / Practitioner'}
                    </span>
                    <select
                      required
                      value={resourceId}
                      onChange={(e) => setResourceId(e.target.value)}
                      className="w-full min-h-[46px] px-3 rounded-xl text-sm neon-input"
                    >
                      {info.resources.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name} ({r.specialty})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-cyan-100/85">
                    {isSi ? 'විශේෂ සටහන් (විකල්ප)' : 'Reason / Notes (Optional)'}
                  </span>
                  <input
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={isSi ? 'උණ / රසායනාගාර වාර්තා...' : 'Fever follow-up / lab report review...'}
                    className="w-full min-h-[44px] px-3.5 rounded-xl text-sm neon-input"
                  />
                </label>

                <button
                  type="submit"
                  disabled={submitting || !serviceId || !resourceId}
                  className="w-full min-h-[48px] px-5 rounded-xl neon-btn-primary text-sm inline-flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <UserCheck className="w-4 h-4" />
                  <span>
                    {submitting
                      ? isSi
                        ? 'ටෝකනය සකසමින්...'
                        : 'Generating Token...'
                      : isSi
                        ? 'පෝලිම් ටෝකනය ලබා ගන්න'
                        : 'Get Queue Token Now'}
                  </span>
                </button>
              </form>
            )}
          </div>
        )}
      </main>

      <footer className="max-w-3xl w-full mx-auto text-center text-xs text-slate-400 no-print">
        SuwaSeva Patient Self Check-In · Privacy-Safe Token Queue
      </footer>
    </div>
  );
}
