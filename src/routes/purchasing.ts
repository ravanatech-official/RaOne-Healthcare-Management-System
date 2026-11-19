import express from 'express';
import {
  ConvertPoToGrnSchema,
  CreatePurchaseOrderSchema,
  CreateSupplierDebitNoteSchema,
} from '../contracts/departments.ts';
import { ValidationError } from '../domain/errors.ts';
import {
  approvePurchaseOrder,
  convertPurchaseOrderToGrn,
  createPurchaseOrder,
  createSupplierDebitNote,
  getPurchasingOverview,
} from '../domain/purchasing-ops.ts';
import { requireActiveWorkspace } from '../domain/tenancy.ts';
import { type AuthRequest, requireAuth } from '../middleware/auth.ts';
import { sendApiError } from './error-helper.ts';

export const purchasingRouter = express.Router();

purchasingRouter.get('/overview', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(req.authUser!, req.header('x-tenant-id') || undefined);
    const overview = await getPurchasingOverview(context);
    return res.json({ overview, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

purchasingRouter.post('/orders', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(req.authUser!, req.header('x-tenant-id') || undefined);
    const parsed = CreatePurchaseOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid purchase order payload');
    }
    const result = await createPurchaseOrder(context, parsed.data, correlationId);
    return res.status(201).json({ ...result, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

purchasingRouter.post('/orders/:id/approve', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(req.authUser!, req.header('x-tenant-id') || undefined);
    const result = await approvePurchaseOrder(context, String(req.params.id), correlationId);
    return res.json({ ...result, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

purchasingRouter.post('/orders/:id/convert-to-grn', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(req.authUser!, req.header('x-tenant-id') || undefined);
    const parsed = ConvertPoToGrnSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid GRN conversion details');
    }
    const result = await convertPurchaseOrderToGrn(
      context,
      String(req.params.id),
      parsed.data,
      correlationId
    );
    return res.status(201).json({ ...result, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

purchasingRouter.post('/debit-notes', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(req.authUser!, req.header('x-tenant-id') || undefined);
    const parsed = CreateSupplierDebitNoteSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid debit note payload');
    }
    const result = await createSupplierDebitNote(context, parsed.data, correlationId);
    return res.status(201).json({ ...result, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});
