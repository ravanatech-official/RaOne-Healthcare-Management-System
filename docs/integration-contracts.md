# Integration Contracts & Cross-Domain Boundaries

**Last Updated:** 2026-11-18 (Asia/Colombo)

## 1. Versioned API Route Families (`/api/v1`)
All API endpoints authenticate via Firebase Bearer ID tokens (`verifyIdToken(token, true)`), resolve active membership from Cloud SQL PostgreSQL, enforce server capabilities/roles/professional grants, and return structured `ApiErrorEnvelope` errors with correlation IDs.

| Prefix / Route Family | Status | Purpose |
|---|---|---|
| `GET /api/v1/health` | Active (Preserved) | Liveness check only (no eager DB dependency). |
| `GET /api/v1/session/context`, `POST /api/v1/onboarding/bootstrap`, `POST /api/v1/user/locale` | Active (Preserved + Extended) | Auth session, workspace product mode bootstrap, locale persistence. |
| `GET /api/v1/today`, `GET /api/v1/appointments/:id`, `GET /api/v1/team`, `GET /api/v1/audit` | Active (Preserved) | Clinic Today Board, tenant-isolated appointment lookup, staff directory, audit log. |
| `POST /api/v1/assistant/interpret` | Active (Preserved) | Read-only bounded administrative parser (`@google/genai`), clinical requests rejected. |
| `/api/v1/platform/*` | **Phase 1 New** | Legal entities, product mode & capability manifest, professional grants management. |
| `/api/v1/pharmacy/*` | **Phase 1 New** | Catalogue (`products`, `pack_variants`, `uom_conversions`, `barcode_aliases`), `suppliers`, `goods-receipts`, `supplier-invoices`, `stock` (balances + lots + movements + quarantine release/hold). |
| `/api/v1/pharmacy/{carts,professional-releases,sales,returns,tills,recalls}` | Planned (Phase 2) | POS checkout, FEFO allocation, recall lock race, returns/quarantine, till shifts. |
| `/api/v1/handoffs/*` | Planned (Phase 3) | Clinic-to-pharmacy order references & fulfilment reservation/consume protocol. |
| `/api/v1/reports/*` | Planned (Phase 4) | Consolidated no-double-count reports & pharmacy expiry/valuation/reorder metrics. |

## 2. Clinic-to-Pharmacy Handoff & Source-Authority Contract (Phase 3 Design)
Because no separate clinical EHR/order repository exists in this workspace (`ADR-002`):
1. **Current State:** Automated electronic clinical handoff is **disabled (`BLOCKED` on unverified clinical source)**. Independent Clinic Admin and independent Pharmacy Inventory/Retail operate cleanly without fabricating fake prescriptions.
2. **Phase 3 Target Protocol:**
   - **Order Offer / Inbox (`U08`):** Source system writes an outbox event `order.reference_offered` with `{ eventId, sourceSystem, tenantId, legalEntityId, sourceOrderId, sourceVersion, payloadHash, personLinkId, allowedScope }`. Consumer inbox deduplicates by `(source_system, event_id)`. Receiving produces a pharmacy work item (`offered`) **only**—zero stock decrement, zero charge, zero sale.
   - **Atomic Source-Authority Fulfilment (`U09`, `U10`):** Before finalising any pharmacy fulfilment linked to a clinical order, pharmacy acquires an explicit source-authority reservation / version check (`authorise_fulfilment(sourceOrderId, expectedVersion, requestedQtyBase, fulfilmentId)`) and holds durable `fulfilmentId`. If source authority is unreachable or stale, fulfilment enters `on_hold` (`U18`) while standalone OTC retail remains usable.
   - **Manual Fallback:** Where legacy clinical source lacks atomic cancellation/reservation endpoints, automated handoff stays disabled and staff use supervised manual reference verification.

## 3. Financial Consolidation Contract (No Double Counting — Blueprint §14)
- Clinic `charges`/`payments` and Pharmacy `sales`/`tenders` retain domain, `legal_entity_id`, receipt series, and integer minor units (`LKR * 100`).
- A combined payment allocation (Phase 4) records one `payments` row (`LKR 2,500`) with distinct `payment_allocations` (`LKR 2,000` clinic + `LKR 500` pharmacy) so consolidated collections report `LKR 2,500`, never `LKR 5,000` (`U16`).
- Pharmacy refunds adjust pharmacy net collections and place physical units into `returned_quarantine`, never mutating clinic charges (`U17`).
