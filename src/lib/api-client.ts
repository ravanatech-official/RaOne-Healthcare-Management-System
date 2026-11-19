import { auth } from './firebase.ts';
import type {
  ApiErrorEnvelope,
  OnboardingBootstrapInput,
  SessionContextResponse,
  SupportedLocale,
  TodaySummaryResponse,
} from '../contracts/api.ts';

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
