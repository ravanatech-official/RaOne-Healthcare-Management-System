import { auth } from './firebase.ts';
import type {
  ApiErrorEnvelope,
  AutopilotCockpitResponse,
  BillingCycle,
  CompleteShiftChecklistInput,
  CreateBranchInput,
  CreateStaffInviteInput,
  JarvisConverseInput,
  JarvisConverseResponse,
  NotificationDispatchItem,
  OnboardingBootstrapInput,
  PaySubscriptionInvoiceInput,
  ProductMode,
  PublicKioskInfoResponse,
  PublicSelfCheckInInput,
  PublicSelfCheckInResponse,
  SendNotificationInput,
  SessionContextResponse,
  ShiftChecklistRunView,
  SubscriptionPaymentItem,
  SupportedLocale,
  TenantSubscriptionOverview,
  TodaySummaryResponse,
  ToggleChecklistItemInput,
  UpdateGovernanceRulesInput,
  WorkspaceGovernanceRuleView,
  WorkspaceQuotaSummary,
} from '../contracts/api.ts';
import type {
  CreateDoctorScheduleInput,
  CreateHolidayBlockInput,
  DoctorPayoutReportResponse,
  PatientVisitHistoryResponse,
  UpsertDoctorCommissionInput,
  WaitingRoomDisplayResponse,
} from '../contracts/clinic.ts';
import type {
  CombinedZReportResponse,
  CreateDispenseOrderInput,
  CreateStockTransferInput,
  StockAlertsDashboardResponse,
} from '../contracts/pharmacy.ts';
import type {
  AccountsOverviewResponse,
  ConvertPoToGrnInput,
  CreateCreditAccountInput,
  CreateLabOrderInput,
  CreatePurchaseOrderInput,
  CreateSupplierDebitNoteInput,
  HrAdminOverviewResponse,
  PurchasingOverviewResponse,
  RecordCreditEntryInput,
  RecordOperatingExpenseInput,
  RecordSupplierPaymentInput,
  RequestLeaveInput,
  UpsertHrProfileInput,
} from '../contracts/departments.ts';

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly envelope: ApiErrorEnvelope;

  constructor(status: number, envelope: ApiErrorEnvelope) {
    super(envelope.message);
    this.status = status;
    this.envelope = envelope;
  }
}

async function authorizedFetch<T>(
  path: string,
  options: RequestInit & { tenantId?: string } = {}
): Promise<T> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new ApiClientError(401, {
      code: 'UNAUTHENTICATED',
      messageKey: 'errors.unauthenticated',
      message: 'Please sign in to continue.',
      retryable: false,
      correlationId: 'client_no_user',
    });
  }

  const runFetch = async (forceRefresh: boolean) => {
    const token = await currentUser.getIdToken(forceRefresh);
    const headers = new Headers(options.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (options.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json');
    }
    if (options.tenantId) {
      headers.set('X-Tenant-Id', options.tenantId);
    }
    return fetch(`/api/v1${path}`, {
      ...options,
      headers,
      cache: 'no-store',
    });
  };

  let response = await runFetch(false);
  if (response.status === 401) {
    response = await runFetch(true);
  }

  const data = await response.json().catch(() => ({
    code: 'INVALID_RESPONSE',
    messageKey: 'errors.internal',
    message: 'Server returned an unreadable response.',
    retryable: true,
    correlationId: 'client_parse_error',
  }));

  if (!response.ok) {
    throw new ApiClientError(response.status, data as ApiErrorEnvelope);
  }

  return data as T;
}

export const apiClient = {
  getSessionContext: (tenantId?: string) =>
    authorizedFetch<SessionContextResponse>('/session/context', { tenantId }),

  bootstrapOnboarding: (payload: OnboardingBootstrapInput) =>
    authorizedFetch<{ created: true; workspace: SessionContextResponse['workspace'] }>(
      '/onboarding/bootstrap',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),

  updateLocale: (preferredLocale: SupportedLocale) =>
    authorizedFetch<{ preferredLocale: SupportedLocale }>('/user/locale', {
      method: 'POST',
      body: JSON.stringify({ preferredLocale }),
    }),

  getTodaySummary: (tenantId: string, date?: string) => {
    const qs = date ? `?date=${encodeURIComponent(date)}` : '';
    return authorizedFetch<TodaySummaryResponse>(`/today${qs}`, { tenantId });
  },

  interpretUtterance: (
    tenantId: string,
    payload: { text: string; locale: SupportedLocale; source: 'text' | 'voice' }
  ) =>
    authorizedFetch<{
      interpretation: {
        status: string;
        intent: string;
        detectedLanguage: string;
        extractedFields: Record<string, unknown>;
        missingFields: string[];
        assistantReply: string;
        modelVersion: string;
      };
      correlationId: string;
    }>('/assistant/interpret', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  getTeamMembers: (tenantId: string) =>
    authorizedFetch<{
      members: Array<{
        membershipId: string;
        userId: number;
        role: string;
        active: boolean;
        branchName: string;
        email: string;
        displayName: string;
        createdAt: string;
      }>;
    }>('/team', { tenantId }),

  getAuditEvents: (tenantId: string) =>
    authorizedFetch<{
      events: Array<{
        id: string;
        action: string;
        entityType: string;
        entityId: string;
        inputSource: string;
        correlationId: string;
        metadataJson: Record<string, unknown>;
        createdAt: string;
      }>;
    }>('/audit', { tenantId }),

  // Platform: Product Modes, Capabilities, Legal Entities & Professional Grants
  getCapabilities: (tenantId: string) =>
    authorizedFetch<{
      productMode: 'clinic_only' | 'pharmacy_inventory_only' | 'pharmacy_retail_only' | 'combo';
      capabilities: Record<string, boolean>;
      mandatorySafetyCapabilities: string[];
      modeManifest: Record<string, string[]>;
    }>('/platform/capabilities', { tenantId }),

  updateProductMode: (
    tenantId: string,
    payload: {
      productMode: 'clinic_only' | 'pharmacy_inventory_only' | 'pharmacy_retail_only' | 'combo';
      extraCapabilities?: Record<string, boolean>;
    }
  ) =>
    authorizedFetch<{ productMode: string; capabilities: Record<string, boolean> }>(
      '/platform/capabilities',
      {
        method: 'PATCH',
        tenantId,
        body: JSON.stringify(payload),
      }
    ),

  getLegalEntities: (tenantId: string) =>
    authorizedFetch<{
      legalEntities: Array<{
        id: string;
        name: string;
        registrationNumber: string;
        taxId: string;
        countryCode: string;
        currency: string;
        active: boolean;
      }>;
    }>('/platform/legal-entities', { tenantId }),

  createLegalEntity: (
    tenantId: string,
    payload: { name: string; registrationNumber?: string; taxId?: string }
  ) =>
    authorizedFetch('/platform/legal-entities', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  getProfessionalGrants: (tenantId: string) =>
    authorizedFetch<{
      grants: Array<{
        id: string;
        userId: number;
        userEmail: string;
        userName: string;
        grantType: 'pharmacist' | 'clinician';
        licenseNumber: string;
        active: boolean;
        revokedAt: string | null;
        expiresAt: string | null;
        createdAt: string;
      }>;
    }>('/platform/grants', { tenantId }),

  grantProfessionalAuthority: (
    tenantId: string,
    payload: {
      userId: number;
      grantType: 'pharmacist' | 'clinician';
      licenseNumber: string;
      expiresAt?: string | null;
    }
  ) =>
    authorizedFetch('/platform/grants', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  revokeProfessionalGrant: (tenantId: string, grantId: string) =>
    authorizedFetch(`/platform/grants/${grantId}`, {
      method: 'DELETE',
      tenantId,
    }),

  // Pharmacy: Catalogue, Versioned UOM, Barcodes, Suppliers, GRNs, Invoices & Stock
  getCatalogueProducts: (tenantId: string, query?: string) => {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    return authorizedFetch<{
      items: Array<{
        id: string;
        skuCode: string;
        displayName: string;
        genericName: string;
        brandName: string;
        strengthValue: string;
        strengthUnit: string;
        dosageForm: string;
        manufacturer: string;
        regulatoryClass: string;
        requiresPharmacistRelease: boolean;
        storageCondition: string;
        baseUnit: string;
        variants: Array<{
          id: string;
          variantName: string;
          packUnit: string;
          currentBaseQty: number;
          currentConversionVersion: number;
          defaultSalePriceMinor: number;
          currency: string;
          conversionHistory: Array<{
            id: string;
            version: number;
            baseQtyPerPack: number;
            notes: string;
            effectiveFrom: string;
          }>;
          barcodes: Array<{
            id: string;
            barcode: string;
            barcodeType: string;
            status: string;
          }>;
        }>;
      }>;
      ambiguityWarning: boolean;
    }>(`/pharmacy/catalogue/products${qs}`, { tenantId });
  },

  createProduct: (tenantId: string, payload: Record<string, unknown>) =>
    authorizedFetch('/pharmacy/catalogue/products', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  addPackVariant: (tenantId: string, productId: string, payload: Record<string, unknown>) =>
    authorizedFetch(`/pharmacy/catalogue/products/${productId}/packs`, {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  updatePackConversion: (
    tenantId: string,
    variantId: string,
    payload: { newBaseQtyPerPack: number; newDefaultSalePriceMinor?: number; notes: string }
  ) =>
    authorizedFetch(`/pharmacy/catalogue/packs/${variantId}/conversion`, {
      method: 'PATCH',
      tenantId,
      body: JSON.stringify(payload),
    }),

  getSuppliers: (tenantId: string) =>
    authorizedFetch<{
      suppliers: Array<{
        id: string;
        name: string;
        registrationRef: string;
        contactName: string;
        phone: string;
        status: string;
      }>;
    }>('/pharmacy/suppliers', { tenantId }),

  createSupplier: (tenantId: string, payload: Record<string, unknown>) =>
    authorizedFetch('/pharmacy/suppliers', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  getStorageLocations: (tenantId: string) =>
    authorizedFetch<{
      locations: Array<{
        id: string;
        code: string;
        name: string;
        locationType: string;
      }>;
    }>('/pharmacy/locations', { tenantId }),

  getGoodsReceipts: (tenantId: string) =>
    authorizedFetch<{
      goodsReceipts: Array<{
        id: string;
        supplierId: string;
        supplierName: string;
        supplierDocRef: string;
        docType: string;
        receivedDate: string;
        status: string;
        postedAt: string;
      }>;
    }>('/pharmacy/goods-receipts', { tenantId }),

  postGoodsReceipt: (tenantId: string, payload: Record<string, unknown>) =>
    authorizedFetch('/pharmacy/goods-receipts', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  getSupplierInvoices: (tenantId: string) =>
    authorizedFetch<{
      supplierInvoices: Array<{
        id: string;
        supplierId: string;
        supplierName: string;
        goodsReceiptId: string | null;
        invoiceNumber: string;
        invoiceDate: string;
        totalMinor: number;
        currency: string;
        status: string;
      }>;
    }>('/pharmacy/supplier-invoices', { tenantId }),

  postSupplierInvoice: (tenantId: string, payload: Record<string, unknown>) =>
    authorizedFetch('/pharmacy/supplier-invoices', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  getStockSummary: (tenantId: string) =>
    authorizedFetch<{
      balances: Array<{
        balanceId: string;
        locationId: string;
        locationCode: string;
        locationName: string;
        locationType: string;
        productId: string;
        skuCode: string;
        productName: string;
        genericName: string;
        strengthValue: string;
        strengthUnit: string;
        dosageForm: string;
        regulatoryClass: string;
        requiresPharmacistRelease: boolean;
        baseUnit: string;
        lotId: string;
        batchNumber: string;
        manufacturer: string;
        printedExpiry: string;
        expiryPrecision: string;
        expiryCutoffDate: string | null;
        qualityStatus: string;
        quarantineReason: string;
        releasedByGrantId: string | null;
        sellableOnHand: number;
        reservedQty: number;
        availableQty: number;
        quarantineQty: number;
        returnedQuarantineQty: number;
        damagedQty: number;
        expiredQty: number;
        recalledQty: number;
        disposedQty: number;
      }>;
      recentMovements: Array<{
        id: string;
        productName: string;
        batchNumber: string;
        movementType: string;
        qtyBase: number;
        fromBucket: string | null;
        toBucket: string | null;
        reason: string;
        sourceDocType: string;
        uomConversionVersion: number | null;
        occurredAt: string;
      }>;
    }>('/pharmacy/stock', { tenantId }),

  transitionLotQuality: (
    tenantId: string,
    lotId: string,
    payload: {
      action: 'release_to_sellable' | 'place_quarantine' | 'place_recall_hold';
      reason: string;
      locationId?: string;
      qtyBase?: number;
    }
  ) =>
    authorizedFetch(`/pharmacy/lots/${lotId}/quality`, {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  // Clinic Write Slice: People, Appointments, Billing/Receipts & Draft->Confirm Proposals
  getClinicPeople: (tenantId: string, query?: string) => {
    const qs = query ? `?q=${encodeURIComponent(query)}` : '';
    return authorizedFetch<{
      people: Array<{
        id: string;
        displayName: string;
        phone: string;
        phoneLast4: string;
        notes: string;
        isSample: boolean;
        version: number;
      }>;
    }>(`/clinic/people${qs}`, { tenantId });
  },

  createClinicPerson: (
    tenantId: string,
    payload: {
      displayName: string;
      phone?: string;
      notes?: string;
      confirmDuplicate?: boolean;
    }
  ) =>
    authorizedFetch<{ person: { id: string; displayName: string } }>('/clinic/people', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  createClinicAppointment: (
    tenantId: string,
    payload: {
      idempotencyKey: string;
      personId: string;
      serviceId: string;
      resourceId: string;
      startsAt: string;
      notes?: string;
    }
  ) =>
    authorizedFetch('/clinic/appointments', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  rescheduleClinicAppointment: (
    tenantId: string,
    appointmentId: string,
    payload: {
      idempotencyKey: string;
      startsAt: string;
      resourceId?: string;
      expectedVersion: number;
    }
  ) =>
    authorizedFetch(`/clinic/appointments/${appointmentId}/reschedule`, {
      method: 'PATCH',
      tenantId,
      body: JSON.stringify(payload),
    }),

  transitionAppointmentStatus: (
    tenantId: string,
    appointmentId: string,
    payload: {
      idempotencyKey: string;
      status: 'arrived' | 'completed' | 'cancelled' | 'no_show';
      expectedVersion: number;
    }
  ) =>
    authorizedFetch(`/clinic/appointments/${appointmentId}/status`, {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  getClinicPayments: (tenantId: string) =>
    authorizedFetch<{
      payments: Array<{
        paymentId: string;
        amountMinor: number;
        currency: string;
        method: string;
        referenceNumber: string;
        status: string;
        recordedAt: string;
        personName: string;
        receiptNumber: string | null;
      }>;
    }>('/clinic/payments', { tenantId }),

  recordClinicPayment: (
    tenantId: string,
    payload: {
      idempotencyKey: string;
      personId: string;
      appointmentId?: string | null;
      description: string;
      amountMinor: number;
      method: 'cash' | 'card' | 'bank';
      referenceNumber?: string;
    }
  ) =>
    authorizedFetch<{
      receipt: { receiptNumber: string; snapshotJson: Record<string, unknown> };
    }>('/clinic/payments', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  voidClinicPayment: (
    tenantId: string,
    paymentId: string,
    payload: { idempotencyKey: string; reason: string }
  ) =>
    authorizedFetch(`/clinic/payments/${paymentId}/void`, {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  prepareActionProposal: (
    tenantId: string,
    payload: {
      actionType: 'create_appointment' | 'reschedule_appointment' | 'record_payment';
      payload: Record<string, unknown>;
      inputSource: 'ui' | 'text' | 'voice';
    }
  ) =>
    authorizedFetch<{
      proposal: {
        id: string;
        actionType: string;
        canonicalPayloadJson: Record<string, unknown>;
        nonce: string;
        expiresAt: string;
      };
    }>('/clinic/proposals', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  confirmActionProposal: (
    tenantId: string,
    proposalId: string,
    payload: { idempotencyKey: string; nonce: string }
  ) =>
    authorizedFetch(`/clinic/proposals/${proposalId}/confirm`, {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  // Pharmacy Phase 2: Till Shifts, Retail POS, Cart-Hash Gate & Returns
  getTillShifts: (tenantId: string) =>
    authorizedFetch<{
      shifts: Array<{
        id: string;
        counterId: string;
        openingFloatMinor: number;
        cashSalesMinor: number;
        cashRefundsMinor: number;
        cashDropsMinor: number;
        paidOutsMinor: number;
        expectedCashMinor: number;
        countedCashMinor: number | null;
        varianceMinor: number | null;
        status: 'open' | 'closed';
        openedAt: string;
        closedAt: string | null;
      }>;
      counters: Array<{ id: string; name: string; code: string }>;
    }>('/pharmacy/shifts', { tenantId }),

  openTillShift: (tenantId: string, payload: { counterId?: string; openingFloatMinor: number }) =>
    authorizedFetch('/pharmacy/shifts/open', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  recordTillCashEvent: (
    tenantId: string,
    shiftId: string,
    payload: { eventType: 'drop' | 'paid_out' | 'top_up'; amountMinor: number; reason: string }
  ) =>
    authorizedFetch(`/pharmacy/shifts/${shiftId}/cash-events`, {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  closeTillShift: (
    tenantId: string,
    shiftId: string,
    payload: { countedCashMinor: number; closeNotes?: string }
  ) =>
    authorizedFetch(`/pharmacy/shifts/${shiftId}/close`, {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  getPosSales: (tenantId: string) =>
    authorizedFetch<{
      sales: Array<{
        id: string;
        saleNumber: string;
        totalMinor: number;
        paidMinor: number;
        changeMinor: number;
        currency: string;
        status: string;
        soldAt: string;
        receipt: { receiptNumber: string; snapshotJson: Record<string, unknown> } | null;
        lines: Array<{
          id: string;
          productId: string;
          productName: string;
          baseUnit: string;
          qtyPacks: number;
          qtyBase: number;
          returnedQtyBase: number;
          lineTotalMinor: number;
        }>;
      }>;
    }>('/pharmacy/pos/sales', { tenantId }),

  approvePosCart: (
    tenantId: string,
    payload: {
      items: Array<{
        productId: string;
        packVariantId: string;
        qtyPacks: number;
        unitSalePriceMinor?: number;
      }>;
      discountMinor: number;
      prescriptionRef?: string;
      notes?: string;
    }
  ) =>
    authorizedFetch<{
      approval: {
        id: string;
        cartHash: string;
        licenseNumber: string;
        expiresAt: string;
      };
    }>('/pharmacy/pos/approvals', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  checkoutPosSale: (
    tenantId: string,
    payload: {
      idempotencyKey: string;
      shiftId: string;
      personId?: string | null;
      items: Array<{
        productId: string;
        packVariantId: string;
        qtyPacks: number;
        unitSalePriceMinor?: number;
      }>;
      discountMinor: number;
      approvalId?: string | null;
      managerOverridePin?: string;
      payments: Array<{
        method: 'cash' | 'card' | 'bank';
        amountMinor: number;
        referenceNumber?: string;
      }>;
    }
  ) =>
    authorizedFetch<{
      sale: { id: string; saleNumber: string; totalMinor: number; changeMinor: number };
      receipt: { receiptNumber: string; snapshotJson: Record<string, unknown> };
    }>('/pharmacy/pos/checkout', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  createPosReturn: (
    tenantId: string,
    saleId: string,
    payload: {
      idempotencyKey: string;
      shiftId: string;
      reason: string;
      refundMethod: 'cash' | 'card' | 'bank';
      lines: Array<{ saleLineId: string; qtyBase: number }>;
    }
  ) =>
    authorizedFetch<{
      posReturn: { returnNumber: string; refundAmountMinor: number };
    }>(`/pharmacy/pos/sales/${saleId}/returns`, {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  // SaaS Subscription & Monthly Client Billing
  getBillingOverview: (tenantId: string) =>
    authorizedFetch<TenantSubscriptionOverview & { correlationId: string }>('/billing/overview', {
      tenantId,
    }),

  updateBillingPlan: (
    tenantId: string,
    payload: { planCode: ProductMode; billingCycle: BillingCycle; autoRenew?: boolean }
  ) =>
    authorizedFetch<TenantSubscriptionOverview & { correlationId: string }>('/billing/plan', {
      method: 'PATCH',
      tenantId,
      body: JSON.stringify(payload),
    }),

  generateBillingInvoice: (tenantId: string, payload?: { billingCycle?: BillingCycle }) =>
    authorizedFetch<TenantSubscriptionOverview & { correlationId: string }>('/billing/invoices', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload ?? {}),
    }),

  payBillingInvoice: (tenantId: string, payload: PaySubscriptionInvoiceInput) =>
    authorizedFetch<{
      overview: TenantSubscriptionOverview;
      payment: SubscriptionPaymentItem;
      correlationId: string;
    }>('/billing/pay', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  confirmBankTransferPayment: (tenantId: string, paymentId: string) =>
    authorizedFetch<TenantSubscriptionOverview & { correlationId: string }>(
      `/billing/payments/${paymentId}/confirm`,
      {
        method: 'POST',
        tenantId,
      }
    ),

  getBillingQuotas: (tenantId: string) =>
    authorizedFetch<{ quotas: WorkspaceQuotaSummary; correlationId: string }>('/billing/quotas', {
      tenantId,
    }),

  triggerSandboxPayHereWebhook: (
    tenantId: string,
    payload: {
      invoiceId: string;
      statusCode?: '2' | '-1' | '-2';
      gatewayProvider?: 'payhere' | 'webxpay' | 'genie';
    }
  ) =>
    authorizedFetch<{
      processed: boolean;
      status: string;
      gatewayReference: string;
      md5Verified: boolean;
      overview: TenantSubscriptionOverview;
      correlationId: string;
    }>('/billing/webhooks/payhere/sandbox-trigger', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  sendBillingInvoiceReminder: (
    tenantId: string,
    payload: {
      invoiceId: string;
      recipientPhone: string;
      channel: 'whatsapp' | 'sms';
      provider?: 'whatsapp_cloud' | 'notify_lk' | 'dialog_sms' | 'mobitel_sms';
    }
  ) =>
    authorizedFetch<{ dispatch: NotificationDispatchItem; correlationId: string }>(
      '/billing/notifications/invoice-reminder',
      {
        method: 'POST',
        tenantId,
        body: JSON.stringify(payload),
      }
    ),

  // J.A.R.V.I.S. Conversational Engine & TTS
  jarvisConverse: (tenantId: string, payload: JarvisConverseInput) =>
    authorizedFetch<JarvisConverseResponse & { correlationId: string }>('/assistant/converse', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  jarvisTts: (tenantId: string, payload: { text: string; locale: SupportedLocale }) =>
    authorizedFetch<{
      mode: 'audio_wav' | 'browser_tts';
      lang?: SupportedLocale;
      mimeType?: string;
      audioBase64?: string;
      text: string;
      locale?: SupportedLocale;
      correlationId: string;
    }>('/assistant/tts', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  // Notifications
  getNotifications: (tenantId: string) =>
    authorizedFetch<{ notifications: NotificationDispatchItem[]; correlationId: string }>(
      '/notifications',
      { tenantId }
    ),

  sendNotification: (tenantId: string, payload: SendNotificationInput) =>
    authorizedFetch<{ dispatch: NotificationDispatchItem; correlationId: string }>(
      '/notifications/send',
      {
        method: 'POST',
        tenantId,
        body: JSON.stringify(payload),
      }
    ),

  // Clinic Queue, Schedules, Holidays, Slots, Patient History & Doctor Payouts
  getWaitingRoomDisplay: (tenantId: string, date?: string) => {
    const qs = date ? `?date=${encodeURIComponent(date)}` : '';
    return authorizedFetch<WaitingRoomDisplayResponse & { correlationId: string }>(
      `/clinic/queue/display${qs}`,
      { tenantId }
    );
  },

  updateAppointmentQueueState: (
    tenantId: string,
    appointmentId: string,
    payload: { queueState: 'waiting' | 'serving' | 'completed' | 'skipped'; delayMinutes?: number }
  ) =>
    authorizedFetch(`/clinic/appointments/${appointmentId}/queue`, {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  broadcastDoctorDelay: (
    tenantId: string,
    payload: { resourceId: string; delayMinutes: number }
  ) =>
    authorizedFetch<{
      resourceId: string;
      affectedTokens: number;
      delayMinutes: number;
      correlationId: string;
    }>(
      '/clinic/queue/delay-broadcast',
      {
        method: 'POST',
        tenantId,
        body: JSON.stringify(payload),
      }
    ),

  getDoctorSchedules: (tenantId: string, resourceId?: string) => {
    const qs = resourceId ? `?resourceId=${encodeURIComponent(resourceId)}` : '';
    return authorizedFetch<{
      schedules: Array<{
        id: string;
        resourceId: string;
        resourceName: string;
        dayOfWeek: number;
        startTime: string;
        endTime: string;
        slotDurationMinutes: number;
      }>;
      correlationId: string;
    }>(`/clinic/schedules${qs}`, { tenantId });
  },

  createDoctorSchedule: (tenantId: string, payload: CreateDoctorScheduleInput) =>
    authorizedFetch('/clinic/schedules', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  deleteDoctorSchedule: (tenantId: string, id: string) =>
    authorizedFetch(`/clinic/schedules/${id}`, {
      method: 'DELETE',
      tenantId,
    }),

  getDoctorHolidays: (tenantId: string, resourceId?: string) => {
    const qs = resourceId ? `?resourceId=${encodeURIComponent(resourceId)}` : '';
    return authorizedFetch<{
      holidays: Array<{
        id: string;
        resourceId: string;
        resourceName: string;
        blockDate: string;
        reason: string;
      }>;
      correlationId: string;
    }>(`/clinic/holidays${qs}`, { tenantId });
  },

  createDoctorHoliday: (tenantId: string, payload: CreateHolidayBlockInput) =>
    authorizedFetch('/clinic/holidays', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  getAvailableDoctorSlots: (tenantId: string, resourceId: string, date: string) =>
    authorizedFetch<{
      date: string;
      isHoliday: boolean;
      holidayReason?: string;
      slots: Array<{
        startsAt: string;
        label: string;
        available: boolean;
      }>;
      correlationId: string;
    }>(
      `/clinic/slots?resourceId=${encodeURIComponent(resourceId)}&date=${encodeURIComponent(date)}`,
      { tenantId }
    ),

  getPatientVisitHistory: (tenantId: string, personId: string) =>
    authorizedFetch<PatientVisitHistoryResponse & { correlationId: string }>(
      `/clinic/people/${personId}/history`,
      { tenantId }
    ),

  getDoctorPayouts: (tenantId: string, date?: string) => {
    const qs = date ? `?date=${encodeURIComponent(date)}` : '';
    return authorizedFetch<DoctorPayoutReportResponse & { correlationId: string }>(
      `/clinic/doctor-payouts${qs}`,
      { tenantId }
    );
  },

  upsertDoctorCommission: (tenantId: string, payload: UpsertDoctorCommissionInput) =>
    authorizedFetch('/clinic/doctor-commissions', {
      method: 'PUT',
      tenantId,
      body: JSON.stringify(payload),
    }),

  // Pharmacy Alerts, Stocktakes, Multi-Branch Transfers, Dispense Queue & Z-Report
  getPharmacyAlerts: (tenantId: string) =>
    authorizedFetch<StockAlertsDashboardResponse & { correlationId: string }>('/pharmacy/alerts', {
      tenantId,
    }),

  getStocktakes: (tenantId: string) =>
    authorizedFetch<{
      stocktakes: Array<{
        id: string;
        status: 'open' | 'reconciled';
        notes: string;
        createdAt: string;
        reconciledAt: string | null;
        lines: Array<{
          id: string;
          productId: string;
          productName: string;
          lotId: string;
          batchNumber: string;
          systemQtyBase: number;
          countedQtyBase: number | null;
          varianceQtyBase: number | null;
          reason: string;
        }>;
      }>;
      correlationId: string;
    }>('/pharmacy/stocktakes', { tenantId }),

  createStocktake: (tenantId: string, notes?: string) =>
    authorizedFetch('/pharmacy/stocktakes', {
      method: 'POST',
      tenantId,
      body: JSON.stringify({ notes: notes ?? '' }),
    }),

  submitStocktakeCounts: (
    tenantId: string,
    stocktakeId: string,
    counts: Array<{ lineId: string; countedQtyBase: number; reason?: string }>
  ) =>
    authorizedFetch(`/pharmacy/stocktakes/${stocktakeId}/counts`, {
      method: 'POST',
      tenantId,
      body: JSON.stringify({ counts }),
    }),

  reconcileStocktake: (tenantId: string, stocktakeId: string) =>
    authorizedFetch(`/pharmacy/stocktakes/${stocktakeId}/reconcile`, {
      method: 'POST',
      tenantId,
    }),

  getStockTransfers: (tenantId: string) =>
    authorizedFetch<{
      transfers: Array<{
        id: string;
        transferNumber: string;
        fromBranchId: string;
        fromBranchName: string;
        toBranchId: string;
        toBranchName: string;
        status: 'dispatched' | 'received';
        notes: string;
        createdAt: string;
        receivedAt: string | null;
        lines: Array<{
          id: string;
          productId: string;
          productName: string;
          lotId: string;
          batchNumber: string;
          qtyBase: number;
        }>;
      }>;
      correlationId: string;
    }>('/pharmacy/transfers', { tenantId }),

  createStockTransfer: (tenantId: string, payload: CreateStockTransferInput) =>
    authorizedFetch('/pharmacy/transfers', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  receiveStockTransfer: (
    tenantId: string,
    transferId: string,
    payload: { receiveIntoSellable: boolean; notes?: string }
  ) =>
    authorizedFetch(`/pharmacy/transfers/${transferId}/receive`, {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  getDispenseQueue: (tenantId: string) =>
    authorizedFetch<{
      orders: Array<{
        id: string;
        orderNumber: string;
        personId: string;
        patientName: string;
        patientPhone?: string;
        appointmentId: string | null;
        prescriberName: string;
        clinicalNotes: string;
        status: 'pending' | 'dispensed' | 'cancelled';
        posSaleId: string | null;
        createdAt: string;
        lines: Array<{
          id: string;
          productId: string;
          productName: string;
          packVariantId: string;
          variantName: string;
          qtyPacks: number;
          dosageInstruction: string;
        }>;
      }>;
      correlationId: string;
    }>('/pharmacy/dispense-queue', { tenantId }),

  createDispenseOrder: (tenantId: string, payload: CreateDispenseOrderInput) =>
    authorizedFetch('/pharmacy/dispense-queue', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  updateDispenseOrderStatus: (
    tenantId: string,
    orderId: string,
    payload: { status: 'dispensed' | 'cancelled'; posSaleId?: string | null }
  ) =>
    authorizedFetch(`/pharmacy/dispense-queue/${orderId}/status`, {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  getCombinedZReport: (tenantId: string, date?: string) => {
    const qs = date ? `?date=${encodeURIComponent(date)}` : '';
    return authorizedFetch<{ report: CombinedZReportResponse; correlationId: string }>(
      `/reports/z-report${qs}`,
      { tenantId }
    );
  },

  fetchCombinedZReportCsv: async (tenantId: string, date?: string): Promise<string> => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('Please sign in first.');
    const token = await currentUser.getIdToken(false);
    const qs = date ? `?date=${encodeURIComponent(date)}` : '';
    const res = await fetch(`/api/v1/reports/z-report.csv${qs}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-Id': tenantId,
      },
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error('Unable to download CSV report.');
    }
    return res.text();
  },

  // Team Multi-Branch, Invites, Role Updates & Shift PIN Lock
  getWorkspaceBranches: (tenantId: string) =>
    authorizedFetch<{
      branches: Array<{
        id: string;
        name: string;
        code: string;
        openingHoursSummary: string;
        active: boolean;
      }>;
      correlationId: string;
    }>('/platform/branches', { tenantId }),

  createWorkspaceBranch: (tenantId: string, payload: CreateBranchInput) =>
    authorizedFetch('/platform/branches', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  getStaffInvites: (tenantId: string) =>
    authorizedFetch<{
      invites: Array<{
        id: string;
        email: string;
        displayName: string;
        role: string;
        branchId: string;
        branchName: string;
        token: string;
        status: string;
        createdAt: string;
      }>;
      correlationId: string;
    }>('/platform/invites', { tenantId }),

  createStaffInvite: (tenantId: string, payload: CreateStaffInviteInput) =>
    authorizedFetch('/platform/invites', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  revokeStaffInvite: (tenantId: string, inviteId: string) =>
    authorizedFetch(`/platform/invites/${inviteId}`, {
      method: 'DELETE',
      tenantId,
    }),

  acceptStaffInvite: (token: string) =>
    authorizedFetch(`/platform/invites/${encodeURIComponent(token)}/accept`, {
      method: 'POST',
    }),

  updateTeamMembership: (
    tenantId: string,
    membershipId: string,
    payload: { role?: string; branchId?: string; active?: boolean }
  ) =>
    authorizedFetch(`/platform/team/${membershipId}`, {
      method: 'PATCH',
      tenantId,
      body: JSON.stringify(payload),
    }),

  setShiftPin: (tenantId: string, pin: string) =>
    authorizedFetch<{ configured: boolean; correlationId: string }>('/platform/shift-pin/set', {
      method: 'POST',
      tenantId,
      body: JSON.stringify({ pin }),
    }),

  verifyShiftPin: (tenantId: string, pin: string) =>
    authorizedFetch<{ verified: boolean; correlationId: string }>('/platform/shift-pin/verify', {
      method: 'POST',
      tenantId,
      body: JSON.stringify({ pin }),
    }),

  // Accounts Department: Daily OpEx, Net P&L, Receivables & Payables
  getAccountsOverview: (tenantId: string, date?: string) => {
    const qs = date ? `?date=${encodeURIComponent(date)}` : '';
    return authorizedFetch<{ overview: AccountsOverviewResponse; correlationId: string }>(
      `/accounts/overview${qs}`,
      { tenantId }
    );
  },

  recordOperatingExpense: (tenantId: string, payload: RecordOperatingExpenseInput) =>
    authorizedFetch('/accounts/expenses', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  voidOperatingExpense: (tenantId: string, expenseId: string) =>
    authorizedFetch(`/accounts/expenses/${expenseId}/void`, {
      method: 'POST',
      tenantId,
    }),

  createReceivableAccount: (tenantId: string, payload: CreateCreditAccountInput) =>
    authorizedFetch('/accounts/receivables/accounts', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  recordReceivableEntry: (
    tenantId: string,
    accountId: string,
    payload: RecordCreditEntryInput
  ) =>
    authorizedFetch(`/accounts/receivables/accounts/${accountId}/entries`, {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  recordSupplierPayment: (tenantId: string, payload: RecordSupplierPaymentInput) =>
    authorizedFetch('/accounts/payables/payments', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  // Purchasing Department: Purchase Orders & Supplier Debit Notes
  getPurchasingOverview: (tenantId: string) =>
    authorizedFetch<{ overview: PurchasingOverviewResponse; correlationId: string }>(
      '/purchasing/overview',
      { tenantId }
    ),

  createPurchaseOrder: (tenantId: string, payload: CreatePurchaseOrderInput) =>
    authorizedFetch('/purchasing/orders', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  approvePurchaseOrder: (tenantId: string, poId: string) =>
    authorizedFetch(`/purchasing/orders/${poId}/approve`, {
      method: 'POST',
      tenantId,
    }),

  convertPoToGrn: (tenantId: string, poId: string, payload: ConvertPoToGrnInput) =>
    authorizedFetch(`/purchasing/orders/${poId}/convert-to-grn`, {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  createSupplierDebitNote: (tenantId: string, payload: CreateSupplierDebitNoteInput) =>
    authorizedFetch('/purchasing/debit-notes', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  // HR, Payroll & Admin Operations Department
  getHrAdminOverview: (tenantId: string) =>
    authorizedFetch<{ overview: HrAdminOverviewResponse; correlationId: string }>(
      '/hr-admin/overview',
      { tenantId }
    ),

  upsertHrProfile: (tenantId: string, payload: UpsertHrProfileInput) =>
    authorizedFetch('/hr-admin/profiles', {
      method: 'PUT',
      tenantId,
      body: JSON.stringify(payload),
    }),

  clockInStaff: (tenantId: string, payload: { pin?: string; notes?: string }) =>
    authorizedFetch('/hr-admin/attendance/clock-in', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  clockOutStaff: (tenantId: string, payload: { pin?: string; notes?: string }) =>
    authorizedFetch('/hr-admin/attendance/clock-out', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  requestLeave: (tenantId: string, payload: RequestLeaveInput) =>
    authorizedFetch('/hr-admin/leaves', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  reviewLeaveRequest: (
    tenantId: string,
    leaveId: string,
    decision: 'approved' | 'rejected'
  ) =>
    authorizedFetch(`/hr-admin/leaves/${leaveId}/review`, {
      method: 'POST',
      tenantId,
      body: JSON.stringify({ decision }),
    }),

  generateMonthlyPayroll: (tenantId: string, payrollMonth: string) =>
    authorizedFetch('/hr-admin/payroll/generate', {
      method: 'POST',
      tenantId,
      body: JSON.stringify({ payrollMonth }),
    }),

  createLabOrder: (tenantId: string, payload: CreateLabOrderInput) =>
    authorizedFetch('/hr-admin/lab-orders', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  updateLabOrderStatus: (
    tenantId: string,
    orderId: string,
    payload: {
      status: 'ordered' | 'sample_collected' | 'report_ready' | 'cancelled';
      resultSummary?: string;
    }
  ) =>
    authorizedFetch(`/hr-admin/lab-orders/${orderId}`, {
      method: 'PATCH',
      tenantId,
      body: JSON.stringify(payload),
    }),

  recordColdChainTemp: (
    tenantId: string,
    payload: { fridgeName: string; temperatureC: number; notes?: string }
  ) =>
    authorizedFetch('/hr-admin/cold-chain', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  createComplianceLicense: (
    tenantId: string,
    payload: {
      title: string;
      authority: 'NMRA' | 'SLMC' | 'BR' | 'PHI' | 'OTHER';
      licenseNumber: string;
      expiresOn: string;
      alertDaysBefore?: number;
      notes?: string;
    }
  ) =>
    authorizedFetch('/hr-admin/licenses', {
      method: 'POST',
      tenantId,
      body: JSON.stringify(payload),
    }),

  fetchAccountsTaxSummaryCsv: async (tenantId: string, date?: string): Promise<string> => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('Please sign in first.');
    const token = await currentUser.getIdToken(false);
    const qs = date ? `?date=${encodeURIComponent(date)}` : '';
    const res = await fetch(`/api/v1/accounts/tax-summary.csv${qs}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-Id': tenantId,
      },
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error('Unable to download tax summary CSV.');
    }
    return res.text();
  },

  fetchSlipsBankPayrollCsv: async (tenantId: string, month?: string): Promise<string> => {
    const currentUser = auth.currentUser;
    if (!currentUser) throw new Error('Please sign in first.');
    const token = await currentUser.getIdToken(false);
    const qs = month ? `?month=${encodeURIComponent(month)}` : '';
    const res = await fetch(`/api/v1/hr-admin/payroll/slips.csv${qs}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Tenant-Id': tenantId,
      },
      cache: 'no-store',
    });
    if (!res.ok) {
      throw new Error('Unable to download SLIPS payroll CSV.');
    }
    return res.text();
  },

  // 0-to-100 Autopilot, SOP Checklists, Governance & Smart Auto-Reorder
  getAutopilotCockpit: (tenantId: string, date?: string) => {
    const qs = date ? `?date=${encodeURIComponent(date)}` : '';
    return authorizedFetch<{ cockpit: AutopilotCockpitResponse; correlationId: string }>(
      `/autopilot/cockpit${qs}`,
      { tenantId }
    );
  },

  updateGovernanceRules: (tenantId: string, payload: UpdateGovernanceRulesInput) =>
    authorizedFetch<{ rules: WorkspaceGovernanceRuleView; correlationId: string }>(
      '/autopilot/governance',
      {
        method: 'PUT',
        tenantId,
        body: JSON.stringify(payload),
      }
    ),

  toggleChecklistItem: (
    tenantId: string,
    checklistId: string,
    payload: ToggleChecklistItemInput
  ) =>
    authorizedFetch<{ checklist: ShiftChecklistRunView; correlationId: string }>(
      `/autopilot/checklists/${checklistId}/toggle`,
      {
        method: 'POST',
        tenantId,
        body: JSON.stringify(payload),
      }
    ),

  completeChecklist: (
    tenantId: string,
    checklistId: string,
    payload: CompleteShiftChecklistInput
  ) =>
    authorizedFetch<{ checklist: ShiftChecklistRunView; correlationId: string }>(
      `/autopilot/checklists/${checklistId}/complete`,
      {
        method: 'POST',
        tenantId,
        body: JSON.stringify(payload),
      }
    ),

  generateAutoDraftPos: (tenantId: string) =>
    authorizedFetch<{
      createdCount: number;
      purchaseOrders: Array<{
        id: string;
        poNumber: string;
        supplierName: string;
        totalEstimatedMinor: number;
        lineCount: number;
      }>;
      correlationId: string;
    }>('/autopilot/reorders/draft-pos', {
      method: 'POST',
      tenantId,
    }),

  generateOwnerBriefing: (tenantId: string, sendWhatsapp = true) =>
    authorizedFetch<{
      briefing: NonNullable<AutopilotCockpitResponse['latestBriefing']>;
      correlationId: string;
    }>('/autopilot/briefings/generate', {
      method: 'POST',
      tenantId,
      body: JSON.stringify({ sendWhatsapp }),
    }),

  // Unauthenticated Public Patient QR Check-In Kiosk
  getPublicKioskInfo: async (tenantSlug: string): Promise<PublicKioskInfoResponse> => {
    const res = await fetch(`/api/v1/public/kiosk/${encodeURIComponent(tenantSlug)}`, {
      cache: 'no-store',
    });
    const body = await res.json();
    if (!res.ok) {
      throw new ApiClientError(res.status, body as ApiErrorEnvelope);
    }
    return body.kiosk as PublicKioskInfoResponse;
  },

  submitPublicSelfCheckIn: async (
    tenantSlug: string,
    payload: PublicSelfCheckInInput
  ): Promise<PublicSelfCheckInResponse> => {
    const res = await fetch(
      `/api/v1/public/kiosk/${encodeURIComponent(tenantSlug)}/checkin`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      }
    );
    const body = await res.json();
    if (!res.ok) {
      throw new ApiClientError(res.status, body as ApiErrorEnvelope);
    }
    return body.checkin as PublicSelfCheckInResponse;
  },
};

export function formatLkrMinor(amountMinor: number, currency = 'LKR'): string {
  const rupees = amountMinor / 100;
  return `${currency} ${rupees.toLocaleString('en-LK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatTimeColombo(isoTimestamp: string, timezone = 'Asia/Colombo'): string {
  return new Intl.DateTimeFormat('en-LK', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(isoTimestamp));
}

export function todayColomboDate(date = new Date()): string {
  const shifted = new Date(date.getTime() + 330 * 60_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function toColomboDatetimeLocal(date = new Date()): string {
  const shifted = new Date(date.getTime() + 330 * 60_000);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  const hh = String(shifted.getUTCHours()).padStart(2, '0');
  const mm = String(shifted.getUTCMinutes()).padStart(2, '0');
  return `${y}-${m}-${d}T${hh}:${mm}`;
}
