# Combined Requirements Traceability Matrix (U01–U24 & P01–P26)

**Last Updated:** 2026-11-18 (Asia/Colombo)  
**Status Legend:** `NOT_STARTED` | `IMPLEMENTED_UNVERIFIED` | `VERIFIED_LOCAL` | `VERIFIED_STAGING` | `BLOCKED` | `DEFERRED`

## Part A: Combined Clinic + Pharmacy Tests (U01–U24)
| ID | Requirement / Behaviour | Blueprint Section | Implementation Files | Test ID / Verification | Status |
|---|---|---|---|---|---|
| U01 | Clinic-only works without pharmacy entitlement | §4, §27, §30 | `src/domain/capabilities.ts`, `src/domain/tenancy.ts` | `tests/pharmacy-phase1.test.ts` + `tests/tenant-isolation.test.ts` | `VERIFIED_LOCAL` |
| U02 | Pharmacy-only works without clinic entitlement | §4, §27, §30 | `src/domain/capabilities.ts`, `src/domain/pharmacy-inventory.ts` | `tests/pharmacy-phase1.test.ts` | `VERIFIED_LOCAL` |
| U03 | Combo shared UI does not broaden clinical access | §7, §8, §19 | `src/components/AppShell.tsx`, `src/domain/capabilities.ts` | UI nav + permission checks; clinical UI absent | `IMPLEMENTED_UNVERIFIED` |
| U04 | Separate legal entities/tenants cannot query each other's data | §7, §17 | `src/db/schema.ts`, `src/domain/tenancy.ts`, `src/domain/pharmacy-inventory.ts` | `tests/tenant-isolation.test.ts`, `tests/pharmacy-phase1.test.ts` | `VERIFIED_LOCAL` |
| U05 | Ambiguous person matching does not auto-merge | §7, §21 | `src/domain/clinic-writes.ts` (`people`) | `tests/clinic-writes-pos.test.ts` (`POSSIBLE_DUPLICATE_PERSON`) | `VERIFIED_LOCAL` |
| U06 | Existing appointment/payment regressions pass on integrated build | §6, §9 | `src/domain/today.ts`, `src/routes/api-v1.ts` | `tests/tenant-isolation.test.ts` (8/8 passed) | `VERIFIED_LOCAL` |
| U07 | Two users book same slot: one wins; failed reschedule preserves original | §9 | `src/db/schema.ts` (`btree_gist`), `src/domain/clinic-writes.ts` | `tests/clinic-writes-pos.test.ts` (`APPOINTMENT_OVERLAP`) | `VERIFIED_LOCAL` |
| U08 | Duplicate handoff event creates one inbox item, not sale or tender | §11, §16 | Planned Bridge domain | Phase 3 | `BLOCKED` (No observed clinical order source) |
| U09 | Source cancellation/amendment vs fulfilment respects current authority | §12 | Planned Bridge domain | Phase 3 | `BLOCKED` (No observed clinical order source) |
| U10 | Partial/retried fulfilment never exceeds authorised remaining qty | §12 | Planned Bridge domain | Phase 3 | `BLOCKED` (No observed clinical order source) |
| U11 | Cashier/owner cannot impersonate clinician/pharmacist | §8, §18 | `src/db/schema.ts` (`professional_grants`), `src/domain/capabilities.ts` | `tests/pharmacy-phase1.test.ts` + `tests/clinic-writes-pos.test.ts` | `VERIFIED_LOCAL` |
| U12 | Administrative model context never includes protected clinical fields | §8, §10, §20 | `src/adapters/gemini.ts` | `tests/tenant-isolation.test.ts` | `VERIFIED_LOCAL` (boundary check unit test) |
| U13 | Last-unit checkout, recall race & FEFO/expiry tests pass | §13, A10, A12 | `src/domain/pharmacy-pos.ts` (`FOR UPDATE` `lot_id ASC`) | `tests/clinic-writes-pos.test.ts` (FEFO + active recall verified; concurrent 2-counter race stress pending) | `VERIFIED_LOCAL` (Sequential) |
| U14 | Same-key replay after consumed confirmation returns one result | §18, A13 | `src/db/schema.ts` (`commands`, `action_proposals`), `src/domain/clinic-writes.ts`, `src/domain/pharmacy-inventory.ts` | `tests/pharmacy-phase1.test.ts` + `tests/clinic-writes-pos.test.ts` | `VERIFIED_LOCAL` |
| U15 | Lost response/print/TTS failure does not duplicate domain effects | §18, A13 | `src/domain/pharmacy-pos.ts` (`commands`) | Phase 4 print/TTS end-to-end | `IMPLEMENTED_UNVERIFIED` |
| U16 | Combined report counts shared payment once; separates entities/currencies | §14 | Planned Phase 4 | Phase 4 | `NOT_STARTED` |
| U17 | Pharmacy refund does not alter clinic debt or auto-restock medicine | §14, A14 | `src/domain/pharmacy-pos.ts` (`createPosReturn`) | `tests/clinic-writes-pos.test.ts` (`returnedQuarantineQty`) | `VERIFIED_LOCAL` |
| U18 | Integration outage holds unsafe handoff while standalone modules work | §16, §24 | `src/domain/capabilities.ts` | Phase 3 | `NOT_STARTED` |
| U19 | Downgrade/quota preserves mandatory controls & manual operations | §27 | `src/domain/capabilities.ts` | `tests/pharmacy-phase1.test.ts` | `VERIFIED_LOCAL` |
| U20 | Migration/reconciliation & cutover rollback rehearsed | §26 | `docs/migration-plan.md` | Phase 5/6 | `DEFERRED` |
| U21 | Restore reapplies revocations, recalls, cancellations without stale sends | §25 | `docs/migration-plan.md` | Phase 6 PITR drill | `DEFERRED` |
| U22 | Native-language/device/accessibility/hardware tasks demonstrated | §20, §29 | `src/locales/i18n.ts` | Human pilot & native study | `BLOCKED` |
| U23 | Actual load/connection/cold-start results recorded | §24 | `server.ts`, `src/db/index.ts` | Phase 6 load test | `DEFERRED` |
| U24 | Clinical signing/amendment regression verified if clinical enabled | §6, §10 | *Absent in workspace* | Clinical source inspection | `BLOCKED` (Owner-reported only; no code present) |

---

## Part B: Pharmacy Domain Tests (P01–P26 — Blueprint Appendix A32)
| ID | Behaviour Required | Implementation Files | Test ID / Scope | Status |
|---|---|---|---|---|
| P01 | Cross-tenant/branch reads, writes, exports & execution denied | `src/domain/pharmacy-inventory.ts`, `src/db/schema.ts` | `tests/pharmacy-phase1.test.ts` | `VERIFIED_LOCAL` |
| P02 | Same brand different strength/form/pack never auto-selected equivalent | `src/domain/pharmacy-catalogue.ts`, `src/db/schema.ts` | `tests/pharmacy-phase1.test.ts` | `VERIFIED_LOCAL` |
| P03 | Pack conversion/versioning produces exact base units; snapshot stable | `src/domain/pharmacy-catalogue.ts`, `src/db/schema.ts` | `tests/pharmacy-phase1.test.ts` | `VERIFIED_LOCAL` |
| P04 | Two counters buy last unit: one succeeds, no negative stock | `src/domain/pharmacy-pos.ts` (`FOR UPDATE`, non-negative checks) | `tests/clinic-writes-pos.test.ts` (deterministic lock ordering verified; concurrent 2-counter race test pending) | `VERIFIED_LOCAL` (Mechanism) |
| P05 | FEFO excludes expired/recalled/quarantined/reserved/unreleased stock | `src/domain/pharmacy-pos.ts`, `src/db/schema.ts` | `tests/clinic-writes-pos.test.ts` | `VERIFIED_LOCAL` |
| P06 | Recall activation racing with checkout honours shared locking order | `src/domain/pharmacy-pos.ts` | `tests/clinic-writes-pos.test.ts` (active recall skipped during FEFO checkout) | `VERIFIED_LOCAL` (Sequential) |
| P07 | Same command repeated creates one effect | `src/domain/pharmacy-inventory.ts`, `src/domain/clinic-writes.ts`, `src/domain/pharmacy-pos.ts` (`commands`) | `tests/pharmacy-phase1.test.ts` | `VERIFIED_LOCAL` |
| P08 | Committed replay works after confirmation consumed; changed payload rejected | `src/domain/pharmacy-inventory.ts`, `src/domain/clinic-writes.ts` (`commands`, `action_proposals`) | `tests/pharmacy-phase1.test.ts` + `tests/clinic-writes-pos.test.ts` | `VERIFIED_LOCAL` |
| P09 | Lost response & printer failure do not duplicate sale/charge | `src/domain/pharmacy-pos.ts` (`commands`, `pos_receipts`) | `commands` + immutable `pos_receipts` | `IMPLEMENTED_UNVERIFIED` |
| P10 | Owner without professional grant cannot release required dispensing/holds | `src/domain/capabilities.ts`, `src/domain/pharmacy-inventory.ts`, `src/domain/pharmacy-pos.ts` | `tests/pharmacy-phase1.test.ts` + `tests/clinic-writes-pos.test.ts` | `VERIFIED_LOCAL` |
| P11 | Critical cart change/revoked grant invalidates professional release | `src/domain/pharmacy-pos.ts` (`pharmacist_checkout_approvals`, `computeCartHash`) | `tests/clinic-writes-pos.test.ts` (`CART_HASH_MISMATCH`) | `VERIFIED_LOCAL` |
| P12 | GRN posting retry & supplier invoice never duplicate inventory | `src/domain/pharmacy-inventory.ts` (`goods_receipts`, `supplier_invoices`) | `tests/pharmacy-phase1.test.ts` | `VERIFIED_LOCAL` |
| P13 | Excess return/refund blocked; returned medicine quarantined | `src/domain/pharmacy-pos.ts` (`createPosReturn`) | `tests/clinic-writes-pos.test.ts` (`returnedQuarantineQty`) | `VERIFIED_LOCAL` |
| P14 | Cash change/split tender/close/refund reconcile exactly | `src/domain/pharmacy-pos.ts` (`till_shifts`, `till_cash_events`, `pos_payments`) | `tests/clinic-writes-pos.test.ts` | `VERIFIED_LOCAL` |
| P15 | Stocktake cannot overwrite intervening movements | Phase 2/3 Stocktake | Phase 2/3 | `NOT_STARTED` |
| P16 | Expiry month/day boundary & unknown expiry handled by verified policy | `src/domain/pharmacy-inventory.ts` | `tests/pharmacy-phase1.test.ts` | `VERIFIED_LOCAL` |
| P17 | Reports/speech/export share exact totals & incomplete-cost labels | Phase 4 Reports | Phase 4 | `NOT_STARTED` |
| P18 | Voice ambiguity/noise/mic denial/model outage preserves manual operation | `src/adapters/gemini.ts`, UI pages | Phase 1 manual UI + Phase 4 voice | `IMPLEMENTED_UNVERIFIED` |
| P19 | Malicious names/docs cannot execute instructions or expose records | `src/adapters/gemini.ts`, parameterized Drizzle SQL | Unit + Phase 1 checks | `IMPLEMENTED_UNVERIFIED` |
| P20 | Quota/downgrade never disables mandatory safety controls | `src/domain/capabilities.ts` | `tests/pharmacy-phase1.test.ts` | `VERIFIED_LOCAL` |
| P21 | Transfer partial receipt/loss preserves custody balance | Growth Gate | Deferred (Growth) | `DEFERRED` |
| P22 | Restore reapplies revocations, deletion & recalls; old events suppressed | `docs/migration-plan.md` | Phase 6 PITR | `DEFERRED` |
| P23 | Hardware/keyboard/screen reader/mobile & Sinhala print tests recorded | Hardware Matrix | Human device testing | `BLOCKED` |
| P24 | External payment uncertainty/webhook duplication reconciled | Gateway Gate | Deferred (Gateway) | `DEFERRED` |
| P25 | Reconciled opening stock per SKU/lot/UOM/cost signed off | `src/domain/pharmacy-inventory.ts` (GRN / opening balance) | `tests/pharmacy-phase1.test.ts` (GRN mechanism verified) | `VERIFIED_LOCAL` (Mechanism) |
| P26 | Load test includes real PostgreSQL locks & connection budget | `tests/` + Cloud SQL pool | Phase 6 load test | `DEFERRED` |
