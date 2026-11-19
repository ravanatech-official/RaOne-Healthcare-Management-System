import express from 'express';
import { z } from 'zod';
import {
  AddBarcodeAliasSchema,
  ApprovePosCartSchema,
  CheckoutPosSaleSchema,
  CloseTillShiftSchema,
  CreateDispenseOrderSchema,
  CreatePackVariantSchema,
  CreatePosReturnSchema,
  CreateProductSchema,
  CreateStocktakeSchema,
  CreateStockTransferSchema,
  CreateSupplierSchema,
  LotQualityTransitionSchema,
  OpenTillShiftSchema,
  PostGoodsReceiptSchema,
  PostSupplierInvoiceSchema,
  ReceiveStockTransferSchema,
  SubmitStocktakeCountsSchema,
  TillCashEventSchema,
  UpdatePackConversionSchema,
} from '../contracts/pharmacy.ts';
import { ValidationError } from '../domain/errors.ts';
import {
  addBarcodeAlias,
  addPackVariant,
  createProduct,
  listCatalogueProducts,
  updatePackConversion,
} from '../domain/pharmacy-catalogue.ts';
import {
  createSupplier,
  getStockAndLotSummary,
  listGoodsReceipts,
  listStorageLocations,
  listSupplierInvoices,
  listSuppliers,
  postGoodsReceipt,
  postSupplierInvoice,
  transitionLotQuality,
} from '../domain/pharmacy-inventory.ts';
import {
  approvePosCart,
  checkoutPosSale,
  closeTillShift,
  createPosReturn,
  listPosSales,
  listTillShifts,
  openTillShift,
  recordTillCashEvent,
} from '../domain/pharmacy-pos.ts';
import {
  createDispenseOrder,
  createStocktake,
  createStockTransfer,
  getPharmacyAlertsDashboard,
  listDispenseOrders,
  listStocktakes,
  listStockTransfers,
  reconcileStocktake,
  receiveStockTransfer,
  submitStocktakeCounts,
  updateDispenseOrderStatus,
} from '../domain/pharmacy-ops.ts';
import { requireActiveWorkspace } from '../domain/tenancy.ts';
import { type AuthRequest, requireAuth } from '../middleware/auth.ts';
import { sendApiError } from './error-helper.ts';

export const pharmacyRouter = express.Router();

pharmacyRouter.use(requireAuth);

pharmacyRouter.get('/catalogue/products', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const result = await listCatalogueProducts(context, q);
    return res.json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.post('/catalogue/products', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = CreateProductSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid product SKU payload');
    }
    const created = await createProduct(context, parsed.data, correlationId);
    return res.status(201).json({ ...created, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.post('/catalogue/products/:id/packs', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = CreatePackVariantSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid pack variant payload');
    }
    const created = await addPackVariant(
      context,
      String(req.params.id),
      {
        variantName: parsed.data.variantName,
        packUnit: parsed.data.packUnit,
        baseQtyPerPack: parsed.data.baseQtyPerPack,
        defaultSalePriceMinor: parsed.data.defaultSalePriceMinor,
        allowPosSale: parsed.data.allowPosSale,
        barcode: parsed.data.barcode,
        barcodeType: parsed.data.barcodeType,
      },
      correlationId
    );
    return res.status(201).json({ ...created, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.patch('/catalogue/packs/:variantId/conversion', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = UpdatePackConversionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message || 'Invalid pack conversion payload'
      );
    }
    const updated = await updatePackConversion(
      context,
      String(req.params.variantId),
      {
        newBaseQtyPerPack: parsed.data.newBaseQtyPerPack,
        newDefaultSalePriceMinor: parsed.data.newDefaultSalePriceMinor,
        notes: parsed.data.notes,
      },
      correlationId
    );
    return res.json({ ...updated, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.post('/catalogue/products/:id/barcodes', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = AddBarcodeAliasSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid barcode payload');
    }
    const created = await addBarcodeAlias(
      context,
      String(req.params.id),
      {
        packVariantId: parsed.data.packVariantId,
        barcode: parsed.data.barcode,
        barcodeType: parsed.data.barcodeType,
      },
      correlationId
    );
    return res.status(201).json({ ...created, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.get('/suppliers', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const rows = await listSuppliers(context);
    return res.json({ suppliers: rows, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.post('/suppliers', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = CreateSupplierSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid supplier payload');
    }
    const supplier = await createSupplier(
      context,
      {
        name: parsed.data.name,
        registrationRef: parsed.data.registrationRef,
        contactName: parsed.data.contactName,
        phone: parsed.data.phone,
        email: parsed.data.email,
        status: parsed.data.status,
      },
      correlationId
    );
    return res.status(201).json({ supplier, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.get('/locations', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const locations = await listStorageLocations(context);
    return res.json({ locations, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.get('/goods-receipts', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const receipts = await listGoodsReceipts(context);
    return res.json({ goodsReceipts: receipts, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.post('/goods-receipts', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = PostGoodsReceiptSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid goods receipt payload');
    }
    const result = await postGoodsReceipt(context, parsed.data, correlationId);
    return res.status(201).json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.get('/supplier-invoices', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const invoices = await listSupplierInvoices(context);
    return res.json({ supplierInvoices: invoices, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.post('/supplier-invoices', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = PostSupplierInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message || 'Invalid supplier invoice payload'
      );
    }
    const result = await postSupplierInvoice(context, parsed.data, correlationId);
    return res.status(201).json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.get('/stock', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const summary = await getStockAndLotSummary(context);
    return res.json({ ...summary, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.post('/lots/:lotId/quality', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = LotQualityTransitionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid lot transition payload');
    }
    const result = await transitionLotQuality(
      context,
      String(req.params.lotId),
      {
        action: parsed.data.action,
        reason: parsed.data.reason,
        locationId: parsed.data.locationId,
        qtyBase: parsed.data.qtyBase,
      },
      correlationId
    );
    return res.json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

// Phase 2: Till Shifts
pharmacyRouter.get('/shifts', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const data = await listTillShifts(context);
    return res.json({ ...data, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.post('/shifts/open', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = OpenTillShiftSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid shift open payload');
    }
    const result = await openTillShift(context, parsed.data, correlationId);
    return res.status(201).json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.post('/shifts/:shiftId/cash-events', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = TillCashEventSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid till cash event');
    }
    const result = await recordTillCashEvent(
      context,
      String(req.params.shiftId),
      parsed.data,
      correlationId
    );
    return res.status(201).json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.post('/shifts/:shiftId/close', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = CloseTillShiftSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid shift close payload');
    }
    const result = await closeTillShift(
      context,
      String(req.params.shiftId),
      parsed.data,
      correlationId
    );
    return res.json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

// Phase 2: Retail POS, Cart-Hash Pharmacist Gate & Customer Returns
pharmacyRouter.get('/pos/sales', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const data = await listPosSales(context);
    return res.json({ ...data, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.post('/pos/approvals', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = ApprovePosCartSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid approval cart payload');
    }
    const result = await approvePosCart(context, parsed.data, correlationId);
    return res.status(201).json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.post('/pos/checkout', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = CheckoutPosSaleSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid POS checkout payload');
    }
    const result = await checkoutPosSale(context, parsed.data, correlationId);
    return res.status(201).json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.post('/pos/sales/:saleId/returns', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = CreatePosReturnSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid POS return payload');
    }
    const result = await createPosReturn(
      context,
      String(req.params.saleId),
      parsed.data,
      correlationId
    );
    return res.status(201).json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

// Phase 3: Alerts Dashboard, Stocktakes, Multi-Branch Transfers & Clinical Dispense Queue
pharmacyRouter.get('/alerts', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const alerts = await getPharmacyAlertsDashboard(context);
    return res.json({ ...alerts, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.get('/stocktakes', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const stocktakes = await listStocktakes(context);
    return res.json({ stocktakes, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.post('/stocktakes', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = CreateStocktakeSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ValidationError('Invalid stocktake payload');
    }
    const created = await createStocktake(context, parsed.data.notes, correlationId);
    return res.status(201).json({ ...created, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.post('/stocktakes/:id/counts', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = SubmitStocktakeCountsSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid stocktake counts');
    }
    const result = await submitStocktakeCounts(
      context,
      String(req.params.id),
      parsed.data,
      correlationId
    );
    return res.json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.post('/stocktakes/:id/reconcile', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const result = await reconcileStocktake(context, String(req.params.id), correlationId);
    return res.json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.get('/transfers', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const transfers = await listStockTransfers(context);
    return res.json({ transfers, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.post('/transfers', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = CreateStockTransferSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid stock transfer payload');
    }
    const result = await createStockTransfer(context, parsed.data, correlationId);
    return res.status(201).json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.post('/transfers/:id/receive', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = ReceiveStockTransferSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ValidationError('Invalid transfer receive payload');
    }
    const result = await receiveStockTransfer(
      context,
      String(req.params.id),
      parsed.data,
      correlationId
    );
    return res.json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.get('/dispense-queue', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const orders = await listDispenseOrders(context);
    return res.json({ orders, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.post('/dispense-queue', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = CreateDispenseOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid dispense order payload');
    }
    const created = await createDispenseOrder(context, parsed.data, correlationId);
    return res.status(201).json({ ...created, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

pharmacyRouter.post('/dispense-queue/:id/status', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const schema = z.object({
      status: z.enum(['dispensed', 'cancelled']),
      posSaleId: z.string().nullable().optional().default(null),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid dispense order status update');
    }
    const updated = await updateDispenseOrderStatus(
      context,
      String(req.params.id),
      parsed.data.status,
      parsed.data.posSaleId,
      correlationId
    );
    return res.json({ ...updated, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});
