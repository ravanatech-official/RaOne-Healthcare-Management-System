import crypto from 'node:crypto';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { db, isDatabaseConfigured } from '../db/index.ts';
import {
  actionProposals,
  appointmentQueueTokens,
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
import { addMemAuditEvent, getMemoryStore } from './memory-store.ts';
import { assertWorkspaceNotReadOnlyGrace } from './subscription-billing.ts';
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

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const pattern = trimmed?.toLowerCase();
    return store.people
      .filter((p) => {
        if (p.tenantId !== context.tenantId) return false;
        if (!pattern) return true;
        return (
          p.displayName.toLowerCase().includes(pattern) ||
          p.phone.toLowerCase().includes(pattern) ||
          p.phoneLast4.includes(pattern)
        );
      })
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 100);
  }

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
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const normName = normalizeName(input.displayName);
  const phoneClean = input.phone.trim();
  const last4 = normalizePhoneLast4(phoneClean);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    if (!input.confirmDuplicate) {
      const potentialDuplicates = store.people.filter(
        (p) =>
          p.tenantId === context.tenantId &&
          (p.normalizedName === normName || (Boolean(last4) && p.phoneLast4 === last4))
      );
      if (potentialDuplicates.length > 0) {
        throw new ConflictError(
          `Possible duplicate record found (${potentialDuplicates[0].displayName}). Review existing records or confirm creation.`,
          'POSSIBLE_DUPLICATE_PERSON',
          'errors.possible_duplicate_person'
        );
      }
    }

    const created = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      displayName: input.displayName.trim(),
      normalizedName: normName,
      aliasesJson: input.aliases,
      phone: phoneClean,
      phoneLast4: last4,
      notes: input.notes.trim(),
      isSample: false,
      version: 1,
      createdAt: new Date(),
    };
    store.people.push(created);

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'person.created',
      entityType: 'person',
      entityId: created.id,
      correlationId,
      metadataJson: { confirmDuplicate: input.confirmDuplicate },
    });

    return created;
  }

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
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const existing = store.people.find((p) => p.tenantId === context.tenantId && p.id === personId);
    if (!existing) throw new NotFoundError('Patient record not found');
    if (existing.version !== input.expectedVersion) {
      throw new ConflictError(
        'Patient record was modified by another user. Refresh and retry.',
        'VERSION_CONFLICT',
        'errors.version_conflict'
      );
    }
    const nextDisplayName = input.displayName?.trim() ?? existing.displayName;
    const nextPhone = input.phone !== undefined ? input.phone.trim() : existing.phone;
    existing.displayName = nextDisplayName;
    existing.normalizedName = normalizeName(nextDisplayName);
    existing.phone = nextPhone;
    existing.phoneLast4 = normalizePhoneLast4(nextPhone);
    if (input.aliases !== undefined) existing.aliasesJson = input.aliases;
    if (input.notes !== undefined) existing.notes = input.notes.trim();
    existing.version += 1;

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'person.updated',
      entityType: 'person',
      entityId: personId,
      correlationId,
      metadataJson: { newVersion: existing.version },
    });
    return existing;
  }

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
// 2. Appointments: Book, Reschedule & Status Transitions
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
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const payloadHash = hashCanonical(input);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const existingCmd = store.commands.find(
      (c) =>
        c.tenantId === context.tenantId &&
        c.actorUserId === context.userId &&
        c.commandType === 'clinic.appointment.create' &&
        c.idempotencyKey === input.idempotencyKey
    );
    if (existingCmd && existingCmd.state === 'committed' && existingCmd.resultJson) {
      if (existingCmd.payloadHash !== payloadHash) {
        throw new ConflictError('Idempotency key already used with different appointment payload');
      }
      return existingCmd.resultJson;
    }

    const person = store.people.find((p) => p.tenantId === context.tenantId && p.id === input.personId);
    if (!person) throw new NotFoundError('Patient record not found');

    const service = store.services.find(
      (s) => s.tenantId === context.tenantId && s.id === input.serviceId && s.active
    );
    if (!service) throw new NotFoundError('Clinic service not found');

    const resource = store.resources.find(
      (r) => r.tenantId === context.tenantId && r.id === input.resourceId && r.active
    );
    if (!resource) throw new NotFoundError('Practitioner / resource not found');

    const startsAt = new Date(input.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      throw new ValidationError('Invalid appointment start time');
    }
    const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);
    const businessDate = getBusinessDateInTimezone(context.timezone, startsAt);

    const overlap = store.appointments.find(
      (a) =>
        a.tenantId === context.tenantId &&
        a.resourceId === resource.id &&
        a.status !== 'cancelled' &&
        startsAt < a.endsAt &&
        endsAt > a.startsAt
    );
    if (overlap) {
      throw new ConflictError(
        'Selected practitioner already has an overlapping appointment in that time slot.',
        'APPOINTMENT_OVERLAP',
        'errors.appointment_overlap'
      );
    }

    const created = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      personId: person.id,
      serviceId: service.id,
      resourceId: resource.id,
      startsAt,
      endsAt,
      businessDate,
      status: 'scheduled' as const,
      bookedDurationMinutes: service.durationMinutes,
      bookedPriceMinor: service.priceMinor,
      currency: context.currency,
      notes: input.notes.trim(),
      isSample: false,
      version: 1,
      createdByUserId: context.userId,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    store.appointments.push(created);

    const existingTokens = store.appointmentQueueTokens.filter(
      (t) =>
        t.tenantId === context.tenantId &&
        t.branchId === context.branchId &&
        t.businessDate === businessDate
    );
    const nextToken =
      existingTokens.reduce((max, t) => (t.tokenNumber > max ? t.tokenNumber : max), 0) + 1;
    store.appointmentQueueTokens.push({
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      businessDate,
      appointmentId: created.id,
      resourceId: resource.id,
      tokenNumber: nextToken,
      queueState: 'waiting',
      delayMinutes: 0,
      calledAt: null,
      createdAt: new Date(),
    });

    const result = {
      appointment: created,
      personName: person.displayName,
      serviceName: service.name,
      resourceName: resource.name,
      tokenNumber: nextToken,
    };

    store.commands.push({
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      actorUserId: context.userId,
      commandType: 'clinic.appointment.create',
      idempotencyKey: input.idempotencyKey,
      payloadHash,
      proposalId: proposalId ?? null,
      state: 'committed',
      resultJson: result,
      committedAt: new Date(),
    });

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'appointment.created',
      entityType: 'appointment',
      entityId: created.id,
      inputSource,
      correlationId,
      metadataJson: { businessDate, tokenNumber: nextToken, startsAt: startsAt.toISOString(), resourceId: resource.id },
    });

    return result;
  }

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

      const [maxTokenRow] = await tx
        .select({
          maxNum: sql<number>`COALESCE(MAX(${appointmentQueueTokens.tokenNumber}), 0)::int`,
        })
        .from(appointmentQueueTokens)
        .where(
          and(
            eq(appointmentQueueTokens.tenantId, context.tenantId),
            eq(appointmentQueueTokens.branchId, context.branchId),
            eq(appointmentQueueTokens.businessDate, businessDate)
          )
        );
      const nextToken = (maxTokenRow?.maxNum ?? 0) + 1;

      await tx.insert(appointmentQueueTokens).values({
        tenantId: context.tenantId,
        branchId: context.branchId,
        businessDate,
        appointmentId: created.id,
        resourceId: resource.id,
        tokenNumber: nextToken,
        queueState: 'waiting',
      });

      const result = {
        appointment: created,
        personName: person.displayName,
        serviceName: service.name,
        resourceName: resource.name,
        tokenNumber: nextToken,
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
        metadataJson: {
          businessDate,
          tokenNumber: nextToken,
          startsAt: startsAt.toISOString(),
          resourceId: resource.id,
        },
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
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const payloadHash = hashCanonical({ appointmentId, ...input });

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const existingCmd = store.commands.find(
      (c) =>
        c.tenantId === context.tenantId &&
        c.actorUserId === context.userId &&
        c.commandType === 'clinic.appointment.reschedule' &&
        c.idempotencyKey === input.idempotencyKey
    );
    if (existingCmd && existingCmd.state === 'committed' && existingCmd.resultJson) {
      return existingCmd.resultJson;
    }

    const existing = store.appointments.find(
      (a) => a.tenantId === context.tenantId && a.id === appointmentId
    );
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
      const resRow = store.resources.find(
        (r) => r.tenantId === context.tenantId && r.id === input.resourceId
      );
      if (!resRow) throw new NotFoundError('Target practitioner not found');
    }

    const startsAt = new Date(input.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      throw new ValidationError('Invalid appointment start time');
    }
    const endsAt = new Date(startsAt.getTime() + existing.bookedDurationMinutes * 60_000);
    const businessDate = getBusinessDateInTimezone(context.timezone, startsAt);

    const overlap = store.appointments.find(
      (a) =>
        a.tenantId === context.tenantId &&
        a.id !== appointmentId &&
        a.resourceId === nextResourceId &&
        a.status !== 'cancelled' &&
        startsAt < a.endsAt &&
        endsAt > a.startsAt
    );
    if (overlap) {
      throw new ConflictError(
        'Selected practitioner already has an overlapping appointment in that time slot.',
        'APPOINTMENT_OVERLAP',
        'errors.appointment_overlap'
      );
    }

    existing.resourceId = nextResourceId;
    existing.startsAt = startsAt;
    existing.endsAt = endsAt;
    existing.businessDate = businessDate;
    if (input.notes !== undefined) existing.notes = input.notes.trim();
    existing.version += 1;
    existing.updatedAt = new Date();

    const result = { appointment: existing };
    store.commands.push({
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      actorUserId: context.userId,
      commandType: 'clinic.appointment.reschedule',
      idempotencyKey: input.idempotencyKey,
      payloadHash,
      proposalId: proposalId ?? null,
      state: 'committed',
      resultJson: result,
      committedAt: new Date(),
    });

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'appointment.rescheduled',
      entityType: 'appointment',
      entityId: appointmentId,
      inputSource,
      correlationId,
      metadataJson: { newStartsAt: startsAt.toISOString(), newVersion: existing.version },
    });

    return result;
  }

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
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const existing = store.appointments.find(
      (a) => a.tenantId === context.tenantId && a.id === appointmentId
    );
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

    const from = existing.status;
    existing.status = input.status;
    if (input.notes !== undefined) existing.notes = input.notes.trim();
    existing.version += 1;
    existing.updatedAt = new Date();

    const tok = store.appointmentQueueTokens.find(
      (t) => t.tenantId === context.tenantId && t.appointmentId === appointmentId
    );
    if (tok) {
      if (input.status === 'completed') tok.queueState = 'completed';
      else if (input.status === 'cancelled' || input.status === 'no_show') tok.queueState = 'skipped';
    }

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: `appointment.status.${input.status}`,
      entityType: 'appointment',
      entityId: appointmentId,
      correlationId,
      metadataJson: { from, to: input.status },
    });

    return { appointment: existing };
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

    if (input.status === 'completed' || input.status === 'cancelled' || input.status === 'no_show') {
      await tx
        .update(appointmentQueueTokens)
        .set({ queueState: input.status === 'completed' ? 'completed' : 'skipped' })
        .where(
          and(
            eq(appointmentQueueTokens.tenantId, context.tenantId),
            eq(appointmentQueueTokens.appointmentId, appointmentId)
          )
        );
    }

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

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    return store.payments
      .filter(
        (p) =>
          p.tenantId === context.tenantId &&
          (canViewAll || p.recordedByUserId === context.userId)
      )
      .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime())
      .slice(0, 50)
      .map((p) => {
        const person = store.people.find((per) => per.id === p.personId);
        const rcp = store.receipts.find((r) => r.paymentId === p.id);
        return {
          paymentId: p.id,
          amountMinor: p.amountMinor,
          currency: p.currency,
          method: p.method,
          referenceNumber: p.referenceNumber,
          status: p.status,
          recordedAt: p.recordedAt,
          recordedByUserId: p.recordedByUserId,
          personId: p.personId,
          personName: person?.displayName ?? 'Patient',
          receiptNumber: rcp?.receiptNumber ?? null,
          receiptSnapshot: rcp?.snapshotJson ?? null,
        };
      });
  }

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
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const payloadHash = hashCanonical(input);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const existingCmd = store.commands.find(
      (c) =>
        c.tenantId === context.tenantId &&
        c.actorUserId === context.userId &&
        c.commandType === 'clinic.payment.record' &&
        c.idempotencyKey === input.idempotencyKey
    );
    if (existingCmd && existingCmd.state === 'committed' && existingCmd.resultJson) {
      return existingCmd.resultJson;
    }

    const person = store.people.find((p) => p.tenantId === context.tenantId && p.id === input.personId);
    if (!person) throw new NotFoundError('Patient record not found');

    if (input.appointmentId) {
      const apt = store.appointments.find(
        (a) => a.tenantId === context.tenantId && a.id === input.appointmentId
      );
      if (!apt) throw new NotFoundError('Linked appointment not found');
    }

    const now = new Date();
    const charge = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      personId: person.id,
      appointmentId: input.appointmentId ?? null,
      description: input.description.trim(),
      currency: context.currency,
      grossAmountMinor: input.amountMinor,
      creditedAmountMinor: input.amountMinor,
      version: 1,
      createdByUserId: context.userId,
      createdAt: now,
    };
    store.charges.push(charge);

    const payment = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      personId: person.id,
      amountMinor: input.amountMinor,
      currency: context.currency,
      method: input.method,
      referenceNumber: input.referenceNumber.trim(),
      status: 'posted' as const,
      effectiveAt: now,
      recordedAt: now,
      recordedByUserId: context.userId,
    };
    store.payments.push(payment);

    store.paymentAllocations.push({
      id: crypto.randomUUID(),
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

    const receipt = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      paymentId: payment.id,
      receiptNumber,
      snapshotJson,
      issuedAt: now,
    };
    store.receipts.push(receipt);

    const result = { charge, payment, receipt };
    store.commands.push({
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      actorUserId: context.userId,
      commandType: 'clinic.payment.record',
      idempotencyKey: input.idempotencyKey,
      payloadHash,
      proposalId: proposalId ?? null,
      state: 'committed',
      resultJson: result,
      committedAt: now,
    });

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'clinic.payment.recorded',
      entityType: 'payment',
      entityId: payment.id,
      inputSource,
      correlationId,
      metadataJson: { receiptNumber, amountMinor: payment.amountMinor, method: payment.method },
    });

    return result;
  }

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
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const payment = store.payments.find(
      (p) => p.tenantId === context.tenantId && p.id === paymentId
    );
    if (!payment) throw new NotFoundError('Payment record not found');
    if (payment.status === 'voided') throw new ConflictError('Payment is already voided');

    payment.status = 'voided';
    for (const alloc of store.paymentAllocations) {
      if (alloc.tenantId === context.tenantId && alloc.paymentId === paymentId && alloc.active) {
        alloc.active = false;
        const charge = store.charges.find(
          (c) => c.tenantId === context.tenantId && c.id === alloc.chargeId
        );
        if (charge) {
          charge.creditedAmountMinor = Math.max(0, charge.creditedAmountMinor - alloc.amountMinor);
          charge.version += 1;
        }
      }
    }

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'clinic.payment.voided',
      entityType: 'payment',
      entityId: paymentId,
      correlationId,
      metadataJson: { reason: input.reason, amountMinor: payment.amountMinor },
    });
    return { payment };
  }

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
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

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

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const proposal = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actionType: input.actionType,
      canonicalPayloadJson: input.payload,
      payloadHash,
      nonce,
      state: 'draft' as const,
      expiresAt,
      consumedAt: null,
      createdAt: new Date(),
    };
    store.actionProposals.push(proposal);

    addMemAuditEvent({
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
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const proposal = store.actionProposals.find(
      (p) =>
        p.tenantId === context.tenantId &&
        p.id === proposalId &&
        p.actorUserId === context.userId
    );
    if (!proposal) throw new NotFoundError('Action proposal not found');
    if (proposal.state !== 'draft') {
      throw new ConflictError(`Proposal is already ${proposal.state}`);
    }
    if (proposal.nonce !== input.nonce) {
      throw new ConflictError('Proposal confirmation nonce mismatch');
    }
    if (proposal.expiresAt.getTime() < Date.now()) {
      proposal.state = 'expired';
      throw new ConflictError('Action proposal expired. Please prepare again.');
    }

    const payload = proposal.canonicalPayloadJson;
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

    proposal.state = 'consumed';
    proposal.consumedAt = new Date();
    return { proposalId: proposal.id, actionType: proposal.actionType, result };
  }

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
