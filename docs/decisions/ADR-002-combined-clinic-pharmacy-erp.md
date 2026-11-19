# ADR-002: Combined Modular Clinic + Pharmacy ERP Architecture & Preservation Decision

**Date:** 2026-11-18 (Asia/Colombo)  
**Status:** Accepted  
**Supersedes / Extends:** Earlier Clinic-only `ADR-001` (if applicable in prior clinic baseline)

## Context
1. **Owner Status vs. Observed Repository State:**
   - The owner reported that an existing clinical system is complete.
   - Direct inspection of this workspace shows the Phase 1 **Clinic Administrative MVP** (Express, Drizzle ORM, Cloud SQL PostgreSQL `ai-studio-77df7681`, Firebase Auth, React/Vite/Tailwind/TanStack Query/i18next), passing 8/8 unit & tenant-isolation tests (`tests/tenant-isolation.test.ts`).
   - **No separate clinician-authored EHR, diagnosis, prescribing, or clinical signing repository/code is present in this workspace.** That capability is therefore recorded as `UNVERIFIED / ABSENT IN OBSERVED WORKSPACE`, and no synthetic EHR is invented.
2. **Product Direction:**
   - Support independently selectable product modes on one platform:
     - `clinic_only` (Clinic Core — works with zero pharmacy dependency)
     - `pharmacy_inventory_only` (Catalogue/UOM, Suppliers, GRN, Lots, Expiry/Recall/Quarantine — works with zero clinic or POS dependency)
     - `pharmacy_retail_only` (Inventory + POS/Tills/Returns + Pharmacist Release — works with zero clinic dependency)
     - `combo` (Clinic Core + Pharmacy + Controlled Handoff + Consolidated Reports)
     - Future `enterprise` / multi-branch governed behind growth gates.

## Decision
1. **Preserve Working Clinic Code & Database:**
   - Keep all 17 existing clinic/shared PostgreSQL tables, `/api/v1/*` clinic routes (`GET /api/v1/today`, `GET /api/v1/appointments/:id`, `POST /api/v1/onboarding/bootstrap`, `POST /api/v1/assistant/interpret`, `GET /api/v1/team`, `GET /api/v1/audit`), and React pages (`HomeAssistantPage`, `TodayBoardPage`, `TeamPage`, `AuditPage`) operational and covered by `tests/tenant-isolation.test.ts` as a hard regression gate.
   - Do not rewrite Express/Drizzle merely to match blueprint example names (`Fastify`/`Kysely`); preserve our working PostgreSQL + Drizzle + Zod typed contract stack and add modular domain packages (`src/domain/capabilities.ts`, `src/domain/pharmacy-catalogue.ts`, `src/domain/pharmacy-inventory.ts`) and modular route families (`/api/v1/platform/*`, `/api/v1/pharmacy/*`).
2. **Enforce Domain & Authority Boundaries in Shared Platform Tables:**
   - Separate `tenant` (isolation boundary), `legal_entity` (fiscal/record owner), `branch` (location), `department` (operational area), `membership.role` (administrative role), `professional_grants` (pharmacist/clinician licence/grant), and `tenant_capabilities` (product mode & entitlements).
   - **Owner != Clinician / Pharmacist:** Being `owner` or `manager` never automatically grants clinical signing or pharmacist release privileges (`U11`, `P10`).
   - **Non-disableable Safety Controls:** Tenant isolation, audit logging, expiry/recall/quarantine barriers, exact stock/money ledgers, and required professional gates can never be disabled by commercial tier or downgrade (`U19`, `P20`).
3. **Incremental Expand/Backfill/Contract Schema Evolution:**
   - Extend Cloud SQL PostgreSQL via Drizzle `UpdateSchema` without destructive drops to existing clinic tables.
   - Follow the verified 2-pass composite FK rule for Drizzle Kit (`unique(tenant_id, id)` applied before composite `foreignKey` references).

## Consequences
- Existing clinic APIs and regression suite remain green while Phase 1 pharmacy catalogue, versioned UOM, GRN vs. supplier invoice separation, lot/expiry/quarantine tracking, append-only stock movements, and transactional balances launch incrementally.
- Clinic-to-pharmacy clinical handoff remains explicitly gated on verified source-order authority (`U08`, `U09`, `U10`) in Phase 3, with manual reference workflow as fallback until a real clinical source system is connected and verified.
