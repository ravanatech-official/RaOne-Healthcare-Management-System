# Entity Ownership & Single-Writer Boundaries

**Authoritative Principle:** Every business entity has **one authoritative owning domain and writer**. Cross-domain interactions occur via explicit scoped contracts, composite `(tenant_id, id)` foreign keys, or transactional outbox/inbox records—never ad-hoc dual writes.

## 1. Shared Platform Domain (Identity, Scope & Entitlements)
| Entity / Table | Owner | Purpose & Isolation Invariants |
|---|---|---|
| `users` | Platform Identity | Verified Firebase Auth `uid`, email, preferred locale (`si-LK` / `en-LK`). |
| `tenants` | Platform Tenancy | Top-level tenant isolation boundary (`LK`, `Asia/Colombo`, `LKR`). |
| `legal_entities` | Platform Tenancy | Legal/tax entity scoped under `tenant_id`. One tenant may own 1+ legal entities; receivables/receipts/sales never merge across legal entities implicitly (`U04`, `U16`). |
| `branches` | Platform Tenancy | Physical operational branch scoped under `(tenant_id, legal_entity_id)`. |
| `departments` & `counters` | Platform Tenancy | Scopes clinic vs. pharmacy counters and POS till stations within a branch. |
| `memberships` | Platform AuthZ | Server-authoritative administrative role (`owner`, `manager`, `receptionist`, `cashier`, `stock_keeper`, `accountant`) + instant `revoked_at` enforcement. |
| `professional_grants` | Platform AuthZ | Distinct professional grant (`clinician`, `pharmacist`) with licence reference, scope, `active` flag, and `revoked_at`. **Owner role never implies professional grant (`U11`, `P10`).** |
| `tenant_capabilities` | Platform Entitlements | Product mode (`clinic_only`, `pharmacy_inventory_only`, `pharmacy_retail_only`, `combo`) & feature gates with dependency closure. Safety gates remain non-disableable. |
| `people` | Shared Directory | Minimal administrative person record scoped to `(tenant_id, branch_id)`. Phone is non-unique; ambiguous names require human selection (`U05`). |
| `action_proposals` & `commands` | Platform Command Protocol | Canonical payload hashes, nonces, expiry, and idempotent committed-result replay (`U14`, `P07`, `P08`). |
| `audit_events` & `outbox_events` | Platform Audit & Messaging | Immutable audit trail (no raw audio/clinical notes) and transactional SQL outbox. |

## 2. Clinic Domain (Preserved MVP + Planned Extensions)
| Entity / Table | Owner | Notes |
|---|---|---|
| `services`, `resources` | Clinic Domain | Service catalogue & capacity-1 practitioner/room resources. |
| `appointments` | Clinic Domain | UTC `starts_at`/`ends_at` + branch `business_date`, booked snapshots, version concurrency. |
| `charges`, `payments`, `payment_allocations`, `receipts` | Clinic Finance | Integer minor units (`LKR * 100`). Arrival/completion does not create payment (`U06`). |
| *Clinical encounters / orders* | *External / Unverified* | **Not present in observed workspace.** Reserved for future verified adapter; never generated synthetically. |

## 3. Pharmacy Domain (Bounded Catalogue, Inventory, Retail & Safety)
| Entity / Table | Owner | Notes |
|---|---|---|
| `products` | Pharmacy Catalogue | Exact identity: SKU, display name, generic/brand, `strength_value`, `strength_unit`, `dosage_form`, `route`, `manufacturer`, `regulatory_class`, `requires_pharmacist_release`, `base_unit`. |
| `pack_variants` & `uom_conversions` | Pharmacy Catalogue | Versioned conversions to `base_unit` (e.g., `1 box = 10 strips = 100 tablets`). Snapshotted at receipt/sale (`P02`, `P03`). |
| `barcode_aliases` | Pharmacy Catalogue | Scannable EAN/UPC/GTIN mapped to `(product_id, pack_variant_id)` with duplicate/conflict status (`P02`). |
| `suppliers` & `storage_locations` | Pharmacy Procurement / Stock | Approved supplier registry and branch storage locations (dispensary shelf, cold room, quarantine cage). |
| `lots` | Pharmacy Inventory | Scoped to `(tenant_id, branch_id, product_id, manufacturer, batch_number)`. Stores `printed_expiry`, `expiry_precision`, `expiry_cutoff_date`, `quality_status` (`quarantine`, `released`, `blocked`). Unknown expiry stays quarantined (`P16`). |
| `cost_layers` | Pharmacy Inventory | Unit landed cost in minor units per lot receipt batch (`LKR * 100`), preserving provisional flag (`A11`, `A14`). |
| `inventory_balances` | Pharmacy Inventory | Transactionally maintained per `(tenant_id, branch_id, location_id, product_id, lot_id)` across discrete buckets: `sellable_on_hand`, `reserved_qty`, `quarantine_qty`, `returned_quarantine_qty`, `damaged_qty`, `expired_qty`, `recalled_qty`, `disposed_qty`. |
| `stock_movements` | Pharmacy Inventory | Append-only immutable stock ledger. Direct balance updates without a movement row are prohibited (`A9`). |
| `stock_reservations` | Pharmacy Retail / Inventory | Short-lived checkout allocations (`reserved_qty`) with TTL. Does not count as extra physical stock (`P04`). |
| `goods_receipts` & `goods_receipt_lines` | Pharmacy Receiving | Physical receiving event with accepted vs. quarantine split, bonus units, and supplier document reference (`P12`). |
| `supplier_invoices` | Pharmacy Procurement | Financial invoice reference linked to GRN; **never inserts stock movements (`P12`)**. |
| `recalls` & `quality_holds` | Pharmacy Safety | SKU/lot/manufacturer safety barriers acquired in shared lock order prior to lot locks (`P06`, `U13`). |

## 4. Bridge Domain (Phase 3 Target — Not Active Yet)
- Planned tables (`source_order_references`, `handoffs`, `handoff_line_authorisations`, `fulfilments`) remain deferred to Phase 3 after clinic source authority is verified or an approved manual reference protocol is established.
