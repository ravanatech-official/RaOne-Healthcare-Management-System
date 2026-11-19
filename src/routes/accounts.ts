import express from 'express';
import {
  CreateCreditAccountSchema,
  RecordCreditEntrySchema,
  RecordOperatingExpenseSchema,
  RecordSupplierPaymentSchema,
} from '../contracts/departments.ts';
import {
  createReceivableAccount,
  getAccountsOverview,
  recordOperatingExpense,
  recordReceivableEntry,
  recordSupplierPayment,
  voidOperatingExpense,
} from '../domain/accounts-ops.ts';
import { ValidationError } from '../domain/errors.ts';
import { requireActiveWorkspace } from '../domain/tenancy.ts';
import { type AuthRequest, requireAuth } from '../middleware/auth.ts';
import { sendApiError } from './error-helper.ts';

export const accountsRouter = express.Router();

accountsRouter.get('/overview', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(req.authUser!, req.header('x-tenant-id') || undefined);
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    const overview = await getAccountsOverview(context, date);
    return res.json({ overview, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

accountsRouter.post('/expenses', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(req.authUser!, req.header('x-tenant-id') || undefined);
    const parsed = RecordOperatingExpenseSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid expense details');
    }
    const result = await recordOperatingExpense(context, parsed.data, correlationId);
    return res.status(201).json({ ...result, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

accountsRouter.post('/expenses/:id/void', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(req.authUser!, req.header('x-tenant-id') || undefined);
    const result = await voidOperatingExpense(context, String(req.params.id), correlationId);
    return res.json({ ...result, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

accountsRouter.post('/receivables/accounts', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(req.authUser!, req.header('x-tenant-id') || undefined);
    const parsed = CreateCreditAccountSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid credit account details');
    }
    const result = await createReceivableAccount(context, parsed.data, correlationId);
    return res.status(201).json({ ...result, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

accountsRouter.post('/receivables/accounts/:id/entries', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(req.authUser!, req.header('x-tenant-id') || undefined);
    const parsed = RecordCreditEntrySchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid credit entry details');
    }
    const result = await recordReceivableEntry(context, String(req.params.id), parsed.data, correlationId);
    return res.status(201).json({ ...result, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

accountsRouter.post('/payables/payments', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(req.authUser!, req.header('x-tenant-id') || undefined);
    const parsed = RecordSupplierPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid supplier payment details');
    }
    const result = await recordSupplierPayment(context, parsed.data, correlationId);
    return res.status(201).json({ ...result, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});
