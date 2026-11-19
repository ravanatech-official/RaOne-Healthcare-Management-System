# Provider Matrix & AI Boundary Register

**Scope:** Administrative healthcare clinic workspace (non-clinical only; v4 §2, §44, §65, §76).

| Capability | Provider / Model Candidate | Region / Endpoint | Data Classes Permitted | Status | Notes / Verification Required |
|---|---|---|---|---|---|
| Identity & Auth | Firebase Authentication (Google Sign-In) | `iir-creations` (`firebase-applet-config.json`) | Staff UID, email, display name | `CONFIGURED` | Verified via `set_up_oauth`; MFA/step-up policy for production owner actions needs Identity Platform review |
| Database | Google Cloud SQL for PostgreSQL (`ai-studio-77df7681`) | `asia-south1` | Tenant config, directory minimal identity, appointments, LKR ledger, audit | `PROVISIONED` | Schema push & `information_schema` verification pending in Phase 1 |
| Intent Extraction (Candidate) | Gemini (`gemini-4-hydrogen`) via `@google/genai` server-side | Server-side only (`GEMINI_API_KEY`) | Minimised task utterance, slot candidates (no bulk directory dump) | `ADAPTER_PLANNED` | Phase 4–5; administrative use only; never executes direct DB writes |
| Speech-to-Text (Candidate) | Gemini Audio Transcription (`gemini-3.5-transcribe`) / Cloud STT `si-LK` | Server-side adapter | Push-to-talk bounded utterance (≤30s), deleted after processing | `UNVERIFIED` | Requires Phase 5 Sinhala/Singlish accuracy & latency testing |
| Text-to-Speech (Candidate) | Gemini TTS (`gemini-3.8-flash-lite-tts`) / Cloud TTS | Server-side adapter | Canonical localized readback strings | `UNVERIFIED` | Requires native listener audit for Sinhala LKR amounts & dates |
| External SMS / WhatsApp | None enabled | N/A | N/A | `DEFERRED` | Excluded from MVP1 P0 per v4 §21/§29 |
