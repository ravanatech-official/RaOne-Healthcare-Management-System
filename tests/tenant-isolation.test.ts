import 'dotenv/config';
import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../src/db/index.ts';
import {
  appointments,
  branches,
  memberships,
  people,
  resources,
  services,
  tenants,
  users,
} from '../src/db/schema.ts';
import {
  assertPermission,
  bootstrapClinicWorkspace,
  getBusinessDateInTimezone,
  requireActiveWorkspace,
  resolveSessionContext,
} from '../src/domain/tenancy.ts';
import { getAppointmentByIdForTenant, getTodayWorkspaceSummary } from '../src/domain/today.ts';
import { ForbiddenError, NotFoundError } from '../src/domain/errors.ts';
import { isClinicalBoundaryRequest } from '../src/adapters/gemini.ts';

describe('Unit Invariants: Role Permissions, Timezone & Clinical Boundary', () => {
  it('enforces role boundaries between owner, manager, and receptionist', () => {
    const baseCtx = {
      userId: 1,
      uid: 'uid-1',
      tenantId: 't-1',
      tenantName: 'Clinic A',
      tenantStatus: 'active',
      productMode: 'clinic_only' as const,
      legalEntityId: 'le-1',
      legalEntityName: 'Clinic A',
      countryCode: 'LK',
      timezone: 'Asia/Colombo',
      currency: 'LKR',
      branchId: 'b-1',
      branchName: 'Main',
      permissions: [],
      professionalGrants: [],
      capabilities: {},
    };

    expect(() =>
      assertPermission({ ...baseCtx, role: 'receptionist' }, 'payments.reverse_stepup')
    ).toThrow(ForbiddenError);

    expect(() =>
      assertPermission({ ...baseCtx, role: 'manager' }, 'audit.read')
    ).not.toThrow();

    expect(() =>
      assertPermission({ ...baseCtx, role: 'owner' }, 'payments.reverse_stepup')
    ).not.toThrow();
  });

  it('computes YYYY-MM-DD business date in Asia/Colombo', () => {
    // 2026-11-18T20:00:00Z is 2026-11-19T01:30:00+05:30 in Asia/Colombo
    const instant = new Date('2026-11-18T20:00:00Z');
    expect(getBusinessDateInTimezone('Asia/Colombo', instant)).toBe('2026-11-19');
  });

  it('blocks clinical diagnosis/prescribing utterances at boundary check', () => {
    expect(isClinicalBoundaryRequest('What medicine should I prescribe for fever?')).toBe(true);
    expect(isClinicalBoundaryRequest('හෙට උදේ නවයට නිමල්ට appointment එකක් දාන්න')).toBe(false);
  });
});

const hasSqlEnv = Boolean(
  process.env.SQL_HOST && process.env.SQL_USER && process.env.SQL_PASSWORD && process.env.SQL_DB_NAME
);

describe.skipIf(!hasSqlEnv)('T01 PostgreSQL Tenant Isolation & Revocation Tests', () => {
  const testRunTag = crypto.randomBytes(4).toString('hex');
  let userAId: number;
  let userBId: number;
  let tenantAId: string;
  let tenantBId: string;
  let appointmentBId: string;
  let personBId: string;
  let branchAId: string;
  let serviceAId: string;
  let resourceAId: string;

  beforeAll(async () => {
    const [uA] = await db
      .insert(users)
      .values({
        uid: `test_uid_a_${testRunTag}`,
        email: `a_${testRunTag}@example.test`,
        displayName: 'Test Owner A',
        preferredLocale: 'si-LK',
      })
      .returning();
    const [uB] = await db
      .insert(users)
      .values({
        uid: `test_uid_b_${testRunTag}`,
        email: `b_${testRunTag}@example.test`,
        displayName: 'Test Owner B',
        preferredLocale: 'en-LK',
      })
      .returning();

    userAId = uA.id;
    userBId = uB.id;

    const ctxA = await bootstrapClinicWorkspace(
      {
        id: uA.id,
        uid: uA.uid,
        email: uA.email,
        displayName: uA.displayName,
        preferredLocale: 'si-LK',
      },
      {
        preferredLocale: 'si-LK',
        productMode: 'clinic_only',
        clinicName: `Test Clinic A ${testRunTag}`,
        branchName: 'Main',
        countryCode: 'LK',
        timezone: 'Asia/Colombo',
        currency: 'LKR',
        confirmLocaleAndCurrency: true,
        primaryPractitionerName: 'Dr. Test A',
        primaryPractitionerSpecialty: 'General Practice',
        openingHoursSummary: '08:30 - 17:30',
        services: [{ name: 'Consultation', nameSi: 'උපදේශනය', durationMinutes: 20, priceLkr: 2500 }],
        includeSampleData: true,
      },
      `test_corr_a_${testRunTag}`
    );

    const ctxB = await bootstrapClinicWorkspace(
      {
        id: uB.id,
        uid: uB.uid,
        email: uB.email,
        displayName: uB.displayName,
        preferredLocale: 'en-LK',
      },
      {
        preferredLocale: 'en-LK',
        productMode: 'clinic_only',
        clinicName: `Test Clinic B ${testRunTag}`,
        branchName: 'Main',
        countryCode: 'LK',
        timezone: 'Asia/Colombo',
        currency: 'LKR',
        confirmLocaleAndCurrency: true,
        primaryPractitionerName: 'Dr. Test B',
        primaryPractitionerSpecialty: 'General Practice',
        openingHoursSummary: '08:30 - 17:30',
        services: [{ name: 'Consultation B', nameSi: 'B', durationMinutes: 30, priceLkr: 3000 }],
        includeSampleData: true,
      },
      `test_corr_b_${testRunTag}`
    );

    tenantAId = ctxA.tenantId;
    branchAId = ctxA.branchId;
    tenantBId = ctxB.tenantId;

    const todayA = await getTodayWorkspaceSummary(ctxA);
    serviceAId = todayA.services[0].id;
    resourceAId = todayA.resources[0].id;

    const todayB = await getTodayWorkspaceSummary(ctxB);
    appointmentBId = todayB.appointments[0].id;
    personBId = todayB.appointments[0].personId;
  });

  afterAll(async () => {
    if (tenantAId) await db.delete(tenants).where(eq(tenants.id, tenantAId));
    if (tenantBId) await db.delete(tenants).where(eq(tenants.id, tenantBId));
    if (userAId) await db.delete(users).where(eq(users.id, userAId));
    if (userBId) await db.delete(users).where(eq(users.id, userBId));
  });

  it('T01-A: denies cross-tenant workspace selection with generic 404 (no existence leak)', async () => {
    await expect(
      resolveSessionContext(
        {
          id: userAId,
          uid: `test_uid_a_${testRunTag}`,
          email: `a_${testRunTag}@example.test`,
          displayName: 'Test Owner A',
          preferredLocale: 'si-LK',
        },
        tenantBId
      )
    ).rejects.toThrow(NotFoundError);
  });

  it('T01-B: Today summary for Tenant A excludes all Tenant B appointments', async () => {
    const ctxA = await requireActiveWorkspace({
      id: userAId,
      uid: `test_uid_a_${testRunTag}`,
      email: `a_${testRunTag}@example.test`,
      displayName: 'Test Owner A',
      preferredLocale: 'si-LK',
    });
    const summaryA = await getTodayWorkspaceSummary(ctxA);
    expect(summaryA.tenantId).toBe(tenantAId);
    expect(summaryA.appointments.some((a) => a.id === appointmentBId)).toBe(false);
  });

  it('T01-C: Cross-tenant appointment ID lookup throws generic NotFoundError', async () => {
    const ctxA = await requireActiveWorkspace({
      id: userAId,
      uid: `test_uid_a_${testRunTag}`,
      email: `a_${testRunTag}@example.test`,
      displayName: 'Test Owner A',
      preferredLocale: 'si-LK',
    });
    await expect(getAppointmentByIdForTenant(ctxA, appointmentBId)).rejects.toThrow(NotFoundError);
  });

  it('T01-D: PostgreSQL composite FK rejects cross-tenant person reference in appointments', async () => {
    const startsAt = new Date('2026-11-20T04:00:00Z');
    const endsAt = new Date('2026-11-20T04:20:00Z');
    await expect(
      db.insert(appointments).values({
        tenantId: tenantAId,
        branchId: branchAId,
        personId: personBId, // belongs to tenantB!
        serviceId: serviceAId,
        resourceId: resourceAId,
        startsAt,
        endsAt,
        businessDate: '2026-11-20',
        status: 'scheduled',
        bookedDurationMinutes: 20,
        bookedPriceMinor: 250000,
        currency: 'LKR',
      })
    ).rejects.toThrow();
  });

  it('T01-E: Revoked membership immediately blocks workspace access', async () => {
    await db
      .update(memberships)
      .set({ active: false, revokedAt: new Date() })
      .where(eq(memberships.tenantId, tenantAId));

    await expect(
      requireActiveWorkspace({
        id: userAId,
        uid: `test_uid_a_${testRunTag}`,
        email: `a_${testRunTag}@example.test`,
        displayName: 'Test Owner A',
        preferredLocale: 'si-LK',
      })
    ).rejects.toThrow(ForbiddenError);
  });
});
