import crypto from 'node:crypto';
import { and, asc, desc, eq } from 'drizzle-orm';
import { db, isDatabaseConfigured } from '../db/index.ts';
import {
  appointmentQueueTokens,
  appointments,
  auditEvents,
  doctorCommissionRules,
  doctorHolidayBlocks,
  doctorSchedules,
  payments,
  people,
  receipts,
  resources,
  services,
} from '../db/schema.ts';
import type {
  CreateDoctorScheduleInput,
  CreateHolidayBlockInput,
  DoctorPayoutReportResponse,
  PatientVisitHistoryResponse,
  UpsertDoctorCommissionInput,
  WaitingRoomDisplayResponse,
  WaitingRoomTokenItem,
} from '../contracts/clinic.ts';
import { NotFoundError, ValidationError } from './errors.ts';
import { addMemAuditEvent, getMemoryStore } from './memory-store.ts';
import { assertWorkspaceNotReadOnlyGrace } from './subscription-billing.ts';
import {
  assertCapability,
  assertPermission,
  getBusinessDateInTimezone,
  type ActiveWorkspaceContext,
} from './tenancy.ts';

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

function formatHHMM(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// 1. Waiting Room Queue & TV Display Mode
// ---------------------------------------------------------------------------
export async function getWaitingRoomDisplay(
  context: ActiveWorkspaceContext,
  requestedDate?: string
): Promise<WaitingRoomDisplayResponse> {
  assertCapability(context, 'appointments.manage');
  assertPermission(context, 'appointments.read');
  const businessDate = requestedDate || getBusinessDateInTimezone(context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const appts = store.appointments
      .filter(
        (a) =>
          a.tenantId === context.tenantId &&
          a.branchId === context.branchId &&
          a.businessDate === businessDate &&
          a.status !== 'cancelled' &&
          a.status !== 'no_show'
      )
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

    const tokenMap = new Map(
      store.appointmentQueueTokens
        .filter((t) => t.tenantId === context.tenantId && t.branchId === context.branchId)
        .map((t) => [t.appointmentId, t])
    );

    const allActive: WaitingRoomTokenItem[] = appts.map((a, idx) => {
      const person = store.people.find((p) => p.id === a.personId);
      const res = store.resources.find((r) => r.id === a.resourceId);
      const svc = store.services.find((s) => s.id === a.serviceId);
      const tok = tokenMap.get(a.id);
      const queueState =
        tok?.queueState ??
        (a.status === 'completed' ? 'completed' : 'waiting');

      return {
        appointmentId: a.id,
        tokenNumber: tok?.tokenNumber ?? idx + 1,
        patientName: person?.displayName ?? 'Patient',
        resourceId: a.resourceId,
        resourceName: res?.name ?? 'Practitioner',
        serviceName: svc?.name ?? 'Consultation',
        startsAt: a.startsAt.toISOString(),
        appointmentStatus: a.status,
        queueState,
        delayMinutes: tok?.delayMinutes ?? 0,
      };
    });

    const nowServing = allActive.filter((t) => t.queueState === 'serving');
    const upNext = allActive.filter((t) => t.queueState === 'waiting');

    return {
      tenantName: context.tenantName,
      branchName: context.branchName,
      businessDate,
      updatedAt: new Date().toISOString(),
      nowServing,
      upNext,
      allActive,
    };
  }

  const rows = await db
    .select({
      appointmentId: appointments.id,
      startsAt: appointments.startsAt,
      appointmentStatus: appointments.status,
      resourceId: appointments.resourceId,
      patientName: people.displayName,
      resourceName: resources.name,
      serviceName: services.name,
    })
    .from(appointments)
    .innerJoin(people, and(eq(appointments.personId, people.id), eq(people.tenantId, context.tenantId)))
    .innerJoin(resources, and(eq(appointments.resourceId, resources.id), eq(resources.tenantId, context.tenantId)))
    .innerJoin(services, and(eq(appointments.serviceId, services.id), eq(services.tenantId, context.tenantId)))
    .where(
      and(
        eq(appointments.tenantId, context.tenantId),
        eq(appointments.branchId, context.branchId),
        eq(appointments.businessDate, businessDate)
      )
    )
    .orderBy(asc(appointments.startsAt));

  const tokens = await db
    .select()
    .from(appointmentQueueTokens)
    .where(
      and(
        eq(appointmentQueueTokens.tenantId, context.tenantId),
        eq(appointmentQueueTokens.branchId, context.branchId),
        eq(appointmentQueueTokens.businessDate, businessDate)
      )
    );
  const tokenMap = new Map(tokens.map((t) => [t.appointmentId, t]));

  const allActive: WaitingRoomTokenItem[] = rows
    .filter((r) => r.appointmentStatus !== 'cancelled' && r.appointmentStatus !== 'no_show')
    .map((r, idx) => {
      const tok = tokenMap.get(r.appointmentId);
      const queueState =
        (tok?.queueState as WaitingRoomTokenItem['queueState']) ??
        (r.appointmentStatus === 'completed' ? 'completed' : 'waiting');
      return {
        appointmentId: r.appointmentId,
        tokenNumber: tok?.tokenNumber ?? idx + 1,
        patientName: r.patientName,
        resourceId: r.resourceId,
        resourceName: r.resourceName,
        serviceName: r.serviceName,
        startsAt: r.startsAt.toISOString(),
        appointmentStatus: r.appointmentStatus,
        queueState,
        delayMinutes: tok?.delayMinutes ?? 0,
      };
    });

  return {
    tenantName: context.tenantName,
    branchName: context.branchName,
    businessDate,
    updatedAt: new Date().toISOString(),
    nowServing: allActive.filter((t) => t.queueState === 'serving'),
    upNext: allActive.filter((t) => t.queueState === 'waiting'),
    allActive,
  };
}

export async function updateAppointmentQueueState(
  context: ActiveWorkspaceContext,
  appointmentId: string,
  input: { queueState: 'waiting' | 'serving' | 'completed' | 'skipped'; delayMinutes?: number },
  correlationId: string
) {
  assertCapability(context, 'appointments.manage');
  assertPermission(context, 'attendance.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const now = new Date();

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const apt = store.appointments.find(
      (a) => a.tenantId === context.tenantId && a.id === appointmentId
    );
    if (!apt) throw new NotFoundError('Appointment not found');

    // If marking serving, auto-complete previous serving token for same practitioner
    if (input.queueState === 'serving') {
      for (const t of store.appointmentQueueTokens) {
        if (
          t.tenantId === context.tenantId &&
          t.businessDate === apt.businessDate &&
          t.resourceId === apt.resourceId &&
          t.queueState === 'serving' &&
          t.appointmentId !== appointmentId
        ) {
          t.queueState = 'completed';
        }
      }
      if (apt.status === 'scheduled') {
        apt.status = 'arrived';
        apt.version += 1;
        apt.updatedAt = now;
      }
    }

    let tok = store.appointmentQueueTokens.find(
      (t) => t.tenantId === context.tenantId && t.appointmentId === appointmentId
    );
    if (!tok) {
      const dayTokens = store.appointmentQueueTokens.filter(
        (t) => t.tenantId === context.tenantId && t.businessDate === apt.businessDate
      );
      const nextNum = dayTokens.reduce((m, t) => Math.max(m, t.tokenNumber), 0) + 1;
      tok = {
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        branchId: context.branchId,
        businessDate: apt.businessDate,
        appointmentId,
        resourceId: apt.resourceId,
        tokenNumber: nextNum,
        queueState: input.queueState,
        delayMinutes: input.delayMinutes ?? 0,
        calledAt: input.queueState === 'serving' ? now : null,
        createdAt: now,
      };
      store.appointmentQueueTokens.push(tok);
    } else {
      tok.queueState = input.queueState;
      if (input.delayMinutes !== undefined) tok.delayMinutes = input.delayMinutes;
      if (input.queueState === 'serving') tok.calledAt = now;
    }

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: `queue.token_${input.queueState}`,
      entityType: 'appointment',
      entityId: appointmentId,
      correlationId,
      metadataJson: { tokenNumber: tok.tokenNumber, delayMinutes: tok.delayMinutes },
    });

    return tok;
  }

  return db.transaction(async (tx) => {
    const [apt] = await tx
      .select()
      .from(appointments)
      .where(and(eq(appointments.tenantId, context.tenantId), eq(appointments.id, appointmentId)))
      .limit(1);
    if (!apt) throw new NotFoundError('Appointment not found');

    if (input.queueState === 'serving') {
      await tx
        .update(appointmentQueueTokens)
        .set({ queueState: 'completed' })
        .where(
          and(
            eq(appointmentQueueTokens.tenantId, context.tenantId),
            eq(appointmentQueueTokens.businessDate, apt.businessDate),
            eq(appointmentQueueTokens.resourceId, apt.resourceId),
            eq(appointmentQueueTokens.queueState, 'serving')
          )
        );
    }

    const [existing] = await tx
      .select()
      .from(appointmentQueueTokens)
      .where(
        and(
          eq(appointmentQueueTokens.tenantId, context.tenantId),
          eq(appointmentQueueTokens.appointmentId, appointmentId)
        )
      )
      .limit(1);

    let tok;
    if (!existing) {
      const existingDay = await tx
        .select({ tokenNumber: appointmentQueueTokens.tokenNumber })
        .from(appointmentQueueTokens)
        .where(
          and(
            eq(appointmentQueueTokens.tenantId, context.tenantId),
            eq(appointmentQueueTokens.businessDate, apt.businessDate)
          )
        );
      const nextNum = existingDay.reduce((m, r) => Math.max(m, r.tokenNumber), 0) + 1;
      [tok] = await tx
        .insert(appointmentQueueTokens)
        .values({
          tenantId: context.tenantId,
          branchId: context.branchId,
          businessDate: apt.businessDate,
          appointmentId,
          resourceId: apt.resourceId,
          tokenNumber: nextNum,
          queueState: input.queueState,
          delayMinutes: input.delayMinutes ?? 0,
          calledAt: input.queueState === 'serving' ? now : null,
        })
        .returning();
    } else {
      [tok] = await tx
        .update(appointmentQueueTokens)
        .set({
          queueState: input.queueState,
          delayMinutes: input.delayMinutes ?? existing.delayMinutes,
          calledAt: input.queueState === 'serving' ? now : existing.calledAt,
        })
        .where(eq(appointmentQueueTokens.id, existing.id))
        .returning();
    }

    await tx.insert(auditEvents).values({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: `queue.token_${input.queueState}`,
      entityType: 'appointment',
      entityId: appointmentId,
      inputSource: 'ui',
      correlationId,
      metadataJson: { tokenNumber: tok.tokenNumber, delayMinutes: tok.delayMinutes },
    });

    return tok;
  });
}

export async function broadcastDoctorDelay(
  context: ActiveWorkspaceContext,
  resourceId: string,
  delayMinutes: number,
  correlationId: string
) {
  assertCapability(context, 'appointments.manage');
  assertPermission(context, 'appointments.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const businessDate = getBusinessDateInTimezone(context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    let updatedCount = 0;
    for (const tok of store.appointmentQueueTokens) {
      if (
        tok.tenantId === context.tenantId &&
        tok.resourceId === resourceId &&
        tok.businessDate === businessDate &&
        tok.queueState === 'waiting'
      ) {
        tok.delayMinutes = delayMinutes;
        updatedCount += 1;
      }
    }
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'queue.doctor_delay_broadcast',
      entityType: 'resource',
      entityId: resourceId,
      correlationId,
      metadataJson: { delayMinutes, affectedTokens: updatedCount },
    });
    return { resourceId, delayMinutes, affectedTokens: updatedCount };
  }

  const updated = await db
    .update(appointmentQueueTokens)
    .set({ delayMinutes })
    .where(
      and(
        eq(appointmentQueueTokens.tenantId, context.tenantId),
        eq(appointmentQueueTokens.resourceId, resourceId),
        eq(appointmentQueueTokens.businessDate, businessDate),
        eq(appointmentQueueTokens.queueState, 'waiting')
      )
    )
    .returning({ id: appointmentQueueTokens.id });

  await db.insert(auditEvents).values({
    tenantId: context.tenantId,
    actorUserId: context.userId,
    actorUid: context.uid,
    action: 'queue.doctor_delay_broadcast',
    entityType: 'resource',
    entityId: resourceId,
    inputSource: 'ui',
    correlationId,
    metadataJson: { delayMinutes, affectedTokens: updated.length },
  });

  return { resourceId, delayMinutes, affectedTokens: updated.length };
}

// ---------------------------------------------------------------------------
// 2. Doctor Schedules, Holiday Blocks & Quick Slot Picker
// ---------------------------------------------------------------------------
export async function listDoctorSchedules(
  context: ActiveWorkspaceContext,
  resourceId?: string
) {
  assertCapability(context, 'appointments.manage');

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    return store.doctorSchedules
      .filter(
        (s) =>
          s.tenantId === context.tenantId &&
          s.branchId === context.branchId &&
          s.active &&
          (!resourceId || s.resourceId === resourceId)
      )
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startTime.localeCompare(b.startTime));
  }

  return db
    .select()
    .from(doctorSchedules)
    .where(
      and(
        eq(doctorSchedules.tenantId, context.tenantId),
        eq(doctorSchedules.branchId, context.branchId),
        eq(doctorSchedules.active, true),
        ...(resourceId ? [eq(doctorSchedules.resourceId, resourceId)] : [])
      )
    )
    .orderBy(asc(doctorSchedules.dayOfWeek), asc(doctorSchedules.startTime));
}

export async function createDoctorSchedule(
  context: ActiveWorkspaceContext,
  input: CreateDoctorScheduleInput,
  correlationId: string
) {
  assertCapability(context, 'appointments.manage');
  assertPermission(context, 'appointments.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (toMinutes(input.endTime) <= toMinutes(input.startTime)) {
    throw new ValidationError('Session end time must be after start time');
  }

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const res = store.resources.find(
      (r) => r.tenantId === context.tenantId && r.id === input.resourceId
    );
    if (!res) throw new NotFoundError('Practitioner not found');
    const created = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      resourceId: input.resourceId,
      dayOfWeek: input.dayOfWeek,
      startTime: input.startTime,
      endTime: input.endTime,
      slotDurationMinutes: input.slotDurationMinutes,
      active: true,
      createdAt: new Date(),
    };
    store.doctorSchedules.push(created);
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'clinic.doctor_schedule_created',
      entityType: 'doctor_schedule',
      entityId: created.id,
      correlationId,
      metadataJson: { ...input },
    });
    return created;
  }

  const [created] = await db
    .insert(doctorSchedules)
    .values({
      tenantId: context.tenantId,
      branchId: context.branchId,
      resourceId: input.resourceId,
      dayOfWeek: input.dayOfWeek,
      startTime: input.startTime,
      endTime: input.endTime,
      slotDurationMinutes: input.slotDurationMinutes,
      active: true,
    })
    .returning();

  await db.insert(auditEvents).values({
    tenantId: context.tenantId,
    actorUserId: context.userId,
    actorUid: context.uid,
    action: 'clinic.doctor_schedule_created',
    entityType: 'doctor_schedule',
    entityId: created.id,
    inputSource: 'ui',
    correlationId,
    metadataJson: { ...input },
  });

  return created;
}

export async function deleteDoctorSchedule(
  context: ActiveWorkspaceContext,
  scheduleId: string,
  correlationId: string
) {
  assertCapability(context, 'appointments.manage');
  assertPermission(context, 'appointments.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const row = store.doctorSchedules.find(
      (s) => s.id === scheduleId && s.tenantId === context.tenantId
    );
    if (!row) throw new NotFoundError('Schedule template not found');
    row.active = false;
    return { deleted: true, id: scheduleId };
  }

  const [updated] = await db
    .update(doctorSchedules)
    .set({ active: false })
    .where(and(eq(doctorSchedules.id, scheduleId), eq(doctorSchedules.tenantId, context.tenantId)))
    .returning();
  if (!updated) throw new NotFoundError('Schedule template not found');

  await db.insert(auditEvents).values({
    tenantId: context.tenantId,
    actorUserId: context.userId,
    actorUid: context.uid,
    action: 'clinic.doctor_schedule_deleted',
    entityType: 'doctor_schedule',
    entityId: scheduleId,
    inputSource: 'ui',
    correlationId,
    metadataJson: {},
  });

  return { deleted: true, id: scheduleId };
}

export async function listDoctorHolidayBlocks(
  context: ActiveWorkspaceContext,
  resourceId?: string
) {
  assertCapability(context, 'appointments.manage');
  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    return store.doctorHolidayBlocks
      .filter(
        (h) =>
          h.tenantId === context.tenantId &&
          h.branchId === context.branchId &&
          (!resourceId || h.resourceId === resourceId)
      )
      .sort((a, b) => a.blockDate.localeCompare(b.blockDate));
  }

  return db
    .select()
    .from(doctorHolidayBlocks)
    .where(
      and(
        eq(doctorHolidayBlocks.tenantId, context.tenantId),
        eq(doctorHolidayBlocks.branchId, context.branchId),
        ...(resourceId ? [eq(doctorHolidayBlocks.resourceId, resourceId)] : [])
      )
    )
    .orderBy(asc(doctorHolidayBlocks.blockDate));
}

export async function createDoctorHolidayBlock(
  context: ActiveWorkspaceContext,
  input: CreateHolidayBlockInput,
  correlationId: string
) {
  assertCapability(context, 'appointments.manage');
  assertPermission(context, 'appointments.write');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const created = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      resourceId: input.resourceId,
      blockDate: input.blockDate,
      reason: input.reason.trim(),
      createdAt: new Date(),
    };
    store.doctorHolidayBlocks.push(created);
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'clinic.doctor_holiday_created',
      entityType: 'doctor_holiday_block',
      entityId: created.id,
      correlationId,
      metadataJson: { ...input },
    });
    return created;
  }

  const [created] = await db
    .insert(doctorHolidayBlocks)
    .values({
      tenantId: context.tenantId,
      branchId: context.branchId,
      resourceId: input.resourceId,
      blockDate: input.blockDate,
      reason: input.reason.trim(),
    })
    .returning();

  return created;
}

export async function getAvailableDoctorSlots(
  context: ActiveWorkspaceContext,
  resourceId: string,
  dateStr: string
) {
  assertCapability(context, 'appointments.manage');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new ValidationError('Invalid date format YYYY-MM-DD');
  }

  const targetDate = new Date(`${dateStr}T00:00:00+05:30`);
  const dayOfWeek = new Date(`${dateStr}T12:00:00Z`).getUTCDay();

  const holidays = await listDoctorHolidayBlocks(context, resourceId);
  const holiday = holidays.find((h) => h.blockDate === dateStr);
  if (holiday) {
    return {
      date: dateStr,
      resourceId,
      isHoliday: true,
      holidayReason: holiday.reason,
      slots: [] as Array<{ startsAt: string; label: string; available: boolean }>,
    };
  }

  const allSchedules = await listDoctorSchedules(context, resourceId);
  const daySchedules = allSchedules.filter((s) => s.dayOfWeek === dayOfWeek);
  const sessions =
    daySchedules.length > 0
      ? daySchedules
      : [{ startTime: '08:30', endTime: '17:30', slotDurationMinutes: 20 }];

  const bookedIntervals: Array<{ startMs: number; endMs: number }> = [];
  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    for (const apt of store.appointments) {
      if (
        apt.tenantId === context.tenantId &&
        apt.resourceId === resourceId &&
        apt.businessDate === dateStr &&
        apt.status !== 'cancelled'
      ) {
        bookedIntervals.push({ startMs: apt.startsAt.getTime(), endMs: apt.endsAt.getTime() });
      }
    }
  } else {
    const dayAppts = await db
      .select({
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        status: appointments.status,
      })
      .from(appointments)
      .where(
        and(
          eq(appointments.tenantId, context.tenantId),
          eq(appointments.resourceId, resourceId),
          eq(appointments.businessDate, dateStr)
        )
      );
    for (const apt of dayAppts) {
      if (apt.status !== 'cancelled') {
        bookedIntervals.push({ startMs: apt.startsAt.getTime(), endMs: apt.endsAt.getTime() });
      }
    }
  }

  const slots: Array<{ startsAt: string; label: string; available: boolean }> = [];
  for (const session of sessions) {
    const startMin = toMinutes(session.startTime);
    const endMin = toMinutes(session.endTime);
    const step = session.slotDurationMinutes || 20;
    for (let m = startMin; m + step <= endMin; m += step) {
      const hhmm = formatHHMM(m);
      const slotStart = new Date(`${dateStr}T${hhmm}:00+05:30`);
      const slotEndMs = slotStart.getTime() + step * 60_000;
      const slotStartMs = slotStart.getTime();
      const overlaps = bookedIntervals.some(
        (b) => slotStartMs < b.endMs && slotEndMs > b.startMs
      );
      slots.push({
        startsAt: slotStart.toISOString(),
        label: hhmm,
        available: !overlaps && targetDate.getTime() > 0,
      });
    }
  }

  return {
    date: dateStr,
    resourceId,
    isHoliday: false,
    holidayReason: null as string | null,
    slots,
  };
}

// ---------------------------------------------------------------------------
// 3. Patient Visit History & Unpaid Balance (1-Click Repeat Booking)
// ---------------------------------------------------------------------------
export async function getPatientVisitHistory(
  context: ActiveWorkspaceContext,
  personId: string
): Promise<PatientVisitHistoryResponse> {
  assertCapability(context, 'appointments.manage');
  assertPermission(context, 'directory.read');

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const person = store.people.find(
      (p) => p.tenantId === context.tenantId && p.id === personId
    );
    if (!person) throw new NotFoundError('Patient record not found');

    const appts = store.appointments
      .filter((a) => a.tenantId === context.tenantId && a.personId === personId)
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());

    const tokenMap = new Map(
      store.appointmentQueueTokens
        .filter((t) => t.tenantId === context.tenantId)
        .map((t) => [t.appointmentId, t.tokenNumber])
    );

    const personPayments = store.payments
      .filter(
        (p) => p.tenantId === context.tenantId && p.personId === personId && p.status === 'posted'
      )
      .sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime());

    const totalExpectedMinor = appts
      .filter((a) => a.status !== 'cancelled' && a.status !== 'no_show')
      .reduce((acc, a) => acc + a.bookedPriceMinor, 0);
    const totalPaidMinor = personPayments.reduce((acc, p) => acc + p.amountMinor, 0);

    return {
      person: {
        id: person.id,
        displayName: person.displayName,
        phone: person.phone,
        notes: person.notes,
      },
      totalVisits: appts.filter((a) => a.status !== 'cancelled').length,
      totalPaidMinor,
      unpaidBalanceMinor: Math.max(0, totalExpectedMinor - totalPaidMinor),
      appointments: appts.map((a) => {
        const svc = store.services.find((s) => s.id === a.serviceId);
        const res = store.resources.find((r) => r.id === a.resourceId);
        return {
          id: a.id,
          businessDate: a.businessDate,
          startsAt: a.startsAt.toISOString(),
          status: a.status,
          serviceId: a.serviceId,
          serviceName: svc?.name ?? 'Consultation',
          resourceId: a.resourceId,
          resourceName: res?.name ?? 'Practitioner',
          bookedPriceMinor: a.bookedPriceMinor,
          tokenNumber: tokenMap.get(a.id) ?? 1,
        };
      }),
      payments: personPayments.map((p) => {
        const rcp = store.receipts.find((r) => r.paymentId === p.id);
        return {
          paymentId: p.id,
          amountMinor: p.amountMinor,
          method: p.method,
          receiptNumber: rcp?.receiptNumber ?? null,
          recordedAt: p.recordedAt.toISOString(),
        };
      }),
    };
  }

  const [person] = await db
    .select()
    .from(people)
    .where(and(eq(people.tenantId, context.tenantId), eq(people.id, personId)))
    .limit(1);
  if (!person) throw new NotFoundError('Patient record not found');

  const appts = await db
    .select({
      id: appointments.id,
      businessDate: appointments.businessDate,
      startsAt: appointments.startsAt,
      status: appointments.status,
      serviceId: appointments.serviceId,
      serviceName: services.name,
      resourceId: appointments.resourceId,
      resourceName: resources.name,
      bookedPriceMinor: appointments.bookedPriceMinor,
    })
    .from(appointments)
    .innerJoin(services, and(eq(appointments.serviceId, services.id), eq(services.tenantId, context.tenantId)))
    .innerJoin(resources, and(eq(appointments.resourceId, resources.id), eq(resources.tenantId, context.tenantId)))
    .where(and(eq(appointments.tenantId, context.tenantId), eq(appointments.personId, personId)))
    .orderBy(desc(appointments.startsAt))
    .limit(50);

  const tokens = await db
    .select()
    .from(appointmentQueueTokens)
    .where(eq(appointmentQueueTokens.tenantId, context.tenantId));
  const tokenMap = new Map(tokens.map((t) => [t.appointmentId, t.tokenNumber]));

  const payRows = await db
    .select({
      paymentId: payments.id,
      amountMinor: payments.amountMinor,
      method: payments.method,
      status: payments.status,
      recordedAt: payments.recordedAt,
      receiptNumber: receipts.receiptNumber,
    })
    .from(payments)
    .leftJoin(receipts, eq(receipts.paymentId, payments.id))
    .where(
      and(
        eq(payments.tenantId, context.tenantId),
        eq(payments.personId, personId),
        eq(payments.status, 'posted')
      )
    )
    .orderBy(desc(payments.recordedAt))
    .limit(50);

  const totalExpectedMinor = appts
    .filter((a) => a.status !== 'cancelled' && a.status !== 'no_show')
    .reduce((acc, a) => acc + a.bookedPriceMinor, 0);
  const totalPaidMinor = payRows.reduce((acc, p) => acc + p.amountMinor, 0);

  return {
    person: {
      id: person.id,
      displayName: person.displayName,
      phone: person.phone,
      notes: person.notes,
    },
    totalVisits: appts.filter((a) => a.status !== 'cancelled').length,
    totalPaidMinor,
    unpaidBalanceMinor: Math.max(0, totalExpectedMinor - totalPaidMinor),
    appointments: appts.map((a) => ({
      id: a.id,
      businessDate: a.businessDate,
      startsAt: a.startsAt.toISOString(),
      status: a.status,
      serviceId: a.serviceId,
      serviceName: a.serviceName,
      resourceId: a.resourceId,
      resourceName: a.resourceName,
      bookedPriceMinor: a.bookedPriceMinor,
      tokenNumber: tokenMap.get(a.id) ?? 1,
    })),
    payments: payRows.map((p) => ({
      paymentId: p.paymentId,
      amountMinor: p.amountMinor,
      method: p.method,
      receiptNumber: p.receiptNumber ?? null,
      recordedAt: p.recordedAt.toISOString(),
    })),
  };
}

// ---------------------------------------------------------------------------
// 4. Doctor Payout & Channeling Commission Split Report
// ---------------------------------------------------------------------------
export async function upsertDoctorCommissionRule(
  context: ActiveWorkspaceContext,
  input: UpsertDoctorCommissionInput,
  correlationId: string
) {
  assertCapability(context, 'appointments.manage');
  assertPermission(context, 'reports.all_financials');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const clinicSharePercent = 100 - input.doctorSharePercent;

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    let rule = store.doctorCommissionRules.find(
      (r) => r.tenantId === context.tenantId && r.resourceId === input.resourceId
    );
    if (rule) {
      rule.doctorSharePercent = input.doctorSharePercent;
      rule.clinicSharePercent = clinicSharePercent;
      rule.updatedAt = new Date();
    } else {
      rule = {
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        resourceId: input.resourceId,
        serviceId: null,
        doctorSharePercent: input.doctorSharePercent,
        clinicSharePercent,
        updatedAt: new Date(),
      };
      store.doctorCommissionRules.push(rule);
    }
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'clinic.doctor_commission_updated',
      entityType: 'resource',
      entityId: input.resourceId,
      correlationId,
      metadataJson: { doctorSharePercent: input.doctorSharePercent, clinicSharePercent },
    });
    return rule;
  }

  const [existing] = await db
    .select()
    .from(doctorCommissionRules)
    .where(
      and(
        eq(doctorCommissionRules.tenantId, context.tenantId),
        eq(doctorCommissionRules.resourceId, input.resourceId)
      )
    )
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(doctorCommissionRules)
      .set({
        doctorSharePercent: input.doctorSharePercent,
        clinicSharePercent,
        updatedAt: new Date(),
      })
      .where(eq(doctorCommissionRules.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(doctorCommissionRules)
    .values({
      tenantId: context.tenantId,
      resourceId: input.resourceId,
      doctorSharePercent: input.doctorSharePercent,
      clinicSharePercent,
    })
    .returning();

  return created;
}

export async function getDoctorPayoutReport(
  context: ActiveWorkspaceContext,
  requestedDate?: string
): Promise<DoctorPayoutReportResponse> {
  assertCapability(context, 'appointments.manage');
  assertPermission(context, 'reports.branch_summary');
  const businessDate = requestedDate || getBusinessDateInTimezone(context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const docs = store.resources.filter(
      (r) => r.tenantId === context.tenantId && r.branchId === context.branchId && r.active
    );
    const appts = store.appointments.filter(
      (a) =>
        a.tenantId === context.tenantId &&
        a.branchId === context.branchId &&
        a.businessDate === businessDate &&
        a.status !== 'cancelled' &&
        a.status !== 'no_show'
    );

    const doctors = docs.map((doc) => {
      const rule = store.doctorCommissionRules.find(
        (r) => r.tenantId === context.tenantId && r.resourceId === doc.id
      );
      const doctorSharePercent = rule?.doctorSharePercent ?? 75;
      const docAppts = appts.filter((a) => a.resourceId === doc.id);
      const grossFeesMinor = docAppts.reduce((acc, a) => acc + a.bookedPriceMinor, 0);
      const doctorShareMinor = Math.round((grossFeesMinor * doctorSharePercent) / 100);
      const clinicShareMinor = grossFeesMinor - doctorShareMinor;

      return {
        resourceId: doc.id,
        doctorName: doc.name,
        specialty: doc.specialty,
        visitCount: docAppts.length,
        completedCount: docAppts.filter((a) => a.status === 'completed').length,
        grossFeesMinor,
        doctorSharePercent,
        doctorShareMinor,
        clinicShareMinor,
      };
    });

    return {
      businessDate,
      currency: context.currency,
      totalGrossMinor: doctors.reduce((a, d) => a + d.grossFeesMinor, 0),
      totalDoctorShareMinor: doctors.reduce((a, d) => a + d.doctorShareMinor, 0),
      totalClinicShareMinor: doctors.reduce((a, d) => a + d.clinicShareMinor, 0),
      doctors,
    };
  }

  const docs = await db
    .select()
    .from(resources)
    .where(
      and(
        eq(resources.tenantId, context.tenantId),
        eq(resources.branchId, context.branchId),
        eq(resources.active, true)
      )
    );
  const rules = await db
    .select()
    .from(doctorCommissionRules)
    .where(eq(doctorCommissionRules.tenantId, context.tenantId));
  const appts = await db
    .select()
    .from(appointments)
    .where(
      and(
        eq(appointments.tenantId, context.tenantId),
        eq(appointments.branchId, context.branchId),
        eq(appointments.businessDate, businessDate)
      )
    );

  const doctors = docs.map((doc) => {
    const rule = rules.find((r) => r.resourceId === doc.id);
    const doctorSharePercent = rule?.doctorSharePercent ?? 75;
    const docAppts = appts.filter(
      (a) => a.resourceId === doc.id && a.status !== 'cancelled' && a.status !== 'no_show'
    );
    const grossFeesMinor = docAppts.reduce((acc, a) => acc + a.bookedPriceMinor, 0);
    const doctorShareMinor = Math.round((grossFeesMinor * doctorSharePercent) / 100);
    const clinicShareMinor = grossFeesMinor - doctorShareMinor;
    return {
      resourceId: doc.id,
      doctorName: doc.name,
      specialty: doc.specialty,
      visitCount: docAppts.length,
      completedCount: docAppts.filter((a) => a.status === 'completed').length,
      grossFeesMinor,
      doctorSharePercent,
      doctorShareMinor,
      clinicShareMinor,
    };
  });

  return {
    businessDate,
    currency: context.currency,
    totalGrossMinor: doctors.reduce((a, d) => a + d.grossFeesMinor, 0),
    totalDoctorShareMinor: doctors.reduce((a, d) => a + d.doctorShareMinor, 0),
    totalClinicShareMinor: doctors.reduce((a, d) => a + d.clinicShareMinor, 0),
    doctors,
  };
}
