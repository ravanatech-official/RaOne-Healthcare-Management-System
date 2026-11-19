import express from 'express';
import { z } from 'zod';
import {
  AttendanceClockSchema,
  CreateComplianceLicenseSchema,
  CreateLabOrderSchema,
  GeneratePayrollSchema,
  RecordColdChainLogSchema,
  RequestLeaveSchema,
  UpdateLabOrderSchema,
  UpsertHrProfileSchema,
} from '../contracts/departments.ts';
import { ValidationError } from '../domain/errors.ts';
import {
  clockInStaff,
  clockOutStaff,
  createComplianceLicense,
  createLabOrder,
  generateMonthlyPayroll,
  getHrAdminOverview,
  recordColdChainTemp,
  requestLeave,
  reviewLeaveRequest,
  updateLabOrderStatus,
  upsertHrProfile,
} from '../domain/hr-admin-ops.ts';
import { requireActiveWorkspace } from '../domain/tenancy.ts';
import { type AuthRequest, requireAuth } from '../middleware/auth.ts';
import { sendApiError } from './error-helper.ts';

export const hrAdminRouter = express.Router();

hrAdminRouter.get('/overview', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(req.authUser!, req.header('x-tenant-id') || undefined);
    const overview = await getHrAdminOverview(context);
    return res.json({ overview, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

hrAdminRouter.put('/profiles', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(req.authUser!, req.header('x-tenant-id') || undefined);
    const parsed = UpsertHrProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid HR profile input');
    }
    const result = await upsertHrProfile(context, parsed.data, correlationId);
    return res.json({ ...result, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

hrAdminRouter.post('/attendance/clock-in', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(req.authUser!, req.header('x-tenant-id') || undefined);
    const parsed = AttendanceClockSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid PIN format');
    }
    const result = await clockInStaff(context, parsed.data, correlationId);
    return res.status(201).json({ ...result, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

hrAdminRouter.post('/attendance/clock-out', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(req.authUser!, req.header('x-tenant-id') || undefined);
    const parsed = AttendanceClockSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid PIN format');
    }
    const result = await clockOutStaff(context, parsed.data, correlationId);
    return res.json({ ...result, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

hrAdminRouter.post('/leaves', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(req.authUser!, req.header('x-tenant-id') || undefined);
    const parsed = RequestLeaveSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid leave request details');
    }
    const result = await requestLeave(context, parsed.data, correlationId);
    return res.status(201).json({ ...result, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

hrAdminRouter.post('/leaves/:id/review', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(req.authUser!, req.header('x-tenant-id') || undefined);
    const parsed = z.object({ decision: z.enum(['approved', 'rejected']) }).safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid leave review decision');
    }
    const result = await reviewLeaveRequest(
      context,
      String(req.params.id),
      parsed.data.decision,
      correlationId
    );
    return res.json({ ...result, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

hrAdminRouter.post('/payroll/generate', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(req.authUser!, req.header('x-tenant-id') || undefined);
    const parsed = GeneratePayrollSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid payroll month (expected YYYY-MM)');
    }
    const result = await generateMonthlyPayroll(context, parsed.data.payrollMonth, correlationId);
    return res.status(201).json({ ...result, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

hrAdminRouter.post('/lab-orders', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(req.authUser!, req.header('x-tenant-id') || undefined);
    const parsed = CreateLabOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid lab order payload');
    }
    const result = await createLabOrder(context, parsed.data, correlationId);
    return res.status(201).json({ ...result, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

hrAdminRouter.patch('/lab-orders/:id', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(req.authUser!, req.header('x-tenant-id') || undefined);
    const parsed = UpdateLabOrderSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid lab order status update');
    }
    const result = await updateLabOrderStatus(
      context,
      String(req.params.id),
      parsed.data,
      correlationId
    );
    return res.json({ ...result, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

hrAdminRouter.post('/cold-chain', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(req.authUser!, req.header('x-tenant-id') || undefined);
    const parsed = RecordColdChainLogSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid cold-chain temperature reading');
    }
    const result = await recordColdChainTemp(context, parsed.data, correlationId);
    return res.status(201).json({ ...result, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

hrAdminRouter.post('/licenses', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(req.authUser!, req.header('x-tenant-id') || undefined);
    const parsed = CreateComplianceLicenseSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid license details');
    }
    const result = await createComplianceLicense(context, parsed.data, correlationId);
    return res.status(201).json({ ...result, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});
