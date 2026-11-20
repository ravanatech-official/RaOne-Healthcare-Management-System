import crypto from 'node:crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, isDatabaseConfigured } from '../db/index.ts';
import {
  appointments,
  auditEvents,
  branches,
  costLayers,
  dispenseOrderLines,
  dispenseOrders,
  inventoryBalances,
  lots,
  operatingExpenses,
  packVariants,
  payments,
  people,
  posPayments,
  posReturns,
  posSaleAllocations,
  posSales,
  products,
  stockMovements,
  stocktakeLines,
  stocktakes,
  stockTransferLines,
  stockTransfers,
  storageLocations,
  supplierInvoices,
  tillShifts,
} from '../db/schema.ts';
import type {
  CombinedZReportResponse,
  CreateDispenseOrderInput,
  CreateStockTransferInput,
  StockAlertsDashboardResponse,
} from '../contracts/pharmacy.ts';
import { assertProfessionalGrant } from './capabilities.ts';
import { getDoctorPayoutReport } from './clinic-ops.ts';
import { ConflictError, NotFoundError, ValidationError } from './errors.ts';
import { addMemAuditEvent, getMemoryStore } from './memory-store.ts';
import { getStockAndLotSummary } from './pharmacy-inventory.ts';
import { assertWorkspaceNotReadOnlyGrace } from './subscription-billing.ts';
import {
  assertCapability,
  assertPermission,
  getBusinessDateInTimezone,
  type ActiveWorkspaceContext,
} from './tenancy.ts';

function diffDays(fromDate: string, toDate: string): number {
  const a = new Date(`${fromDate}T00:00:00Z`).getTime();
  const b = new Date(`${toDate}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

// ---------------------------------------------------------------------------
// 1. Near-Expiry (30/60/90d), Low-Stock & Dead-Stock Alerts Dashboard
// ---------------------------------------------------------------------------
export async function getPharmacyAlertsDashboard(
  context: ActiveWorkspaceContext
): Promise<StockAlertsDashboardResponse> {
  assertCapability(context, 'pharmacy.inventory');
  assertPermission(context, 'pharmacy.stock.read');

  const businessDate = getBusinessDateInTimezone(context.timezone);
  const { balances, recentMovements } = await getStockAndLotSummary(context);

  const expiringLots: StockAlertsDashboardResponse['expiringLots'] = [];
  const skuTotalMap = new Map<
    string,
    {
      productId: string;
      skuCode: string;
      productName: string;
      manufacturer: string;
      baseUnit: string;
      sellableOnHand: number;
    }
  >();

  let expiredCount = 0;
  let expiring30Count = 0;
  let expiring60Count = 0;
  let expiring90Count = 0;

  for (const b of balances) {
    const agg = skuTotalMap.get(b.productId) ?? {
      productId: b.productId,
      skuCode: b.skuCode,
      productName: b.productName,
      manufacturer: b.manufacturer,
      baseUnit: b.baseUnit,
      sellableOnHand: 0,
    };
    agg.sellableOnHand += b.sellableOnHand;
    skuTotalMap.set(b.productId, agg);

    if (b.sellableOnHand <= 0 || !b.expiryCutoffDate) continue;
    const daysUntil = diffDays(businessDate, b.expiryCutoffDate);
    let bucket: 'expired' | 'within_30d' | 'within_60d' | 'within_90d' | null = null;
    if (daysUntil < 0) {
      bucket = 'expired';
      expiredCount += 1;
    } else if (daysUntil <= 30) {
      bucket = 'within_30d';
      expiring30Count += 1;
    } else if (daysUntil <= 60) {
      bucket = 'within_60d';
      expiring60Count += 1;
    } else if (daysUntil <= 90) {
      bucket = 'within_90d';
      expiring90Count += 1;
    }

    if (bucket) {
      expiringLots.push({
        lotId: b.lotId,
        productId: b.productId,
        productName: b.productName,
        skuCode: b.skuCode,
        batchNumber: b.batchNumber,
        manufacturer: b.manufacturer,
        printedExpiry: b.printedExpiry,
        expiryCutoffDate: b.expiryCutoffDate,
        daysUntilExpiry: daysUntil,
        bucket,
        sellableOnHand: b.sellableOnHand,
        baseUnit: b.baseUnit,
        suggestedAction:
          bucket === 'expired'
            ? 'Move to quarantine immediately & dispose'
            : bucket === 'within_30d'
              ? 'Request supplier credit return or prioritize FEFO dispensing'
              : 'Monitor weekly FEFO rotation',
      });
    }
  }

  expiringLots.sort((a, b) => (a.daysUntilExpiry ?? 999) - (b.daysUntilExpiry ?? 999));

  const productParMap = new Map<string, { reorder: number; targetPar: number }>();
  if (!isDatabaseConfigured) {
    for (const p of getMemoryStore().products.filter((x) => x.tenantId === context.tenantId)) {
      productParMap.set(p.id, {
        reorder: p.reorderPointBase ?? 50,
        targetPar: p.targetParBase ?? 200,
      });
    }
  } else {
    const pRows = await db
      .select({
        id: products.id,
        reorderPointBase: products.reorderPointBase,
        targetParBase: products.targetParBase,
      })
      .from(products)
      .where(eq(products.tenantId, context.tenantId));
    for (const p of pRows) {
      productParMap.set(p.id, {
        reorder: p.reorderPointBase ?? 50,
        targetPar: p.targetParBase ?? 200,
      });
    }
  }

  const DEFAULT_REORDER_THRESHOLD = 50;
  const lowStockSkus: StockAlertsDashboardResponse['lowStockSkus'] = [];
  const deadStockSkus: StockAlertsDashboardResponse['deadStockSkus'] = [];

  const lastSaleByProduct = new Map<string, Date>();
  for (const m of recentMovements) {
    if (m.movementType === 'pos_sale' || m.movementType === 'grn_receipt') {
      const dt = new Date(m.occurredAt);
      const prev = lastSaleByProduct.get(m.productId);
      if (!prev || dt > prev) lastSaleByProduct.set(m.productId, dt);
    }
  }

  for (const sku of skuTotalMap.values()) {
    const par = productParMap.get(sku.productId);
    const threshold = par?.reorder ?? DEFAULT_REORDER_THRESHOLD;
    const targetPar = par?.targetPar ?? Math.max(threshold * 2, 100);
    if (sku.sellableOnHand < threshold) {
      lowStockSkus.push({
        productId: sku.productId,
        skuCode: sku.skuCode,
        productName: sku.productName,
        manufacturer: sku.manufacturer,
        sellableOnHand: sku.sellableOnHand,
        reorderThreshold: threshold,
        baseUnit: sku.baseUnit,
        suggestedOrderQty: Math.max(targetPar - sku.sellableOnHand, 50),
      });
    }

    const lastMov = lastSaleByProduct.get(sku.productId);
    if (lastMov) {
      const daysSince = Math.floor((Date.now() - lastMov.getTime()) / 86_400_000);
      if (daysSince >= 60 && sku.sellableOnHand > 0) {
        deadStockSkus.push({
          productId: sku.productId,
          skuCode: sku.skuCode,
          productName: sku.productName,
          sellableOnHand: sku.sellableOnHand,
          baseUnit: sku.baseUnit,
          daysSinceMovement: daysSince,
          suggestion: 'No movement in 60+ days — negotiate supplier return / exchange',
        });
      }
    }
  }

  return {
    businessDate,
    summary: {
      expiredCount,
      expiring30Count,
      expiring60Count,
      expiring90Count,
      lowStockCount: lowStockSkus.length,
      deadStockCount: deadStockSkus.length,
    },
    expiringLots,
    lowStockSkus,
    deadStockSkus,
  };
}

// ---------------------------------------------------------------------------
// 2. Physical Stocktake & Variance Reconciliation
// ---------------------------------------------------------------------------
export async function listStocktakes(context: ActiveWorkspaceContext) {
  assertCapability(context, 'pharmacy.inventory');
  assertPermission(context, 'pharmacy.stock.read');

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    return store.stocktakes
      .filter((s) => s.tenantId === context.tenantId && s.branchId === context.branchId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((s) => ({
        ...s,
        lines: store.stocktakeLines
          .filter((l) => l.stocktakeId === s.id)
          .map((l) => ({
            ...l,
            productName: store.products.find((p) => p.id === l.productId)?.displayName ?? 'Product',
            batchNumber: store.lots.find((lot) => lot.id === l.lotId)?.batchNumber ?? '',
            locationName:
              store.storageLocations.find((loc) => loc.id === l.locationId)?.name ?? 'Shelf',
          })),
      }));
  }

  const headers = await db
    .select()
    .from(stocktakes)
    .where(and(eq(stocktakes.tenantId, context.tenantId), eq(stocktakes.branchId, context.branchId)))
    .orderBy(desc(stocktakes.createdAt))
    .limit(20);

  const result = [];
  for (const h of headers) {
    const lines = await db
      .select({
        id: stocktakeLines.id,
        stocktakeId: stocktakeLines.stocktakeId,
        productId: stocktakeLines.productId,
        productName: products.displayName,
        lotId: stocktakeLines.lotId,
        batchNumber: lots.batchNumber,
        locationId: stocktakeLines.locationId,
        locationName: storageLocations.name,
        systemQtyBase: stocktakeLines.systemQtyBase,
        countedQtyBase: stocktakeLines.countedQtyBase,
        varianceQtyBase: stocktakeLines.varianceQtyBase,
        reason: stocktakeLines.reason,
      })
      .from(stocktakeLines)
      .innerJoin(products, eq(stocktakeLines.productId, products.id))
      .innerJoin(lots, eq(stocktakeLines.lotId, lots.id))
      .innerJoin(storageLocations, eq(stocktakeLines.locationId, storageLocations.id))
      .where(eq(stocktakeLines.stocktakeId, h.id));

    result.push({ ...h, lines });
  }
  return result;
}

export async function createStocktake(
  context: ActiveWorkspaceContext,
  notes: string,
  correlationId: string
) {
  assertCapability(context, 'pharmacy.inventory');
  assertPermission(context, 'pharmacy.receiving.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const businessDate = getBusinessDateInTimezone(context.timezone);
  const stocktakeNumber = `STK-${businessDate.replace(/-/g, '')}-${crypto
    .randomBytes(2)
    .toString('hex')
    .toUpperCase()}`;

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const balances = store.inventoryBalances.filter(
      (b) =>
        b.tenantId === context.tenantId &&
        b.branchId === context.branchId &&
        b.sellableOnHand > 0
    );
    if (balances.length === 0) {
      throw new ValidationError('No sellable inventory balances found to start stocktake');
    }

    const header = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      stocktakeNumber,
      notes: notes.trim(),
      status: 'open' as const,
      createdByUserId: context.userId,
      reconciledByUserId: null,
      reconciledAt: null,
      createdAt: new Date(),
    };
    store.stocktakes.unshift(header);

    const lines = balances.map((b) => {
      const line = {
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        stocktakeId: header.id,
        productId: b.productId,
        lotId: b.lotId,
        locationId: b.locationId,
        systemQtyBase: b.sellableOnHand,
        countedQtyBase: b.sellableOnHand,
        varianceQtyBase: 0,
        reason: '',
        createdAt: new Date(),
      };
      store.stocktakeLines.push(line);
      return line;
    });

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.stocktake_started',
      entityType: 'stocktake',
      entityId: header.id,
      correlationId,
      metadataJson: { stocktakeNumber, lineCount: lines.length },
    });

    return { stocktake: header, lineCount: lines.length };
  }

  return db.transaction(async (tx) => {
    const balances = await tx
      .select()
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, context.tenantId),
          eq(inventoryBalances.branchId, context.branchId)
        )
      );
    const activeBalances = balances.filter((b) => b.sellableOnHand > 0);
    if (activeBalances.length === 0) {
      throw new ValidationError('No sellable inventory balances found to start stocktake');
    }

    const [header] = await tx
      .insert(stocktakes)
      .values({
        tenantId: context.tenantId,
        branchId: context.branchId,
        stocktakeNumber,
        notes: notes.trim(),
        status: 'open',
        createdByUserId: context.userId,
      })
      .returning();

    await tx.insert(stocktakeLines).values(
      activeBalances.map((b) => ({
        tenantId: context.tenantId,
        stocktakeId: header.id,
        productId: b.productId,
        lotId: b.lotId,
        locationId: b.locationId,
        systemQtyBase: b.sellableOnHand,
        countedQtyBase: b.sellableOnHand,
        varianceQtyBase: 0,
      }))
    );

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.stocktake_started',
      entityType: 'stocktake',
      entityId: header.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: { stocktakeNumber, lineCount: activeBalances.length },
    });

    return { stocktake: header, lineCount: activeBalances.length };
  });
}

export async function submitStocktakeCounts(
  context: ActiveWorkspaceContext,
  stocktakeId: string,
  input: { counts: Array<{ lineId: string; countedQtyBase: number; reason?: string }> },
  correlationId: string
) {
  assertCapability(context, 'pharmacy.inventory');
  assertPermission(context, 'pharmacy.receiving.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const header = store.stocktakes.find(
      (s) => s.id === stocktakeId && s.tenantId === context.tenantId && s.branchId === context.branchId
    );
    if (!header) throw new NotFoundError('Stocktake not found');
    if (header.status !== 'open') throw new ConflictError('Stocktake is already reconciled');

    for (const c of input.counts) {
      const line = store.stocktakeLines.find(
        (l) => l.id === c.lineId && l.stocktakeId === stocktakeId
      );
      if (line) {
        line.countedQtyBase = c.countedQtyBase;
        line.varianceQtyBase = c.countedQtyBase - line.systemQtyBase;
        if (c.reason !== undefined) line.reason = c.reason.trim();
      }
    }

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.stocktake_counts_submitted',
      entityType: 'stocktake',
      entityId: stocktakeId,
      correlationId,
      metadataJson: { updatedLines: input.counts.length },
    });

    return { stocktakeId, updatedLines: input.counts.length };
  }

  return db.transaction(async (tx) => {
    const [header] = await tx
      .select()
      .from(stocktakes)
      .where(and(eq(stocktakes.id, stocktakeId), eq(stocktakes.tenantId, context.tenantId)))
      .limit(1);
    if (!header) throw new NotFoundError('Stocktake not found');
    if (header.status !== 'open') throw new ConflictError('Stocktake is already reconciled');

    for (const c of input.counts) {
      const [line] = await tx
        .select()
        .from(stocktakeLines)
        .where(and(eq(stocktakeLines.id, c.lineId), eq(stocktakeLines.stocktakeId, stocktakeId)))
        .limit(1);
      if (line) {
        await tx
          .update(stocktakeLines)
          .set({
            countedQtyBase: c.countedQtyBase,
            varianceQtyBase: c.countedQtyBase - line.systemQtyBase,
            reason: c.reason !== undefined ? c.reason.trim() : line.reason,
          })
          .where(eq(stocktakeLines.id, line.id));
      }
    }
    return { stocktakeId, updatedLines: input.counts.length };
  });
}

export async function reconcileStocktake(
  context: ActiveWorkspaceContext,
  stocktakeId: string,
  correlationId: string
) {
  assertCapability(context, 'pharmacy.inventory');
  assertPermission(context, 'pharmacy.receiving.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const now = new Date();

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const header = store.stocktakes.find(
      (s) => s.id === stocktakeId && s.tenantId === context.tenantId && s.branchId === context.branchId
    );
    if (!header) throw new NotFoundError('Stocktake not found');
    if (header.status === 'reconciled') throw new ConflictError('Stocktake already reconciled');

    const lines = store.stocktakeLines.filter((l) => l.stocktakeId === stocktakeId);
    let adjustedCount = 0;
    for (const line of lines) {
      if (line.varianceQtyBase === 0) continue;
      const bal = store.inventoryBalances.find(
        (b) =>
          b.tenantId === context.tenantId &&
          b.branchId === context.branchId &&
          b.locationId === line.locationId &&
          b.productId === line.productId &&
          b.lotId === line.lotId
      );
      if (bal) {
        const nextQty = Math.max(0, bal.sellableOnHand + line.varianceQtyBase);
        const delta = nextQty - bal.sellableOnHand;
        bal.sellableOnHand = nextQty;
        bal.version += 1;
        bal.updatedAt = now;
        if (delta !== 0) {
          store.stockMovements.push({
            id: crypto.randomUUID(),
            tenantId: context.tenantId,
            branchId: context.branchId,
            locationId: line.locationId,
            productId: line.productId,
            lotId: line.lotId,
            costLayerId: null,
            movementType: 'stocktake_adjustment',
            qtyBase: Math.abs(delta),
            fromBucket: delta < 0 ? 'sellable' : 'adjustment',
            toBucket: delta > 0 ? 'sellable' : 'adjustment',
            reason: line.reason || `Stocktake ${header.stocktakeNumber} reconciliation`,
            sourceDocType: 'stocktake',
            sourceDocId: header.id,
            commandId: null,
            packVariantId: null,
            uomConversionVersion: null,
            actorUserId: context.userId,
            occurredAt: now,
            createdAt: now,
          });
          adjustedCount += 1;
        }
      }
    }

    header.status = 'reconciled';
    header.reconciledByUserId = context.userId;
    header.reconciledAt = now;

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.stocktake_reconciled',
      entityType: 'stocktake',
      entityId: header.id,
      correlationId,
      metadataJson: { stocktakeNumber: header.stocktakeNumber, adjustedCount },
    });

    return { stocktake: header, adjustedCount };
  }

  return db.transaction(async (tx) => {
    const [header] = await tx
      .select()
      .from(stocktakes)
      .where(and(eq(stocktakes.id, stocktakeId), eq(stocktakes.tenantId, context.tenantId)))
      .limit(1);
    if (!header) throw new NotFoundError('Stocktake not found');
    if (header.status === 'reconciled') throw new ConflictError('Stocktake already reconciled');

    const lines = await tx
      .select()
      .from(stocktakeLines)
      .where(eq(stocktakeLines.stocktakeId, stocktakeId));

    let adjustedCount = 0;
    for (const line of lines) {
      if (line.varianceQtyBase === 0) continue;
      const [bal] = await tx
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, context.tenantId),
            eq(inventoryBalances.branchId, context.branchId),
            eq(inventoryBalances.locationId, line.locationId),
            eq(inventoryBalances.productId, line.productId),
            eq(inventoryBalances.lotId, line.lotId)
          )
        )
        .limit(1);
      if (bal) {
        const nextQty = Math.max(0, bal.sellableOnHand + line.varianceQtyBase);
        const delta = nextQty - bal.sellableOnHand;
        await tx
          .update(inventoryBalances)
          .set({
            sellableOnHand: nextQty,
            version: sql`${inventoryBalances.version} + 1`,
            updatedAt: now,
          })
          .where(eq(inventoryBalances.id, bal.id));

        if (delta !== 0) {
          await tx.insert(stockMovements).values({
            tenantId: context.tenantId,
            branchId: context.branchId,
            locationId: line.locationId,
            productId: line.productId,
            lotId: line.lotId,
            movementType: 'stocktake_adjustment',
            qtyBase: Math.abs(delta),
            fromBucket: delta < 0 ? 'sellable' : 'adjustment',
            toBucket: delta > 0 ? 'sellable' : 'adjustment',
            reason: line.reason || `Stocktake ${header.stocktakeNumber} reconciliation`,
            sourceDocType: 'stocktake',
            sourceDocId: header.id,
            actorUserId: context.userId,
          });
          adjustedCount += 1;
        }
      }
    }

    const [updated] = await tx
      .update(stocktakes)
      .set({
        status: 'reconciled',
        reconciledByUserId: context.userId,
        reconciledAt: now,
      })
      .where(eq(stocktakes.id, header.id))
      .returning();

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.stocktake_reconciled',
      entityType: 'stocktake',
      entityId: header.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: { stocktakeNumber: header.stocktakeNumber, adjustedCount },
    });

    return { stocktake: updated, adjustedCount };
  });
}

// ---------------------------------------------------------------------------
// 3. Multi-Branch Stock Transfers (Quarantine-Safe Receiving)
// ---------------------------------------------------------------------------
export async function listStockTransfers(context: ActiveWorkspaceContext) {
  assertCapability(context, 'pharmacy.inventory');
  assertPermission(context, 'pharmacy.stock.read');

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    return store.stockTransfers
      .filter((t) => t.tenantId === context.tenantId)
      .sort((a, b) => b.dispatchedAt.getTime() - a.dispatchedAt.getTime())
      .map((t) => ({
        ...t,
        fromBranchName: store.branches.find((b) => b.id === t.fromBranchId)?.name ?? 'Source Branch',
        toBranchName: store.branches.find((b) => b.id === t.toBranchId)?.name ?? 'Target Branch',
        lines: store.stockTransferLines
          .filter((l) => l.transferId === t.id)
          .map((l) => ({
            ...l,
            productName: store.products.find((p) => p.id === l.productId)?.displayName ?? 'Product',
            batchNumber: store.lots.find((lot) => lot.id === l.lotId)?.batchNumber ?? '',
          })),
      }));
  }

  const rows = await db
    .select()
    .from(stockTransfers)
    .where(eq(stockTransfers.tenantId, context.tenantId))
    .orderBy(desc(stockTransfers.dispatchedAt))
    .limit(30);

  const branchRows = await db
    .select({ id: branches.id, name: branches.name })
    .from(branches)
    .where(eq(branches.tenantId, context.tenantId));
  const branchMap = new Map(branchRows.map((b) => [b.id, b.name]));

  const result = [];
  for (const t of rows) {
    const lines = await db
      .select({
        id: stockTransferLines.id,
        transferId: stockTransferLines.transferId,
        productId: stockTransferLines.productId,
        productName: products.displayName,
        lotId: stockTransferLines.lotId,
        batchNumber: lots.batchNumber,
        qtyBase: stockTransferLines.qtyBase,
        receivedIntoQuarantine: stockTransferLines.receivedIntoQuarantine,
      })
      .from(stockTransferLines)
      .innerJoin(products, eq(stockTransferLines.productId, products.id))
      .innerJoin(lots, eq(stockTransferLines.lotId, lots.id))
      .where(eq(stockTransferLines.transferId, t.id));

    result.push({
      ...t,
      fromBranchName: branchMap.get(t.fromBranchId) ?? 'Source Branch',
      toBranchName: branchMap.get(t.toBranchId) ?? 'Target Branch',
      lines,
    });
  }
  return result;
}

export async function createStockTransfer(
  context: ActiveWorkspaceContext,
  input: CreateStockTransferInput,
  correlationId: string
) {
  assertCapability(context, 'pharmacy.inventory');
  assertPermission(context, 'pharmacy.receiving.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (input.toBranchId === context.branchId) {
    throw new ValidationError('Destination branch must differ from source branch');
  }

  const businessDate = getBusinessDateInTimezone(context.timezone);
  const transferNumber = `TRF-${businessDate.replace(/-/g, '')}-${crypto
    .randomBytes(2)
    .toString('hex')
    .toUpperCase()}`;
  const now = new Date();

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const targetBranch = store.branches.find(
      (b) => b.tenantId === context.tenantId && b.id === input.toBranchId && b.active
    );
    if (!targetBranch) throw new NotFoundError('Destination branch not found');

    const header = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      transferNumber,
      fromBranchId: context.branchId,
      toBranchId: input.toBranchId,
      status: 'dispatched' as const,
      notes: input.notes.trim(),
      dispatchedByUserId: context.userId,
      receivedByUserId: null,
      dispatchedAt: now,
      receivedAt: null,
    };

    for (const line of input.lines) {
      const bal = store.inventoryBalances.find(
        (b) =>
          b.tenantId === context.tenantId &&
          b.branchId === context.branchId &&
          b.productId === line.productId &&
          b.lotId === line.lotId &&
          b.sellableOnHand - b.reservedQty >= line.qtyBase
      );
      if (!bal) {
        throw new ConflictError('Insufficient sellable stock on source branch for transfer');
      }
      bal.sellableOnHand -= line.qtyBase;
      bal.version += 1;
      bal.updatedAt = now;

      store.stockTransferLines.push({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        transferId: header.id,
        productId: line.productId,
        lotId: line.lotId,
        qtyBase: line.qtyBase,
        receivedIntoQuarantine: true,
        createdAt: now,
      });

      store.stockMovements.push({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        branchId: context.branchId,
        locationId: bal.locationId,
        productId: line.productId,
        lotId: line.lotId,
        costLayerId: null,
        movementType: 'transfer_out',
        qtyBase: line.qtyBase,
        fromBucket: 'sellable',
        toBucket: 'in_transit',
        reason: `Transfer ${transferNumber} to ${targetBranch.name}`,
        sourceDocType: 'stock_transfer',
        sourceDocId: header.id,
        commandId: null,
        packVariantId: null,
        uomConversionVersion: null,
        actorUserId: context.userId,
        occurredAt: now,
        createdAt: now,
      });
    }

    store.stockTransfers.unshift(header);
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.stock_transfer_dispatched',
      entityType: 'stock_transfer',
      entityId: header.id,
      correlationId,
      metadataJson: { transferNumber, toBranchId: input.toBranchId },
    });

    return { transfer: header };
  }

  return db.transaction(async (tx) => {
    const [targetBranch] = await tx
      .select()
      .from(branches)
      .where(
        and(
          eq(branches.tenantId, context.tenantId),
          eq(branches.id, input.toBranchId),
          eq(branches.active, true)
        )
      )
      .limit(1);
    if (!targetBranch) throw new NotFoundError('Destination branch not found');

    const [header] = await tx
      .insert(stockTransfers)
      .values({
        tenantId: context.tenantId,
        transferNumber,
        fromBranchId: context.branchId,
        toBranchId: input.toBranchId,
        status: 'dispatched',
        notes: input.notes.trim(),
        dispatchedByUserId: context.userId,
      })
      .returning();

    for (const line of input.lines) {
      const balances = await tx
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, context.tenantId),
            eq(inventoryBalances.branchId, context.branchId),
            eq(inventoryBalances.productId, line.productId),
            eq(inventoryBalances.lotId, line.lotId)
          )
        );
      const bal = balances.find((b) => b.sellableOnHand - b.reservedQty >= line.qtyBase);
      if (!bal) {
        throw new ConflictError('Insufficient sellable stock on source branch for transfer');
      }

      await tx
        .update(inventoryBalances)
        .set({
          sellableOnHand: sql`${inventoryBalances.sellableOnHand} - ${line.qtyBase}`,
          version: sql`${inventoryBalances.version} + 1`,
          updatedAt: now,
        })
        .where(eq(inventoryBalances.id, bal.id));

      await tx.insert(stockTransferLines).values({
        tenantId: context.tenantId,
        transferId: header.id,
        productId: line.productId,
        lotId: line.lotId,
        qtyBase: line.qtyBase,
        receivedIntoQuarantine: true,
      });

      await tx.insert(stockMovements).values({
        tenantId: context.tenantId,
        branchId: context.branchId,
        locationId: bal.locationId,
        productId: line.productId,
        lotId: line.lotId,
        movementType: 'transfer_out',
        qtyBase: line.qtyBase,
        fromBucket: 'sellable',
        toBucket: 'in_transit',
        reason: `Transfer ${transferNumber} to ${targetBranch.name}`,
        sourceDocType: 'stock_transfer',
        sourceDocId: header.id,
        actorUserId: context.userId,
      });
    }

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.stock_transfer_dispatched',
      entityType: 'stock_transfer',
      entityId: header.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: { transferNumber, toBranchId: input.toBranchId },
    });

    return { transfer: header };
  });
}

export async function receiveStockTransfer(
  context: ActiveWorkspaceContext,
  transferId: string,
  input: { receiveIntoSellable: boolean; notes?: string },
  correlationId: string
) {
  assertCapability(context, 'pharmacy.inventory');
  assertPermission(context, 'pharmacy.receiving.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  let pharmacistGrantId: string | null = null;
  if (input.receiveIntoSellable) {
    const grant = await assertProfessionalGrant(context, 'pharmacist');
    pharmacistGrantId = grant.id;
  }

  const now = new Date();

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const transfer = store.stockTransfers.find(
      (t) => t.id === transferId && t.tenantId === context.tenantId
    );
    if (!transfer) throw new NotFoundError('Stock transfer not found');
    if (transfer.status === 'received') throw new ConflictError('Stock transfer already received');

    const lines = store.stockTransferLines.filter((l) => l.transferId === transfer.id);
    const destBranchId = transfer.toBranchId;
    const quarantineLoc =
      store.storageLocations.find(
        (l) =>
          l.tenantId === context.tenantId &&
          l.branchId === destBranchId &&
          l.locationType === 'quarantine'
      ) ??
      store.storageLocations.find(
        (l) => l.tenantId === context.tenantId && l.branchId === destBranchId
      );
    const dispensaryLoc =
      store.storageLocations.find(
        (l) =>
          l.tenantId === context.tenantId &&
          l.branchId === destBranchId &&
          l.locationType === 'dispensary'
      ) ?? quarantineLoc;

    const targetLoc = input.receiveIntoSellable ? dispensaryLoc : quarantineLoc;
    if (!targetLoc) throw new NotFoundError('Destination branch storage location missing');

    for (const line of lines) {
      const srcLot = store.lots.find((l) => l.id === line.lotId);
      if (!srcLot) continue;

      let destLot = store.lots.find(
        (l) =>
          l.tenantId === context.tenantId &&
          l.branchId === destBranchId &&
          l.productId === srcLot.productId &&
          l.manufacturer === srcLot.manufacturer &&
          l.batchNumber === srcLot.batchNumber
      );

      if (!destLot) {
        destLot = {
          id: crypto.randomUUID(),
          tenantId: context.tenantId,
          branchId: destBranchId,
          productId: srcLot.productId,
          manufacturer: srcLot.manufacturer,
          batchNumber: srcLot.batchNumber,
          printedExpiry: srcLot.printedExpiry,
          expiryPrecision: srcLot.expiryPrecision,
          expiryCutoffDate: srcLot.expiryCutoffDate,
          qualityStatus: input.receiveIntoSellable ? 'released' : 'quarantine',
          quarantineReason: input.receiveIntoSellable
            ? ''
            : `Inter-branch transfer ${transfer.transferNumber} pending inspection`,
          releasedByGrantId: pharmacistGrantId,
          releasedAt: input.receiveIntoSellable ? now : null,
          createdAt: now,
          updatedAt: now,
        };
        store.lots.push(destLot);
      }

      let destBal = store.inventoryBalances.find(
        (b) =>
          b.tenantId === context.tenantId &&
          b.branchId === destBranchId &&
          b.locationId === targetLoc.id &&
          b.productId === line.productId &&
          b.lotId === destLot!.id
      );

      if (!destBal) {
        destBal = {
          id: crypto.randomUUID(),
          tenantId: context.tenantId,
          branchId: destBranchId,
          locationId: targetLoc.id,
          productId: line.productId,
          lotId: destLot.id,
          sellableOnHand: input.receiveIntoSellable ? line.qtyBase : 0,
          reservedQty: 0,
          quarantineQty: input.receiveIntoSellable ? 0 : line.qtyBase,
          returnedQuarantineQty: 0,
          damagedQty: 0,
          expiredQty: 0,
          recalledQty: 0,
          disposedQty: 0,
          version: 1,
          updatedAt: now,
        };
        store.inventoryBalances.push(destBal);
      } else {
        if (input.receiveIntoSellable) destBal.sellableOnHand += line.qtyBase;
        else destBal.quarantineQty += line.qtyBase;
        destBal.version += 1;
        destBal.updatedAt = now;
      }

      line.receivedIntoQuarantine = !input.receiveIntoSellable;
      store.stockMovements.push({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        branchId: destBranchId,
        locationId: targetLoc.id,
        productId: line.productId,
        lotId: destLot.id,
        costLayerId: null,
        movementType: 'transfer_in',
        qtyBase: line.qtyBase,
        fromBucket: 'in_transit',
        toBucket: input.receiveIntoSellable ? 'sellable' : 'quarantine',
        reason: input.notes || `Received transfer ${transfer.transferNumber}`,
        sourceDocType: 'stock_transfer',
        sourceDocId: transfer.id,
        commandId: null,
        packVariantId: null,
        uomConversionVersion: null,
        actorUserId: context.userId,
        occurredAt: now,
        createdAt: now,
      });
    }

    transfer.status = 'received';
    transfer.receivedByUserId = context.userId;
    transfer.receivedAt = now;

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.stock_transfer_received',
      entityType: 'stock_transfer',
      entityId: transfer.id,
      correlationId,
      metadataJson: {
        transferNumber: transfer.transferNumber,
        receivedIntoQuarantine: !input.receiveIntoSellable,
      },
    });

    return { transfer, receivedIntoQuarantine: !input.receiveIntoSellable };
  }

  return db.transaction(async (tx) => {
    const [transfer] = await tx
      .select()
      .from(stockTransfers)
      .where(and(eq(stockTransfers.id, transferId), eq(stockTransfers.tenantId, context.tenantId)))
      .limit(1);
    if (!transfer) throw new NotFoundError('Stock transfer not found');
    if (transfer.status === 'received') throw new ConflictError('Stock transfer already received');

    const lines = await tx
      .select()
      .from(stockTransferLines)
      .where(eq(stockTransferLines.transferId, transfer.id));

    const locs = await tx
      .select()
      .from(storageLocations)
      .where(
        and(
          eq(storageLocations.tenantId, context.tenantId),
          eq(storageLocations.branchId, transfer.toBranchId)
        )
      );
    const targetLoc = input.receiveIntoSellable
      ? locs.find((l) => l.locationType === 'dispensary') ?? locs[0]
      : locs.find((l) => l.locationType === 'quarantine') ?? locs[0];

    if (!targetLoc) throw new NotFoundError('Destination branch storage location missing');

    for (const line of lines) {
      const [srcLot] = await tx.select().from(lots).where(eq(lots.id, line.lotId)).limit(1);
      if (!srcLot) continue;

      let [destLot] = await tx
        .select()
        .from(lots)
        .where(
          and(
            eq(lots.tenantId, context.tenantId),
            eq(lots.branchId, transfer.toBranchId),
            eq(lots.productId, srcLot.productId),
            eq(lots.manufacturer, srcLot.manufacturer),
            eq(lots.batchNumber, srcLot.batchNumber)
          )
        )
        .limit(1);

      if (!destLot) {
        [destLot] = await tx
          .insert(lots)
          .values({
            tenantId: context.tenantId,
            branchId: transfer.toBranchId,
            productId: srcLot.productId,
            manufacturer: srcLot.manufacturer,
            batchNumber: srcLot.batchNumber,
            printedExpiry: srcLot.printedExpiry,
            expiryPrecision: srcLot.expiryPrecision,
            expiryCutoffDate: srcLot.expiryCutoffDate,
            qualityStatus: input.receiveIntoSellable ? 'released' : 'quarantine',
            quarantineReason: input.receiveIntoSellable
              ? ''
              : `Inter-branch transfer ${transfer.transferNumber} pending inspection`,
            releasedByGrantId: pharmacistGrantId,
            releasedAt: input.receiveIntoSellable ? now : null,
          })
          .returning();
      }

      const [existingBal] = await tx
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, context.tenantId),
            eq(inventoryBalances.branchId, transfer.toBranchId),
            eq(inventoryBalances.locationId, targetLoc.id),
            eq(inventoryBalances.productId, line.productId),
            eq(inventoryBalances.lotId, destLot.id)
          )
        )
        .limit(1);

      if (!existingBal) {
        await tx.insert(inventoryBalances).values({
          tenantId: context.tenantId,
          branchId: transfer.toBranchId,
          locationId: targetLoc.id,
          productId: line.productId,
          lotId: destLot.id,
          sellableOnHand: input.receiveIntoSellable ? line.qtyBase : 0,
          quarantineQty: input.receiveIntoSellable ? 0 : line.qtyBase,
        });
      } else {
        await tx
          .update(inventoryBalances)
          .set({
            ...(input.receiveIntoSellable
              ? { sellableOnHand: sql`${inventoryBalances.sellableOnHand} + ${line.qtyBase}` }
              : { quarantineQty: sql`${inventoryBalances.quarantineQty} + ${line.qtyBase}` }),
            version: sql`${inventoryBalances.version} + 1`,
            updatedAt: now,
          })
          .where(eq(inventoryBalances.id, existingBal.id));
      }

      await tx
        .update(stockTransferLines)
        .set({ receivedIntoQuarantine: !input.receiveIntoSellable })
        .where(eq(stockTransferLines.id, line.id));

      await tx.insert(stockMovements).values({
        tenantId: context.tenantId,
        branchId: transfer.toBranchId,
        locationId: targetLoc.id,
        productId: line.productId,
        lotId: destLot.id,
        movementType: 'transfer_in',
        qtyBase: line.qtyBase,
        fromBucket: 'in_transit',
        toBucket: input.receiveIntoSellable ? 'sellable' : 'quarantine',
        reason: input.notes || `Received transfer ${transfer.transferNumber}`,
        sourceDocType: 'stock_transfer',
        sourceDocId: transfer.id,
        actorUserId: context.userId,
      });
    }

    const [updated] = await tx
      .update(stockTransfers)
      .set({
        status: 'received',
        receivedByUserId: context.userId,
        receivedAt: now,
      })
      .where(eq(stockTransfers.id, transfer.id))
      .returning();

    return { transfer: updated, receivedIntoQuarantine: !input.receiveIntoSellable };
  });
}

// ---------------------------------------------------------------------------
// 4. Clinical Bridge: Doctor Consultation -> Pharmacy Dispense Queue Handoff
// ---------------------------------------------------------------------------
export async function listDispenseOrders(context: ActiveWorkspaceContext) {
  assertCapability(context, 'pharmacy.pos');
  assertPermission(context, 'pharmacy.pos.sell');

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    return store.dispenseOrders
      .filter((o) => o.tenantId === context.tenantId && o.branchId === context.branchId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((o) => {
        const person = store.people.find((p) => p.id === o.personId);
        const lines = store.dispenseOrderLines
          .filter((l) => l.dispenseOrderId === o.id)
          .map((l) => {
            const prod = store.products.find((p) => p.id === l.productId);
            const variant = store.packVariants.find((v) => v.id === l.packVariantId);
            return {
              ...l,
              productName: prod?.displayName ?? 'Product',
              variantName: variant?.variantName ?? 'Pack',
              defaultSalePriceMinor: variant?.defaultSalePriceMinor ?? 0,
              requiresPharmacistRelease: prod?.requiresPharmacistRelease ?? false,
            };
          });
        return {
          ...o,
          patientName: person?.displayName ?? 'Patient',
          patientPhone: person?.phone ?? '',
          lines,
        };
      });
  }

  const orders = await db
    .select({
      id: dispenseOrders.id,
      tenantId: dispenseOrders.tenantId,
      branchId: dispenseOrders.branchId,
      orderNumber: dispenseOrders.orderNumber,
      personId: dispenseOrders.personId,
      patientName: people.displayName,
      patientPhone: people.phone,
      appointmentId: dispenseOrders.appointmentId,
      prescriberName: dispenseOrders.prescriberName,
      clinicalNotes: dispenseOrders.clinicalNotes,
      status: dispenseOrders.status,
      posSaleId: dispenseOrders.posSaleId,
      createdAt: dispenseOrders.createdAt,
      dispensedAt: dispenseOrders.dispensedAt,
    })
    .from(dispenseOrders)
    .innerJoin(people, eq(dispenseOrders.personId, people.id))
    .where(
      and(
        eq(dispenseOrders.tenantId, context.tenantId),
        eq(dispenseOrders.branchId, context.branchId)
      )
    )
    .orderBy(desc(dispenseOrders.createdAt))
    .limit(40);

  const result = [];
  for (const o of orders) {
    const lines = await db
      .select({
        id: dispenseOrderLines.id,
        dispenseOrderId: dispenseOrderLines.dispenseOrderId,
        productId: dispenseOrderLines.productId,
        packVariantId: dispenseOrderLines.packVariantId,
        qtyPacks: dispenseOrderLines.qtyPacks,
        dosageInstruction: dispenseOrderLines.dosageInstruction,
        productName: products.displayName,
        requiresPharmacistRelease: products.requiresPharmacistRelease,
        variantName: packVariants.variantName,
        defaultSalePriceMinor: packVariants.defaultSalePriceMinor,
      })
      .from(dispenseOrderLines)
      .innerJoin(products, eq(dispenseOrderLines.productId, products.id))
      .innerJoin(packVariants, eq(dispenseOrderLines.packVariantId, packVariants.id))
      .where(eq(dispenseOrderLines.dispenseOrderId, o.id));
    result.push({ ...o, lines });
  }
  return result;
}

export async function createDispenseOrder(
  context: ActiveWorkspaceContext,
  input: CreateDispenseOrderInput,
  correlationId: string
) {
  assertCapability(context, 'pharmacy.pos');
  assertPermission(context, 'appointments.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const businessDate = getBusinessDateInTimezone(context.timezone);
  const orderNumber = `RXQ-${businessDate.replace(/-/g, '')}-${crypto
    .randomBytes(2)
    .toString('hex')
    .toUpperCase()}`;
  const now = new Date();

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const person = store.people.find(
      (p) => p.tenantId === context.tenantId && p.id === input.personId
    );
    if (!person) throw new NotFoundError('Patient record not found');

    const order = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      orderNumber,
      personId: input.personId,
      appointmentId: input.appointmentId ?? null,
      prescriberName: input.prescriberName.trim(),
      clinicalNotes: input.clinicalNotes.trim(),
      status: 'pending' as const,
      posSaleId: null,
      createdByUserId: context.userId,
      createdAt: now,
      dispensedAt: null,
    };
    store.dispenseOrders.unshift(order);

    for (const l of input.lines) {
      store.dispenseOrderLines.push({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        dispenseOrderId: order.id,
        productId: l.productId,
        packVariantId: l.packVariantId,
        qtyPacks: l.qtyPacks,
        dosageInstruction: l.dosageInstruction.trim(),
      });
    }

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'clinic.dispense_handoff_created',
      entityType: 'dispense_order',
      entityId: order.id,
      correlationId,
      metadataJson: { orderNumber, prescriberName: order.prescriberName },
    });

    return { order };
  }

  return db.transaction(async (tx) => {
    const [order] = await tx
      .insert(dispenseOrders)
      .values({
        tenantId: context.tenantId,
        branchId: context.branchId,
        orderNumber,
        personId: input.personId,
        appointmentId: input.appointmentId ?? null,
        prescriberName: input.prescriberName.trim(),
        clinicalNotes: input.clinicalNotes.trim(),
        status: 'pending',
        createdByUserId: context.userId,
      })
      .returning();

    await tx.insert(dispenseOrderLines).values(
      input.lines.map((l) => ({
        tenantId: context.tenantId,
        dispenseOrderId: order.id,
        productId: l.productId,
        packVariantId: l.packVariantId,
        qtyPacks: l.qtyPacks,
        dosageInstruction: l.dosageInstruction.trim(),
      }))
    );

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'clinic.dispense_handoff_created',
      entityType: 'dispense_order',
      entityId: order.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: { orderNumber, prescriberName: order.prescriberName },
    });

    return { order };
  });
}

export async function updateDispenseOrderStatus(
  context: ActiveWorkspaceContext,
  orderId: string,
  status: 'dispensed' | 'cancelled',
  posSaleId: string | null,
  correlationId: string
) {
  assertCapability(context, 'pharmacy.pos');
  assertPermission(context, 'pharmacy.pos.sell');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const now = new Date();

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const order = store.dispenseOrders.find(
      (o) => o.id === orderId && o.tenantId === context.tenantId
    );
    if (!order) throw new NotFoundError('Dispense queue order not found');
    order.status = status;
    order.posSaleId = posSaleId;
    if (status === 'dispensed') order.dispensedAt = now;

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: `pharmacy.dispense_order_${status}`,
      entityType: 'dispense_order',
      entityId: order.id,
      correlationId,
      metadataJson: { orderNumber: order.orderNumber, posSaleId },
    });
    return { order };
  }

  const [updated] = await db
    .update(dispenseOrders)
    .set({
      status,
      posSaleId,
      dispensedAt: status === 'dispensed' ? now : null,
    })
    .where(and(eq(dispenseOrders.id, orderId), eq(dispenseOrders.tenantId, context.tenantId)))
    .returning();
  if (!updated) throw new NotFoundError('Dispense queue order not found');
  return { order: updated };
}

// ---------------------------------------------------------------------------
// 5. Combined Daily Profit & Reconciliation Z-Report (Clinic + Pharmacy + CSV)
// ---------------------------------------------------------------------------
export async function getCombinedZReport(
  context: ActiveWorkspaceContext,
  requestedDate?: string
): Promise<CombinedZReportResponse> {
  assertPermission(context, 'reports.branch_summary');
  const businessDate = requestedDate || getBusinessDateInTimezone(context.timezone);

  const dayStart = new Date(`${businessDate}T00:00:00+05:30`);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  let clinicAppointmentCount = 0;
  let clinicCompletedCount = 0;
  let clinicGrossReceiptsMinor = 0;
  let clinicVoidedMinor = 0;
  let doctorPayoutsMinor = 0;

  let saleCount = 0;
  let grossSalesMinor = 0;
  let discountsMinor = 0;
  let returnsMinor = 0;
  let netSalesMinor = 0;
  let estimatedCogsMinor = 0;
  let supplierInvoicesMinor = 0;
  let tillVarianceMinor = 0;

  let cashMinor = 0;
  let cardMinor = 0;
  let bankMinor = 0;

  const hasClinic = Boolean(context.capabilities['appointments.manage']);
  const hasPharmacy = Boolean(context.capabilities['pharmacy.inventory'] || context.capabilities['pharmacy.pos']);

  if (hasClinic) {
    const payout = await getDoctorPayoutReport(context, businessDate);
    doctorPayoutsMinor = payout.totalDoctorShareMinor;
  }

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();

    if (hasClinic) {
      const dayAppts = store.appointments.filter(
        (a) =>
          a.tenantId === context.tenantId &&
          a.branchId === context.branchId &&
          a.businessDate === businessDate
      );
      clinicAppointmentCount = dayAppts.length;
      clinicCompletedCount = dayAppts.filter((a) => a.status === 'completed').length;

      for (const p of store.payments) {
        if (
          p.tenantId !== context.tenantId ||
          p.branchId !== context.branchId ||
          p.effectiveAt < dayStart ||
          p.effectiveAt >= dayEnd
        ) {
          continue;
        }
        if (p.status === 'posted') {
          clinicGrossReceiptsMinor += p.amountMinor;
          if (p.method === 'cash') cashMinor += p.amountMinor;
          else if (p.method === 'card') cardMinor += p.amountMinor;
          else bankMinor += p.amountMinor;
        } else if (p.status === 'voided') {
          clinicVoidedMinor += p.amountMinor;
        }
      }
    }

    if (hasPharmacy) {
      const daySales = store.posSales.filter(
        (s) =>
          s.tenantId === context.tenantId &&
          s.branchId === context.branchId &&
          s.soldAt >= dayStart &&
          s.soldAt < dayEnd
      );
      saleCount = daySales.length;
      const daySaleIds = new Set(daySales.map((s) => s.id));
      for (const s of daySales) {
        grossSalesMinor += s.subtotalMinor;
        discountsMinor += s.discountMinor;
        netSalesMinor += s.totalMinor;
      }

      for (const alloc of store.posSaleAllocations) {
        if (alloc.tenantId === context.tenantId && daySaleIds.has(alloc.saleId)) {
          estimatedCogsMinor += alloc.totalCostMinor;
        }
      }

      const dayPays = store.posPayments.filter(
        (pay) => pay.tenantId === context.tenantId && daySaleIds.has(pay.saleId)
      );
      for (const s of daySales) {
        const salePays = dayPays.filter((p) => p.saleId === s.id);
        let saleCash = 0;
        let saleCard = 0;
        let saleBank = 0;
        for (const p of salePays) {
          if (p.method === 'cash') saleCash += p.amountMinor;
          else if (p.method === 'card') saleCard += p.amountMinor;
          else saleBank += p.amountMinor;
        }
        let changeLeft = Math.max(0, s.changeMinor);
        const cashChange = Math.min(saleCash, changeLeft);
        saleCash -= cashChange;
        changeLeft -= cashChange;
        if (changeLeft > 0) {
          const cardChange = Math.min(saleCard, changeLeft);
          saleCard -= cardChange;
          changeLeft -= cardChange;
        }
        if (changeLeft > 0) {
          saleBank = Math.max(0, saleBank - changeLeft);
        }
        cashMinor += saleCash;
        cardMinor += saleCard;
        bankMinor += saleBank;
      }

      for (const ret of store.posReturns) {
        if (
          ret.tenantId === context.tenantId &&
          ret.branchId === context.branchId &&
          ret.returnedAt >= dayStart &&
          ret.returnedAt < dayEnd
        ) {
          returnsMinor += ret.refundAmountMinor;
          if (ret.refundMethod === 'cash') cashMinor -= ret.refundAmountMinor;
          else if (ret.refundMethod === 'card') cardMinor -= ret.refundAmountMinor;
          else bankMinor -= ret.refundAmountMinor;
        }
      }
      cashMinor = Math.max(0, cashMinor);
      cardMinor = Math.max(0, cardMinor);
      bankMinor = Math.max(0, bankMinor);
      netSalesMinor = Math.max(0, netSalesMinor - returnsMinor);

      for (const inv of store.supplierInvoices) {
        if (
          inv.tenantId === context.tenantId &&
          inv.branchId === context.branchId &&
          inv.invoiceDate === businessDate
        ) {
          supplierInvoicesMinor += inv.totalMinor;
        }
      }

      for (const sh of store.tillShifts) {
        if (
          sh.tenantId === context.tenantId &&
          sh.branchId === context.branchId &&
          sh.closedAt &&
          sh.closedAt >= dayStart &&
          sh.closedAt < dayEnd &&
          sh.varianceMinor !== null
        ) {
          tillVarianceMinor += sh.varianceMinor;
        }
      }
    }
  } else {
    if (hasClinic) {
      const dayAppts = await db
        .select({ status: appointments.status })
        .from(appointments)
        .where(
          and(
            eq(appointments.tenantId, context.tenantId),
            eq(appointments.branchId, context.branchId),
            eq(appointments.businessDate, businessDate)
          )
        );
      clinicAppointmentCount = dayAppts.length;
      clinicCompletedCount = dayAppts.filter((a) => a.status === 'completed').length;

      const dayPays = await db
        .select()
        .from(payments)
        .where(and(eq(payments.tenantId, context.tenantId), eq(payments.branchId, context.branchId)));
      for (const p of dayPays) {
        if (p.effectiveAt < dayStart || p.effectiveAt >= dayEnd) continue;
        if (p.status === 'posted') {
          clinicGrossReceiptsMinor += p.amountMinor;
          if (p.method === 'cash') cashMinor += p.amountMinor;
          else if (p.method === 'card') cardMinor += p.amountMinor;
          else bankMinor += p.amountMinor;
        } else if (p.status === 'voided') {
          clinicVoidedMinor += p.amountMinor;
        }
      }
    }

    if (hasPharmacy) {
      const allSales = await db
        .select()
        .from(posSales)
        .where(and(eq(posSales.tenantId, context.tenantId), eq(posSales.branchId, context.branchId)));
      const daySales = allSales.filter((s) => s.soldAt >= dayStart && s.soldAt < dayEnd);
      saleCount = daySales.length;
      const daySaleIds = new Set(daySales.map((s) => s.id));
      for (const s of daySales) {
        grossSalesMinor += s.subtotalMinor;
        discountsMinor += s.discountMinor;
        netSalesMinor += s.totalMinor;
      }

      const allocs = await db
        .select()
        .from(posSaleAllocations)
        .where(eq(posSaleAllocations.tenantId, context.tenantId));
      for (const a of allocs) {
        if (daySaleIds.has(a.saleId)) estimatedCogsMinor += a.totalCostMinor;
      }

      const pays = await db
        .select()
        .from(posPayments)
        .where(eq(posPayments.tenantId, context.tenantId));
      const dayPays = pays.filter((p) => daySaleIds.has(p.saleId));
      for (const s of daySales) {
        const salePays = dayPays.filter((p) => p.saleId === s.id);
        let saleCash = 0;
        let saleCard = 0;
        let saleBank = 0;
        for (const p of salePays) {
          if (p.method === 'cash') saleCash += p.amountMinor;
          else if (p.method === 'card') saleCard += p.amountMinor;
          else saleBank += p.amountMinor;
        }
        let changeLeft = Math.max(0, s.changeMinor);
        const cashChange = Math.min(saleCash, changeLeft);
        saleCash -= cashChange;
        changeLeft -= cashChange;
        if (changeLeft > 0) {
          const cardChange = Math.min(saleCard, changeLeft);
          saleCard -= cardChange;
          changeLeft -= cardChange;
        }
        if (changeLeft > 0) {
          saleBank = Math.max(0, saleBank - changeLeft);
        }
        cashMinor += saleCash;
        cardMinor += saleCard;
        bankMinor += saleBank;
      }

      const rets = await db
        .select()
        .from(posReturns)
        .where(and(eq(posReturns.tenantId, context.tenantId), eq(posReturns.branchId, context.branchId)));
      for (const r of rets) {
        if (r.returnedAt >= dayStart && r.returnedAt < dayEnd) {
          returnsMinor += r.refundAmountMinor;
          if (r.refundMethod === 'cash') cashMinor -= r.refundAmountMinor;
          else if (r.refundMethod === 'card') cardMinor -= r.refundAmountMinor;
          else bankMinor -= r.refundAmountMinor;
        }
      }
      cashMinor = Math.max(0, cashMinor);
      cardMinor = Math.max(0, cardMinor);
      bankMinor = Math.max(0, bankMinor);
      netSalesMinor = Math.max(0, netSalesMinor - returnsMinor);

      const supInvs = await db
        .select()
        .from(supplierInvoices)
        .where(
          and(
            eq(supplierInvoices.tenantId, context.tenantId),
            eq(supplierInvoices.branchId, context.branchId),
            eq(supplierInvoices.invoiceDate, businessDate)
          )
        );
      supplierInvoicesMinor = supInvs.reduce((a, i) => a + i.totalMinor, 0);

      const shifts = await db
        .select()
        .from(tillShifts)
        .where(and(eq(tillShifts.tenantId, context.tenantId), eq(tillShifts.branchId, context.branchId)));
      for (const sh of shifts) {
        if (sh.closedAt && sh.closedAt >= dayStart && sh.closedAt < dayEnd && sh.varianceMinor !== null) {
          tillVarianceMinor += sh.varianceMinor;
        }
      }
    }
  }

  let expenseCount = 0;
  let opexMinor = 0;
  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const dayExps = store.operatingExpenses.filter(
      (e) =>
        e.tenantId === context.tenantId &&
        e.branchId === context.branchId &&
        e.expenseDate === businessDate &&
        e.status === 'posted'
    );
    expenseCount = dayExps.length;
    opexMinor = dayExps.reduce((s, e) => s + e.amountMinor, 0);
  } else {
    const dayExps = await db
      .select()
      .from(operatingExpenses)
      .where(
        and(
          eq(operatingExpenses.tenantId, context.tenantId),
          eq(operatingExpenses.branchId, context.branchId),
          eq(operatingExpenses.expenseDate, businessDate),
          eq(operatingExpenses.status, 'posted')
        )
      );
    expenseCount = dayExps.length;
    opexMinor = dayExps.reduce((s, e) => s + e.amountMinor, 0);
  }

  const clinicNetCollectionsMinor = clinicGrossReceiptsMinor;
  const clinicNetAfterPayoutMinor = Math.max(0, clinicNetCollectionsMinor - doctorPayoutsMinor);
  const pharmacyGrossProfitMinor = netSalesMinor - estimatedCogsMinor;
  const totalRevenueMinor = clinicNetCollectionsMinor + netSalesMinor;
  const totalRefundsAndVoidsMinor = clinicVoidedMinor + returnsMinor;
  const netOperatingCashflowMinor =
    totalRevenueMinor - supplierInvoicesMinor - opexMinor + tillVarianceMinor;
  const netProfitMinor = clinicNetAfterPayoutMinor + pharmacyGrossProfitMinor - opexMinor;

  return {
    tenantName: context.tenantName,
    branchName: context.branchName,
    businessDate,
    currency: context.currency,
    modeFlags: {
      hasClinic,
      hasPharmacy,
    },
    clinic: {
      appointmentCount: clinicAppointmentCount,
      completedCount: clinicCompletedCount,
      grossReceiptsMinor: clinicGrossReceiptsMinor,
      voidedMinor: clinicVoidedMinor,
      netCollectionsMinor: clinicNetCollectionsMinor,
      doctorPayoutsMinor,
      clinicNetAfterPayoutMinor,
    },
    pharmacy: {
      saleCount,
      grossSalesMinor,
      discountsMinor,
      returnsMinor,
      netSalesMinor,
      estimatedCogsMinor,
      grossProfitMinor: pharmacyGrossProfitMinor,
      supplierInvoicesMinor,
      tillVarianceMinor,
    },
    expenses: {
      expenseCount,
      opexMinor,
    },
    combined: {
      totalRevenueMinor,
      totalRefundsAndVoidsMinor,
      netOperatingCashflowMinor,
      netProfitMinor,
      byMethod: {
        cashMinor,
        cardMinor,
        bankMinor,
      },
    },
  };
}

export function formatCombinedZReportCsv(report: CombinedZReportResponse): string {
  const fmt = (minor: number) => (minor / 100).toFixed(2);
  const rows: string[][] = [
    ['Section', 'Metric', 'Amount (LKR)'],
    ['Workspace', `Tenant: ${report.tenantName}`, ''],
    ['Workspace', `Branch: ${report.branchName}`, ''],
    ['Workspace', `Business Date: ${report.businessDate}`, ''],
  ];

  if (report.modeFlags.hasClinic) {
    rows.push(
      ['Clinic', 'Appointments Total', String(report.clinic.appointmentCount)],
      ['Clinic', 'Appointments Completed', String(report.clinic.completedCount)],
      ['Clinic', 'Clinic Net Collections', fmt(report.clinic.netCollectionsMinor)],
      ['Clinic', 'Clinic Voided Payments', fmt(report.clinic.voidedMinor)],
      ['Clinic', 'Doctor Channeling Payouts', fmt(report.clinic.doctorPayoutsMinor)],
      ['Clinic', 'Clinic Net After Doctor Payout', fmt(report.clinic.clinicNetAfterPayoutMinor)]
    );
  }

  if (report.modeFlags.hasPharmacy) {
    rows.push(
      ['Pharmacy', 'POS Sales Count', String(report.pharmacy.saleCount)],
      ['Pharmacy', 'Pharmacy Gross Sales', fmt(report.pharmacy.grossSalesMinor)],
      ['Pharmacy', 'Pharmacy Discounts', fmt(report.pharmacy.discountsMinor)],
      ['Pharmacy', 'Customer Returns / Refunds', fmt(report.pharmacy.returnsMinor)],
      ['Pharmacy', 'Pharmacy Net Sales', fmt(report.pharmacy.netSalesMinor)],
      ['Pharmacy', 'Estimated FEFO COGS', fmt(report.pharmacy.estimatedCogsMinor)],
      ['Pharmacy', 'Pharmacy Gross Profit', fmt(report.pharmacy.grossProfitMinor)],
      ['Pharmacy', 'Supplier Invoices Posted Today', fmt(report.pharmacy.supplierInvoicesMinor)],
      ['Pharmacy', 'Till Cash Variance', fmt(report.pharmacy.tillVarianceMinor)]
    );
  }

  rows.push(
    ['Expenses', 'Operating Expenses (OpEx)', fmt(report.expenses.opexMinor)],
    ['Summary', 'Total Revenue', fmt(report.combined.totalRevenueMinor)],
    ['Summary', 'Cash Collections', fmt(report.combined.byMethod.cashMinor)],
    ['Summary', 'Card Collections', fmt(report.combined.byMethod.cardMinor)],
    ['Summary', 'Bank / QR Collections', fmt(report.combined.byMethod.bankMinor)],
    ['Summary', 'True Daily Net Profit (After OpEx)', fmt(report.combined.netProfitMinor)],
    ['Summary', 'Net Operating Cashflow', fmt(report.combined.netOperatingCashflowMinor)]
  );

  return rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
}
