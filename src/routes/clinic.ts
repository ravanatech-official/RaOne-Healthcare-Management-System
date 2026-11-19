import express from 'express';
import {
  ConfirmActionProposalSchema,
  CreateAppointmentSchema,
  CreatePersonSchema,
  PrepareActionProposalSchema,
  RecordClinicPaymentSchema,
  RescheduleAppointmentSchema,
  TransitionAppointmentStatusSchema,
  UpdatePersonSchema,
  VoidClinicPaymentSchema,
} from '../contracts/clinic.ts';
import {
  confirmActionProposal,
  createAppointmentForTenant,
  createPersonForTenant,
  listClinicPaymentsAndReceipts,
  listPeopleForTenant,
  prepareActionProposal,
  recordClinicPaymentForTenant,
  rescheduleAppointmentForTenant,
  transitionAppointmentStatusForTenant,
  updatePersonForTenant,
  voidClinicPaymentForTenant,
} from '../domain/clinic-writes.ts';
import { ValidationError } from '../domain/errors.ts';
import { requireActiveWorkspace } from '../domain/tenancy.ts';
import { type AuthRequest, requireAuth } from '../middleware/auth.ts';
import { sendApiError } from './error-helper.ts';

export const clinicRouter = express.Router();

clinicRouter.use(requireAuth);

// 1. Patients / People Directory CRUD + Duplicate Disambiguation
clinicRouter.get('/people', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const q = typeof req.query.q === 'string' ? req.query.q : undefined;
    const rows = await listPeopleForTenant(context, q);
    return res.json({ people: rows, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

clinicRouter.post('/people', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = CreatePersonSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid patient details');
    }
    const person = await createPersonForTenant(context, parsed.data, correlationId);
    return res.status(201).json({ person, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

clinicRouter.patch('/people/:id', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = UpdatePersonSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid update payload');
    }
    const person = await updatePersonForTenant(
      context,
      String(req.params.id),
      parsed.data,
      correlationId
    );
    return res.json({ person, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

// 2. Appointments Booking, Reschedule & Attendance/Status Transitions
clinicRouter.post('/appointments', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = CreateAppointmentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid appointment details');
    }
    const result = await createAppointmentForTenant(context, parsed.data, correlationId);
    return res.status(201).json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

clinicRouter.patch('/appointments/:id/reschedule', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = RescheduleAppointmentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid reschedule details');
    }
    const result = await rescheduleAppointmentForTenant(
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

clinicRouter.post('/appointments/:id/status', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = TransitionAppointmentStatusSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid status transition');
    }
    const result = await transitionAppointmentStatusForTenant(
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

// 3. Clinic Billing, Payments, Receipts & Step-up Void
clinicRouter.get('/payments', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const rows = await listClinicPaymentsAndReceipts(context);
    return res.json({ payments: rows, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

clinicRouter.post('/payments', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = RecordClinicPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid payment payload');
    }
    const result = await recordClinicPaymentForTenant(context, parsed.data, correlationId);
    return res.status(201).json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

clinicRouter.post('/payments/:id/void', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = VoidClinicPaymentSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid void reason');
    }
    const result = await voidClinicPaymentForTenant(
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

// 4. Draft -> Confirm Action Proposals (Voice / Text -> Safe Idempotent Execution)
clinicRouter.post('/proposals', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = PrepareActionProposalSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid proposal payload');
    }
    const proposal = await prepareActionProposal(context, parsed.data, correlationId);
    return res.status(201).json({ proposal, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

clinicRouter.post('/proposals/:id/confirm', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = ConfirmActionProposalSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid confirmation details');
    }
    const result = await confirmActionProposal(
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
