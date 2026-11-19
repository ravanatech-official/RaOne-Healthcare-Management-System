import 'dotenv/config';
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db, isDatabaseConfigured } from '../src/db/index.ts';
import {
  costLayers,
  goodsReceiptLines,
  products,
  stockMovements,
  tenants,
  users,
} from '../src/db/schema.ts';
import {
  grantProfessionalAuthority,
  MANDATORY_SAFETY_CAPABILITIES,
  resolveCapabilitiesForMode,
  revokeProfessionalAuthority,
} from '../src/domain/capabilities.ts';
import {
  CapabilityUnavailableError,
  ConflictError,
  ForbiddenError,
  ValidationError,
} from '../src/domain/errors.ts';
import {
  addBarcodeAlias,
  createProduct,
  listCatalogueProducts,
  updatePackConversion,
} from '../src/domain/pharmacy-catalogue.ts';
import {
  createSupplier,
  getStockAndLotSummary,
  parseAndValidateExpiry,
  postGoodsReceipt,
  postSupplierInvoice,
  transitionLotQuality,
} from '../src/domain/pharmacy-inventory.ts';
import {
  type ActiveWorkspaceContext,
  bootstrapClinicWorkspace,
  requireActiveWorkspace,
} from '../src/domain/tenancy.ts';

describe('Unit Invariants: Product Modes, Safety Locks & Expiry Precision', () => {
  it('enforces dependency closure on pharmacy_retail_only and locks safety capabilities (U01/U02/U19/P20)', () => {
    const retailCaps = resolveCapabilitiesForMode('pharmacy_retail_only');
    expect(retailCaps['pharmacy.pos']).toBe(true);
    expect(retailCaps['pharmacy.inventory']).toBe(true);
    expect(retailCaps['pharmacy.receiving']).toBe(true);
    expect(retailCaps['pharmacy.catalogue']).toBe(true);
    expect(retailCaps['appointments.manage']).toBe(false);

    for (const safetyCap of MANDATORY_SAFETY_CAPABILITIES) {
      expect(retailCaps[safetyCap]).toBe(true);
      expect(() =>
        resolveCapabilitiesForMode('clinic_only', { [safetyCap]: false })
      ).toThrow(ForbiddenError);
    }

    expect(() =>
      resolveCapabilitiesForMode('pharmacy_retail_only', { 'pharmacy.inventory': false })
    ).toThrow(ValidationError);
  });

  it('validates day, leap-year month, and unknown expiry precision (P16)', () => {
    expect(() => parseAndValidateExpiry('2026-02-30', 'day', '2026-11-18')).toThrow(
      ValidationError
    );

    const leapMonth = parseAndValidateExpiry('2028-02', 'month', '2026-11-18');
    expect(leapMonth.expiryCutoffDate).toBe('2028-02-29');
    expect(leapMonth.isExpired).toBe(false);
    expect(leapMonth.forceQuarantine).toBe(false);

    const unknown = parseAndValidateExpiry('UNKNOWN', 'unknown', '2026-11-18');
    expect(unknown.expiryCutoffDate).toBeNull();
    expect(unknown.forceQuarantine).toBe(true);
  });
});

const hasSqlEnv = isDatabaseConfigured;

describe.skipIf(!hasSqlEnv)('Pharmacy & Platform Phase 1 Integration Tests (Cloud SQL)', () => {
  const tag = crypto.randomBytes(4).toString('hex');
  let clinicUserId: number;
  let pharmUserId: number;
  let tenantClinicId: string;
  let tenantPharmId: string;
  let pharmCtx: ActiveWorkspaceContext;
  let clinicCtx: ActiveWorkspaceContext;

  beforeAll(async () => {
    const [uClinic] = await db
      .insert(users)
      .values({
        uid: `ph_test_clinic_${tag}`,
        email: `clinic_${tag}@example.test`,
        displayName: 'Clinic Only Owner',
        preferredLocale: 'en-LK',
      })
      .returning();

    const [uPharm] = await db
      .insert(users)
      .values({
        uid: `ph_test_pharm_${tag}`,
        email: `pharm_${tag}@example.test`,
        displayName: 'Pharmacy Owner',
        preferredLocale: 'en-LK',
      })
      .returning();

    clinicUserId = uClinic.id;
    pharmUserId = uPharm.id;

    clinicCtx = await bootstrapClinicWorkspace(
      {
        id: uClinic.id,
        uid: uClinic.uid,
        email: uClinic.email,
        displayName: uClinic.displayName,
        preferredLocale: 'en-LK',
      },
      {
        preferredLocale: 'en-LK',
        productMode: 'clinic_only',
        clinicName: `Clinic Only ${tag}`,
        branchName: 'Main',
        countryCode: 'LK',
        timezone: 'Asia/Colombo',
        currency: 'LKR',
        confirmLocaleAndCurrency: true,
        primaryPractitionerName: 'Dr. Clinic',
        primaryPractitionerSpecialty: 'OPD',
        openingHoursSummary: '08:30 - 17:30',
        services: [{ name: 'OPD', nameSi: 'OPD', durationMinutes: 15, priceLkr: 1500 }],
        includeSampleData: false,
      },
      `corr_c_${tag}`
    );

    pharmCtx = await bootstrapClinicWorkspace(
      {
        id: uPharm.id,
        uid: uPharm.uid,
        email: uPharm.email,
        displayName: uPharm.displayName,
        preferredLocale: 'en-LK',
      },
      {
        preferredLocale: 'en-LK',
        productMode: 'pharmacy_inventory_only',
        clinicName: `Pharmacy Inv ${tag}`,
        legalEntityName: `Pharmacy Holdings ${tag} (Pvt) Ltd`,
        branchName: 'Dispensary 1',
        countryCode: 'LK',
        timezone: 'Asia/Colombo',
        currency: 'LKR',
        confirmLocaleAndCurrency: true,
        primaryPractitionerName: 'Primary',
        primaryPractitionerSpecialty: 'Pharmacy',
        openingHoursSummary: '08:00 - 20:00',
        services: [],
        includeSampleData: false,
      },
      `corr_p_${tag}`
    );

    tenantClinicId = clinicCtx.tenantId;
    tenantPharmId = pharmCtx.tenantId;
  }, 20_000);

  afterAll(async () => {
    if (tenantClinicId) await db.delete(tenants).where(eq(tenants.id, tenantClinicId));
    if (tenantPharmId) await db.delete(tenants).where(eq(tenants.id, tenantPharmId));
    if (clinicUserId) await db.delete(users).where(eq(users.id, clinicUserId));
    if (pharmUserId) await db.delete(users).where(eq(users.id, pharmUserId));
  }, 20_000);

  it('blocks clinic_only tenant from pharmacy catalogue capability (U01)', async () => {
    await expect(listCatalogueProducts(clinicCtx)).rejects.toThrow(CapabilityUnavailableError);
  });

  it('rejects cross-tenant legalEntityId FK insertion at PostgreSQL level (U04/P01)', async () => {
    await expect(
      db.insert(products).values({
        tenantId: tenantPharmId,
        legalEntityId: clinicCtx.legalEntityId!, // belongs to clinic tenant!
        skuCode: `XSITE-${tag}`,
        displayName: 'Cross Tenant Test',
        normalizedName: 'cross tenant test',
        genericName: 'Paracetamol',
        strengthValue: '500',
        strengthUnit: 'mg',
        dosageForm: 'tablet',
        manufacturer: 'SPMC',
        regulatoryClass: 'otc',
        requiresPharmacistRelease: false,
        baseUnit: 'tablet',
      })
    ).rejects.toThrow();
  });

  it('separates strengths cleanly and flags duplicate barcodes for review (P02)', async () => {
    const p500 = await createProduct(
      pharmCtx,
      {
        skuCode: `AMOX-500-${tag}`,
        displayName: 'Amoxil 500mg Capsule',
        genericName: 'Amoxicillin',
        brandName: 'Amoxil',
        strengthValue: '500',
        strengthUnit: 'mg',
        dosageForm: 'capsule',
        route: 'oral',
        manufacturer: 'GSK',
        regulatoryClass: 'prescription_only',
        storageCondition: 'ambient',
        baseUnit: 'capsule',
        minShelfLifeDays: 60,
        initialPack: {
          variantName: 'Box of 100 Capsules',
          packUnit: 'box',
          baseQtyPerPack: 100,
          defaultSalePriceMinor: 350000,
          barcode: `890500${tag}`,
          barcodeType: 'ean13',
        },
      },
      `corr_p500_${tag}`
    );

    const p250 = await createProduct(
      pharmCtx,
      {
        skuCode: `AMOX-250-${tag}`,
        displayName: 'Amoxil 250mg Capsule',
        genericName: 'Amoxicillin',
        brandName: 'Amoxil',
        strengthValue: '250',
        strengthUnit: 'mg',
        dosageForm: 'capsule',
        route: 'oral',
        manufacturer: 'GSK',
        regulatoryClass: 'prescription_only',
        storageCondition: 'ambient',
        baseUnit: 'capsule',
        minShelfLifeDays: 60,
        initialPack: {
          variantName: 'Box of 100 Capsules',
          packUnit: 'box',
          baseQtyPerPack: 100,
          defaultSalePriceMinor: 210000,
          barcodeType: 'internal',
        },
      },
      `corr_p250_${tag}`
    );

    const searchRes = await listCatalogueProducts(pharmCtx, 'Amoxil');
    expect(searchRes.items.length).toBe(2);
    expect(searchRes.ambiguityWarning).toBe(true);

    // Colliding barcode against second product flags conflict_review rather than merging SKUs
    const dupAlias = await addBarcodeAlias(
      pharmCtx,
      p250.product.id,
      {
        packVariantId: p250.initialPackVariant!.id,
        barcode: `890500${tag}`,
        barcodeType: 'ean13',
      },
      `corr_dupbc_${tag}`
    );
    expect(dupAlias.conflictDetected).toBe(true);
    expect(dupAlias.alias.status).toBe('conflict_review');
    expect(p500.product.requiresPharmacistRelease).toBe(true);
  });

  it('executes GRN with bonus dilution, idempotency, versioned UOM snapshot, separate supplier invoice, unknown-expiry quarantine & pharmacist gate (P03/P07/P08/P10/P12/P16/U11/U14)', async () => {
    const supplier = await createSupplier(
      pharmCtx,
      {
        name: `SPMC Sri Lanka ${tag}`,
        registrationRef: 'NMRA-SPMC',
        status: 'approved',
      },
      `corr_sup_${tag}`
    );

    const created = await createProduct(
      pharmCtx,
      {
        skuCode: `AZITH-500-${tag}`,
        displayName: 'Azithromycin 500mg Tablet',
        genericName: 'Azithromycin',
        brandName: 'Azithro',
        strengthValue: '500',
        strengthUnit: 'mg',
        dosageForm: 'tablet',
        route: 'oral',
        manufacturer: 'SPMC',
        regulatoryClass: 'prescription_only',
        storageCondition: 'ambient',
        baseUnit: 'tablet',
        minShelfLifeDays: 30,
        initialPack: {
          variantName: 'Box of 100',
          packUnit: 'box',
          baseQtyPerPack: 100,
          defaultSalePriceMinor: 420000,
          barcodeType: 'internal',
        },
      },
      `corr_az_${tag}`
    );

    const productId = created.product.id;
    const variantId = created.initialPackVariant!.id;

    // 1. Owner WITHOUT pharmacist grant attempts immediate release -> 403 Forbidden (U11/P10)
    await expect(
      postGoodsReceipt(
        pharmCtx,
        {
          idempotencyKey: `grn-unauth-${tag}`,
          supplierId: supplier.id,
          supplierDocRef: `DN-UNAUTH-${tag}`,
          docType: 'grn',
          receivedDate: '2026-11-18',
          notes: '',
          lines: [
            {
              productId,
              packVariantId: variantId,
              batchNumber: `B-REL-${tag}`,
              printedExpiry: '2028-06',
              expiryPrecision: 'month',
              orderedPacks: 2,
              receivedPacks: 2,
              bonusPacks: 0,
              quarantinedPacks: 0,
              unitPackCostMinor: 100000,
              isProvisionalCost: false,
              condition: 'good',
              releaseImmediately: true,
            },
          ],
        },
        `corr_grn_unauth_${tag}`
      )
    ).rejects.toThrow(ForbiddenError);

    // 2. Post GRN #1 into Quarantine (4 paid + 1 bonus boxes = 500 tablets at v1 conversion)
    const grn1Key = `grn-1-${tag}`;
    const grn1Input = {
      idempotencyKey: grn1Key,
      supplierId: supplier.id,
      supplierDocRef: `DN-001-${tag}`,
      docType: 'grn' as const,
      receivedDate: '2026-11-18',
      notes: '4 paid + 1 bonus box',
      lines: [
        {
          productId,
          packVariantId: variantId,
          batchNumber: `B100-${tag}`,
          printedExpiry: '2028-06',
          expiryPrecision: 'month' as const,
          orderedPacks: 4,
          receivedPacks: 4,
          bonusPacks: 1,
          quarantinedPacks: 0,
          unitPackCostMinor: 100000, // LKR 1,000.00/pack * 4 = LKR 4,000.00 -> LKR 8.00/tablet (800 minor)
          isProvisionalCost: false,
          condition: 'good' as const,
          releaseImmediately: false,
        },
      ],
    };

    const grn1 = (await postGoodsReceipt(pharmCtx, grn1Input, `corr_grn1_${tag}`)) as {
      goodsReceipt: { id: string };
      lines: Array<{ lotId: string; unitCostMinor: number; quarantinedQtyBase: number; uomConversionVersion: number }>;
      idempotentReplay: boolean;
    };

    expect(grn1.idempotentReplay).toBe(false);
    expect(grn1.lines[0].quarantinedQtyBase).toBe(500);
    expect(grn1.lines[0].unitCostMinor).toBe(800); // bonus pack diluted unit cost!
    expect(grn1.lines[0].uomConversionVersion).toBe(1);

    // 3. Idempotent retry returns same result without doubling stock (U14)
    const grn1Replay = (await postGoodsReceipt(
      pharmCtx,
      grn1Input,
      `corr_grn1_retry_${tag}`
    )) as { idempotentReplay: boolean };
    expect(grn1Replay.idempotentReplay).toBe(true);

    // Same key + mutated payload throws ConflictError
    await expect(
      postGoodsReceipt(
        pharmCtx,
        { ...grn1Input, supplierDocRef: `DN-DIFFERENT-${tag}` },
        `corr_grn1_conflict_${tag}`
      )
    ).rejects.toThrow(ConflictError);

    const lotB100Id = grn1.lines[0].lotId;

    // 4. Owner WITHOUT pharmacist grant CANNOT release quarantined lot to sellable (U11 / P10)
    await expect(
      transitionLotQuality(
        pharmCtx,
        lotB100Id,
        { action: 'release_to_sellable', reason: 'Owner trying without pharmacist grant' },
        `corr_rel_fail_${tag}`
      )
    ).rejects.toThrow(ForbiddenError);

    // 5. Issue Pharmacist grant -> release succeeds and records grant ID
    const grant = await grantProfessionalAuthority(
      pharmCtx,
      {
        userId: pharmUserId,
        grantType: 'pharmacist',
        licenseNumber: `SLMC-PH-${tag}`,
      },
      `corr_grant_${tag}`
    );

    const releaseRes = (await transitionLotQuality(
      pharmCtx,
      lotB100Id,
      { action: 'release_to_sellable', reason: 'Batch COA verified' },
      `corr_rel_ok_${tag}`
    )) as { qtyBaseReleased: number; releasedByGrantId: string };
    expect(releaseRes.qtyBaseReleased).toBe(500);
    expect(releaseRes.releasedByGrantId).toBe(grant.id);

    // 6. Version UOM conversion to 120 tablets/box -> GRN #1 stays v1 (500 tabs), GRN #2 uses v2 (P03)
    const uomUpdate = await updatePackConversion(
      pharmCtx,
      variantId,
      {
        newBaseQtyPerPack: 120,
        notes: 'Updated manufacturer box pack to 120 tablets',
      },
      `corr_uom_v2_${tag}`
    );
    expect(uomUpdate.conversion.version).toBe(2);

    const grn2 = (await postGoodsReceipt(
      pharmCtx,
      {
        idempotencyKey: `grn-2-${tag}`,
        supplierId: supplier.id,
        supplierDocRef: `DN-002-${tag}`,
        docType: 'grn',
        receivedDate: '2026-11-18',
        notes: 'Uses UOM v2 (120 per box)',
        lines: [
          {
            productId,
            packVariantId: variantId,
            batchNumber: `B200-V2-${tag}`,
            printedExpiry: '2028-12',
            expiryPrecision: 'month',
            orderedPacks: 1,
            receivedPacks: 1,
            bonusPacks: 0,
            quarantinedPacks: 0,
            unitPackCostMinor: 120000,
            isProvisionalCost: false,
            condition: 'good',
            releaseImmediately: true,
          },
        ],
      },
      `corr_grn2_${tag}`
    )) as { lines: Array<{ uomConversionVersion: number; acceptedQtyBase: number }> };

    expect(grn2.lines[0].uomConversionVersion).toBe(2);
    expect(grn2.lines[0].acceptedQtyBase).toBe(120);

    // Historical GRN #1 line still has version 1 and 500 base units
    const [grn1DbLine] = await db
      .select()
      .from(goodsReceiptLines)
      .where(eq(goodsReceiptLines.goodsReceiptId, grn1.goodsReceipt.id));
    expect(grn1DbLine.uomConversionVersion).toBe(1);
    expect(grn1DbLine.quarantinedQtyBase).toBe(500);

    // 7. Unknown expiry lot stays quarantined and CANNOT be released even by active Pharmacist (P16)
    const grnUnk = (await postGoodsReceipt(
      pharmCtx,
      {
        idempotencyKey: `grn-unk-${tag}`,
        supplierId: supplier.id,
        supplierDocRef: `DN-UNK-${tag}`,
        docType: 'grn',
        receivedDate: '2026-11-18',
        notes: 'Missing expiry label',
        lines: [
          {
            productId,
            packVariantId: variantId,
            batchNumber: `B-UNK-${tag}`,
            printedExpiry: 'UNKNOWN',
            expiryPrecision: 'unknown',
            orderedPacks: 1,
            receivedPacks: 1,
            bonusPacks: 0,
            quarantinedPacks: 0,
            unitPackCostMinor: 100000,
            isProvisionalCost: true,
            condition: 'unknown_expiry',
            releaseImmediately: true, // even when requested, unknown expiry forces quarantine!
          },
        ],
      },
      `corr_grn_unk_${tag}`
    )) as { lines: Array<{ lotId: string; quarantinedQtyBase: number; acceptedQtyBase: number; qualityStatus: string }> };

    expect(grnUnk.lines[0].acceptedQtyBase).toBe(0);
    expect(grnUnk.lines[0].quarantinedQtyBase).toBe(120);
    expect(grnUnk.lines[0].qualityStatus).toBe('quarantine');

    await expect(
      transitionLotQuality(
        pharmCtx,
        grnUnk.lines[0].lotId,
        { action: 'release_to_sellable', reason: 'Attempt to release unknown expiry' },
        `corr_rel_unk_${tag}`
      )
    ).rejects.toThrow(ConflictError);

    // 8. Supplier Invoice linked to GRN #1 NEVER creates stock movements or changes balances (P12)
    const beforeStock = await getStockAndLotSummary(pharmCtx);
    const totalSellableBefore = beforeStock.balances.reduce((acc, b) => acc + b.sellableOnHand, 0);
    const movCountBefore = (
      await db.select().from(stockMovements).where(eq(stockMovements.tenantId, tenantPharmId))
    ).length;

    const invRes = (await postSupplierInvoice(
      pharmCtx,
      {
        idempotencyKey: `inv-1-${tag}`,
        supplierId: supplier.id,
        goodsReceiptId: grn1.goodsReceipt.id,
        invoiceNumber: `INV-${tag}`,
        invoiceDate: '2026-11-18',
        totalMinor: 400000,
      },
      `corr_inv_${tag}`
    )) as { stockImpact: string };
    expect(invRes.stockImpact).toBe('none');

    const afterStock = await getStockAndLotSummary(pharmCtx);
    const totalSellableAfter = afterStock.balances.reduce((acc, b) => acc + b.sellableOnHand, 0);
    const movCountAfter = (
      await db.select().from(stockMovements).where(eq(stockMovements.tenantId, tenantPharmId))
    ).length;

    expect(totalSellableAfter).toBe(totalSellableBefore);
    expect(movCountAfter).toBe(movCountBefore);

    // Verify cost layer exists for GRN #1 with exact 500 initial base qty
    const [layer] = await db
      .select()
      .from(costLayers)
      .where(eq(costLayers.lotId, lotB100Id));
    expect(layer.initialQtyBase).toBe(500);
    expect(layer.unitCostMinor).toBe(800);

    // 9. Revoking pharmacist grant immediately blocks subsequent release
    await revokeProfessionalAuthority(pharmCtx, grant.id, `corr_revoke_${tag}`);
    const refreshed = await requireActiveWorkspace({
      id: pharmUserId,
      uid: `ph_test_pharm_${tag}`,
      email: `pharm_${tag}@example.test`,
      displayName: 'Pharmacy Owner',
      preferredLocale: 'en-LK',
    });
    expect(refreshed.professionalGrants.length).toBe(0);
  }, 30_000);
});
