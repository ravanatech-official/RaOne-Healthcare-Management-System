# Provider & Language Matrix

**Last Updated:** 2026-11-18 (Asia/Colombo)  
**Scope:** Administrative UX, Interpretation, Speech, and Clinical Safety Boundaries

## 1. Language Coverage Matrix
| Locale | UI Strings & Templates | Text Intent Interpretation | Browser Push-to-Talk STT | Server STT / TTS | Task Validation Status |
|---|---|---|---|---|---|
| `si-LK` (Sinhala) | Active (`src/locales/i18n.ts`) | Active (`@google/genai` `gemini-4-hydrogen` read-only parser) | Progressive browser `SpeechRecognition` fallback to typing | Deferred to Phase 4/5 server adapter | `IMPLEMENTED_UNVERIFIED` (Native speaker evaluation `U22` pending) |
| `en-LK` (English Sri Lanka) | Active (`src/locales/i18n.ts`) | Active (`@google/genai` `gemini-4-hydrogen` read-only parser) | Progressive browser `SpeechRecognition` fallback to typing | Deferred to Phase 4/5 server adapter | `IMPLEMENTED_UNVERIFIED` |
| `si-LK` + `en-LK` (Singlish / Code-switching) | Supported in prompts & drug/service search | Supported in prompt instruction | Typed Singlish supported | Deferred | `IMPLEMENTED_UNVERIFIED` |
| `ta-LK` (Tamil) | **Disabled / Gated** | **Disabled** | **Disabled** | **Disabled** | `DEFERRED` (Must not be marketed as supported until native validation passes) |

## 2. AI Provider Matrix & Safety Guardrails
| Provider / Service | Model / Interface | Allowed Purpose | Prohibited Scope (Enforced) | Fallback on Outage / Missing Key |
|---|---|---|---|---|
| Gemini Developer / Vertex GenAI (`@google/genai`) | `gemini-4-hydrogen` (`src/adapters/gemini.ts`) | Bounded JSON intent parsing & slot extraction for administrative clinic/pharmacy queries and drafts. | **Never** read clinical notes, prescriptions, diagnoses, allergies, or generate dosage/drug substitutions (`U12`, `P19`). Clinical keyword filter blocks before API call. | Returns explicit `PROVIDER_NOT_CONFIGURED` / `AI_TEMPORARY_UNAVAILABLE` (`503`); all manual screens & workflows remain 100% functional (`P18`). |
| Browser Web Speech API | `window.SpeechRecognition` (optional) | Ephemeral push-to-talk draft transcript into editable input box; mic torn down on lock/unmount. | Never auto-commits stock/money actions; no raw audio persisted (`PRD-07`). | Typing and direct scan/manual UI always available. |

## 3. Prompt Injection & Untrusted Data Guardrail (`P19`)
- Untrusted strings (product names, supplier names, patient names, user utterances) are isolated as untrusted data fields (`"""..."""`), strictly separated from `systemInstruction`, and never executed as SQL or tool selection without Zod schema validation, exact DB ID resolution, and current server permission/grant verification.
