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
  | 'platform.grants.manage';

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
  ],
  receptionist: [
    'directory.read',
    'appointments.read',
    'appointments.write',
    'attendance.write',
    'payments.record',
    'reports.branch_summary',
  ],
  cashier: [
    'directory.read',
    'payments.record',
    'reports.branch_summary',
    'pharmacy.catalogue.read',
    'pharmacy.stock.read',
    'pharmacy.pos.sell',
  ],
  stock_keeper: [
    'pharmacy.catalogue.read',
    'pharmacy.catalogue.write',
    'pharmacy.receiving.write',
    'pharmacy.stock.read',
    'pharmacy.lot.quarantine_place',
  ],
  accountant: [
    'reports.branch_summary',
    'reports.all_financials',
    'audit.read',
    'pharmacy.catalogue.read',
    'pharmacy.stock.read',
    'pharmacy.invoice.write',
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
  serviceId: string;
  serviceName: string;
  serviceNameSi: string;
  resourceId: string;
  resourceName: string;
  bookedDurationMinutes: number;
  bookedPriceMinor: number;
  currency: string;
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
