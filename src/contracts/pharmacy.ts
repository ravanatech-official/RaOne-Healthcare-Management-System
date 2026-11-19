import { z } from 'zod';
import { ProductModeSchema, ProfessionalGrantTypeSchema } from './api.ts';

export const DosageFormSchema = z.enum([
  'tablet',
  'capsule',
  'syrup_bottle',
  'cream_tube',
  'inhaler',
  'vial',
  'sachet',
  'device',
  'other',
]);
export type DosageForm = z.infer<typeof DosageFormSchema>;

export const BaseUnitSchema = z.enum([
  'tablet',
  'capsule',
  'sealed_bottle',
  'tube',
  'inhaler',
  'vial',
  'sachet',
  'unit',
]);
export type BaseUnit = z.infer<typeof BaseUnitSchema>;

export const RegulatoryClassSchema = z.enum([
  'otc',
  'prescription_only',
  'controlled',
  'unknown_restricted',
]);
export type RegulatoryClass = z.infer<typeof RegulatoryClassSchema>;

export const StorageConditionSchema = z.enum([
  'ambient',
  'refrigerated_2_8c',
  'controlled_cool',
  'protect_light',
]);

export const ExpiryPrecisionSchema = z.enum(['day', 'month', 'unknown']);
export type ExpiryPrecision = z.infer<typeof ExpiryPrecisionSchema>;

export const QualityStatusSchema = z.enum(['quarantine', 'released', 'blocked']);
export type QualityStatus = z.infer<typeof QualityStatusSchema>;

// 1. Platform Entitlement & Professional Grant Contracts
export const UpdateProductModeSchema = z.object({
  productMode: ProductModeSchema,
  extraCapabilities: z.record(z.string(), z.boolean()).optional(),
});

export const GrantProfessionalSchema = z.object({
  userId: z.number().int().positive(),
  grantType: ProfessionalGrantTypeSchema,
  licenseNumber: z.string().trim().min(3).max(80),
  expiresAt: z.string().datetime().optional().nullable(),
});

export const CreateLegalEntitySchema = z.object({
  name: z.string().trim().min(2).max(140),
  registrationNumber: z.string().trim().max(80).optional().default(''),
  taxId: z.string().trim().max(80).optional().default(''),
});

// 2. Pharmacy Catalogue & Versioned UOM Contracts
export const CreateProductSchema = z.object({
  skuCode: z.string().trim().min(2).max(60),
  displayName: z.string().trim().min(2).max(160),
  genericName: z.string().trim().min(2).max(160),
  brandName: z.string().trim().max(160).optional().default(''),
  strengthValue: z.string().trim().min(1).max(40),
  strengthUnit: z.string().trim().min(1).max(30),
  dosageForm: DosageFormSchema,
  route: z.string().trim().max(60).optional().default('oral'),
  manufacturer: z.string().trim().min(2).max(140),
  regulatoryClass: RegulatoryClassSchema.default('unknown_restricted'),
  storageCondition: StorageConditionSchema.default('ambient'),
  baseUnit: BaseUnitSchema,
  minShelfLifeDays: z.number().int().min(0).max(1825).default(30),
  initialPack: z
    .object({
      variantName: z.string().trim().min(2).max(100),
      packUnit: z.enum(['tablet', 'capsule', 'strip', 'box', 'bottle', 'pack', 'unit']),
      baseQtyPerPack: z.number().int().min(1).max(100000),
      defaultSalePriceMinor: z.number().int().min(0).max(100000000),
      barcode: z.string().trim().min(3).max(80).optional(),
      barcodeType: z.enum(['ean13', 'upc', 'gs1', 'internal']).default('internal'),
    })
    .optional(),
});
export type CreateProductInput = z.infer<typeof CreateProductSchema>;

export const CreatePackVariantSchema = z.object({
  variantName: z.string().trim().min(2).max(100),
  packUnit: z.enum(['tablet', 'capsule', 'strip', 'box', 'bottle', 'pack', 'unit']),
  baseQtyPerPack: z.number().int().min(1).max(100000),
  defaultSalePriceMinor: z.number().int().min(0).max(100000000),
  allowPosSale: z.boolean().default(true),
  barcode: z.string().trim().min(3).max(80).optional(),
  barcodeType: z.enum(['ean13', 'upc', 'gs1', 'internal']).default('internal'),
});

export const UpdatePackConversionSchema = z.object({
  newBaseQtyPerPack: z.number().int().min(1).max(100000),
  newDefaultSalePriceMinor: z.number().int().min(0).max(100000000).optional(),
  notes: z.string().trim().min(2).max(200),
});

export const AddBarcodeAliasSchema = z.object({
  packVariantId: z.string().uuid(),
  barcode: z.string().trim().min(3).max(80),
  barcodeType: z.enum(['ean13', 'upc', 'gs1', 'internal']).default('ean13'),
});

// 3. Supplier & Goods Receipt (GRN) Contracts
export const CreateSupplierSchema = z.object({
  name: z.string().trim().min(2).max(160),
  registrationRef: z.string().trim().max(80).optional().default(''),
  contactName: z.string().trim().max(120).optional().default(''),
  phone: z.string().trim().max(40).optional().default(''),
  email: z.string().trim().max(120).optional().default(''),
  status: z.enum(['approved', 'pending_review', 'suspended']).default('approved'),
});

export const GoodsReceiptLineInputSchema = z.object({
  productId: z.string().uuid(),
  packVariantId: z.string().uuid(),
  storageLocationId: z.string().uuid().optional(),
  batchNumber: z.string().trim().min(1).max(80),
  manufacturer: z.string().trim().min(2).max(140).optional(),
  printedExpiry: z.string().trim().min(1).max(40), // e.g. '2027-08-31' | '2027-08' | 'UNKNOWN'
  expiryPrecision: ExpiryPrecisionSchema,
  orderedPacks: z.number().int().min(0).max(100000).default(0),
  receivedPacks: z.number().int().min(0).max(100000),
  bonusPacks: z.number().int().min(0).max(100000).default(0),
  quarantinedPacks: z.number().int().min(0).max(100000).default(0),
  unitPackCostMinor: z.number().int().min(0).max(100000000),
  isProvisionalCost: z.boolean().default(false),
  condition: z.enum(['good', 'damaged', 'unknown_expiry', 'inspection_required']).default('good'),
  releaseImmediately: z.boolean().default(false),
});

export const PostGoodsReceiptSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
  supplierId: z.string().uuid(),
  supplierDocRef: z.string().trim().min(1).max(100),
  docType: z.enum(['grn', 'opening_balance']).default('grn'),
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().trim().max(400).optional().default(''),
  lines: z.array(GoodsReceiptLineInputSchema).min(1).max(50),
});
export type PostGoodsReceiptInput = z.infer<typeof PostGoodsReceiptSchema>;

export const PostSupplierInvoiceSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
  supplierId: z.string().uuid(),
  goodsReceiptId: z.string().uuid().optional().nullable(),
  invoiceNumber: z.string().trim().min(1).max(100),
  invoiceDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalMinor: z.number().int().min(0).max(1000000000),
});
export type PostSupplierInvoiceInput = z.infer<typeof PostSupplierInvoiceSchema>;

export const LotQualityTransitionSchema = z.object({
  action: z.enum(['release_to_sellable', 'place_quarantine', 'place_recall_hold']),
  reason: z.string().trim().min(3).max(250),
  locationId: z.string().uuid().optional(),
  qtyBase: z.number().int().positive().optional(),
});

// 4. Pharmacy Phase 2: Till Shifts, Retail POS, Cart-Hash Gate & Customer Returns
export const OpenTillShiftSchema = z.object({
  counterId: z.string().uuid().optional(),
  openingFloatMinor: z.number().int().min(0).max(100000000),
});
export type OpenTillShiftInput = z.infer<typeof OpenTillShiftSchema>;

export const TillCashEventSchema = z.object({
  eventType: z.enum(['drop', 'paid_out', 'top_up']),
  amountMinor: z.number().int().positive().max(100000000),
  reason: z.string().trim().min(3).max(240),
});
export type TillCashEventInput = z.infer<typeof TillCashEventSchema>;

export const CloseTillShiftSchema = z.object({
  countedCashMinor: z.number().int().min(0).max(500000000),
  closeNotes: z.string().trim().max(300).optional().default(''),
});
export type CloseTillShiftInput = z.infer<typeof CloseTillShiftSchema>;

export const PosCartItemInputSchema = z.object({
  productId: z.string().uuid(),
  packVariantId: z.string().uuid(),
  qtyPacks: z.number().int().positive().max(10000),
  unitSalePriceMinor: z.number().int().min(0).max(100000000).optional(),
});
export type PosCartItemInput = z.infer<typeof PosCartItemInputSchema>;

export const ApprovePosCartSchema = z.object({
  items: z.array(PosCartItemInputSchema).min(1).max(50),
  discountMinor: z.number().int().min(0).max(100000000).default(0),
  prescriptionRef: z.string().trim().max(100).optional().default(''),
  notes: z.string().trim().max(300).optional().default(''),
});
export type ApprovePosCartInput = z.infer<typeof ApprovePosCartSchema>;

export const PosPaymentSplitSchema = z.object({
  method: z.enum(['cash', 'card', 'bank']),
  amountMinor: z.number().int().positive().max(500000000),
  referenceNumber: z.string().trim().max(80).optional().default(''),
});

export const CheckoutPosSaleSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
  shiftId: z.string().uuid(),
  personId: z.string().uuid().optional().nullable(),
  items: z.array(PosCartItemInputSchema).min(1).max(50),
  discountMinor: z.number().int().min(0).max(100000000).default(0),
  approvalId: z.string().uuid().optional().nullable(),
  payments: z.array(PosPaymentSplitSchema).min(1).max(5),
});
export type CheckoutPosSaleInput = z.infer<typeof CheckoutPosSaleSchema>;

export const CreatePosReturnSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
  shiftId: z.string().uuid(),
  reason: z.string().trim().min(3).max(240),
  refundMethod: z.enum(['cash', 'card', 'bank']),
  lines: z
    .array(
      z.object({
        saleLineId: z.string().uuid(),
        qtyBase: z.number().int().positive().max(1000000),
      })
    )
    .min(1)
    .max(50),
});
export type CreatePosReturnInput = z.infer<typeof CreatePosReturnSchema>;
