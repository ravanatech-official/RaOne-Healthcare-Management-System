import { z } from 'zod';

export const CreatePersonSchema = z.object({
  displayName: z.string().trim().min(2).max(140),
  phone: z.string().trim().max(30).optional().default(''),
  aliases: z.array(z.string().trim().min(1).max(80)).max(8).optional().default([]),
  notes: z.string().trim().max(400).optional().default(''),
  confirmDuplicate: z.boolean().optional().default(false),
});
export type CreatePersonInput = z.infer<typeof CreatePersonSchema>;

export const UpdatePersonSchema = z.object({
  displayName: z.string().trim().min(2).max(140).optional(),
  phone: z.string().trim().max(30).optional(),
  aliases: z.array(z.string().trim().min(1).max(80)).max(8).optional(),
  notes: z.string().trim().max(400).optional(),
  expectedVersion: z.number().int().positive(),
});
export type UpdatePersonInput = z.infer<typeof UpdatePersonSchema>;

export const CreateAppointmentSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
  personId: z.string().uuid(),
  serviceId: z.string().uuid(),
  resourceId: z.string().uuid(),
  startsAt: z.string().datetime(),
  notes: z.string().trim().max(400).optional().default(''),
});
export type CreateAppointmentInput = z.infer<typeof CreateAppointmentSchema>;

export const RescheduleAppointmentSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
  startsAt: z.string().datetime(),
  resourceId: z.string().uuid().optional(),
  expectedVersion: z.number().int().positive(),
  notes: z.string().trim().max(400).optional(),
});
export type RescheduleAppointmentInput = z.infer<typeof RescheduleAppointmentSchema>;

export const TransitionAppointmentStatusSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
  status: z.enum(['arrived', 'completed', 'cancelled', 'no_show']),
  expectedVersion: z.number().int().positive(),
  notes: z.string().trim().max(400).optional(),
});
export type TransitionAppointmentStatusInput = z.infer<typeof TransitionAppointmentStatusSchema>;

export const RecordClinicPaymentSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
  personId: z.string().uuid(),
  appointmentId: z.string().uuid().optional().nullable(),
  description: z.string().trim().min(2).max(200),
  amountMinor: z.number().int().positive().max(500000000),
  method: z.enum(['cash', 'card', 'bank']),
  referenceNumber: z.string().trim().max(80).optional().default(''),
});
export type RecordClinicPaymentInput = z.infer<typeof RecordClinicPaymentSchema>;

export const VoidClinicPaymentSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
  reason: z.string().trim().min(3).max(240),
});
export type VoidClinicPaymentInput = z.infer<typeof VoidClinicPaymentSchema>;

export const PrepareActionProposalSchema = z.object({
  actionType: z.enum([
    'create_appointment',
    'reschedule_appointment',
    'record_payment',
  ]),
  payload: z.record(z.string(), z.unknown()),
  inputSource: z.enum(['ui', 'text', 'voice']).default('ui'),
});
export type PrepareActionProposalInput = z.infer<typeof PrepareActionProposalSchema>;

export const ConfirmActionProposalSchema = z.object({
  idempotencyKey: z.string().trim().min(8).max(120),
  nonce: z.string().trim().min(6).max(120),
});
export type ConfirmActionProposalInput = z.infer<typeof ConfirmActionProposalSchema>;

// Doctor Availability, Holidays, Commission Split & Waiting Room Queue Contracts
export const CreateDoctorScheduleSchema = z.object({
  resourceId: z.string().min(4),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string().regex(/^\d{2}:\d{2}$/),
  endTime: z.string().regex(/^\d{2}:\d{2}$/),
  slotDurationMinutes: z.number().int().min(5).max(120).default(20),
});
export type CreateDoctorScheduleInput = z.infer<typeof CreateDoctorScheduleSchema>;

export const CreateHolidayBlockSchema = z.object({
  resourceId: z.string().min(4),
  blockDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reason: z.string().trim().min(2).max(160).default('Doctor Leave / Public Holiday'),
});
export type CreateHolidayBlockInput = z.infer<typeof CreateHolidayBlockSchema>;

export const UpsertDoctorCommissionSchema = z.object({
  resourceId: z.string().min(4),
  doctorSharePercent: z.number().int().min(0).max(100),
});
export type UpsertDoctorCommissionInput = z.infer<typeof UpsertDoctorCommissionSchema>;

export const QueueTokenActionSchema = z.object({
  queueState: z.enum(['waiting', 'serving', 'completed', 'skipped']),
  delayMinutes: z.number().int().min(0).max(180).optional(),
});

export interface WaitingRoomTokenItem {
  appointmentId: string;
  tokenNumber: number;
  patientName: string;
  resourceId: string;
  resourceName: string;
  serviceName: string;
  startsAt: string;
  appointmentStatus: string;
  queueState: 'waiting' | 'serving' | 'completed' | 'skipped';
  delayMinutes: number;
}

export interface WaitingRoomDisplayResponse {
  tenantName: string;
  branchName: string;
  businessDate: string;
  updatedAt: string;
  nowServing: WaitingRoomTokenItem[];
  upNext: WaitingRoomTokenItem[];
  allActive: WaitingRoomTokenItem[];
}

export interface PatientVisitHistoryResponse {
  person: {
    id: string;
    displayName: string;
    phone: string;
    notes: string;
  };
  totalVisits: number;
  totalPaidMinor: number;
  unpaidBalanceMinor: number;
  appointments: Array<{
    id: string;
    businessDate: string;
    startsAt: string;
    status: string;
    serviceId: string;
    serviceName: string;
    resourceId: string;
    resourceName: string;
    bookedPriceMinor: number;
    tokenNumber: number;
  }>;
  payments: Array<{
    paymentId: string;
    amountMinor: number;
    method: string;
    receiptNumber: string | null;
    recordedAt: string;
  }>;
}

export interface DoctorPayoutReportResponse {
  businessDate: string;
  currency: string;
  totalGrossMinor: number;
  totalDoctorShareMinor: number;
  totalClinicShareMinor: number;
  doctors: Array<{
    resourceId: string;
    doctorName: string;
    specialty: string;
    visitCount: number;
    completedCount: number;
    grossFeesMinor: number;
    doctorSharePercent: number;
    doctorShareMinor: number;
    clinicShareMinor: number;
  }>;
}

