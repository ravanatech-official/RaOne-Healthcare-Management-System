import crypto from 'node:crypto';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db } from '../db/index.ts';
import {
  actionProposals,
  appointments,
  auditEvents,
  charges,
  commands,
  outboxEvents,
  paymentAllocations,
  payments,
  people,
  receipts,
  resources,
  services,
} from '../db/schema.ts';
import type {
  ConfirmActionProposalInput,
  CreateAppointmentInput,
  CreatePersonInput,
  PrepareActionProposalInput,
  RecordClinicPaymentInput,
  RescheduleAppointmentInput,
  TransitionAppointmentStatusInput,
  UpdatePersonInput,
  VoidClinicPaymentInput,
} from '../contracts/clinic.ts';
import {
  CreateAppointmentSchema,
  RecordClinicPaymentSchema,
  RescheduleAppointmentSchema,
} from '../contracts/clinic.ts';
import { ConflictError, NotFoundError, ValidationError } from './errors.ts';
import {
  type ActiveWorkspaceContext,
  assertCapability,
  assertPermission,
  getBusinessDateInTimezone,
} from './tenancy.ts';

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizePhoneLast4(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : digits;
}

function hashCanonical(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function isPgExclusionViolation(error: unknown): boolean {
  const err = error as { code?: string; cause?: { code?: string } };
  return err?.code === '23P01' || err?.cause?.code === '23P01';
}

// ------------------------------------------------------------
// 1. Directory People (Patients) CRUD + Duplicate Disambiguation
// ------------------------------------------------------------
export async function listPeopleForTenant(context: ActiveWorkspaceContext, query?: string) {
  assertCapability(context, 'appointments.manage');
  assertPermission(context, 'directory.read');

  const trimmed = query?.trim();
  const rows = await db
    .select()
    .from(people)
    .where(
      trimmed
        ? and(
            eq(people.tenantId, context.tenantId),
            or(
              ilike(people.displayName, `%${trimmed}%`),
              ilike(people.phone, `%${trimmed}%`),
              ilike(people.phoneLast4, `%${trimmed}%`)
            )
          )
        : eq(people.tenantId, context.tenantId)
    )
    .orderBy(desc(people.createdAt))
    .limit(100);

  return rows;
}

export async function createPersonForTenant(
  context: ActiveWorkspaceContext,
  input: CreatePersonInput,
  correlationId: string
) {
  assertCapability(context, 'appointments.manage');
  assertPermission(context, 'appointments.write');

  const normName = normalizeName(input.displayName);
  const phoneClean = input.phone.trim();
  const last4 = normalizePhoneLast4(phoneClean);

  // Duplicate disambiguation check (U05) unless explicitly confirmed by operator
  if (!input.confirmDuplicate) {
    const potentialDuplicates = await db
      .select({
        id: people.id,
        displayName: people.displayName,
        phone: people.phone,
        phoneLast4: people.phoneLast4,
      })
      .from(people)
      .where(
        and(
          eq(people.tenantId, context.tenantId),
          last4
            ? or(eq(people.normalizedName, normName), eq(people.phoneLast4, last4))
            : eq(people.normalizedName, normName)
        )
      )
      .limit(5);

    if (potentialDuplicates.length > 0) {
      throw new ConflictError(
        `Possible duplicate record found (${potentialDuplicates[0].displayName}). Review existing records or confirm creation.`,
        'POSSIBLE_DUPLICATE_PERSON',
        'errors.possible_duplicate_person'
      );
    }
  }

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(people)
      .values({
        tenantId: context.tenantId,
        branchId: context.branchId,
        displayName: input.displayName.trim(),
        normalizedName: normName,
        aliasesJson: input.aliases,
        phone: phoneClean,
        phoneLast4: last4,
        notes: input.notes.trim(),
        isSample: false,
      })
      .returning();

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'person.created',
      entityType: 'person',
      entityId: created.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: { confirmDuplicate: input.confirmDuplicate },
    });

    await tx.insert(outboxEvents).values({
      tenantId: context.tenantId,
      eventType: 'clinic.person.created',
      payloadJson: { personId: created.id, branchId: context.branchId },
    });

    return created;
  });
}

export async function updatePersonForTenant(
  context: ActiveWorkspaceContext,
  personId: string,
  input: UpdatePersonInput,
  correlationId: string
) {
  assertCapability(context, 'appointments.manage');
  assertPermission(context, 'appointments.write');

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(people)
      .where(and(eq(people.tenantId, context.tenantId), eq(people.id, personId)))
      .limit(1);

    if (!existing) {
      throw new NotFoundError('Patient record not found');
    }

    if (existing.version !== input.expectedVersion) {
      throw new ConflictError(
        'Patient record was modified by another user. Refresh and retry.',
        'VERSION_CONFLICT',
        'errors.version_conflict'
      );
    }

    const nextDisplayName = input.displayName?.trim() ?? existing.displayName;
    const nextPhone = input.phone !== undefined ? input.phone.trim() : existing.phone;

    const [updated] = await tx
      .update(people)
      .set({
        displayName: nextDisplayName,
        normalizedName: normalizeName(nextDisplayName),
        phone: nextPhone,
        phoneLast4: normalizePhoneLast4(nextPhone),
        aliasesJson: input.aliases ?? existing.aliasesJson,
        notes: input.notes !== undefined ? input.notes.trim() : existing.notes,
        version: existing.version + 1,
      })
      .where(and(eq(people.tenantId, context.tenantId), eq(people.id, personId)))
      .returning();

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'person.updated',
      entityType: 'person',
      entityId: personId,
      inputSource: 'ui',
      correlationId,
      metadataJson: { previousVersion: existing.version, newVersion: updated.version },
    });

    return updated;
  });
}

// ------------------------------------------------------------
// 2. Appointments: Book, Reschedule & Status Transitions (btree_gist overlap protected)
// ------------------------------------------------------------
export async function createAppointmentForTenant(
  context: ActiveWorkspaceContext,
  input: CreateAppointmentInput,
  correlationId: string,
  proposalId?: string,
  inputSource: 'ui' | 'text' | 'voice' = 'ui'
) {
  assertCapability(context, 'appointments.manage');
  assertPermission(context, 'appointments.write');

  const payloadHash = hashCanonical(input);

  const [existingCmd] = await db
    .select()
    .from(commands)
    .where(
      and(
        eq(commands.tenantId, context.tenantId),
        eq(commands.actorUserId, context.userId),
        eq(commands.commandType, 'clinic.appointment.create'),
        eq(commands.idempotencyKey, input.idempotencyKey)
      )
    )
    .limit(1);

  if (existingCmd && existingCmd.state === 'committed' && existingCmd.resultJson) {
    if (existingCmd.payloadHash !== payloadHash) {
      throw new ConflictError('Idempotency key already used with different appointment payload');
    }
    return existingCmd.resultJson;
  }

  try {
    return await db.transaction(async (tx) => {
      const [cmd] = await tx
        .insert(commands)
        .values({
          tenantId: context.tenantId,
          actorUserId: context.userId,
          commandType: 'clinic.appointment.create',
          idempotencyKey: input.idempotencyKey,
          payloadHash,
          proposalId: proposalId ?? null,
          state: 'accepted',
        })
        .returning();

      const [person] = await tx
        .select()
        .from(people)
        .where(and(eq(people.tenantId, context.tenantId), eq(people.id, input.personId)))
        .limit(1);
      if (!person) throw new NotFoundError('Patient record not found');

      const [service] = await tx
        .select()
        .from(services)
        .where(
          and(
            eq(services.tenantId, context.tenantId),
            eq(services.id, input.serviceId),
            eq(services.active, true)
          )
        )
        .limit(1);
      if (!service) throw new NotFoundError('Clinic service not found');

      const [resource] = await tx
        .select()
        .from(resources)
        .where(
          and(
            eq(resources.tenantId, context.tenantId),
            eq(resources.id, input.resourceId),
            eq(resources.active, true)
          )
        )
        .limit(1);
      if (!resource) throw new NotFoundError('Practitioner / resource not found');

      const startsAt = new Date(input.startsAt);
      if (Number.isNaN(startsAt.getTime())) {
        throw new ValidationError('Invalid appointment start time');
      }
      const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);
      const businessDate = getBusinessDateInTimezone(context.timezone, startsAt);

      const [created] = await tx
        .insert(appointments)
        .values({
          tenantId: context.tenantId,
          branchId: context.branchId,
          personId: person.id,
          serviceId: service.id,
          resourceId: resource.id,
          startsAt,
          endsAt,
          businessDate,
          status: 'scheduled',
          bookedDurationMinutes: service.durationMinutes,
          bookedPriceMinor: service.priceMinor,
          currency: context.currency,
          notes: input.notes.trim(),
          isSample: false,
          createdByUserId: context.userId,
        })
        .returning();

      const result = {
        appointment: created,
        personName: person.displayName,
        serviceName: service.name,
        resourceName: resource.name,
      };

      await tx
        .update(commands)
        .set({ state: 'committed', resultJson: result, committedAt: new Date() })
        .where(eq(commands.id, cmd.id));

      await tx.insert(auditEvents).values({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorUid: context.uid,
        action: 'appointment.created',
        entityType: 'appointment',
        entityId: created.id,
        inputSource,
        correlationId,
        metadataJson: { businessDate, startsAt: startsAt.toISOString(), resourceId: resource.id },
      });

      await tx.insert(outboxEvents).values({
        tenantId: context.tenantId,
        eventType: 'clinic.appointment.created',
        payloadJson: { appointmentId: created.id, businessDate, branchId: context.branchId },
      });

      return result;
    });
  } catch (error) {
    if (isPgExclusionViolation(error)) {
      throw new ConflictError(
        'Selected practitioner already has an overlapping appointment in that time slot.',
        'APPOINTMENT_OVERLAP',
        'errors.appointment_overlap'
      );
    }
    throw error;
  }
}

export async function rescheduleAppointmentForTenant(
  context: ActiveWorkspaceContext,
  appointmentId: string,
  input: RescheduleAppointmentInput,
  correlationId: string,
  proposalId?: string,
  inputSource: 'ui' | 'text' | 'voice' = 'ui'
) {
  assertCapability(context, 'appointments.manage');
  assertPermission(context, 'appointments.write');

  const payloadHash = hashCanonical({ appointmentId, ...input });

  const [existingCmd] = await db
    .select()
    .from(commands)
    .where(
      and(
        eq(commands.tenantId, context.tenantId),
        eq(commands.actorUserId, context.userId),
        eq(commands.commandType, 'clinic.appointment.reschedule'),
        eq(commands.idempotencyKey, input.idempotencyKey)
      )
    )
    .limit(1);

  if (existingCmd && existingCmd.state === 'committed' && existingCmd.resultJson) {
    return existingCmd.resultJson;
  }

  try {
    return await db.transaction(async (tx) => {
      const [cmd] = await tx
        .insert(commands)
        .values({
          tenantId: context.tenantId,
          actorUserId: context.userId,
          commandType: 'clinic.appointment.reschedule',
          idempotencyKey: input.idempotencyKey,
          payloadHash,
          proposalId: proposalId ?? null,
          state: 'accepted',
        })
        .returning();

      const [existing] = await tx
        .select()
        .from(appointments)
        .where(and(eq(appointments.tenantId, context.tenantId), eq(appointments.id, appointmentId)))
        .limit(1);

      if (!existing) throw new NotFoundError('Appointment not found');

      if (existing.version !== input.expectedVersion) {
        throw new ConflictError(
          'Appointment was updated elsewhere. Refresh and retry.',
          'VERSION_CONFLICT',
          'errors.version_conflict'
        );
      }

      if (existing.status === 'cancelled' || existing.status === 'completed') {
        throw new ConflictError('Cannot reschedule a completed or cancelled appointment');
      }

      const nextResourceId = input.resourceId ?? existing.resourceId;
      if (input.resourceId) {
        const [resRow] = await tx
          .select({ id: resources.id })
          .from(resources)
          .where(and(eq(resources.tenantId, context.tenantId), eq(resources.id, input.resourceId)))
          .limit(1);
        if (!resRow) throw new NotFoundError('Target practitioner not found');
      }

      const startsAt = new Date(input.startsAt);
      if (Number.isNaN(startsAt.getTime())) {
        throw new ValidationError('Invalid appointment start time');
      }
      const endsAt = new Date(startsAt.getTime() + existing.bookedDurationMinutes * 60_000);
      const businessDate = getBusinessDateInTimezone(context.timezone, startsAt);

      const [updated] = await tx
        .update(appointments)
        .set({
          resourceId: nextResourceId,
          startsAt,
          endsAt,
          businessDate,
          notes: input.notes !== undefined ? input.notes.trim() : existing.notes,
          version: existing.version + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(appointments.tenantId, context.tenantId), eq(appointments.id, appointmentId)))
        .returning();

      const result = { appointment: updated };

      await tx
        .update(commands)
        .set({ state: 'committed', resultJson: result, committedAt: new Date() })
        .where(eq(commands.id, cmd.id));

      await tx.insert(auditEvents).values({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorUid: context.uid,
        action: 'appointment.rescheduled',
        entityType: 'appointment',
        entityId: appointmentId,
        inputSource,
        correlationId,
        metadataJson: {
          previousStartsAt: existing.startsAt.toISOString(),
          newStartsAt: startsAt.toISOString(),
          newVersion: updated.version,
        },
      });

      await tx.insert(outboxEvents).values({
        tenantId: context.tenantId,
        eventType: 'clinic.appointment.rescheduled',
        payloadJson: { appointmentId, businessDate },
      });

      return result;
    });
  } catch (error) {
    if (isPgExclusionViolation(error)) {
      throw new ConflictError(
        'Selected practitioner already has an overlapping appointment in that time slot.',
        'APPOINTMENT_OVERLAP',
        'errors.appointment_overlap'
      );
    }
    throw error;
  }
}

const ALLOWED_APPT_TRANSITIONS: Record<string, string[]> = {
  scheduled: ['arrived', 'completed', 'cancelled', 'no_show'],
  arrived: ['completed', 'cancelled', 'no_show'],
  completed: [],
  cancelled: [],
  no_show: [],
};

export async function transitionAppointmentStatusForTenant(
  context: ActiveWorkspaceContext,
  appointmentId: string,
  input: TransitionAppointmentStatusInput,
  correlationId: string
) {
  assertCapability(context, 'attendance.manage');
  if (input.status === 'arrived' || input.status === 'no_show' || input.status === 'completed') {
    assertPermission(context, 'attendance.write');
  } else {
    assertPermission(context, 'appointments.write');
  }

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(appointments)
      .where(and(eq(appointments.tenantId, context.tenantId), eq(appointments.id, appointmentId)))
      .limit(1);

    if (!existing) throw new NotFoundError('Appointment not found');

    if (existing.version !== input.expectedVersion) {
      throw new ConflictError(
        'Appointment was modified elsewhere. Refresh and retry.',
        'VERSION_CONFLICT'
      );
    }

    const allowed = ALLOWED_APPT_TRANSITIONS[existing.status] ?? [];
    if (!allowed.includes(input.status)) {
      throw new ConflictError(
        `Cannot transition appointment from ${existing.status} to ${input.status}`
      );
    }

    const [updated] = await tx
      .update(appointments)
      .set({
        status: input.status,
        notes: input.notes !== undefined ? input.notes.trim() : existing.notes,
        version: existing.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(appointments.tenantId, context.tenantId), eq(appointments.id, appointmentId)))
      .returning();

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: `appointment.status.${input.status}`,
      entityType: 'appointment',
      entityId: appointmentId,
      inputSource: 'ui',
      correlationId,
      metadataJson: { from: existing.status, to: input.status },
    });

    await tx.insert(outboxEvents).values({
      tenantId: context.tenantId,
      eventType: 'clinic.appointment.status_changed',
      payloadJson: { appointmentId, from: existing.status, to: input.status },
    });

    return { appointment: updated };
  });
}

// ------------------------------------------------------------
// 3. Clinic Billing: Charges, Payments, Receipts & Step-Up Void
// ------------------------------------------------------------
export async function listClinicPaymentsAndReceipts(context: ActiveWorkspaceContext) {
  assertCapability(context, 'collections.record');
  assertPermission(context, 'reports.branch_summary');

  const canViewAll = context.permissions.includes('reports.all_financials');

  const rows = await db
    .select({
      paymentId: payments.id,
      amountMinor: payments.amountMinor,
      currency: payments.currency,
      method: payments.method,
      referenceNumber: payments.referenceNumber,
      status: payments.status,
      recordedAt: payments.recordedAt,
      recordedByUserId: payments.recordedByUserId,
      personId: people.id,
      personName: people.displayName,
      receiptNumber: receipts.receiptNumber,
      receiptSnapshot: receipts.snapshotJson,
    })
    .from(payments)
    .innerJoin(people, and(eq(payments.personId, people.id), eq(people.tenantId, payments.tenantId)))
    .leftJoin(
      receipts,
      and(eq(receipts.paymentId, payments.id), eq(receipts.tenantId, payments.tenantId))
    )
    .where(
      canViewAll
        ? eq(payments.tenantId, context.tenantId)
        : and(
            eq(payments.tenantId, context.tenantId),
            eq(payments.recordedByUserId, context.userId)
          )
    )
    .orderBy(desc(payments.recordedAt))
    .limit(50);

  return rows;
}

export async function recordClinicPaymentForTenant(
  context: ActiveWorkspaceContext,
  input: RecordClinicPaymentInput,
  correlationId: string,
  proposalId?: string,
  inputSource: 'ui' | 'text' | 'voice' = 'ui'
) {
  assertCapability(context, 'collections.record');
  assertPermission(context, 'payments.record');

  const payloadHash = hashCanonical(input);

  const [existingCmd] = await db
    .select()
    .from(commands)
    .where(
      and(
        eq(commands.tenantId, context.tenantId),
        eq(commands.actorUserId, context.userId),
        eq(commands.commandType, 'clinic.payment.record'),
        eq(commands.idempotencyKey, input.idempotencyKey)
      )
    )
    .limit(1);

  if (existingCmd && existingCmd.state === 'committed' && existingCmd.resultJson) {
    return existingCmd.resultJson;
  }

  return db.transaction(async (tx) => {
    const [cmd] = await tx
      .insert(commands)
      .values({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        commandType: 'clinic.payment.record',
        idempotencyKey: input.idempotencyKey,
        payloadHash,
        proposalId: proposalId ?? null,
        state: 'accepted',
      })
      .returning();

    const [person] = await tx
      .select()
      .from(people)
      .where(and(eq(people.tenantId, context.tenantId), eq(people.id, input.personId)))
      .limit(1);
    if (!person) throw new NotFoundError('Patient record not found');

    if (input.appointmentId) {
      const [apt] = await tx
        .select({ id: appointments.id })
        .from(appointments)
        .where(
          and(
            eq(appointments.tenantId, context.tenantId),
            eq(appointments.id, input.appointmentId)
          )
        )
        .limit(1);
      if (!apt) throw new NotFoundError('Linked appointment not found');
    }

    const [charge] = await tx
      .insert(charges)
      .values({
        tenantId: context.tenantId,
        branchId: context.branchId,
        personId: person.id,
        appointmentId: input.appointmentId ?? null,
        description: input.description.trim(),
        currency: context.currency,
        grossAmountMinor: input.amountMinor,
        creditedAmountMinor: input.amountMinor,
        createdByUserId: context.userId,
      })
      .returning();

    const [payment] = await tx
      .insert(payments)
      .values({
        tenantId: context.tenantId,
        branchId: context.branchId,
        personId: person.id,
        amountMinor: input.amountMinor,
        currency: context.currency,
        method: input.method,
        referenceNumber: input.referenceNumber.trim(),
        status: 'posted',
        recordedByUserId: context.userId,
      })
      .returning();

    await tx.insert(paymentAllocations).values({
      tenantId: context.tenantId,
      paymentId: payment.id,
      chargeId: charge.id,
      amountMinor: input.amountMinor,
      currency: context.currency,
      active: true,
    });

    const businessDate = getBusinessDateInTimezone(context.timezone);
    const receiptNumber = `CLN-${businessDate.replace(/-/g, '')}-${crypto
      .randomBytes(3)
      .toString('hex')
      .toUpperCase()}`;

    const snapshotJson = {
      receiptNumber,
      tenantName: context.tenantName,
      branchName: context.branchName,
      personName: person.displayName,
      description: charge.description,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      method: payment.method,
      referenceNumber: payment.referenceNumber,
      recordedAt: payment.recordedAt.toISOString(),
    };

    const [receipt] = await tx
      .insert(receipts)
      .values({
        tenantId: context.tenantId,
        paymentId: payment.id,
        receiptNumber,
        snapshotJson,
      })
      .returning();

    const result = { charge, payment, receipt };

    await tx
      .update(commands)
      .set({ state: 'committed', resultJson: result, committedAt: new Date() })
      .where(eq(commands.id, cmd.id));

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'clinic.payment.recorded',
      entityType: 'payment',
      entityId: payment.id,
      inputSource,
      correlationId,
      metadataJson: {
        receiptNumber,
        amountMinor: payment.amountMinor,
        method: payment.method,
      },
    });

    await tx.insert(outboxEvents).values({
      tenantId: context.tenantId,
      eventType: 'clinic.payment.recorded',
      payloadJson: { paymentId: payment.id, receiptNumber, amountMinor: payment.amountMinor },
    });

    return result;
  });
}

export async function voidClinicPaymentForTenant(
  context: ActiveWorkspaceContext,
  paymentId: string,
  input: VoidClinicPaymentInput,
  correlationId: string
) {
  assertCapability(context, 'collections.record');
  assertPermission(context, 'payments.reverse_stepup');

  return db.transaction(async (tx) => {
    const [payment] = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.tenantId, context.tenantId), eq(payments.id, paymentId)))
      .limit(1);

    if (!payment) throw new NotFoundError('Payment record not found');
    if (payment.status === 'voided') {
      throw new ConflictError('Payment is already voided');
    }

    const [updated] = await tx
      .update(payments)
      .set({ status: 'voided' })
      .where(and(eq(payments.tenantId, context.tenantId), eq(payments.id, paymentId)))
      .returning();

    const allocs = await tx
      .select()
      .from(paymentAllocations)
      .where(
        and(
          eq(paymentAllocations.tenantId, context.tenantId),
          eq(paymentAllocations.paymentId, paymentId),
          eq(paymentAllocations.active, true)
        )
      );

    await tx
      .update(paymentAllocations)
      .set({ active: false })
      .where(
        and(
          eq(paymentAllocations.tenantId, context.tenantId),
          eq(paymentAllocations.paymentId, paymentId)
        )
      );

    for (const alloc of allocs) {
      await tx
        .update(charges)
        .set({
          creditedAmountMinor: sql`GREATEST(0, ${charges.creditedAmountMinor} - ${alloc.amountMinor})`,
          version: sql`${charges.version} + 1`,
        })
        .where(and(eq(charges.tenantId, context.tenantId), eq(charges.id, alloc.chargeId)));
    }

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'clinic.payment.voided',
      entityType: 'payment',
      entityId: paymentId,
      inputSource: 'ui',
      correlationId,
      metadataJson: { reason: input.reason, amountMinor: payment.amountMinor },
    });

    await tx.insert(outboxEvents).values({
      tenantId: context.tenantId,
      eventType: 'clinic.payment.voided',
      payloadJson: { paymentId, reason: input.reason },
    });

    return { payment: updated };
  });
}

// ------------------------------------------------------------
// 4. Draft -> Confirm Action Proposal Engine (Voice / Text / UI)
// ------------------------------------------------------------
export async function prepareActionProposal(
  context: ActiveWorkspaceContext,
  input: PrepareActionProposalInput,
  correlationId: string
) {
  assertCapability(context, 'appointments.manage');

  if (input.actionType === 'create_appointment') {
    assertPermission(context, 'appointments.write');
    const candidate = CreateAppointmentSchema.omit({ idempotencyKey: true }).safeParse(input.payload);
    if (!candidate.success) {
      throw new ValidationError(candidate.error.issues[0]?.message || 'Incomplete appointment draft');
    }
  } else if (input.actionType === 'reschedule_appointment') {
    assertPermission(context, 'appointments.write');
    const candidate = RescheduleAppointmentSchema.omit({ idempotencyKey: true }).safeParse(
      input.payload
    );
    if (!candidate.success) {
      throw new ValidationError(candidate.error.issues[0]?.message || 'Incomplete reschedule draft');
    }
  } else if (input.actionType === 'record_payment') {
    assertPermission(context, 'payments.record');
    const candidate = RecordClinicPaymentSchema.omit({ idempotencyKey: true }).safeParse(
      input.payload
    );
    if (!candidate.success) {
      throw new ValidationError(candidate.error.issues[0]?.message || 'Incomplete payment draft');
    }
  }

  const nonce = crypto.randomBytes(12).toString('hex');
  const payloadHash = hashCanonical(input.payload);
  const expiresAt = new Date(Date.now() + 15 * 60_000);

  const [proposal] = await db
    .insert(actionProposals)
    .values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actionType: input.actionType,
      canonicalPayloadJson: input.payload,
      payloadHash,
      nonce,
      state: 'draft',
      expiresAt,
    })
    .returning();

  await db.insert(auditEvents).values({
    tenantId: context.tenantId,
    actorUserId: context.userId,
    actorUid: context.uid,
    action: 'assistant.proposal_prepared',
    entityType: 'action_proposal',
    entityId: proposal.id,
    inputSource: input.inputSource,
    correlationId,
    metadataJson: { actionType: input.actionType },
  });

  return proposal;
}

export async function confirmActionProposal(
  context: ActiveWorkspaceContext,
  proposalId: string,
  input: ConfirmActionProposalInput,
  correlationId: string
) {
  const [proposal] = await db
    .select()
    .from(actionProposals)
    .where(
      and(
        eq(actionProposals.tenantId, context.tenantId),
        eq(actionProposals.id, proposalId),
        eq(actionProposals.actorUserId, context.userId)
      )
    )
    .limit(1);

  if (!proposal) throw new NotFoundError('Action proposal not found');
  if (proposal.state !== 'draft') {
    throw new ConflictError(`Proposal is already ${proposal.state}`);
  }
  if (proposal.nonce !== input.nonce) {
    throw new ConflictError('Proposal confirmation nonce mismatch');
  }
  if (proposal.expiresAt.getTime() < Date.now()) {
    await db
      .update(actionProposals)
      .set({ state: 'expired' })
      .where(eq(actionProposals.id, proposal.id));
    throw new ConflictError('Action proposal expired. Please prepare again.');
  }

  const payload = proposal.canonicalPayloadJson as Record<string, unknown>;
  let result: unknown;

  if (proposal.actionType === 'create_appointment') {
    const parsed = CreateAppointmentSchema.parse({ ...payload, idempotencyKey: input.idempotencyKey });
    result = await createAppointmentForTenant(context, parsed, correlationId, proposal.id, 'voice');
  } else if (proposal.actionType === 'reschedule_appointment') {
    const appointmentId = String(payload.appointmentId || '');
    const parsed = RescheduleAppointmentSchema.parse({
      ...payload,
      idempotencyKey: input.idempotencyKey,
    });
    result = await rescheduleAppointmentForTenant(
      context,
      appointmentId,
      parsed,
      correlationId,
      proposal.id,
      'voice'
    );
  } else if (proposal.actionType === 'record_payment') {
    const parsed = RecordClinicPaymentSchema.parse({
      ...payload,
      idempotencyKey: input.idempotencyKey,
    });
    result = await recordClinicPaymentForTenant(context, parsed, correlationId, proposal.id, 'voice');
  } else {
    throw new ValidationError(`Unsupported proposal actionType ${proposal.actionType}`);
  }

  await db
    .update(actionProposals)
    .set({ state: 'consumed', consumedAt: new Date() })
    .where(eq(actionProposals.id, proposal.id));

  return { proposalId: proposal.id, actionType: proposal.actionType, result };
}
