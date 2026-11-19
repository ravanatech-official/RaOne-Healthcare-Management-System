import express from 'express';
import { z } from 'zod';
import {
  ConfirmActionProposalSchema,
  CreateAppointmentSchema,
  CreateDoctorScheduleSchema,
  CreateHolidayBlockSchema,
  CreatePersonSchema,
  PrepareActionProposalSchema,
  QueueTokenActionSchema,
  RecordClinicPaymentSchema,
  RescheduleAppointmentSchema,
  TransitionAppointmentStatusSchema,
  UpdatePersonSchema,
  UpsertDoctorCommissionSchema,
  VoidClinicPaymentSchema,
} from '../contracts/clinic.ts';
import {
  broadcastDoctorDelay,
  createDoctorHolidayBlock,
  createDoctorSchedule,
  deleteDoctorSchedule,
  getAvailableDoctorSlots,
  getDoctorPayoutReport,
  getPatientVisitHistory,
  getWaitingRoomDisplay,
  listDoctorHolidayBlocks,
  listDoctorSchedules,
  updateAppointmentQueueState,
  upsertDoctorCommissionRule,
} from '../domain/clinic-ops.ts';
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
import { getBusinessDateInTimezone, requireActiveWorkspace } from '../domain/tenancy.ts';
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

// 5. Waiting Room TV Queue & Token Control
clinicRouter.get('/queue/display', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const dateStr = typeof req.query.date === 'string' ? req.query.date : undefined;
    const display = await getWaitingRoomDisplay(context, dateStr);
    return res.json({ ...display, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

clinicRouter.post('/appointments/:id/queue', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = QueueTokenActionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid queue token state payload');
    }
    const token = await updateAppointmentQueueState(
      context,
      String(req.params.id),
      parsed.data,
      correlationId
    );
    return res.json({ token, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

clinicRouter.post('/queue/delay-broadcast', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const schema = z.object({
      resourceId: z.string().min(4),
      delayMinutes: z.number().int().min(0).max(180),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid delay broadcast payload');
    }
    const result = await broadcastDoctorDelay(
      context,
      parsed.data.resourceId,
      parsed.data.delayMinutes,
      correlationId
    );
    return res.json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

// 6. Doctor Schedules, Holiday Blocks & Available Slots Picker
clinicRouter.get('/schedules', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
    const schedules = await listDoctorSchedules(context, resourceId);
    return res.json({ schedules, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

clinicRouter.post('/schedules', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = CreateDoctorScheduleSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid doctor schedule');
    }
    const schedule = await createDoctorSchedule(context, parsed.data, correlationId);
    return res.status(201).json({ schedule, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

clinicRouter.delete('/schedules/:id', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const result = await deleteDoctorSchedule(context, String(req.params.id), correlationId);
    return res.json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

clinicRouter.get('/holidays', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : undefined;
    const holidays = await listDoctorHolidayBlocks(context, resourceId);
    return res.json({ holidays, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

clinicRouter.post('/holidays', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = CreateHolidayBlockSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid holiday block');
    }
    const holiday = await createDoctorHolidayBlock(context, parsed.data, correlationId);
    return res.status(201).json({ holiday, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

clinicRouter.get('/slots', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const resourceId = typeof req.query.resourceId === 'string' ? req.query.resourceId : '';
    const dateStr =
      typeof req.query.date === 'string'
        ? req.query.date
        : getBusinessDateInTimezone(context.timezone);
    if (!resourceId) {
      throw new ValidationError('resourceId is required');
    }
    const result = await getAvailableDoctorSlots(context, resourceId, dateStr);
    return res.json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

// 7. Patient Visit History & Doctor Payout Split Report
clinicRouter.get('/people/:id/history', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const history = await getPatientVisitHistory(context, String(req.params.id));
    return res.json({ ...history, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

clinicRouter.get('/doctor-payouts', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const dateStr = typeof req.query.date === 'string' ? req.query.date : undefined;
    const report = await getDoctorPayoutReport(context, dateStr);
    return res.json({ ...report, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

clinicRouter.put('/doctor-commissions', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = UpsertDoctorCommissionSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(parsed.error.issues[0]?.message || 'Invalid commission payload');
    }
    const rule = await upsertDoctorCommissionRule(context, parsed.data, correlationId);
    return res.json({ rule, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});
