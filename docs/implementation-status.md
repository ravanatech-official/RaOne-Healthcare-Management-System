# Implementation Status

**Last Updated:** 2026-11-18 (Asia/Colombo)  
**Target Pilot Date:** 2026-12-01 (Gated supervised pilot; subject to U01–U24 and P01–P26 release gates)

## Evidence Classification Legend
- **Reported by owner:** Stated by the stakeholder, NOT observed in repository or runtime.
- **Observed in source code:** Present in files in this workspace (`IMPLEMENTED_UNVERIFIED` until executed).
- **Tested locally:** Executed locally against real Cloud SQL PostgreSQL (`ai-studio-77df7681`) or Vitest (`VERIFIED_LOCAL`).
- **Verified in staging / production:** Executed in deployed staging/production environment (`NOT RUN` currently).

---

## 1. Reported by Owner (Unverified / Absent in Workspace)
- **"Clinical system has already been built":** Owner reports clinical system completion. **Observed reality:** No clinician EHR, clinical notes, diagnosis engine, e-prescribing, or clinical digital signature codebase exists in this workspace. Automated clinical handoff (`U08–U10`, `U24`) is therefore **NOT VERIFIED / ABSENT** (`BLOCKED`) and must not be marked integrated.

## 2. Observed & Verified in Source Code (Clinic Administrative Baseline — Preserved)
| Capability | State | Evidence / Notes |
|---|---|---|
| Cloud SQL PostgreSQL (`ai-studio-77df7681`, `asia-south1`) | `VERIFIED_LOCAL` | 47 tables (17 clinic + 30 platform/pharmacy/POS/till), `btree_gist` exclusion constraint (`appointments_no_resource_overlap_excl`), composite tenant FKs |
| Firebase Auth (`auth/internal-error` ADC fallback) + Membership + Role Revocation (`T01-A..E`) | `VERIFIED_LOCAL` | `src/middleware/auth.ts` verifies RS256 JWKS cleanly & falls back safely on ADC `getUser` infra errors; `tests/tenant-isolation.test.ts` (8/8 passed) |
| Controlled Owner Onboarding (`POST /api/v1/onboarding/bootstrap`) | `VERIFIED_LOCAL` | Supports `clinic_only`, `pharmacy_inventory_only`, `pharmacy_retail_only`, `combo` |
| Today Board & Clinic Write Slice (`/api/v1/clinic/*`) | `VERIFIED_LOCAL` | Patient CRUD w/ `POSSIBLE_DUPLICATE_PERSON` disambiguation, `btree_gist` `APPOINTMENT_OVERLAP` guard, Draft -> Confirm `action_proposals`, Clinic receipts + Owner step-up void (`tests/clinic-writes-pos.test.ts`) |
| Bilingual Shell (`si-LK` / `en-LK`) & Capability-Aware `HomeAssistantPage` | `IMPLEMENTED_UNVERIFIED` | `HomeAssistantPage` capability-gated (no 403 on pharmacy-only modes); `si-LK` translations wired across clinic & pharmacy pages; browser walkthrough pending |
| Read-Only Administrative Assistant (`POST /api/v1/assistant/interpret`) | `IMPLEMENTED_UNVERIFIED` | Clinical boundary unit test passed; Draft -> Confirm proposal execution verified locally; live Gemini browser call unverified |

## 3. Combined ERP Phase 1 & Phase 2 Scope (Implemented & Locally Tested)
| Capability | State | Evidence / Notes |
|---|---|---|
| Shared Platform Entities (`legal_entities`, `departments`, `counters`) & Product Modes | `VERIFIED_LOCAL` | `src/domain/capabilities.ts`, `src/domain/tenancy.ts`, `src/routes/platform.ts` |
| Non-Disableable Safety Controls (`safety.*`) & Dependency Closure | `VERIFIED_LOCAL` | `tests/pharmacy-phase1.test.ts` verifies `pharmacy_retail_only` closure & lock rejection |
| Professional Authority Grants (`professional_grants` — Owner != Pharmacist/Clinician) | `VERIFIED_LOCAL` | Issue/revoke + `assertProfessionalGrant` verified against PostgreSQL |
| Pharmacy Catalogue & Versioned UOM (`products`, `pack_variants`, `uom_conversions`, `barcode_aliases`) | `VERIFIED_LOCAL` | Strength/form separation, barcode collision flags, immutable UOM versioning verified |
| Goods Receipts (GRN), Cost Layers, Quarantine Splits & Expiry Precision (`day`/`month`/`unknown`) | `VERIFIED_LOCAL` | Idempotent `commands`, bonus unit cost dilution, unknown-expiry forced quarantine verified |
| Separate Supplier Invoices (`supplier_invoices` with zero stock side-effects) | `VERIFIED_LOCAL` | `tests/pharmacy-phase1.test.ts` confirms unchanged balances/movements (`P12`) |
| Pharmacy Phase 2: Retail POS, FEFO Lock Ordering, Cart-Hash Gate, Returns & Till Shifts | `VERIFIED_LOCAL` | `tests/clinic-writes-pos.test.ts` verifies strict FEFO skipping recalled lots, `CART_HASH_MISMATCH` approval invalidation, split tender + change, `PRCP-*` receipts, `returnedQuarantineQty` returns, and till blind variance (`P04–P06`, `P10–P14`, `U17`) |
| Clinic & Pharmacy UI Screens (`HomeAssistantPage`, `TodayBoardPage`, `PharmacyPosPage`, `PharmacyCataloguePage`, `PharmacyReceivingPage`, `PharmacyStockPage`, `PlatformModulesPage`) | `IMPLEMENTED_UNVERIFIED` | Typechecked & compiled (`tsc`, `vite build`); interactive authenticated browser click-through pending |

## 4. Not Implemented / Deferred Beyond Current Scope
- **Clinical Bridge (`U08–U10`, `U18`, `U24`):** Clinic-to-Pharmacy handoff state machine remains `BLOCKED` until clinical EHR/prescribing source codebase exists.
- **Phase 4 (Combined Reporting & Stocktake):** Unified double-count-safe cross-domain revenue report (`U16`, `P17`), stocktake optimistic reconciliation (`P15`), near-expiry/reorder reports, and pharmacy administrative voice tools (`find_stock`, `get_expiry_report`, `draft_reorder`).
- **Phase 5–6 (Scale, Drills & Hardware):** Outbox worker, quota metering, CSV exit exports, Cloud SQL restore quarantine drill (`U20–U21`, `P22`), load tests (`U23`, `P26`), native Sinhala usability study (`U22`), and physical thermal printer / barcode scanner validation (`P23`).
