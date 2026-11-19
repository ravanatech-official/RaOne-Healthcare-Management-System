import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Banknote,
  CalendarClock,
  CheckCircle2,
  Clock,
  Download,
  FlaskConical,
  ShieldAlert,
  ThermometerSnowflake,
  UserCheck,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient, ApiClientError, formatLkrMinor, formatTimeColombo } from '../lib/api-client.ts';

type TabId = 'attendance' | 'payroll' | 'admin_ops';

export function HrAdminPage() {
  const { activeTenantId, session } = useAuth();
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const isSinhala = i18n.language !== 'en-LK';

  const canManageHr = session?.workspace?.permissions.includes('hr.manage') ?? false;
  const canManageAdmin = session?.workspace?.permissions.includes('admin.ops.manage') ?? false;

  const [tab, setTab] = useState<TabId>('attendance');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Clock In/Out
  const [clockPin, setClockPin] = useState('');
  const [clockNotes, setClockNotes] = useState('');

  // Leave request
  const [leaveType, setLeaveType] = useState<'annual' | 'casual' | 'medical' | 'no_pay'>('casual');
  const [leaveStart, setLeaveStart] = useState('');
  const [leaveEnd, setLeaveEnd] = useState('');
  const [leaveDays, setLeaveDays] = useState('1');
  const [leaveReason, setLeaveReason] = useState('');

  // HR Profile
  const [profUserId, setProfUserId] = useState('');
  const [profDesignation, setProfDesignation] = useState('Pharmacy / Clinic Staff');
  const [profBasicLkr, setProfBasicLkr] = useState('65000');
  const [profAllowanceLkr, setProfAllowanceLkr] = useState('10000');
  const [profEpf, setProfEpf] = useState(true);
  const [profEtf, setProfEtf] = useState(true);
  const [profBank, setProfBank] = useState('Commercial Bank');
  const [profAcc, setProfAcc] = useState('');

  // Payroll Month
  const [payrollMonth, setPayrollMonth] = useState(new Date().toISOString().slice(0, 7));

  // Lab Order
  const [labPersonId, setLabPersonId] = useState('');
  const [labTestName, setLabTestName] = useState('');
  const [labProvider, setLabProvider] = useState('Asiri / Lanka Hospital Lab');
  const [labFee, setLabFee] = useState('1800');

  // Cold-Chain Fridge Temp
  const [fridgeName, setFridgeName] = useState('Main Vaccine & Insulin Fridge');
  const [tempC, setTempC] = useState('4.5');
  const [tempNotes, setTempNotes] = useState('');

  // License Vault
  const [licTitle, setLicTitle] = useState('');
  const [licAuthority, setLicAuthority] = useState<'NMRA' | 'SLMC' | 'BR' | 'PHI' | 'OTHER'>('NMRA');
  const [licNumber, setLicNumber] = useState('');
  const [licExpires, setLicExpires] = useState('');

  const hrQuery = useQuery({
    queryKey: ['hr-admin-overview', activeTenantId],
    queryFn: () => apiClient.getHrAdminOverview(activeTenantId!),
    enabled: Boolean(activeTenantId),
  });

  const peopleQuery = useQuery({
    queryKey: ['clinic-people', activeTenantId],
    queryFn: () => apiClient.getClinicPeople(activeTenantId!),
    enabled: Boolean(activeTenantId && hrQuery.data?.overview.modeFlags.hasClinic),
  });

  const refreshHr = async () => {
    await queryClient.invalidateQueries({ queryKey: ['hr-admin-overview', activeTenantId] });
  };

  const clockInMutation = useMutation({
    mutationFn: () =>
      apiClient.clockInStaff(activeTenantId!, {
        pin: clockPin.trim() || undefined,
        notes: clockNotes.trim(),
      }),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg('Shift attendance clocked in.');
      setClockPin('');
      setClockNotes('');
      await refreshHr();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to clock in.');
    },
  });

  const clockOutMutation = useMutation({
    mutationFn: () =>
      apiClient.clockOutStaff(activeTenantId!, {
        pin: clockPin.trim() || undefined,
        notes: clockNotes.trim(),
      }),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg('Shift attendance clocked out & overtime calculated.');
      setClockPin('');
      await refreshHr();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to clock out.');
    },
  });

  const leaveMutation = useMutation({
    mutationFn: () =>
      apiClient.requestLeave(activeTenantId!, {
        leaveType,
        startDate: leaveStart,
        endDate: leaveEnd || leaveStart,
        daysCount: Number(leaveDays),
        reason: leaveReason.trim(),
      }),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg('Leave request submitted.');
      setLeaveReason('');
      await refreshHr();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to submit leave.');
    },
  });

  const reviewLeaveMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: 'approved' | 'rejected' }) =>
      apiClient.reviewLeaveRequest(activeTenantId!, id, decision),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg('Leave decision updated.');
      await refreshHr();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to review leave.');
    },
  });

  const profileMutation = useMutation({
    mutationFn: () =>
      apiClient.upsertHrProfile(activeTenantId!, {
        userId: Number(profUserId),
        designation: profDesignation.trim(),
        basicSalaryLkr: Number(profBasicLkr),
        allowancesLkr: Number(profAllowanceLkr),
        epfApplicable: profEpf,
        etfApplicable: profEtf,
        bankName: profBank.trim(),
        bankAccountNo: profAcc.trim(),
      }),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg('Staff HR salary & EPF/ETF profile saved.');
      await refreshHr();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to save HR profile.');
    },
  });

  const payrollMutation = useMutation({
    mutationFn: () => apiClient.generateMonthlyPayroll(activeTenantId!, payrollMonth),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg(`Generated Sri Lanka EPF/ETF Payroll Run for ${payrollMonth}.`);
      await refreshHr();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(
        err instanceof ApiClientError ? err.envelope.message : 'Unable to generate payroll.'
      );
    },
  });

  const labMutation = useMutation({
    mutationFn: () =>
      apiClient.createLabOrder(activeTenantId!, {
        personId: labPersonId,
        testName: labTestName.trim(),
        labProvider: labProvider.trim(),
        feeLkr: Number(labFee || 0),
      }),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg('Lab / diagnostic test order logged.');
      setLabTestName('');
      await refreshHr();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to log lab order.');
    },
  });

  const labStatusMutation = useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: 'ordered' | 'sample_collected' | 'report_ready' | 'cancelled';
    }) =>
      apiClient.updateLabOrderStatus(activeTenantId!, id, {
        status,
        resultSummary: status === 'report_ready' ? 'Report verified and ready for patient.' : '',
      }),
    onSuccess: refreshHr,
  });

  const fridgeMutation = useMutation({
    mutationFn: () =>
      apiClient.recordColdChainTemp(activeTenantId!, {
        fridgeName: fridgeName.trim(),
        temperatureC: Number(tempC),
        notes: tempNotes.trim(),
      }),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg('Cold-chain fridge temperature reading recorded.');
      setTempNotes('');
      await refreshHr();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to log reading.');
    },
  });

  const licenseMutation = useMutation({
    mutationFn: () =>
      apiClient.createComplianceLicense(activeTenantId!, {
        title: licTitle.trim(),
        authority: licAuthority,
        licenseNumber: licNumber.trim(),
        expiresOn: licExpires,
      }),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg('Compliance license added to expiry vault.');
      setLicTitle('');
      setLicNumber('');
      await refreshHr();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to save license.');
    },
  });

  const overview = hrQuery.data?.overview;

  const downloadPayrollBankCsv = () => {
    const latestRun = overview?.payrollRuns[0];
    if (!latestRun) return;
    const rows = [
      [
        'Payroll Month',
        'Staff Name',
        'Designation',
        'Basic (LKR)',
        'Allowances (LKR)',
        'Commission (LKR)',
        'EPF Employee 8%',
        'EPF Employer 12%',
        'ETF Employer 3%',
        'Net Pay (LKR)',
      ].join(','),
      ...latestRun.slips.map((s) =>
        [
          latestRun.payrollMonth,
          `"${s.staffName}"`,
          `"${s.designation}"`,
          (s.basicMinor / 100).toFixed(2),
          (s.allowancesMinor / 100).toFixed(2),
          (s.commissionMinor / 100).toFixed(2),
          (s.epfEmployee8Minor / 100).toFixed(2),
          (s.epfEmployer12Minor / 100).toFixed(2),
          (s.etfEmployer3Minor / 100).toFixed(2),
          (s.netPayMinor / 100).toFixed(2),
        ].join(',')
      ),
    ].join('\n');

    const blob = new Blob([rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `suwaseva-payroll-${latestRun.payrollMonth}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold neon-heading-glow">
          {isSinhala
            ? 'HR, වැටුප් (EPF/ETF) සහ පරිපාලන අංශය'
            : 'HR, Payroll (EPF/ETF) & Clinical/Pharmacy Operations'}
        </h1>
        <p className="text-sm text-cyan-100/75">
          {isSinhala
            ? 'සේවක පැමිණීම (Shift PIN), නිවාඩු, මාසික වැටුප් + EPF/ETF, Lab වාර්තා, ශීතකරණ උෂ්ණත්වය සහ බලපත්‍ර කල් ඉකුත් වීම්.'
            : 'Shift PIN attendance, leave approvals, Sri Lanka EPF/ETF payroll, lab orders, fridge cold-chain logs, and license alerts.'}
        </p>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="HR and Admin tabs"
        className="flex flex-wrap gap-2 p-1.5 bg-[#051126] border border-cyan-500/25 rounded-xl w-fit"
      >
        {[
          { id: 'attendance' as const, label: 'Attendance & Leaves', Icon: Clock },
          { id: 'payroll' as const, label: 'Payroll (EPF / ETF)', Icon: Banknote },
          { id: 'admin_ops' as const, label: 'Ops & License Vault', Icon: ShieldAlert },
        ].map(({ id, label, Icon }) => {
          const active = tab === id;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(id)}
              className={`min-h-[40px] px-4 rounded-lg text-xs font-semibold inline-flex items-center gap-2 transition-all ${
                active ? 'neon-btn-primary' : 'text-slate-300 hover:text-cyan-200'
              }`}
            >
              <Icon className="w-4 h-4" aria-hidden="true" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      {errorMsg && (
        <div
          role="alert"
          className="p-3.5 bg-rose-950/70 border border-rose-400/50 rounded-xl text-sm text-rose-200"
        >
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="p-3.5 bg-cyan-950/70 border border-cyan-400/50 rounded-xl text-sm text-cyan-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-cyan-300 shrink-0" aria-hidden="true" />
          <span>{successMsg}</span>
        </div>
      )}

      {hrQuery.isLoading ? (
        <div className="p-8 neon-card rounded-xl text-sm text-cyan-200/75">Loading HR data...</div>
      ) : overview ? (
        <>
          {/* TAB 1: ATTENDANCE & LEAVES */}
          {tab === 'attendance' && (
            <div className="space-y-6">
              <div className="grid lg:grid-cols-12 gap-6">
                <section className="lg:col-span-5 neon-card-glow rounded-xl p-6 space-y-4">
                  <div className="flex items-center gap-2 text-base font-semibold text-white">
                    <UserCheck className="w-5 h-5 text-cyan-300" aria-hidden="true" />
                    <h2>Shift PIN Attendance Clock</h2>
                  </div>
                  <p className="text-xs text-slate-300">
                    Clock in/out for <span className="font-mono-tabular text-cyan-300">{overview.businessDate}</span>. Enter Shift PIN if configured on your workspace.
                  </p>
                  <div className="space-y-3">
                    <input
                      type="password"
                      inputMode="numeric"
                      maxLength={6}
                      value={clockPin}
                      onChange={(e) => setClockPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="Shift PIN (optional unless set)"
                      className="w-full min-h-[42px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                    />
                    <input
                      value={clockNotes}
                      onChange={(e) => setClockNotes(e.target.value)}
                      placeholder="Shift note (e.g. Morning counter)"
                      className="w-full min-h-[42px] px-3 rounded-lg text-sm neon-input"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        disabled={clockInMutation.isPending}
                        onClick={() => clockInMutation.mutate()}
                        className="min-h-[44px] rounded-lg text-sm neon-btn-primary"
                      >
                        Clock In
                      </button>
                      <button
                        type="button"
                        disabled={clockOutMutation.isPending}
                        onClick={() => clockOutMutation.mutate()}
                        className="min-h-[44px] rounded-lg text-sm font-semibold neon-btn-secondary"
                      >
                        Clock Out
                      </button>
                    </div>
                  </div>
                </section>

                <section className="lg:col-span-7 neon-card rounded-xl p-6 space-y-4">
                  <h2 className="text-base font-semibold text-white">
                    Today&apos;s Attendance Log ({overview.businessDate})
                  </h2>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-cyan-500/20 text-cyan-200/75">
                          <th className="py-2.5 px-3">Staff</th>
                          <th className="py-2.5 px-3">Clock In</th>
                          <th className="py-2.5 px-3">Clock Out</th>
                          <th className="py-2.5 px-3 text-right">Late / OT</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-cyan-500/15">
                        {overview.attendanceToday.length === 0 ? (
                          <tr>
                            <td colSpan={4} className="py-8 text-center text-slate-400">
                              No staff clocked in yet today.
                            </td>
                          </tr>
                        ) : (
                          overview.attendanceToday.map((a) => (
                            <tr key={a.id} className="hover:bg-cyan-950/20">
                              <td className="py-2.5 px-3 font-medium text-white">{a.staffName}</td>
                              <td className="py-2.5 px-3 font-mono-tabular text-emerald-300">
                                {formatTimeColombo(a.clockInAt)}
                              </td>
                              <td className="py-2.5 px-3 font-mono-tabular text-slate-300">
                                {a.clockOutAt ? formatTimeColombo(a.clockOutAt) : 'On Shift'}
                              </td>
                              <td className="py-2.5 px-3 text-right font-mono-tabular">
                                <span className={a.lateMinutes > 0 ? 'text-amber-300' : 'text-slate-400'}>
                                  {a.lateMinutes}m late
                                </span>{' '}
                                /{' '}
                                <span className="text-cyan-300">{a.overtimeMinutes}m OT</span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>

              {/* Leave Requests */}
              <div className="grid lg:grid-cols-12 gap-6">
                <section className="lg:col-span-5 neon-card rounded-xl p-6 space-y-4">
                  <div className="flex items-center gap-2 text-base font-semibold text-white">
                    <CalendarClock className="w-5 h-5 text-cyan-300" aria-hidden="true" />
                    <h2>Submit Leave Request</h2>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      leaveMutation.mutate();
                    }}
                    className="space-y-3"
                  >
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block space-y-1">
                        <span className="text-xs text-cyan-100/80">Leave Type</span>
                        <select
                          value={leaveType}
                          onChange={(e) =>
                            setLeaveType(
                              e.target.value as 'annual' | 'casual' | 'medical' | 'no_pay'
                            )
                          }
                          className="w-full min-h-[40px] px-3 rounded-lg text-sm neon-input"
                        >
                          <option value="casual">Casual Leave</option>
                          <option value="annual">Annual Leave</option>
                          <option value="medical">Medical Leave</option>
                          <option value="no_pay">No-Pay Leave</option>
                        </select>
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs text-cyan-100/80">Days Count *</span>
                        <input
                          required
                          type="number"
                          min="1"
                          value={leaveDays}
                          onChange={(e) => setLeaveDays(e.target.value)}
                          className="w-full min-h-[40px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                        />
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block space-y-1">
                        <span className="text-xs text-cyan-100/80">Start Date *</span>
                        <input
                          required
                          type="date"
                          value={leaveStart}
                          onChange={(e) => setLeaveStart(e.target.value)}
                          className="w-full min-h-[40px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs text-cyan-100/80">End Date</span>
                        <input
                          type="date"
                          value={leaveEnd}
                          onChange={(e) => setLeaveEnd(e.target.value)}
                          className="w-full min-h-[40px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                        />
                      </label>
                    </div>
                    <label className="block space-y-1">
                      <span className="text-xs text-cyan-100/80">Reason *</span>
                      <input
                        required
                        value={leaveReason}
                        onChange={(e) => setLeaveReason(e.target.value)}
                        placeholder="Personal / medical reason"
                        className="w-full min-h-[40px] px-3 rounded-lg text-sm neon-input"
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={leaveMutation.isPending}
                      className="w-full min-h-[42px] rounded-lg text-sm neon-btn-primary"
                    >
                      Submit Leave Request
                    </button>
                  </form>
                </section>

                <section className="lg:col-span-7 neon-card rounded-xl p-6 space-y-4">
                  <h2 className="text-base font-semibold text-white">Team Leave Approvals</h2>
                  <div className="space-y-2.5">
                    {overview.leaves.length === 0 ? (
                      <p className="text-sm text-slate-400 py-6 text-center">
                        No leave requests recorded.
                      </p>
                    ) : (
                      overview.leaves.map((l) => (
                        <div
                          key={l.id}
                          className="p-3.5 rounded-xl bg-[#040e22]/90 border border-cyan-500/20 flex flex-wrap items-center justify-between gap-3"
                        >
                          <div>
                            <div className="text-sm font-semibold text-white">
                              {l.staffName} ·{' '}
                              <span className="text-cyan-300 capitalize">
                                {l.leaveType.replace('_', ' ')} ({l.daysCount}d)
                              </span>
                            </div>
                            <div className="text-xs text-slate-400">
                              {l.startDate} → {l.endDate} · {l.reason}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {l.status === 'pending' && canManageHr ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() =>
                                    reviewLeaveMutation.mutate({ id: l.id, decision: 'approved' })
                                  }
                                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-400 text-[#021324]"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    reviewLeaveMutation.mutate({ id: l.id, decision: 'rejected' })
                                  }
                                  className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-rose-400/50 text-rose-300"
                                >
                                  Reject
                                </button>
                              </>
                            ) : (
                              <span
                                className={`text-xs font-semibold uppercase ${
                                  l.status === 'approved'
                                    ? 'text-emerald-300'
                                    : l.status === 'rejected'
                                      ? 'text-rose-300'
                                      : 'text-amber-300'
                                }`}
                              >
                                {l.status}
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
            </div>
          )}

          {/* TAB 2: MONTHLY PAYROLL & EPF/ETF */}
          {tab === 'payroll' && (
            <div className="space-y-6">
              <div className="grid lg:grid-cols-12 gap-6">
                <section className="lg:col-span-5 neon-card rounded-xl p-6 space-y-4">
                  <h2 className="text-base font-semibold text-white">
                    Staff Salary &amp; EPF/ETF Profile
                  </h2>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      profileMutation.mutate();
                    }}
                    className="space-y-3"
                  >
                    <label className="block space-y-1">
                      <span className="text-xs text-cyan-100/80">Staff Member *</span>
                      <select
                        required
                        value={profUserId}
                        onChange={(e) => {
                          const uid = e.target.value;
                          setProfUserId(uid);
                          const existing = overview.profiles.find(
                            (p) => String(p.userId) === uid
                          );
                          if (existing) {
                            setProfDesignation(existing.designation);
                            setProfBasicLkr(String(existing.basicSalaryMinor / 100));
                            setProfAllowanceLkr(String(existing.allowancesMinor / 100));
                            setProfEpf(existing.epfApplicable);
                            setProfEtf(existing.etfApplicable);
                            setProfBank(existing.bankName);
                            setProfAcc(existing.bankAccountNo);
                          }
                        }}
                        className="w-full min-h-[42px] px-3 rounded-lg text-sm neon-input"
                      >
                        <option value="">Select staff...</option>
                        {overview.profiles.map((p) => (
                          <option key={p.userId} value={p.userId}>
                            {p.displayName || p.email} ({p.role})
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block space-y-1">
                      <span className="text-xs text-cyan-100/80">Designation *</span>
                      <input
                        required
                        value={profDesignation}
                        onChange={(e) => setProfDesignation(e.target.value)}
                        className="w-full min-h-[40px] px-3 rounded-lg text-sm neon-input"
                      />
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block space-y-1">
                        <span className="text-xs text-cyan-100/80">Basic Salary (LKR)</span>
                        <input
                          required
                          type="number"
                          min="0"
                          value={profBasicLkr}
                          onChange={(e) => setProfBasicLkr(e.target.value)}
                          className="w-full min-h-[40px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                        />
                      </label>
                      <label className="block space-y-1">
                        <span className="text-xs text-cyan-100/80">Allowances (LKR)</span>
                        <input
                          required
                          type="number"
                          min="0"
                          value={profAllowanceLkr}
                          onChange={(e) => setProfAllowanceLkr(e.target.value)}
                          className="w-full min-h-[40px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                        />
                      </label>
                    </div>
                    <div className="flex gap-4 text-xs text-cyan-100">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={profEpf}
                          onChange={(e) => setProfEpf(e.target.checked)}
                          className="accent-cyan-400"
                        />
                        <span>EPF (8% / 12%)</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={profEtf}
                          onChange={(e) => setProfEtf(e.target.checked)}
                          className="accent-cyan-400"
                        />
                        <span>ETF (3%)</span>
                      </label>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <input
                        value={profBank}
                        onChange={(e) => setProfBank(e.target.value)}
                        placeholder="Bank Name"
                        className="min-h-[40px] px-3 rounded-lg text-xs neon-input"
                      />
                      <input
                        value={profAcc}
                        onChange={(e) => setProfAcc(e.target.value)}
                        placeholder="Account Number"
                        className="min-h-[40px] px-3 rounded-lg text-xs font-mono-tabular neon-input"
                      />
                    </div>
                    <button
                      type="submit"
                      disabled={profileMutation.isPending || !canManageHr}
                      className="w-full min-h-[42px] rounded-lg text-sm neon-btn-secondary disabled:opacity-50"
                    >
                      Save Salary Profile
                    </button>
                  </form>
                </section>

                <section className="lg:col-span-7 neon-card-glow rounded-xl p-6 space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="text-base font-semibold text-white">
                        Sri Lanka EPF/ETF &amp; Commission Payroll Generator
                      </h2>
                      <p className="text-xs text-slate-300">
                        Auto-calculates EPF 8% Employee, EPF 12% Employer, ETF 3% Employer, No-Pay deductions &amp; Doctor Channeling Share.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="month"
                        value={payrollMonth}
                        onChange={(e) => setPayrollMonth(e.target.value)}
                        className="min-h-[40px] px-3 rounded-lg text-xs font-mono-tabular neon-input"
                      />
                      <button
                        type="button"
                        disabled={payrollMutation.isPending || !canManageHr}
                        onClick={() => payrollMutation.mutate()}
                        className="min-h-[40px] px-4 rounded-lg text-xs neon-btn-primary disabled:opacity-50"
                      >
                        Run Payroll
                      </button>
                    </div>
                  </div>

                  {overview.payrollRuns.length === 0 ? (
                    <p className="text-sm text-slate-400 py-8 text-center">
                      Select a payroll month and click Run Payroll to generate statutory payslips.
                    </p>
                  ) : (
                    (() => {
                      const run = overview.payrollRuns[0];
                      return (
                        <div className="space-y-4">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                            <div className="p-3 rounded-lg bg-[#040e22]/90 border border-cyan-500/20">
                              <div className="text-slate-400">Month</div>
                              <div className="text-sm font-bold font-mono-tabular text-white">
                                {run.payrollMonth}
                              </div>
                            </div>
                            <div className="p-3 rounded-lg bg-[#040e22]/90 border border-cyan-500/20">
                              <div className="text-slate-400">Net Payout</div>
                              <div className="text-sm font-bold font-mono-tabular neon-text-cyan">
                                {formatLkrMinor(run.totalNetMinor)}
                              </div>
                            </div>
                            <div className="p-3 rounded-lg bg-[#040e22]/90 border border-cyan-500/20">
                              <div className="text-slate-400">Employer EPF (12%)</div>
                              <div className="text-sm font-bold font-mono-tabular text-amber-300">
                                {formatLkrMinor(run.totalEmployerEpfMinor)}
                              </div>
                            </div>
                            <div className="p-3 rounded-lg bg-[#040e22]/90 border border-cyan-500/20">
                              <div className="text-slate-400">Employer ETF (3%)</div>
                              <div className="text-sm font-bold font-mono-tabular text-emerald-300">
                                {formatLkrMinor(run.totalEtfMinor)}
                              </div>
                            </div>
                          </div>

                          <div className="flex justify-end">
                            <button
                              type="button"
                              onClick={downloadPayrollBankCsv}
                              className="min-h-[36px] px-3 rounded-lg text-xs neon-btn-secondary inline-flex items-center gap-1.5"
                            >
                              <Download className="w-3.5 h-3.5" />
                              <span>Download Bank Transfer CSV</span>
                            </button>
                          </div>

                          <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-xs">
                              <thead>
                                <tr className="border-b border-cyan-500/20 text-cyan-200/75">
                                  <th className="py-2 px-2">Staff</th>
                                  <th className="py-2 px-2 text-right">Basic + Allow</th>
                                  <th className="py-2 px-2 text-right">Comm / OT</th>
                                  <th className="py-2 px-2 text-right">EPF 8%</th>
                                  <th className="py-2 px-2 text-right">Net Pay</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-cyan-500/15">
                                {run.slips.map((s) => (
                                  <tr key={s.id}>
                                    <td className="py-2 px-2 text-white">
                                      <div className="font-medium">{s.staffName}</div>
                                      <div className="text-[11px] text-slate-400">{s.designation}</div>
                                    </td>
                                    <td className="py-2 px-2 text-right font-mono-tabular">
                                      {formatLkrMinor(s.basicMinor + s.allowancesMinor)}
                                    </td>
                                    <td className="py-2 px-2 text-right font-mono-tabular text-cyan-300">
                                      {formatLkrMinor(s.commissionMinor + s.overtimeMinor)}
                                    </td>
                                    <td className="py-2 px-2 text-right font-mono-tabular text-amber-300">
                                      -{formatLkrMinor(s.epfEmployee8Minor)}
                                    </td>
                                    <td className="py-2 px-2 text-right font-mono-tabular font-bold text-emerald-300">
                                      {formatLkrMinor(s.netPayMinor)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      );
                    })()
                  )}
                </section>
              </div>
            </div>
          )}

          {/* TAB 3: ADMIN OPS (CLINIC LABS / PHARMACY COLD CHAIN / LICENSE VAULT) */}
          {tab === 'admin_ops' && (
            <div className="space-y-6">
              <div className="grid lg:grid-cols-2 gap-6">
                {/* Clinic Only / Combo: Lab Orders */}
                {overview.modeFlags.hasClinic && (
                  <section className="neon-card rounded-xl p-6 space-y-4">
                    <div className="flex items-center gap-2 text-base font-semibold text-white">
                      <FlaskConical className="w-5 h-5 text-cyan-300" aria-hidden="true" />
                      <h2>Lab &amp; Diagnostic Test Orders</h2>
                    </div>

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        labMutation.mutate();
                      }}
                      className="grid sm:grid-cols-2 gap-2.5"
                    >
                      <select
                        required
                        value={labPersonId}
                        onChange={(e) => setLabPersonId(e.target.value)}
                        className="min-h-[40px] px-3 rounded-lg text-xs neon-input"
                      >
                        <option value="">Select patient...</option>
                        {peopleQuery.data?.people.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.displayName}
                          </option>
                        ))}
                      </select>
                      <input
                        required
                        value={labTestName}
                        onChange={(e) => setLabTestName(e.target.value)}
                        placeholder="Test (e.g. Full Blood Count)"
                        className="min-h-[40px] px-3 rounded-lg text-xs neon-input"
                      />
                      <input
                        value={labProvider}
                        onChange={(e) => setLabProvider(e.target.value)}
                        placeholder="Lab Provider"
                        className="min-h-[40px] px-3 rounded-lg text-xs neon-input"
                      />
                      <div className="flex gap-2">
                        <input
                          required
                          type="number"
                          min="0"
                          value={labFee}
                          onChange={(e) => setLabFee(e.target.value)}
                          placeholder="Fee LKR"
                          className="w-28 min-h-[40px] px-3 rounded-lg text-xs font-mono-tabular neon-input"
                        />
                        <button
                          type="submit"
                          disabled={labMutation.isPending}
                          className="flex-1 min-h-[40px] rounded-lg text-xs neon-btn-primary"
                        >
                          Order Test
                        </button>
                      </div>
                    </form>

                    <div className="space-y-2">
                      {overview.labOrders.map((o) => (
                        <div
                          key={o.id}
                          className="p-3 rounded-lg bg-[#040e22]/90 border border-cyan-500/20 flex flex-wrap items-center justify-between gap-2 text-xs"
                        >
                          <div>
                            <div className="font-semibold text-white">
                              {o.patientName} — {o.testName}
                            </div>
                            <div className="text-slate-400">
                              {o.labProvider} · {formatLkrMinor(o.feeMinor)} ·{' '}
                              <span className="text-cyan-300 uppercase">{o.status.replace('_', ' ')}</span>
                            </div>
                          </div>
                          <div className="flex gap-1.5">
                            {o.status === 'ordered' && (
                              <button
                                type="button"
                                onClick={() =>
                                  labStatusMutation.mutate({ id: o.id, status: 'sample_collected' })
                                }
                                className="px-2.5 py-1 rounded neon-btn-secondary"
                              >
                                Sample Collected
                              </button>
                            )}
                            {o.status !== 'report_ready' && (
                              <button
                                type="button"
                                onClick={() =>
                                  labStatusMutation.mutate({ id: o.id, status: 'report_ready' })
                                }
                                className="px-2.5 py-1 rounded bg-emerald-400 text-[#021324] font-semibold"
                              >
                                Report Ready
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Pharmacy Only / Combo: Cold-Chain Fridge Log */}
                {overview.modeFlags.hasPharmacy && (
                  <section className="neon-card rounded-xl p-6 space-y-4">
                    <div className="flex items-center gap-2 text-base font-semibold text-white">
                      <ThermometerSnowflake className="w-5 h-5 text-cyan-300" aria-hidden="true" />
                      <h2>NMRA Cold-Chain Fridge Temperature Log (2.0°C – 8.0°C)</h2>
                    </div>

                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        fridgeMutation.mutate();
                      }}
                      className="grid sm:grid-cols-3 gap-2.5"
                    >
                      <input
                        required
                        value={fridgeName}
                        onChange={(e) => setFridgeName(e.target.value)}
                        placeholder="Fridge Name"
                        className="min-h-[40px] px-3 rounded-lg text-xs neon-input"
                      />
                      <input
                        required
                        type="number"
                        step="0.1"
                        value={tempC}
                        onChange={(e) => setTempC(e.target.value)}
                        placeholder="4.5 °C"
                        className="min-h-[40px] px-3 rounded-lg text-xs font-mono-tabular neon-input"
                      />
                      <button
                        type="submit"
                        disabled={fridgeMutation.isPending}
                        className="min-h-[40px] rounded-lg text-xs neon-btn-primary"
                      >
                        Log Reading
                      </button>
                    </form>

                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {overview.coldChainLogs.map((c) => (
                        <div
                          key={c.id}
                          className={`p-3 rounded-lg border flex justify-between items-center text-xs ${
                            c.inRange
                              ? 'bg-[#040e22]/90 border-cyan-500/20'
                              : 'bg-rose-950/50 border-rose-400/50'
                          }`}
                        >
                          <div>
                            <div className="font-semibold text-white">{c.fridgeName}</div>
                            <div className="text-slate-400">
                              {formatTimeColombo(c.loggedAt)} {c.notes ? `· ${c.notes}` : ''}
                            </div>
                          </div>
                          <div
                            className={`text-sm font-bold font-mono-tabular ${
                              c.inRange ? 'text-cyan-300' : 'text-rose-300'
                            }`}
                          >
                            {c.temperatureC.toFixed(1)}°C{' '}
                            {c.inRange ? 'OK' : 'ALERT (Out of 2–8°C)'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </div>

              {/* Compliance & Regulatory License Expiry Vault */}
              <section className="neon-card rounded-xl p-6 space-y-4">
                <div className="flex items-center gap-2 text-base font-semibold text-white">
                  <ShieldAlert className="w-5 h-5 text-cyan-300" aria-hidden="true" />
                  <h2>Regulatory License Expiry Vault (NMRA / SLMC / BR / PHI)</h2>
                </div>

                {canManageAdmin && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      licenseMutation.mutate();
                    }}
                    className="grid sm:grid-cols-5 gap-2.5 items-end"
                  >
                    <input
                      required
                      value={licTitle}
                      onChange={(e) => setLicTitle(e.target.value)}
                      placeholder="License Title (e.g. NMRA Retail)"
                      className="sm:col-span-2 min-h-[40px] px-3 rounded-lg text-xs neon-input"
                    />
                    <select
                      value={licAuthority}
                      onChange={(e) =>
                        setLicAuthority(
                          e.target.value as 'NMRA' | 'SLMC' | 'BR' | 'PHI' | 'OTHER'
                        )
                      }
                      className="min-h-[40px] px-3 rounded-lg text-xs neon-input"
                    >
                      <option value="NMRA">NMRA</option>
                      <option value="SLMC">SLMC</option>
                      <option value="BR">Business Reg (BR)</option>
                      <option value="PHI">PHI Certificate</option>
                      <option value="OTHER">Other</option>
                    </select>
                    <input
                      required
                      value={licNumber}
                      onChange={(e) => setLicNumber(e.target.value)}
                      placeholder="License Number"
                      className="min-h-[40px] px-3 rounded-lg text-xs font-mono-tabular neon-input"
                    />
                    <div className="flex gap-2">
                      <input
                        required
                        type="date"
                        value={licExpires}
                        onChange={(e) => setLicExpires(e.target.value)}
                        className="flex-1 min-h-[40px] px-2.5 rounded-lg text-xs font-mono-tabular neon-input"
                      />
                      <button
                        type="submit"
                        disabled={licenseMutation.isPending}
                        className="px-4 min-h-[40px] rounded-lg text-xs neon-btn-primary"
                      >
                        Add
                      </button>
                    </div>
                  </form>
                )}

                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {overview.licenses.map((lic) => (
                    <div
                      key={lic.id}
                      className={`p-4 rounded-xl border space-y-1.5 ${
                        lic.computedStatus === 'expired'
                          ? 'bg-rose-950/50 border-rose-400/50'
                          : lic.computedStatus === 'expiring_soon'
                            ? 'bg-amber-950/40 border-amber-400/50'
                            : 'bg-[#040e22]/90 border-cyan-500/20'
                      }`}
                    >
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-bold text-cyan-300">{lic.authority}</span>
                        <span
                          className={`font-mono-tabular font-semibold ${
                            lic.computedStatus === 'expired'
                              ? 'text-rose-300'
                              : lic.computedStatus === 'expiring_soon'
                                ? 'text-amber-300'
                                : 'text-emerald-300'
                          }`}
                        >
                          {lic.daysRemaining < 0
                            ? `Expired ${Math.abs(lic.daysRemaining)}d ago`
                            : `${lic.daysRemaining}d remaining`}
                        </span>
                      </div>
                      <div className="text-sm font-semibold text-white">{lic.title}</div>
                      <div className="text-xs font-mono-tabular text-slate-300">
                        {lic.licenseNumber} · Expires {lic.expiresOn}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
