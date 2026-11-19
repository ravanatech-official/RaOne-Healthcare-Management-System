import crypto from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db, isDatabaseConfigured } from '../db/index.ts';
import {
  auditEvents,
  coldChainLogs,
  complianceLicenses,
  hrAttendanceLogs,
  hrLeaveRequests,
  hrPayrollRuns,
  hrPayrollSlips,
  hrStaffProfiles,
  labDiagnosticOrders,
  memberships,
  people,
  users,
} from '../db/schema.ts';
import { getMemoryUserById } from '../db/users.ts';
import type {
  CreateLabOrderInput,
  HrAdminOverviewResponse,
  RequestLeaveInput,
  UpsertHrProfileInput,
} from '../contracts/departments.ts';
import { getDoctorPayoutReport } from './clinic-ops.ts';
import { ConflictError, NotFoundError } from './errors.ts';
import { addMemAuditEvent, getMemoryStore } from './memory-store.ts';
import { assertWorkspaceNotReadOnlyGrace } from './subscription-billing.ts';
import { verifyStaffShiftPin } from './team-ops.ts';
import {
  assertCapability,
  assertPermission,
  getBusinessDateInTimezone,
  type ActiveWorkspaceContext,
} from './tenancy.ts';

function diffDays(fromDate: string, toDate: string): number {
  const a = new Date(`${fromDate}T00:00:00Z`).getTime();
  const b = new Date(`${toDate}T00:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

export async function getHrAdminOverview(
  context: ActiveWorkspaceContext
): Promise<HrAdminOverviewResponse> {
  const canHr = Boolean(context.capabilities['hr.management']);
  const canAdmin = Boolean(context.capabilities['admin.operations']);
  if (!canHr && !canAdmin) {
    assertCapability(context, 'hr.management');
  }

  const businessDate = getBusinessDateInTimezone(context.timezone);
  const currentMonth = businessDate.slice(0, 7);
  const hasClinic = Boolean(context.capabilities['appointments.manage']);
  const hasPharmacy = Boolean(
    context.capabilities['pharmacy.inventory'] || context.capabilities['pharmacy.pos']
  );

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const tenantMembers = store.memberships.filter(
      (m) => m.tenantId === context.tenantId && m.active
    );

    const profiles = tenantMembers.map((m) => {
      const u = getMemoryUserById(m.userId);
      const prof = store.hrStaffProfiles.find(
        (p) => p.tenantId === context.tenantId && p.userId === m.userId
      );
      return {
        userId: m.userId,
        displayName: u?.displayName || u?.email || `Staff #${m.userId}`,
        email: u?.email || '',
        role: m.role,
        designation: prof?.designation || m.role.replace('_', ' '),
        basicSalaryMinor: prof?.basicSalaryMinor ?? (m.role === 'owner' ? 12000000 : 5500000),
        allowancesMinor: prof?.allowancesMinor ?? 500000,
        epfApplicable: prof?.epfApplicable ?? true,
        etfApplicable: prof?.etfApplicable ?? true,
        bankName: prof?.bankName ?? 'Commercial Bank PLC',
        bankAccountNo: prof?.bankAccountNo ?? '',
      };
    });

    const attendanceToday = store.hrAttendanceLogs
      .filter(
        (a) =>
          a.tenantId === context.tenantId &&
          a.branchId === context.branchId &&
          a.businessDate === businessDate
      )
      .sort((a, b) => b.clockInAt.getTime() - a.clockInAt.getTime())
      .map((a) => {
        const u = getMemoryUserById(a.userId);
        return {
          id: a.id,
          userId: a.userId,
          staffName: u?.displayName || u?.email || `Staff #${a.userId}`,
          businessDate: a.businessDate,
          clockInAt: a.clockInAt.toISOString(),
          clockOutAt: a.clockOutAt ? a.clockOutAt.toISOString() : null,
          lateMinutes: a.lateMinutes,
          overtimeMinutes: a.overtimeMinutes,
          status: a.status,
          notes: a.notes,
        };
      });

    const leaves = store.hrLeaveRequests
      .filter((l) => l.tenantId === context.tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((l) => {
        const u = getMemoryUserById(l.userId);
        return {
          id: l.id,
          userId: l.userId,
          staffName: u?.displayName || u?.email || `Staff #${l.userId}`,
          leaveType: l.leaveType,
          startDate: l.startDate,
          endDate: l.endDate,
          daysCount: l.daysCount,
          reason: l.reason,
          status: l.status,
          createdAt: l.createdAt.toISOString(),
        };
      });

    const payrollRuns = store.hrPayrollRuns
      .filter((r) => r.tenantId === context.tenantId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => ({
        id: r.id,
        payrollMonth: r.payrollMonth,
        status: r.status,
        totalGrossMinor: r.totalGrossMinor,
        totalNetMinor: r.totalNetMinor,
        totalEmployerEpfMinor: r.totalEmployerEpfMinor,
        totalEtfMinor: r.totalEtfMinor,
        finalizedAt: r.finalizedAt ? r.finalizedAt.toISOString() : null,
        slips: store.hrPayrollSlips.filter((s) => s.payrollRunId === r.id),
      }));

    const labOrders = store.labDiagnosticOrders
      .filter((o) => o.tenantId === context.tenantId && o.branchId === context.branchId)
      .sort((a, b) => b.orderedAt.getTime() - a.orderedAt.getTime())
      .map((o) => ({
        id: o.id,
        personId: o.personId,
        patientName: store.people.find((p) => p.id === o.personId)?.displayName ?? 'Patient',
        testName: o.testName,
        labProvider: o.labProvider,
        feeMinor: o.feeMinor,
        status: o.status,
        resultSummary: o.resultSummary,
        orderedAt: o.orderedAt.toISOString(),
      }));

    const coldChain = store.coldChainLogs
      .filter((c) => c.tenantId === context.tenantId && c.branchId === context.branchId)
      .sort((a, b) => b.loggedAt.getTime() - a.loggedAt.getTime())
      .map((c) => ({
        id: c.id,
        fridgeName: c.fridgeName,
        temperatureC: Number((c.tempTenthsC / 10).toFixed(1)),
        inRange: c.inRange,
        notes: c.notes,
        loggedAt: c.loggedAt.toISOString(),
      }));

    const licenses = store.complianceLicenses
      .filter((l) => l.tenantId === context.tenantId && l.branchId === context.branchId)
      .map((l) => {
        const daysRemaining = diffDays(businessDate, l.expiresOn);
        const computedStatus: 'active' | 'expiring_soon' | 'expired' =
          daysRemaining < 0 ? 'expired' : daysRemaining <= l.alertDaysBefore ? 'expiring_soon' : 'active';
        return {
          id: l.id,
          title: l.title,
          authority: l.authority,
          licenseNumber: l.licenseNumber,
          expiresOn: l.expiresOn,
          daysRemaining,
          computedStatus,
          notes: l.notes,
        };
      });

    return {
      businessDate,
      currentMonth,
      modeFlags: { hasClinic, hasPharmacy },
      profiles,
      attendanceToday,
      leaves,
      payrollRuns,
      labOrders,
      coldChainLogs: coldChain,
      licenses,
    };
  }

  // PostgreSQL branch
  const [memRows, userRows, profRows, attRows, leaveRows, runRows, slipRows, labRows, coldRows, licRows, peopleRows] =
    await Promise.all([
      db.select().from(memberships).where(and(eq(memberships.tenantId, context.tenantId), eq(memberships.active, true))),
      db.select().from(users),
      db.select().from(hrStaffProfiles).where(eq(hrStaffProfiles.tenantId, context.tenantId)),
      db
        .select()
        .from(hrAttendanceLogs)
        .where(and(eq(hrAttendanceLogs.tenantId, context.tenantId), eq(hrAttendanceLogs.businessDate, businessDate)))
        .orderBy(desc(hrAttendanceLogs.clockInAt)),
      db
        .select()
        .from(hrLeaveRequests)
        .where(eq(hrLeaveRequests.tenantId, context.tenantId))
        .orderBy(desc(hrLeaveRequests.createdAt)),
      db
        .select()
        .from(hrPayrollRuns)
        .where(eq(hrPayrollRuns.tenantId, context.tenantId))
        .orderBy(desc(hrPayrollRuns.createdAt)),
      db.select().from(hrPayrollSlips).where(eq(hrPayrollSlips.tenantId, context.tenantId)),
      db
        .select()
        .from(labDiagnosticOrders)
        .where(and(eq(labDiagnosticOrders.tenantId, context.tenantId), eq(labDiagnosticOrders.branchId, context.branchId)))
        .orderBy(desc(labDiagnosticOrders.orderedAt)),
      db
        .select()
        .from(coldChainLogs)
        .where(and(eq(coldChainLogs.tenantId, context.tenantId), eq(coldChainLogs.branchId, context.branchId)))
        .orderBy(desc(coldChainLogs.loggedAt)),
      db
        .select()
        .from(complianceLicenses)
        .where(and(eq(complianceLicenses.tenantId, context.tenantId), eq(complianceLicenses.branchId, context.branchId))),
      db.select().from(people).where(eq(people.tenantId, context.tenantId)),
    ]);

  const userName = (uid: number) => {
    const u = userRows.find((r) => r.id === uid);
    return u?.displayName || u?.email || `Staff #${uid}`;
  };

  return {
    businessDate,
    currentMonth,
    modeFlags: { hasClinic, hasPharmacy },
    profiles: memRows.map((m) => {
      const u = userRows.find((r) => r.id === m.userId);
      const prof = profRows.find((p) => p.userId === m.userId);
      return {
        userId: m.userId,
        displayName: userName(m.userId),
        email: u?.email || '',
        role: m.role,
        designation: prof?.designation || m.role,
        basicSalaryMinor: prof?.basicSalaryMinor ?? (m.role === 'owner' ? 12000000 : 5500000),
        allowancesMinor: prof?.allowancesMinor ?? 500000,
        epfApplicable: prof?.epfApplicable ?? true,
        etfApplicable: prof?.etfApplicable ?? true,
        bankName: prof?.bankName ?? 'Commercial Bank PLC',
        bankAccountNo: prof?.bankAccountNo ?? '',
      };
    }),
    attendanceToday: attRows.map((a) => ({
      id: a.id,
      userId: a.userId,
      staffName: userName(a.userId),
      businessDate: a.businessDate,
      clockInAt: a.clockInAt.toISOString(),
      clockOutAt: a.clockOutAt ? a.clockOutAt.toISOString() : null,
      lateMinutes: a.lateMinutes,
      overtimeMinutes: a.overtimeMinutes,
      status: a.status,
      notes: a.notes,
    })),
    leaves: leaveRows.map((l) => ({
      id: l.id,
      userId: l.userId,
      staffName: userName(l.userId),
      leaveType: l.leaveType,
      startDate: l.startDate,
      endDate: l.endDate,
      daysCount: l.daysCount,
      reason: l.reason,
      status: l.status,
      createdAt: l.createdAt.toISOString(),
    })),
    payrollRuns: runRows.map((r) => ({
      id: r.id,
      payrollMonth: r.payrollMonth,
      status: r.status,
      totalGrossMinor: r.totalGrossMinor,
      totalNetMinor: r.totalNetMinor,
      totalEmployerEpfMinor: r.totalEmployerEpfMinor,
      totalEtfMinor: r.totalEtfMinor,
      finalizedAt: r.finalizedAt ? r.finalizedAt.toISOString() : null,
      slips: slipRows.filter((s) => s.payrollRunId === r.id),
    })),
    labOrders: labRows.map((o) => ({
      id: o.id,
      personId: o.personId,
      patientName: peopleRows.find((p) => p.id === o.personId)?.displayName ?? 'Patient',
      testName: o.testName,
      labProvider: o.labProvider,
      feeMinor: o.feeMinor,
      status: o.status,
      resultSummary: o.resultSummary,
      orderedAt: o.orderedAt.toISOString(),
    })),
    coldChainLogs: coldRows.map((c) => ({
      id: c.id,
      fridgeName: c.fridgeName,
      temperatureC: Number((c.tempTenthsC / 10).toFixed(1)),
      inRange: c.inRange,
      notes: c.notes,
      loggedAt: c.loggedAt.toISOString(),
    })),
    licenses: licRows.map((l) => {
      const daysRemaining = diffDays(businessDate, l.expiresOn);
      const computedStatus: 'active' | 'expiring_soon' | 'expired' =
        daysRemaining < 0 ? 'expired' : daysRemaining <= l.alertDaysBefore ? 'expiring_soon' : 'active';
      return {
        id: l.id,
        title: l.title,
        authority: l.authority,
        licenseNumber: l.licenseNumber,
        expiresOn: l.expiresOn,
        daysRemaining,
        computedStatus,
        notes: l.notes,
      };
    }),
  };
}

export async function upsertHrProfile(
  context: ActiveWorkspaceContext,
  input: UpsertHrProfileInput,
  correlationId: string
) {
  assertCapability(context, 'hr.management');
  assertPermission(context, 'hr.manage');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const basicSalaryMinor = Math.round(input.basicSalaryLkr * 100);
  const allowancesMinor = Math.round(input.allowancesLkr * 100);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const existing = store.hrStaffProfiles.find(
      (p) => p.tenantId === context.tenantId && p.userId === input.userId
    );
    if (existing) {
      existing.designation = input.designation;
      existing.basicSalaryMinor = basicSalaryMinor;
      existing.allowancesMinor = allowancesMinor;
      existing.epfApplicable = input.epfApplicable;
      existing.etfApplicable = input.etfApplicable;
      existing.bankName = input.bankName;
      existing.bankAccountNo = input.bankAccountNo;
      existing.updatedAt = new Date();
      return { profile: existing };
    }
    const created = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      userId: input.userId,
      designation: input.designation,
      basicSalaryMinor,
      allowancesMinor,
      epfApplicable: input.epfApplicable,
      etfApplicable: input.etfApplicable,
      bankName: input.bankName,
      bankAccountNo: input.bankAccountNo,
      updatedAt: new Date(),
    };
    store.hrStaffProfiles.push(created);
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'hr.profile_updated',
      entityType: 'hr_profile',
      entityId: created.id,
      correlationId,
      metadataJson: { targetUserId: input.userId, basicSalaryMinor },
    });
    return { profile: created };
  }

  const [existing] = await db
    .select()
    .from(hrStaffProfiles)
    .where(and(eq(hrStaffProfiles.tenantId, context.tenantId), eq(hrStaffProfiles.userId, input.userId)))
    .limit(1);

  if (existing) {
    const [updated] = await db
      .update(hrStaffProfiles)
      .set({
        designation: input.designation,
        basicSalaryMinor,
        allowancesMinor,
        epfApplicable: input.epfApplicable,
        etfApplicable: input.etfApplicable,
        bankName: input.bankName,
        bankAccountNo: input.bankAccountNo,
        updatedAt: new Date(),
      })
      .where(eq(hrStaffProfiles.id, existing.id))
      .returning();
    return { profile: updated };
  }

  const [created] = await db
    .insert(hrStaffProfiles)
    .values({
      tenantId: context.tenantId,
      userId: input.userId,
      designation: input.designation,
      basicSalaryMinor,
      allowancesMinor,
      epfApplicable: input.epfApplicable,
      etfApplicable: input.etfApplicable,
      bankName: input.bankName,
      bankAccountNo: input.bankAccountNo,
    })
    .returning();
  return { profile: created };
}

export async function clockInStaff(
  context: ActiveWorkspaceContext,
  input: { pin?: string; notes?: string },
  correlationId: string
) {
  assertCapability(context, 'hr.management');
  assertPermission(context, 'hr.attendance.self');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (input.pin) {
    await verifyStaffShiftPin(context, input.pin, correlationId);
  }

  const businessDate = getBusinessDateInTimezone(context.timezone);
  const now = new Date();
  const shiftStart = new Date(`${businessDate}T08:30:00+05:30`);
  const lateMinutes = Math.max(0, Math.round((now.getTime() - shiftStart.getTime()) / 60000));

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const open = store.hrAttendanceLogs.find(
      (a) =>
        a.tenantId === context.tenantId &&
        a.userId === context.userId &&
        a.businessDate === businessDate &&
        !a.clockOutAt
    );
    if (open) throw new ConflictError('You are already clocked in for today');

    const log = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      userId: context.userId,
      businessDate,
      clockInAt: now,
      clockOutAt: null,
      lateMinutes,
      overtimeMinutes: 0,
      status: 'present' as const,
      notes: input.notes || '',
    };
    store.hrAttendanceLogs.unshift(log);
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'hr.clock_in',
      entityType: 'attendance_log',
      entityId: log.id,
      correlationId,
      metadataJson: { lateMinutes, businessDate },
    });
    return { log };
  }

  const [created] = await db
    .insert(hrAttendanceLogs)
    .values({
      tenantId: context.tenantId,
      branchId: context.branchId,
      userId: context.userId,
      businessDate,
      clockInAt: now,
      lateMinutes,
      overtimeMinutes: 0,
      status: 'present',
      notes: input.notes || '',
    })
    .returning();
  return { log: created };
}

export async function clockOutStaff(
  context: ActiveWorkspaceContext,
  input: { pin?: string; notes?: string },
  correlationId: string
) {
  assertCapability(context, 'hr.management');
  assertPermission(context, 'hr.attendance.self');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (input.pin) {
    await verifyStaffShiftPin(context, input.pin, correlationId);
  }

  const businessDate = getBusinessDateInTimezone(context.timezone);
  const now = new Date();
  const shiftEnd = new Date(`${businessDate}T17:30:00+05:30`);
  const overtimeMinutes = Math.max(0, Math.round((now.getTime() - shiftEnd.getTime()) / 60000));

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const open = store.hrAttendanceLogs.find(
      (a) =>
        a.tenantId === context.tenantId &&
        a.userId === context.userId &&
        a.businessDate === businessDate &&
        !a.clockOutAt
    );
    if (!open) throw new NotFoundError('No active clock-in found for today');
    open.clockOutAt = now;
    open.overtimeMinutes = overtimeMinutes;
    open.status = 'completed';
    if (input.notes) open.notes = input.notes;
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'hr.clock_out',
      entityType: 'attendance_log',
      entityId: open.id,
      correlationId,
      metadataJson: { overtimeMinutes, businessDate },
    });
    return { log: open };
  }

  const [open] = await db
    .select()
    .from(hrAttendanceLogs)
    .where(
      and(
        eq(hrAttendanceLogs.tenantId, context.tenantId),
        eq(hrAttendanceLogs.userId, context.userId),
        eq(hrAttendanceLogs.businessDate, businessDate),
        eq(hrAttendanceLogs.status, 'present')
      )
    )
    .limit(1);
  if (!open) throw new NotFoundError('No active clock-in found for today');

  const [updated] = await db
    .update(hrAttendanceLogs)
    .set({
      clockOutAt: now,
      overtimeMinutes,
      status: 'completed',
      notes: input.notes || open.notes,
    })
    .where(eq(hrAttendanceLogs.id, open.id))
    .returning();
  return { log: updated };
}

export async function requestLeave(
  context: ActiveWorkspaceContext,
  input: RequestLeaveInput,
  correlationId: string
) {
  assertCapability(context, 'hr.management');
  assertPermission(context, 'hr.attendance.self');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const reqItem = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      userId: context.userId,
      leaveType: input.leaveType,
      startDate: input.startDate,
      endDate: input.endDate,
      daysCount: input.daysCount,
      reason: input.reason,
      status: 'pending' as const,
      reviewedByUserId: null,
      reviewedAt: null,
      createdAt: new Date(),
    };
    store.hrLeaveRequests.unshift(reqItem);
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'hr.leave_requested',
      entityType: 'leave_request',
      entityId: reqItem.id,
      correlationId,
      metadataJson: { leaveType: input.leaveType, daysCount: input.daysCount },
    });
    return { leave: reqItem };
  }

  const [created] = await db
    .insert(hrLeaveRequests)
    .values({
      tenantId: context.tenantId,
      branchId: context.branchId,
      userId: context.userId,
      leaveType: input.leaveType,
      startDate: input.startDate,
      endDate: input.endDate,
      daysCount: input.daysCount,
      reason: input.reason,
      status: 'pending',
    })
    .returning();
  return { leave: created };
}

export async function reviewLeaveRequest(
  context: ActiveWorkspaceContext,
  leaveId: string,
  decision: 'approved' | 'rejected',
  correlationId: string
) {
  assertCapability(context, 'hr.management');
  assertPermission(context, 'hr.manage');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const item = store.hrLeaveRequests.find(
      (l) => l.id === leaveId && l.tenantId === context.tenantId
    );
    if (!item) throw new NotFoundError('Leave request not found');
    item.status = decision;
    item.reviewedByUserId = context.userId;
    item.reviewedAt = new Date();
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: `hr.leave_${decision}`,
      entityType: 'leave_request',
      entityId: leaveId,
      correlationId,
    });
    return { leave: item };
  }

  const [updated] = await db
    .update(hrLeaveRequests)
    .set({ status: decision, reviewedByUserId: context.userId, reviewedAt: new Date() })
    .where(and(eq(hrLeaveRequests.id, leaveId), eq(hrLeaveRequests.tenantId, context.tenantId)))
    .returning();
  if (!updated) throw new NotFoundError('Leave request not found');
  return { leave: updated };
}

export async function generateMonthlyPayroll(
  context: ActiveWorkspaceContext,
  payrollMonth: string,
  correlationId: string
) {
  assertCapability(context, 'hr.management');
  assertPermission(context, 'hr.payroll.manage');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const overview = await getHrAdminOverview(context);
  const businessDate = getBusinessDateInTimezone(context.timezone);

  let doctorCommissionPoolMinor = 0;
  if (context.capabilities['appointments.manage']) {
    const payout = await getDoctorPayoutReport(context, businessDate);
    doctorCommissionPoolMinor = payout.totalDoctorShareMinor;
  }

  let totalGrossMinor = 0;
  let totalNetMinor = 0;
  let totalEmployerEpfMinor = 0;
  let totalEtfMinor = 0;

  const slips = overview.profiles.map((prof, idx) => {
    const otMins = overview.attendanceToday
      .filter((a) => a.userId === prof.userId)
      .reduce((s, a) => s + a.overtimeMinutes, 0);
    const overtimeMinor = Math.round((otMins / 60) * 45000); // LKR 450/hr OT

    const noPayDays = overview.leaves
      .filter(
        (l) =>
          l.userId === prof.userId &&
          l.status === 'approved' &&
          l.leaveType === 'no_pay' &&
          l.startDate.startsWith(payrollMonth)
      )
      .reduce((s, l) => s + l.daysCount, 0);
    const noPayDeductionMinor = Math.round((prof.basicSalaryMinor / 26) * noPayDays);
    const commissionMinor = idx === 0 ? doctorCommissionPoolMinor : 0;

    const epfBase = Math.max(0, prof.basicSalaryMinor - noPayDeductionMinor);
    const epfEmployee8Minor = prof.epfApplicable ? Math.round(epfBase * 0.08) : 0;
    const epfEmployer12Minor = prof.epfApplicable ? Math.round(epfBase * 0.12) : 0;
    const etfEmployer3Minor = prof.etfApplicable ? Math.round(epfBase * 0.03) : 0;

    const gross = prof.basicSalaryMinor + prof.allowancesMinor + overtimeMinor + commissionMinor;
    const netPayMinor = Math.max(0, gross - noPayDeductionMinor - epfEmployee8Minor);

    totalGrossMinor += gross;
    totalNetMinor += netPayMinor;
    totalEmployerEpfMinor += epfEmployer12Minor;
    totalEtfMinor += etfEmployer3Minor;

    return {
      userId: prof.userId,
      staffName: prof.displayName,
      designation: prof.designation,
      basicMinor: prof.basicSalaryMinor,
      allowancesMinor: prof.allowancesMinor,
      overtimeMinor,
      commissionMinor,
      noPayDeductionMinor,
      epfEmployee8Minor,
      epfEmployer12Minor,
      etfEmployer3Minor,
      netPayMinor,
    };
  });

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const run = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      payrollMonth,
      status: 'finalized' as const,
      totalGrossMinor,
      totalNetMinor,
      totalEmployerEpfMinor,
      totalEtfMinor,
      finalizedAt: new Date(),
      createdByUserId: context.userId,
      createdAt: new Date(),
    };
    store.hrPayrollRuns.unshift(run);
    for (const s of slips) {
      store.hrPayrollSlips.push({
        id: crypto.randomUUID(),
        tenantId: context.tenantId,
        payrollRunId: run.id,
        ...s,
      });
    }
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'hr.payroll_generated',
      entityType: 'payroll_run',
      entityId: run.id,
      correlationId,
      metadataJson: { payrollMonth, totalNetMinor, totalEmployerEpfMinor, totalEtfMinor },
    });
    return { run, slips };
  }

  return db.transaction(async (tx) => {
    const [run] = await tx
      .insert(hrPayrollRuns)
      .values({
        tenantId: context.tenantId,
        payrollMonth,
        status: 'finalized',
        totalGrossMinor,
        totalNetMinor,
        totalEmployerEpfMinor,
        totalEtfMinor,
        finalizedAt: new Date(),
        createdByUserId: context.userId,
      })
      .returning();

    if (slips.length > 0) {
      await tx.insert(hrPayrollSlips).values(
        slips.map((s) => ({
          tenantId: context.tenantId,
          payrollRunId: run.id,
          ...s,
        }))
      );
    }

    return { run, slips };
  });
}

// Admin Ops: Lab Orders, Cold-Chain Fridge Temperature Log, & Compliance License Vault
export async function createLabOrder(
  context: ActiveWorkspaceContext,
  input: CreateLabOrderInput,
  correlationId: string
) {
  assertCapability(context, 'admin.operations');
  assertPermission(context, 'admin.ops.manage');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const feeMinor = Math.round(input.feeLkr * 100);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const order = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      personId: input.personId,
      appointmentId: input.appointmentId ?? null,
      testName: input.testName,
      labProvider: input.labProvider,
      feeMinor,
      status: 'ordered' as const,
      resultSummary: '',
      orderedByUserId: context.userId,
      orderedAt: new Date(),
      updatedAt: new Date(),
    };
    store.labDiagnosticOrders.unshift(order);
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'admin.lab_order_created',
      entityType: 'lab_order',
      entityId: order.id,
      correlationId,
      metadataJson: { testName: input.testName, feeMinor },
    });
    return { order };
  }

  const [created] = await db
    .insert(labDiagnosticOrders)
    .values({
      tenantId: context.tenantId,
      branchId: context.branchId,
      personId: input.personId,
      appointmentId: input.appointmentId ?? null,
      testName: input.testName,
      labProvider: input.labProvider,
      feeMinor,
      status: 'ordered',
      orderedByUserId: context.userId,
    })
    .returning();
  return { order: created };
}

export async function updateLabOrderStatus(
  context: ActiveWorkspaceContext,
  orderId: string,
  input: { status: 'ordered' | 'sample_collected' | 'report_ready' | 'cancelled'; resultSummary?: string },
  correlationId: string
) {
  assertCapability(context, 'admin.operations');
  assertPermission(context, 'admin.ops.manage');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const order = store.labDiagnosticOrders.find(
      (o) => o.id === orderId && o.tenantId === context.tenantId
    );
    if (!order) throw new NotFoundError('Lab order not found');
    order.status = input.status;
    if (input.resultSummary !== undefined) order.resultSummary = input.resultSummary;
    order.updatedAt = new Date();
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'admin.lab_order_updated',
      entityType: 'lab_order',
      entityId: orderId,
      correlationId,
      metadataJson: { status: input.status },
    });
    return { order };
  }

  const [updated] = await db
    .update(labDiagnosticOrders)
    .set({
      status: input.status,
      resultSummary: input.resultSummary ?? '',
      updatedAt: new Date(),
    })
    .where(and(eq(labDiagnosticOrders.id, orderId), eq(labDiagnosticOrders.tenantId, context.tenantId)))
    .returning();
  if (!updated) throw new NotFoundError('Lab order not found');
  return { order: updated };
}

export async function recordColdChainTemp(
  context: ActiveWorkspaceContext,
  input: { fridgeName: string; temperatureC: number; notes?: string },
  correlationId: string
) {
  assertCapability(context, 'admin.operations');
  assertPermission(context, 'admin.ops.manage');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  const tempTenthsC = Math.round(input.temperatureC * 10);
  const inRange = input.temperatureC >= 2.0 && input.temperatureC <= 8.0;

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const log = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      fridgeName: input.fridgeName,
      tempTenthsC,
      inRange,
      notes: input.notes || (inRange ? 'Within WHO 2°C–8°C safe band' : 'ALERT: Out of cold-chain range!'),
      recordedByUserId: context.userId,
      loggedAt: new Date(),
    };
    store.coldChainLogs.unshift(log);
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'admin.cold_chain_logged',
      entityType: 'cold_chain_log',
      entityId: log.id,
      correlationId,
      metadataJson: { temperatureC: input.temperatureC, inRange },
    });
    return { log };
  }

  const [created] = await db
    .insert(coldChainLogs)
    .values({
      tenantId: context.tenantId,
      branchId: context.branchId,
      fridgeName: input.fridgeName,
      tempTenthsC,
      inRange,
      notes: input.notes || (inRange ? 'Within WHO 2°C–8°C safe band' : 'ALERT: Out of cold-chain range!'),
      recordedByUserId: context.userId,
    })
    .returning();
  return { log: created };
}

export async function createComplianceLicense(
  context: ActiveWorkspaceContext,
  input: {
    title: string;
    authority: 'NMRA' | 'SLMC' | 'BR' | 'PHI' | 'OTHER';
    licenseNumber: string;
    expiresOn: string;
    alertDaysBefore?: number;
    notes?: string;
  },
  correlationId: string
) {
  assertCapability(context, 'admin.operations');
  assertPermission(context, 'admin.ops.manage');
  await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const lic = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      title: input.title,
      authority: input.authority,
      licenseNumber: input.licenseNumber,
      expiresOn: input.expiresOn,
      alertDaysBefore: input.alertDaysBefore ?? 30,
      notes: input.notes || '',
      createdAt: new Date(),
    };
    store.complianceLicenses.unshift(lic);
    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: 'admin.compliance_license_added',
      entityType: 'compliance_license',
      entityId: lic.id,
      correlationId,
      metadataJson: { authority: input.authority, expiresOn: input.expiresOn },
    });
    return { license: lic };
  }

  const [created] = await db
    .insert(complianceLicenses)
    .values({
      tenantId: context.tenantId,
      branchId: context.branchId,
      title: input.title,
      authority: input.authority,
      licenseNumber: input.licenseNumber,
      expiresOn: input.expiresOn,
      alertDaysBefore: input.alertDaysBefore ?? 30,
      notes: input.notes || '',
    })
    .returning();
  return { license: created };
}
