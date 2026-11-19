import { and, asc, eq, gte, lt, sql } from 'drizzle-orm';
import { db, isDatabaseConfigured } from '../db/index.ts';
import {
  appointmentQueueTokens,
  appointments,
  payments,
  people,
  resources,
  services,
} from '../db/schema.ts';
import type { TodaySummaryResponse } from '../contracts/api.ts';
import { NotFoundError, ValidationError } from './errors.ts';
import { getMemoryStore } from './memory-store.ts';
import {
  type ActiveWorkspaceContext,
  getBusinessDateInTimezone,
  hasPermission,
} from './tenancy.ts';

export async function getTodayWorkspaceSummary(
  context: ActiveWorkspaceContext,
  requestedDate?: string
): Promise<TodaySummaryResponse> {
  const businessDate = requestedDate || getBusinessDateInTimezone(context.timezone);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(businessDate)) {
    throw new ValidationError('Date must follow YYYY-MM-DD format', 'errors.invalid_date');
  }

  const canSeeAllFinancials = hasPermission(context.role, 'reports.all_financials');

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const appts = store.appointments
      .filter(
        (a) =>
          a.tenantId === context.tenantId &&
          a.branchId === context.branchId &&
          a.businessDate === businessDate
      )
      .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());

    const tokenMap = new Map(
      store.appointmentQueueTokens
        .filter((t) => t.tenantId === context.tenantId && t.branchId === context.branchId)
        .map((t) => [t.appointmentId, t])
    );

    const branchServices = store.services
      .filter((s) => s.tenantId === context.tenantId && s.branchId === context.branchId && s.active)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((s) => ({
        id: s.id,
        name: s.name,
        nameSi: s.nameSi,
        durationMinutes: s.durationMinutes,
        priceMinor: s.priceMinor,
        currency: s.currency,
      }));

    const branchResources = store.resources
      .filter((r) => r.tenantId === context.tenantId && r.branchId === context.branchId && r.active)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => ({
        id: r.id,
        name: r.name,
        specialty: r.specialty,
      }));

    const dayStart = new Date(`${businessDate}T00:00:00+05:30`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const totalMinor = store.payments
      .filter(
        (p) =>
          p.tenantId === context.tenantId &&
          p.branchId === context.branchId &&
          p.status === 'posted' &&
          p.effectiveAt >= dayStart &&
          p.effectiveAt < dayEnd &&
          (canSeeAllFinancials || p.recordedByUserId === context.userId)
      )
      .reduce((acc, p) => acc + p.amountMinor, 0);

    const counts = {
      total: appts.length,
      scheduled: 0,
      arrived: 0,
      completed: 0,
      cancelled: 0,
      noShow: 0,
    };
    for (const r of appts) {
      if (r.status === 'scheduled') counts.scheduled += 1;
      else if (r.status === 'arrived') counts.arrived += 1;
      else if (r.status === 'completed') counts.completed += 1;
      else if (r.status === 'cancelled') counts.cancelled += 1;
      else if (r.status === 'no_show') counts.noShow += 1;
    }

    return {
      tenantId: context.tenantId,
      branchId: context.branchId,
      branchName: context.branchName,
      businessDate,
      timezone: context.timezone,
      currency: context.currency,
      dataFreshAt: new Date().toISOString(),
      financialScope: canSeeAllFinancials ? 'branch_all' : 'own_recorded_only',
      counts,
      recordedReceiptsMinor: totalMinor,
      appointments: appts.map((r, idx) => {
        const person = store.people.find((p) => p.id === r.personId);
        const service = store.services.find((s) => s.id === r.serviceId);
        const resource = store.resources.find((res) => res.id === r.resourceId);
        const tok = tokenMap.get(r.id);
        return {
          id: r.id,
          businessDate: r.businessDate,
          startsAt: r.startsAt.toISOString(),
          endsAt: r.endsAt.toISOString(),
          status: r.status,
          personId: r.personId,
          personName: person?.displayName ?? 'Patient',
          phoneLast4: person?.phoneLast4 ?? '',
          phone: person?.phone ?? '',
          serviceId: r.serviceId,
          serviceName: service?.name ?? 'Consultation',
          serviceNameSi: service?.nameSi ?? '',
          resourceId: r.resourceId,
          resourceName: resource?.name ?? 'Practitioner',
          bookedDurationMinutes: r.bookedDurationMinutes,
          bookedPriceMinor: r.bookedPriceMinor,
          currency: r.currency,
          tokenNumber: tok?.tokenNumber ?? idx + 1,
          queueState: tok?.queueState ?? (r.status === 'completed' ? 'completed' : 'waiting'),
          isSample: r.isSample,
          version: r.version,
        };
      }),
      services: branchServices,
      resources: branchResources,
    };
  }

  try {
    const rows = await db
      .select({
        id: appointments.id,
        businessDate: appointments.businessDate,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        status: appointments.status,
        personId: appointments.personId,
        personName: people.displayName,
        phoneLast4: people.phoneLast4,
        phone: people.phone,
        serviceId: appointments.serviceId,
        serviceName: services.name,
        serviceNameSi: services.nameSi,
        resourceId: appointments.resourceId,
        resourceName: resources.name,
        bookedDurationMinutes: appointments.bookedDurationMinutes,
        bookedPriceMinor: appointments.bookedPriceMinor,
        currency: appointments.currency,
        isSample: appointments.isSample,
        version: appointments.version,
      })
      .from(appointments)
      .innerJoin(
        people,
        and(eq(appointments.personId, people.id), eq(people.tenantId, context.tenantId))
      )
      .innerJoin(
        services,
        and(eq(appointments.serviceId, services.id), eq(services.tenantId, context.tenantId))
      )
      .innerJoin(
        resources,
        and(eq(appointments.resourceId, resources.id), eq(resources.tenantId, context.tenantId))
      )
      .where(
        and(
          eq(appointments.tenantId, context.tenantId),
          eq(appointments.branchId, context.branchId),
          eq(appointments.businessDate, businessDate)
        )
      )
      .orderBy(asc(appointments.startsAt));

    const queueTokens = await db
      .select()
      .from(appointmentQueueTokens)
      .where(
        and(
          eq(appointmentQueueTokens.tenantId, context.tenantId),
          eq(appointmentQueueTokens.branchId, context.branchId),
          eq(appointmentQueueTokens.businessDate, businessDate)
        )
      );
    const tokenMap = new Map(queueTokens.map((t) => [t.appointmentId, t]));

    const branchServices = await db
      .select({
        id: services.id,
        name: services.name,
        nameSi: services.nameSi,
        durationMinutes: services.durationMinutes,
        priceMinor: services.priceMinor,
        currency: services.currency,
      })
      .from(services)
      .where(
        and(
          eq(services.tenantId, context.tenantId),
          eq(services.branchId, context.branchId),
          eq(services.active, true)
        )
      )
      .orderBy(asc(services.name));

    const branchResources = await db
      .select({
        id: resources.id,
        name: resources.name,
        specialty: resources.specialty,
      })
      .from(resources)
      .where(
        and(
          eq(resources.tenantId, context.tenantId),
          eq(resources.branchId, context.branchId),
          eq(resources.active, true)
        )
      )
      .orderBy(asc(resources.name));

    const dayStart = new Date(`${businessDate}T00:00:00+05:30`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const paymentFilterConditions = [
      eq(payments.tenantId, context.tenantId),
      eq(payments.branchId, context.branchId),
      eq(payments.status, 'posted'),
      gte(payments.effectiveAt, dayStart),
      lt(payments.effectiveAt, dayEnd),
    ];

    if (!canSeeAllFinancials) {
      paymentFilterConditions.push(eq(payments.recordedByUserId, context.userId));
    }

    const [receiptAgg] = await db
      .select({
        totalMinor: sql<number>`COALESCE(SUM(${payments.amountMinor}), 0)::int`,
      })
      .from(payments)
      .where(and(...paymentFilterConditions));

    const counts = {
      total: rows.length,
      scheduled: 0,
      arrived: 0,
      completed: 0,
      cancelled: 0,
      noShow: 0,
    };

    for (const r of rows) {
      if (r.status === 'scheduled') counts.scheduled += 1;
      else if (r.status === 'arrived') counts.arrived += 1;
      else if (r.status === 'completed') counts.completed += 1;
      else if (r.status === 'cancelled') counts.cancelled += 1;
      else if (r.status === 'no_show') counts.noShow += 1;
    }

    return {
      tenantId: context.tenantId,
      branchId: context.branchId,
      branchName: context.branchName,
      businessDate,
      timezone: context.timezone,
      currency: context.currency,
      dataFreshAt: new Date().toISOString(),
      financialScope: canSeeAllFinancials ? 'branch_all' : 'own_recorded_only',
      counts,
      recordedReceiptsMinor: receiptAgg?.totalMinor ?? 0,
      appointments: rows.map((r, idx) => {
        const tok = tokenMap.get(r.id);
        return {
          id: r.id,
          businessDate: r.businessDate,
          startsAt: r.startsAt.toISOString(),
          endsAt: r.endsAt.toISOString(),
          status: r.status as TodaySummaryResponse['appointments'][number]['status'],
          personId: r.personId,
          personName: r.personName,
          phoneLast4: r.phoneLast4,
          phone: r.phone,
          serviceId: r.serviceId,
          serviceName: r.serviceName,
          serviceNameSi: r.serviceNameSi,
          resourceId: r.resourceId,
          resourceName: r.resourceName,
          bookedDurationMinutes: r.bookedDurationMinutes,
          bookedPriceMinor: r.bookedPriceMinor,
          currency: r.currency,
          tokenNumber: tok?.tokenNumber ?? idx + 1,
          queueState:
            (tok?.queueState as TodaySummaryResponse['appointments'][number]['queueState']) ??
            (r.status === 'completed' ? 'completed' : 'waiting'),
          isSample: r.isSample,
          version: r.version,
        };
      }),
      services: branchServices,
      resources: branchResources,
    };
  } catch (error) {
    console.error('Failed to query Today workspace summary:', error);
    throw new Error('Unable to load today workspace summary', { cause: error });
  }
}

export async function getAppointmentByIdForTenant(
  context: ActiveWorkspaceContext,
  appointmentId: string
) {
  const uuidValid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    appointmentId
  );
  if (!uuidValid) {
    throw new NotFoundError('Requested appointment not found');
  }

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const row = store.appointments.find(
      (a) => a.id === appointmentId && a.tenantId === context.tenantId
    );
    if (!row) {
      throw new NotFoundError('Requested appointment not found');
    }
    const person = store.people.find((p) => p.id === row.personId);
    const service = store.services.find((s) => s.id === row.serviceId);
    const resource = store.resources.find((r) => r.id === row.resourceId);
    return {
      id: row.id,
      tenantId: row.tenantId,
      branchId: row.branchId,
      businessDate: row.businessDate,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      status: row.status,
      personName: person?.displayName ?? 'Patient',
      serviceName: service?.name ?? 'Consultation',
      resourceName: resource?.name ?? 'Practitioner',
      bookedPriceMinor: row.bookedPriceMinor,
      currency: row.currency,
      version: row.version,
    };
  }

  try {
    const [row] = await db
      .select({
        id: appointments.id,
        tenantId: appointments.tenantId,
        branchId: appointments.branchId,
        businessDate: appointments.businessDate,
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        status: appointments.status,
        personName: people.displayName,
        serviceName: services.name,
        resourceName: resources.name,
        bookedPriceMinor: appointments.bookedPriceMinor,
        currency: appointments.currency,
        version: appointments.version,
      })
      .from(appointments)
      .innerJoin(
        people,
        and(eq(appointments.personId, people.id), eq(people.tenantId, context.tenantId))
      )
      .innerJoin(
        services,
        and(eq(appointments.serviceId, services.id), eq(services.tenantId, context.tenantId))
      )
      .innerJoin(
        resources,
        and(eq(appointments.resourceId, resources.id), eq(resources.tenantId, context.tenantId))
      )
      .where(and(eq(appointments.id, appointmentId), eq(appointments.tenantId, context.tenantId)))
      .limit(1);

    if (!row) {
      throw new NotFoundError('Requested appointment not found');
    }

    return row;
  } catch (error) {
    if (error instanceof NotFoundError) {
      throw error;
    }
    console.error('Failed to read appointment detail:', error);
    throw new Error('Unable to load appointment detail', { cause: error });
  }
}
