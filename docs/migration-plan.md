# Migration, Cutover & Recovery Plan

**Last Updated:** 2026-11-18 (Asia/Colombo)

## 1. Schema Evolution Rule (Expand → Backfill → Contract)
1. **Expand:** Add new tables (`legal_entities`, `departments`, `counters`, `professional_grants`, pharmacy catalogue/inventory tables) and nullable/defaulted columns (e.g., `branches.legal_entity_id`) without dropping or altering working clinic columns.
2. **Backfill:** Inside transactional onboarding or idempotent migration backfill, ensure every existing `tenant` has a default `legal_entity` and every `branch` references its tenant-scoped `legal_entity_id`.
3. **Contract (Later):** Only enforce strict non-null FKs or deprecate legacy columns once backfill is verified across all rows.
4. **Drizzle Kit Composite FK Sequencing:** Because Drizzle Kit pushes `ADD CONSTRAINT ... FOREIGN KEY` before `ADD CONSTRAINT ... UNIQUE` in a single diff, composite `(tenant_id, id)` unique constraints must be pushed via `UpdateSchema` pass 1 before adding referencing composite foreign keys in pass 2.

## 2. Clinic Preservation & Cutover Protocol (`U20`)
- Preserve existing `appointments`, `services`, `resources`, `people`, `charges`, `payments`, `payment_allocations`, and `receipts`.
- Opening pharmacy stock is imported strictly via reconciled Goods Receipt / approved Opening Stock movement events (`A9`, `P25`) with lot, printed expiry precision, unit cost layer, and physical storage location—never via unvalidated balance edits.
- Never run two concurrent authoritative writers for the same inventory ledger or appointment slot (`ADR-002`).

## 3. Backup Restore Quarantine Drill (`U21`, `P22`)
Because Cloud SQL Point-in-Time Recovery (PITR) restores historical state:
1. Restore database snapshot into an isolated quarantine instance/schema (never directly onto live production traffic).
2. Suppress pending stale `outbox_events` created prior to the incident/restore boundary so old notifications/webhooks are not replayed.
3. Reapply authoritative newest revocations (`memberships.revoked_at`, `professional_grants.revoked_at`) and newest `recalls` / `quality_holds` from durable reconciled audit/recall records so recalled/expired stock is **never** restored into `sellable` status.
4. Reconcile `inventory_balances` against `SUM(stock_movements)` and tender totals before reopening traffic.
5. **Status:** Procedure documented; live Cloud SQL PITR drill remains `DEFERRED` until staging rehearsal (`Phase 6`).
