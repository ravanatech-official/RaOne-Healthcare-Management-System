import { z } from 'zod';

// ---------------------------------------------------------------------------
// 1. Accounts Department Contracts (OpEx, True Net P&L, AR/AP Credit Aging)
// ---------------------------------------------------------------------------
export const ExpenseCategorySchema = z.enum([
  'rent',
  'utilities',
  'salaries',
  'maintenance',
  'supplies',
  'courier',
  'petty_cash',
  'other',
]);

export const RecordOperatingExpenseSchema = z.object({
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  category: ExpenseCategorySchema,
  description: z.string().trim().min(2).max(240),
  amountLkr: z.number().positive().max(10_000_000),
  paymentMethod: z.enum(['cash', 'card', 'bank']).default('cash'),
  referenceNo: z.string().trim().max(80).optional().default(''),
  managerOverridePin: z.string().trim().regex(/^\d{4,6}$/).optional(),
});
export type RecordOperatingExpenseInput = z.infer<typeof RecordOperatingExpenseSchema>;

export const CreateCreditAccountSchema = z.object({
  personId: z.string().optional().nullable(),
  accountName: z.string().trim().min(2).max(140),
  accountType: z.enum(['patient', 'corporate', 'customer']).default('customer'),
  phone: z.string().trim().max(30).optional().default(''),
  creditLimitLkr: z.number().min(0).max(50_000_000).default(50_000),
});
export type CreateCreditAccountInput = z.infer<typeof CreateCreditAccountSchema>;

export const RecordCreditEntrySchema = z.object({
  entryType: z.enum(['charge', 'payment']),
  amountLkr: z.number().positive().max(50_000_000),
  method: z.enum(['cash', 'card', 'bank', 'credit']).default('cash'),
  referenceNo: z.string().trim().max(80).optional().default(''),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().trim().max(240).optional().default(''),
});
export type RecordCreditEntryInput = z.infer<typeof RecordCreditEntrySchema>;

export const RecordSupplierPaymentSchema = z.object({
  supplierId: z.string().min(4),
  supplierInvoiceId: z.string().optional().nullable(),
  amountLkr: z.number().positive().max(100_000_000),
  method: z.enum(['cash', 'cheque', 'bank']).default('bank'),
  referenceNo: z.string().trim().max(80).optional().default(''),
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().trim().max(240).optional().default(''),
});
export type RecordSupplierPaymentInput = z.infer<typeof RecordSupplierPaymentSchema>;

export interface AccountsOverviewResponse {
  businessDate: string;
  currency: string;
  modeFlags: { hasClinic: boolean; hasPharmacy: boolean };
  dailyPnl: {
    clinicCollectionsMinor: number;
    doctorPayoutsMinor: number;
    clinicNetAfterDoctorMinor: number;
    pharmacyNetSalesMinor: number;
    pharmacyCogsMinor: number;
    pharmacyGrossProfitMinor: number;
    operatingExpensesMinor: number;
    trueNetProfitMinor: number;
  };
  expenses: Array<{
    id: string;
    expenseDate: string;
    category: string;
    description: string;
    amountMinor: number;
    paymentMethod: string;
    referenceNo: string;
    status: string;
    createdAt: string;
  }>;
  receivables: {
    totalOutstandingMinor: number;
    aging: { current0To30Minor: number; days31To60Minor: number; days60PlusMinor: number };
    accounts: Array<{
      id: string;
      accountName: string;
      accountType: string;
      phone: string;
      creditLimitMinor: number;
      balanceMinor: number;
      agingBucket: '0-30d' | '31-60d' | '60d+';
      lastTransactionAt: string;
      recentEntries: Array<{
        id: string;
        entryType: 'charge' | 'payment';
        amountMinor: number;
        method: string;
        referenceNo: string;
        dueDate: string;
        notes: string;
        occurredAt: string;
      }>;
    }>;
  };
  payables: {
    totalPayableMinor: number;
    aging: { current0To30Minor: number; days31To60Minor: number; days60PlusMinor: number };
    suppliers: Array<{
      supplierId: string;
      supplierName: string;
      totalInvoicedMinor: number;
      totalDebitNotesMinor: number;
      totalPaidMinor: number;
      outstandingMinor: number;
      agingBucket: '0-30d' | '31-60d' | '60d+';
    }>;
    recentPayments: Array<{
      id: string;
      supplierId: string;
      supplierName: string;
      amountMinor: number;
      method: string;
      referenceNo: string;
      paidDate: string;
      notes: string;
    }>;
  };
}

// ---------------------------------------------------------------------------
// 2. Purchasing Department Contracts (PO Workflow & Supplier Debit Notes)
// ---------------------------------------------------------------------------
export const CreatePurchaseOrderSchema = z.object({
  supplierId: z.string().min(4),
  expectedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().trim().max(300).optional().default(''),
  lines: z
    .array(
      z.object({
        productId: z.string().min(4),
        packVariantId: z.string().min(4),
        orderedPacks: z.number().int().positive().max(100000),
        estimatedUnitPackCostMinor: z.number().int().min(0).max(100_000_000),
      })
    )
    .min(1),
});
export type CreatePurchaseOrderInput = z.infer<typeof CreatePurchaseOrderSchema>;

export const ConvertPoToGrnSchema = z.object({
  batchNumber: z.string().trim().min(1).max(80).default('PO-BATCH-01'),
  printedExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  releaseImmediately: z.boolean().default(true),
  notes: z.string().trim().max(300).optional().default(''),
});
export type ConvertPoToGrnInput = z.infer<typeof ConvertPoToGrnSchema>;

export const CreateSupplierDebitNoteSchema = z.object({
  supplierId: z.string().min(4),
  productId: z.string().min(4),
  lotId: z.string().min(4),
  qtyBase: z.number().int().positive().max(1000000),
  reason: z.enum(['near_expiry', 'damaged', 'overcharged', 'dead_stock']),
  amountLkr: z.number().positive().max(100_000_000),
  notes: z.string().trim().max(300).optional().default(''),
});
export type CreateSupplierDebitNoteInput = z.infer<typeof CreateSupplierDebitNoteSchema>;

export interface PurchasingOverviewResponse {
  purchaseOrders: Array<{
    id: string;
    poNumber: string;
    supplierId: string;
    supplierName: string;
    status: string;
    expectedDate: string;
    totalEstimatedMinor: number;
    notes: string;
    convertedGrnId: string | null;
    createdAt: string;
    lines: Array<{
      id: string;
      productId: string;
      productName: string;
      packVariantId: string;
      variantName: string;
      orderedPacks: number;
      estimatedUnitPackCostMinor: number;
    }>;
  }>;
  debitNotes: Array<{
    id: string;
    debitNoteNumber: string;
    supplierId: string;
    supplierName: string;
    productId: string;
    productName: string;
    lotId: string;
    batchNumber: string;
    qtyBase: number;
    reason: string;
    amountMinor: number;
    status: string;
    notes: string;
    createdAt: string;
  }>;
}

// ---------------------------------------------------------------------------
// 3. HR, Payroll & Admin Department Contracts
// ---------------------------------------------------------------------------
export const UpsertHrProfileSchema = z.object({
  userId: z.number().int().positive(),
  designation: z.string().trim().min(2).max(100),
  basicSalaryLkr: z.number().min(0).max(5_000_000),
  allowancesLkr: z.number().min(0).max(2_000_000).default(0),
  epfApplicable: z.boolean().default(true),
  etfApplicable: z.boolean().default(true),
  bankName: z.string().trim().max(100).optional().default(''),
  bankAccountNo: z.string().trim().max(60).optional().default(''),
});
export type UpsertHrProfileInput = z.infer<typeof UpsertHrProfileSchema>;

export const AttendanceClockSchema = z.object({
  pin: z.string().trim().regex(/^\d{4,6}$/).optional(),
  notes: z.string().trim().max(200).optional().default(''),
});

export const RequestLeaveSchema = z.object({
  leaveType: z.enum(['annual', 'casual', 'medical', 'no_pay']),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  daysCount: z.number().int().min(1).max(60).default(1),
  reason: z.string().trim().min(3).max(240),
});
export type RequestLeaveInput = z.infer<typeof RequestLeaveSchema>;

export const GeneratePayrollSchema = z.object({
  payrollMonth: z.string().regex(/^\d{4}-\d{2}$/),
});

export const CreateLabOrderSchema = z.object({
  personId: z.string().min(4),
  appointmentId: z.string().optional().nullable(),
  testName: z.string().trim().min(2).max(160),
  labProvider: z.string().trim().min(2).max(140).default('In-House Lab'),
  feeLkr: z.number().min(0).max(500_000),
});
export type CreateLabOrderInput = z.infer<typeof CreateLabOrderSchema>;

export const UpdateLabOrderSchema = z.object({
  status: z.enum(['ordered', 'sample_collected', 'report_ready', 'cancelled']),
  resultSummary: z.string().trim().max(300).optional().default(''),
});

export const RecordColdChainLogSchema = z.object({
  fridgeName: z.string().trim().min(2).max(100).default('Main Vaccine Fridge'),
  temperatureC: z.number().min(-30).max(40),
  notes: z.string().trim().max(200).optional().default(''),
});

export const CreateComplianceLicenseSchema = z.object({
  title: z.string().trim().min(2).max(160),
  authority: z.enum(['NMRA', 'SLMC', 'BR', 'PHI', 'OTHER']),
  licenseNumber: z.string().trim().min(2).max(100),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  alertDaysBefore: z.number().int().min(7).max(180).default(30),
  notes: z.string().trim().max(240).optional().default(''),
});

export interface HrAdminOverviewResponse {
  businessDate: string;
  currentMonth: string;
  modeFlags: { hasClinic: boolean; hasPharmacy: boolean };
  profiles: Array<{
    userId: number;
    displayName: string;
    email: string;
    role: string;
    designation: string;
    basicSalaryMinor: number;
    allowancesMinor: number;
    epfApplicable: boolean;
    etfApplicable: boolean;
    bankName: string;
    bankAccountNo: string;
  }>;
  attendanceToday: Array<{
    id: string;
    userId: number;
    staffName: string;
    businessDate: string;
    clockInAt: string;
    clockOutAt: string | null;
    lateMinutes: number;
    overtimeMinutes: number;
    status: string;
    notes: string;
  }>;
  leaves: Array<{
    id: string;
    userId: number;
    staffName: string;
    leaveType: string;
    startDate: string;
    endDate: string;
    daysCount: number;
    reason: string;
    status: string;
    createdAt: string;
  }>;
  payrollRuns: Array<{
    id: string;
    payrollMonth: string;
    status: string;
    totalGrossMinor: number;
    totalNetMinor: number;
    totalEmployerEpfMinor: number;
    totalEtfMinor: number;
    finalizedAt: string | null;
    slips: Array<{
      id: string;
      userId: number;
      staffName: string;
      designation: string;
      basicMinor: number;
      allowancesMinor: number;
      overtimeMinor: number;
      commissionMinor: number;
      noPayDeductionMinor: number;
      epfEmployee8Minor: number;
      epfEmployer12Minor: number;
      etfEmployer3Minor: number;
      netPayMinor: number;
    }>;
  }>;
  labOrders: Array<{
    id: string;
    personId: string;
    patientName: string;
    testName: string;
    labProvider: string;
    feeMinor: number;
    status: string;
    resultSummary: string;
    orderedAt: string;
  }>;
  coldChainLogs: Array<{
    id: string;
    fridgeName: string;
    temperatureC: number;
    inRange: boolean;
    notes: string;
    loggedAt: string;
  }>;
  licenses: Array<{
    id: string;
    title: string;
    authority: string;
    licenseNumber: string;
    expiresOn: string;
    daysRemaining: number;
    computedStatus: 'active' | 'expiring_soon' | 'expired';
    notes: string;
  }>;
}
