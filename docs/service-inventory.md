# Cloud Service Inventory

Tracks only actually provisioned or active services in the current environment (per v4 §74–75). Unused services remain disabled.

| Service | Phase | Purpose | Region / Identifier | Status | Cost / Operational Owner |
|---|---|---|---|---|---|
| Cloud SQL for PostgreSQL | NOW (Phase 1) | Authoritative transactional database | `asia-south1` / `ai-studio-77df7681` | `PROVISIONED` | Project Owner (`iir-creations`) |
| Firebase Authentication (Google OAuth) | NOW (Phase 1) | Staff authentication & Bearer ID token issuance | `iir-creations` | `CONFIGURED` | Project Owner (`iir-creations`) |
| AI Studio App Runtime (Express + Vite) | NOW (Phase 1) | Serves API `/api/v1/*` and SPA on port 3000 | Dev sandbox | `ACTIVE` | Engineering Lead |
| Gemini API (`@google/genai`) | Phase 4–5 | Server-side bounded intent & speech adapters | Server env `GEMINI_API_KEY` | `INSTALLED_UNWIRED` | Engineering Lead |
| Cloud Storage / Cloud Tasks / Cloud Scheduler | Phase 6–7 | Private exports, outbox worker dispatch | Not provisioned yet | `DEFERRED` | Operations Owner |
| Firestore / Realtime Database | N/A | Explicitly excluded as authoritative store (v4 §73–74) | Not provisioned | `DISABLED` | N/A |
