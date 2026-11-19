import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// 1. Identity users synchronized from verified Firebase Auth UIDs
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  displayName: text('display_name').notNull().default(''),
  preferredLocale: text('preferred_locale').notNull().default('si-LK'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// 2. Tenants (Organizations with modular productMode)
export const tenants = pgTable('tenants', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  productMode: text('product_mode').notNull().default('clinic_only'), // clinic_only | pharmacy_inventory_only | pharmacy_retail_only | combo
  countryCode: text('country_code').notNull().default('LK'),
  timezone: text('timezone').notNull().default('Asia/Colombo'),
  currency: text('currency').notNull().default('LKR'),
  status: text('status').notNull().default('active'), // active | suspended | archived
  configVersion: integer('config_version').notNull().default(1),
  onboardingCompleted: boolean('onboarding_completed').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// 2b. Legal Entities (Fiscal & regulatory record owner scoped inside tenant)
export const legalEntities = pgTable(
  'legal_entities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    registrationNumber: text('registration_number').notNull().default(''),
    taxId: text('tax_id').notNull().default(''),
    countryCode: text('country_code').notNull().default('LK'),
    currency: text('currency').notNull().default('LKR'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [unique('legal_entities_tenant_id_id_uniq').on(table.id, table.tenantId)]
);

// 3. Branches (Operational location, composite-keyed for tenant isolation)
export const branches = pgTable(
  'branches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    legalEntityId: uuid('legal_entity_id'),
    name: text('name').notNull(),
    code: text('code').notNull().default('MAIN'),
    timezone: text('timezone').notNull().default('Asia/Colombo'),
    openingHoursJson: jsonb('opening_hours_json').notNull().default({}),
    isDefault: boolean('is_default').notNull().default(true),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('branches_tenant_id_id_uniq').on(table.id, table.tenantId),
    uniqueIndex('branches_tenant_code_uidx').on(table.tenantId, table.code),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'branches_legal_entity_tenant_fk',
    }),
  ]
);

// 4. Memberships (Server-authoritative role & revocation boundary)
export const memberships = pgTable(
  'memberships',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(), // owner | manager | receptionist
    active: boolean('active').notNull().default(true),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('memberships_tenant_user_uidx').on(table.tenantId, table.userId),
    index('memberships_user_active_idx').on(table.userId, table.active),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'memberships_branch_tenant_fk',
    }),
    check(
      'memberships_role_chk',
      sql`${table.role} IN ('owner', 'manager', 'receptionist', 'cashier', 'stock_keeper', 'accountant')`
    ),
  ]
);

// 5. Server-side Feature Entitlements & Commercial Capabilities
export const tenantCapabilities = pgTable(
  'tenant_capabilities',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    capabilityKey: text('capability_key').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    planTier: text('plan_tier').notNull().default('pilot_base'),
    quotaLimit: integer('quota_limit'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('tenant_capabilities_tenant_key_uidx').on(table.tenantId, table.capabilityKey),
  ]
);

// 6. Services (Integer minor units, e.g. LKR 2500.00 = 250000)
export const services = pgTable(
  'services',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull(),
    name: text('name').notNull(),
    nameSi: text('name_si').notNull().default(''),
    durationMinutes: integer('duration_minutes').notNull().default(20),
    priceMinor: integer('price_minor').notNull().default(0),
    currency: text('currency').notNull().default('LKR'),
    active: boolean('active').notNull().default(true),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('services_tenant_id_id_uniq').on(table.id, table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'services_branch_tenant_fk',
    }),
    check('services_duration_pos_chk', sql`${table.durationMinutes} > 0`),
    check('services_price_nonneg_chk', sql`${table.priceMinor} >= 0`),
  ]
);

// 7. Resources / Practitioners (Capacity 1 in MVP1)
export const resources = pgTable(
  'resources',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull(),
    name: text('name').notNull(),
    specialty: text('specialty').notNull().default(''),
    capacity: integer('capacity').notNull().default(1),
    workingHoursJson: jsonb('working_hours_json').notNull().default({}),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('resources_tenant_id_id_uniq').on(table.id, table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'resources_branch_tenant_fk',
    }),
    check('resources_capacity_one_chk', sql`${table.capacity} = 1`),
  ]
);

// 8. Directory People (Minimal patient/customer identity; phone is intentionally non-unique)
export const people = pgTable(
  'people',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull(),
    displayName: text('display_name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    aliasesJson: jsonb('aliases_json').notNull().default([]),
    phone: text('phone').notNull().default(''),
    phoneLast4: text('phone_last4').notNull().default(''),
    notes: text('notes').notNull().default(''),
    isSample: boolean('is_sample').notNull().default(false),
    version: integer('version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('people_tenant_id_id_uniq').on(table.id, table.tenantId),
    index('people_tenant_norm_name_idx').on(table.tenantId, table.normalizedName),
    index('people_tenant_phone_last4_idx').on(table.tenantId, table.phoneLast4),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'people_branch_tenant_fk',
    }),
  ]
);

// 9. Appointments (UTC instants + branch businessDate + version concurrency)
export const appointments = pgTable(
  'appointments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull(),
    personId: uuid('person_id').notNull(),
    serviceId: uuid('service_id').notNull(),
    resourceId: uuid('resource_id').notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    businessDate: text('business_date').notNull(), // YYYY-MM-DD in branch timezone
    status: text('status').notNull().default('scheduled'), // scheduled | arrived | completed | cancelled | no_show
    bookedDurationMinutes: integer('booked_duration_minutes').notNull(),
    bookedPriceMinor: integer('booked_price_minor').notNull(),
    currency: text('currency').notNull().default('LKR'),
    notes: text('notes').notNull().default(''),
    isSample: boolean('is_sample').notNull().default(false),
    version: integer('version').notNull().default(1),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('appointments_tenant_id_id_uniq').on(table.id, table.tenantId),
    index('appointments_tenant_branch_date_idx').on(table.tenantId, table.branchId, table.businessDate),
    index('appointments_tenant_resource_time_idx').on(table.tenantId, table.resourceId, table.startsAt),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'appointments_branch_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.personId],
      foreignColumns: [people.tenantId, people.id],
      name: 'appointments_person_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.serviceId],
      foreignColumns: [services.tenantId, services.id],
      name: 'appointments_service_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.resourceId],
      foreignColumns: [resources.tenantId, resources.id],
      name: 'appointments_resource_tenant_fk',
    }),
    check('appointments_time_valid_chk', sql`${table.endsAt} > ${table.startsAt}`),
    check(
      'appointments_status_chk',
      sql`${table.status} IN ('scheduled', 'arrived', 'completed', 'cancelled', 'no_show')`
    ),
  ]
);

// 10. Charges (Collections subledger — Phase 3 ready)
export const charges = pgTable(
  'charges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull(),
    personId: uuid('person_id').notNull(),
    appointmentId: uuid('appointment_id'),
    description: text('description').notNull(),
    currency: text('currency').notNull().default('LKR'),
    grossAmountMinor: integer('gross_amount_minor').notNull(),
    creditedAmountMinor: integer('credited_amount_minor').notNull().default(0),
    effectiveAt: timestamp('effective_at', { withTimezone: true }).defaultNow().notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
    isSample: boolean('is_sample').notNull().default(false),
    version: integer('version').notNull().default(1),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
  },
  (table) => [
    unique('charges_tenant_id_id_uniq').on(table.id, table.tenantId),
    index('charges_tenant_branch_date_idx').on(table.tenantId, table.branchId, table.effectiveAt),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'charges_branch_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.personId],
      foreignColumns: [people.tenantId, people.id],
      name: 'charges_person_tenant_fk',
    }),
    check('charges_gross_pos_chk', sql`${table.grossAmountMinor} > 0`),
    check('charges_credited_bounds_chk', sql`${table.creditedAmountMinor} >= 0 AND ${table.creditedAmountMinor} <= ${table.grossAmountMinor}`),
  ]
);

// 11. Payments (Received payment records — integer minor units)
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull(),
    personId: uuid('person_id').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull().default('LKR'),
    method: text('method').notNull(), // cash | card | bank
    referenceNumber: text('reference_number').notNull().default(''),
    status: text('status').notNull().default('posted'), // posted | voided
    effectiveAt: timestamp('effective_at', { withTimezone: true }).defaultNow().notNull(),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
    recordedByUserId: integer('recorded_by_user_id').references(() => users.id),
    isSample: boolean('is_sample').notNull().default(false),
  },
  (table) => [
    unique('payments_tenant_id_id_uniq').on(table.id, table.tenantId),
    index('payments_tenant_branch_recorded_idx').on(table.tenantId, table.branchId, table.recordedAt),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'payments_branch_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.personId],
      foreignColumns: [people.tenantId, people.id],
      name: 'payments_person_tenant_fk',
    }),
    check('payments_amount_pos_chk', sql`${table.amountMinor} > 0`),
    check('payments_method_chk', sql`${table.method} IN ('cash', 'card', 'bank')`),
  ]
);

// 12. Payment Allocations
export const paymentAllocations = pgTable(
  'payment_allocations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    paymentId: uuid('payment_id').notNull(),
    chargeId: uuid('charge_id').notNull(),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull().default('LKR'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.paymentId],
      foreignColumns: [payments.tenantId, payments.id],
      name: 'alloc_payment_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.chargeId],
      foreignColumns: [charges.tenantId, charges.id],
      name: 'alloc_charge_tenant_fk',
    }),
    check('alloc_amount_pos_chk', sql`${table.amountMinor} > 0`),
  ]
);

// 13. Receipts (Immutable payment snapshots)
export const receipts = pgTable(
  'receipts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    paymentId: uuid('payment_id').notNull(),
    receiptNumber: text('receipt_number').notNull(),
    snapshotJson: jsonb('snapshot_json').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('receipts_tenant_number_uidx').on(table.tenantId, table.receiptNumber),
    foreignKey({
      columns: [table.tenantId, table.paymentId],
      foreignColumns: [payments.tenantId, payments.id],
      name: 'receipts_payment_tenant_fk',
    }),
  ]
);

// 14. Action Proposals (Versioned confirmation envelopes)
export const actionProposals = pgTable(
  'action_proposals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    actorUserId: integer('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    actionType: text('action_type').notNull(),
    canonicalPayloadJson: jsonb('canonical_payload_json').notNull(),
    payloadHash: text('payload_hash').notNull(),
    resourceVersionsJson: jsonb('resource_versions_json').notNull().default({}),
    nonce: text('nonce').notNull(),
    state: text('state').notNull().default('draft'), // draft | consumed | cancelled | expired
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('proposals_tenant_id_id_uniq').on(table.id, table.tenantId),
    index('proposals_actor_state_idx').on(table.tenantId, table.actorUserId, table.state),
  ]
);

// 15. Durable Idempotent Commands
export const commands = pgTable(
  'commands',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    actorUserId: integer('actor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    commandType: text('command_type').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    payloadHash: text('payload_hash').notNull(),
    proposalId: uuid('proposal_id'),
    state: text('state').notNull().default('accepted'), // accepted | committed | rejected
    resultJson: jsonb('result_json'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    committedAt: timestamp('committed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('commands_idempotency_uidx').on(
      table.tenantId,
      table.actorUserId,
      table.commandType,
      table.idempotencyKey
    ),
  ]
);

// 16. Audit Events (Traceability without raw PII audio)
export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    actorUserId: integer('actor_user_id').references(() => users.id),
    actorUid: text('actor_uid').notNull().default('system'),
    action: text('action').notNull(),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    inputSource: text('input_source').notNull().default('ui'), // ui | text | voice | system
    correlationId: text('correlation_id').notNull(),
    metadataJson: jsonb('metadata_json').notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('audit_events_tenant_created_idx').on(table.tenantId, table.createdAt),
  ]
);

// 17. Transactional Outbox Events
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    payloadVersion: integer('payload_version').notNull().default(1),
    payloadJson: jsonb('payload_json').notNull().default({}),
    status: text('status').notNull().default('pending'), // pending | published | failed
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).defaultNow().notNull(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('outbox_pending_idx').on(table.status, table.nextAttemptAt),
  ]
);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
}));

export const tenantsRelations = relations(tenants, ({ many }) => ({
  branches: many(branches),
  memberships: many(memberships),
  capabilities: many(tenantCapabilities),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  tenant: one(tenants, {
    fields: [memberships.tenantId],
    references: [tenants.id],
  }),
  branch: one(branches, {
    fields: [memberships.branchId],
    references: [branches.id],
  }),
  user: one(users, {
    fields: [memberships.userId],
    references: [users.id],
  }),
}));

export const appointmentsRelations = relations(appointments, ({ one }) => ({
  person: one(people, {
    fields: [appointments.personId],
    references: [people.id],
  }),
  service: one(services, {
    fields: [appointments.serviceId],
    references: [services.id],
  }),
  resource: one(resources, {
    fields: [appointments.resourceId],
    references: [resources.id],
  }),
}));

// ============================================================
// COMBINED ERP: SHARED PLATFORM + PHARMACY BOUNDED DOMAIN
// ============================================================

// 18. Departments (Operational domain separation inside a branch)
export const departments = pgTable(
  'departments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull(),
    name: text('name').notNull(),
    domain: text('domain').notNull().default('shared'), // clinic | pharmacy | shared
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('departments_tenant_id_id_uniq').on(table.id, table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'departments_branch_tenant_fk',
    }),
    check('departments_domain_chk', sql`${table.domain} IN ('clinic', 'pharmacy', 'shared')`),
  ]
);

// 19. Counters (POS / dispensary / reception workstations)
export const counters = pgTable(
  'counters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull(),
    departmentId: uuid('department_id').notNull(),
    name: text('name').notNull(),
    code: text('code').notNull(),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('counters_tenant_id_id_uniq').on(table.id, table.tenantId),
    uniqueIndex('counters_tenant_branch_code_uidx').on(table.tenantId, table.branchId, table.code),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'counters_branch_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.departmentId],
      foreignColumns: [departments.tenantId, departments.id],
      name: 'counters_dept_tenant_fk',
    }),
  ]
);

// 20. Professional Grants (Owner role does NOT grant pharmacist/clinician authority)
export const professionalGrants = pgTable(
  'professional_grants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    grantType: text('grant_type').notNull(), // pharmacist | clinician
    licenseNumber: text('license_number').notNull(),
    scopeJson: jsonb('scope_json').notNull().default({}),
    active: boolean('active').notNull().default(true),
    grantedByUserId: integer('granted_by_user_id').references(() => users.id),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('prof_grants_tenant_id_id_uniq').on(table.id, table.tenantId),
    index('prof_grants_lookup_idx').on(table.tenantId, table.userId, table.grantType, table.active),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'prof_grants_branch_tenant_fk',
    }),
    check('prof_grants_type_chk', sql`${table.grantType} IN ('pharmacist', 'clinician')`),
  ]
);

// 21. Pharmacy Products (Exact SKU + strength + form + manufacturer + classification)
export const products = pgTable(
  'products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    legalEntityId: uuid('legal_entity_id').notNull(),
    skuCode: text('sku_code').notNull(),
    displayName: text('display_name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    genericName: text('generic_name').notNull(),
    brandName: text('brand_name').notNull().default(''),
    strengthValue: text('strength_value').notNull(),
    strengthUnit: text('strength_unit').notNull(),
    dosageForm: text('dosage_form').notNull(), // tablet | capsule | syrup_bottle | cream_tube | inhaler | vial | sachet | device | other
    route: text('route').notNull().default('oral'),
    manufacturer: text('manufacturer').notNull(),
    regulatoryClass: text('regulatory_class').notNull().default('unknown_restricted'), // otc | prescription_only | controlled | unknown_restricted
    requiresPharmacistRelease: boolean('requires_pharmacist_release').notNull().default(true),
    storageCondition: text('storage_condition').notNull().default('ambient'),
    baseUnit: text('base_unit').notNull(), // tablet | capsule | sealed_bottle | tube | inhaler | vial | sachet | unit
    minShelfLifeDays: integer('min_shelf_life_days').notNull().default(30),
    masterDataVersion: integer('master_data_version').notNull().default(1),
    masterDataSource: text('master_data_source').notNull().default('manual'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('products_tenant_id_id_uniq').on(table.id, table.tenantId),
    uniqueIndex('products_tenant_sku_uidx').on(table.tenantId, table.skuCode),
    index('products_tenant_norm_name_idx').on(table.tenantId, table.normalizedName),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'products_legal_entity_tenant_fk',
    }),
    check(
      'products_reg_class_chk',
      sql`${table.regulatoryClass} IN ('otc', 'prescription_only', 'controlled', 'unknown_restricted')`
    ),
    check('products_shelf_life_nonneg_chk', sql`${table.minShelfLifeDays} >= 0`),
  ]
);

// 22. Pack Variants (Box / Strip / Sealed Bottle / Tablet selling & receiving units)
export const packVariants = pgTable(
  'pack_variants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').notNull(),
    variantName: text('variant_name').notNull(),
    packUnit: text('pack_unit').notNull(), // tablet | capsule | strip | box | bottle | pack | unit
    currentBaseQty: integer('current_base_qty').notNull(),
    currentConversionVersion: integer('current_conversion_version').notNull().default(1),
    defaultSalePriceMinor: integer('default_sale_price_minor').notNull().default(0),
    currency: text('currency').notNull().default('LKR'),
    allowPosSale: boolean('allow_pos_sale').notNull().default(true),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('pack_variants_tenant_id_id_uniq').on(table.id, table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'pack_variants_product_tenant_fk',
    }),
    check('pack_variants_base_qty_pos_chk', sql`${table.currentBaseQty} > 0`),
    check('pack_variants_price_nonneg_chk', sql`${table.defaultSalePriceMinor} >= 0`),
  ]
);

// 23. Versioned UOM Conversions (Immutable historical conversion snapshots)
export const uomConversions = pgTable(
  'uom_conversions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').notNull(),
    packVariantId: uuid('pack_variant_id').notNull(),
    version: integer('version').notNull(),
    packUnit: text('pack_unit').notNull(),
    baseUnit: text('base_unit').notNull(),
    baseQtyPerPack: integer('base_qty_per_pack').notNull(),
    effectiveFrom: timestamp('effective_from', { withTimezone: true }).defaultNow().notNull(),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    notes: text('notes').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('uom_conv_tenant_id_id_uniq').on(table.id, table.tenantId),
    uniqueIndex('uom_conv_variant_version_uidx').on(
      table.tenantId,
      table.packVariantId,
      table.version
    ),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'uom_conv_product_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.packVariantId],
      foreignColumns: [packVariants.tenantId, packVariants.id],
      name: 'uom_conv_variant_tenant_fk',
    }),
    check('uom_conv_qty_pos_chk', sql`${table.baseQtyPerPack} > 0`),
  ]
);

// 24. Barcode Aliases (Duplicate detection & conflict resolution)
export const barcodeAliases = pgTable(
  'barcode_aliases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    productId: uuid('product_id').notNull(),
    packVariantId: uuid('pack_variant_id').notNull(),
    barcode: text('barcode').notNull(),
    barcodeType: text('barcode_type').notNull().default('ean13'),
    status: text('status').notNull().default('active'), // active | conflict_review | inactive
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('barcode_aliases_tenant_id_id_uniq').on(table.id, table.tenantId),
    index('barcode_aliases_tenant_code_idx').on(table.tenantId, table.barcode),
    uniqueIndex('barcode_aliases_unique_pair_uidx').on(
      table.tenantId,
      table.packVariantId,
      table.barcode
    ),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'barcode_product_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.packVariantId],
      foreignColumns: [packVariants.tenantId, packVariants.id],
      name: 'barcode_variant_tenant_fk',
    }),
  ]
);

// 25. Suppliers
export const suppliers = pgTable(
  'suppliers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    legalEntityId: uuid('legal_entity_id').notNull(),
    name: text('name').notNull(),
    registrationRef: text('registration_ref').notNull().default(''),
    contactName: text('contact_name').notNull().default(''),
    phone: text('phone').notNull().default(''),
    email: text('email').notNull().default(''),
    status: text('status').notNull().default('approved'), // approved | pending_review | suspended
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('suppliers_tenant_id_id_uniq').on(table.id, table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'suppliers_legal_entity_tenant_fk',
    }),
    check('suppliers_status_chk', sql`${table.status} IN ('approved', 'pending_review', 'suspended')`),
  ]
);

// 26. Storage Locations (Dispensary shelves, store room, cold chain, quarantine cage)
export const storageLocations = pgTable(
  'storage_locations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    locationType: text('location_type').notNull().default('dispensary'), // dispensary | store_room | cold_chain | quarantine
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('storage_locs_tenant_id_id_uniq').on(table.id, table.tenantId),
    uniqueIndex('storage_locs_branch_code_uidx').on(table.tenantId, table.branchId, table.code),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'storage_locs_branch_tenant_fk',
    }),
    check(
      'storage_locs_type_chk',
      sql`${table.locationType} IN ('dispensary', 'store_room', 'cold_chain', 'quarantine')`
    ),
  ]
);

// 27. Lots / Batches (Product + manufacturer + batch + printed expiry + quality status)
export const lots = pgTable(
  'lots',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull(),
    productId: uuid('product_id').notNull(),
    manufacturer: text('manufacturer').notNull(),
    batchNumber: text('batch_number').notNull(),
    printedExpiry: text('printed_expiry').notNull(), // e.g., '2027-08-31' | '2027-08' | 'UNKNOWN'
    expiryPrecision: text('expiry_precision').notNull(), // day | month | unknown
    expiryCutoffDate: text('expiry_cutoff_date'), // YYYY-MM-DD in branch timezone; NULL if unknown
    qualityStatus: text('quality_status').notNull().default('quarantine'), // quarantine | released | blocked
    quarantineReason: text('quarantine_reason').notNull().default(''),
    releasedByGrantId: uuid('released_by_grant_id'),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('lots_tenant_id_id_uniq').on(table.id, table.tenantId),
    uniqueIndex('lots_unique_batch_uidx').on(
      table.tenantId,
      table.branchId,
      table.productId,
      table.manufacturer,
      table.batchNumber
    ),
    index('lots_expiry_lookup_idx').on(table.tenantId, table.branchId, table.productId, table.expiryCutoffDate),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'lots_branch_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'lots_product_tenant_fk',
    }),
    check('lots_precision_chk', sql`${table.expiryPrecision} IN ('day', 'month', 'unknown')`),
    check('lots_quality_status_chk', sql`${table.qualityStatus} IN ('quarantine', 'released', 'blocked')`),
  ]
);

// 28. Receipt Cost Layers (Keeps separate receipt costs even if same physical lot arrives twice)
export const costLayers = pgTable(
  'cost_layers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull(),
    productId: uuid('product_id').notNull(),
    lotId: uuid('lot_id').notNull(),
    goodsReceiptLineId: uuid('goods_receipt_line_id').notNull(),
    unitCostMinor: integer('unit_cost_minor').notNull(),
    totalCostMinor: integer('total_cost_minor').notNull(),
    initialQtyBase: integer('initial_qty_base').notNull(),
    remainingQtyBase: integer('remaining_qty_base').notNull(),
    isProvisional: boolean('is_provisional').notNull().default(false),
    receivedAt: timestamp('received_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('cost_layers_tenant_id_id_uniq').on(table.id, table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'cost_layers_branch_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'cost_layers_product_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.lotId],
      foreignColumns: [lots.tenantId, lots.id],
      name: 'cost_layers_lot_tenant_fk',
    }),
    check('cost_layers_unit_nonneg_chk', sql`${table.unitCostMinor} >= 0`),
    check('cost_layers_init_pos_chk', sql`${table.initialQtyBase} > 0`),
    check(
      'cost_layers_rem_bounds_chk',
      sql`${table.remainingQtyBase} >= 0 AND ${table.remainingQtyBase} <= ${table.initialQtyBase}`
    ),
  ]
);

// 29. Transactional Inventory Balances (Discrete buckets, strictly >= 0)
export const inventoryBalances = pgTable(
  'inventory_balances',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull(),
    locationId: uuid('location_id').notNull(),
    productId: uuid('product_id').notNull(),
    lotId: uuid('lot_id').notNull(),
    sellableOnHand: integer('sellable_on_hand').notNull().default(0),
    reservedQty: integer('reserved_qty').notNull().default(0),
    quarantineQty: integer('quarantine_qty').notNull().default(0),
    returnedQuarantineQty: integer('returned_quarantine_qty').notNull().default(0),
    damagedQty: integer('damaged_qty').notNull().default(0),
    expiredQty: integer('expired_qty').notNull().default(0),
    recalledQty: integer('recalled_qty').notNull().default(0),
    disposedQty: integer('disposed_qty').notNull().default(0),
    version: integer('version').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('inv_balances_tenant_id_id_uniq').on(table.id, table.tenantId),
    uniqueIndex('inv_balances_scope_uidx').on(
      table.tenantId,
      table.branchId,
      table.locationId,
      table.productId,
      table.lotId
    ),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'inv_bal_branch_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [storageLocations.tenantId, storageLocations.id],
      name: 'inv_bal_loc_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'inv_bal_product_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.lotId],
      foreignColumns: [lots.tenantId, lots.id],
      name: 'inv_bal_lot_tenant_fk',
    }),
    check('inv_bal_sellable_nonneg_chk', sql`${table.sellableOnHand} >= 0`),
    check(
      'inv_bal_reserved_bounds_chk',
      sql`${table.reservedQty} >= 0 AND ${table.reservedQty} <= ${table.sellableOnHand}`
    ),
    check('inv_bal_quarantine_nonneg_chk', sql`${table.quarantineQty} >= 0`),
    check('inv_bal_ret_quarantine_nonneg_chk', sql`${table.returnedQuarantineQty} >= 0`),
    check('inv_bal_damaged_nonneg_chk', sql`${table.damagedQty} >= 0`),
    check('inv_bal_expired_nonneg_chk', sql`${table.expiredQty} >= 0`),
    check('inv_bal_recalled_nonneg_chk', sql`${table.recalledQty} >= 0`),
    check('inv_bal_disposed_nonneg_chk', sql`${table.disposedQty} >= 0`),
  ]
);

// 30. Append-Only Stock Movements (Immutable ledger)
export const stockMovements = pgTable(
  'stock_movements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull(),
    locationId: uuid('location_id').notNull(),
    productId: uuid('product_id').notNull(),
    lotId: uuid('lot_id').notNull(),
    costLayerId: uuid('cost_layer_id'),
    movementType: text('movement_type').notNull(),
    qtyBase: integer('qty_base').notNull(),
    fromBucket: text('from_bucket'),
    toBucket: text('to_bucket'),
    reason: text('reason').notNull(),
    sourceDocType: text('source_doc_type').notNull(),
    sourceDocId: text('source_doc_id').notNull(),
    commandId: uuid('command_id'),
    packVariantId: uuid('pack_variant_id'),
    uomConversionVersion: integer('uom_conversion_version'),
    actorUserId: integer('actor_user_id').references(() => users.id),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('stock_movements_product_idx').on(table.tenantId, table.branchId, table.productId, table.occurredAt),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'stock_mov_branch_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [storageLocations.tenantId, storageLocations.id],
      name: 'stock_mov_loc_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'stock_mov_product_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.lotId],
      foreignColumns: [lots.tenantId, lots.id],
      name: 'stock_mov_lot_tenant_fk',
    }),
    check('stock_movements_qty_pos_chk', sql`${table.qtyBase} > 0`),
  ]
);

// 31. Stock Reservations (Short-lived POS/handoff allocations with TTL)
export const stockReservations = pgTable(
  'stock_reservations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull(),
    locationId: uuid('location_id').notNull(),
    productId: uuid('product_id').notNull(),
    lotId: uuid('lot_id').notNull(),
    cartId: uuid('cart_id'),
    qtyBase: integer('qty_base').notNull(),
    status: text('status').notNull().default('active'), // active | consumed | released | expired | invalidated
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('stock_res_tenant_id_id_uniq').on(table.id, table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'stock_res_branch_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.locationId],
      foreignColumns: [storageLocations.tenantId, storageLocations.id],
      name: 'stock_res_loc_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'stock_res_product_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.lotId],
      foreignColumns: [lots.tenantId, lots.id],
      name: 'stock_res_lot_tenant_fk',
    }),
    check('stock_res_qty_pos_chk', sql`${table.qtyBase} > 0`),
    check(
      'stock_res_status_chk',
      sql`${table.status} IN ('active', 'consumed', 'released', 'expired', 'invalidated')`
    ),
  ]
);

// 32. Goods Receipts (GRN — physical receiving & opening stock import)
export const goodsReceipts = pgTable(
  'goods_receipts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    legalEntityId: uuid('legal_entity_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    supplierId: uuid('supplier_id').notNull(),
    supplierDocRef: text('supplier_doc_ref').notNull(),
    docType: text('doc_type').notNull().default('grn'), // grn | opening_balance
    receivedDate: text('received_date').notNull(), // YYYY-MM-DD
    status: text('status').notNull().default('posted'),
    notes: text('notes').notNull().default(''),
    commandId: uuid('command_id'),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    postedAt: timestamp('posted_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('grn_tenant_id_id_uniq').on(table.id, table.tenantId),
    uniqueIndex('grn_supplier_doc_uidx').on(table.tenantId, table.supplierId, table.supplierDocRef),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'grn_legal_entity_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'grn_branch_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: 'grn_supplier_tenant_fk',
    }),
    check('grn_doc_type_chk', sql`${table.docType} IN ('grn', 'opening_balance')`),
  ]
);

// 33. Goods Receipt Lines (Accepted vs. Quarantine splits & UOM version snapshots)
export const goodsReceiptLines = pgTable(
  'goods_receipt_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    goodsReceiptId: uuid('goods_receipt_id').notNull(),
    productId: uuid('product_id').notNull(),
    packVariantId: uuid('pack_variant_id').notNull(),
    uomConversionVersion: integer('uom_conversion_version').notNull(),
    lotId: uuid('lot_id').notNull(),
    storageLocationId: uuid('storage_location_id').notNull(),
    orderedPacks: integer('ordered_packs').notNull().default(0),
    receivedPacks: integer('received_packs').notNull(),
    bonusPacks: integer('bonus_packs').notNull().default(0),
    acceptedQtyBase: integer('accepted_qty_base').notNull(),
    quarantinedQtyBase: integer('quarantined_qty_base').notNull().default(0),
    unitPackCostMinor: integer('unit_pack_cost_minor').notNull(),
    totalLineCostMinor: integer('total_line_cost_minor').notNull(),
    isProvisionalCost: boolean('is_provisional_cost').notNull().default(false),
    condition: text('condition').notNull().default('good'), // good | damaged | unknown_expiry | inspection_required
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('grn_lines_tenant_id_id_uniq').on(table.id, table.tenantId),
    foreignKey({
      columns: [table.tenantId, table.goodsReceiptId],
      foreignColumns: [goodsReceipts.tenantId, goodsReceipts.id],
      name: 'grn_lines_grn_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'grn_lines_product_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.packVariantId],
      foreignColumns: [packVariants.tenantId, packVariants.id],
      name: 'grn_lines_variant_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.lotId],
      foreignColumns: [lots.tenantId, lots.id],
      name: 'grn_lines_lot_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.storageLocationId],
      foreignColumns: [storageLocations.tenantId, storageLocations.id],
      name: 'grn_lines_loc_tenant_fk',
    }),
    check('grn_lines_accepted_nonneg_chk', sql`${table.acceptedQtyBase} >= 0`),
    check('grn_lines_quarantine_nonneg_chk', sql`${table.quarantinedQtyBase} >= 0`),
  ]
);

// 34. Supplier Invoices (Distinct from GRN; posting an invoice NEVER creates stock)
export const supplierInvoices = pgTable(
  'supplier_invoices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    legalEntityId: uuid('legal_entity_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    supplierId: uuid('supplier_id').notNull(),
    goodsReceiptId: uuid('goods_receipt_id'),
    invoiceNumber: text('invoice_number').notNull(),
    invoiceDate: text('invoice_date').notNull(),
    totalMinor: integer('total_minor').notNull(),
    currency: text('currency').notNull().default('LKR'),
    status: text('status').notNull().default('posted'), // posted | disputed | paid
    commandId: uuid('command_id'),
    createdByUserId: integer('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('supplier_invoices_tenant_id_id_uniq').on(table.tenantId, table.id),
    uniqueIndex('supplier_invoices_number_uidx').on(
      table.tenantId,
      table.supplierId,
      table.invoiceNumber
    ),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'sup_inv_legal_entity_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'sup_inv_branch_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.supplierId],
      foreignColumns: [suppliers.tenantId, suppliers.id],
      name: 'sup_inv_supplier_tenant_fk',
    }),
    check('supplier_invoices_total_nonneg_chk', sql`${table.totalMinor} >= 0`),
  ]
);

// 35. Recalls (Product / Lot / Manufacturer safety guards)
export const recalls = pgTable(
  'recalls',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    scopeType: text('scope_type').notNull(), // product | lot | manufacturer
    productId: uuid('product_id'),
    lotId: uuid('lot_id'),
    manufacturer: text('manufacturer'),
    referenceCode: text('reference_code').notNull(),
    reason: text('reason').notNull(),
    status: text('status').notNull().default('active'), // active | lifted
    effectiveAt: timestamp('effective_at', { withTimezone: true }).defaultNow().notNull(),
    activatedByUserId: integer('activated_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('recalls_tenant_id_id_uniq').on(table.tenantId, table.id),
    check('recalls_scope_chk', sql`${table.scopeType} IN ('product', 'lot', 'manufacturer')`),
    check('recalls_status_chk', sql`${table.status} IN ('active', 'lifted')`),
  ]
);

// 36. Quality Holds (Lot-level quarantine / cold-chain / damage holds)
export const qualityHolds = pgTable(
  'quality_holds',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull(),
    productId: uuid('product_id').notNull(),
    lotId: uuid('lot_id').notNull(),
    holdType: text('hold_type').notNull(), // quarantine | cold_chain_excursion | recall | damaged
    reason: text('reason').notNull(),
    status: text('status').notNull().default('active'), // active | released
    placedByUserId: integer('placed_by_user_id').references(() => users.id),
    releasedByGrantId: uuid('released_by_grant_id'),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('quality_holds_tenant_id_id_uniq').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'quality_holds_branch_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'quality_holds_product_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.lotId],
      foreignColumns: [lots.tenantId, lots.id],
      name: 'quality_holds_lot_tenant_fk',
    }),
    check(
      'quality_holds_type_chk',
      sql`${table.holdType} IN ('quarantine', 'cold_chain_excursion', 'recall', 'damaged')`
    ),
    check('quality_holds_status_chk', sql`${table.status} IN ('active', 'released')`),
  ]
);

// ============================================================
// PHARMACY PHASE 2: TILL SHIFTS, RETAIL POS, FEFO, GATE & RETURNS
// ============================================================

// 37. Till Shifts (Cashier cash drawer open/close & variance audit)
export const tillShifts = pgTable(
  'till_shifts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull(),
    counterId: uuid('counter_id').notNull(),
    openedByUserId: integer('opened_by_user_id')
      .notNull()
      .references(() => users.id),
    closedByUserId: integer('closed_by_user_id').references(() => users.id),
    openingFloatMinor: integer('opening_float_minor').notNull().default(0),
    cashSalesMinor: integer('cash_sales_minor').notNull().default(0),
    cashRefundsMinor: integer('cash_refunds_minor').notNull().default(0),
    cashDropsMinor: integer('cash_drops_minor').notNull().default(0),
    paidOutsMinor: integer('paid_outs_minor').notNull().default(0),
    expectedCashMinor: integer('expected_cash_minor').notNull().default(0),
    countedCashMinor: integer('counted_cash_minor'),
    varianceMinor: integer('variance_minor'),
    closeNotes: text('close_notes').notNull().default(''),
    status: text('status').notNull().default('open'), // open | closed
    openedAt: timestamp('opened_at', { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  (table) => [
    unique('till_shifts_tenant_id_id_uniq').on(table.tenantId, table.id),
    index('till_shifts_open_idx').on(table.tenantId, table.branchId, table.status),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'till_shifts_branch_tenant_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.counterId],
      foreignColumns: [counters.tenantId, counters.id],
      name: 'till_shifts_counter_tenant_fk',
    }),
    check('till_shifts_float_nonneg_chk', sql`${table.openingFloatMinor} >= 0`),
    check('till_shifts_status_chk', sql`${table.status} IN ('open', 'closed')`),
  ]
);

// 38. Till Cash Events (Drops, paid-outs, float top-ups inside an open shift)
export const tillCashEvents = pgTable(
  'till_cash_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    shiftId: uuid('shift_id').notNull(),
    eventType: text('event_type').notNull(), // drop | paid_out | top_up
    amountMinor: integer('amount_minor').notNull(),
    reason: text('reason').notNull(),
    actorUserId: integer('actor_user_id')
      .notNull()
      .references(() => users.id),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.shiftId],
      foreignColumns: [tillShifts.tenantId, tillShifts.id],
      name: 'till_events_shift_tenant_fk',
    }),
    check('till_events_type_chk', sql`${table.eventType} IN ('drop', 'paid_out', 'top_up')`),
    check('till_events_amount_pos_chk', sql`${table.amountMinor} > 0`),
  ]
);

// 39. Pharmacist Checkout Approvals (Cart-hash bound release gate for Rx/Controlled items)
export const pharmacistCheckoutApprovals = pgTable(
  'pharmacist_checkout_approvals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull(),
    cartHash: text('cart_hash').notNull(),
    pharmacistUserId: integer('pharmacist_user_id')
      .notNull()
      .references(() => users.id),
    grantId: uuid('grant_id').notNull(),
    licenseNumber: text('license_number').notNull(),
    prescriptionRef: text('prescription_ref').notNull().default(''),
    notes: text('notes').notNull().default(''),
    itemsSnapshotJson: jsonb('items_snapshot_json').notNull(),
    status: text('status').notNull().default('active'), // active | consumed | invalidated | expired
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('pharm_approvals_tenant_id_id_uniq').on(table.tenantId, table.id),
    index('pharm_approvals_hash_idx').on(table.tenantId, table.cartHash, table.status),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'pharm_approvals_branch_tenant_fk',
    }),
    check(
      'pharm_approvals_status_chk',
      sql`${table.status} IN ('active', 'consumed', 'invalidated', 'expired')`
    ),
  ]
);

// 40. POS Sales (Atomic retail pharmacy checkout header)
export const posSales = pgTable(
  'pos_sales',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    legalEntityId: uuid('legal_entity_id').notNull(),
    branchId: uuid('branch_id').notNull(),
    counterId: uuid('counter_id').notNull(),
    shiftId: uuid('shift_id').notNull(),
    personId: uuid('person_id'),
    saleNumber: text('sale_number').notNull(),
    cartHash: text('cart_hash').notNull(),
    approvalId: uuid('approval_id'),
    subtotalMinor: integer('subtotal_minor').notNull(),
    discountMinor: integer('discount_minor').notNull().default(0),
    totalMinor: integer('total_minor').notNull(),
    paidMinor: integer('paid_minor').notNull(),
    changeMinor: integer('change_minor').notNull().default(0),
    currency: text('currency').notNull().default('LKR'),
    status: text('status').notNull().default('completed'), // completed | partially_returned | returned
    commandId: uuid('command_id'),
    cashierUserId: integer('cashier_user_id')
      .notNull()
      .references(() => users.id),
    soldAt: timestamp('sold_at', { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('pos_sales_tenant_id_id_uniq').on(table.tenantId, table.id),
    uniqueIndex('pos_sales_tenant_number_uidx').on(table.tenantId, table.saleNumber),
    foreignKey({
      columns: [table.tenantId, table.legalEntityId],
      foreignColumns: [legalEntities.tenantId, legalEntities.id],
      name: 'pos_sales_legal_entity_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'pos_sales_branch_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.counterId],
      foreignColumns: [counters.tenantId, counters.id],
      name: 'pos_sales_counter_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.shiftId],
      foreignColumns: [tillShifts.tenantId, tillShifts.id],
      name: 'pos_sales_shift_fk',
    }),
    check('pos_sales_total_nonneg_chk', sql`${table.totalMinor} >= 0`),
    check('pos_sales_paid_valid_chk', sql`${table.paidMinor} >= ${table.totalMinor}`),
    check('pos_sales_change_nonneg_chk', sql`${table.changeMinor} >= 0`),
    check(
      'pos_sales_status_chk',
      sql`${table.status} IN ('completed', 'partially_returned', 'returned')`
    ),
  ]
);

// 41. POS Sale Lines
export const posSaleLines = pgTable(
  'pos_sale_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    saleId: uuid('sale_id').notNull(),
    productId: uuid('product_id').notNull(),
    packVariantId: uuid('pack_variant_id').notNull(),
    uomConversionVersion: integer('uom_conversion_version').notNull(),
    qtyPacks: integer('qty_packs').notNull(),
    qtyBase: integer('qty_base').notNull(),
    returnedQtyBase: integer('returned_qty_base').notNull().default(0),
    unitSalePriceMinor: integer('unit_sale_price_minor').notNull(),
    lineTotalMinor: integer('line_total_minor').notNull(),
    requiresPharmacistRelease: boolean('requires_pharmacist_release').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('pos_sale_lines_tenant_id_id_uniq').on(table.tenantId, table.id),
    foreignKey({
      columns: [table.tenantId, table.saleId],
      foreignColumns: [posSales.tenantId, posSales.id],
      name: 'pos_lines_sale_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.productId],
      foreignColumns: [products.tenantId, products.id],
      name: 'pos_lines_product_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.packVariantId],
      foreignColumns: [packVariants.tenantId, packVariants.id],
      name: 'pos_lines_variant_fk',
    }),
    check('pos_lines_qty_pos_chk', sql`${table.qtyPacks} > 0 AND ${table.qtyBase} > 0`),
    check(
      'pos_lines_ret_bounds_chk',
      sql`${table.returnedQtyBase} >= 0 AND ${table.returnedQtyBase} <= ${table.qtyBase}`
    ),
  ]
);

// 42. POS Sale Lot Allocations (Exact FEFO lot & cost layer trace for COGS and returns)
export const posSaleAllocations = pgTable(
  'pos_sale_allocations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    saleId: uuid('sale_id').notNull(),
    saleLineId: uuid('sale_line_id').notNull(),
    lotId: uuid('lot_id').notNull(),
    costLayerId: uuid('cost_layer_id').notNull(),
    storageLocationId: uuid('storage_location_id').notNull(),
    qtyBase: integer('qty_base').notNull(),
    unitCostMinor: integer('unit_cost_minor').notNull(),
    totalCostMinor: integer('total_cost_minor').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.saleId],
      foreignColumns: [posSales.tenantId, posSales.id],
      name: 'pos_alloc_sale_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.saleLineId],
      foreignColumns: [posSaleLines.tenantId, posSaleLines.id],
      name: 'pos_alloc_line_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.lotId],
      foreignColumns: [lots.tenantId, lots.id],
      name: 'pos_alloc_lot_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.costLayerId],
      foreignColumns: [costLayers.tenantId, costLayers.id],
      name: 'pos_alloc_cost_layer_fk',
    }),
    check('pos_alloc_qty_pos_chk', sql`${table.qtyBase} > 0`),
  ]
);

// 43. POS Payments (Split tender: cash | card | bank)
export const posPayments = pgTable(
  'pos_payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    saleId: uuid('sale_id').notNull(),
    method: text('method').notNull(), // cash | card | bank
    amountMinor: integer('amount_minor').notNull(),
    referenceNumber: text('reference_number').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.saleId],
      foreignColumns: [posSales.tenantId, posSales.id],
      name: 'pos_payments_sale_fk',
    }),
    check('pos_payments_method_chk', sql`${table.method} IN ('cash', 'card', 'bank')`),
    check('pos_payments_amount_pos_chk', sql`${table.amountMinor} > 0`),
  ]
);

// 44. POS Receipts (Immutable thermal/A4 print snapshot)
export const posReceipts = pgTable(
  'pos_receipts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    saleId: uuid('sale_id').notNull(),
    receiptNumber: text('receipt_number').notNull(),
    snapshotJson: jsonb('snapshot_json').notNull(),
    issuedAt: timestamp('issued_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('pos_receipts_tenant_number_uidx').on(table.tenantId, table.receiptNumber),
    foreignKey({
      columns: [table.tenantId, table.saleId],
      foreignColumns: [posSales.tenantId, posSales.id],
      name: 'pos_receipts_sale_fk',
    }),
  ]
);

// 45. Customer Returns (Strictly routes returned qty into returnedQuarantineQty — NEVER auto sellable)
export const posReturns = pgTable(
  'pos_returns',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    branchId: uuid('branch_id').notNull(),
    saleId: uuid('sale_id').notNull(),
    shiftId: uuid('shift_id').notNull(),
    returnNumber: text('return_number').notNull(),
    reason: text('reason').notNull(),
    refundMethod: text('refund_method').notNull(), // cash | card | bank
    refundAmountMinor: integer('refund_amount_minor').notNull(),
    currency: text('currency').notNull().default('LKR'),
    commandId: uuid('command_id'),
    processedByUserId: integer('processed_by_user_id')
      .notNull()
      .references(() => users.id),
    returnedAt: timestamp('returned_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique('pos_returns_tenant_id_id_uniq').on(table.tenantId, table.id),
    uniqueIndex('pos_returns_tenant_number_uidx').on(table.tenantId, table.returnNumber),
    foreignKey({
      columns: [table.tenantId, table.branchId],
      foreignColumns: [branches.tenantId, branches.id],
      name: 'pos_returns_branch_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.saleId],
      foreignColumns: [posSales.tenantId, posSales.id],
      name: 'pos_returns_sale_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.shiftId],
      foreignColumns: [tillShifts.tenantId, tillShifts.id],
      name: 'pos_returns_shift_fk',
    }),
    check('pos_returns_refund_method_chk', sql`${table.refundMethod} IN ('cash', 'card', 'bank')`),
    check('pos_returns_amount_nonneg_chk', sql`${table.refundAmountMinor} >= 0`),
  ]
);

// 46. Customer Return Lines
export const posReturnLines = pgTable(
  'pos_return_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    tenantId: uuid('tenant_id')
      .notNull()
      .references(() => tenants.id, { onDelete: 'cascade' }),
    returnId: uuid('return_id').notNull(),
    saleLineId: uuid('sale_line_id').notNull(),
    productId: uuid('product_id').notNull(),
    lotId: uuid('lot_id').notNull(),
    storageLocationId: uuid('storage_location_id').notNull(),
    qtyBase: integer('qty_base').notNull(),
    refundMinor: integer('refund_minor').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    foreignKey({
      columns: [table.tenantId, table.returnId],
      foreignColumns: [posReturns.tenantId, posReturns.id],
      name: 'pos_ret_lines_return_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.saleLineId],
      foreignColumns: [posSaleLines.tenantId, posSaleLines.id],
      name: 'pos_ret_lines_sale_line_fk',
    }),
    foreignKey({
      columns: [table.tenantId, table.lotId],
      foreignColumns: [lots.tenantId, lots.id],
      name: 'pos_ret_lines_lot_fk',
    }),
    check('pos_ret_lines_qty_pos_chk', sql`${table.qtyBase} > 0`),
    check('pos_ret_lines_refund_nonneg_chk', sql`${table.refundMinor} >= 0`),
  ]
);
