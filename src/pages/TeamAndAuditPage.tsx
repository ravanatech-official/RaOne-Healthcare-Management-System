import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient } from '../lib/api-client.ts';
import { ROLE_PERMISSIONS } from '../contracts/api.ts';

export function TeamPage() {
  const { activeTenantId, session } = useAuth();
  const { data, isLoading, error } = useQuery({
    queryKey: ['team', activeTenantId],
    queryFn: () => apiClient.getTeamMembers(activeTenantId!),
    enabled: Boolean(activeTenantId),
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold text-slate-900">Team & Role Permissions</h1>
        <p className="text-sm text-slate-600">
          Server-enforced access roles for {session?.workspace?.tenantName}.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-slate-500">Loading members...</div>
        ) : error ? (
          <div className="p-6 text-sm text-red-700">Unable to load team members.</div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                <th className="py-3 px-4">Staff Member</th>
                <th className="py-3 px-4">Email</th>
                <th className="py-3 px-4">Branch</th>
                <th className="py-3 px-4">Role</th>
                <th className="py-3 px-4">State</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {data?.members.map((m) => (
                <tr key={m.membershipId}>
                  <td className="py-3 px-4 font-medium text-slate-900">{m.displayName || 'Staff'}</td>
                  <td className="py-3 px-4 text-slate-600">{m.email}</td>
                  <td className="py-3 px-4 text-slate-600">{m.branchName}</td>
                  <td className="py-3 px-4 capitalize font-medium text-slate-900">{m.role}</td>
                  <td className="py-3 px-4 text-slate-700">{m.active ? 'Active' : 'Revoked'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Active Role Permission Matrix</h2>
        <div className="grid md:grid-cols-3 gap-4 text-xs">
          {(['owner', 'manager', 'receptionist', 'cashier', 'stock_keeper', 'accountant'] as const).map(
            (role) => (
              <div key={role} className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                <p className="font-semibold text-slate-900 capitalize">{role.replace('_', ' ')}</p>
                <ul className="space-y-1 font-mono-tabular text-slate-600">
                  {ROLE_PERMISSIONS[role].map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )
          )}
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
        <h1 className="font-display text-2xl font-bold text-slate-900">Audit Events</h1>
        <p className="text-sm text-slate-600">
          Redacted action traceability log (owner & manager scope only).
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-slate-500">Loading audit events...</div>
        ) : error ? (
          <div className="p-6 text-sm text-red-700">
            Access restricted or unable to load audit events.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Action</th>
                  <th className="py-3 px-4">Entity</th>
                  <th className="py-3 px-4">Source</th>
                  <th className="py-3 px-4">Correlation ID</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs font-mono-tabular">
                {data?.events.map((ev) => (
                  <tr key={ev.id}>
                    <td className="py-3 px-4 whitespace-nowrap text-slate-600">{ev.createdAt}</td>
                    <td className="py-3 px-4 font-medium text-slate-900">{ev.action}</td>
                    <td className="py-3 px-4 text-slate-700">
                      {ev.entityType} / {ev.entityId.slice(0, 8)}
                    </td>
                    <td className="py-3 px-4 text-slate-600">{ev.inputSource}</td>
                    <td className="py-3 px-4 text-slate-500">{ev.correlationId}</td>
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
