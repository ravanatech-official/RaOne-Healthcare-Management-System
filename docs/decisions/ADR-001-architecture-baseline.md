# Architecture Decision Records (MVP 1 Baseline)

**Prepared:** 2026-11-18 · Asia/Colombo  
**Scope:** Healthcare MVP 1 — Conversational Healthcare Business Workspace (`SuwaSeva`)  
**Authority:** Anchored to `Healthcare_MVP1_Engineering_Spec_v4.md` Parts II–IV (sections 59–95).

## Core ADRs Retained from v4 §59.1

- **ADR-001 (Modular Monolith):** Single deployable full-stack workspace (`server.ts` + `src/` domain/repository/adapter boundaries) rather than per-module microservices.
- **ADR-002 (PostgreSQL Authoritative Store):** Cloud SQL for PostgreSQL is the single authoritative transactional store. Firestore/RTDB are not used as parallel payment or booking ledgers.
- **ADR-003 (AI Cannot Execute Business Writes):** Gemini / speech models produce validated proposals or read-only explanations only. All business mutations go through deterministic domain services with server-verified permissions and explicit confirmation.
- **ADR-004 (Push-to-Talk Voice Capture):** Explicit user gesture starts/stops microphone capture. No always-listening wake-word or ambient recording.
- **ADR-005 (Live Membership & Role Resolution):** Firebase ID token proves identity; PostgreSQL `memberships` and `tenants` tables determine current tenant scope, role (`owner`, `manager`, `receptionist`), and revocation status on every request.
- **ADR-006 (Sri Lanka Pilot Baseline):** Pilot defaults to `LKR` (integer minor units: 100 cents = LKR 1.00) and `Asia/Colombo`, explicitly confirmed during owner onboarding without silent guessing. Language (`si-LK`, `en-LK`) is decoupled from business timezone/currency.
- **ADR-007 (Charge-Linked Payments):** Payments allocate strictly to posted charges in Phase 3; no unsupported advance/overpayment credits.
- **ADR-008 (Explicit Owner Corrections):** Financial corrections use distinct immutable events (`PAYMENT_ENTRY_VOIDED`, `CHARGE_CREDITED`, `CASH_REFUNDED`, `SERVICE_CANCEL_REFUND`) requiring owner step-up review.
- **ADR-009 (No Clinical AI):** Administrative clinic operations only; diagnosis, prescribing, treatment advice, and lab interpretation are blocked.
- **ADR-010 (Logical Tenant Isolation):** Shared database with mandatory `tenant_id` scoping, composite foreign keys `(tenant_id, id)`, fail-closed tenant verification, and cross-tenant negative tests.

## Environment-Specific Engineering Adaptations

- **ADR-011 (Express + Drizzle ORM in AI Studio Cloud SQL Runtime):**
  - **Context:** v4 §73 listed Fastify + Kysely as the initial baseline, noting Express is acceptable with equivalent validation controls. The provisioned Google AI Studio Cloud SQL runtime provides Express (`server.ts` + Vite middleware on port 3000) and mandates Drizzle ORM (`drizzle-orm/pg-core` + `pg` Pool Object Method with `SQL_HOST`/`SQL_USER`/`SQL_PASSWORD`/`SQL_DB_NAME`) and `drizzle-kit` (`UpdateSchema` RPC).
  - **Decision:** Retain Express in `server.ts` with strict `zod` request/response schema validation, explicit CORS/security headers, and rate limiting; use Drizzle ORM + `pg` Pool for PostgreSQL queries and schema management.
  - **Invariants Preserved:** All v4 Part III database invariants (tenant scoping, composite FKs, integer minor units, `[starts_at, ends_at)` range rules, transactional outbox, and idempotency tables) remain enforced at PostgreSQL + domain-service levels.
- **ADR-012 (Firebase Bearer Authentication Transport):**
  - **Context:** Per v4 §61.1 and Cloud SQL setup requirements, Google Sign-In via Firebase Auth issues ID tokens verified server-side via `firebase-admin`.
  - **Decision:** Use `browserSessionPersistence` (not persistent `localStorage` tokens), attach `Authorization: Bearer <idToken>` on `/api/v1/*` requests, and provide a Shared-Device Lock control that clears query caches, pauses microphone capture, and requires re-authentication.
