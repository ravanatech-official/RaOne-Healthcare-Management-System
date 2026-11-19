import { apiClient } from './api-client.ts';

const CAT_CACHE_PREFIX = 'suwaseva_pos_catalogue_';
const QUEUE_PREFIX = 'suwaseva_pos_offline_queue_';

export interface QueuedPosCheckout {
  queueId: string;
  tenantId: string;
  createdAt: string;
  totalMinor: number;
  summaryLabel: string;
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
  };
}

export function saveOfflineCatalogueSnapshot<T>(tenantId: string, items: T): void {
  try {
    localStorage.setItem(`${CAT_CACHE_PREFIX}${tenantId}`, JSON.stringify(items));
  } catch {
    // Ignore quota storage errors silently
  }
}

export function loadOfflineCatalogueSnapshot<T>(tenantId: string): T | null {
  try {
    const raw = localStorage.getItem(`${CAT_CACHE_PREFIX}${tenantId}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function getOfflinePosQueue(tenantId: string): QueuedPosCheckout[] {
  try {
    const raw = localStorage.getItem(`${QUEUE_PREFIX}${tenantId}`);
    return raw ? (JSON.parse(raw) as QueuedPosCheckout[]) : [];
  } catch {
    return [];
  }
}

export function enqueueOfflinePosSale(tenantId: string, item: QueuedPosCheckout): QueuedPosCheckout[] {
  const existing = getOfflinePosQueue(tenantId);
  const next = [...existing, item];
  try {
    localStorage.setItem(`${QUEUE_PREFIX}${tenantId}`, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
  return next;
}

export function clearOfflinePosQueueItem(tenantId: string, queueId: string): QueuedPosCheckout[] {
  const existing = getOfflinePosQueue(tenantId);
  const next = existing.filter((q) => q.queueId !== queueId);
  try {
    localStorage.setItem(`${QUEUE_PREFIX}${tenantId}`, JSON.stringify(next));
  } catch {
    // ignore
  }
  return next;
}

export async function syncQueuedPosSales(tenantId: string): Promise<{
  synced: number;
  failed: number;
  remaining: QueuedPosCheckout[];
}> {
  const queue = getOfflinePosQueue(tenantId);
  if (queue.length === 0) {
    return { synced: 0, failed: 0, remaining: [] };
  }
  let synced = 0;
  let failed = 0;
  let current = [...queue];
  for (const item of queue) {
    try {
      await apiClient.checkoutPosSale(tenantId, item.payload);
      current = clearOfflinePosQueueItem(tenantId, item.queueId);
      synced += 1;
    } catch {
      failed += 1;
    }
  }
  return { synced, failed, remaining: current };
}
