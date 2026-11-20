import crypto from 'node:crypto';
import { and, asc, desc, eq, ilike, ne, or } from 'drizzle-orm';
import { db, isDatabaseConfigured } from '../db/index.ts';
import {
  auditEvents,
  barcodeAliases,
  packVariants,
  products,
  uomConversions,
} from '../db/schema.ts';
import type { CreateProductInput } from '../contracts/pharmacy.ts';
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from './errors.ts';
import { addMemAuditEvent, getMemoryStore } from './memory-store.ts';
import { assertWorkspaceNotReadOnlyGrace } from './subscription-billing.ts';
import {
  assertCapability,
  assertPermission,
  type ActiveWorkspaceContext,
} from './tenancy.ts';

export function computeBaseUnits(packs: number, baseQtyPerPack: number): number {
  if (!Number.isInteger(packs) || packs < 0 || !Number.isInteger(baseQtyPerPack) || baseQtyPerPack <= 0) {
    throw new ValidationError('Invalid pack or conversion quantity');
  }
  return packs * baseQtyPerPack;
}

function normalizeSearchName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

export async function listCatalogueProducts(
  context: ActiveWorkspaceContext,
  query?: string
) {
  assertCapability(context, 'pharmacy.catalogue');
  assertPermission(context, 'pharmacy.catalogue.read');

  const trimmed = query?.trim() || '';

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const pattern = trimmed.toLowerCase();
    const matchedByBarcode = trimmed
      ? new Set(
          store.barcodeAliases
            .filter((b) => b.tenantId === context.tenantId && b.barcode === trimmed)
            .map((b) => b.productId)
        )
      : new Set<string>();

    const productRows = store.products
      .filter((p) => {
        if (p.tenantId !== context.tenantId) return false;
        if (context.legalEntityId && p.legalEntityId !== context.legalEntityId) return false;
        if (!trimmed) return true;
        return (
          matchedByBarcode.has(p.id) ||
          p.skuCode.toLowerCase().includes(pattern) ||
          p.displayName.toLowerCase().includes(pattern) ||
          p.genericName.toLowerCase().includes(pattern) ||
          p.brandName.toLowerCase().includes(pattern)
        );
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
      .slice(0, 100);

    const items = productRows.map((p) => ({
      ...p,
      variants: store.packVariants
        .filter((v) => v.tenantId === context.tenantId && v.productId === p.id)
        .sort((a, b) => a.variantName.localeCompare(b.variantName))
        .map((v) => ({
          ...v,
          conversionHistory: store.uomConversions
            .filter((c) => c.tenantId === context.tenantId && c.packVariantId === v.id)
            .sort((a, b) => b.version - a.version),
          barcodes: store.barcodeAliases
            .filter((b) => b.tenantId === context.tenantId && b.packVariantId === v.id)
            .sort((a, b) => a.barcode.localeCompare(b.barcode)),
        })),
    }));

    return {
      items,
      ambiguityWarning: Boolean(trimmed && items.length > 1),
    };
  }

  const whereClauses = [eq(products.tenantId, context.tenantId)];
  if (context.legalEntityId) {
    whereClauses.push(eq(products.legalEntityId, context.legalEntityId));
  }

  let matchedProductIdsByBarcode: string[] = [];
  if (trimmed) {
    const barcodeHits = await db
      .select({ productId: barcodeAliases.productId })
      .from(barcodeAliases)
      .where(
        and(
          eq(barcodeAliases.tenantId, context.tenantId),
          eq(barcodeAliases.barcode, trimmed)
        )
      );
    matchedProductIdsByBarcode = barcodeHits.map((b) => b.productId);

    const pattern = `%${trimmed.toLowerCase()}%`;
    whereClauses.push(
      or(
        ilike(products.skuCode, pattern),
        ilike(products.displayName, pattern),
        ilike(products.genericName, pattern),
        ilike(products.brandName, pattern)
      )!
    );
  }

  let productRows = await db
    .select()
    .from(products)
    .where(and(...whereClauses))
    .orderBy(asc(products.displayName))
    .limit(100);

  if (trimmed && matchedProductIdsByBarcode.length > 0 && productRows.length === 0) {
    productRows = await db
      .select()
      .from(products)
      .where(
        and(
          eq(products.tenantId, context.tenantId),
          or(...matchedProductIdsByBarcode.map((id) => eq(products.id, id)))!
        )
      )
      .orderBy(asc(products.displayName));
  }

  const allVariants = await db
    .select()
    .from(packVariants)
    .where(eq(packVariants.tenantId, context.tenantId))
    .orderBy(asc(packVariants.variantName));

  const allConversions = await db
    .select()
    .from(uomConversions)
    .where(eq(uomConversions.tenantId, context.tenantId))
    .orderBy(desc(uomConversions.version));

  const allBarcodes = await db
    .select()
    .from(barcodeAliases)
    .where(eq(barcodeAliases.tenantId, context.tenantId))
    .orderBy(asc(barcodeAliases.barcode));

  const items = productRows.map((p) => {
    const variants = allVariants
      .filter((v) => v.productId === p.id)
      .map((v) => ({
        ...v,
        conversionHistory: allConversions.filter((c) => c.packVariantId === v.id),
        barcodes: allBarcodes.filter((b) => b.packVariantId === v.id),
      }));

    return {
      ...p,
      variants,
    };
  });

  return {
    items,
    ambiguityWarning: Boolean(trimmed && items.length > 1),
  };
}

export async function createProduct(
  context: ActiveWorkspaceContext,
  input: CreateProductInput,
  correlationId: string
) {
  assertCapability(context, 'pharmacy.catalogue');
  assertPermission(context, 'pharmacy.catalogue.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (!context.legalEntityId) {
    throw new ValidationError('Active branch must belong to a legal entity before adding SKUs');
  }

  const requiresPharmacistRelease = input.regulatoryClass !== 'otc';

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const dup = store.products.find(
      (p) => p.tenantId === context.tenantId && p.skuCode === input.skuCode.trim()
    );
    if (dup) {
      throw new ConflictError(
        `SKU code "${input.skuCode}" already exists in this workspace`,
        'DUPLICATE_SKU'
      );
    }

    const now = new Date();
    const product = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      legalEntityId: context.legalEntityId,
      skuCode: input.skuCode.trim(),
      displayName: input.displayName.trim(),
      normalizedName: normalizeSearchName(
        `${input.displayName} ${input.genericName} ${input.brandName} ${input.strengthValue}${input.strengthUnit}`
      ),
      genericName: input.genericName.trim(),
      brandName: input.brandName?.trim() || '',
      strengthValue: input.strengthValue.trim(),
      strengthUnit: input.strengthUnit.trim(),
      dosageForm: input.dosageForm,
      route: input.route?.trim() || 'oral',
      manufacturer: input.manufacturer.trim(),
      regulatoryClass: input.regulatoryClass,
      requiresPharmacistRelease,
      storageCondition: input.storageCondition,
      baseUnit: input.baseUnit,
      minShelfLifeDays: input.minShelfLifeDays,
      reorderPointBase: input.reorderPointBase ?? 50,
      targetParBase: input.targetParBase ?? 200,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    store.products.push(product);

    let createdVariant = null;
    let barcodeConflict = false;
    if (input.initialPack) {
      const variant = {
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        productId: product.id,
        variantName: input.initialPack.variantName.trim(),
        packUnit: input.initialPack.packUnit,
        currentBaseQty: input.initialPack.baseQtyPerPack,
        currentConversionVersion: 1,
        defaultSalePriceMinor: input.initialPack.defaultSalePriceMinor,
        currency: context.currency,
        allowPosSale: true,
        active: true,
        createdAt: now,
        updatedAt: now,
      };
      store.packVariants.push(variant);
      store.uomConversions.push({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        productId: product.id,
        packVariantId: variant.id,
        version: 1,
        packUnit: variant.packUnit,
        baseUnit: product.baseUnit,
        baseQtyPerPack: input.initialPack.baseQtyPerPack,
        effectiveFrom: now,
        createdByUserId: context.userId,
        notes: 'Initial pack conversion',
        createdAt: now,
      });

      if (input.initialPack.barcode) {
        const cleanCode = input.initialPack.barcode.trim();
        barcodeConflict = store.barcodeAliases.some(
          (b) => b.tenantId === context.tenantId && b.barcode === cleanCode
        );
        store.barcodeAliases.push({
          id: crypto.randomUUID(),
          tenantId: context.tenantId,
          productId: product.id,
          packVariantId: variant.id,
          barcode: cleanCode,
          barcodeType: input.initialPack.barcodeType,
          status: barcodeConflict ? 'conflict_review' : 'active',
          createdAt: now,
        });
      }
      createdVariant = variant;
    }

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.product_created',
      entityType: 'product',
      entityId: product.id,
      correlationId,
      metadataJson: {
        skuCode: product.skuCode,
        regulatoryClass: product.regulatoryClass,
        requiresPharmacistRelease: product.requiresPharmacistRelease,
        barcodeConflict,
      },
    });

    return {
      product,
      initialPackVariant: createdVariant,
      barcodeConflict,
    };
  }

  const existingSku = await db
    .select({ id: products.id })
    .from(products)
    .where(
      and(
        eq(products.tenantId, context.tenantId),
        eq(products.skuCode, input.skuCode.trim())
      )
    )
    .limit(1);

  if (existingSku.length > 0) {
    throw new ConflictError(
      `SKU code "${input.skuCode}" already exists in this workspace`,
      'DUPLICATE_SKU'
    );
  }

  const result = await db.transaction(async (tx) => {
    const [product] = await tx
      .insert(products)
      .values({
        tenantId: context.tenantId,
        legalEntityId: context.legalEntityId!,
        skuCode: input.skuCode.trim(),
        displayName: input.displayName.trim(),
        normalizedName: normalizeSearchName(
          `${input.displayName} ${input.genericName} ${input.brandName} ${input.strengthValue}${input.strengthUnit}`
        ),
        genericName: input.genericName.trim(),
        brandName: input.brandName?.trim() || '',
        strengthValue: input.strengthValue.trim(),
        strengthUnit: input.strengthUnit.trim(),
        dosageForm: input.dosageForm,
        route: input.route?.trim() || 'oral',
        manufacturer: input.manufacturer.trim(),
        regulatoryClass: input.regulatoryClass,
        requiresPharmacistRelease,
        storageCondition: input.storageCondition,
        baseUnit: input.baseUnit,
        minShelfLifeDays: input.minShelfLifeDays,
        reorderPointBase: input.reorderPointBase ?? 50,
        targetParBase: input.targetParBase ?? 200,
      })
      .returning();

    let createdVariant = null;
    let barcodeConflict = false;

    if (input.initialPack) {
      const [variant] = await tx
        .insert(packVariants)
        .values({
          tenantId: context.tenantId,
          productId: product.id,
          variantName: input.initialPack.variantName.trim(),
          packUnit: input.initialPack.packUnit,
          currentBaseQty: input.initialPack.baseQtyPerPack,
          currentConversionVersion: 1,
          defaultSalePriceMinor: input.initialPack.defaultSalePriceMinor,
          currency: context.currency,
          allowPosSale: true,
        })
        .returning();

      await tx.insert(uomConversions).values({
        tenantId: context.tenantId,
        productId: product.id,
        packVariantId: variant.id,
        version: 1,
        packUnit: variant.packUnit,
        baseUnit: product.baseUnit,
        baseQtyPerPack: input.initialPack.baseQtyPerPack,
        createdByUserId: context.userId,
        notes: 'Initial pack conversion',
      });

      if (input.initialPack.barcode) {
        const collision = await tx
          .select({ id: barcodeAliases.id })
          .from(barcodeAliases)
          .where(
            and(
              eq(barcodeAliases.tenantId, context.tenantId),
              eq(barcodeAliases.barcode, input.initialPack.barcode.trim())
            )
          )
          .limit(1);

        barcodeConflict = collision.length > 0;
        await tx.insert(barcodeAliases).values({
          tenantId: context.tenantId,
          productId: product.id,
          packVariantId: variant.id,
          barcode: input.initialPack.barcode.trim(),
          barcodeType: input.initialPack.barcodeType,
          status: barcodeConflict ? 'conflict_review' : 'active',
        });
      }

      createdVariant = variant;
    }

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.product_created',
      entityType: 'product',
      entityId: product.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: {
        skuCode: product.skuCode,
        regulatoryClass: product.regulatoryClass,
        requiresPharmacistRelease: product.requiresPharmacistRelease,
        barcodeConflict,
      },
    });

    return {
      product,
      initialPackVariant: createdVariant,
      barcodeConflict,
    };
  });

  return result;
}

export async function addPackVariant(
  context: ActiveWorkspaceContext,
  productId: string,
  input: {
    variantName: string;
    packUnit: string;
    baseQtyPerPack: number;
    defaultSalePriceMinor: number;
    allowPosSale: boolean;
    barcode?: string;
    barcodeType: string;
  },
  correlationId: string
) {
  assertCapability(context, 'pharmacy.catalogue');
  assertPermission(context, 'pharmacy.catalogue.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const product = store.products.find(
      (p) => p.id === productId && p.tenantId === context.tenantId
    );
    if (!product) throw new NotFoundError('Product not found');

    const now = new Date();
    const variant = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      productId: product.id,
      variantName: input.variantName.trim(),
      packUnit: input.packUnit,
      currentBaseQty: input.baseQtyPerPack,
      currentConversionVersion: 1,
      defaultSalePriceMinor: input.defaultSalePriceMinor,
      currency: context.currency,
      allowPosSale: input.allowPosSale,
      active: true,
      createdAt: now,
      updatedAt: now,
    };
    store.packVariants.push(variant);
    const conversion = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      productId: product.id,
      packVariantId: variant.id,
      version: 1,
      packUnit: variant.packUnit,
      baseUnit: product.baseUnit,
      baseQtyPerPack: input.baseQtyPerPack,
      effectiveFrom: now,
      createdByUserId: context.userId,
      notes: 'Initial pack conversion',
      createdAt: now,
    };
    store.uomConversions.push(conversion);

    let barcodeConflict = false;
    if (input.barcode) {
      const cleanCode = input.barcode.trim();
      barcodeConflict = store.barcodeAliases.some(
        (b) => b.tenantId === context.tenantId && b.barcode === cleanCode
      );
      store.barcodeAliases.push({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        productId: product.id,
        packVariantId: variant.id,
        barcode: cleanCode,
        barcodeType: input.barcodeType,
        status: barcodeConflict ? 'conflict_review' : 'active',
        createdAt: now,
      });
    }

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.pack_variant_created',
      entityType: 'pack_variant',
      entityId: variant.id,
      correlationId,
      metadataJson: { productId: product.id, baseQtyPerPack: input.baseQtyPerPack, barcodeConflict },
    });

    return { variant, conversion, barcodeConflict };
  }

  const [product] = await db
    .select()
    .from(products)
    .where(and(eq(products.id, productId), eq(products.tenantId, context.tenantId)))
    .limit(1);

  if (!product) {
    throw new NotFoundError('Product not found');
  }

  return db.transaction(async (tx) => {
    const [variant] = await tx
      .insert(packVariants)
      .values({
        tenantId: context.tenantId,
        productId: product.id,
        variantName: input.variantName.trim(),
        packUnit: input.packUnit,
        currentBaseQty: input.baseQtyPerPack,
        currentConversionVersion: 1,
        defaultSalePriceMinor: input.defaultSalePriceMinor,
        currency: context.currency,
        allowPosSale: input.allowPosSale,
      })
      .returning();

    const [conversion] = await tx
      .insert(uomConversions)
      .values({
        tenantId: context.tenantId,
        productId: product.id,
        packVariantId: variant.id,
        version: 1,
        packUnit: variant.packUnit,
        baseUnit: product.baseUnit,
        baseQtyPerPack: input.baseQtyPerPack,
        createdByUserId: context.userId,
        notes: 'Initial pack conversion',
      })
      .returning();

    let barcodeConflict = false;
    if (input.barcode) {
      const collision = await tx
        .select({ id: barcodeAliases.id })
        .from(barcodeAliases)
        .where(
          and(
            eq(barcodeAliases.tenantId, context.tenantId),
            eq(barcodeAliases.barcode, input.barcode.trim())
          )
        )
        .limit(1);
      barcodeConflict = collision.length > 0;

      await tx.insert(barcodeAliases).values({
        tenantId: context.tenantId,
        productId: product.id,
        packVariantId: variant.id,
        barcode: input.barcode.trim(),
        barcodeType: input.barcodeType,
        status: barcodeConflict ? 'conflict_review' : 'active',
      });
    }

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.pack_variant_created',
      entityType: 'pack_variant',
      entityId: variant.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: {
        productId: product.id,
        baseQtyPerPack: input.baseQtyPerPack,
        conversionVersion: 1,
        barcodeConflict,
      },
    });

    return { variant, conversion, barcodeConflict };
  });
}

export async function updatePackConversion(
  context: ActiveWorkspaceContext,
  packVariantId: string,
  input: {
    newBaseQtyPerPack: number;
    newDefaultSalePriceMinor?: number;
    notes: string;
  },
  correlationId: string
) {
  assertCapability(context, 'pharmacy.catalogue');
  assertPermission(context, 'pharmacy.catalogue.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const variant = store.packVariants.find(
      (v) => v.id === packVariantId && v.tenantId === context.tenantId
    );
    if (!variant) throw new NotFoundError('Pack variant not found');
    const product = store.products.find(
      (p) => p.id === variant.productId && p.tenantId === context.tenantId
    );
    if (!product) throw new NotFoundError('Parent product not found');

    const prevVersion = variant.currentConversionVersion;
    const prevQty = variant.currentBaseQty;
    const nextVersion = prevVersion + 1;
    const now = new Date();

    const newConversion = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      productId: product.id,
      packVariantId: variant.id,
      version: nextVersion,
      packUnit: variant.packUnit,
      baseUnit: product.baseUnit,
      baseQtyPerPack: input.newBaseQtyPerPack,
      effectiveFrom: now,
      createdByUserId: context.userId,
      notes: input.notes.trim(),
      createdAt: now,
    };
    store.uomConversions.push(newConversion);

    variant.currentBaseQty = input.newBaseQtyPerPack;
    variant.currentConversionVersion = nextVersion;
    if (input.newDefaultSalePriceMinor !== undefined) {
      variant.defaultSalePriceMinor = input.newDefaultSalePriceMinor;
    }
    variant.updatedAt = now;

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.uom_conversion_versioned',
      entityType: 'pack_variant',
      entityId: variant.id,
      correlationId,
      metadataJson: {
        previousVersion: prevVersion,
        previousBaseQty: prevQty,
        newVersion: nextVersion,
        newBaseQty: input.newBaseQtyPerPack,
      },
    });

    return { variant, conversion: newConversion };
  }

  return db.transaction(async (tx) => {
    const [variant] = await tx
      .select()
      .from(packVariants)
      .where(and(eq(packVariants.id, packVariantId), eq(packVariants.tenantId, context.tenantId)))
      .limit(1);

    if (!variant) {
      throw new NotFoundError('Pack variant not found');
    }

    const [product] = await tx
      .select()
      .from(products)
      .where(and(eq(products.id, variant.productId), eq(products.tenantId, context.tenantId)))
      .limit(1);

    if (!product) {
      throw new NotFoundError('Parent product not found');
    }

    const nextVersion = variant.currentConversionVersion + 1;

    const [newConversion] = await tx
      .insert(uomConversions)
      .values({
        tenantId: context.tenantId,
        productId: product.id,
        packVariantId: variant.id,
        version: nextVersion,
        packUnit: variant.packUnit,
        baseUnit: product.baseUnit,
        baseQtyPerPack: input.newBaseQtyPerPack,
        createdByUserId: context.userId,
        notes: input.notes.trim(),
      })
      .returning();

    const [updatedVariant] = await tx
      .update(packVariants)
      .set({
        currentBaseQty: input.newBaseQtyPerPack,
        currentConversionVersion: nextVersion,
        ...(input.newDefaultSalePriceMinor !== undefined
          ? { defaultSalePriceMinor: input.newDefaultSalePriceMinor }
          : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(packVariants.id, variant.id), eq(packVariants.tenantId, context.tenantId)))
      .returning();

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.uom_conversion_versioned',
      entityType: 'pack_variant',
      entityId: variant.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: {
        previousVersion: variant.currentConversionVersion,
        previousBaseQty: variant.currentBaseQty,
        newVersion: nextVersion,
        newBaseQty: input.newBaseQtyPerPack,
        notes: input.notes.trim(),
      },
    });

    return {
      variant: updatedVariant,
      conversion: newConversion,
    };
  });
}

export async function addBarcodeAlias(
  context: ActiveWorkspaceContext,
  productId: string,
  input: { packVariantId: string; barcode: string; barcodeType: string },
  correlationId: string
) {
  assertCapability(context, 'pharmacy.catalogue');
  assertPermission(context, 'pharmacy.catalogue.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const trimmedBarcode = input.barcode.trim();

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const variant = store.packVariants.find(
      (v) =>
        v.id === input.packVariantId &&
        v.productId === productId &&
        v.tenantId === context.tenantId
    );
    if (!variant) throw new NotFoundError('Pack variant not found for product');

    const samePair = store.barcodeAliases.some(
      (b) =>
        b.tenantId === context.tenantId &&
        b.packVariantId === variant.id &&
        b.barcode === trimmedBarcode
    );
    if (samePair) throw new ConflictError('This barcode is already registered on this pack variant');

    const hasConflict = store.barcodeAliases.some(
      (b) =>
        b.tenantId === context.tenantId &&
        b.barcode === trimmedBarcode &&
        b.packVariantId !== variant.id
    );

    const alias = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      productId,
      packVariantId: variant.id,
      barcode: trimmedBarcode,
      barcodeType: input.barcodeType,
      status: (hasConflict ? 'conflict_review' : 'active') as 'conflict_review' | 'active',
      createdAt: new Date(),
    };
    store.barcodeAliases.push(alias);

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.barcode_alias_added',
      entityType: 'barcode_alias',
      entityId: alias.id,
      correlationId,
      metadataJson: { barcode: trimmedBarcode, productId, packVariantId: variant.id, hasConflict },
    });

    return { alias, conflictDetected: hasConflict };
  }

  const [variant] = await db
    .select()
    .from(packVariants)
    .where(
      and(
        eq(packVariants.id, input.packVariantId),
        eq(packVariants.productId, productId),
        eq(packVariants.tenantId, context.tenantId)
      )
    )
    .limit(1);

  if (!variant) {
    throw new NotFoundError('Pack variant not found for product');
  }

  const samePair = await db
    .select({ id: barcodeAliases.id })
    .from(barcodeAliases)
    .where(
      and(
        eq(barcodeAliases.tenantId, context.tenantId),
        eq(barcodeAliases.packVariantId, variant.id),
        eq(barcodeAliases.barcode, trimmedBarcode)
      )
    )
    .limit(1);

  if (samePair.length > 0) {
    throw new ConflictError('This barcode is already registered on this pack variant');
  }

  const crossProduct = await db
    .select({ id: barcodeAliases.id, productId: barcodeAliases.productId })
    .from(barcodeAliases)
    .where(
      and(
        eq(barcodeAliases.tenantId, context.tenantId),
        eq(barcodeAliases.barcode, trimmedBarcode),
        ne(barcodeAliases.packVariantId, variant.id)
      )
    )
    .limit(1);

  const hasConflict = crossProduct.length > 0;

  return db.transaction(async (tx) => {
    const [alias] = await tx
      .insert(barcodeAliases)
      .values({
        tenantId: context.tenantId,
        productId,
        packVariantId: variant.id,
        barcode: trimmedBarcode,
        barcodeType: input.barcodeType,
        status: hasConflict ? 'conflict_review' : 'active',
      })
      .returning();

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'pharmacy.barcode_alias_added',
      entityType: 'barcode_alias',
      entityId: alias.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: {
        barcode: trimmedBarcode,
        productId,
        packVariantId: variant.id,
        status: alias.status,
        hasConflict,
      },
    });

    return { alias, conflictDetected: hasConflict };
  });
}
