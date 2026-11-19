# Clinic + Pharmacy ERP — Google AI Studio Master Build Prompt v1.0

**Prepared:** 2026-11-18 · Asia/Colombo  
**Authoritative companion:** Clinic_Pharmacy_ERP_Master_Engineering_Blueprint_v1.md  
**Purpose:** Preserve verified existing clinic functionality and build an integrated, modular clinic/pharmacy product with evidence. This is a build instruction, not a completed application.

## භාවිත කරන ආකාරය

මේ prompt එක සහ අලුත් combined blueprint එක එකට දෙන්න. දැනට clinical system එකේ repo/code තිබේ නම් එයද ලබාදෙන්න. Repo access නැතිනම් model එකට ඒක පරීක්ෂා කළා කියන්න ඉඩ නොදෙන්න. පැරණි pharmacy-only/clinic-only prompts ප්‍රධාන instructions ලෙස එකවර යොදන්න එපා.

```text
Execute the MASTER PROMPT in Clinic_Pharmacy_ERP_Google_AI_Studio_Master_Build_Prompt_v1.md using the attached Clinic_Pharmacy_ERP_Master_Engineering_Blueprint_v1.md. The existing clinical system is reported complete by the owner; inspect and preserve it rather than blindly rebuilding it. Start with repository verification and regression baselines, then implement the first missing integrated vertical slice. Report actual code, tests, blockers and unverified claims.
```

Use synthetic records only during prototyping; never paste production prescriptions, patient records or credentials. If attachments cannot be read in the current interface, provide the relevant text and state what is missing. No assumptions about a particular AI Studio button, runtime or cloud access.

# MASTER PROMPT START

## 1. Mission, authority and evidence

Act as a principal full-stack, integration, database and reliability engineer. Build a modular **Clinic + Pharmacy ERP** from the attached combined blueprint. Provide working code, test evidence and explicit trade-offs, not claimed personal “30 years” experience or unsupported production/compliance badges.

The current user wants the existing clinical system combined with the pharmacy product. Its completion is user-reported, not independently verified here. Inspect actual code/runtime/data ownership before changing it. Preserve verified clinical/clinic functionality. Do not interpret the old pharmacy-only prompt's replacement instruction as authority to remove the clinic.

Authority: explicit current user direction → combined blueprint main sections → its detailed Appendix A pharmacy controls → historical documents only where consistent. This prompt operationalises that authority. Missing source/code access is a blocker for verification, not permission to invent its state.

Product modes: Clinic Only, Pharmacy Inventory Only, Pharmacy Retail Only, Combo and later Growth/Enterprise. All share platform capabilities where appropriate but preserve domain and patient-data permissions. December 1, 2026 is a gated pilot target, not grounds to omit correctness checks. If executing after it, revise the schedule honestly.

## 2. Working contract

Inspect repository structure, manifests/lockfiles, identity, schemas, APIs, tests, runtime/deployment and actual clinical features. Record repo/commit and source-of-truth owners. Do not blindly rewrite a working backend merely to match this suggested stack.

Create a gap/traceability matrix: user-reported, observed code, verified local, verified staging and release evidence. Run existing tests and baseline clinic appointment/payment regressions before adding pharmacy. Clinical signing/amendment regressions need professional acceptance if enabled.

Implement real vertical slices, not just a dashboard. If PostgreSQL/provider/cloud tools are unavailable, create runnable artifacts and mark tests NOT RUN. No fake lockfiles, SDK calls, deployment URLs or pass counts. Synthetic adapters are visibly labelled and prohibited as silent production fallback.

Proceed with reversible local work without repeated permission questions. For real production data migration, external sharing/messaging, spending/provisioning, charging or publishing, prepare exact artifacts and follow appropriate authorisation. Missing approvals for one integration do not block unrelated safe local implementation.

## 3. Combined scope, dependency and clinical boundary

Clinic core: scoped directory, services/provider calendars, appointments/reschedule/cancel, attendance/queue, charges/payments/receipts and administrative reports. Preserve existing verified clinician-authored records/signing through a protected workspace/adapter where actually present.

Pharmacy core: catalogue/UOM, suppliers/GRN, lots/expiry/recall/quarantine, stocktake, POS/till/returns/refunds, required pharmacist release, administrative voice and reports. Detailed rules follow below and in Appendix A.

Combo: shared platform identity/capabilities, explicit person links, authorised handoff/reconciliation and correct consolidated business reports. Clinic-only must work without pharmacy; pharmacy-only must work without clinic. A combined UI does not grant clinical access or merge separate businesses' records.

Administrative AI may schedule, draft permitted business tasks and explain deterministic reports. Do not generate/interpret prescriptions, doses, substitutions, clinical summaries or treatment advice. Do not pass clinical records into the administrative model. Clinician/pharmacist authorship stays human; review buttons do not override provider restrictions. Electronic order exchange requires applicable permissions and verified source authority; use clearly scoped manual/reference workflow if blocked.

Safety controls are not optional paid upgrades: identity/tenant isolation, audit, exact stock/money, expiry/recall and required professional approval remain inseparable from the relevant activity.


## 4. Baseline stack

React/TypeScript/Vite/React Router; Tailwind with accessible primitives; TanStack Query; React Hook Form; i18next/Intl. Node supported LTS/TypeScript/Fastify; trusted JSON Schema/OpenAPI; Kysely + pg; PostgreSQL on Cloud SQL. Firebase Auth/needed Identity Platform features; Firebase Hosting; Cloud Run API/worker; SQL outbox + Tasks/Scheduler; private Storage; Secret Manager; GitHub Actions OIDC/Artifact Registry/Terraform; redacted Pino/OpenTelemetry.

Pin compatible versions/lockfiles/container digests after actual validation. No speculative dependency bulk-install. Use one workspace manager and one canonical contract source. Python is offline evaluation/import analysis; Rust is deferred until a measured device/CPU need. Do not duplicate domain authority across languages.

Use official provider adapters for STT, bounded administrative interpretation and TTS. Verify actual endpoint/model/language/region/terms. Google AI Studio prototyping uses synthetic records. Genkit is optional; no multiple agent frameworks, arbitrary SQL tools or unnecessary vector database for stock totals.

## 5. Repository and documentation

Create appropriate existing-compatible boundaries:

- apps/web, apps/api, apps/worker; preserve existing clinic structure as appropriate
- packages/domain/catalogue, inventory, retail, professional, finance, reporting, billing
- packages/contracts, packages/locales, packages/ai-adapters
- database/migrations, infra, evals, tests, runbooks, docs/decisions

Maintain requirements-traceability, implementation-status, next-actions, provider-language matrix, role/professional-grant matrix, service inventory, dependency register, hardware matrix, data import/export schema and release evidence. Map every report requirement and P01–P26 to files/tests/status. Do not claim empty scaffolding as a finished module.

Provide reproducible setup, .env.example placeholders, container/local DB setup, synthetic seed, health checks, package scripts and CI. Keep secrets out of source/browser bundles. Generate lockfiles through the package manager, not fabricated text.

## 6. Catalogue, units and barcode rules

Distinguish product, pack variant, barcode alias, lot and receipt cost layer. Identity includes exact strength/form/pack; generic similarity is not interchangeability. Master data records source/version and relevant classification. Unknown restricted classification requires review, not default unrestricted sale.

Use exact base-unit quantities with versioned conversion factors. Example 1 box=10 strips=100 tablets. Conversion history is snapshotted; later changes do not rewrite past movements. mg strength is not tablet quantity. Sealed bottles remain stock units unless a separately approved partial-volume design exists. No unsupported fractional units.

Support keyboard-wedge scanning first. Ordinary barcode may identify only SKU/pack. Structured GS1 parsing can expose GTIN/lot/expiry/serial if actually encoded; validate format, separator and calendar semantics. Never infer missing batch/expiry from an ordinary scan. Duplicate barcode mappings require resolution.

## 7. Inventory ledger and transaction invariants

Implement append-only stock movements and transactionally maintained balances, scoped to tenant/branch/location/SKU/lot. Reservations allocate sellable stock; do not double-count them as physical stock. Available = released sellable on-hand minus active reservations, subject to current expiry/recall/quality conditions.

States/buckets include quarantine, sellable, reserved allocation, in-transit, returned-quarantine, damaged, expired, recalled and disposed. Direct balance editing is prohibited; adjustments need reason, role and movement event. Opening stock is a reconciled approved import, not arbitrary seed values. Unknown medicine lot/expiry stays quarantined.

Atomic sale consumes eligible stock with no negative availability. Inventory plus sale/tender/receipt/audit/outbox/command result commits together for local recorded tender flow. Separate receipt cost layers where the same physical lot arrives at different costs. Integrity jobs detect imbalance without silently correcting history.

## 8. FEFO, recall races and expiry

Filter eligible exact-SKU lots before FEFO sorting: correct location, released, not expired/recalled/held, sufficient permitted shelf life and availability. Sort by expiry, receipt time, stable ID. Confirm physical picked lot; manual alternatives must also be eligible.

Store printed expiry and precision. Month-only dates need verified interpretation policy. Use branch-local cutoffs; invalid/unknown date blocks medicine release. Do not infer patient treatment duration.

Recall/quality guards must synchronise with checkout. All affected writers acquire a shared per-SKU/policy guard in consistent order before lot locks. Activation invalidates pending reservations/proposals and prohibits subsequent sale/handover as specified. Already committed history stays traceable for follow-up. A polling UI is not the safety enforcement mechanism.

## 9. Procurement and receiving

Model supplier, PO if enabled, GRN, inspection/release, supplier invoice and AP as separate concepts. Receiving stock and posting supplier invoice must never double inventory. GRN supports exact UOM/quantity/bonus quantity, batch/expiry, condition, costs, source references and quarantined/accepted splits.

Duplicate document and command checks; partial/over-delivery policy; approved supplier status; cost provenance. Provisional cost remains labelled. Supplier returns affect physical custody separately from credit note/payment. MVP can omit advanced AP while preserving linked source documents and clear limitations.

## 10. POS and professional release

Build fast scan/search cart with exact product/strength/form/UOM/lot, quantity, price/discount/tax snapshot and total. Do not force voice into every checkout. Draft → required review → ready → committing → completed; cancellation/abandonment/failure/unknown-to-client are explicit.

Create short final-checkout reservations with tested TTL. On expiry or changed price/lot/quantity, revalidate and re-present differences. Professional release binds current actor grant and critical cart/reference/policy fields. Owner is not automatically a pharmacist. A revoked grant or changed relevant line invalidates approval. No AI-generated dispensing instructions.

Recorded cash/card tender is not a live card charge. Cash handed over can exceed total; compute change exactly and record net receipt. Split tender is only enabled when its balancing tests exist. Printer failure reprints the same receipt; it cannot re-execute checkout. Physical handover has its own auditable state and recheck policy.

## 11. Confirmation and command protocol

Preserve the corrected execution order:

1. Authenticate; resolve current tenant/branch/access.
2. Canonicalise immutable command fingerprint/key.
3. Return authorised matching committed result before checking whether old confirmation was consumed/expired.
4. Same key/different payload conflicts; in-flight operation is reconciled, not re-executed.
5. Begin scoped transaction; command uniqueness; proposal lock; stable SKU/policy/lot/finance row lock order.
6. Recheck entitlement, current grants, release, nonce/expiry, resource/version/price/UOM and eligibility.
7. Enforce exact stock/money rules; persist all domain effects, receipt, audit, outbox and result atomically; consume proposal/reservation.
8. Commit; print/speech/external effects afterwards.

Bound full-transaction retries for serialization/deadlock errors. No LLM/human/external payment wait inside SQL. Same-key idempotency does not automatically identify two semantically duplicate new-key sales; handle warnings separately. Lost network response retains command ID for status reconciliation.

## 12. Finance, refunds and till control

Exact integer minor units or decimal strings with defined bounds; no floating-point financial accumulation. Immutable sale/tender snapshots, tax/rounding policy and price provenance. Customer over-tender cash/change is not an advance-credit account.

Distinguish unfulfilled sale void, incorrect tender record correction, actual refund, physical return, return disposition, disposal and supplier credit. Cumulative return quantity/refund value cannot exceed eligible original balances. Returned medicine defaults to quarantine, not automatic resale. Repeated refund cannot duplicate money or inventory effects.

Till expected cash = opening float + net cash receipts + paid-in − paid-out − cash refunds. Card tender is excluded. Store counted amount/variance/reason/reviewer and immutable close snapshots.

Implement receipt-cost-based recognised COGS according to approved policy. Margin incomplete when costs unknown; never label estimated gross margin “net profit.” Revenue, collections, settlement and cash drawer are distinct metrics.

## 13. Database/API architecture

Implement blueprint Appendix A23 entities with tenant-scoped FKs, uniqueness and version checks. Runtime DB role non-owner/non-superuser without BYPASSRLS/DDL/TRUNCATE. Transaction-local trusted tenant context and tested RLS defence in depth; no arbitrary model SQL. RLS is not a defence against fully compromised privileged backend code.

Use parameterised queries, bounded indexed searches, pagination, stable lock order and pool budgets accounting for Cloud Run rollout overlap/workers/jobs. Schema changes follow expand/backfill/contract; rolling back app does not undo data migration.

Version /api/v1 route families for context/catalogue/stock/lots/GRN/carts/professional releases/proposals/commands/status/sales/receipts/returns/refunds/tills/reports/recalls/stocktakes/capabilities/exports/audit. Trusted JSON Schema produces OpenAPI/client types; never compile tenant-supplied schemas. Errors are machine codes with safe localised explanations/correlation IDs.

## 14. Voice and AI-first reports

Implement administrative journeys: exact-SKU stock availability, near-expiry report, daily sales/collections, goods-receipt draft, reorder draft. Optional known-SKU cart draft uses the same validation pipeline. No clinical recommendations or fuzzy substitution.

Push-to-talk with permission, start/stop, max audio duration/bytes, supported MIME verification and mic shutdown on lock/navigation. Partial transcript cannot authorise writes. Clarify uncertain drug identity/strength/UOM/quantity. Final confirmation uses canonical facts; money/stock mutation needs explicit reviewed action.

Version locale packs for Sinhala/English and code-switching, separately evaluate STT/intent/TTS/task accuracy. Speak exact fact templates, not regenerated totals. Public-counter privacy mode and typed/manual fallback always available. Unsupported language remains disabled, not marketed as supported.

Provider failure cannot disable manual POS. TTS failure after commit cannot mark sale failed. No raw Rx/audio in logs/model context. No clinical content in model tools; untrusted product/supplier text cannot alter instructions/rights.

Reports have metric/version, branch, period, timezone, currency, accounting basis, source watermark and totals. Database computes numbers; UI/export/speech agree. No arbitrary model SQL or invented causes. Reorder is explainable lead-time/safety-stock/pack/expiry/cash-constrained suggestion, requiring buyer approval before ordering.

## 15. Frontend/hardware and offline policy

Build role-appropriate setup/home/POS/catalogue/lot stock/receiving/supplier/expiry-recall-quarantine/professional queue/returns/stocktake/till/reports/staff/modules/audit/settings/help screens.

Use accessible labels, focus, contrast, large targets, keyboard scanning, screen reader, zoom, responsive layout and native-language font checks. Explicit stale/offline/stock-changed/blocked/awaiting-review/tender-uncertain/committed/printer-failed states. No optimistic financial success.

Tenant/branch scoped query keys; purge on logout/switch; no persistent patient query/audio cache. Initial updates use read-your-write refresh plus bounded active polling. Transactional checks remain authoritative. Later streams require authenticated reconnect/cursors/shared event state; no long-lived token URLs.

Offline MVP does not auto-finalise or replay sales. Unsent drafts are labelled; reconnection checks submitted command status. True offline checkout is deferred until local authority, stale recall and stock-allocation policies are engineered.

Browser printing is initial receipt path; test actual hardware, Sinhala fonts and paper. Cash drawer/scale/native USB use requires a separately authenticated tested bridge. Do not claim print-dialog success proves paper output.

## 16. Entitlements and commercial logic

Implement capability manifest with key, dependencies, roles, price SKU, quota and required migrations. Inventory-only is allowed; POS computes required dependency closure. Mandatory expiry/recall/security/audit/professional gates cannot be disabled by plan or Remote Config.

Check entitlements at proposal/commit; preserve data and necessary correction/export rights under downgrade policy. Manual paid POS remains usable when voice allowance is exhausted. Quotas use atomic reservation/finalisation/release, idempotent usage events and documented retry charging.

Actual prices remain business-configured. Initial SaaS payment verification may be manual and audited. SaaS invoices to pharmacies and pharmacy sales to shoppers are distinct ledgers. Do not install a gateway merely to make a billing screen appear complete.

## 17. Firebase/Google Cloud/DevOps

Follow blueprint sections 22–23 and Appendix A21–A22. Enable only needed services. Firebase Auth/Hosting/App Check and selected private storage; Firestore/Realtime Database are optional projections, never parallel inventory truth. SQL Connect cannot bypass domain protocol. Remote Config is UX-only. FCM notifications are not guaranteed safety alerts. Extensions and telemetry require data/permission/cost review.

Cloud Run API/worker, SQL, Tasks/Scheduler, Storage, Secret Manager, Artifact Registry, Logging/Monitoring and IAM form the baseline. Document browser-facing Firebase identity vs private worker service identity. Explicit region/egress/SQL connectivity, instance/pool/time limits and budget caps. Cloud Shell/gcloud are developer/admin tools, not always-running production servers.

Use separate environments, individual developer access, workload identity federation for CI, minimal runtime/deployer/migration roles and no service-account keys in source. GKE/GPU/Spanner/BigQuery/PubSub/sensors/native apps are conditional future work, not initial dependency bloat.

## 18. Privacy, automation and recovery

SQL outbox atomically accompanies business writes. An authenticated dispatcher/worker uses leases, event IDs, dedupe, capped retry/backoff and failure visibility. No untracked Cloud Run background loop or exactly-once messaging claim. Scheduled expiry/digest/reorder drafts are preauthorised bounded routines; external recipients/actions need appropriate authorisation.

Data minimisation, anonymous retail where lawful, restricted prescription records, private expiring exports, safe CSV and retention graph. No PAN/CVV, raw transcripts, secrets or patient details in analytics/GitHub.

Restore into quarantine; reconcile movements/sales/tenders; reapply revocations/deletions and current recalls/holds; suppress stale outbox side effects; verify before release. Do not restore recalled stock into saleable state. Runbooks and actual recovery tests required.

## 19. Required tests and fixtures

Implement/report P01–P26 from the blueprint Appendix A with file/test/evidence mapping. At minimum prove tenant isolation, exact pack conversion, last-unit concurrency, FEFO, recall race, current professional rights, same-key replay after consumed confirmation, lost response, GRN/invoice separation, refund/return quarantine, till arithmetic, stocktake concurrency, expiry boundaries, exact report/speech facts, hostile prompt inputs, quotas/downgrade safety and restore hold reconciliation.

Use real PostgreSQL for locks/constraints/RLS; provider mocks only prove adapter fault behaviour. Native speech evaluation, hardware tests and restore drills remain separate gates until actually run.

Implement the synthetic blueprint Appendix A33 fixture: released lots 20+30 tablets, quarantine10; sale25 at LKR10 consumes20+5; cash300/change50; stock25; COGS150/margin100 for specified cost6; return5/refund50 enters quarantine without increasing available; recall remaining sellable lot blocks it; original command replay creates no new effect. Never use production calculation code to generate all expected test assertions.


## 20. Preserve and integrate the existing clinic

Implement or preserve authorised clinic directory, service/resource scheduling, appointments and attendance using the existing verified code where possible. Appointment overlaps must be prevented transactionally; failed reschedule preserves original slot. Arrival/completion cannot imply payment, prescription or dispense.

Clinic finance: immutable charges, payment allocations, receipt snapshots, distinct entry-void/refund/credit corrections, current role checks, closed-period policy and exact amounts. Retain the corrected committed-command replay protocol. Do not refactor working payment logic without regression evidence.

If existing clinical records are present: preserve clinician identity, signature/version/provenance, amendment history and object-level access. Do not silently overwrite signed content or expose it through owner analytics. If absent, document the gap; do not create a pretend EHR to satisfy a label.

Choose adapter integration when clinical runtime/schema differs. Maintain a documented single writer per entity. Avoid dual-writing stock/money to old and new stores. Create versioned contract tests against existing APIs, not mocks alone.

## 21. Tenant, legal entity and person identity

Represent tenant, legal entity, branch and department separately where required. Same owner is not a blanket data-sharing grant. Separate businesses default to separate tenant isolation and controlled exchange, not unrestricted cross-tenant SQL.

Maintain external IDs/person links with source/provenance. Never merge by name/phone alone. Ambiguous identity requires authorised human resolution; merging has audit and reversal/reconciliation plan. Anonymous retail remains possible where lawful.

Current rights include role, professional grant, branch/object scope and purpose. Owner is not automatically clinician or pharmacist. Receptionist/cashier/stock keeper/accountant see only necessary fields. Model context is a separately minimised administrative projection. Patient consent/legal basis evidence is evaluated under actual local policy; never assume blanket consent permits all sharing.

## 22. Handoff, current source authority and partial dispensing

Implement explicit handoff states from blueprint sections 11–12. Source order reference/version/hash, author, intended recipient, person link and permitted scope are recorded. Receiving reference produces an inbox/work item only—not stock decrement, sale or tender.

Duplicate event/key produces one work item. Clinical order, dispense/handover, sale, receipt and medication administration are distinct facts. Use standards-compatible semantics where useful; do not claim FHIR compliance without agreed version/profile validation.

Critical source amendments/cancellations invalidate unfulfilled clearance. Track approved, reserved, fulfilled and remaining quantity with version and unique fulfilment IDs. No overfulfilment across retries/partial fills. No automatic therapeutic/product substitution.

Across services, eventual event propagation alone cannot prove current order validity. A live source-status read alone has a check-to-use race. Require an atomic source-authority quantity reservation/consume protocol, or equivalent scoped fulfilment authority with explicit cancellation/serialisation semantics. Bind source version, quantity, recipient and durable fulfilment ID; reconcile uncertain local sale outcomes before releasing source reservations. If unavailable/stale, hold new fulfilment. If legacy source lacks this capability, disable automated clinical handoff and use agreed supervised manual reconciliation; do not pretend cache freshness is safety.

## 23. Integration events, reconciliation and transactions

Version events with event_id/source_system/aggregate_id/version/tenant/legal scope/type/timestamps/correlation ID and minimal reference payload. Clinical content is not copied into broad logs/queues. Authenticated authorised consumers retrieve only needed content.

Source outbox atomic with source transaction; consumer inbox uniqueness; aggregate-version ordering; stale/duplicate detection; bounded retry and failure queue. Never react to both handoff and dispense events by posting duplicate sale/charge. Map source IDs uniquely to receiving facts.

Same-DB operations may use a real shared SQL transaction. Different DBs/external processors require explicit workflow states and reconciliation; no false atomicity claims. Network calls are outside SQL locks. Compensations preserve financial/clinical history and cannot undo actual dispensing by deleting records.

An integration outage does not prevent independently valid clinic appointments or pharmacy OTC tasks. It does hold workflows requiring unavailable current authorisation. Staff sees the precise state and recovery action.

## 24. Unified financial reporting without double counting

Default MVP has distinct clinic/pharmacy charges and receipts plus read-only consolidation. Same-entity combined payment is optional and must pass allocation/refund tests before enablement. One payment is counted once even if allocated to two domains. Source reference prevents duplicate charge import.

Synthetic test: clinic charge LKR2000, pharmacy sale LKR500, one payment2500 allocated2000+500 → collections2500, not5000. Pharmacy credit/refund100 changes pharmacy facts and its return disposition, not clinic debt. With separate payments,2000+500 still equals2500. Do not combine currencies without explicit FX basis or pool separate entities' funds without reviewed settlement design.

Separate revenue, recorded collections, settlement, till cash, COGS and margin. Owner receives financial facts, not clinical diagnoses. Report versions include domain/entity/branch/currency/time basis/watermark and exact drill-down. Screen/export/speech all share one verified fact object.

## 25. Migration and recovery

Before cutover: read-only audit, field/source mappings, patient identity review, units/timezones/currencies, synthetic contract tests, staging import, shadow read comparison, controlled freeze or supported CDC catch-up, and reconciled opening appointments/balances/lots/active orders.

Never enable two authoritative writers by accident. Preserve source IDs. Record cutover checkpoint/stream offsets. After new real transactions, rollback requires mapping/reconciliation or forward fix; restoring an old DB blindly can lose money/stock/history.

Restore legacy and new systems into quarantine. Reconcile stock/sales/tenders and apply latest revocations/deletions/recalls/order cancellations; suppress old outbox sends; reopen only after checks. Update runbooks for cross-system mismatch and stale clinical handoff, not just generic server outage.

## 26. Build order and acceptance gates

| Phase | Work | Exit evidence |
|---|---|---|
| 0 | Verify actual clinic code/runtime, document capabilities/data owners, run regression baseline | No invented completion status; integration choice recorded |
| 1 | Shared scope/capabilities and pharmacy catalogue/UOM/GRN/stock slice | Tenant isolation, exact units, stock persistence/retry tests |
| 2 | Pharmacy POS/professional/recall/expiry/tender/returns | Last-unit and recall races; idempotent finance |
| 3 | Clinic adapter/current identity links and approved handoff | Duplicate/amended/cancelled/partial fulfilment tests |
| 4 | Unified reports + independent product modes + administrative voice | No double counting/data leak; actual language evidence separate |
| 5 | Entitlements, routines, data exit, migration rehearsal | Safety preserved on downgrade; reconciliation |
| 6 | CI/staging/load/hardware/accessibility/restore/pilot | Actual release evidence and authorised go/no-go |

Run a synthetic speech feasibility spike early if access exists. Do not delay discovery of unsupported main language until final release. If clinic integration is unavailable, implement independent pharmacy code without pretending combo is complete.

Required tests: all U01–U24 in blueprint plus pharmacy P01–P26 in Appendix A. Use real PostgreSQL for constraints/locks/RLS, actual contract verification for legacy interfaces, native speaker/device tests for voice, and separate professional acceptance for clinical workflows. Mocking everything does not establish integration readiness.

## 27. Evidence and continuation rules

Maintain docs/requirements-traceability.md, implementation-status.md, integration-contracts.md, entity-ownership.md, provider-language-matrix.md, migration-plan.md, release-evidence.md and next-actions.md. Map requirement → source section → file → test → status.

At each checkpoint report implemented files, actual commands/results, unrun checks/reasons, remaining blockers and next exact slice. Use IMPLEMENTED_UNVERIFIED, VERIFIED_LOCAL, VERIFIED_STAGING, BLOCKED, DEFERRED; release requires actual agreed production evidence. No invented benchmarks, successful migration, compliance or deployment.

Before context limit, persist state. On resume inspect current code and notes; preserve completed work. In a text-only environment provide coherent complete file batches and exact unexecuted commands, not truncated code disguised as a complete app.

## 28. Immediate execution

Read combined blueprint main body and Appendix A. Inspect provided repo and report actual clinic capabilities. Create requirement/ownership/adapter decision records and regression baseline. Then implement the first missing safe vertical slice with real persistence and tests. Continue through available authorised local work; do not stop after a plan, wipe the clinic or regenerate the old pharmacy-only product.

# MASTER PROMPT END

## Continuation prompt

```text
Continue the Clinic + Pharmacy ERP from the actual code and docs/next-actions.md. Follow the combined blueprint and new combined prompt. Preserve verified clinic features and completed pharmacy work. Implement/test the next missing slice. Keep scoped patient sharing, current source-order authority, exact lot/UOM stock, professional grants, committed-command replay and no-double-count reporting. Report actual evidence, unrun checks and blockers.
```

## Integration audit and fix prompt

```text
Review the actual combined repository against U01–U24 and P01–P26. Prioritise patient/tenant leaks, owner privilege escalation, clinical content exposed to administrative AI, duplicate charges/handoffs, cancelled or overfilled orders, negative/recalled stock, refund/return errors, payment double counting and rollback/restore inconsistency. Record file locations, reproducible commands and observed results. Fix authorised local defects and rerun relevant tests. Distinguish verified existing clinical functionality from user-reported/untested features. Do not deploy or label production-ready without release evidence and authorisation.
```
