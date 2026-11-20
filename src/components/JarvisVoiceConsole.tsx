import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CheckCircle2,
  Mic,
  MicOff,
  Radio,
  Send,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient, ApiClientError } from '../lib/api-client.ts';
import type { JarvisConverseResponse, SupportedLocale } from '../contracts/api.ts';

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

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  toolCalls?: Array<{ tool: string; summary: string }>;
  modelVersion?: string;
}

export function JarvisVoiceConsole() {
  const { t, i18n } = useTranslation();
  const { activeTenantId } = useAuth();
  const queryClient = useQueryClient();
  const locale = (i18n.language === 'en-LK' ? 'en-LK' : 'si-LK') as SupportedLocale;

  const [sessionId] = useState(() => `jarvis-${crypto.randomUUID()}`);
  const [inputText, setInputText] = useState('');
  const [voiceLoopActive, setVoiceLoopActive] = useState(false);
  const [speakResponses, setSpeakResponses] = useState(true);
  const [engineState, setEngineState] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const [micPermission, setMicPermission] = useState<'ok' | 'denied' | 'unsupported'>('ok');
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [pendingAction, setPendingAction] = useState<JarvisConverseResponse['proposedAction']>(null);
  const [quickFollowUps, setQuickFollowUps] = useState<string[]>(() =>
    locale === 'si-LK'
      ? [
          'අද appointments කීයක් තියෙනවද?',
          'Paracetamol 500mg කීයක් තියෙනවද?',
          'මේ මාසේ expire වෙන ඒවා මොනවද?',
          'අද ලැබුණු මුළු මුදල කීයද?',
        ]
      : [
          'How many appointments today?',
          'How much Paracetamol is in stock?',
          'Which medicines are expiring soon?',
          "Show today's collections & POS sales.",
        ]
  );
  const [quotaInfo, setQuotaInfo] = useState<{ voiceTurnsUsed: number; voiceTurnsLimit: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmMsg, setConfirmMsg] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const voiceLoopRef = useRef(false);
  voiceLoopRef.current = voiceLoopActive;

  useEffect(() => {
    setQuickFollowUps(
      locale === 'si-LK'
        ? [
            'අද appointments කීයක් තියෙනවද?',
            'Paracetamol 500mg කීයක් තියෙනවද?',
            'මේ මාසේ expire වෙන ඒවා මොනවද?',
            'අද ලැබුණු මුළු මුදල කීයද?',
          ]
        : [
            'How many appointments today?',
            'How much Paracetamol is in stock?',
            'Which medicines are expiring soon?',
            "Show today's collections & POS sales.",
          ]
    );
  }, [locale]);

  const stopAudioPlayback = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  }, []);

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }
    recognitionRef.current = null;
  }, []);

  useEffect(() => {
    return () => {
      voiceLoopRef.current = false;
      stopListening();
      stopAudioPlayback();
    };
  }, [stopAudioPlayback, stopListening]);

  const startSingleListen = useCallback(
    (onFinalTranscript: (transcript: string) => void) => {
      stopAudioPlayback();
      const win = window as unknown as {
        SpeechRecognition?: new () => SpeechRecognitionLike;
        webkitSpeechRecognition?: new () => SpeechRecognitionLike;
      };
      const SpeechRec = win.SpeechRecognition || win.webkitSpeechRecognition;
      if (!SpeechRec) {
        setMicPermission('unsupported');
        setVoiceLoopActive(false);
        setEngineState('idle');
        return;
      }

      try {
        const rec = new SpeechRec();
        rec.lang = locale;
        rec.interimResults = true;
        rec.maxAlternatives = 1;
        let finalCaptured = '';

        rec.onresult = (event) => {
          const lastIdx = event.results.length - 1;
          if (lastIdx >= 0) {
            const text = event.results[lastIdx][0]?.transcript ?? '';
            setInputText(text);
            if (event.results[lastIdx].isFinal) {
              finalCaptured = text.trim();
            }
          }
        };

        rec.onerror = (ev) => {
          if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
            setMicPermission('denied');
            setVoiceLoopActive(false);
          }
          setEngineState('idle');
        };

        rec.onend = () => {
          if (finalCaptured) {
            const captured = finalCaptured;
            finalCaptured = '';
            onFinalTranscript(captured);
          } else if (!voiceLoopRef.current) {
            setEngineState('idle');
          } else {
            // If loop still active and no speech captured, return cleanly to idle unless manually restarted
            setEngineState('idle');
            setVoiceLoopActive(false);
          }
        };

        recognitionRef.current = rec;
        rec.start();
        setEngineState('listening');
      } catch {
        setMicPermission('unsupported');
        setEngineState('idle');
      }
    },
    [locale, stopAudioPlayback]
  );

  const playSpeechOutput = useCallback(
    async (speechText: string, onDone: () => void) => {
      if (!speakResponses || !activeTenantId || !speechText.trim()) {
        onDone();
        return;
      }
      setEngineState('speaking');
      try {
        const tts = await apiClient.jarvisTts(activeTenantId, {
          text: speechText.slice(0, 550),
          locale,
        });
        if (tts.mode === 'audio_wav' && tts.audioBase64) {
          const audio = new Audio(`data:${tts.mimeType || 'audio/wav'};base64,${tts.audioBase64}`);
          audioRef.current = audio;
          audio.onended = () => {
            audioRef.current = null;
            onDone();
          };
          audio.onerror = () => {
            audioRef.current = null;
            onDone();
          };
          await audio.play();
          return;
        }
      } catch {
        // Fallback to browser SpeechSynthesis below
      }

      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const utter = new SpeechSynthesisUtterance(speechText);
        utter.lang = locale === 'si-LK' ? 'si-LK' : 'en-US';
        utter.rate = 1.02;
        utter.onend = onDone;
        utter.onerror = onDone;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utter);
      } else {
        onDone();
      }
    },
    [activeTenantId, locale, speakResponses]
  );

  const sendTurn = useCallback(
    async (rawMessage: string, source: 'voice' | 'text') => {
      const trimmed = rawMessage.trim();
      if (!trimmed || !activeTenantId) return;

      stopAudioPlayback();
      setErrorMsg(null);
      setConfirmMsg(null);
      setEngineState('thinking');

      const userMsg: ConversationMessage = {
        id: crypto.randomUUID(),
        role: 'user',
        text: trimmed,
      };

      const historyPayload = messages.slice(-8).map((m) => ({
        role: m.role,
        text: m.text,
      }));

      setMessages((prev) => [...prev, userMsg]);
      setInputText('');

      try {
        const res = await apiClient.jarvisConverse(activeTenantId, {
          sessionId,
          message: trimmed,
          locale,
          source,
          history: historyPayload,
        });

        setMessages((prev) => [
          ...prev,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            text: res.replyText,
            toolCalls: res.toolCallsExecuted,
            modelVersion: res.modelVersion,
          },
        ]);

        setPendingAction(res.proposedAction);
        if (res.quickFollowUps?.length) {
          setQuickFollowUps(res.quickFollowUps);
        }
        setQuotaInfo(res.quota);

        await playSpeechOutput(res.replySpeechText || res.replyText, () => {
          if (voiceLoopRef.current) {
            startSingleListen((nextText) => {
              void sendTurn(nextText, 'voice');
            });
          } else {
            setEngineState('idle');
          }
        });
      } catch (err) {
        setEngineState('idle');
        setVoiceLoopActive(false);
        setErrorMsg(
          err instanceof ApiClientError
            ? `${err.envelope.message} (${err.envelope.code})`
            : t('common.errorTitle')
        );
      }
    },
    [activeTenantId, locale, messages, playSpeechOutput, sessionId, startSingleListen, stopAudioPlayback, t]
  );

  const confirmMutation = useMutation({
    mutationFn: () =>
      apiClient.confirmActionProposal(activeTenantId!, pendingAction!.proposalId, {
        idempotencyKey: `jarvis-prop-${pendingAction!.proposalId}`,
        nonce: pendingAction!.nonce,
      }),
    onSuccess: () => {
      setPendingAction(null);
      setErrorMsg(null);
      setConfirmMsg(t('home.draftSuccess'));
      queryClient.invalidateQueries({ queryKey: ['today', activeTenantId] });
      queryClient.invalidateQueries({ queryKey: ['clinic-payments', activeTenantId] });
      queryClient.invalidateQueries({ queryKey: ['billing-overview', activeTenantId] });
    },
    onError: (err) => {
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : t('common.errorTitle'));
    },
  });

  const handleToggleVoiceEngine = () => {
    if (engineState === 'listening' || voiceLoopActive) {
      setVoiceLoopActive(false);
      stopListening();
      stopAudioPlayback();
      setEngineState('idle');
      return;
    }

    // Barge-in ready: stops any playing TTS audio and activates continuous loop
    setVoiceLoopActive(true);
    startSingleListen((transcript) => {
      void sendTurn(transcript, 'voice');
    });
  };

  return (
    <section className="neon-card-glow rounded-2xl p-6 sm:p-8 space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1.5 max-w-2xl">
          <h1 className="font-display text-2xl sm:text-3xl font-bold neon-heading-glow text-balance">
            {t('home.heading')}
          </h1>
          <p className="text-sm text-cyan-100/75">{t('home.subheading')}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {quotaInfo && (
            <span className="text-xs font-mono-tabular text-cyan-300 mr-2">
              {t('jarvis.voiceQuotaLabel')}: {quotaInfo.voiceTurnsUsed}/{quotaInfo.voiceTurnsLimit}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              if (speakResponses) stopAudioPlayback();
              setSpeakResponses((v) => !v);
            }}
            className="min-h-[40px] px-3 neon-btn-secondary text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            {speakResponses ? (
              <>
                <Volume2 className="w-4 h-4 text-cyan-300" aria-hidden="true" />
                <span>{t('jarvis.audioOn')}</span>
              </>
            ) : (
              <>
                <VolumeX className="w-4 h-4 text-slate-400" aria-hidden="true" />
                <span>{t('jarvis.audioMuted')}</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Central Interactive Neon Orb + Input Row */}
      <div className="grid lg:grid-cols-12 gap-5 items-center">
        <div className="lg:col-span-4 flex items-center gap-4">
          <div className="relative flex items-center justify-center shrink-0">
            {engineState !== 'idle' && (
              <span
                aria-hidden="true"
                className={`absolute inset-0 rounded-full ${
                  engineState === 'listening'
                    ? 'bg-rose-500/35 jarvis-ring-pulse'
                    : engineState === 'speaking'
                      ? 'bg-cyan-400/40 jarvis-ring-pulse'
                      : 'bg-sky-400/25 jarvis-ring-pulse'
                }`}
              />
            )}
            <button
              type="button"
              onClick={handleToggleVoiceEngine}
              aria-label={engineState === 'listening' ? t('home.stopSpeakButton') : t('home.speakButton')}
              className={`relative w-16 h-16 rounded-full inline-flex items-center justify-center transition-all ${
                engineState === 'listening'
                  ? 'bg-rose-500 hover:bg-rose-400 text-white shadow-[0_0_24px_rgba(244,63,94,0.7)]'
                  : engineState === 'speaking'
                    ? 'bg-cyan-400 text-[#021324] shadow-[0_0_28px_rgba(34,211,238,0.85)]'
                    : 'neon-btn-primary'
              }`}
            >
              {engineState === 'listening' ? (
                <MicOff className="w-7 h-7" aria-hidden="true" />
              ) : engineState === 'speaking' ? (
                <Radio className="w-7 h-7" aria-hidden="true" />
              ) : (
                <Mic className="w-7 h-7" aria-hidden="true" />
              )}
            </button>
          </div>

          <div className="space-y-1 min-w-0">
            <div className="text-sm font-semibold neon-text-cyan">
              {engineState === 'listening'
                ? t('jarvis.stateListening')
                : engineState === 'thinking'
                  ? t('jarvis.stateThinking')
                  : engineState === 'speaking'
                    ? t('jarvis.stateSpeaking')
                    : t('jarvis.stateReady')}
            </div>
            <p className="text-xs text-slate-300">
              {micPermission === 'denied'
                ? t('home.micDenied')
                : micPermission === 'unsupported'
                  ? t('home.micUnsupported')
                  : voiceLoopActive
                    ? t('jarvis.handsFreeOn')
                    : t('jarvis.tapToConverse')}
            </p>
          </div>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void sendTurn(inputText, 'text');
          }}
          className="lg:col-span-8 space-y-2"
        >
          <label htmlFor="jarvis-text-input" className="text-xs font-medium text-cyan-100/80">
            {t('home.typeLabel')}
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              id="jarvis-text-input"
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={t('home.typePlaceholder')}
              className="flex-1 min-h-[48px] px-4 rounded-xl text-sm neon-input"
            />
            <button
              type="submit"
              disabled={engineState === 'thinking' || !inputText.trim()}
              className="min-h-[48px] px-5 rounded-xl text-sm neon-btn-primary inline-flex items-center justify-center gap-2 whitespace-nowrap shrink-0 disabled:opacity-50"
            >
              <Send className="w-4 h-4" aria-hidden="true" />
              <span>{engineState === 'thinking' ? t('home.sending') : t('jarvis.sendPrompt')}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Quick bilingual follow-up prompt buttons */}
      <div className="flex flex-wrap gap-2">
        {quickFollowUps.map((prompt) => (
          <button
            key={prompt}
            type="button"
            disabled={engineState === 'thinking'}
            onClick={() => void sendTurn(prompt, 'text')}
            className="px-3 py-1.5 text-xs font-medium bg-[#040e22]/90 hover:bg-cyan-950/70 hover:border-cyan-400/50 border border-cyan-500/20 rounded-lg transition-colors text-cyan-100"
          >
            {prompt}
          </button>
        ))}
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="p-3.5 bg-amber-950/60 border border-amber-400/50 rounded-xl text-sm text-amber-200"
        >
          {errorMsg}
        </div>
      )}

      {confirmMsg && (
        <div className="p-3.5 bg-cyan-950/70 border border-cyan-400/50 rounded-xl text-sm text-cyan-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-cyan-300 shrink-0" aria-hidden="true" />
          <span>{confirmMsg}</span>
        </div>
      )}

      {/* Active Conversation Thread */}
      {messages.length > 0 && (
        <div
          aria-live="polite"
          className="border-t border-cyan-500/20 pt-4 space-y-3 max-h-[340px] overflow-y-auto"
        >
          {messages.map((m) => (
            <div
              key={m.id}
              className={`p-3.5 rounded-xl text-sm space-y-1.5 ${
                m.role === 'user'
                  ? 'bg-[#081734] border border-cyan-500/20 text-white ml-6'
                  : 'bg-cyan-950/40 border border-cyan-400/35 text-cyan-50 mr-6'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                <span className="font-semibold text-cyan-300">
                  {m.role === 'user' ? t('jarvis.youLabel') : 'SuwaSeva J.A.R.V.I.S.'}
                </span>
                {m.modelVersion && <span className="font-mono-tabular">{m.modelVersion}</span>}
              </div>
              <p className="leading-relaxed">{m.text}</p>
              {m.toolCalls && m.toolCalls.length > 0 && (
                <div className="pt-1 flex flex-wrap gap-3 text-xs text-cyan-300 font-mono-tabular">
                  {m.toolCalls.map((tc, i) => (
                    <span key={`${tc.tool}-${i}`}>
                      {tc.tool}: {tc.summary}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Draft -> Confirm Mutation Card */}
      {pendingAction && (
        <div className="p-4 bg-[#040e22]/90 border border-cyan-400/50 rounded-xl space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-white">{t('home.draftTitle')}</h2>
            <span className="text-xs font-mono-tabular neon-text-cyan">{pendingAction.actionType}</span>
          </div>
          <p className="text-sm text-cyan-100 font-medium">{pendingAction.summaryLabel}</p>
          <pre className="text-xs font-mono-tabular text-cyan-200 bg-[#020817] border border-cyan-500/20 rounded p-2.5 overflow-x-auto">
            {JSON.stringify(pendingAction.payload, null, 2)}
          </pre>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={confirmMutation.isPending}
              onClick={() => confirmMutation.mutate()}
              className="min-h-[40px] px-4 rounded-lg text-xs neon-btn-primary"
            >
              {confirmMutation.isPending ? 'Executing...' : t('home.confirmAction')}
            </button>
            <button
              type="button"
              onClick={() => setPendingAction(null)}
              className="min-h-[40px] px-4 rounded-lg text-xs font-medium neon-btn-secondary"
            >
              {t('home.cancelDraft')}
            </button>
          </div>
        </div>
      )}

      <p className="text-xs text-slate-400">{t('home.phaseNotice')}</p>
    </section>
  );
}
