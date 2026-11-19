import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, KeyRound, MailPlus, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient, ApiClientError } from '../lib/api-client.ts';
import { ROLE_PERMISSIONS, type Role } from '../contracts/api.ts';

const ALL_ROLES: Role[] = [
  'owner',
  'manager',
  'receptionist',
  'cashier',
  'stock_keeper',
  'accountant',
];

export function TeamPage() {
  const { activeTenantId, session } = useAuth();
  const queryClient = useQueryClient();

  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [branchName, setBranchName] = useState('');
  const [branchCode, setBranchCode] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteName, setInviteName] = useState('');
  const [inviteRole, setInviteRole] = useState<Role>('receptionist');
  const [inviteBranchId, setInviteBranchId] = useState('');
  const [pinInput, setPinInput] = useState('');

  const canManageTeam = session?.workspace?.permissions.includes('team.manage_stepup') ?? false;

  const { data, isLoading, error } = useQuery({
    queryKey: ['team', activeTenantId],
    queryFn: () => apiClient.getTeamMembers(activeTenantId!),
    enabled: Boolean(activeTenantId),
  });

  const branchesQuery = useQuery({
    queryKey: ['workspace-branches', activeTenantId],
    queryFn: () => apiClient.getWorkspaceBranches(activeTenantId!),
    enabled: Boolean(activeTenantId),
  });

  const invitesQuery = useQuery({
    queryKey: ['staff-invites', activeTenantId],
    queryFn: () => apiClient.getStaffInvites(activeTenantId!),
    enabled: Boolean(activeTenantId && canManageTeam),
  });

  const createBranchMutation = useMutation({
    mutationFn: () =>
      apiClient.createWorkspaceBranch(activeTenantId!, {
        name: branchName.trim(),
        code: branchCode.trim(),
        openingHoursSummary: '08:30 - 18:00',
      }),
    onSuccess: () => {
      setFeedback({ type: 'ok', text: `Branch "${branchName.trim()}" created.` });
      setBranchName('');
      setBranchCode('');
      queryClient.invalidateQueries({ queryKey: ['workspace-branches', activeTenantId] });
      queryClient.invalidateQueries({ queryKey: ['billing-overview', activeTenantId] });
    },
    onError: (err) => {
      setFeedback({
        type: 'err',
        text: err instanceof ApiClientError ? err.envelope.message : 'Unable to create branch.',
      });
    },
  });

  const inviteMutation = useMutation({
    mutationFn: () =>
      apiClient.createStaffInvite(activeTenantId!, {
        email: inviteEmail.trim(),
        displayName: inviteName.trim(),
        role: inviteRole,
        branchId: inviteBranchId || branchesQuery.data?.branches[0]?.id || session?.workspace?.branchId || '',
      }),
    onSuccess: () => {
      setFeedback({ type: 'ok', text: `Staff invite created for ${inviteEmail.trim()}.` });
      setInviteEmail('');
      setInviteName('');
      queryClient.invalidateQueries({ queryKey: ['staff-invites', activeTenantId] });
    },
    onError: (err) => {
      setFeedback({
        type: 'err',
        text: err instanceof ApiClientError ? err.envelope.message : 'Unable to send staff invite.',
      });
    },
  });

  const revokeInviteMutation = useMutation({
    mutationFn: (inviteId: string) => apiClient.revokeStaffInvite(activeTenantId!, inviteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['staff-invites', activeTenantId] });
    },
  });

  const updateMembershipMutation = useMutation({
    mutationFn: (vars: { membershipId: string; role?: string; active?: boolean }) =>
      apiClient.updateTeamMembership(activeTenantId!, vars.membershipId, {
        role: vars.role,
        active: vars.active,
      }),
    onSuccess: () => {
      setFeedback({ type: 'ok', text: 'Staff role updated.' });
      queryClient.invalidateQueries({ queryKey: ['team', activeTenantId] });
    },
    onError: (err) => {
      setFeedback({
        type: 'err',
        text: err instanceof ApiClientError ? err.envelope.message : 'Unable to update staff role.',
      });
    },
  });

  const setPinMutation = useMutation({
    mutationFn: () => apiClient.setShiftPin(activeTenantId!, pinInput.trim()),
    onSuccess: () => {
      setFeedback({
        type: 'ok',
        text: 'Quick Shift PIN configured. You can now unlock via PIN from the Lock screen.',
      });
      setPinInput('');
    },
    onError: (err) => {
      setFeedback({
        type: 'err',
        text: err instanceof ApiClientError ? err.envelope.message : 'Unable to save Shift PIN.',
      });
    },
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold neon-heading-glow">
          Team, Multi-Branch & Shift PIN Access
        </h1>
        <p className="text-sm text-slate-300">
          Server-enforced access roles, branch assignments, staff onboarding invites, and shared counter PIN switch for{' '}
          <span className="neon-text-cyan font-medium">{session?.workspace?.tenantName}</span>.
        </p>
      </div>

      {feedback && (
        <div
          role={feedback.type === 'err' ? 'alert' : 'status'}
          className={`p-3 rounded-lg border text-sm ${
            feedback.type === 'err'
              ? 'bg-rose-950/60 border-rose-400/50 text-rose-200'
              : 'bg-cyan-950/60 border-cyan-400/40 text-cyan-100'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Quick Personal Shift PIN Card */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setPinMutation.mutate();
        }}
        className="neon-card rounded-xl p-5 flex flex-wrap items-end justify-between gap-4"
      >
        <div className="space-y-1 max-w-lg">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <KeyRound className="w-4 h-4 neon-text-cyan" aria-hidden="true" />
            <span>Personal Quick Shift Lock PIN (4–6 Digits)</span>
          </div>
          <p className="text-xs text-slate-300">
            Configure a personal numeric PIN so front-desk and pharmacy counters can quickly lock & switch without re-typing passwords.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            required
            value={pinInput}
            onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="4-6 digits"
            className="min-h-[40px] w-36 px-3 neon-input rounded-lg text-sm font-mono-tabular"
          />
          <button
            type="submit"
            disabled={pinInput.length < 4 || setPinMutation.isPending}
            className="min-h-[40px] px-4 neon-btn-primary disabled:opacity-50 text-xs rounded-lg whitespace-nowrap"
          >
            Save Shift PIN
          </button>
        </div>
      </form>

      {/* Active Members Table */}
      <div className="neon-card rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-slate-400">Loading members...</div>
        ) : error ? (
          <div className="p-6 text-sm text-rose-300">Unable to load team members.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-cyan-500/20 bg-[#040e22]/90 text-xs font-medium text-cyan-200">
                  <th className="py-3 px-4">Staff Member</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Branch</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cyan-500/15 text-sm">
                {data?.members.map((m) => (
                  <tr key={m.membershipId} className="hover:bg-cyan-500/5 transition-colors">
                    <td className="py-3 px-4 font-medium text-white">{m.displayName || 'Staff'}</td>
                    <td className="py-3 px-4 text-slate-300">{m.email}</td>
                    <td className="py-3 px-4 text-slate-300">{m.branchName}</td>
                    <td className="py-3 px-4 capitalize font-medium text-cyan-100">
                      {canManageTeam ? (
                        <select
                          value={m.role}
                          onChange={(e) =>
                            updateMembershipMutation.mutate({
                              membershipId: m.membershipId,
                              role: e.target.value,
                            })
                          }
                          className="min-h-[34px] px-2 neon-input rounded text-xs capitalize"
                        >
                          {ALL_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {r.replace('_', ' ')}
                            </option>
                          ))}
                        </select>
                      ) : (
                        m.role
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <span className={m.active ? 'text-emerald-300 font-medium' : 'text-rose-300'}>
                        {m.active ? 'Active' : 'Revoked'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Multi-Branch & Staff Invites (Owner Only) */}
      {canManageTeam && (
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Branches */}
          <div className="neon-card rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-base font-semibold text-white">
              <Building2 className="w-5 h-5 neon-text-cyan" aria-hidden="true" />
              <h2>Workspace Branches</h2>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                createBranchMutation.mutate();
              }}
              className="flex flex-wrap gap-2"
            >
              <input
                required
                value={branchName}
                onChange={(e) => setBranchName(e.target.value)}
                placeholder="Branch Name (e.g. Kandy Clinic)"
                className="flex-1 min-w-[160px] min-h-[40px] px-3 neon-input rounded-lg text-xs"
              />
              <input
                required
                value={branchCode}
                onChange={(e) => setBranchCode(e.target.value)}
                placeholder="Code (e.g. KDY)"
                className="w-28 min-h-[40px] px-3 neon-input rounded-lg text-xs font-mono-tabular"
              />
              <button
                type="submit"
                disabled={createBranchMutation.isPending}
                className="min-h-[40px] px-4 neon-btn-primary text-xs rounded-lg"
              >
                Add Branch
              </button>
            </form>

            <div className="divide-y divide-cyan-500/15 text-xs">
              {branchesQuery.data?.branches.map((b) => (
                <div key={b.id} className="py-2.5 flex justify-between">
                  <span className="font-medium text-white">
                    {b.name} ({b.code})
                  </span>
                  <span className="font-mono-tabular text-cyan-200/80">{b.openingHoursSummary}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Staff Invites */}
          <div className="neon-card rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-base font-semibold text-white">
              <MailPlus className="w-5 h-5 neon-text-cyan" aria-hidden="true" />
              <h2>Invite Staff Member</h2>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                inviteMutation.mutate();
              }}
              className="grid sm:grid-cols-2 gap-2.5"
            >
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="staff@clinic.lk"
                className="min-h-[40px] px-3 neon-input rounded-lg text-xs"
              />
              <input
                value={inviteName}
                onChange={(e) => setInviteName(e.target.value)}
                placeholder="Display Name"
                className="min-h-[40px] px-3 neon-input rounded-lg text-xs"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as Role)}
                className="min-h-[40px] px-3 neon-input rounded-lg text-xs capitalize"
              >
                {ALL_ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r.replace('_', ' ')}
                  </option>
                ))}
              </select>
              <select
                value={inviteBranchId || branchesQuery.data?.branches[0]?.id || ''}
                onChange={(e) => setInviteBranchId(e.target.value)}
                className="min-h-[40px] px-3 neon-input rounded-lg text-xs"
              >
                {branchesQuery.data?.branches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={inviteMutation.isPending}
                className="sm:col-span-2 min-h-[40px] px-4 neon-btn-primary text-xs rounded-lg"
              >
                Create Staff Invite Link
              </button>
            </form>

            {invitesQuery.data && invitesQuery.data.invites.length > 0 && (
              <div className="divide-y divide-cyan-500/15 text-xs">
                {invitesQuery.data.invites.map((inv) => (
                  <div key={inv.id} className="py-2.5 flex items-center justify-between gap-2">
                    <div>
                      <div className="font-medium text-white">
                        {inv.email} · {inv.role}
                      </div>
                      <div className="font-mono-tabular text-slate-400">
                        {inv.branchName} · Token: {inv.token.slice(0, 12)} · {inv.status}
                      </div>
                    </div>
                    {inv.status === 'pending' && (
                      <button
                        type="button"
                        onClick={() => revokeInviteMutation.mutate(inv.id)}
                        className="p-1.5 text-rose-300 hover:bg-rose-950/60 rounded"
                        aria-label="Revoke invite"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Active Role Permission Matrix */}
      <div className="neon-card rounded-xl p-6 space-y-3">
        <h2 className="text-base font-semibold text-white">Active Role Permission Matrix</h2>
        <div className="grid md:grid-cols-3 gap-4 text-xs">
          {ALL_ROLES.map((role) => (
            <div key={role} className="p-4 bg-[#040e22]/90 border border-cyan-500/20 rounded-lg space-y-2">
              <p className="font-semibold neon-text-cyan capitalize">{role.replace('_', ' ')}</p>
              <ul className="space-y-1 font-mono-tabular text-slate-300">
                {ROLE_PERMISSIONS[role].map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AuditPage() {
  const { activeTenantId } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ['audit', activeTenantId],
    queryFn: () => apiClient.getAuditEvents(activeTenantId!),
    enabled: Boolean(activeTenantId),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold neon-heading-glow">Audit Events</h1>
        <p className="text-sm text-slate-300">
          Redacted action traceability log (owner & manager scope only).
        </p>
      </div>

      <div className="neon-card rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-slate-400">Loading audit events...</div>
        ) : error ? (
          <div className="p-6 text-sm text-rose-300">
            Access restricted or unable to load audit events.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-cyan-500/20 bg-[#040e22]/90 text-xs font-medium text-cyan-200">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Entity</th>
                  <th className="py-3 px-4">Source</th>
                  <th className="py-3 px-4">Correlation ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-cyan-500/15 text-xs font-mono-tabular">
                {data?.events.map((ev) => (
                  <tr key={ev.id} className="hover:bg-cyan-500/5 transition-colors">
                    <td className="py-3 px-4 whitespace-nowrap text-slate-300">{ev.createdAt}</td>
                    <td className="py-3 px-4 font-medium neon-text-cyan">{ev.action}</td>
                    <td className="py-3 px-4 text-slate-200">
                      {ev.entityType} / {ev.entityId.slice(0, 8)}
                    </td>
                    <td className="py-3 px-4 text-slate-300">{ev.inputSource}</td>
                    <td className="py-3 px-4 text-slate-400">{ev.correlationId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
