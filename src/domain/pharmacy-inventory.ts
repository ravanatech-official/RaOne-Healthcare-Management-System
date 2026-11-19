import crypto from 'node:crypto';
import { and, asc, desc, eq, or, sql } from 'drizzle-orm';
import { db, isDatabaseConfigured } from '../db/index.ts';
import {
  auditEvents,
  commands,
  costLayers,
  goodsReceiptLines,
  goodsReceipts,
  inventoryBalances,
  lots,
  outboxEvents,
  packVariants,
  products,
  qualityHolds,
  recalls,
  stockMovements,
  stockReservations,
  storageLocations,
  supplierInvoices,
  suppliers,
  uomConversions,
} from '../db/schema.ts';
import type {
  ExpiryPrecision,
  PostGoodsReceiptInput,
  PostSupplierInvoiceInput,
} from '../contracts/pharmacy.ts';
import { assertProfessionalGrant } from './capabilities.ts';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from './errors.ts';
import { addMemAuditEvent, getMemoryStore } from './memory-store.ts';
import { computeBaseUnits } from './pharmacy-catalogue.ts';
import { assertWorkspaceNotReadOnlyGrace } from './subscription-billing.ts';
import {
  assertCapability,
  assertPermission,
  getBusinessDateInTimezone,
  type ActiveWorkspaceContext,
} from './tenancy.ts';

function sha256Canonical(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function parseAndValidateExpiry(
  printedExpiry: string,
  precision: ExpiryPrecision,
  businessDate: string
): {
  expiryCutoffDate: string | null;
  forceQuarantine: boolean;
  isExpired: boolean;
} {
  const cleaned = printedExpiry.trim();

  if (precision === 'unknown' || cleaned.toUpperCase() === 'UNKNOWN') {
    return {
      expiryCutoffDate: null,
      forceQuarantine: true,
      isExpired: false,
    };
  }

  if (precision === 'day') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
      throw new ValidationError(
        `Day-precision expiry "${cleaned}" must use YYYY-MM-DD format`,
        'errors.invalid_expiry'
      );
    }
    const [y, m, d] = cleaned.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    if (
      dt.getUTCFullYear() !== y ||
      dt.getUTCMonth() + 1 !== m ||
      dt.getUTCDate() !== d
    ) {
      throw new ValidationError(
        `Calendar date "${cleaned}" is not a valid expiry date`,
        'errors.invalid_expiry'
      );
    }
    return {
      expiryCutoffDate: cleaned,
      forceQuarantine: false,
      isExpired: cleaned < businessDate,
    };
  }

  // Month precision (YYYY-MM -> conservative end-of-month calendar cutoff in Sri Lanka)
  if (!/^\d{4}-\d{2}$/.test(cleaned)) {
    throw new ValidationError(
      `Month-precision expiry "${cleaned}" must use YYYY-MM format`,
      'errors.invalid_expiry'
    );
  }
  const [y, m] = cleaned.split('-').map(Number);
  if (m < 1 || m > 12) {
    throw new ValidationError(`Invalid expiry month "${cleaned}"`, 'errors.invalid_expiry');
  }
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cutoff = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(
    lastDay
  ).padStart(2, '0')}`;

  return {
    expiryCutoffDate: cutoff,
    forceQuarantine: false,
    isExpired: cutoff < businessDate,
  };
}

export async function listSuppliers(context: ActiveWorkspaceContext) {
  assertCapability(context, 'pharmacy.receiving');
  assertPermission(context, 'pharmacy.catalogue.read');

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    return store.suppliers
      .filter((s) => s.tenantId === context.tenantId && (!context.legalEntityId || s.legalEntityId === context.legalEntityId))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  const clauses = [eq(suppliers.tenantId, context.tenantId)];
  if (context.legalEntityId) {
    clauses.push(eq(suppliers.legalEntityId, context.legalEntityId));
  }
  return db
    .select()
    .from(suppliers)
    .where(and(...clauses))
    .orderBy(asc(suppliers.name));
}

export async function createSupplier(
  context: ActiveWorkspaceContext,
  input: {
    name: string;
    registrationRef?: string;
    contactName?: string;
    phone?: string;
    email?: string;
    status: 'approved' | 'pending_review' | 'suspended';
  },
  correlationId: string
) {
  assertCapability(context, 'pharmacy.receiving');
  assertPermission(context, 'pharmacy.receiving.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (!context.legalEntityId) {
    throw new ValidationError('Active legal entity is required to register suppliers');
  }

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const created = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      name: input.name.trim(),
      registrationRef: input.registrationRef?.trim() || '',
      contactName: input.contactName?.trim() || '',
      phone: input.phone?.trim() || '',
      email: input.email?.trim() || '',
      status: input.status,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    store.suppliers.push(created);
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.supplier_created',
      entityType: 'supplier',
      entityId: created.id,
      correlationId,
      metadataJson: { name: created.name, status: created.status },
    });
    return created;
  }

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(suppliers)
      .values({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId!,
        name: input.name.trim(),
        registrationRef: input.registrationRef?.trim() || '',
        contactName: input.contactName?.trim() || '',
        phone: input.phone?.trim() || '',
        email: input.email?.trim() || '',
        status: input.status,
      })
      .returning();

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.supplier_created',
      entityType: 'supplier',
      entityId: created.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: { name: created.name, status: created.status },
    });

    return created;
  });
}

export async function listStorageLocations(context: ActiveWorkspaceContext) {
  assertCapability(context, 'pharmacy.inventory');
  assertPermission(context, 'pharmacy.stock.read');

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    return store.storageLocations
      .filter((l) => l.tenantId === context.tenantId && l.branchId === context.branchId && l.active)
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  return db
    .select()
    .from(storageLocations)
    .where(
      and(
        eq(storageLocations.tenantId, context.tenantId),
        eq(storageLocations.branchId, context.branchId),
        eq(storageLocations.active, true)
      )
    )
    .orderBy(asc(storageLocations.code));
}

export async function listGoodsReceipts(context: ActiveWorkspaceContext) {
  assertCapability(context, 'pharmacy.receiving');
  assertPermission(context, 'pharmacy.stock.read');

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    return store.goodsReceipts
      .filter((g) => g.tenantId === context.tenantId && g.branchId === context.branchId)
      .sort((a, b) => b.postedAt.getTime() - a.postedAt.getTime())
      .slice(0, 50)
      .map((g) => ({
        id: g.id,
        supplierId: g.supplierId,
        supplierName: store.suppliers.find((s) => s.id === g.supplierId)?.name ?? 'Supplier',
        supplierDocRef: g.supplierDocRef,
        docType: g.docType,
        receivedDate: g.receivedDate,
        status: g.status,
        notes: g.notes,
        postedAt: g.postedAt,
      }));
  }

  const rows = await db
    .select({
      id: goodsReceipts.id,
      supplierId: goodsReceipts.supplierId,
      supplierName: suppliers.name,
      supplierDocRef: goodsReceipts.supplierDocRef,
      docType: goodsReceipts.docType,
      receivedDate: goodsReceipts.receivedDate,
      status: goodsReceipts.status,
      notes: goodsReceipts.notes,
      postedAt: goodsReceipts.postedAt,
    })
    .from(goodsReceipts)
    .innerJoin(
      suppliers,
      and(eq(goodsReceipts.supplierId, suppliers.id), eq(suppliers.tenantId, context.tenantId))
    )
    .where(
      and(
        eq(goodsReceipts.tenantId, context.tenantId),
        eq(goodsReceipts.branchId, context.branchId)
      )
    )
    .orderBy(desc(goodsReceipts.postedAt))
    .limit(50);

  return rows;
}

export async function listSupplierInvoices(context: ActiveWorkspaceContext) {
  assertCapability(context, 'pharmacy.receiving');
  assertPermission(context, 'pharmacy.stock.read');

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    return store.supplierInvoices
      .filter((i) => i.tenantId === context.tenantId && i.branchId === context.branchId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 50)
      .map((i) => ({
        id: i.id,
        supplierId: i.supplierId,
        supplierName: store.suppliers.find((s) => s.id === i.supplierId)?.name ?? 'Supplier',
        goodsReceiptId: i.goodsReceiptId,
        invoiceNumber: i.invoiceNumber,
        invoiceDate: i.invoiceDate,
        totalMinor: i.totalMinor,
        currency: i.currency,
        status: i.status,
        createdAt: i.createdAt,
      }));
  }

  return db
    .select({
      id: supplierInvoices.id,
      supplierId: supplierInvoices.supplierId,
      supplierName: suppliers.name,
      goodsReceiptId: supplierInvoices.goodsReceiptId,
      invoiceNumber: supplierInvoices.invoiceNumber,
      invoiceDate: supplierInvoices.invoiceDate,
      totalMinor: supplierInvoices.totalMinor,
      currency: supplierInvoices.currency,
      status: supplierInvoices.status,
      createdAt: supplierInvoices.createdAt,
    })
    .from(supplierInvoices)
    .innerJoin(
      suppliers,
      and(eq(supplierInvoices.supplierId, suppliers.id), eq(suppliers.tenantId, context.tenantId))
    )
    .where(
      and(
        eq(supplierInvoices.tenantId, context.tenantId),
        eq(supplierInvoices.branchId, context.branchId)
      )
    )
    .orderBy(desc(supplierInvoices.createdAt))
    .limit(50);
}

export async function postGoodsReceipt(
  context: ActiveWorkspaceContext,
  input: PostGoodsReceiptInput,
  correlationId: string
) {
  assertCapability(context, 'pharmacy.receiving');
  assertPermission(context, 'pharmacy.receiving.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (!context.legalEntityId) {
    throw new ValidationError('Active branch must belong to a legal entity before posting receipts');
  }

  const payloadHash = sha256Canonical({
    supplierId: input.supplierId,
    supplierDocRef: input.supplierDocRef.trim(),
    docType: input.docType,
    receivedDate: input.receivedDate,
    notes: input.notes.trim(),
    lines: input.lines,
  });

  const businessDate = getBusinessDateInTimezone(context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const existingCmd = store.commands.find(
      (c) =>
        c.tenantId === context.tenantId &&
        c.actorUserId === context.userId &&
        c.commandType === 'pharmacy.grn.post' &&
        c.idempotencyKey === input.idempotencyKey
    );
    if (existingCmd) {
      if (existingCmd.payloadHash !== payloadHash) {
        throw new ConflictError('Idempotency key already used with a different goods receipt payload', 'IDEMPOTENCY_CONFLICT');
      }
      if (existingCmd.state === 'committed' && existingCmd.resultJson) {
        return { ...(existingCmd.resultJson as Record<string, unknown>), idempotentReplay: true };
      }
    }

    const supplier = store.suppliers.find(
      (s) => s.id === input.supplierId && s.tenantId === context.tenantId && s.legalEntityId === context.legalEntityId
    );
    if (!supplier) throw new NotFoundError('Supplier not found in active legal entity');
    if (supplier.status === 'suspended') throw new ConflictError('Cannot post goods receipt for a suspended supplier');

    if (store.goodsReceipts.some((g) => g.tenantId === context.tenantId && g.supplierId === supplier.id && g.supplierDocRef === input.supplierDocRef.trim())) {
      throw new ConflictError(`Supplier document "${input.supplierDocRef}" has already been posted`, 'DUPLICATE_SUPPLIER_DOC');
    }

    const branchLocations = store.storageLocations.filter(
      (l) => l.tenantId === context.tenantId && l.branchId === context.branchId && l.active
    );
    const defaultShelfLoc = branchLocations.find((l) => l.locationType === 'dispensary') ?? branchLocations[0];
    const defaultQuarantineLoc = branchLocations.find((l) => l.locationType === 'quarantine') ?? defaultShelfLoc;
    if (!defaultShelfLoc || !defaultQuarantineLoc) {
      throw new ValidationError('No active storage locations configured for this branch');
    }

    const cmdId = crypto.randomUUID();
    const now = new Date();
    const grn = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      branchId: context.branchId,
      supplierId: supplier.id,
      supplierDocRef: input.supplierDocRef.trim(),
      docType: input.docType,
      receivedDate: input.receivedDate,
      status: 'posted',
      notes: input.notes.trim(),
      commandId: cmdId,
      createdByUserId: context.userId,
      postedAt: now,
      createdAt: now,
    };

    const lineSummaries: Array<{
      lineId: string; lotId: string; productId: string; batchNumber: string;
      uomConversionVersion: number; acceptedQtyBase: number; quarantinedQtyBase: number;
      qualityStatus: string; unitCostMinor: number;
    }> = [];
    let cachedPharmacistGrantId: string | null = null;
    const ops: Array<() => void> = [];

    for (const line of input.lines) {
      const totalPacks = line.receivedPacks + line.bonusPacks;
      if (totalPacks <= 0) throw new ValidationError('Each receipt line must receive at least 1 paid or bonus pack');
      const product = store.products.find(
        (p) => p.id === line.productId && p.tenantId === context.tenantId && p.legalEntityId === context.legalEntityId
      );
      if (!product) throw new NotFoundError('Product SKU not found in active legal entity');
      const variant = store.packVariants.find(
        (v) => v.id === line.packVariantId && v.productId === product.id && v.tenantId === context.tenantId
      );
      if (!variant) throw new NotFoundError('Pack variant not found for product');
      const conversion = store.uomConversions.find(
        (c) => c.tenantId === context.tenantId && c.packVariantId === variant.id && c.version === variant.currentConversionVersion
      );
      if (!conversion) throw new ValidationError('Missing active UOM conversion snapshot for pack variant');

      const manufacturer = line.manufacturer?.trim() || product.manufacturer;
      const batchNumber = line.batchNumber.trim();
      const activeRecall = store.recalls.find(
        (r) => r.tenantId === context.tenantId && r.status === 'active' && (r.productId === product.id || r.manufacturer === manufacturer)
      );
      if (activeRecall) {
        throw new ConflictError(`Active recall ${activeRecall.referenceCode} blocks receiving ${product.displayName}`, 'ACTIVE_RECALL_BLOCK');
      }

      const expiry = parseAndValidateExpiry(line.printedExpiry, line.expiryPrecision, businessDate);
      const totalBaseQty = computeBaseUnits(totalPacks, conversion.baseQtyPerPack);
      let acceptedQtyBase = 0;
      let quarantinedQtyBase = totalBaseQty;
      if (!(expiry.forceQuarantine || expiry.isExpired || line.condition !== 'good' || !line.releaseImmediately)) {
        const qPacks = Math.min(totalPacks, line.quarantinedPacks);
        quarantinedQtyBase = computeBaseUnits(qPacks, conversion.baseQtyPerPack);
        acceptedQtyBase = totalBaseQty - quarantinedQtyBase;
      }
      if (acceptedQtyBase > 0 && product.requiresPharmacistRelease && !cachedPharmacistGrantId) {
        cachedPharmacistGrantId = (await assertProfessionalGrant(context, 'pharmacist')).id;
      }
      const targetLocationId = line.storageLocationId
        ? (() => {
            const f = branchLocations.find((l) => l.id === line.storageLocationId);
            if (!f) throw new NotFoundError('Specified storage location does not belong to active branch');
            return f.id;
          })()
        : acceptedQtyBase > 0 ? defaultShelfLoc.id : defaultQuarantineLoc.id;

      const existingLot = store.lots.find(
        (l) => l.tenantId === context.tenantId && l.branchId === context.branchId && l.productId === product.id && l.manufacturer === manufacturer && l.batchNumber === batchNumber
      );
      if (existingLot && (existingLot.printedExpiry !== line.printedExpiry.trim() || existingLot.expiryPrecision !== line.expiryPrecision)) {
        throw new ConflictError(`Batch "${batchNumber}" already exists with printed expiry "${existingLot.printedExpiry}"`, 'BATCH_EXPIRY_MISMATCH');
      }

      ops.push(() => {
        let lotRecord = existingLot;
        const desiredStatus: 'quarantine' | 'released' | 'blocked' = expiry.isExpired ? 'blocked' : acceptedQtyBase > 0 ? 'released' : 'quarantine';
        if (lotRecord) {
          if (acceptedQtyBase > 0 && lotRecord.qualityStatus === 'quarantine') {
            lotRecord.qualityStatus = 'released';
            lotRecord.releasedByGrantId = cachedPharmacistGrantId;
            lotRecord.releasedAt = now;
            lotRecord.updatedAt = now;
          }
        } else {
          lotRecord = {
            id: crypto.randomUUID(), tenantId: context.tenantId, branchId: context.branchId, productId: product.id, manufacturer, batchNumber,
            printedExpiry: expiry.forceQuarantine ? 'UNKNOWN' : line.printedExpiry.trim(),
            expiryPrecision: line.expiryPrecision, expiryCutoffDate: expiry.expiryCutoffDate, qualityStatus: desiredStatus,
            quarantineReason: expiry.forceQuarantine ? 'Unknown printed expiry' : expiry.isExpired ? 'Expired on receipt' : line.condition !== 'good' ? `Condition: ${line.condition}` : acceptedQtyBase === 0 ? 'Awaiting pharmacist release' : '',
            releasedByGrantId: acceptedQtyBase > 0 ? cachedPharmacistGrantId : null, releasedAt: acceptedQtyBase > 0 ? now : null,
            createdAt: now, updatedAt: now,
          };
          store.lots.push(lotRecord);
        }
        const totalLineCostMinor = line.receivedPacks * line.unitPackCostMinor;
        const unitCostMinor = totalBaseQty > 0 ? Math.round(totalLineCostMinor / totalBaseQty) : 0;
        const grnLineId = crypto.randomUUID();
        store.goodsReceiptLines.push({
          id: grnLineId, tenantId: context.tenantId, goodsReceiptId: grn.id, productId: product.id, packVariantId: variant.id,
          uomConversionVersion: conversion.version, lotId: lotRecord.id, storageLocationId: targetLocationId,
          orderedPacks: line.orderedPacks, receivedPacks: line.receivedPacks, bonusPacks: line.bonusPacks,
          acceptedQtyBase, quarantinedQtyBase, unitPackCostMinor: line.unitPackCostMinor, totalLineCostMinor,
          isProvisionalCost: line.isProvisionalCost, condition: expiry.forceQuarantine ? 'unknown_expiry' : line.condition, createdAt: now,
        });
        const costLayerId = crypto.randomUUID();
        store.costLayers.push({
          id: costLayerId, tenantId: context.tenantId, branchId: context.branchId, productId: product.id, lotId: lotRecord.id,
          goodsReceiptLineId: grnLineId, unitCostMinor, totalCostMinor: totalLineCostMinor,
          initialQtyBase: totalBaseQty, remainingQtyBase: totalBaseQty, isProvisional: line.isProvisionalCost, receivedAt: now, createdAt: now,
        });
        const addSellable = acceptedQtyBase;
        const addExpired = expiry.isExpired ? quarantinedQtyBase : 0;
        const addQuarantine = expiry.isExpired ? 0 : quarantinedQtyBase;
        const bal = store.inventoryBalances.find(
          (b) => b.tenantId === context.tenantId && b.branchId === context.branchId && b.locationId === targetLocationId && b.productId === product.id && b.lotId === lotRecord!.id
        );
        if (bal) {
          bal.sellableOnHand += addSellable; bal.quarantineQty += addQuarantine; bal.expiredQty += addExpired; bal.version += 1; bal.updatedAt = now;
        } else {
          store.inventoryBalances.push({
            id: crypto.randomUUID(), tenantId: context.tenantId, branchId: context.branchId, locationId: targetLocationId, productId: product.id, lotId: lotRecord.id,
            sellableOnHand: addSellable, reservedQty: 0, quarantineQty: addQuarantine, returnedQuarantineQty: 0, damagedQty: 0, expiredQty: addExpired, recalledQty: 0, disposedQty: 0, version: 1, updatedAt: now,
          });
        }
        const movementType = input.docType === 'opening_balance' ? 'opening_balance' : 'grn_receive';
        if (addSellable > 0) {
          store.stockMovements.push({
            id: crypto.randomUUID(), tenantId: context.tenantId, branchId: context.branchId, locationId: targetLocationId, productId: product.id, lotId: lotRecord.id, costLayerId,
            movementType, qtyBase: addSellable, fromBucket: 'external_supplier', toBucket: 'sellable', reason: `GRN ${input.supplierDocRef} accepted`,
            sourceDocType: input.docType, sourceDocId: grn.id, commandId: cmdId, packVariantId: variant.id, uomConversionVersion: conversion.version, actorUserId: context.userId, occurredAt: now, createdAt: now,
          });
        }
        if (addQuarantine > 0 || addExpired > 0) {
          store.stockMovements.push({
            id: crypto.randomUUID(), tenantId: context.tenantId, branchId: context.branchId, locationId: targetLocationId, productId: product.id, lotId: lotRecord.id, costLayerId,
            movementType, qtyBase: addExpired > 0 ? addExpired : addQuarantine, fromBucket: 'external_supplier', toBucket: addExpired > 0 ? 'expired' : 'quarantine',
            reason: expiry.forceQuarantine ? 'Unknown printed expiry' : expiry.isExpired ? 'Expired' : 'Quarantine hold',
            sourceDocType: input.docType, sourceDocId: grn.id, commandId: cmdId, packVariantId: variant.id, uomConversionVersion: conversion.version, actorUserId: context.userId, occurredAt: now, createdAt: now,
          });
        }
        lineSummaries.push({
          lineId: grnLineId, lotId: lotRecord.id, productId: product.id, batchNumber: lotRecord.batchNumber,
          uomConversionVersion: conversion.version, acceptedQtyBase, quarantinedQtyBase, qualityStatus: lotRecord.qualityStatus, unitCostMinor,
        });
      });
    }
    store.goodsReceipts.push(grn);
    ops.forEach((op) => op());
    const responsePayload = {
      goodsReceipt: { id: grn.id, supplierId: grn.supplierId, supplierDocRef: grn.supplierDocRef, docType: grn.docType, receivedDate: grn.receivedDate, status: grn.status },
      lines: lineSummaries, idempotentReplay: false,
    };
    store.commands.push({
      id: cmdId, tenantId: context.tenantId, actorUserId: context.userId, commandType: 'pharmacy.grn.post',
      idempotencyKey: input.idempotencyKey, payloadHash, proposalId: null, state: 'committed', resultJson: responsePayload, committedAt: now,
    });
    addMemAuditEvent({
      tenantId: context.tenantId, actorUserId: context.userId, actorUid: context.uid,
      action: 'pharmacy.goods_receipt_posted', entityType: 'goods_receipt', entityId: grn.id, correlationId,
      metadataJson: { supplierDocRef: grn.supplierDocRef, lineCount: lineSummaries.length },
    });
    return responsePayload;
  }

  // Fast idempotent replay check before running writes
  const [existingCmd] = await db
    .select()
    .from(commands)
    .where(
      and(
        eq(commands.tenantId, context.tenantId),
        eq(commands.actorUserId, context.userId),
        eq(commands.commandType, 'pharmacy.grn.post'),
        eq(commands.idempotencyKey, input.idempotencyKey)
      )
    )
    .limit(1);

  if (existingCmd) {
    if (existingCmd.payloadHash !== payloadHash) {
      throw new ConflictError(
        'Idempotency key already used with a different goods receipt payload',
        'IDEMPOTENCY_CONFLICT'
      );
    }
    if (existingCmd.state === 'committed' && existingCmd.resultJson) {
      return {
        ...(existingCmd.resultJson as Record<string, unknown>),
        idempotentReplay: true,
      };
    }
  }

  return db.transaction(async (tx) => {
    const [cmd] = await tx
      .insert(commands)
      .values({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        commandType: 'pharmacy.grn.post',
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        state: 'accepted',
      })
      .returning();

    const [supplier] = await tx
      .select()
      .from(suppliers)
      .where(
        and(
          eq(suppliers.id, input.supplierId),
          eq(suppliers.tenantId, context.tenantId),
          eq(suppliers.legalEntityId, context.legalEntityId!)
        )
      )
      .limit(1);

    if (!supplier) {
      throw new NotFoundError('Supplier not found in active legal entity');
    }
    if (supplier.status === 'suspended') {
      throw new ConflictError('Cannot post goods receipt for a suspended supplier');
    }

    const dupDoc = await tx
      .select({ id: goodsReceipts.id })
      .from(goodsReceipts)
      .where(
        and(
          eq(goodsReceipts.tenantId, context.tenantId),
          eq(goodsReceipts.supplierId, supplier.id),
          eq(goodsReceipts.supplierDocRef, input.supplierDocRef.trim())
        )
      )
      .limit(1);

    if (dupDoc.length > 0) {
      throw new ConflictError(
        `Supplier document "${input.supplierDocRef}" has already been posted`,
        'DUPLICATE_SUPPLIER_DOC'
      );
    }

    const branchLocations = await tx
      .select()
      .from(storageLocations)
      .where(
        and(
          eq(storageLocations.tenantId, context.tenantId),
          eq(storageLocations.branchId, context.branchId),
          eq(storageLocations.active, true)
        )
      );

    const defaultShelfLoc =
      branchLocations.find((l) => l.locationType === 'dispensary') ?? branchLocations[0];
    const defaultQuarantineLoc =
      branchLocations.find((l) => l.locationType === 'quarantine') ?? defaultShelfLoc;

    if (!defaultShelfLoc || !defaultQuarantineLoc) {
      throw new ValidationError('No active storage locations configured for this branch');
    }

    const [grn] = await tx
      .insert(goodsReceipts)
      .values({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId!,
        branchId: context.branchId,
        supplierId: supplier.id,
        supplierDocRef: input.supplierDocRef.trim(),
        docType: input.docType,
        receivedDate: input.receivedDate,
        status: 'posted',
        notes: input.notes.trim(),
        commandId: cmd.id,
        createdByUserId: context.userId,
      })
      .returning();

    const lineSummaries: Array<{
      lineId: string;
      lotId: string;
      productId: string;
      batchNumber: string;
      uomConversionVersion: number;
      acceptedQtyBase: number;
      quarantinedQtyBase: number;
      qualityStatus: string;
      unitCostMinor: number;
    }> = [];

    let cachedPharmacistGrantId: string | null = null;

    for (const line of input.lines) {
      const totalPacks = line.receivedPacks + line.bonusPacks;
      if (totalPacks <= 0) {
        throw new ValidationError('Each receipt line must receive at least 1 paid or bonus pack');
      }

      const [product] = await tx
        .select()
        .from(products)
        .where(
          and(
            eq(products.id, line.productId),
            eq(products.tenantId, context.tenantId),
            eq(products.legalEntityId, context.legalEntityId!)
          )
        )
        .limit(1);

      if (!product) {
        throw new NotFoundError('Product SKU not found in active legal entity');
      }

      const [variant] = await tx
        .select()
        .from(packVariants)
        .where(
          and(
            eq(packVariants.id, line.packVariantId),
            eq(packVariants.productId, product.id),
            eq(packVariants.tenantId, context.tenantId)
          )
        )
        .limit(1);

      if (!variant) {
        throw new NotFoundError('Pack variant not found for product');
      }

      const [conversion] = await tx
        .select()
        .from(uomConversions)
        .where(
          and(
            eq(uomConversions.tenantId, context.tenantId),
            eq(uomConversions.packVariantId, variant.id),
            eq(uomConversions.version, variant.currentConversionVersion)
          )
        )
        .limit(1);

      if (!conversion) {
        throw new ValidationError('Missing active UOM conversion snapshot for pack variant');
      }

      const manufacturer = line.manufacturer?.trim() || product.manufacturer;
      const batchNumber = line.batchNumber.trim();

      // Safety Check: Active Recall Guard (cannot receive actively recalled product/manufacturer)
      const activeRecall = await tx
        .select({ id: recalls.id, referenceCode: recalls.referenceCode })
        .from(recalls)
        .where(
          and(
            eq(recalls.tenantId, context.tenantId),
            eq(recalls.status, 'active'),
            or(
              eq(recalls.productId, product.id),
              eq(recalls.manufacturer, manufacturer)
            )
          )
        )
        .limit(1);

      if (activeRecall.length > 0) {
        throw new ConflictError(
          `Active recall ${activeRecall[0].referenceCode} blocks receiving ${product.displayName}`,
          'ACTIVE_RECALL_BLOCK'
        );
      }

      const expiry = parseAndValidateExpiry(
        line.printedExpiry,
        line.expiryPrecision,
        businessDate
      );

      const totalBaseQty = computeBaseUnits(totalPacks, conversion.baseQtyPerPack);

      let acceptedQtyBase = 0;
      let quarantinedQtyBase = totalBaseQty;

      const mustQuarantineAll =
        expiry.forceQuarantine ||
        expiry.isExpired ||
        line.condition !== 'good' ||
        !line.releaseImmediately;

      if (!mustQuarantineAll) {
        const qPacks = Math.min(totalPacks, line.quarantinedPacks);
        quarantinedQtyBase = computeBaseUnits(qPacks, conversion.baseQtyPerPack);
        acceptedQtyBase = totalBaseQty - quarantinedQtyBase;
      }

      // Pharmacist Grant Enforcement for releasing restricted stock immediately to sellable
      if (acceptedQtyBase > 0 && product.requiresPharmacistRelease) {
        if (!cachedPharmacistGrantId) {
          const grant = await assertProfessionalGrant(context, 'pharmacist');
          cachedPharmacistGrantId = grant.id;
        }
      }

      const targetLocationId = line.storageLocationId
        ? (() => {
            const found = branchLocations.find((l) => l.id === line.storageLocationId);
            if (!found) {
              throw new NotFoundError('Specified storage location does not belong to active branch');
            }
            return found.id;
          })()
        : acceptedQtyBase > 0
          ? defaultShelfLoc.id
          : defaultQuarantineLoc.id;

      // Upsert Batch / Lot with strict expiry consistency check
      const [existingLot] = await tx
        .select()
        .from(lots)
        .where(
          and(
            eq(lots.tenantId, context.tenantId),
            eq(lots.branchId, context.branchId),
            eq(lots.productId, product.id),
            eq(lots.manufacturer, manufacturer),
            eq(lots.batchNumber, batchNumber)
          )
        )
        .limit(1);

      let lotRecord = existingLot;
      const desiredStatus = expiry.isExpired
        ? 'blocked'
        : acceptedQtyBase > 0
          ? 'released'
          : 'quarantine';

      if (existingLot) {
        if (
          existingLot.printedExpiry !== line.printedExpiry.trim() ||
          existingLot.expiryPrecision !== line.expiryPrecision
        ) {
          throw new ConflictError(
            `Batch "${batchNumber}" already exists with printed expiry "${existingLot.printedExpiry}"`,
            'BATCH_EXPIRY_MISMATCH'
          );
        }
        if (acceptedQtyBase > 0 && existingLot.qualityStatus === 'quarantine') {
          const [updatedLot] = await tx
            .update(lots)
            .set({
              qualityStatus: 'released',
              releasedByGrantId: cachedPharmacistGrantId,
              releasedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(and(eq(lots.id, existingLot.id), eq(lots.tenantId, context.tenantId)))
            .returning();
          lotRecord = updatedLot;
        }
      } else {
        const [insertedLot] = await tx
          .insert(lots)
          .values({
            tenantId: context.tenantId,
            branchId: context.branchId,
            productId: product.id,
            manufacturer,
            batchNumber,
            printedExpiry: expiry.forceQuarantine ? 'UNKNOWN' : line.printedExpiry.trim(),
            expiryPrecision: line.expiryPrecision,
            expiryCutoffDate: expiry.expiryCutoffDate,
            qualityStatus: desiredStatus,
            quarantineReason: expiry.forceQuarantine
              ? 'Unknown printed expiry'
              : expiry.isExpired
                ? 'Expired on receipt'
                : line.condition !== 'good'
                  ? `Condition: ${line.condition}`
                  : acceptedQtyBase === 0
                    ? 'Awaiting pharmacist release'
                    : '',
            releasedByGrantId: acceptedQtyBase > 0 ? cachedPharmacistGrantId : null,
            releasedAt: acceptedQtyBase > 0 ? new Date() : null,
          })
          .returning();
        lotRecord = insertedLot;
      }

      const totalLineCostMinor = line.receivedPacks * line.unitPackCostMinor;
      const unitCostMinor = totalBaseQty > 0 ? Math.round(totalLineCostMinor / totalBaseQty) : 0;

      const [grnLine] = await tx
        .insert(goodsReceiptLines)
        .values({
          tenantId: context.tenantId,
          goodsReceiptId: grn.id,
          productId: product.id,
          packVariantId: variant.id,
          uomConversionVersion: conversion.version,
          lotId: lotRecord.id,
          storageLocationId: targetLocationId,
          orderedPacks: line.orderedPacks,
          receivedPacks: line.receivedPacks,
          bonusPacks: line.bonusPacks,
          acceptedQtyBase,
          quarantinedQtyBase,
          unitPackCostMinor: line.unitPackCostMinor,
          totalLineCostMinor,
          isProvisionalCost: line.isProvisionalCost,
          condition: expiry.forceQuarantine ? 'unknown_expiry' : line.condition,
        })
        .returning();

      const [costLayer] = await tx
        .insert(costLayers)
        .values({
          tenantId: context.tenantId,
          branchId: context.branchId,
          productId: product.id,
          lotId: lotRecord.id,
          goodsReceiptLineId: grnLine.id,
          unitCostMinor,
          totalCostMinor: totalLineCostMinor,
          initialQtyBase: totalBaseQty,
          remainingQtyBase: totalBaseQty,
          isProvisional: line.isProvisionalCost,
        })
        .returning();

      // Upsert transactional balance bucket
      const addSellable = acceptedQtyBase;
      const addExpired = expiry.isExpired ? quarantinedQtyBase : 0;
      const addQuarantine = expiry.isExpired ? 0 : quarantinedQtyBase;

      await tx
        .insert(inventoryBalances)
        .values({
          tenantId: context.tenantId,
          branchId: context.branchId,
          locationId: targetLocationId,
          productId: product.id,
          lotId: lotRecord.id,
          sellableOnHand: addSellable,
          quarantineQty: addQuarantine,
          expiredQty: addExpired,
          version: 1,
        })
        .onConflictDoUpdate({
          target: [
            inventoryBalances.tenantId,
            inventoryBalances.branchId,
            inventoryBalances.locationId,
            inventoryBalances.productId,
            inventoryBalances.lotId,
          ],
          set: {
            sellableOnHand: sql`${inventoryBalances.sellableOnHand} + ${addSellable}`,
            quarantineQty: sql`${inventoryBalances.quarantineQty} + ${addQuarantine}`,
            expiredQty: sql`${inventoryBalances.expiredQty} + ${addExpired}`,
            version: sql`${inventoryBalances.version} + 1`,
            updatedAt: new Date(),
          },
        });

      const movementType = input.docType === 'opening_balance' ? 'opening_balance' : 'grn_receive';

      if (addSellable > 0) {
        await tx.insert(stockMovements).values({
          tenantId: context.tenantId,
          branchId: context.branchId,
          locationId: targetLocationId,
          productId: product.id,
          lotId: lotRecord.id,
          costLayerId: costLayer.id,
          movementType,
          qtyBase: addSellable,
          fromBucket: 'external_supplier',
          toBucket: 'sellable',
          reason: `GRN ${input.supplierDocRef} accepted`,
          sourceDocType: input.docType,
          sourceDocId: grn.id,
          commandId: cmd.id,
          packVariantId: variant.id,
          uomConversionVersion: conversion.version,
          actorUserId: context.userId,
        });
      }

      if (addQuarantine > 0 || addExpired > 0) {
        const bucket = addExpired > 0 ? 'expired' : 'quarantine';
        const qtyMoved = addExpired > 0 ? addExpired : addQuarantine;
        const holdReason = expiry.forceQuarantine
          ? 'Unknown printed expiry held in quarantine'
          : expiry.isExpired
            ? 'Expired stock on receipt'
            : line.condition !== 'good'
              ? `Condition held on receipt: ${line.condition}`
              : 'Awaiting pharmacist quality release';

        await tx.insert(stockMovements).values({
          tenantId: context.tenantId,
          branchId: context.branchId,
          locationId: targetLocationId,
          productId: product.id,
          lotId: lotRecord.id,
          costLayerId: costLayer.id,
          movementType,
          qtyBase: qtyMoved,
          fromBucket: 'external_supplier',
          toBucket: bucket,
          reason: holdReason,
          sourceDocType: input.docType,
          sourceDocId: grn.id,
          commandId: cmd.id,
          packVariantId: variant.id,
          uomConversionVersion: conversion.version,
          actorUserId: context.userId,
        });

        await tx.insert(qualityHolds).values({
          tenantId: context.tenantId,
          branchId: context.branchId,
          productId: product.id,
          lotId: lotRecord.id,
          holdType: line.condition === 'damaged' ? 'damaged' : 'quarantine',
          reason: holdReason,
          status: 'active',
          placedByUserId: context.userId,
        });
      }

      lineSummaries.push({
        lineId: grnLine.id,
        lotId: lotRecord.id,
        productId: product.id,
        batchNumber: lotRecord.batchNumber,
        uomConversionVersion: conversion.version,
        acceptedQtyBase,
        quarantinedQtyBase,
        qualityStatus: lotRecord.qualityStatus,
        unitCostMinor,
      });
    }

    const responsePayload = {
      goodsReceipt: {
        id: grn.id,
        supplierId: grn.supplierId,
        supplierDocRef: grn.supplierDocRef,
        docType: grn.docType,
        receivedDate: grn.receivedDate,
        status: grn.status,
      },
      lines: lineSummaries,
      idempotentReplay: false,
    };

    await tx
      .update(commands)
      .set({
        state: 'committed',
        resultJson: responsePayload,
        committedAt: new Date(),
      })
      .where(eq(commands.id, cmd.id));

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.goods_receipt_posted',
      entityType: 'goods_receipt',
      entityId: grn.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: {
        supplierDocRef: grn.supplierDocRef,
        lineCount: lineSummaries.length,
        commandId: cmd.id,
      },
    });

    await tx.insert(outboxEvents).values({
      tenantId: context.tenantId,
      eventType: 'pharmacy.goods_receipt.posted',
      payloadVersion: 1,
      payloadJson: {
        goodsReceiptId: grn.id,
        branchId: context.branchId,
        supplierId: supplier.id,
      },
    });

    return responsePayload;
  });
}

/**
 * Records a supplier invoice without creating stock movements or inventory balances (P12).
 */
export async function postSupplierInvoice(
  context: ActiveWorkspaceContext,
  input: PostSupplierInvoiceInput,
  correlationId: string
) {
  assertCapability(context, 'pharmacy.receiving');
  assertPermission(context, 'pharmacy.invoice.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (!context.legalEntityId) {
    throw new ValidationError('Active branch must belong to a legal entity');
  }

  const payloadHash = sha256Canonical({
    supplierId: input.supplierId,
    goodsReceiptId: input.goodsReceiptId ?? null,
    invoiceNumber: input.invoiceNumber.trim(),
    invoiceDate: input.invoiceDate,
    totalMinor: input.totalMinor,
  });

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const existingCmd = store.commands.find(
      (c) => c.tenantId === context.tenantId && c.actorUserId === context.userId && c.commandType === 'pharmacy.supplier_invoice.post' && c.idempotencyKey === input.idempotencyKey
    );
    if (existingCmd) {
      if (existingCmd.payloadHash !== payloadHash) throw new ConflictError('Idempotency key already used with a different invoice payload');
      if (existingCmd.state === 'committed' && existingCmd.resultJson) return { ...(existingCmd.resultJson as Record<string, unknown>), idempotentReplay: true };
    }
    const supplier = store.suppliers.find((s) => s.id === input.supplierId && s.tenantId === context.tenantId && s.legalEntityId === context.legalEntityId);
    if (!supplier) throw new NotFoundError('Supplier not found in active legal entity');
    if (input.goodsReceiptId && !store.goodsReceipts.some((g) => g.id === input.goodsReceiptId && g.tenantId === context.tenantId && g.supplierId === supplier.id)) {
      throw new NotFoundError('Linked goods receipt not found for supplier');
    }
    if (store.supplierInvoices.some((i) => i.tenantId === context.tenantId && i.supplierId === supplier.id && i.invoiceNumber === input.invoiceNumber.trim())) {
      throw new ConflictError(`Invoice number "${input.invoiceNumber}" already exists for supplier`);
    }
    const cmdId = crypto.randomUUID();
    const now = new Date();
    const invoice = {
      id: crypto.randomUUID(), tenantId: context.tenantId, legalEntityId: context.legalEntityId, branchId: context.branchId,
      supplierId: supplier.id, goodsReceiptId: input.goodsReceiptId ?? null, invoiceNumber: input.invoiceNumber.trim(),
      invoiceDate: input.invoiceDate, totalMinor: input.totalMinor, currency: context.currency, status: 'posted',
      commandId: cmdId, createdByUserId: context.userId, createdAt: now,
    };
    store.supplierInvoices.push(invoice);
    const responsePayload = { invoice, stockImpact: 'none', idempotentReplay: false };
    store.commands.push({
      id: cmdId, tenantId: context.tenantId, actorUserId: context.userId, commandType: 'pharmacy.supplier_invoice.post',
      idempotencyKey: input.idempotencyKey, payloadHash, proposalId: null, state: 'committed', resultJson: responsePayload, committedAt: now,
    });
    addMemAuditEvent({
      tenantId: context.tenantId, actorUserId: context.userId, actorUid: context.uid,
      action: 'pharmacy.supplier_invoice_posted', entityType: 'supplier_invoice', entityId: invoice.id, correlationId,
      metadataJson: { invoiceNumber: invoice.invoiceNumber, stockImpact: 'none' },
    });
    return responsePayload;
  }

  const [existingCmd] = await db
    .select()
    .from(commands)
    .where(
      and(
        eq(commands.tenantId, context.tenantId),
        eq(commands.actorUserId, context.userId),
        eq(commands.commandType, 'pharmacy.supplier_invoice.post'),
        eq(commands.idempotencyKey, input.idempotencyKey)
      )
    )
    .limit(1);

  if (existingCmd) {
    if (existingCmd.payloadHash !== payloadHash) {
      throw new ConflictError('Idempotency key already used with a different invoice payload');
    }
    if (existingCmd.state === 'committed' && existingCmd.resultJson) {
      return {
        ...(existingCmd.resultJson as Record<string, unknown>),
        idempotentReplay: true,
      };
    }
  }

  return db.transaction(async (tx) => {
    const [cmd] = await tx
      .insert(commands)
      .values({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        commandType: 'pharmacy.supplier_invoice.post',
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        state: 'accepted',
      })
      .returning();

    const [supplier] = await tx
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(
        and(
          eq(suppliers.id, input.supplierId),
          eq(suppliers.tenantId, context.tenantId),
          eq(suppliers.legalEntityId, context.legalEntityId!)
        )
      )
      .limit(1);

    if (!supplier) {
      throw new NotFoundError('Supplier not found in active legal entity');
    }

    if (input.goodsReceiptId) {
      const [grn] = await tx
        .select({ id: goodsReceipts.id })
        .from(goodsReceipts)
        .where(
          and(
            eq(goodsReceipts.id, input.goodsReceiptId),
            eq(goodsReceipts.tenantId, context.tenantId),
            eq(goodsReceipts.supplierId, supplier.id)
          )
        )
        .limit(1);

      if (!grn) {
        throw new NotFoundError('Linked goods receipt not found for supplier');
      }
    }

    const dupInv = await tx
      .select({ id: supplierInvoices.id })
      .from(supplierInvoices)
      .where(
        and(
          eq(supplierInvoices.tenantId, context.tenantId),
          eq(supplierInvoices.supplierId, supplier.id),
          eq(supplierInvoices.invoiceNumber, input.invoiceNumber.trim())
        )
      )
      .limit(1);

    if (dupInv.length > 0) {
      throw new ConflictError(`Invoice number "${input.invoiceNumber}" already exists for supplier`);
    }

    const [invoice] = await tx
      .insert(supplierInvoices)
      .values({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId!,
        branchId: context.branchId,
        supplierId: supplier.id,
        goodsReceiptId: input.goodsReceiptId ?? null,
        invoiceNumber: input.invoiceNumber.trim(),
        invoiceDate: input.invoiceDate,
        totalMinor: input.totalMinor,
        currency: context.currency,
        status: 'posted',
        commandId: cmd.id,
        createdByUserId: context.userId,
      })
      .returning();

    const responsePayload = {
      invoice,
      stockImpact: 'none',
      idempotentReplay: false,
    };

    await tx
      .update(commands)
      .set({
        state: 'committed',
        resultJson: responsePayload,
        committedAt: new Date(),
      })
      .where(eq(commands.id, cmd.id));

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.supplier_invoice_posted',
      entityType: 'supplier_invoice',
      entityId: invoice.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: {
        invoiceNumber: invoice.invoiceNumber,
        goodsReceiptId: invoice.goodsReceiptId,
        totalMinor: invoice.totalMinor,
        stockImpact: 'none',
      },
    });

    return responsePayload;
  });
}

export async function transitionLotQuality(
  context: ActiveWorkspaceContext,
  lotId: string,
  input: {
    action: 'release_to_sellable' | 'place_quarantine' | 'place_recall_hold';
    reason: string;
    locationId?: string;
    qtyBase?: number;
  },
  correlationId: string
) {
  assertCapability(context, 'pharmacy.inventory');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const businessDate = getBusinessDateInTimezone(context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const lot = store.lots.find((l) => l.id === lotId && l.tenantId === context.tenantId && l.branchId === context.branchId);
    if (!lot) throw new NotFoundError('Lot not found in active branch');

    if (input.action === 'release_to_sellable') {
      const grant = await assertProfessionalGrant(context, 'pharmacist');
      if (lot.expiryPrecision === 'unknown' || !lot.expiryCutoffDate) {
        throw new ConflictError('Lot with unknown expiry cannot be released to sellable inventory', 'UNKNOWN_EXPIRY_QUARANTINED');
      }
      if (lot.expiryCutoffDate < businessDate) {
        throw new ConflictError(`Lot expired on ${lot.expiryCutoffDate} and cannot be released to sellable inventory`, 'EXPIRED_LOT_BLOCKED');
      }
      const activeRecall = store.recalls.find(
        (r) => r.tenantId === context.tenantId && r.status === 'active' && (r.lotId === lot.id || r.productId === lot.productId || r.manufacturer === lot.manufacturer)
      );
      if (activeRecall) throw new ConflictError(`Active recall ${activeRecall.referenceCode} prevents release of this lot`, 'ACTIVE_RECALL_BLOCK');

      const balances = store.inventoryBalances.filter(
        (b) => b.tenantId === context.tenantId && b.branchId === context.branchId && b.lotId === lot.id && (!input.locationId || b.locationId === input.locationId)
      );
      let totalReleased = 0;
      const now = new Date();
      for (const bal of balances) {
        if (bal.quarantineQty <= 0) continue;
        const moveQty = input.qtyBase ? Math.min(bal.quarantineQty, input.qtyBase - totalReleased) : bal.quarantineQty;
        if (moveQty <= 0) continue;
        bal.quarantineQty -= moveQty; bal.sellableOnHand += moveQty; bal.version += 1; bal.updatedAt = now;
        store.stockMovements.push({
          id: crypto.randomUUID(), tenantId: context.tenantId, branchId: context.branchId, locationId: bal.locationId, productId: lot.productId, lotId: lot.id, costLayerId: null,
          movementType: 'quality_release', qtyBase: moveQty, fromBucket: 'quarantine', toBucket: 'sellable', reason: input.reason.trim(),
          sourceDocType: 'quality_release', sourceDocId: lot.id, commandId: null, packVariantId: null, uomConversionVersion: null, actorUserId: context.userId, occurredAt: now, createdAt: now,
        });
        totalReleased += moveQty;
      }
      if (totalReleased <= 0) throw new ValidationError('No quarantined balance available on this lot to release');
      lot.qualityStatus = 'released'; lot.releasedByGrantId = grant.id; lot.releasedAt = now; lot.updatedAt = now;
      addMemAuditEvent({
        tenantId: context.tenantId, actorUserId: context.userId, actorUid: context.uid,
        action: 'pharmacy.lot_released_to_sellable', entityType: 'lot', entityId: lot.id, correlationId,
        metadataJson: { releasedByGrantId: grant.id, qtyBaseReleased: totalReleased },
      });
      return { lot, releasedByGrantId: grant.id, qtyBaseReleased: totalReleased };
    }

    assertPermission(context, 'pharmacy.lot.quarantine_place');
    const balances = store.inventoryBalances.filter(
      (b) => b.tenantId === context.tenantId && b.branchId === context.branchId && b.lotId === lot.id && (!input.locationId || b.locationId === input.locationId)
    );
    let totalMoved = 0;
    const isRecall = input.action === 'place_recall_hold';
    const now = new Date();
    for (const bal of balances) {
      if (bal.sellableOnHand <= 0) continue;
      const moveQty = bal.sellableOnHand;
      bal.sellableOnHand = 0; bal.reservedQty = 0;
      if (isRecall) bal.recalledQty += moveQty; else bal.quarantineQty += moveQty;
      bal.version += 1; bal.updatedAt = now;
      store.stockMovements.push({
        id: crypto.randomUUID(), tenantId: context.tenantId, branchId: context.branchId, locationId: bal.locationId, productId: lot.productId, lotId: lot.id, costLayerId: null,
        movementType: isRecall ? 'recall_block' : 'quarantine_hold', qtyBase: moveQty, fromBucket: 'sellable', toBucket: isRecall ? 'recalled' : 'quarantine', reason: input.reason.trim(),
        sourceDocType: isRecall ? 'recall' : 'quality_hold', sourceDocId: lot.id, commandId: null, packVariantId: null, uomConversionVersion: null, actorUserId: context.userId, occurredAt: now, createdAt: now,
      });
      totalMoved += moveQty;
    }
    lot.qualityStatus = isRecall ? 'blocked' : 'quarantine'; lot.quarantineReason = input.reason.trim(); lot.updatedAt = now;
    if (isRecall) {
      store.recalls.push({
        id: crypto.randomUUID(), tenantId: context.tenantId, scopeType: 'lot', productId: lot.productId, lotId: lot.id,
        manufacturer: lot.manufacturer, referenceCode: `REC-${lot.batchNumber}`, reason: input.reason.trim(), status: 'active', effectiveAt: now, activatedByUserId: context.userId, createdAt: now,
      });
    }
    addMemAuditEvent({
      tenantId: context.tenantId, actorUserId: context.userId, actorUid: context.uid,
      action: isRecall ? 'pharmacy.lot_recall_blocked' : 'pharmacy.lot_quarantined', entityType: 'lot', entityId: lot.id, correlationId,
      metadataJson: { qtyBaseMoved: totalMoved, reason: input.reason.trim() },
    });
    return { lot, qtyBaseHeld: totalMoved };
  }

  if (input.action === 'release_to_sellable') {
    // Owner / Admin membership does NOT bypass active pharmacist grant (U11 / P10)
    const grant = await assertProfessionalGrant(context, 'pharmacist');

    return db.transaction(async (tx) => {
      const [lot] = await tx
        .select()
        .from(lots)
        .where(
          and(
            eq(lots.id, lotId),
            eq(lots.tenantId, context.tenantId),
            eq(lots.branchId, context.branchId)
          )
        )
        .limit(1);

      if (!lot) {
        throw new NotFoundError('Lot not found in active branch');
      }

      if (lot.expiryPrecision === 'unknown' || !lot.expiryCutoffDate) {
        throw new ConflictError(
          'Lot with unknown expiry cannot be released to sellable inventory',
          'UNKNOWN_EXPIRY_QUARANTINED'
        );
      }

      if (lot.expiryCutoffDate < businessDate) {
        throw new ConflictError(
          `Lot expired on ${lot.expiryCutoffDate} and cannot be released to sellable inventory`,
          'EXPIRED_LOT_BLOCKED'
        );
      }

      const activeRecall = await tx
        .select({ id: recalls.id, referenceCode: recalls.referenceCode })
        .from(recalls)
        .where(
          and(
            eq(recalls.tenantId, context.tenantId),
            eq(recalls.status, 'active'),
            or(
              eq(recalls.lotId, lot.id),
              eq(recalls.productId, lot.productId),
              eq(recalls.manufacturer, lot.manufacturer)
            )
          )
        )
        .limit(1);

      if (activeRecall.length > 0) {
        throw new ConflictError(
          `Active recall ${activeRecall[0].referenceCode} prevents release of this lot`,
          'ACTIVE_RECALL_BLOCK'
        );
      }

      const balances = await tx
        .select()
        .from(inventoryBalances)
        .where(
          and(
            eq(inventoryBalances.tenantId, context.tenantId),
            eq(inventoryBalances.branchId, context.branchId),
            eq(inventoryBalances.lotId, lot.id),
            ...(input.locationId ? [eq(inventoryBalances.locationId, input.locationId)] : [])
          )
        );

      let totalReleased = 0;

      for (const bal of balances) {
        if (bal.quarantineQty <= 0) continue;
        const moveQty = input.qtyBase
          ? Math.min(bal.quarantineQty, input.qtyBase - totalReleased)
          : bal.quarantineQty;
        if (moveQty <= 0) continue;

        await tx
          .update(inventoryBalances)
          .set({
            quarantineQty: sql`${inventoryBalances.quarantineQty} - ${moveQty}`,
            sellableOnHand: sql`${inventoryBalances.sellableOnHand} + ${moveQty}`,
            version: sql`${inventoryBalances.version} + 1`,
            updatedAt: new Date(),
          })
          .where(eq(inventoryBalances.id, bal.id));

        await tx.insert(stockMovements).values({
          tenantId: context.tenantId,
          branchId: context.branchId,
          locationId: bal.locationId,
          productId: lot.productId,
          lotId: lot.id,
          movementType: 'quality_release',
          qtyBase: moveQty,
          fromBucket: 'quarantine',
          toBucket: 'sellable',
          reason: input.reason.trim(),
          sourceDocType: 'quality_release',
          sourceDocId: lot.id,
          actorUserId: context.userId,
        });

        totalReleased += moveQty;
      }

      if (totalReleased <= 0) {
        throw new ValidationError('No quarantined balance available on this lot to release');
      }

      const [updatedLot] = await tx
        .update(lots)
        .set({
          qualityStatus: 'released',
          releasedByGrantId: grant.id,
          releasedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(lots.id, lot.id))
        .returning();

      await tx
        .update(qualityHolds)
        .set({
          status: 'released',
          releasedByGrantId: grant.id,
          releasedAt: new Date(),
        })
        .where(
          and(
            eq(qualityHolds.tenantId, context.tenantId),
            eq(qualityHolds.lotId, lot.id),
            eq(qualityHolds.status, 'active')
          )
        );

      await tx.insert(auditEvents).values({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorUid: context.uid,
        action: 'pharmacy.lot_released_to_sellable',
        entityType: 'lot',
        entityId: lot.id,
        inputSource: 'ui',
        correlationId,
        metadataJson: {
          releasedByGrantId: grant.id,
          licenseNumber: grant.licenseNumber,
          qtyBaseReleased: totalReleased,
          reason: input.reason.trim(),
        },
      });

      return {
        lot: updatedLot,
        releasedByGrantId: grant.id,
        qtyBaseReleased: totalReleased,
      };
    });
  }

  // Place quarantine or recall hold
  assertPermission(context, 'pharmacy.lot.quarantine_place');

  return db.transaction(async (tx) => {
    const [lot] = await tx
      .select()
      .from(lots)
      .where(
        and(
          eq(lots.id, lotId),
          eq(lots.tenantId, context.tenantId),
          eq(lots.branchId, context.branchId)
        )
      )
      .limit(1);

    if (!lot) {
      throw new NotFoundError('Lot not found in active branch');
    }

    const balances = await tx
      .select()
      .from(inventoryBalances)
      .where(
        and(
          eq(inventoryBalances.tenantId, context.tenantId),
          eq(inventoryBalances.branchId, context.branchId),
          eq(inventoryBalances.lotId, lot.id),
          ...(input.locationId ? [eq(inventoryBalances.locationId, input.locationId)] : [])
        )
      );

    // Release active reservations first so held stock can move safely
    await tx
      .update(stockReservations)
      .set({ status: 'invalidated', updatedAt: new Date() })
      .where(
        and(
          eq(stockReservations.tenantId, context.tenantId),
          eq(stockReservations.lotId, lot.id),
          eq(stockReservations.status, 'active')
        )
      );

    let totalMoved = 0;
    const isRecall = input.action === 'place_recall_hold';

    for (const bal of balances) {
      if (bal.sellableOnHand <= 0) continue;
      const moveQty = bal.sellableOnHand;

      await tx
        .update(inventoryBalances)
        .set({
          sellableOnHand: 0,
          reservedQty: 0,
          ...(isRecall
            ? { recalledQty: sql`${inventoryBalances.recalledQty} + ${moveQty}` }
            : { quarantineQty: sql`${inventoryBalances.quarantineQty} + ${moveQty}` }),
          version: sql`${inventoryBalances.version} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(inventoryBalances.id, bal.id));

      await tx.insert(stockMovements).values({
        tenantId: context.tenantId,
        branchId: context.branchId,
        locationId: bal.locationId,
        productId: lot.productId,
        lotId: lot.id,
        movementType: isRecall ? 'recall_block' : 'quarantine_hold',
        qtyBase: moveQty,
        fromBucket: 'sellable',
        toBucket: isRecall ? 'recalled' : 'quarantine',
        reason: input.reason.trim(),
        sourceDocType: isRecall ? 'recall' : 'quality_hold',
        sourceDocId: lot.id,
        actorUserId: context.userId,
      });

      totalMoved += moveQty;
    }

    const [updatedLot] = await tx
      .update(lots)
      .set({
        qualityStatus: isRecall ? 'blocked' : 'quarantine',
        quarantineReason: input.reason.trim(),
        updatedAt: new Date(),
      })
      .where(eq(lots.id, lot.id))
      .returning();

    await tx.insert(qualityHolds).values({
      tenantId: context.tenantId,
      branchId: context.branchId,
      productId: lot.productId,
      lotId: lot.id,
      holdType: isRecall ? 'recall' : 'quarantine',
      reason: input.reason.trim(),
      status: 'active',
      placedByUserId: context.userId,
    });

    if (isRecall) {
      await tx.insert(recalls).values({
        tenantId: context.tenantId,
        scopeType: 'lot',
        productId: lot.productId,
        lotId: lot.id,
        manufacturer: lot.manufacturer,
        referenceCode: `REC-${lot.batchNumber}`,
        reason: input.reason.trim(),
        status: 'active',
        activatedByUserId: context.userId,
      });
    }

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: isRecall ? 'pharmacy.lot_recall_blocked' : 'pharmacy.lot_quarantined',
      entityType: 'lot',
      entityId: lot.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: {
        qtyBaseMoved: totalMoved,
        reason: input.reason.trim(),
      },
    });

    return {
      lot: updatedLot,
      qtyBaseHeld: totalMoved,
    };
  });
}

export async function getStockAndLotSummary(context: ActiveWorkspaceContext) {
  assertCapability(context, 'pharmacy.inventory');
  assertPermission(context, 'pharmacy.stock.read');

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const balances = store.inventoryBalances
      .filter((b) => b.tenantId === context.tenantId && b.branchId === context.branchId)
      .map((b) => {
        const loc = store.storageLocations.find((l) => l.id === b.locationId);
        const prod = store.products.find((p) => p.id === b.productId);
        const lot = store.lots.find((l) => l.id === b.lotId);
        return {
          balanceId: b.id, locationId: b.locationId, locationCode: loc?.code ?? '', locationName: loc?.name ?? 'Storage', locationType: loc?.locationType ?? 'dispensary',
          productId: b.productId, skuCode: prod?.skuCode ?? '', productName: prod?.displayName ?? 'Product', genericName: prod?.genericName ?? '',
          strengthValue: prod?.strengthValue ?? '', strengthUnit: prod?.strengthUnit ?? '', dosageForm: prod?.dosageForm ?? 'tablet',
          regulatoryClass: prod?.regulatoryClass ?? 'otc', requiresPharmacistRelease: prod?.requiresPharmacistRelease ?? false, baseUnit: prod?.baseUnit ?? 'unit',
          lotId: b.lotId, batchNumber: lot?.batchNumber ?? '', manufacturer: lot?.manufacturer ?? '', printedExpiry: lot?.printedExpiry ?? '',
          expiryPrecision: lot?.expiryPrecision ?? 'day', expiryCutoffDate: lot?.expiryCutoffDate ?? null, qualityStatus: lot?.qualityStatus ?? 'quarantine',
          quarantineReason: lot?.quarantineReason ?? '', releasedByGrantId: lot?.releasedByGrantId ?? null,
          sellableOnHand: b.sellableOnHand, reservedQty: b.reservedQty, quarantineQty: b.quarantineQty, returnedQuarantineQty: b.returnedQuarantineQty,
          damagedQty: b.damagedQty, expiredQty: b.expiredQty, recalledQty: b.recalledQty, disposedQty: b.disposedQty,
          availableQty: Math.max(0, b.sellableOnHand - b.reservedQty),
        };
      })
      .sort((a, b) => a.productName.localeCompare(b.productName) || (a.expiryCutoffDate || '9999-12-31').localeCompare(b.expiryCutoffDate || '9999-12-31'));

    const recentMovements = store.stockMovements
      .filter((m) => m.tenantId === context.tenantId && m.branchId === context.branchId)
      .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
      .slice(0, 50)
      .map((m) => ({
        id: m.id, productId: m.productId, productName: store.products.find((p) => p.id === m.productId)?.displayName ?? 'Product',
        lotId: m.lotId, batchNumber: store.lots.find((l) => l.id === m.lotId)?.batchNumber ?? '', movementType: m.movementType, qtyBase: m.qtyBase,
        fromBucket: m.fromBucket, toBucket: m.toBucket, reason: m.reason, sourceDocType: m.sourceDocType, uomConversionVersion: m.uomConversionVersion, occurredAt: m.occurredAt,
      }));
    return { balances, recentMovements };
  }

  const balanceRows = await db
    .select({
      balanceId: inventoryBalances.id,
      locationId: storageLocations.id,
      locationCode: storageLocations.code,
      locationName: storageLocations.name,
      locationType: storageLocations.locationType,
      productId: products.id,
      skuCode: products.skuCode,
      productName: products.displayName,
      genericName: products.genericName,
      strengthValue: products.strengthValue,
      strengthUnit: products.strengthUnit,
      dosageForm: products.dosageForm,
      regulatoryClass: products.regulatoryClass,
      requiresPharmacistRelease: products.requiresPharmacistRelease,
      baseUnit: products.baseUnit,
      lotId: lots.id,
      batchNumber: lots.batchNumber,
      manufacturer: lots.manufacturer,
      printedExpiry: lots.printedExpiry,
      expiryPrecision: lots.expiryPrecision,
      expiryCutoffDate: lots.expiryCutoffDate,
      qualityStatus: lots.qualityStatus,
      quarantineReason: lots.quarantineReason,
      releasedByGrantId: lots.releasedByGrantId,
      sellableOnHand: inventoryBalances.sellableOnHand,
      reservedQty: inventoryBalances.reservedQty,
      quarantineQty: inventoryBalances.quarantineQty,
      returnedQuarantineQty: inventoryBalances.returnedQuarantineQty,
      damagedQty: inventoryBalances.damagedQty,
      expiredQty: inventoryBalances.expiredQty,
      recalledQty: inventoryBalances.recalledQty,
      disposedQty: inventoryBalances.disposedQty,
    })
    .from(inventoryBalances)
    .innerJoin(
      storageLocations,
      and(
        eq(inventoryBalances.locationId, storageLocations.id),
        eq(storageLocations.tenantId, context.tenantId)
      )
    )
    .innerJoin(
      products,
      and(eq(inventoryBalances.productId, products.id), eq(products.tenantId, context.tenantId))
    )
    .innerJoin(
      lots,
      and(eq(inventoryBalances.lotId, lots.id), eq(lots.tenantId, context.tenantId))
    )
    .where(
      and(
        eq(inventoryBalances.tenantId, context.tenantId),
        eq(inventoryBalances.branchId, context.branchId)
      )
    )
    .orderBy(asc(products.displayName), asc(lots.expiryCutoffDate));

  const recentMovements = await db
    .select({
      id: stockMovements.id,
      productId: stockMovements.productId,
      productName: products.displayName,
      lotId: stockMovements.lotId,
      batchNumber: lots.batchNumber,
      movementType: stockMovements.movementType,
      qtyBase: stockMovements.qtyBase,
      fromBucket: stockMovements.fromBucket,
      toBucket: stockMovements.toBucket,
      reason: stockMovements.reason,
      sourceDocType: stockMovements.sourceDocType,
      uomConversionVersion: stockMovements.uomConversionVersion,
      occurredAt: stockMovements.occurredAt,
    })
    .from(stockMovements)
    .innerJoin(
      products,
      and(eq(stockMovements.productId, products.id), eq(products.tenantId, context.tenantId))
    )
    .innerJoin(
      lots,
      and(eq(stockMovements.lotId, lots.id), eq(lots.tenantId, context.tenantId))
    )
    .where(
      and(
        eq(stockMovements.tenantId, context.tenantId),
        eq(stockMovements.branchId, context.branchId)
      )
    )
    .orderBy(desc(stockMovements.occurredAt))
    .limit(50);

  return {
    balances: balanceRows.map((b) => ({
      ...b,
      availableQty: Math.max(0, b.sellableOnHand - b.reservedQty),
    })),
    recentMovements,
  };
}
