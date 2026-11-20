import { z } from 'zod';

export const SupportedLocaleSchema = z.enum(['si-LK', 'en-LK']);
export type SupportedLocale = z.infer<typeof SupportedLocaleSchema>;

export const RoleSchema = z.enum([
  'owner',
  'manager',
  'receptionist',
  'cashier',
  'stock_keeper',
  'accountant',
]);
export type Role = z.infer<typeof RoleSchema>;

export const ProductModeSchema = z.enum([
  'clinic_only',
  'pharmacy_inventory_only',
  'pharmacy_retail_only',
  'combo',
]);
export type ProductMode = z.infer<typeof ProductModeSchema>;

export const ProfessionalGrantTypeSchema = z.enum(['pharmacist', 'clinician']);
export type ProfessionalGrantType = z.infer<typeof ProfessionalGrantTypeSchema>;

export const CapabilityKeySchema = z.enum([
  // Clinic capabilities
  'appointments.manage',
  'attendance.manage',
  'collections.record',
  // Pharmacy capabilities
  'pharmacy.catalogue',
  'pharmacy.receiving',
  'pharmacy.inventory',
  'pharmacy.pos',
  'pharmacy.returns',
  'pharmacy.professional_gate',
  // Mandatory non-disableable safety capabilities
  'safety.tenant_isolation',
  'safety.audit_trail',
  'safety.expiry_recall_guard',
  'safety.ledger_integrity',
  // Shared reporting & assistant capabilities
  'reports.basic',
  'assistant.text',
  'assistant.voice',
  'exports.csv',
  // Department Add-On Packs
  'accounts.ledger',
  'purchasing.orders',
  'hr.management',
  'admin.operations',
]);
export type CapabilityKey = z.infer<typeof CapabilityKeySchema>;

export type PermissionKey =
  | 'directory.read'
  | 'appointments.read'
  | 'appointments.write'
  | 'attendance.write'
  | 'payments.record'
  | 'reports.branch_summary'
  | 'reports.all_financials'
  | 'payments.reverse_stepup'
  | 'services.manage_stepup'
  | 'team.manage_stepup'
  | 'exports.bulk_stepup'
  | 'audit.read'
  | 'pharmacy.catalogue.read'
  | 'pharmacy.catalogue.write'
  | 'pharmacy.receiving.write'
  | 'pharmacy.invoice.write'
  | 'pharmacy.stock.read'
  | 'pharmacy.pos.sell'
  | 'pharmacy.lot.quarantine_place'
  | 'platform.capabilities.manage'
  | 'platform.grants.manage'
  | 'billing.read'
  | 'billing.manage'
  | 'accounts.read'
  | 'accounts.write'
  | 'purchasing.read'
  | 'purchasing.write'
  | 'purchasing.approve'
  | 'hr.attendance.self'
  | 'hr.manage'
  | 'hr.payroll.manage'
  | 'admin.ops.manage';

export const ROLE_PERMISSIONS: Record<Role, readonly PermissionKey[]> = {
  owner: [
    'directory.read',
    'appointments.read',
    'appointments.write',
    'attendance.write',
    'payments.record',
    'reports.branch_summary',
    'reports.all_financials',
    'payments.reverse_stepup',
    'services.manage_stepup',
    'team.manage_stepup',
    'exports.bulk_stepup',
    'audit.read',
    'pharmacy.catalogue.read',
    'pharmacy.catalogue.write',
    'pharmacy.receiving.write',
    'pharmacy.invoice.write',
    'pharmacy.stock.read',
    'pharmacy.pos.sell',
    'pharmacy.lot.quarantine_place',
    'platform.capabilities.manage',
    'platform.grants.manage',
    'billing.read',
    'billing.manage',
    'accounts.read',
    'accounts.write',
    'purchasing.read',
    'purchasing.write',
    'purchasing.approve',
    'hr.attendance.self',
    'hr.manage',
    'hr.payroll.manage',
    'admin.ops.manage',
  ],
  manager: [
    'directory.read',
    'appointments.read',
    'appointments.write',
    'attendance.write',
    'payments.record',
    'reports.branch_summary',
    'audit.read',
    'pharmacy.catalogue.read',
    'pharmacy.catalogue.write',
    'pharmacy.receiving.write',
    'pharmacy.invoice.write',
    'pharmacy.stock.read',
    'pharmacy.pos.sell',
    'pharmacy.lot.quarantine_place',
    'billing.read',
    'accounts.read',
    'accounts.write',
    'purchasing.read',
    'purchasing.write',
    'purchasing.approve',
    'hr.attendance.self',
    'hr.manage',
    'admin.ops.manage',
  ],
  receptionist: [
    'directory.read',
    'appointments.read',
    'appointments.write',
    'attendance.write',
    'payments.record',
    'reports.branch_summary',
    'accounts.read',
    'hr.attendance.self',
    'admin.ops.manage',
  ],
  cashier: [
    'directory.read',
    'payments.record',
    'reports.branch_summary',
    'pharmacy.catalogue.read',
    'pharmacy.stock.read',
    'pharmacy.pos.sell',
    'hr.attendance.self',
  ],
  stock_keeper: [
    'pharmacy.catalogue.read',
    'pharmacy.catalogue.write',
    'pharmacy.receiving.write',
    'pharmacy.stock.read',
    'pharmacy.lot.quarantine_place',
    'purchasing.read',
    'purchasing.write',
    'hr.attendance.self',
    'admin.ops.manage',
  ],
  accountant: [
    'reports.branch_summary',
    'reports.all_financials',
    'audit.read',
    'pharmacy.catalogue.read',
    'pharmacy.stock.read',
    'pharmacy.invoice.write',
    'billing.read',
    'accounts.read',
    'accounts.write',
    'purchasing.read',
    'hr.attendance.self',
    'hr.manage',
    'hr.payroll.manage',
  ],
};

export const OnboardingServiceInputSchema = z.object({
  name: z.string().trim().min(2).max(120),
  nameSi: z.string().trim().max(120).optional().default(''),
  durationMinutes: z.number().int().min(5).max(240),
  priceLkr: z.number().min(0).max(1000000),
});

export const OnboardingBootstrapSchema = z.object({
  preferredLocale: SupportedLocaleSchema,
  productMode: ProductModeSchema.default('combo'),
  clinicName: z.string().trim().min(2).max(120),
  legalEntityName: z.string().trim().min(2).max(140).optional(),
  branchName: z.string().trim().min(2).max(100).default('Main Branch'),
  countryCode: z.literal('LK'),
  timezone: z.literal('Asia/Colombo'),
  currency: z.literal('LKR'),
  confirmLocaleAndCurrency: z.literal(true),
  primaryPractitionerName: z.string().trim().min(2).max(120).optional().default('Primary Provider'),
  primaryPractitionerSpecialty: z.string().trim().max(100).optional().default('General Practice'),
  openingHoursSummary: z.string().trim().min(2).max(120).default('08:30 - 17:30'),
  services: z.array(OnboardingServiceInputSchema).max(6).default([
    {
      name: 'General Consultation',
      nameSi: 'සාමාන්‍ය වෛද්‍ය උපදේශනය',
      durationMinutes: 20,
      priceLkr: 2500,
    },
  ]),
  includeSampleData: z.boolean().default(true),
});
export type OnboardingBootstrapInput = z.infer<typeof OnboardingBootstrapSchema>;

export const InterpretTurnInputSchema = z.object({
  text: z.string().trim().min(1).max(600),
  locale: SupportedLocaleSchema.default('si-LK'),
  source: z.enum(['text', 'voice']).default('text'),
});
export type InterpretTurnInput = z.infer<typeof InterpretTurnInputSchema>;

export interface ApiErrorEnvelope {
  code: string;
  messageKey: string;
  message: string;
  retryable: boolean;
  correlationId: string;
  nextStep?: string;
}

export interface ProfessionalGrantSummary {
  id: string;
  grantType: ProfessionalGrantType;
  licenseNumber: string;
  active: boolean;
  expiresAt: string | null;
}

export interface SessionContextResponse {
  authenticated: true;
  user: {
    id: number;
    uid: string;
    email: string;
    displayName: string;
    preferredLocale: SupportedLocale;
  };
  requiresOnboarding: boolean;
  workspace: {
    tenantId: string;
    tenantName: string;
    tenantStatus: string;
    productMode: ProductMode;
    legalEntityId: string | null;
    legalEntityName: string | null;
    countryCode: string;
    timezone: string;
    currency: string;
    branchId: string;
    branchName: string;
    role: Role;
    permissions: readonly PermissionKey[];
    professionalGrants: ProfessionalGrantSummary[];
    capabilities: Record<string, boolean>;
  } | null;
  availableTenants: Array<{
    tenantId: string;
    tenantName: string;
    branchName: string;
    role: Role;
    productMode: ProductMode;
  }>;
}

export interface TodayAppointmentItem {
  id: string;
  businessDate: string;
  startsAt: string;
  endsAt: string;
  status: 'scheduled' | 'arrived' | 'completed' | 'cancelled' | 'no_show';
  personId: string;
  personName: string;
  phoneLast4: string;
  phone?: string;
  serviceId: string;
  serviceName: string;
  serviceNameSi: string;
  resourceId: string;
  resourceName: string;
  bookedDurationMinutes: number;
  bookedPriceMinor: number;
  currency: string;
  tokenNumber?: number;
  queueState?: 'waiting' | 'serving' | 'completed' | 'skipped';
  isSample: boolean;
  version: number;
}

export interface TodaySummaryResponse {
  tenantId: string;
  branchId: string;
  branchName: string;
  businessDate: string;
  timezone: string;
  currency: string;
  dataFreshAt: string;
  financialScope: 'branch_all' | 'own_recorded_only';
  counts: {
    total: number;
    scheduled: number;
    arrived: number;
    completed: number;
    cancelled: number;
    noShow: number;
  };
  recordedReceiptsMinor: number | null;
  appointments: TodayAppointmentItem[];
  services: Array<{
    id: string;
    name: string;
    nameSi: string;
    durationMinutes: number;
    priceMinor: number;
    currency: string;
  }>;
  resources: Array<{
    id: string;
    name: string;
    specialty: string;
  }>;
}

// SaaS Subscription & Monthly Client Billing Contracts
export const BillingCycleSchema = z.enum(['monthly', 'annual']);
export type BillingCycle = z.infer<typeof BillingCycleSchema>;

export const SubscriptionPaymentMethodSchema = z.enum(['card', 'lankaqr', 'bank_transfer']);
export type SubscriptionPaymentMethod = z.infer<typeof SubscriptionPaymentMethodSchema>;

export const UpdateSubscriptionPlanSchema = z.object({
  planCode: ProductModeSchema,
  billingCycle: BillingCycleSchema,
  autoRenew: z.boolean().optional(),
});
export type UpdateSubscriptionPlanInput = z.infer<typeof UpdateSubscriptionPlanSchema>;

export const GenerateSubscriptionInvoiceSchema = z.object({
  billingCycle: BillingCycleSchema.optional(),
});
export type GenerateSubscriptionInvoiceInput = z.infer<typeof GenerateSubscriptionInvoiceSchema>;

export const PaySubscriptionInvoiceSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
  invoiceId: z.string().trim().min(4).max(120),
  method: SubscriptionPaymentMethodSchema,
  savePaymentMethod: z.boolean().default(true),
  cardHolderName: z.string().trim().max(120).optional().default(''),
  cardNumber: z.string().trim().max(32).optional().default(''),
  cardExpiry: z.string().trim().max(10).optional().default(''),
  bankName: z.string().trim().max(100).optional().default(''),
  bankReference: z.string().trim().max(100).optional().default(''),
});
export type PaySubscriptionInvoiceInput = z.infer<typeof PaySubscriptionInvoiceSchema>;

export const PayHereWebhookSchema = z.object({
  merchant_id: z.string().trim().min(2),
  order_id: z.string().trim().min(4),
  payment_id: z.string().trim().min(2),
  payhere_amount: z.string().trim().min(1),
  payhere_currency: z.string().trim().default('LKR'),
  status_code: z.string().trim().min(1),
  md5sig: z.string().trim().min(8),
  method: z.string().trim().optional().default('VISA'),
  card_holder_name: z.string().trim().optional().default(''),
  card_no: z.string().trim().optional().default(''),
  card_expiry: z.string().trim().optional().default(''),
  recurring_token: z.string().trim().optional().default(''),
  gateway_provider: z.enum(['payhere', 'webxpay', 'genie']).optional().default('payhere'),
});
export type PayHereWebhookInput = z.infer<typeof PayHereWebhookSchema>;

export interface SubscriptionPlanDefinition {
  planCode: ProductMode;
  nameEn: string;
  nameSi: string;
  audienceEn: string;
  monthlyMinor: number;
  annualMinor: number;
  currency: 'LKR';
  staffLimit: number;
  branchLimit: number;
  counterLimit: number;
  voiceTurnsLimit: number;
  highlightsEn: string[];
  highlightsSi: string[];
}

export interface SubscriptionInvoiceItem {
  id: string;
  invoiceNumber: string;
  planCode: ProductMode;
  billingCycle: BillingCycle;
  description: string;
  billingPeriodStart: string;
  billingPeriodEnd: string;
  dueDate: string;
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  paidMinor: number;
  currency: string;
  status: 'open' | 'paid' | 'past_due' | 'void';
  issuedAt: string;
  paidAt: string | null;
}

export interface SubscriptionPaymentItem {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  amountMinor: number;
  currency: string;
  method: SubscriptionPaymentMethod;
  gatewayProvider: string;
  gatewayReference: string;
  cardBrand: string;
  cardLast4: string;
  bankName: string;
  bankReference: string;
  status: 'succeeded' | 'pending_verification' | 'failed';
  receiptNumber: string;
  paidAt: string;
}

export interface TrialGraceStatus {
  status: 'trialing' | 'active' | 'grace_read_only' | 'past_due' | 'suspended';
  trialDaysRemaining: number;
  graceDaysRemaining: number;
  isReadOnlyGrace: boolean;
  trialEndsAt: string;
  graceEndsAt: string;
  bannerMessageEn: string;
  bannerMessageSi: string;
}

export interface WorkspaceQuotaSummary {
  periodMonth: string;
  staffUsed: number;
  staffLimit: number;
  branchesUsed: number;
  branchLimit: number;
  countersUsed: number;
  counterLimit: number;
  voiceTurnsUsed: number;
  voiceTurnsLimit: number;
  whatsappSentCount: number;
  smsSentCount: number;
  overageAlerts: Array<{
    resource: 'staff' | 'branches' | 'counters' | 'voice_turns';
    used: number;
    limit: number;
    severity: 'warning' | 'exceeded';
    message: string;
  }>;
}

export interface TenantSubscriptionOverview {
  subscription: {
    id: string;
    tenantId: string;
    planCode: ProductMode;
    billingCycle: BillingCycle;
    status: 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled';
    monthlyAmountMinor: number;
    effectiveCycleAmountMinor: number;
    currency: string;
    currentPeriodStart: string;
    currentPeriodEnd: string;
    nextBillingDate: string;
    autoRenew: boolean;
    paymentMethodType: 'card' | 'lankaqr' | 'bank_transfer' | 'none';
    paymentMethodLabel: string;
    gatewayProvider: string;
    recurringTokenActive: boolean;
    trialEndsAt: string;
    graceEndsAt: string;
    lastWebhookAt: string | null;
  };
  trialGrace: TrialGraceStatus;
  quotas: WorkspaceQuotaSummary;
  plans: SubscriptionPlanDefinition[];
  invoices: SubscriptionInvoiceItem[];
  payments: SubscriptionPaymentItem[];
  outstandingMinor: number;
  bankTransferInstructions: {
    accountName: string;
    bankName: string;
    branchName: string;
    accountNumber: string;
    referenceHint: string;
  };
}

// WhatsApp & SMS Notification Contracts
export const NotificationChannelSchema = z.enum(['whatsapp', 'sms']);
export const NotificationProviderSchema = z.enum([
  'whatsapp_cloud',
  'notify_lk',
  'dialog_sms',
  'mobitel_sms',
]);
export const NotificationTemplateSchema = z.enum([
  'invoice_due',
  'payment_receipt',
  'appointment_reminder',
  'queue_token',
  'doctor_delay',
]);

export const SendNotificationSchema = z.object({
  channel: NotificationChannelSchema,
  provider: NotificationProviderSchema.default('notify_lk'),
  templateType: NotificationTemplateSchema,
  recipientPhone: z.string().trim().min(7).max(24),
  recipientName: z.string().trim().max(120).optional().default(''),
  messageBody: z.string().trim().min(5).max(800),
  entityType: z.string().trim().max(60).optional().default(''),
  entityId: z.string().trim().max(120).optional().default(''),
});
export type SendNotificationInput = z.infer<typeof SendNotificationSchema>;

export interface NotificationDispatchItem {
  id: string;
  channel: 'whatsapp' | 'sms';
  provider: string;
  templateType: string;
  recipientPhone: string;
  recipientName: string;
  messageBody: string;
  status: string;
  entityType: string;
  entityId: string;
  externalRef: string;
  whatsappDeepLink?: string;
  sentAt: string;
}

// Team Invites, Branches & Shift PIN Contracts
export const CreateBranchSchema = z.object({
  name: z.string().trim().min(2).max(100),
  code: z.string().trim().min(2).max(20),
  openingHoursSummary: z.string().trim().max(120).optional().default('08:30 - 18:00'),
});
export type CreateBranchInput = z.infer<typeof CreateBranchSchema>;

export const CreateStaffInviteSchema = z.object({
  email: z.string().trim().email(),
  displayName: z.string().trim().min(2).max(120).optional().default(''),
  role: RoleSchema,
  branchId: z.string().trim().min(4),
});
export type CreateStaffInviteInput = z.infer<typeof CreateStaffInviteSchema>;

export const SetShiftPinSchema = z.object({
  pin: z.string().trim().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits'),
});

export const VerifyShiftPinSchema = z.object({
  pin: z.string().trim().regex(/^\d{4,6}$/, 'PIN must be 4 to 6 digits'),
});

// J.A.R.V.I.S. Conversational Voice Engine Contracts
export const JarvisConverseInputSchema = z.object({
  sessionId: z.string().trim().min(4).max(120).default('jarvis-default'),
  message: z.string().trim().min(1).max(1000),
  locale: SupportedLocaleSchema.default('si-LK'),
  source: z.enum(['voice', 'text']).default('voice'),
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        text: z.string().max(1000),
      })
    )
    .max(12)
    .optional()
    .default([]),
});
export type JarvisConverseInput = z.infer<typeof JarvisConverseInputSchema>;

export interface JarvisConverseResponse {
  sessionId: string;
  replyText: string;
  replySpeechText: string;
  detectedLanguage: 'si-LK' | 'en-LK' | 'mixed';
  intent: string;
  toolCallsExecuted: Array<{
    tool: string;
    summary: string;
  }>;
  proposedAction: {
    actionType: 'create_appointment' | 'record_payment';
    proposalId: string;
    nonce: string;
    payload: Record<string, unknown>;
    summaryLabel: string;
  } | null;
  quickFollowUps: string[];
  quota: {
    voiceTurnsUsed: number;
    voiceTurnsLimit: number;
  };
  modelVersion: string;
}

// Silicon Valley 0-to-100 Autopilot, Governance, Checklists & Public Kiosk Contracts
export const UpdateGovernanceRulesSchema = z.object({
  maxCashierDiscountPercent: z.number().int().min(0).max(100),
  maxExpenseWithoutPinMinor: z.number().int().min(0).max(100_000_000),
  maxStockWriteoffWithoutPin: z.number().int().min(0).max(100_000),
  requireClosingChecklist: z.boolean(),
  autoReorderEnabled: z.boolean(),
  ownerDigestEnabled: z.boolean(),
  ownerWhatsappPhone: z.string().trim().max(30).optional().default(''),
});
export type UpdateGovernanceRulesInput = z.infer<typeof UpdateGovernanceRulesSchema>;

export const ToggleChecklistItemSchema = z.object({
  itemKey: z.string().trim().min(2).max(80),
  completed: z.boolean(),
});
export type ToggleChecklistItemInput = z.infer<typeof ToggleChecklistItemSchema>;

export const CompleteShiftChecklistSchema = z.object({
  cashDrawerCountLkr: z.number().min(0).max(500_000_000).optional().nullable(),
  handoverNotes: z.string().trim().max(500).optional().default(''),
});
export type CompleteShiftChecklistInput = z.infer<typeof CompleteShiftChecklistSchema>;

export const PublicSelfCheckInSchema = z.object({
  branchId: z.string().uuid().optional(),
  patientName: z.string().trim().min(2).max(120),
  phone: z.string().trim().min(7).max(24),
  serviceId: z.string().uuid(),
  resourceId: z.string().uuid(),
  notes: z.string().trim().max(300).optional().default(''),
});
export type PublicSelfCheckInInput = z.infer<typeof PublicSelfCheckInSchema>;

export interface WorkspaceGovernanceRuleView {
  maxCashierDiscountPercent: number;
  maxExpenseWithoutPinMinor: number;
  maxStockWriteoffWithoutPin: number;
  requireClosingChecklist: boolean;
  autoReorderEnabled: boolean;
  ownerDigestEnabled: boolean;
  ownerWhatsappPhone: string;
  updatedAt: string;
}

export interface ShiftChecklistRunView {
  id: string;
  businessDate: string;
  shiftType: 'opening' | 'closing';
  status: 'in_progress' | 'completed';
  items: Array<{
    key: string;
    labelEn: string;
    labelSi: string;
    category: 'cash' | 'safety' | 'clinic' | 'pharmacy';
    required: boolean;
    completed: boolean;
    completedByName: string;
    completedAt: string | null;
  }>;
  completedCount: number;
  totalCount: number;
  handoverNotes: string;
  cashDrawerCountMinor: number | null;
  completedByName: string;
  completedAt: string | null;
}

export interface AutopilotAnomalyItem {
  id: string;
  code: string;
  severity: 'info' | 'warning' | 'critical';
  category: string;
  titleEn: string;
  titleSi: string;
  detail: string;
  metricValue: string;
  actionPath: string;
}

export interface SmartReorderSuggestionItem {
  productId: string;
  skuCode: string;
  productName: string;
  baseUnit: string;
  sellableOnHand: number;
  avgDailyUsage: number;
  dynamicReorderPoint: number;
  targetParBase: number;
  suggestedOrderBase: number;
  preferredSupplierId: string | null;
  preferredSupplierName: string;
  packVariantId: string | null;
  variantName: string;
  packUnit: string;
  suggestedOrderPacks: number;
  estimatedPackCostMinor: number;
}

export interface AutopilotCockpitResponse {
  businessDate: string;
  currency: string;
  tenantSlug: string;
  kioskPath: string;
  modeFlags: { hasClinic: boolean; hasPharmacy: boolean };
  governance: WorkspaceGovernanceRuleView;
  checklists: {
    opening: ShiftChecklistRunView;
    closing: ShiftChecklistRunView;
  };
  anomalies: AutopilotAnomalyItem[];
  smartReorders: SmartReorderSuggestionItem[];
  latestBriefing: {
    id: string;
    businessDate: string;
    summaryTextEn: string;
    summaryTextSi: string;
    anomalyCount: number;
    dispatchedChannel: 'in_app' | 'whatsapp';
    createdAt: string;
    metricsJson: Record<string, unknown>;
  } | null;
  soloSnapshot: {
    totalAppointmentsToday: number;
    waitingAppointmentsCount: number;
    nextWaitingPatient: {
      appointmentId: string;
      personName: string;
      tokenNumber: number | null;
      status: string;
    } | null;
    clinicCollectionsMinor: number;
    pharmacyNetSalesMinor: number;
    operatingExpensesMinor: number;
    todayRevenueMinor: number;
    trueNetProfitMinor: number;
    lowStockCount: number;
    expiringSoonCount: number;
  };
}

export interface PublicKioskInfoResponse {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  branchId: string;
  branchName: string;
  timezone: string;
  currency: string;
  businessDate: string;
  waitingCount: number;
  estimatedWaitMinutes: number;
  services: Array<{
    id: string;
    name: string;
    nameSi: string;
    durationMinutes: number;
    priceMinor: number;
  }>;
  resources: Array<{
    id: string;
    name: string;
    specialty: string;
  }>;
}

export interface PublicSelfCheckInResponse {
  appointmentId: string;
  tokenNumber: number;
  startsAt: string;
  businessDate: string;
  clinicName: string;
  branchName: string;
  doctorName: string;
  serviceName: string;
  patientName: string;
}
