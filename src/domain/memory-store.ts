import crypto from 'node:crypto';
import type { ProductMode, ProfessionalGrantType, Role } from '../contracts/api.ts';

export interface MemTenant {
  id: string;
  slug: string;
  name: string;
  productMode: ProductMode;
  countryCode: string;
  timezone: string;
  currency: string;
  status: string;
  onboardingCompleted: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemLegalEntity {
  id: string;
  tenantId: string;
  name: string;
  registrationNumber: string;
  taxId: string;
  countryCode: string;
  currency: string;
  active: boolean;
  createdAt: Date;
}

export interface MemBranch {
  id: string;
  tenantId: string;
  legalEntityId: string;
  name: string;
  code: string;
  timezone: string;
  openingHoursJson: Record<string, unknown>;
  isDefault: boolean;
  active: boolean;
  createdAt: Date;
}

export interface MemMembership {
  id: string;
  tenantId: string;
  branchId: string;
  userId: number;
  role: Role;
  active: boolean;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface MemCapability {
  tenantId: string;
  capabilityKey: string;
  enabled: boolean;
  planTier: string;
  quotaLimit: number | null;
  updatedAt: Date;
}

export interface MemProfessionalGrant {
  id: string;
  tenantId: string;
  branchId: string | null;
  userId: number;
  grantType: ProfessionalGrantType;
  licenseNumber: string;
  active: boolean;
  grantedByUserId: number | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemCounter {
  id: string;
  tenantId: string;
  branchId: string;
  departmentId: string | null;
  name: string;
  code: string;
  active: boolean;
  createdAt: Date;
}

export interface MemService {
  id: string;
  tenantId: string;
  branchId: string;
  name: string;
  nameSi: string;
  durationMinutes: number;
  priceMinor: number;
  currency: string;
  active: boolean;
}

export interface MemResource {
  id: string;
  tenantId: string;
  branchId: string;
  name: string;
  specialty: string;
  capacity: number;
  workingHoursJson: Record<string, unknown>;
  active: boolean;
}

export interface MemPerson {
  id: string;
  tenantId: string;
  branchId: string;
  displayName: string;
  normalizedName: string;
  aliasesJson: string[];
  phone: string;
  phoneLast4: string;
  notes: string;
  isSample: boolean;
  version: number;
  createdAt: Date;
}

export interface MemAppointment {
  id: string;
  tenantId: string;
  branchId: string;
  personId: string;
  serviceId: string;
  resourceId: string;
  startsAt: Date;
  endsAt: Date;
  businessDate: string;
  status: 'scheduled' | 'arrived' | 'completed' | 'cancelled' | 'no_show';
  bookedDurationMinutes: number;
  bookedPriceMinor: number;
  currency: string;
  notes: string;
  isSample: boolean;
  version: number;
  createdByUserId: number | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemCharge {
  id: string;
  tenantId: string;
  branchId: string;
  personId: string;
  appointmentId: string | null;
  description: string;
  currency: string;
  grossAmountMinor: number;
  creditedAmountMinor: number;
  version: number;
  createdByUserId: number | null;
  createdAt: Date;
}

export interface MemPayment {
  id: string;
  tenantId: string;
  branchId: string;
  personId: string;
  amountMinor: number;
  currency: string;
  method: 'cash' | 'card' | 'bank';
  referenceNumber: string;
  status: 'posted' | 'voided';
  effectiveAt: Date;
  recordedAt: Date;
  recordedByUserId: number;
}

export interface MemPaymentAllocation {
  id: string;
  tenantId: string;
  paymentId: string;
  chargeId: string;
  amountMinor: number;
  currency: string;
  active: boolean;
}

export interface MemReceipt {
  id: string;
  tenantId: string;
  paymentId: string;
  receiptNumber: string;
  snapshotJson: Record<string, unknown>;
  issuedAt: Date;
}

export interface MemSupplier {
  id: string;
  tenantId: string;
  legalEntityId: string;
  name: string;
  registrationRef: string;
  contactName: string;
  phone: string;
  email: string;
  status: 'approved' | 'pending_review' | 'suspended';
  createdAt: Date;
  updatedAt: Date;
}

export interface MemStorageLocation {
  id: string;
  tenantId: string;
  branchId: string;
  code: string;
  name: string;
  locationType: 'dispensary' | 'store_room' | 'cold_chain' | 'quarantine';
  active: boolean;
  createdAt: Date;
}

export interface MemProduct {
  id: string;
  tenantId: string;
  legalEntityId: string;
  skuCode: string;
  displayName: string;
  normalizedName: string;
  genericName: string;
  brandName: string;
  strengthValue: string;
  strengthUnit: string;
  dosageForm: string;
  route: string;
  manufacturer: string;
  regulatoryClass: string;
  requiresPharmacistRelease: boolean;
  storageCondition: string;
  baseUnit: string;
  minShelfLifeDays: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemPackVariant {
  id: string;
  tenantId: string;
  productId: string;
  variantName: string;
  packUnit: string;
  currentBaseQty: number;
  currentConversionVersion: number;
  defaultSalePriceMinor: number;
  currency: string;
  allowPosSale: boolean;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemUomConversion {
  id: string;
  tenantId: string;
  productId: string;
  packVariantId: string;
  version: number;
  packUnit: string;
  baseUnit: string;
  baseQtyPerPack: number;
  effectiveFrom: Date;
  createdByUserId: number | null;
  notes: string;
  createdAt: Date;
}

export interface MemBarcodeAlias {
  id: string;
  tenantId: string;
  productId: string;
  packVariantId: string;
  barcode: string;
  barcodeType: string;
  status: 'active' | 'conflict_review' | 'inactive';
  createdAt: Date;
}

export interface MemLot {
  id: string;
  tenantId: string;
  branchId: string;
  productId: string;
  manufacturer: string;
  batchNumber: string;
  printedExpiry: string;
  expiryPrecision: 'day' | 'month' | 'unknown';
  expiryCutoffDate: string | null;
  qualityStatus: 'quarantine' | 'released' | 'blocked';
  quarantineReason: string;
  releasedByGrantId: string | null;
  releasedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MemCostLayer {
  id: string;
  tenantId: string;
  branchId: string;
  productId: string;
  lotId: string;
  goodsReceiptLineId: string;
  unitCostMinor: number;
  totalCostMinor: number;
  initialQtyBase: number;
  remainingQtyBase: number;
  isProvisional: boolean;
  receivedAt: Date;
  createdAt: Date;
}

export interface MemInventoryBalance {
  id: string;
  tenantId: string;
  branchId: string;
  locationId: string;
  productId: string;
  lotId: string;
  sellableOnHand: number;
  reservedQty: number;
  quarantineQty: number;
  returnedQuarantineQty: number;
  damagedQty: number;
  expiredQty: number;
  recalledQty: number;
  disposedQty: number;
  version: number;
  updatedAt: Date;
}

export interface MemStockMovement {
  id: string;
  tenantId: string;
  branchId: string;
  locationId: string;
  productId: string;
  lotId: string;
  costLayerId: string | null;
  movementType: string;
  qtyBase: number;
  fromBucket: string | null;
  toBucket: string | null;
  reason: string;
  sourceDocType: string;
  sourceDocId: string;
  commandId: string | null;
  packVariantId: string | null;
  uomConversionVersion: number | null;
  actorUserId: number | null;
  occurredAt: Date;
  createdAt: Date;
}

export interface MemGoodsReceipt {
  id: string;
  tenantId: string;
  legalEntityId: string;
  branchId: string;
  supplierId: string;
  supplierDocRef: string;
  docType: 'grn' | 'opening_balance';
  receivedDate: string;
  status: string;
  notes: string;
  commandId: string | null;
  createdByUserId: number | null;
  postedAt: Date;
  createdAt: Date;
}

export interface MemGoodsReceiptLine {
  id: string;
  tenantId: string;
  goodsReceiptId: string;
  productId: string;
  packVariantId: string;
  uomConversionVersion: number;
  lotId: string;
  storageLocationId: string;
  orderedPacks: number;
  receivedPacks: number;
  bonusPacks: number;
  acceptedQtyBase: number;
  quarantinedQtyBase: number;
  unitPackCostMinor: number;
  totalLineCostMinor: number;
  isProvisionalCost: boolean;
  condition: string;
  createdAt: Date;
}

export interface MemSupplierInvoice {
  id: string;
  tenantId: string;
  legalEntityId: string;
  branchId: string;
  supplierId: string;
  goodsReceiptId: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  totalMinor: number;
  currency: string;
  status: string;
  commandId: string | null;
  createdByUserId: number | null;
  createdAt: Date;
}

export interface MemRecall {
  id: string;
  tenantId: string;
  scopeType: 'product' | 'lot' | 'manufacturer';
  productId: string | null;
  lotId: string | null;
  manufacturer: string | null;
  referenceCode: string;
  reason: string;
  status: 'active' | 'lifted';
  effectiveAt: Date;
  activatedByUserId: number | null;
  createdAt: Date;
}

export interface MemTillShift {
  id: string;
  tenantId: string;
  branchId: string;
  counterId: string;
  openedByUserId: number;
  closedByUserId: number | null;
  openingFloatMinor: number;
  cashSalesMinor: number;
  cashRefundsMinor: number;
  cashDropsMinor: number;
  paidOutsMinor: number;
  expectedCashMinor: number;
  countedCashMinor: number | null;
  varianceMinor: number | null;
  closeNotes: string;
  status: 'open' | 'closed';
  openedAt: Date;
  closedAt: Date | null;
}

export interface MemTillCashEvent {
  id: string;
  tenantId: string;
  shiftId: string;
  eventType: 'drop' | 'paid_out' | 'top_up';
  amountMinor: number;
  reason: string;
  actorUserId: number;
  occurredAt: Date;
}

export interface MemPharmacistApproval {
  id: string;
  tenantId: string;
  branchId: string;
  cartHash: string;
  pharmacistUserId: number;
  grantId: string;
  licenseNumber: string;
  prescriptionRef: string;
  notes: string;
  itemsSnapshotJson: unknown;
  status: 'active' | 'consumed' | 'invalidated' | 'expired';
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface MemPosSale {
  id: string;
  tenantId: string;
  legalEntityId: string;
  branchId: string;
  counterId: string;
  shiftId: string;
  personId: string | null;
  saleNumber: string;
  cartHash: string;
  approvalId: string | null;
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
  paidMinor: number;
  changeMinor: number;
  currency: string;
  status: 'completed' | 'partially_returned' | 'returned';
  commandId: string | null;
  cashierUserId: number;
  soldAt: Date;
  createdAt: Date;
}

export interface MemPosSaleLine {
  id: string;
  tenantId: string;
  saleId: string;
  productId: string;
  packVariantId: string;
  uomConversionVersion: number;
  qtyPacks: number;
  qtyBase: number;
  returnedQtyBase: number;
  unitSalePriceMinor: number;
  lineTotalMinor: number;
  requiresPharmacistRelease: boolean;
  createdAt: Date;
}

export interface MemPosSaleAllocation {
  id: string;
  tenantId: string;
  saleId: string;
  saleLineId: string;
  lotId: string;
  costLayerId: string;
  storageLocationId: string;
  qtyBase: number;
  unitCostMinor: number;
  totalCostMinor: number;
  createdAt: Date;
}

export interface MemPosPayment {
  id: string;
  tenantId: string;
  saleId: string;
  method: 'cash' | 'card' | 'bank';
  amountMinor: number;
  referenceNumber: string;
  createdAt: Date;
}

export interface MemPosReceipt {
  id: string;
  tenantId: string;
  saleId: string;
  receiptNumber: string;
  snapshotJson: Record<string, unknown>;
  issuedAt: Date;
}

export interface MemPosReturn {
  id: string;
  tenantId: string;
  branchId: string;
  saleId: string;
  shiftId: string;
  returnNumber: string;
  reason: string;
  refundMethod: 'cash' | 'card' | 'bank';
  refundAmountMinor: number;
  currency: string;
  commandId: string | null;
  processedByUserId: number;
  returnedAt: Date;
}

export interface MemActionProposal {
  id: string;
  tenantId: string;
  actorUserId: number;
  actionType: string;
  canonicalPayloadJson: Record<string, unknown>;
  payloadHash: string;
  nonce: string;
  state: 'draft' | 'consumed' | 'expired';
  expiresAt: Date;
  consumedAt: Date | null;
  createdAt: Date;
}

export interface MemCommand {
  id: string;
  tenantId: string;
  actorUserId: number;
  commandType: string;
  idempotencyKey: string;
  payloadHash: string;
  proposalId: string | null;
  state: 'accepted' | 'committed' | 'rejected';
  resultJson: unknown;
  committedAt: Date | null;
}

export interface MemAuditEvent {
  id: string;
  tenantId: string;
  actorUserId: number | null;
  actorUid: string;
  action: string;
  entityType: string;
  entityId: string;
  inputSource: string;
  correlationId: string;
  metadataJson: Record<string, unknown>;
  createdAt: Date;
}

export interface MemDoctorSchedule {
  id: string;
  tenantId: string;
  branchId: string;
  resourceId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotDurationMinutes: number;
  active: boolean;
  createdAt: Date;
}

export interface MemDoctorHolidayBlock {
  id: string;
  tenantId: string;
  branchId: string;
  resourceId: string;
  blockDate: string;
  reason: string;
  createdAt: Date;
}

export interface MemDoctorCommissionRule {
  id: string;
  tenantId: string;
  resourceId: string;
  serviceId: string | null;
  doctorSharePercent: number;
  clinicSharePercent: number;
  updatedAt: Date;
}

export interface MemQueueToken {
  id: string;
  tenantId: string;
  branchId: string;
  businessDate: string;
  appointmentId: string;
  resourceId: string;
  tokenNumber: number;
  queueState: 'waiting' | 'serving' | 'completed' | 'skipped';
  delayMinutes: number;
  calledAt: Date | null;
  createdAt: Date;
}

export interface MemNotificationDispatch {
  id: string;
  tenantId: string;
  branchId: string;
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
  sentAt: Date;
}

export interface MemStocktake {
  id: string;
  tenantId: string;
  branchId: string;
  stocktakeNumber: string;
  notes: string;
  status: 'open' | 'reconciled';
  createdByUserId: number | null;
  reconciledByUserId: number | null;
  reconciledAt: Date | null;
  createdAt: Date;
}

export interface MemStocktakeLine {
  id: string;
  tenantId: string;
  stocktakeId: string;
  productId: string;
  lotId: string;
  locationId: string;
  systemQtyBase: number;
  countedQtyBase: number;
  varianceQtyBase: number;
  reason: string;
  createdAt: Date;
}

export interface MemStockTransfer {
  id: string;
  tenantId: string;
  transferNumber: string;
  fromBranchId: string;
  toBranchId: string;
  status: 'dispatched' | 'received';
  notes: string;
  dispatchedByUserId: number | null;
  receivedByUserId: number | null;
  dispatchedAt: Date;
  receivedAt: Date | null;
}

export interface MemStockTransferLine {
  id: string;
  tenantId: string;
  transferId: string;
  productId: string;
  lotId: string;
  qtyBase: number;
  receivedIntoQuarantine: boolean;
  createdAt: Date;
}

export interface MemDispenseOrder {
  id: string;
  tenantId: string;
  branchId: string;
  orderNumber: string;
  personId: string;
  appointmentId: string | null;
  prescriberName: string;
  clinicalNotes: string;
  status: 'pending' | 'dispensed' | 'cancelled';
  posSaleId: string | null;
  createdByUserId: number | null;
  createdAt: Date;
  dispensedAt: Date | null;
}

export interface MemDispenseOrderLine {
  id: string;
  tenantId: string;
  dispenseOrderId: string;
  productId: string;
  packVariantId: string;
  qtyPacks: number;
  dosageInstruction: string;
}

export interface MemStaffInvite {
  id: string;
  tenantId: string;
  branchId: string;
  email: string;
  displayName: string;
  role: Role;
  inviteToken: string;
  status: 'pending' | 'accepted' | 'revoked';
  invitedByUserId: number | null;
  expiresAt: Date;
  createdAt: Date;
}

export interface MemStaffShiftPin {
  id: string;
  tenantId: string;
  userId: number;
  branchId: string;
  pinSalt: string;
  pinHash: string;
  updatedAt: Date;
}

export interface MemQuotaUsage {
  id: string;
  tenantId: string;
  periodMonth: string;
  aiVoiceTurnsUsed: number;
  whatsappSentCount: number;
  smsSentCount: number;
  updatedAt: Date;
}

export interface MemOperatingExpense {
  id: string;
  tenantId: string;
  branchId: string;
  expenseDate: string;
  category: string;
  description: string;
  amountMinor: number;
  paymentMethod: 'cash' | 'card' | 'bank';
  referenceNo: string;
  status: 'posted' | 'voided';
  recordedByUserId: number | null;
  createdAt: Date;
}

export interface MemCreditAccount {
  id: string;
  tenantId: string;
  branchId: string;
  personId: string | null;
  accountName: string;
  accountType: 'patient' | 'corporate' | 'customer';
  phone: string;
  creditLimitMinor: number;
  balanceMinor: number;
  lastTransactionAt: Date;
  createdAt: Date;
}

export interface MemCreditEntry {
  id: string;
  tenantId: string;
  branchId: string;
  creditAccountId: string;
  entryType: 'charge' | 'payment';
  amountMinor: number;
  method: string;
  referenceNo: string;
  dueDate: string;
  notes: string;
  recordedByUserId: number | null;
  occurredAt: Date;
}

export interface MemSupplierPayment {
  id: string;
  tenantId: string;
  branchId: string;
  supplierId: string;
  supplierInvoiceId: string | null;
  amountMinor: number;
  method: 'cash' | 'cheque' | 'bank';
  referenceNo: string;
  paidDate: string;
  notes: string;
  recordedByUserId: number | null;
  createdAt: Date;
}

export interface MemPurchaseOrder {
  id: string;
  tenantId: string;
  branchId: string;
  supplierId: string;
  poNumber: string;
  status: 'draft' | 'approved' | 'received' | 'cancelled';
  expectedDate: string;
  notes: string;
  totalEstimatedMinor: number;
  approvedByUserId: number | null;
  approvedAt: Date | null;
  convertedGrnId: string | null;
  createdByUserId: number | null;
  createdAt: Date;
}

export interface MemPurchaseOrderLine {
  id: string;
  tenantId: string;
  purchaseOrderId: string;
  productId: string;
  packVariantId: string;
  orderedPacks: number;
  estimatedUnitPackCostMinor: number;
}

export interface MemSupplierDebitNote {
  id: string;
  tenantId: string;
  branchId: string;
  supplierId: string;
  debitNoteNumber: string;
  reason: 'near_expiry' | 'damaged' | 'overcharged' | 'dead_stock';
  amountMinor: number;
  productId: string;
  lotId: string;
  qtyBase: number;
  status: 'applied';
  notes: string;
  createdByUserId: number | null;
  createdAt: Date;
}

export interface MemHrStaffProfile {
  id: string;
  tenantId: string;
  userId: number;
  designation: string;
  basicSalaryMinor: number;
  allowancesMinor: number;
  epfApplicable: boolean;
  etfApplicable: boolean;
  bankName: string;
  bankAccountNo: string;
  updatedAt: Date;
}

export interface MemHrAttendanceLog {
  id: string;
  tenantId: string;
  branchId: string;
  userId: number;
  businessDate: string;
  clockInAt: Date;
  clockOutAt: Date | null;
  lateMinutes: number;
  overtimeMinutes: number;
  status: 'present' | 'completed';
  notes: string;
}

export interface MemHrLeaveRequest {
  id: string;
  tenantId: string;
  branchId: string;
  userId: number;
  leaveType: 'annual' | 'casual' | 'medical' | 'no_pay';
  startDate: string;
  endDate: string;
  daysCount: number;
  reason: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewedByUserId: number | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

export interface MemHrPayrollRun {
  id: string;
  tenantId: string;
  payrollMonth: string;
  status: 'draft' | 'finalized';
  totalGrossMinor: number;
  totalNetMinor: number;
  totalEmployerEpfMinor: number;
  totalEtfMinor: number;
  finalizedAt: Date | null;
  createdByUserId: number | null;
  createdAt: Date;
}

export interface MemHrPayrollSlip {
  id: string;
  tenantId: string;
  payrollRunId: string;
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
}

export interface MemLabDiagnosticOrder {
  id: string;
  tenantId: string;
  branchId: string;
  personId: string;
  appointmentId: string | null;
  testName: string;
  labProvider: string;
  feeMinor: number;
  status: 'ordered' | 'sample_collected' | 'report_ready' | 'cancelled';
  resultSummary: string;
  orderedByUserId: number | null;
  orderedAt: Date;
  updatedAt: Date;
}

export interface MemColdChainLog {
  id: string;
  tenantId: string;
  branchId: string;
  fridgeName: string;
  tempTenthsC: number;
  inRange: boolean;
  notes: string;
  recordedByUserId: number | null;
  loggedAt: Date;
}

export interface MemComplianceLicense {
  id: string;
  tenantId: string;
  branchId: string;
  title: string;
  authority: 'NMRA' | 'SLMC' | 'BR' | 'PHI' | 'OTHER';
  licenseNumber: string;
  expiresOn: string;
  alertDaysBefore: number;
  notes: string;
  createdAt: Date;
}

export interface MemoryStoreState {
  tenants: MemTenant[];
  legalEntities: MemLegalEntity[];
  branches: MemBranch[];
  memberships: MemMembership[];
  capabilities: MemCapability[];
  professionalGrants: MemProfessionalGrant[];
  counters: MemCounter[];
  services: MemService[];
  resources: MemResource[];
  people: MemPerson[];
  appointments: MemAppointment[];
  charges: MemCharge[];
  payments: MemPayment[];
  paymentAllocations: MemPaymentAllocation[];
  receipts: MemReceipt[];
  suppliers: MemSupplier[];
  storageLocations: MemStorageLocation[];
  products: MemProduct[];
  packVariants: MemPackVariant[];
  uomConversions: MemUomConversion[];
  barcodeAliases: MemBarcodeAlias[];
  lots: MemLot[];
  costLayers: MemCostLayer[];
  inventoryBalances: MemInventoryBalance[];
  stockMovements: MemStockMovement[];
  goodsReceipts: MemGoodsReceipt[];
  goodsReceiptLines: MemGoodsReceiptLine[];
  supplierInvoices: MemSupplierInvoice[];
  recalls: MemRecall[];
  tillShifts: MemTillShift[];
  tillCashEvents: MemTillCashEvent[];
  approvals: MemPharmacistApproval[];
  posSales: MemPosSale[];
  posSaleLines: MemPosSaleLine[];
  posSaleAllocations: MemPosSaleAllocation[];
  posPayments: MemPosPayment[];
  posReceipts: MemPosReceipt[];
  posReturns: MemPosReturn[];
  actionProposals: MemActionProposal[];
  commands: MemCommand[];
  auditEvents: MemAuditEvent[];
  doctorSchedules: MemDoctorSchedule[];
  doctorHolidayBlocks: MemDoctorHolidayBlock[];
  doctorCommissionRules: MemDoctorCommissionRule[];
  appointmentQueueTokens: MemQueueToken[];
  notificationDispatches: MemNotificationDispatch[];
  stocktakes: MemStocktake[];
  stocktakeLines: MemStocktakeLine[];
  stockTransfers: MemStockTransfer[];
  stockTransferLines: MemStockTransferLine[];
  dispenseOrders: MemDispenseOrder[];
  dispenseOrderLines: MemDispenseOrderLine[];
  staffInvites: MemStaffInvite[];
  staffShiftPins: MemStaffShiftPin[];
  workspaceQuotaUsage: MemQuotaUsage[];
  operatingExpenses: MemOperatingExpense[];
  creditAccounts: MemCreditAccount[];
  creditEntries: MemCreditEntry[];
  supplierPayments: MemSupplierPayment[];
  purchaseOrders: MemPurchaseOrder[];
  purchaseOrderLines: MemPurchaseOrderLine[];
  supplierDebitNotes: MemSupplierDebitNote[];
  hrStaffProfiles: MemHrStaffProfile[];
  hrAttendanceLogs: MemHrAttendanceLog[];
  hrLeaveRequests: MemHrLeaveRequest[];
  hrPayrollRuns: MemHrPayrollRun[];
  hrPayrollSlips: MemHrPayrollSlip[];
  labDiagnosticOrders: MemLabDiagnosticOrder[];
  coldChainLogs: MemColdChainLog[];
  complianceLicenses: MemComplianceLicense[];
}

function createEmptyStore(): MemoryStoreState {
  return {
    tenants: [],
    legalEntities: [],
    branches: [],
    memberships: [],
    capabilities: [],
    professionalGrants: [],
    counters: [],
    services: [],
    resources: [],
    people: [],
    appointments: [],
    charges: [],
    payments: [],
    paymentAllocations: [],
    receipts: [],
    suppliers: [],
    storageLocations: [],
    products: [],
    packVariants: [],
    uomConversions: [],
    barcodeAliases: [],
    lots: [],
    costLayers: [],
    inventoryBalances: [],
    stockMovements: [],
    goodsReceipts: [],
    goodsReceiptLines: [],
    supplierInvoices: [],
    recalls: [],
    tillShifts: [],
    tillCashEvents: [],
    approvals: [],
    posSales: [],
    posSaleLines: [],
    posSaleAllocations: [],
    posPayments: [],
    posReceipts: [],
    posReturns: [],
    actionProposals: [],
    commands: [],
    auditEvents: [],
    doctorSchedules: [],
    doctorHolidayBlocks: [],
    doctorCommissionRules: [],
    appointmentQueueTokens: [],
    notificationDispatches: [],
    stocktakes: [],
    stocktakeLines: [],
    stockTransfers: [],
    stockTransferLines: [],
    dispenseOrders: [],
    dispenseOrderLines: [],
    staffInvites: [],
    staffShiftPins: [],
    workspaceQuotaUsage: [],
    operatingExpenses: [],
    creditAccounts: [],
    creditEntries: [],
    supplierPayments: [],
    purchaseOrders: [],
    purchaseOrderLines: [],
    supplierDebitNotes: [],
    hrStaffProfiles: [],
    hrAttendanceLogs: [],
    hrLeaveRequests: [],
    hrPayrollRuns: [],
    hrPayrollSlips: [],
    labDiagnosticOrders: [],
    coldChainLogs: [],
    complianceLicenses: [],
  };
}

declare global {
  var _suwaMemoryStore: MemoryStoreState | undefined;
}

export function getMemoryStore(): MemoryStoreState {
  if (!global._suwaMemoryStore) {
    global._suwaMemoryStore = createEmptyStore();
  }
  return global._suwaMemoryStore;
}

export function resetMemoryStore(): void {
  global._suwaMemoryStore = createEmptyStore();
}

export function addMemAuditEvent(params: {
  tenantId: string;
  actorUserId?: number | null;
  actorUid?: string;
  action: string;
  entityType: string;
  entityId: string;
  inputSource?: string;
  correlationId: string;
  metadataJson?: Record<string, unknown>;
}): void {
  const store = getMemoryStore();
  store.auditEvents.unshift({
    id: crypto.randomUUID(),
    tenantId: params.tenantId,
    actorUserId: params.actorUserId ?? null,
    actorUid: params.actorUid ?? 'system',
    action: params.action,
    entityType: params.entityType,
    entityId: params.entityId,
    inputSource: params.inputSource ?? 'ui',
    correlationId: params.correlationId,
    metadataJson: params.metadataJson ?? {},
    createdAt: new Date(),
  });
}

function addDaysStr(baseIsoDate: string, days: number): string {
  const dt = new Date(`${baseIsoDate}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * Seeds realistic Sri Lankan clinic + pharmacy starter stock, batch lots (including one
 * near-expiry 18-day batch and one low-stock SKU), supplier, schedules, commission rule,
 * and pharmacist grant in preview mode when includeSampleData is enabled.
 */
export function seedStarterPharmacyAndOpsData(params: {
  tenantId: string;
  legalEntityId: string;
  branchId: string;
  userId: number;
  businessDate: string;
  currency: string;
  hasClinic: boolean;
  hasPharmacy: boolean;
  resourceId?: string;
  appointmentIds?: string[];
  personIds?: string[];
}) {
  const store = getMemoryStore();
  const { tenantId, legalEntityId, branchId, userId, businessDate, currency } = params;

  if (params.hasClinic && params.resourceId) {
    // Weekly schedules Mon-Sat 08:30 - 17:30
    for (const day of [1, 2, 3, 4, 5, 6]) {
      store.doctorSchedules.push({
        id: crypto.randomUUID(),
        tenantId,
        branchId,
        resourceId: params.resourceId,
        dayOfWeek: day,
        startTime: '08:30',
        endTime: '17:30',
        slotDurationMinutes: 20,
        active: true,
        createdAt: new Date(),
      });
    }
    store.doctorCommissionRules.push({
      id: crypto.randomUUID(),
      tenantId,
      resourceId: params.resourceId,
      serviceId: null,
      doctorSharePercent: 75,
      clinicSharePercent: 25,
      updatedAt: new Date(),
    });
    if (params.appointmentIds) {
      params.appointmentIds.forEach((aptId, idx) => {
        store.appointmentQueueTokens.push({
          id: crypto.randomUUID(),
          tenantId,
          branchId,
          businessDate,
          appointmentId: aptId,
          resourceId: params.resourceId!,
          tokenNumber: idx + 1,
          queueState: idx === 1 ? 'serving' : 'waiting',
          delayMinutes: 0,
          calledAt: idx === 1 ? new Date() : null,
          createdAt: new Date(),
        });
      });
    }
  }

  // Starter Shared Department Seed (OpEx, Credit Account, Clinic Lab Order & Compliance License)
  store.operatingExpenses.push({
    id: crypto.randomUUID(),
    tenantId,
    branchId,
    expenseDate: businessDate,
    category: 'utilities',
    description: 'CEB Electricity & Fiber Internet Daily Allocation',
    amountMinor: 120000, // LKR 1,200
    paymentMethod: 'cash',
    referenceNo: 'OPEX-001',
    status: 'posted',
    recordedByUserId: userId,
    createdAt: new Date(),
  });

  const sampleArId = crypto.randomUUID();
  store.creditAccounts.push({
    id: sampleArId,
    tenantId,
    branchId,
    personId: params.personIds?.[0] ?? null,
    accountName: params.hasPharmacy ? 'Ceylon Corporate Staff Credit' : 'Nimal Perera Corporate Account',
    accountType: 'corporate',
    phone: '0771234567',
    creditLimitMinor: 10000000,
    balanceMinor: 350000, // LKR 3,500
    lastTransactionAt: new Date(),
    createdAt: new Date(),
  });
  store.creditEntries.push({
    id: crypto.randomUUID(),
    tenantId,
    branchId,
    creditAccountId: sampleArId,
    entryType: 'charge',
    amountMinor: 350000,
    method: 'credit',
    referenceNo: 'CR-INV-01',
    dueDate: addDaysStr(businessDate, 14),
    notes: 'Monthly corporate credit account balance',
    recordedByUserId: userId,
    occurredAt: new Date(),
  });

  store.complianceLicenses.push({
    id: crypto.randomUUID(),
    tenantId,
    branchId,
    title: params.hasPharmacy ? 'NMRA Retail Pharmacy License' : 'PHSRC Private Clinic Registration',
    authority: params.hasPharmacy ? 'NMRA' : 'SLMC',
    licenseNumber: params.hasPharmacy ? 'NMRA/PH/2026/0841' : 'PHSRC/CL/2026/0419',
    expiresOn: addDaysStr(businessDate, 22),
    alertDaysBefore: 30,
    notes: 'Renewal application queued with Ministry of Health',
    createdAt: new Date(),
  });

  if (params.hasClinic && params.personIds?.[0]) {
    store.labDiagnosticOrders.push({
      id: crypto.randomUUID(),
      tenantId,
      branchId,
      personId: params.personIds[0],
      appointmentId: params.appointmentIds?.[0] ?? null,
      testName: 'Full Blood Count (FBC) + CRP',
      labProvider: 'Lanka Diagnostics Partner Lab',
      feeMinor: 185000,
      status: 'ordered',
      resultSummary: '',
      orderedByUserId: userId,
      orderedAt: new Date(),
      updatedAt: new Date(),
    });
  }

  if (!params.hasPharmacy) return;

  // Issue starter pharmacist authority for owner in preview demo mode so GRN release & Rx gate work smoothly
  const grantId = crypto.randomUUID();
  store.professionalGrants.push({
    id: grantId,
    tenantId,
    branchId,
    userId,
    grantType: 'pharmacist',
    licenseNumber: 'SLMC-PH-2026-8841',
    active: true,
    grantedByUserId: userId,
    revokedAt: null,
    expiresAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  const dispLoc = store.storageLocations.find(
    (l) => l.tenantId === tenantId && l.branchId === branchId && l.locationType === 'dispensary'
  );
  if (!dispLoc) return;

  const supplierId = crypto.randomUUID();
  store.suppliers.push({
    id: supplierId,
    tenantId,
    legalEntityId,
    name: 'State Pharmaceuticals Corp (SPMC)',
    registrationRef: 'NMRA-SPMC-001',
    contactName: 'Nadeesha Jayawardena',
    phone: '0112345678',
    email: 'orders@spmc.lk',
    status: 'approved',
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  // Product 1: Paracetamol 500mg Tablet (OTC, high stock)
  const paraId = crypto.randomUUID();
  const paraVarId = crypto.randomUUID();
  store.products.push({
    id: paraId,
    tenantId,
    legalEntityId,
    skuCode: 'PARA-500',
    displayName: 'Paracetamol 500mg Tablet (Panadol)',
    normalizedName: 'paracetamol 500mg tablet panadol',
    genericName: 'Paracetamol',
    brandName: 'Panadol',
    strengthValue: '500',
    strengthUnit: 'mg',
    dosageForm: 'tablet',
    route: 'oral',
    manufacturer: 'GSK Sri Lanka',
    regulatoryClass: 'otc',
    requiresPharmacistRelease: false,
    storageCondition: 'ambient',
    baseUnit: 'tablet',
    minShelfLifeDays: 30,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  store.packVariants.push({
    id: paraVarId,
    tenantId,
    productId: paraId,
    variantName: 'Card of 12 Tablets',
    packUnit: 'strip',
    currentBaseQty: 12,
    currentConversionVersion: 1,
    defaultSalePriceMinor: 12000, // LKR 120.00
    currency,
    allowPosSale: true,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  store.uomConversions.push({
    id: crypto.randomUUID(),
    tenantId,
    productId: paraId,
    packVariantId: paraVarId,
    version: 1,
    packUnit: 'strip',
    baseUnit: 'tablet',
    baseQtyPerPack: 12,
    effectiveFrom: new Date(),
    createdByUserId: userId,
    notes: 'Initial conversion',
    createdAt: new Date(),
  });
  store.barcodeAliases.push({
    id: crypto.randomUUID(),
    tenantId,
    productId: paraId,
    packVariantId: paraVarId,
    barcode: '8901234500012',
    barcodeType: 'ean13',
    status: 'active',
    createdAt: new Date(),
  });

  const paraLotId = crypto.randomUUID();
  const paraGrnId = crypto.randomUUID();
  const paraGrnLineId = crypto.randomUUID();
  store.lots.push({
    id: paraLotId,
    tenantId,
    branchId,
    productId: paraId,
    manufacturer: 'GSK Sri Lanka',
    batchNumber: 'PAN-2027A',
    printedExpiry: addDaysStr(businessDate, 280),
    expiryPrecision: 'day',
    expiryCutoffDate: addDaysStr(businessDate, 280),
    qualityStatus: 'released',
    quarantineReason: '',
    releasedByGrantId: grantId,
    releasedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  store.goodsReceipts.push({
    id: paraGrnId,
    tenantId,
    legalEntityId,
    branchId,
    supplierId,
    supplierDocRef: 'SPMC-OPEN-01',
    docType: 'opening_balance',
    receivedDate: businessDate,
    status: 'posted',
    notes: 'Starter sample pharmacy stock',
    commandId: null,
    createdByUserId: userId,
    postedAt: new Date(),
    createdAt: new Date(),
  });
  store.goodsReceiptLines.push({
    id: paraGrnLineId,
    tenantId,
    goodsReceiptId: paraGrnId,
    productId: paraId,
    packVariantId: paraVarId,
    uomConversionVersion: 1,
    lotId: paraLotId,
    storageLocationId: dispLoc.id,
    orderedPacks: 20,
    receivedPacks: 20,
    bonusPacks: 0,
    acceptedQtyBase: 240,
    quarantinedQtyBase: 0,
    unitPackCostMinor: 8400,
    totalLineCostMinor: 168000,
    isProvisionalCost: false,
    condition: 'good',
    createdAt: new Date(),
  });
  store.costLayers.push({
    id: crypto.randomUUID(),
    tenantId,
    branchId,
    productId: paraId,
    lotId: paraLotId,
    goodsReceiptLineId: paraGrnLineId,
    unitCostMinor: 700,
    totalCostMinor: 168000,
    initialQtyBase: 240,
    remainingQtyBase: 240,
    isProvisional: false,
    receivedAt: new Date(),
    createdAt: new Date(),
  });
  store.inventoryBalances.push({
    id: crypto.randomUUID(),
    tenantId,
    branchId,
    locationId: dispLoc.id,
    productId: paraId,
    lotId: paraLotId,
    sellableOnHand: 240,
    reservedQty: 0,
    quarantineQty: 0,
    returnedQuarantineQty: 0,
    damagedQty: 0,
    expiredQty: 0,
    recalledQty: 0,
    disposedQty: 0,
    version: 1,
    updatedAt: new Date(),
  });

  // Product 2: Amoxicillin 500mg Capsule (Rx, has a near-expiry batch in 18 days + low stock!)
  const amoxId = crypto.randomUUID();
  const amoxVarId = crypto.randomUUID();
  store.products.push({
    id: amoxId,
    tenantId,
    legalEntityId,
    skuCode: 'AMOX-500',
    displayName: 'Amoxicillin 500mg Capsule',
    normalizedName: 'amoxicillin 500mg capsule',
    genericName: 'Amoxicillin',
    brandName: 'Amoxil',
    strengthValue: '500',
    strengthUnit: 'mg',
    dosageForm: 'capsule',
    route: 'oral',
    manufacturer: 'SPMC',
    regulatoryClass: 'prescription_only',
    requiresPharmacistRelease: true,
    storageCondition: 'ambient',
    baseUnit: 'capsule',
    minShelfLifeDays: 30,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  store.packVariants.push({
    id: amoxVarId,
    tenantId,
    productId: amoxId,
    variantName: 'Strip of 10 Capsules',
    packUnit: 'strip',
    currentBaseQty: 10,
    currentConversionVersion: 1,
    defaultSalePriceMinor: 35000, // LKR 350.00
    currency,
    allowPosSale: true,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  store.uomConversions.push({
    id: crypto.randomUUID(),
    tenantId,
    productId: amoxId,
    packVariantId: amoxVarId,
    version: 1,
    packUnit: 'strip',
    baseUnit: 'capsule',
    baseQtyPerPack: 10,
    effectiveFrom: new Date(),
    createdByUserId: userId,
    notes: 'Initial conversion',
    createdAt: new Date(),
  });
  store.barcodeAliases.push({
    id: crypto.randomUUID(),
    tenantId,
    productId: amoxId,
    packVariantId: amoxVarId,
    barcode: '8901234500500',
    barcodeType: 'ean13',
    status: 'active',
    createdAt: new Date(),
  });

  const amoxLotId = crypto.randomUUID();
  const amoxGrnLineId = crypto.randomUUID();
  const nearExp = addDaysStr(businessDate, 18);
  store.lots.push({
    id: amoxLotId,
    tenantId,
    branchId,
    productId: amoxId,
    manufacturer: 'SPMC',
    batchNumber: 'AMX-EXP18',
    printedExpiry: nearExp,
    expiryPrecision: 'day',
    expiryCutoffDate: nearExp,
    qualityStatus: 'released',
    quarantineReason: '',
    releasedByGrantId: grantId,
    releasedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  store.costLayers.push({
    id: crypto.randomUUID(),
    tenantId,
    branchId,
    productId: amoxId,
    lotId: amoxLotId,
    goodsReceiptLineId: amoxGrnLineId,
    unitCostMinor: 2200,
    totalCostMinor: 44000,
    initialQtyBase: 20,
    remainingQtyBase: 20,
    isProvisional: false,
    receivedAt: new Date(),
    createdAt: new Date(),
  });
  store.inventoryBalances.push({
    id: crypto.randomUUID(),
    tenantId,
    branchId,
    locationId: dispLoc.id,
    productId: amoxId,
    lotId: amoxLotId,
    sellableOnHand: 20, // Low stock (<50) + expiring in 18 days!
    reservedQty: 0,
    quarantineQty: 0,
    returnedQuarantineQty: 0,
    damagedQty: 0,
    expiredQty: 0,
    recalledQty: 0,
    disposedQty: 0,
    version: 1,
    updatedAt: new Date(),
  });

  if (params.personIds && params.personIds[0]) {
    store.dispenseOrders.push({
      id: crypto.randomUUID(),
      tenantId,
      branchId,
      orderNumber: `RXQ-${businessDate.replace(/-/g, '')}-001`,
      personId: params.personIds[0],
      appointmentId: params.appointmentIds?.[0] ?? null,
      prescriberName: 'Dr. Perera',
      clinicalNotes: 'Take Paracetamol PRN for fever',
      status: 'pending',
      posSaleId: null,
      createdByUserId: userId,
      createdAt: new Date(),
      dispensedAt: null,
    });
    store.dispenseOrderLines.push({
      id: crypto.randomUUID(),
      tenantId,
      dispenseOrderId: store.dispenseOrders[store.dispenseOrders.length - 1].id,
      productId: paraId,
      packVariantId: paraVarId,
      qtyPacks: 1,
      dosageInstruction: '1-2 tablets every 6 hours if fever',
    });
  }

  store.coldChainLogs.push({
    id: crypto.randomUUID(),
    tenantId,
    branchId,
    fridgeName: 'Main Vaccine & Insulin Fridge',
    tempTenthsC: 44, // 4.4°C
    inRange: true,
    notes: 'Morning cold-chain verification OK',
    recordedByUserId: userId,
    loggedAt: new Date(),
  });
}
