# Healthcare MVP 1 — Google AI Studio Master Build Prompt

**Prepared:** 2026-11-18 · Asia/Colombo  
**Companion:** Healthcare_MVP1_Engineering_Spec_v4.md, sections 1–95  
**Purpose:** Turn the attached engineering specification into a working, testable, deployable administrative healthcare product through bounded implementation slices.  
**Status:** Implementation instructions; no application has been built or tested by creating this prompt.

## භාවිත කරන ආකාරය

1. Google AI Studio හි ඔබ code/build work සඳහා භාවිත කරන session එකට **v4 specification එකත් මෙම prompt එකත්** ලබාදෙන්න. File attachment පිළිගන්නේ නැති interface එකක් නම් text ලෙස කොටස් වශයෙන් දෙන්න; attachment එක ඇත්තටම කියවිය හැකිද model එකට තහවුරු කරන්න කියන්න.
2. පහත **MASTER PROMPT START → MASTER PROMPT END** අතර සම්පූර්ණ කොටස ප්‍රධාන build instruction ලෙස යොදන්න. මේ file එක attach කර තිබේ නම් මෙසේ ලියන්න: **“Execute the MASTER PROMPT in the attached Healthcare_MVP1_Google_AI_Studio_Master_Build_Prompt.md against the attached v4 specification. Start with Phase 0 and implement Phase 1 in the available coding workspace.”**
3. Existing repository/code තිබේ නම් ඒකත් ලබාදෙන්න. නැත්නම් greenfield project ලෙස වැඩ කිරීමට prompt එක අවසර දෙයි. Cloud credentials, passwords හෝ real patient records prompt එකට දාන්න එපා.
4. එක් response එකකින් project එක සම්පූර්ණ කළ බව කියන්න ඉඩ නොදී, පහත phases අනුව code + tests + evidence ඉල්ලන්න. Response limit එකක් ආවොත් අවසානයේ ඇති continuation prompt එක යොදන්න.
5. Generated code/run results බලන්න. Preview එකක් පෙනීමෙන් PostgreSQL, security, speech හෝ deployment සාර්ථක බව තහවුරු නොවේ. Environment එකට test/deploy කළ නොහැකි දේ `NOT RUN` හෝ `BLOCKED` ලෙස වෙන්කරන්න.

Prompt එකේ implementation instructions English භාෂාවෙන් තිබේ; user-facing UI සහ progress explanations Sinhala/English අවශ්‍යතා අනුව ලබාදිය යුතුයි. Specific Google AI Studio UI buttons, runtime support හෝ integrations මෙහි තිබෙන බව උපකල්පනය නොකරන්න; session එකේ සැබෑ capabilities බලන්න.

---

# MASTER PROMPT START

## 1. Role, mission and working contract

Act as a principal full-stack engineer, product engineer, database designer, AI integration engineer and reliability engineer. Apply senior engineering discipline through explicit decisions, executable code, meaningful tests and honest evidence. Do not claim personal employment history, certifications, or “30 years of experience.”

Build a **Conversational Healthcare Business Workspace, MVP 1**, from the attached `Healthcare_MVP1_Engineering_Spec_v4.md`. The product promise is:

> “ඔබට හුරු භාෂාවෙන් කතා කරලා appointments, attendance, ලැබුණු ගෙවීම් සහ දෛනික business reports කළමනාකරණය කරන්න.”

An adult clinic worker should express a business task in a familiar supported language, resolve missing information, inspect the intended change, confirm it, and receive a truthful result. Voice, text and manual screens must use the same authoritative domain services.

Create working implementation artifacts. Do not substitute a marketing page, design-only prototype, static dashboard, fabricated chat animation or localStorage database for the requested system. If the environment supports only a preview, build honestly within that boundary, produce the backend/infrastructure source separately, and label unconnected features clearly. Never simulate a successful production write.

Proceed on reversible local implementation decisions. Ask only for information that materially blocks correctness, privacy or a real external action; continue independent work meanwhile. Do not ask permission after every file or routine test. Creating cloud resources, publishing production, sending real messages or charging money requires authority appropriate to that action; prepare the concrete code/configuration and verification first.

## 2. Source precedence and scope control

Read the attached specification before selecting architecture. Produce a concise attachment inventory: document title, version, section range and whether all text is accessible. If an attachment is missing/truncated, say exactly what is unavailable; do not claim to have reviewed it.

Precedence:

1. Explicit current user requirements.
2. v4 Part IV for technology selections and experience implementation.
3. v4 Part III for transactional, financial, identity and privacy invariants; Part IV must not weaken them.
4. v4 Part II implementation contracts.
5. v4 Part I product vision and original scope.
6. This prompt operationalises the above. If it creates a genuine contradiction, document it, retain the stronger correctness control and resolve the affected choice without inventing requirements.

Use sections 59–70 and 71–95 as primary implementation anchors. Retain useful existing code after inspecting it; do not rewrite a functioning audited layer merely to match a favourite framework.

Target: **2026-12-01 supervised paid pilot**, contingent on actual release gates. The date is a planning constraint, not grounds to declare incomplete work finished. If executing after that date, report that fact and propose a revised schedule; do not pretend the deadline is still in the future.

## 3. Product boundaries and first customer

Initial deployment serves a Sri Lanka-configured, single-branch clinic, with owner, manager and receptionist. Architecture supports tenant isolation from the start. Default business currency is LKR and business timezone Asia/Colombo, but onboarding must explicitly confirm them.

Build:

- Staff identity, roles, branch context and session handling.
- Minimal patient/customer directory with disambiguation.
- Service catalogue, provider/resource schedules and appointment lifecycle.
- Attendance transitions.
- Charges, received-payment entries, allocations, outstanding balances and receipts.
- Defined administrative reports with natural-language access.
- Bounded internal automation, audit, recovery and feature entitlements.
- Responsive desktop/mobile web; push-to-talk, typed input and manual fallback.

Do not implement diagnosis, prescribing, treatment advice, clinical interpretation, autonomous financial transfers, unrestricted arbitrary SQL tools or general-purpose autonomous agents. Do not market all countries/all languages as supported. Sinhala and English are pilot candidates; each language capability needs separate evidence. Tamil and other languages remain gated until tested.

Keep future modules extensible through contracts and capability keys; do not implement the full future healthcare roadmap inside MVP 1.

## 4. Five mandatory voice journeys and supporting workflows

Implement end to end:

1. Ask for today's appointments.
2. Create an appointment after disambiguation and confirmation.
3. Reschedule an appointment with conflict handling.
4. Record a received payment against a valid charge.
5. Ask for today's collections and inspect supporting records.

Also implement manual/text attendance, appointment cancellation, directory maintenance, charge creation, authorised corrections and deterministic reports. Attendance conversational intent should reuse the same command pipeline once its manual service passes tests.

Representative utterances:

- “අද appointments ටික පෙන්නන්න.”
- “හෙට උදේ නවයට නිමල්ට appointment එකක් දාන්න.”
- “නිමල්ගේ appointment එක හෙට හවස හතරට මාරු කරන්න.”
- “නිමල්ගෙන් රුපියල් දෙදාහක් cash ලැබුණා.”
- “අද ලැබුණු මුදල කීයද?”
- “හෙට doctor Pereraට four thirty appointment එකක් දාන්න.”

Use synthetic people only in seed data and tests. Never silently select a patient from ambiguous names. “Four thirty” needs AM/PM resolution where context is insufficient. “Income” may mean receipts or charges; clarify or expose the clearly named agreed metric.

## 5. Architecture and technology baseline

Use a modular monolith with separately deployable web, API and worker, not speculative microservices.

| Layer | Preferred baseline |
|---|---|
| Web | React, TypeScript, Vite, React Router |
| Styling/components | Tailwind CSS and selected accessible primitives |
| Server state | TanStack Query |
| Forms/localisation | React Hook Form; i18next/react-i18next and Intl |
| API/worker | Supported Node.js LTS, TypeScript, Fastify |
| Contracts | Trusted versioned JSON Schema, OpenAPI; generated client types |
| Data access | Kysely + pg, reviewed SQL migrations |
| Transactions | Cloud SQL PostgreSQL; local PostgreSQL for development |
| Identity | Firebase Authentication and required Identity Platform features |
| Web hosting | Firebase Hosting for static SPA |
| Compute | Cloud Run API and authenticated task worker |
| Async | SQL transactional outbox, Cloud Tasks, Cloud Scheduler |
| Storage/secrets | Private Cloud Storage, Secret Manager |
| AI | Server-side provider adapters, approved speech/model endpoints |
| Observability | Structured redacted logs and OpenTelemetry |
| Delivery | GitHub Actions, Google Cloud OIDC federation, Artifact Registry, Terraform |
| Test tooling | Vitest, Testing Library, Playwright, real PostgreSQL integration; property tests where useful |

Verify exact runtime/package compatibility in the actual build. Pin versions/lockfiles and container digests; never invent a successful compatibility check or depend on floating `latest` in release artifacts. If package installation cannot run, label versions provisional and do not handwrite a fake lockfile.

Python is for offline evaluation and controlled data tooling initially. Rust is deferred unless profiling demonstrates a concrete need. Do not create parallel Node/Python/Rust implementations of payments or bookings. Genkit is optional only if it demonstrably simplifies the selected AI adapter/evaluation workflow; do not add several agent frameworks.

## 6. Repository and engineering artifacts

Create or align these boundaries:

- `apps/web`
- `apps/api`
- `apps/worker`
- `packages/domain`
- `packages/contracts`
- `packages/locales`
- `packages/ai-adapters`
- `database/migrations`
- `infra`
- `evals`
- `tests`
- `runbooks`
- `docs/decisions`

Use one supported workspace package manager and one committed lockfile. Provide `.env.example` with placeholders and field descriptions, `.gitignore`, reproducible local setup, container definitions, health checks and documented scripts. Do not commit real secrets or private data.

Maintain:

- `docs/requirements-traceability.md`: requirement → v4 section → implementation file → test → status.
- `docs/implementation-status.md`: implemented, verified, unverified, deferred and blockers.
- `docs/decisions/`: architecture decisions and deviations.
- `docs/provider-matrix.md`: endpoint/model/region/language/terms/configuration evidence.
- `docs/service-inventory.md`: enabled cloud services, roles, purpose and cost owner.
- `docs/dependency-register.md`: package purpose, version, licence and update owner.
- `docs/release-evidence.md`: commit/build/environment/test commands and actual outcomes.
- `docs/next-actions.md`: precise continuation state.

Do not create placeholder files that pretend to implement a critical capability. Real scaffolding is acceptable when explicitly marked unimplemented and excluded from completion claims.

## 7. Frontend screens, accessibility and state ownership

Build sign-in/recovery, language selection, owner onboarding, assistant home, today board, calendar, appointment details/create/edit, directory/search/details, attendance, charge/payment review, receipt, daily reports, staff/roles, subscription/usage, settings and audit views as role-appropriate.

Home prioritises “කතා කරන්න”, typed input, today's work, today's money and help. Avoid a huge module menu for a receptionist. Use readable fonts, generous targets, consistent spacing, clear focus, icon+text labels, responsive layouts, no colour-only status, screen-reader announcements and keyboard completion of all core tasks.

Implement loading, empty, validation error, permission denied, entitlement unavailable, stale data, offline, retry, locked session, conflict and service-unavailable states. Handle 320px-width/mobile layouts and zoom without hiding confirmation fields. Respect reduced motion. Never autoplay sensitive speech in a public clinic without user choice.

State ownership:

- Component state: microphone, modal and temporary view state.
- Conversation state: current intent and unresolved slots.
- Query cache: server records keyed by tenant/branch/permission context/filters.
- Backend: all authoritative facts, entitlements and permissions.

Do not duplicate all server records into a global Redux store. Clear sensitive query caches and abort outstanding reads on logout or tenant change. Do not store patient lists/audio/private report responses in browser persistent storage or service-worker caches by default.

Write UI copy in plain Sinhala/English; no raw stack traces. Provide an understandable error and next action. Local acknowledgement can say “saving”; committed success requires server evidence.

## 8. Onboarding and identity

Owner onboarding collects language, business name, country/timezone/currency, services/durations, resources, opening hours, staff and a clearly separate sample task. Do not silently finalise inferred country/currency. Initial tenant creation is a controlled bootstrap flow; subsequent staff must be invited/assigned, not allowed to claim an existing tenant.

Validate Firebase bearer ID tokens server-side. Resolve current membership and role/branch/object scope from authoritative records. Never trust caller-supplied tenant ID, role, price or entitlement. Apply token expiry/revocation and step-up policy from v4 section 61. Avoid introducing cookie mutation authentication alongside bearer authentication without a reviewed design change.

Shared devices require fast lock, active-user indicator, microphone stop, hidden private state and reauthentication before sensitive continuation. A voice sample is not identity verification. Support access must be scoped, time-limited and auditable.

Define a permission matrix before implementing routes. Owner/manager/receptionist are not interchangeable; use the v4 role policy. Domain commands check current rights even if the frontend hid the button.

## 9. Backend domain architecture

Define calendar, directory, attendance, finance, reporting, subscriptions, assistant and automation modules. Routes validate and delegate; domain services own business rules; repositories implement persistence; provider adapters handle external I/O.

Manual UI and AI tools invoke the same application service. The model cannot bypass a validation because a natural-language request sounded confident. Never call STT, LLM, TTS or external messaging inside a database transaction.

Use explicit typed errors: unauthenticated, forbidden, capability unavailable, invalid input, ambiguous identity, stale proposal, slot conflict, insufficient balance, duplicate-key mismatch, dependency unavailable and request limit. Specify stable machine codes plus translated client messages. Return a safe correlation ID; keep internal details in redacted operational logs.

## 10. PostgreSQL model, constraints and migrations

Design tables for tenants, branches, memberships, services, resources, schedules, patients/customers, appointments, attendance events, charges, payments, allocations, correction events, receipt metadata, proposals, commands/results, entitlements, usage, audit, outbox/inbox and report snapshots where needed.

Every tenant-owned record must be scoped. Composite keys/foreign keys prevent cross-tenant links. Runtime role is non-owner/non-superuser without BYPASSRLS/DDL/TRUNCATE. Use transaction-local tenant context sourced from trusted membership; missing context fails closed. Add RLS defence in depth as specified, while documenting that a compromised backend is outside its protection boundary.

Implement real PostgreSQL constraints and tests, not only application checks. Use stable lock ordering and bounded retries for serialization/deadlock failures. Lock relevant parent rows before aggregate financial checks; a row CHECK cannot enforce multirow allocation sums.

Appointment ranges use UTC instants and `[start,end)` semantics. The v4 capacity-one exclusion constraint prevents overlapping occupied resource slots, including specified historical statuses. Validate extension availability. Resource/service timezone and duration snapshots must remain consistent. Cancellation releases occupancy; failed reschedule leaves the existing booking unchanged.

Provide parameterised queries, indexes for actual list/report patterns, pagination, migration tests and pool cleanup. No arbitrary SQL generated by the model. Plan schema expansion/backfill/contraction; application rollback is not a data rollback.

## 11. Money, receipts and financial corrections

MVP is an operational collections subledger, not a certified full accounting/tax system. Money must still be exact. Use validated integer minor units or decimal-string representation with explicit bounds; no binary floating-point summation. One supported currency per branch/accounting scope initially.

Implement the distinctions in v4 section 63:

- Charge posting increases owed amount.
- Received payment plus allocation commits atomically.
- Erroneous-entry void reverses the record/allocation; it is not a real cash refund.
- Charge credit reduces debt and cannot create unsupported overpayment.
- Refund normally deallocates and restores debt unless combined with a matching service credit.
- Cancelled service refund combines credit, deallocation and recorded refund atomically.

Reject unsupported advances/overpayment, excessive cumulative reversals/refunds, cross-person/cross-tenant allocation and unsupported precision. Never edit posted payer identity or erase financial history. Wrong-person correction requires authorised reversal and a new entry.

`recorded_at` is immutable server acceptance time. `effective_at` is approved business time. Enforce backdate/closed-day policy. Distinguish as-known snapshot reports from revised/restated reports. Receipts derive from immutable snapshots; reprints are labelled. Do not promise gapless numbering unless separately designed for a confirmed requirement.

Keep clinic patient receipts separate from SaaS invoices to clinics. Recording cash/card received is not charging a card or proving bank settlement.

## 12. Proposal, confirmation and idempotent command protocol

A proposal is a versioned draft. A command has a durable identifier and outcome. Confirmation binds actor, tenant, exact canonical payload/hash, proposal version, relevant record versions, expiry and nonce as specified. Allocate the command key before submission and reuse it after uncertain responses.

Required ordering:

1. Authenticate and check current access.
2. Validate/canonicalise identifiers and request fingerprint.
3. If an authorised matching committed command exists, return its existing result before requiring the consumed confirmation to become valid again.
4. Same key/different fingerprint is a conflict. In-progress execution returns status/reconciliation instructions, never a new operation.
5. For a new execution, begin scoped transaction, obtain key uniqueness, lock proposal and affected rows in stable order.
6. Recheck current permissions, entitlement, expiry, nonce, payload and resource versions.
7. Enforce invariants and atomically persist domain changes, audit, outbox, receipt metadata and command result.
8. Consume confirmation and commit.
9. Render/TTS/delivery happens after commit and can retry without repeating the write.

Two concurrent same-key requests converge on one result. An absent status lookup while a transaction is in flight is not proof of failure; use bounded reconciliation. “Unknown to client” is a UI state, not permission to create another payment.

Same-key idempotency and semantic duplicate detection are different. Warn about a recent similar payment under a new key, but do not silently merge legitimate repeated payments. Test all ordering and race cases against real PostgreSQL.

## 13. Speech capture and provider integration

Implement explicit push-to-talk with permission prompt, visible recording state, stop control, maximum duration/bytes, cancellation and microphone shutdown on lock/navigation. Test actual MediaRecorder MIME support rather than assuming a universal codec. Reject unsupported/oversized input server-side.

Provider interfaces separate:

- speech-to-text;
- bounded intent extraction;
- text-to-speech.

Each adapter declares endpoint/model/config version, supported locale, timeout, retry category, usage accounting and data destination. Use official SDKs compatible with the selected endpoint. Verify real endpoint capabilities using current primary documentation when available. If unavailable, mark integration pending; do not invent SDK methods or model names.

No browser-held privileged provider credentials. Google AI Studio is for synthetic prompt/schema experiments; production processing follows the approved backend provider configuration. No real patient data in prompts, demos or evaluation fixtures by default.

A missing provider key yields `PROVIDER_NOT_CONFIGURED`; a synthetic test adapter is clearly labelled and disabled in production. Do not present scripted recognition as a working real speech integration. Provider outage must preserve manual/text deterministic operations.

## 14. Language interpretation and dialogue repair

Pipeline: capture → STT → transcript review → normalisation → schema-constrained intent → authorised entity resolution → clarification → validated proposal → review → confirmation → command → verified facts → optional speech.

Partial transcripts cannot authorise writes. Preserve exact names rather than translating them. Resolve date phrases using branch timezone and reference instant, then show the absolute date/time. Normalise Unicode/spacing and supported number words; do not guess money. Confidence values are not permission to skip review.

Name resolution uses exact identifiers where available, then a bounded list of authorised candidates. Ask one high-value missing question at a time. Preserve verified slots during correction; changing a critical field invalidates the prior confirmation.

For multiple requested writes, MVP creates separately reviewed proposals or asks which to do first. Do not launch an unbounded tool loop. Unknown intent produces helpful supported alternatives. Out-of-scope clinical requests receive a brief scope explanation and no clinical inference.

“ඔව්” binds only to one current, visible proposal awaiting approval. Payment MVP defaults to accessible tap confirmation after optional spoken readback unless voice-confirmation acceptance tests establish an approved policy. Stopping TTS does not cancel a committed transaction. If cancellation races with commit, reconcile and explain the actual state.

## 15. AI tools, prompts and trust boundaries

Create versioned model prompts and allowlisted tool contracts for authorised queries, entity lookup and proposal preparation. Actual mutation goes through the confirmed command endpoint. Model-generated IDs, prices and rights must be validated against server records.

Model-visible tools must not expose arbitrary shell, SQL, network URL fetches, cloud administration or file paths. Treat directory text, imported documents, transcripts and retrieved snippets as untrusted data, not instructions. Prompt injection cannot expand rights or change the tool allowlist.

Use minimal data: current task fields and limited authorised candidates, not an entire patient database. No raw conversation content in tracing by default. Separate user preferences from patient/financial history. Bound model calls, tokens, audio duration and retries. Cache safe static help/templates; never reuse one tenant's sensitive answer for another.

Create automated adversarial tests with malicious patient names and instructions embedded in data. Prove that tool execution still enforces server policy even if the model suggests a forbidden action.

## 16. API surface and schemas

Implement versioned request/response contracts and OpenAPI for:

- Session/current context and capabilities.
- Directory and authorised search.
- Services/resources/schedules.
- Appointment queries and proposal preparation.
- Attendance commands.
- Charges/payments/corrections/receipts.
- Voice interpretation and supported-language capability status.
- Proposals and confirmed commands.
- Command-status reconciliation.
- Allowlisted report queries.
- Exports and job status.
- Entitlements/usage and role-appropriate administration.

Use v4 `/api/v1` route families. Response errors include safe machine code, translated message key, correlation ID and relevant retry/conflict information. Paginate and bound queries. Rate-limit expensive endpoints and uploads.

Compile validation schemas only from trusted code. Reject unknown fields where appropriate. Do not accept tenant-uploaded executable schemas. Generate client types from the same canonical contracts; do not maintain incompatible frontend and backend copies.

## 17. Reporting and exact spoken facts

Implement versioned metric definitions for appointments, attendance/no-shows, recorded receipts, voids/refunds/net collections and outstanding amounts using the v4 semantics. Each report includes branch, period boundaries, timezone, currency, time basis, generation time, freshness and metric version.

The database computes financial totals and percentages deterministically. UI table, chart, export and spoken summary use the same verified fact object. Prefer reviewed speech templates for money/date facts. A model may explain facts but cannot invent a causal reason for a change.

Handle zero denominators, missing versus zero data and mismatched periods explicitly. Restrict MVP natural-language reporting to known metrics. No model-authored arbitrary production SQL. Saved report definitions store semantic parameters, not an ambiguous prompt string.

Provide drill-down with current permissions. Report snapshot and revised report are distinct IDs; do not rewrite yesterday's historical close invisibly.

## 18. Near-real-time and offline behaviour

MVP uses read-your-write refresh and bounded active-screen polling. Start with the v4 proposed appointment-board interval, measure and adjust. Pause polling when backgrounded/locked/offline; refetch on focus/reconnect. Display update time and stale status.

A stale available slot is not a reservation. Recheck at commit. Multiple sessions need a two-device acceptance test. Do not describe polling as guaranteed instantaneous delivery.

If later adding SSE/WebSocket, design bounded authenticated connections, external shared event state, cursors/versioning, reconnect and missed-event reconciliation. Never place long-lived bearer tokens in URLs. Cloud Run process memory is not a durable event bus.

Offline: permit clearly labelled unsent drafts where appropriate, but no automatic replay of payment writes on reconnect. Query command status for submitted uncertain work. Avoid persistent sensitive drafts by default; explain local versus server-saved state.

## 19. Automation, tasks and outbox

Write outbox events in the domain transaction. Use an explicitly selected dispatcher triggered by Scheduler or a controlled job; do not rely on an untracked background loop after an HTTP request finishes. Cloud Tasks invokes an authenticated worker.

Implement event IDs, leases/claiming, retry backoff+jitter, attempt/deadline caps, idempotent consumer effects, failure visibility and manual recovery. Do not promise exactly-once external messaging. When a provider lacks idempotency, design and document the remaining ambiguity and reconciliation.

Before a reminder sends, recheck appointment state, timing, consent, current recipient and tenant rule. Cancelled/rescheduled appointments must not receive stale reminders. Internal reports and configured reminders are bounded routines; price changes, refunds, role grants and exports do not become unrestricted autonomous actions.

Automation definitions include owner, trigger, timezone, permitted action, recipient scope, budget, version, pause control and outcome history. External messaging is optional until a real channel is authorised/configured/tested; no actual messages to real recipients during development.

## 20. Feature entitlements, usage and paid plans

Implement a server-owned capability registry with stable keys, module/submodule dependencies, roles, quota metric and pricing SKU reference. UI reads capabilities; backend independently checks them at proposal and commit.

Core subscription, appointments, attendance, collections, voice allowance, advanced reporting and future integration packs remain separately configurable. Include a practical voice allowance in the commercial model rather than making the central promise unusable by default. Actual prices are configurable business decisions, not invented values presented as approved.

Implement trial/active/grace/restricted/archived transitions as agreed policy. Downgrade does not delete records. Define read/export/correction access explicitly. An exhausted AI allowance can disable additional AI consumption while manual core operations remain available according to plan policy.

Meter authenticated tenant/feature usage without content. Atomic quota reservation/finalisation/release prevents overspend under concurrency. Failed/retried calls follow a documented billing rule. Initial SaaS payments can be manually verified by authorised owner workflow; do not build an unneeded gateway or confuse SaaS revenue with clinic collections.

## 21. Firebase service selection

Use Auth, Hosting, appropriate App Check protection, selected private storage, development emulator tooling and rules tests where those products apply. App Check complements authentication/authorisation; it is not a substitute.

Do not create a second authoritative transaction store in Firestore or Realtime Database. Optional live projections must be versioned and non-authoritative. SQL Connect is an alternative architecture evaluation, not an additional bypass around confirmed commands. Firebase AI Logic is not the authority for privileged client-side business actions.

Remote Config may control nonsecurity UX rollout; it does not own roles, entitlements or financial policies. FCM is optional generic notification delivery, not a guaranteed critical alert channel. Analytics/Performance collection requires a data-minimisation review. Crashlytics/App Distribution/Test Lab are principally future native-app choices for this web-first plan. Extensions require permissions/data-flow/cost review. Unused services remain unprovisioned and denied.

Document each selection in the service inventory; do not enable the whole catalogue just because it exists.

## 22. Google Cloud deployment and networking

Prepare reproducible configuration for Firebase Hosting, Cloud Run API/worker, Cloud SQL, private storage, Tasks/Scheduler, Secret Manager, Artifact Registry, logging/monitoring and identity federation. Use separate dev/staging/production projects when practical.

Choose and document API ingress/auth/CORS, SQL connection method, egress and region. Cloud Run runtime, worker, deployer and migration identities have separate minimal roles. Firebase user authentication and Cloud Run IAM invocation are different layers: document which endpoint is browser-reachable and where Firebase tokens are checked, and which worker endpoint requires service identity. Never make the entire API inaccessible to clients by blindly requiring service-account identity for browser calls.

Bound container CPU/memory/concurrency/max instances/request deadlines and SQL pools. Count old/new revisions, workers, migrations and reserve in connection budget. Minimum instances are a measured paid latency choice. Budget alerts alone do not stop spend; use application/provider quotas and capacity controls.

Cloud Shell and gcloud are developer/admin tools, not permanent production hosts. Scripts must assert target project/environment. No production data migrations or infrastructure applies merely because a shell is authenticated.

Defer GKE, Spanner, GPU hosting, broad warehouse/CDC pipelines, Redis and enterprise gateways unless evidence justifies them. Keep future interfaces without installing unused services.

## 23. Security and privacy implementation

Implement TLS assumptions/configuration, safe rendering, CSP, explicit allowed origins, input limits, least privilege, dependency hygiene and redacted audit/operational logs. No credentials in frontend bundles, query strings, screenshots, README examples or logs.

Test tenant isolation on every query/mutation/export/worker path. Recheck current membership when reading historical command results. Revoked staff must not recover data through a pending proposal or old export link.

Private files require authorised access, short lifetime and scoped download. If upload support is enabled: quarantine, size/type checks, malware scanning workflow and controlled publication. Do not add unrestricted uploads just for visual completeness. Escape spreadsheet formula-leading values in CSV export.

Retention includes audio, transcript, proposal, model trace, export, object storage, database and backups. Implement the deletion graph and restore quarantine from v4 section 66. Restore must reapply later revocations/deletions and prevent replaying historical outbox effects. Immutable financial history, legal retention and personal-data deletion require explicit policy, not one blanket delete endpoint.

Do not claim regulatory certification or global compliance from using Google Cloud. Capture country/client/provider approvals as open evidence when absent.

## 24. Observability, performance and incident response

Correlate request, utterance, proposal, command and task through safe identifiers. Record duration, error class, retry count, endpoint version and usage; exclude names, raw transcripts, tokens and financial detail unless explicitly required and protected.

Measure end-to-end task completion and stage latency. Track STT failure, intent/slot errors, clarification rate, confirmation abandonment, command conflicts, DB pool wait, provider usage, queue age, export failures and report freshness. Do not sum stage p95s and label that end-to-end p95.

Use v4 section 84 budgets as proposed targets; report actual device/network/cold-start conditions. Manual operations must survive AI outage. TTS failure after commit must not turn a successful payment into a failed transaction.

Create runbooks for provider outage, uncertain payment, SQL saturation, cross-tenant incident, bad deployment, failed migration, backup restore, compromised staff account and subscription error. Each includes symptoms, safe first action, owner, recovery checks and client-facing wording.

## 25. CI/CD and supply-chain discipline

Implement reproducible scripts and GitHub Actions for typecheck, lint, meaningful unit/domain tests, PostgreSQL integration, critical browser tests and security/dependency scanning. Tests that mirror implementation without testing behaviour are insufficient.

Use immutable action pins and OIDC for Google Cloud deploy. Do not grant production credentials to untrusted fork workflows. Build one image artifact, record digest/provenance/SBOM and promote the tested artifact rather than rebuilding an unrelated image at release.

Separate build, staging deploy, migration and production promotion. Record exact test results and rollback limitations. Emergency fixes must return to version control. Never label an unexecuted workflow green or call a file named `security-test` evidence of security.

## 26. Mandatory test matrix

Implement test IDs and evidence for at least:

- **T01:** unauthenticated, wrong-tenant, wrong-branch and revoked-user reads/writes denied.
- **T02:** concurrent booking of one resource/time accepts only one.
- **T03:** failed reschedule preserves original appointment.
- **T04:** same command key concurrent payment requests create one effect/receipt.
- **T05:** replay after consumed/expired confirmation returns existing authorised result.
- **T06:** same key/different payload rejected.
- **T07:** role/entitlement change between proposal and commit denied.
- **T08:** lost response after commit reconciles without another payment.
- **T09:** over-allocation, advance, cross-currency/cross-person and excessive refund rejected.
- **T10:** charge-credit/refund/void examples produce correct debt and collections.
- **T11:** screen, export and speech money facts equal authoritative query output.
- **T12:** ambiguous names/times/money require correction before write.
- **T13:** mic denial/STT/LLM/TTS outage and offline states expose truthful fallback.
- **T14:** malicious transcript/patient name cannot expand privileges or execute HTML/tools.
- **T15:** keyboard/screen reader/large text can complete confirmation flows.
- **T16:** two-device freshness/reconnect reconciliation works.
- **T17:** queue duplicate/retry/cancelled reminder behaves correctly.
- **T18:** scoped safe CSV export and expired/revoked access enforced.
- **T19:** isolated restore reapplies revocations/deletions and suppresses old delivery.
- **T20:** concurrent usage reservation respects quota without corrupting business commands.

Use real PostgreSQL for transaction/RLS/constraint tests. Mocks are suitable for provider faults, not proof of database concurrency. Native-speaker evaluation and restore drills need separate actual evidence; automated simulated speech does not establish Sinhala production quality.

## 27. Build in complete vertical phases

For each phase: inspect dependencies → implement → run available checks → fix failures → update traceability/status → continue if environment permits. Complete coherent slices before adding breadth.

| Phase | Deliverable | Exit requirement |
|---|---|---|
| 0 | Repository/attachment review, decisions, capability inventory, requirement map | No invented repo/provider state; explicit blockers |
| 1 | Reproducible workspace, PostgreSQL migrations, Auth/tenant skeleton, UI shell and one authorised Today read | Real local persistence and tenant isolation test; no fake backend |
| 2 | Directory/service/resource setup and appointment manual workflow | Booking/reschedule/cancel invariants and conflict tests |
| 3 | Attendance plus charge/payment/receipt path | Idempotency, uncertain response and financial corrections tests |
| 4 | Deterministic reports and typed conversational proposals | Exact metric facts and confirmation flow |
| 5 | Real configured speech adapters and five voice journeys | Provider integration evidence + separately gated language evaluation |
| 6 | Entitlements/usage, outbox, internal routines, export/privacy controls | Quota/queue/scope tests and fallback behaviour |
| 7 | Infrastructure/CI, staging, load/accessibility/security/restore evidence | Executed release checks or precise blockers |
| 8 | Supervised pilot rehearsal and release decision | Named scope/support agreement; all P0 gates resolved |

Do a small speech feasibility spike early in Phase 0/1 with synthetic data if provider access exists; do not wait until the end to discover the main language fails. This does not justify skipping transactional implementation.

Do not stop at the plan. In a coding environment, start Phase 1 after the initial inspection. If only text output is possible, provide complete coherent file batches with exact paths and reproducible commands, clearly marked unexecuted. Do not emit a huge partially truncated codebase.

## 28. Evidence and honest completion reporting

At the end of each bounded response, report:

1. What was implemented, with file paths.
2. Which requirement/test IDs it covers.
3. Commands actually run, exit outcomes and material failures.
4. Unrun checks and why.
5. Remaining blockers and the next concrete slice.

Use statuses: `IMPLEMENTED_UNVERIFIED`, `VERIFIED_LOCAL`, `VERIFIED_STAGING`, `BLOCKED`, `DEFERRED`. “Production ready” requires the actual production release evidence and agreed sign-off. A UI screenshot, successful compile or mocked provider test is insufficient.

If tools are unavailable, explicitly say so and provide the runnable artifacts/check commands. Never fabricate deployments, URLs, test counts, latency numbers, user-study outcomes, cloud configuration or provider access.

Persist continuation notes before context limits: current phase, files changed, commands/results, unresolved decisions, exact next tasks and known hazards. Do not restart/rewrite finished modules when continuing; inspect the existing state first.

## 29. Immediate execution instruction

Now:

1. Verify access to v4 and inspect any provided repository.
2. Summarise the proposed architecture in no more than 12 decision bullets and list only material unresolved items.
3. Create the traceability/status documents and implementation plan in the workspace.
4. Implement Phase 1 as a real vertical slice, preserving existing working code where applicable.
5. Run the checks available in this environment and report evidence honestly.
6. Continue through the next phase when feasible without waiting for ceremonial approval; pause only for an actual blocked dependency or external-action authorisation.

The product is successful when the client can complete a correct task in a supported familiar language and understand the result—not when the codebase contains the largest number of technologies.

# MASTER PROMPT END

---

## Continuation prompt — response limit එකක් ආවොත්

```text
Continue the Healthcare MVP 1 implementation under the attached v4 specification and master build prompt. Read docs/implementation-status.md, docs/requirements-traceability.md, docs/next-actions.md and the current code before editing. Preserve completed work. Resume the next incomplete vertical slice; implement and test it rather than repeating the plan. Keep tenant isolation, exact money, bound confirmations and idempotent commands intact. Report actual commands/results and distinguish implemented from verified. If the previous work is unavailable, state what is missing instead of inventing progress.
```

## Frontend-only output එකක් දුන්නොත් යොදන correction prompt

```text
The requested deliverable is the full-stack administrative workspace, not a static UI. Inspect what is actually connected. Keep useful UI, then implement the missing domain/API/PostgreSQL layers and wire one complete appointment flow through authenticated tenant-scoped persistence and tests. Do not present localStorage/mock data as production persistence. Clearly label any provider or infrastructure integration that the environment cannot run. Follow the master prompt's phase order and evidence requirements.
```

## Release review prompt — implementation අවසානයේ

```text
Review the actual repository against the v4 specification and master prompt. Produce an evidence-based gap report by requirement ID, severity, file location, reproduction/test command, observed result and remediation. Run available tests; do not mark unrun tests passed. Specifically examine tenant isolation, stale permissions, concurrent bookings, payment replay after consumed confirmation, uncertain commit reconciliation, refund/credit semantics, exact spoken totals, real speech adapters, secret exposure, queue dedupe, export scope and restore quarantine. Separate P0 release blockers from later enhancements. Fix authorised local defects, rerun affected tests and update release evidence. Do not deploy or claim production readiness merely because the review document is complete.
```

## Companion section map

| Build concern | v4 sections |
|---|---|
| Scope, user promise and language limits | 1–6, 32–34, 71 |
| Frontend, conversation, speech | 8–12, 35–38, 65, 79–81 |
| Domain/API/identity | 13–19, 39–44, 60–62, 82 |
| Money and database | 40–41, 45, 63–64, 83 |
| Automation/entitlements | 21, 24, 46, 67, 85, 89 |
| Infrastructure and stack | 25, 48, 72–78, 90 |
| Privacy/recovery/reliability | 22–23, 47, 49–53, 66, 84, 87–88 |
| Delivery/test/revenue gates | 54–57, 68–70, 91–94 |

මෙම prompt එකෙන් code generate කිරීමට පැහැදිලි ක්‍රියාමාර්ග ලැබේ. එය තනිවම deployment, language validation, security audit හෝ client acceptance සම්පූර්ණ කරන්නේ නැත. ඒවාට අදාළ සැබෑ evidence ඉල්ලීම prompt එකේම ඇතුළත් කර ඇත.
