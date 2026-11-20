import { apiClient } from './api-client.ts';

const CAT_CACHE_PREFIX = 'suwaseva_pos_catalogue_';
const QUEUE_PREFIX = 'suwaseva_pos_offline_queue_';
const IDB_NAME = 'suwaseva_offline_db';
const IDB_STORE = 'kv_store';

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
    managerOverridePin?: string;
    payments: Array<{
      method: 'cash' | 'card' | 'bank';
      amountMinor: number;
      referenceNumber?: string;
    }>;
  };
}

function openOfflineIdb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openOfflineIdb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // Fallback remains active in localStorage
  }
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openOfflineIdb();
  if (!db) return null;
  try {
    return await new Promise<T | null>((resolve) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function hydrateOfflineStoreFromIdb(tenantId: string): Promise<void> {
  const catKey = `${CAT_CACHE_PREFIX}${tenantId}`;
  const queueKey = `${QUEUE_PREFIX}${tenantId}`;
  const [catData, queueData] = await Promise.all([
    idbGet<unknown>(catKey),
    idbGet<QueuedPosCheckout[]>(queueKey),
  ]);
  try {
    if (catData && !localStorage.getItem(catKey)) {
      localStorage.setItem(catKey, JSON.stringify(catData));
    }
    if (Array.isArray(queueData) && queueData.length > 0 && !localStorage.getItem(queueKey)) {
      localStorage.setItem(queueKey, JSON.stringify(queueData));
    }
  } catch {
    // Ignore localStorage quota overflow; IndexedDB retains full snapshot
  }
}

export function saveOfflineCatalogueSnapshot<T>(tenantId: string, items: T): void {
  const key = `${CAT_CACHE_PREFIX}${tenantId}`;
  void idbSet(key, items);
  try {
    localStorage.setItem(key, JSON.stringify(items));
  } catch {
    // IndexedDB persists larger catalogues even if localStorage exceeds quota
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
  const key = `${QUEUE_PREFIX}${tenantId}`;
  void idbSet(key, next);
  try {
    localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // IndexedDB still keeps queue
  }
  return next;
}

export function clearOfflinePosQueueItem(tenantId: string, queueId: string): QueuedPosCheckout[] {
  const existing = getOfflinePosQueue(tenantId);
  const next = existing.filter((q) => q.queueId !== queueId);
  const key = `${QUEUE_PREFIX}${tenantId}`;
  void idbSet(key, next);
  try {
    localStorage.setItem(key, JSON.stringify(next));
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
  await hydrateOfflineStoreFromIdb(tenantId);
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
