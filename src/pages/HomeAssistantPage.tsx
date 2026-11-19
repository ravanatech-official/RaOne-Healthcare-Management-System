import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Banknote,
  CalendarCheck2,
  CheckCircle2,
  Mic,
  MicOff,
  Package,
  Send,
  ShoppingCart,
  Truck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient, ApiClientError, formatLkrMinor } from '../lib/api-client.ts';
import type { SupportedLocale } from '../contracts/api.ts';

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

export function HomeAssistantPage() {
  const { t, i18n } = useTranslation();
  const { session, activeTenantId } = useAuth();
  const queryClient = useQueryClient();
  const locale = (i18n.language === 'en-LK' ? 'en-LK' : 'si-LK') as SupportedLocale;

  const caps = session?.workspace?.capabilities ?? {};
  const hasClinic = Boolean(caps['appointments.manage']);
  const hasPos = Boolean(caps['pharmacy.pos']);
  const hasStock = Boolean(caps['pharmacy.inventory']);
  const hasReceiving = Boolean(caps['pharmacy.receiving']);

  const [inputText, setInputText] = useState('');
  const [micState, setMicState] = useState<'idle' | 'recording' | 'denied' | 'unsupported'>('idle');
  const [elapsedSec, setElapsedSec] = useState(0);
  const [interpreting, setInterpreting] = useState(false);
  const [interpretError, setInterpretError] = useState<string | null>(null);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [interpretationResult, setInterpretationResult] = useState<{
    status: string;
    intent: string;
    assistantReply: string;
    extractedFields: Record<string, unknown>;
    missingFields: string[];
    modelVersion: string;
  } | null>(null);

  // Draft -> Confirm proposal controls for clinic actions
  const [draftPersonId, setDraftPersonId] = useState('');
  const [draftServiceId, setDraftServiceId] = useState('');
  const [draftResourceId, setDraftResourceId] = useState('');
  const [draftStartsAtLocal, setDraftStartsAtLocal] = useState(() => {
    const d = new Date(Date.now() + 3600_000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const [draftAmountLkr, setDraftAmountLkr] = useState(2500);
  const [draftMethod, setDraftMethod] = useState<'cash' | 'card' | 'bank'>('cash');
  const [preparedProposal, setPreparedProposal] = useState<{
    id: string;
    actionType: string;
    canonicalPayloadJson: Record<string, unknown>;
    nonce: string;
  } | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);

  // Capability-aware queries (prevents 403 error card in pharmacy-only modes)
  const { data: today, isLoading: todayLoading, error: todayError } = useQuery({
    queryKey: ['today', activeTenantId],
    queryFn: () => apiClient.getTodaySummary(activeTenantId!),
    enabled: Boolean(activeTenantId && hasClinic),
  });

  const peopleQuery = useQuery({
    queryKey: ['clinic-people', activeTenantId],
    queryFn: () => apiClient.getClinicPeople(activeTenantId!),
    enabled: Boolean(activeTenantId && hasClinic),
  });

  const stockQuery = useQuery({
    queryKey: ['pharmacy-stock', activeTenantId],
    queryFn: () => apiClient.getStockSummary(activeTenantId!),
    enabled: Boolean(activeTenantId && hasStock),
  });

  const prepareProposalMutation = useMutation({
    mutationFn: () => {
      const intent = interpretationResult?.intent;
      if (intent === 'record_payment') {
        return apiClient.prepareActionProposal(activeTenantId!, {
          actionType: 'record_payment',
          inputSource: micState === 'recording' ? 'voice' : 'text',
          payload: {
            personId: draftPersonId || peopleQuery.data?.people[0]?.id,
            description: String(
              interpretationResult?.extractedFields.description || 'Clinic Consultation Fee'
            ),
            amountMinor: Math.round(Number(draftAmountLkr) * 100),
            method: draftMethod,
            referenceNumber: '',
          },
        });
      }
      return apiClient.prepareActionProposal(activeTenantId!, {
        actionType: 'create_appointment',
        inputSource: micState === 'recording' ? 'voice' : 'text',
        payload: {
          personId: draftPersonId || peopleQuery.data?.people[0]?.id,
          serviceId: draftServiceId || today?.services[0]?.id,
          resourceId: draftResourceId || today?.resources[0]?.id,
          startsAt: new Date(`${draftStartsAtLocal}:00+05:30`).toISOString(),
          notes: inputText.trim().slice(0, 200),
        },
      });
    },
    onSuccess: (res) => {
      setInterpretError(null);
      setPreparedProposal(res.proposal);
    },
    onError: (err) => {
      setInterpretError(err instanceof ApiClientError ? err.envelope.message : t('common.errorTitle'));
    },
  });

  const confirmProposalMutation = useMutation({
    mutationFn: () =>
      apiClient.confirmActionProposal(activeTenantId!, preparedProposal!.id, {
        idempotencyKey: `prop-${preparedProposal!.id}`,
        nonce: preparedProposal!.nonce,
      }),
    onSuccess: () => {
      setInterpretError(null);
      setPreparedProposal(null);
      setActionMsg(t('home.draftSuccess'));
      queryClient.invalidateQueries({ queryKey: ['today', activeTenantId] });
      queryClient.invalidateQueries({ queryKey: ['clinic-payments', activeTenantId] });
    },
    onError: (err) => {
      setInterpretError(err instanceof ApiClientError ? err.envelope.message : t('common.errorTitle'));
    },
  });

  useEffect(() => {
    if (micState !== 'recording') {
      setElapsedSec(0);
      return;
    }
    const timer = window.setInterval(() => {
      setElapsedSec((prev) => {
        if (prev >= 29) {
          recognitionRef.current?.stop();
          setMicState('idle');
          return 0;
        }
        return prev + 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [micState]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.stop();
    };
  }, []);

  const handleToggleMic = () => {
    if (micState === 'recording') {
      recognitionRef.current?.stop();
      setMicState('idle');
      return;
    }

    const win = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;

    if (!SpeechRec) {
      setMicState('unsupported');
      return;
    }

    try {
      const rec = new SpeechRec();
      rec.lang = locale;
      rec.interimResults = true;
      rec.maxAlternatives = 1;

      rec.onresult = (event) => {
        const lastIdx = event.results.length - 1;
        if (lastIdx >= 0) {
          const text = event.results[lastIdx][0]?.transcript ?? '';
          setInputText(text);
        }
      };

      rec.onerror = (ev) => {
        if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
          setMicState('denied');
        } else {
          setMicState('idle');
        }
      };

      rec.onend = () => {
        setMicState((curr) => (curr === 'recording' ? 'idle' : curr));
      };

      recognitionRef.current = rec;
      rec.start();
      setMicState('recording');
    } catch {
      setMicState('unsupported');
    }
  };

  const handleInterpretSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeTenantId) return;
    setInterpreting(true);
    setInterpretError(null);
    setActionMsg(null);
    setPreparedProposal(null);

    try {
      const res = await apiClient.interpretUtterance(activeTenantId, {
        text: inputText.trim(),
        locale,
        source: micState === 'recording' ? 'voice' : 'text',
      });
      setInterpretationResult(res.interpretation);
      const amt = Number(res.interpretation.extractedFields.amountLkr);
      if (Number.isFinite(amt) && amt > 0) setDraftAmountLkr(amt);
    } catch (err) {
      if (err instanceof ApiClientError) {
        setInterpretError(`${err.envelope.message} (${err.envelope.code})`);
      } else {
        setInterpretError(t('common.errorTitle'));
      }
    } finally {
      setInterpreting(false);
    }
  };

  const supportsDraftProposal =
    hasClinic &&
    (interpretationResult?.intent === 'create_appointment' ||
      interpretationResult?.intent === 'record_payment');

  const totalSellableBase =
    stockQuery.data?.balances.reduce((sum, b) => sum + b.availableQty, 0) ?? 0;
  const totalQuarantineBase =
    stockQuery.data?.balances.reduce(
      (sum, b) => sum + b.quarantineQty + b.returnedQuarantineQty,
      0
    ) ?? 0;

  return (
    <div className="space-y-8">
      {/* Main Conversational Focal Card */}
      <section className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
        <div className="space-y-2 max-w-2xl">
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 text-balance">
            {t('home.heading')}
          </h1>
          <p className="text-sm sm:text-base text-slate-600">{t('home.subheading')}</p>
        </div>

        {/* Push-to-Talk & Text Input */}
        <div className="grid lg:grid-cols-12 gap-4 items-stretch">
          <div className="lg:col-span-4 flex flex-col justify-between gap-3">
            <button
              type="button"
              onClick={handleToggleMic}
              className={`w-full min-h-[64px] px-6 rounded-xl font-medium text-base inline-flex items-center justify-center gap-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2 ${
                micState === 'recording'
                  ? 'bg-red-700 hover:bg-red-800 text-white'
                  : 'bg-teal-700 hover:bg-teal-800 text-white'
              }`}
            >
              {micState === 'recording' ? (
                <>
                  <MicOff className="w-6 h-6" aria-hidden="true" />
                  <span>
                    {t('home.stopSpeakButton')} ({elapsedSec}s / 30s)
                  </span>
                </>
              ) : (
                <>
                  <Mic className="w-6 h-6" aria-hidden="true" />
                  <span>{t('home.speakButton')}</span>
                </>
              )}
            </button>

            <div aria-live="polite" className="text-xs text-slate-600 min-h-[20px]">
              {micState === 'recording' && <span>{t('home.listening')}</span>}
              {micState === 'denied' && <span className="text-amber-800">{t('home.micDenied')}</span>}
              {micState === 'unsupported' && (
                <span className="text-slate-600">{t('home.micUnsupported')}</span>
              )}
            </div>
          </div>

          <form onSubmit={handleInterpretSubmit} className="lg:col-span-8 flex flex-col gap-2">
            <label htmlFor="assistant-text-input" className="text-xs font-medium text-slate-700">
              {t('home.typeLabel')}
            </label>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                id="assistant-text-input"
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder={t('home.typePlaceholder')}
                className="flex-1 min-h-[48px] px-4 bg-slate-50 border border-slate-300 rounded-xl text-sm text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
              />
              <button
                type="submit"
                disabled={interpreting || !inputText.trim()}
                className="min-h-[48px] px-5 bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-sm font-medium rounded-xl inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
              >
                <Send className="w-4 h-4" aria-hidden="true" />
                <span>{interpreting ? t('home.sending') : t('home.sendButton')}</span>
              </button>
            </div>
          </form>
        </div>

        {interpretError && (
          <div role="alert" className="p-4 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
            {interpretError}
          </div>
        )}

        {actionMsg && (
          <div className="p-4 bg-teal-50 border border-teal-200 rounded-lg text-sm text-teal-900 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-teal-700 shrink-0" aria-hidden="true" />
            <span>{actionMsg}</span>
          </div>
        )}

        {interpretationResult && (
          <div
            aria-live="polite"
            className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-4"
          >
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="font-medium text-slate-800">{interpretationResult.intent}</span>
                <span aria-hidden="true">·</span>
                <span>{interpretationResult.status}</span>
                <span aria-hidden="true">·</span>
                <span className="font-mono-tabular">{interpretationResult.modelVersion}</span>
              </div>
              <p className="text-base text-slate-900 font-medium">{interpretationResult.assistantReply}</p>
            </div>

            {/* Interactive Draft -> Confirm Action Proposal Panel */}
            {supportsDraftProposal && !preparedProposal && (
              <div className="pt-3 border-t border-slate-200 space-y-3">
                <div className="grid sm:grid-cols-3 gap-3">
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-slate-700">Patient</span>
                    <select
                      value={draftPersonId || peopleQuery.data?.people[0]?.id || ''}
                      onChange={(e) => setDraftPersonId(e.target.value)}
                      className="w-full min-h-[40px] px-3 bg-white border border-slate-300 rounded-lg text-xs"
                    >
                      {peopleQuery.data?.people.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.displayName} {p.phone ? `(${p.phone})` : ''}
                        </option>
                      ))}
                    </select>
                  </label>

                  {interpretationResult.intent === 'create_appointment' ? (
                    <>
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-slate-700">Service</span>
                        <select
                          value={draftServiceId || today?.services[0]?.id || ''}
                          onChange={(e) => setDraftServiceId(e.target.value)}
                          className="w-full min-h-[40px] px-3 bg-white border border-slate-300 rounded-lg text-xs"
                        >
                          {today?.services.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} ({formatLkrMinor(s.priceMinor)})
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-slate-700">Date & Time (Colombo)</span>
                        <input
                          type="datetime-local"
                          value={draftStartsAtLocal}
                          onChange={(e) => setDraftStartsAtLocal(e.target.value)}
                          className="w-full min-h-[40px] px-3 bg-white border border-slate-300 rounded-lg text-xs font-mono-tabular"
                        />
                      </label>
                    </>
                  ) : (
                    <>
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-slate-700">Amount (LKR)</span>
                        <input
                          type="number"
                          min={1}
                          value={draftAmountLkr}
                          onChange={(e) => setDraftAmountLkr(Number(e.target.value))}
                          className="w-full min-h-[40px] px-3 bg-white border border-slate-300 rounded-lg text-xs font-mono-tabular"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs font-medium text-slate-700">Method</span>
                        <select
                          value={draftMethod}
                          onChange={(e) => setDraftMethod(e.target.value as 'cash' | 'card' | 'bank')}
                          className="w-full min-h-[40px] px-3 bg-white border border-slate-300 rounded-lg text-xs"
                        >
                          <option value="cash">Cash</option>
                          <option value="card">Card</option>
                          <option value="bank">Bank</option>
                        </select>
                      </label>
                    </>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => prepareProposalMutation.mutate()}
                  disabled={prepareProposalMutation.isPending || !peopleQuery.data?.people.length}
                  className="min-h-[40px] px-4 bg-teal-700 hover:bg-teal-800 disabled:opacity-50 text-white text-xs font-medium rounded-lg"
                >
                  {t('home.prepareDraft')}
                </button>
              </div>
            )}

            {preparedProposal && (
              <div className="p-4 bg-white border border-teal-300 rounded-lg space-y-3">
                <div className="text-sm font-semibold text-slate-900">{t('home.draftTitle')}</div>
                <pre className="text-xs font-mono-tabular text-slate-700 bg-slate-50 border border-slate-200 rounded p-2.5 overflow-x-auto">
                  {JSON.stringify(preparedProposal.canonicalPayloadJson, null, 2)}
                </pre>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => confirmProposalMutation.mutate()}
                    disabled={confirmProposalMutation.isPending}
                    className="min-h-[40px] px-4 bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium rounded-lg"
                  >
                    {t('home.confirmAction')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setPreparedProposal(null)}
                    className="min-h-[40px] px-4 bg-white border border-slate-300 text-slate-700 text-xs font-medium rounded-lg"
                  >
                    {t('home.cancelDraft')}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        <p className="text-xs text-slate-500">{t('home.phaseNotice')}</p>
      </section>

      {/* Capability-Aware Operational Cards */}
      <section className="grid md:grid-cols-2 gap-6">
        {hasClinic && (
          <>
            <Link
              to="/today"
              className="bg-white border border-slate-200 hover:border-teal-700 rounded-xl p-6 flex items-center justify-between gap-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
            >
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-teal-800 font-semibold text-base">
                  <CalendarCheck2 className="w-5 h-5" aria-hidden="true" />
                  <span>{t('home.todayWork')}</span>
                </div>
                {todayLoading ? (
                  <p className="text-sm text-slate-500">{t('common.loading')}</p>
                ) : todayError ? (
                  <p className="text-sm text-red-700">{t('common.errorTitle')}</p>
                ) : (
                  <p className="text-sm text-slate-600 tabular-nums">
                    {today?.businessDate} · {today?.counts.total ?? 0} {t('today.total')} ·{' '}
                    {today?.counts.arrived ?? 0} {t('today.arrived')}
                  </p>
                )}
              </div>
              <ArrowRight className="w-5 h-5 text-slate-400 shrink-0" aria-hidden="true" />
            </Link>

            <div className="bg-white border border-slate-200 rounded-xl p-6 flex items-center justify-between gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-slate-900 font-semibold text-base">
                  <Banknote className="w-5 h-5 text-teal-700" aria-hidden="true" />
                  <span>{t('home.todayMoney')}</span>
                </div>
                {todayLoading ? (
                  <p className="text-sm text-slate-500">{t('common.loading')}</p>
                ) : todayError ? (
                  <p className="text-sm text-red-700">{t('common.errorTitle')}</p>
                ) : (
                  <div className="space-y-0.5">
                    <p className="text-2xl font-bold font-mono-tabular text-slate-900">
                      {formatLkrMinor(today?.recordedReceiptsMinor ?? 0, today?.currency ?? 'LKR')}
                    </p>
                    <p className="text-xs text-slate-500">
                      {today?.financialScope === 'branch_all'
                        ? t('today.scopeBranch')
                        : t('today.scopeOwn')}
                    </p>
                  </div>
                )}
              </div>
              <span className="text-xs text-slate-500 whitespace-nowrap">
                {session?.workspace?.currency || 'LKR'}
              </span>
            </div>
          </>
        )}

        {hasPos && (
          <Link
            to="/pharmacy/pos"
            className="bg-white border border-slate-200 hover:border-teal-700 rounded-xl p-6 flex items-center justify-between gap-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-teal-800 font-semibold text-base">
                <ShoppingCart className="w-5 h-5" aria-hidden="true" />
                <span>{t('home.pharmacyPosCard')}</span>
              </div>
              <p className="text-sm text-slate-600">{t('pharmacy.posDesc')}</p>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-400 shrink-0" aria-hidden="true" />
          </Link>
        )}

        {hasStock && (
          <Link
            to="/pharmacy/stock"
            className="bg-white border border-slate-200 hover:border-teal-700 rounded-xl p-6 flex items-center justify-between gap-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-slate-900 font-semibold text-base">
                <Package className="w-5 h-5 text-teal-700" aria-hidden="true" />
                <span>{t('home.pharmacyStockCard')}</span>
              </div>
              <p className="text-sm text-slate-600 font-mono-tabular">
                Sellable: {totalSellableBase} · Quarantine: {totalQuarantineBase}
              </p>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-400 shrink-0" aria-hidden="true" />
          </Link>
        )}

        {!hasClinic && hasReceiving && (
          <Link
            to="/pharmacy/receiving"
            className="bg-white border border-slate-200 hover:border-teal-700 rounded-xl p-6 flex items-center justify-between gap-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
          >
            <div className="space-y-1.5">
              <div className="flex items-center gap-2 text-slate-900 font-semibold text-base">
                <Truck className="w-5 h-5 text-teal-700" aria-hidden="true" />
                <span>{t('home.pharmacyReceivingCard')}</span>
              </div>
              <p className="text-sm text-slate-600">{t('pharmacy.receivingDesc')}</p>
            </div>
            <ArrowRight className="w-5 h-5 text-slate-400 shrink-0" aria-hidden="true" />
          </Link>
        )}
      </section>
    </div>
  );
}
