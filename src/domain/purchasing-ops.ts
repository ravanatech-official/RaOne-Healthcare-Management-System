import crypto from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db, isDatabaseConfigured } from '../db/index.ts';
import {
  auditEvents,
  inventoryBalances,
  lots,
  packVariants,
  products,
  purchaseOrderLines,
  purchaseOrders,
  stockMovements,
  supplierDebitNotes,
  suppliers,
} from '../db/schema.ts';
import type {
  ConvertPoToGrnInput,
  CreatePurchaseOrderInput,
  CreateSupplierDebitNoteInput,
  PurchasingOverviewResponse,
} from '../contracts/departments.ts';
import { ConflictError, NotFoundError, ValidationError } from './errors.ts';
import { addMemAuditEvent, getMemoryStore } from './memory-store.ts';
import { postGoodsReceipt } from './pharmacy-inventory.ts';
import { assertWorkspaceNotReadOnlyGrace } from './subscription-billing.ts';
import {
  assertCapability,
  assertPermission,
  getBusinessDateInTimezone,
  type ActiveWorkspaceContext,
} from './tenancy.ts';

export async function getPurchasingOverview(
  context: ActiveWorkspaceContext
): Promise<PurchasingOverviewResponse> {
  assertCapability(context, 'purchasing.orders');
  assertPermission(context, 'purchasing.read');

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const pos = store.purchaseOrders
      .filter((p) => p.tenantId === context.tenantId && p.branchId === context.branchId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((po) => {
        const lines = store.purchaseOrderLines
          .filter((l) => l.purchaseOrderId === po.id)
          .map((l) => ({
            id: l.id,
            productId: l.productId,
            productName:
              store.products.find((p) => p.id === l.productId)?.displayName ?? 'Product',
            packVariantId: l.packVariantId,
            variantName:
              store.packVariants.find((v) => v.id === l.packVariantId)?.variantName ?? 'Pack',
            orderedPacks: l.orderedPacks,
            estimatedUnitPackCostMinor: l.estimatedUnitPackCostMinor,
          }));
        return {
          id: po.id,
          poNumber: po.poNumber,
          supplierId: po.supplierId,
          supplierName:
            store.suppliers.find((s) => s.id === po.supplierId)?.name ?? 'Supplier',
          status: po.status,
          expectedDate: po.expectedDate,
          totalEstimatedMinor: po.totalEstimatedMinor,
          notes: po.notes,
          convertedGrnId: po.convertedGrnId,
          createdAt: po.createdAt.toISOString(),
          lines,
        };
      });

    const debitNotes = store.supplierDebitNotes
      .filter((d) => d.tenantId === context.tenantId && d.branchId === context.branchId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((d) => ({
        id: d.id,
        debitNoteNumber: d.debitNoteNumber,
        supplierId: d.supplierId,
        supplierName:
          store.suppliers.find((s) => s.id === d.supplierId)?.name ?? 'Supplier',
        productId: d.productId,
        productName:
          store.products.find((p) => p.id === d.productId)?.displayName ?? 'Product',
        lotId: d.lotId,
        batchNumber: store.lots.find((l) => l.id === d.lotId)?.batchNumber ?? 'Batch',
        qtyBase: d.qtyBase,
        reason: d.reason,
        amountMinor: d.amountMinor,
        status: d.status,
        notes: d.notes,
        createdAt: d.createdAt.toISOString(),
      }));

    return { purchaseOrders: pos, debitNotes };
  }

  const [poRows, poLinesRows, dnRows, supRows, prodRows, varRows, lotRows] = await Promise.all([
    db
      .select()
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.tenantId, context.tenantId),
          eq(purchaseOrders.branchId, context.branchId)
        )
      )
      .orderBy(desc(purchaseOrders.createdAt)),
    db.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.tenantId, context.tenantId)),
    db
      .select()
      .from(supplierDebitNotes)
      .where(
        and(
          eq(supplierDebitNotes.tenantId, context.tenantId),
          eq(supplierDebitNotes.branchId, context.branchId)
        )
      )
      .orderBy(desc(supplierDebitNotes.createdAt)),
    db.select().from(suppliers).where(eq(suppliers.tenantId, context.tenantId)),
    db.select().from(products).where(eq(products.tenantId, context.tenantId)),
    db.select().from(packVariants).where(eq(packVariants.tenantId, context.tenantId)),
    db.select().from(lots).where(eq(lots.tenantId, context.tenantId)),
  ]);

  return {
    purchaseOrders: poRows.map((po) => ({
      id: po.id,
      poNumber: po.poNumber,
      supplierId: po.supplierId,
      supplierName: supRows.find((s) => s.id === po.supplierId)?.name ?? 'Supplier',
      status: po.status,
      expectedDate: po.expectedDate,
      totalEstimatedMinor: po.totalEstimatedMinor,
      notes: po.notes,
      convertedGrnId: po.convertedGrnId,
      createdAt: po.createdAt.toISOString(),
      lines: poLinesRows
        .filter((l) => l.purchaseOrderId === po.id)
        .map((l) => ({
          id: l.id,
          productId: l.productId,
          productName: prodRows.find((p) => p.id === l.productId)?.displayName ?? 'Product',
          packVariantId: l.packVariantId,
          variantName: varRows.find((v) => v.id === l.packVariantId)?.variantName ?? 'Pack',
          orderedPacks: l.orderedPacks,
          estimatedUnitPackCostMinor: l.estimatedUnitPackCostMinor,
        })),
    })),
    debitNotes: dnRows.map((d) => ({
      id: d.id,
      debitNoteNumber: d.debitNoteNumber,
      supplierId: d.supplierId,
      supplierName: supRows.find((s) => s.id === d.supplierId)?.name ?? 'Supplier',
      productId: d.productId,
      productName: prodRows.find((p) => p.id === d.productId)?.displayName ?? 'Product',
      lotId: d.lotId,
      batchNumber: lotRows.find((l) => l.id === d.lotId)?.batchNumber ?? 'Batch',
      qtyBase: d.qtyBase,
      reason: d.reason,
      amountMinor: d.amountMinor,
      status: d.status,
      notes: d.notes,
      createdAt: d.createdAt.toISOString(),
    })),
  };
}

export async function createPurchaseOrder(
  context: ActiveWorkspaceContext,
  input: CreatePurchaseOrderInput,
  correlationId: string
) {
  assertCapability(context, 'purchasing.orders');
  assertPermission(context, 'purchasing.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const businessDate = getBusinessDateInTimezone(context.timezone);
  const expectedDate = input.expectedDate || businessDate;
  const totalEstimatedMinor = input.lines.reduce(
    (sum, l) => sum + l.orderedPacks * l.estimatedUnitPackCostMinor,
    0
  );
  const poNumber = `PO-${businessDate.replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const sup = store.suppliers.find(
      (s) => s.id === input.supplierId && s.tenantId === context.tenantId
    );
    if (!sup) throw new NotFoundError('Supplier not found');

    const po = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      supplierId: sup.id,
      poNumber,
      status: 'draft' as const,
      expectedDate,
      notes: input.notes,
      totalEstimatedMinor,
      approvedByUserId: null,
      approvedAt: null,
      convertedGrnId: null,
      createdByUserId: context.userId,
      createdAt: new Date(),
    };
    store.purchaseOrders.unshift(po);

    for (const line of input.lines) {
      store.purchaseOrderLines.push({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        purchaseOrderId: po.id,
        productId: line.productId,
        packVariantId: line.packVariantId,
        orderedPacks: line.orderedPacks,
        estimatedUnitPackCostMinor: line.estimatedUnitPackCostMinor,
      });
    }

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'purchasing.po_created',
      entityType: 'purchase_order',
      entityId: po.id,
      correlationId,
      metadataJson: { poNumber, totalEstimatedMinor, lineCount: input.lines.length },
    });

    return { purchaseOrder: po };
  }

  return db.transaction(async (tx) => {
    const [po] = await tx
      .insert(purchaseOrders)
      .values({
        tenantId: context.tenantId,
        branchId: context.branchId,
        supplierId: input.supplierId,
        poNumber,
        status: 'draft',
        expectedDate,
        notes: input.notes,
        totalEstimatedMinor,
        createdByUserId: context.userId,
      })
      .returning();

    await tx.insert(purchaseOrderLines).values(
      input.lines.map((l) => ({
        tenantId: context.tenantId,
        purchaseOrderId: po.id,
        productId: l.productId,
        packVariantId: l.packVariantId,
        orderedPacks: l.orderedPacks,
        estimatedUnitPackCostMinor: l.estimatedUnitPackCostMinor,
      }))
    );

    return { purchaseOrder: po };
  });
}

export async function approvePurchaseOrder(
  context: ActiveWorkspaceContext,
  poId: string,
  correlationId: string
) {
  assertCapability(context, 'purchasing.orders');
  assertPermission(context, 'purchasing.approve');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const po = store.purchaseOrders.find(
      (p) => p.id === poId && p.tenantId === context.tenantId && p.branchId === context.branchId
    );
    if (!po) throw new NotFoundError('Purchase order not found');
    if (po.status !== 'draft') throw new ConflictError('Only draft purchase orders can be approved');
    po.status = 'approved';
    po.approvedByUserId = context.userId;
    po.approvedAt = new Date();
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'purchasing.po_approved',
      entityType: 'purchase_order',
      entityId: po.id,
      correlationId,
      metadataJson: { poNumber: po.poNumber },
    });
    return { purchaseOrder: po };
  }

  const [updated] = await db
    .update(purchaseOrders)
    .set({ status: 'approved', approvedByUserId: context.userId, approvedAt: new Date() })
    .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.tenantId, context.tenantId)))
    .returning();
  if (!updated) throw new NotFoundError('Purchase order not found');
  return { purchaseOrder: updated };
}

export async function convertPurchaseOrderToGrn(
  context: ActiveWorkspaceContext,
  poId: string,
  input: ConvertPoToGrnInput,
  correlationId: string
) {
  assertCapability(context, 'purchasing.orders');
  assertCapability(context, 'pharmacy.receiving');
  assertPermission(context, 'pharmacy.receiving.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const overview = await getPurchasingOverview(context);
  const po = overview.purchaseOrders.find((p) => p.id === poId);
  if (!po) throw new NotFoundError('Purchase order not found');
  if (po.status === 'received') throw new ConflictError('Purchase order has already been received');
  if (po.status === 'cancelled') throw new ConflictError('Cannot receive a cancelled purchase order');
  if (po.lines.length === 0) throw new ValidationError('Purchase order has no line items');

  const receivedDate = getBusinessDateInTimezone(context.timezone);

  const grnResult = (await postGoodsReceipt(
    context,
    {
      idempotencyKey: `po-grn-${po.id}`,
      supplierId: po.supplierId,
      supplierDocRef: `GRN-FROM-${po.poNumber}`,
      docType: 'grn',
      receivedDate,
      notes: input.notes || `Auto-converted from ${po.poNumber}`,
      lines: po.lines.map((l, idx) => ({
        productId: l.productId,
        packVariantId: l.packVariantId,
        batchNumber: `${input.batchNumber}-${idx + 1}`,
        printedExpiry: input.printedExpiry,
        expiryPrecision: 'day',
        orderedPacks: l.orderedPacks,
        receivedPacks: l.orderedPacks,
        bonusPacks: 0,
        quarantinedPacks: 0,
        unitPackCostMinor: l.estimatedUnitPackCostMinor,
        isProvisionalCost: false,
        condition: 'good',
        releaseImmediately: input.releaseImmediately,
      })),
    },
    correlationId
  )) as { goodsReceipt?: { id: string } };

  const grnId = grnResult?.goodsReceipt?.id ?? null;

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const targetPo = store.purchaseOrders.find((p) => p.id === po.id);
    if (targetPo) {
      targetPo.status = 'received';
      targetPo.convertedGrnId = grnId;
    }
  } else {
    await db
      .update(purchaseOrders)
      .set({ status: 'received', convertedGrnId: grnId })
      .where(eq(purchaseOrders.id, po.id));
  }

  return { poNumber: po.poNumber, convertedGrnId: grnId, grnResult };
}

export async function createSupplierDebitNote(
  context: ActiveWorkspaceContext,
  input: CreateSupplierDebitNoteInput,
  correlationId: string
) {
  assertCapability(context, 'purchasing.orders');
  assertPermission(context, 'purchasing.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const businessDate = getBusinessDateInTimezone(context.timezone);
  const amountMinor = Math.round(input.amountLkr * 100);
  const debitNoteNumber = `DN-${businessDate.replace(/-/g, '')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const bal = store.inventoryBalances.find(
      (b) =>
        b.tenantId === context.tenantId &&
        b.branchId === context.branchId &&
        b.productId === input.productId &&
        b.lotId === input.lotId
    );
    if (!bal) throw new NotFoundError('Stock balance for specified product lot not found');
    const available = bal.sellableOnHand + bal.quarantineQty;
    if (available < input.qtyBase) {
      throw new ValidationError(`Only ${available} base units available to return in this batch`);
    }

    if (bal.quarantineQty >= input.qtyBase) {
      bal.quarantineQty -= input.qtyBase;
    } else {
      const rem = input.qtyBase - bal.quarantineQty;
      bal.quarantineQty = 0;
      bal.sellableOnHand = Math.max(0, bal.sellableOnHand - rem);
    }
    bal.updatedAt = new Date();

    const note = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      supplierId: input.supplierId,
      debitNoteNumber,
      reason: input.reason,
      amountMinor,
      productId: input.productId,
      lotId: input.lotId,
      qtyBase: input.qtyBase,
      status: 'applied' as const,
      notes: input.notes,
      createdByUserId: context.userId,
      createdAt: new Date(),
    };
    store.supplierDebitNotes.unshift(note);

    store.stockMovements.push({
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      locationId: bal.locationId,
      productId: input.productId,
      lotId: input.lotId,
      costLayerId: null,
      movementType: 'supplier_return',
      qtyBase: input.qtyBase,
      fromBucket: 'sellable',
      toBucket: 'supplier',
      reason: `Supplier Debit Note ${debitNoteNumber} (${input.reason})`,
      sourceDocType: 'supplier_debit_note',
      sourceDocId: note.id,
      commandId: null,
      packVariantId: null,
      uomConversionVersion: null,
      actorUserId: context.userId,
      occurredAt: new Date(),
      createdAt: new Date(),
    });

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'purchasing.supplier_debit_note_created',
      entityType: 'supplier_debit_note',
      entityId: note.id,
      correlationId,
      metadataJson: { debitNoteNumber, amountMinor, qtyBase: input.qtyBase },
    });

    return { debitNote: note };
  }

  return db.transaction(async (tx) => {
    const [bal] = await tx
      .select()
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, context.tenantId),
          eq(inventoryBalances.branchId, context.branchId),
          eq(inventoryBalances.productId, input.productId),
          eq(inventoryBalances.lotId, input.lotId)
        )
      )
      .limit(1);
    if (!bal) throw new NotFoundError('Stock balance for specified product lot not found');

    const available = bal.sellableOnHand + bal.quarantineQty;
    if (available < input.qtyBase) {
      throw new ValidationError(`Only ${available} base units available to return in this batch`);
    }

    let nextQuarantine = bal.quarantineQty;
    let nextSellable = bal.sellableOnHand;
    if (nextQuarantine >= input.qtyBase) {
      nextQuarantine -= input.qtyBase;
    } else {
      const rem = input.qtyBase - nextQuarantine;
      nextQuarantine = 0;
      nextSellable = Math.max(0, nextSellable - rem);
    }

    await tx
      .update(inventoryBalances)
      .set({ quarantineQty: nextQuarantine, sellableOnHand: nextSellable, updatedAt: new Date() })
      .where(eq(inventoryBalances.id, bal.id));

    const [note] = await tx
      .insert(supplierDebitNotes)
      .values({
        tenantId: context.tenantId,
        branchId: context.branchId,
        supplierId: input.supplierId,
        debitNoteNumber,
        reason: input.reason,
        amountMinor,
        productId: input.productId,
        lotId: input.lotId,
        qtyBase: input.qtyBase,
        status: 'applied',
        notes: input.notes,
        createdByUserId: context.userId,
      })
      .returning();

    await tx.insert(stockMovements).values({
      tenantId: context.tenantId,
      branchId: context.branchId,
      locationId: bal.locationId,
      productId: input.productId,
      lotId: input.lotId,
      movementType: 'supplier_return',
      qtyBase: input.qtyBase,
      fromBucket: 'sellable',
      toBucket: 'supplier',
      reason: `Supplier Debit Note ${debitNoteNumber} (${input.reason})`,
      sourceDocType: 'supplier_debit_note',
      sourceDocId: note.id,
      actorUserId: context.userId,
    });

    return { debitNote: note };
  });
}
