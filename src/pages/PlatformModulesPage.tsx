import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { KeyRound, Lock, Sliders } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient, ApiClientError } from '../lib/api-client.ts';
import type { ProductMode } from '../contracts/api.ts';

const MODE_OPTIONS: Array<{ mode: ProductMode; label: string; summary: string }> = [
  { mode: 'clinic_only', label: 'Clinic Only', summary: 'Appointments, attendance, clinic collections' },
  {
    mode: 'pharmacy_inventory_only',
    label: 'Pharmacy Inventory Only',
    summary: 'Catalogue, GRN receiving, expiry/quarantine & stock ledger',
  },
  {
    mode: 'pharmacy_retail_only',
    label: 'Pharmacy Retail Only',
    summary: 'Pharmacy POS + automatic inventory/catalogue dependency closure',
  },
  { mode: 'combo', label: 'Clinic + Pharmacy Combo', summary: 'Full combined Clinic & Pharmacy ERP' },
];

export function PlatformModulesPage() {
  const { activeTenantId, refetchSession } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [grantUserId, setGrantUserId] = useState<number | ''>('');
  const [grantType, setGrantType] = useState<'pharmacist' | 'clinician'>('pharmacist');
  const [licenseNumber, setLicenseNumber] = useState('');

  const capQuery = useQuery({
    queryKey: ['platform-capabilities', activeTenantId],
    queryFn: () => apiClient.getCapabilities(activeTenantId!),
    enabled: Boolean(activeTenantId),
  });

  const teamQuery = useQuery({
    queryKey: ['team', activeTenantId],
    queryFn: () => apiClient.getTeamMembers(activeTenantId!),
    enabled: Boolean(activeTenantId),
  });

  const grantsQuery = useQuery({
    queryKey: ['platform-grants', activeTenantId],
    queryFn: () => apiClient.getProfessionalGrants(activeTenantId!),
    enabled: Boolean(activeTenantId),
  });

  const modeMutation = useMutation({
    mutationFn: (productMode: ProductMode) =>
      apiClient.updateProductMode(activeTenantId!, { productMode }),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg('Updated workspace product mode and capability entitlements.');
      await queryClient.invalidateQueries({ queryKey: ['platform-capabilities', activeTenantId] });
      await refetchSession();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to switch mode.');
    },
  });

  const grantMutation = useMutation({
    mutationFn: () =>
      apiClient.grantProfessionalAuthority(activeTenantId!, {
        userId: Number(grantUserId),
        grantType,
        licenseNumber: licenseNumber.trim(),
      }),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg('Issued professional authority grant.');
      setLicenseNumber('');
      await queryClient.invalidateQueries({ queryKey: ['platform-grants', activeTenantId] });
      await refetchSession();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to issue grant.');
    },
  });

  const revokeMutation = useMutation({
    mutationFn: (grantId: string) => apiClient.revokeProfessionalGrant(activeTenantId!, grantId),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg('Revoked professional authority grant immediately.');
      await queryClient.invalidateQueries({ queryKey: ['platform-grants', activeTenantId] });
      await refetchSession();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to revoke grant.');
    },
  });

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold text-slate-900">
          {t('platform.title')}
        </h1>
        <p className="text-sm text-slate-600">
          {t('platform.desc')}
        </p>
      </div>

      {errorMsg && (
        <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-800">
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="p-3 bg-teal-50 border border-teal-200 rounded-lg text-sm text-teal-900">
          {successMsg}
        </div>
      )}

      {/* 1. Product Mode Selector */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Sliders className="w-5 h-5 text-teal-700" aria-hidden="true" />
          <h2>Active Product Package Mode</h2>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          {MODE_OPTIONS.map((opt) => {
            const active = capQuery.data?.productMode === opt.mode;
            return (
              <button
                key={opt.mode}
                type="button"
                disabled={modeMutation.isPending}
                onClick={() => modeMutation.mutate(opt.mode)}
                className={`p-4 rounded-lg border text-left transition-colors space-y-1 ${
                  active
                    ? 'border-teal-700 bg-teal-50 text-teal-950'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-800'
                }`}
              >
                <div className="text-sm font-semibold">
                  {opt.label} {active ? '(Active)' : ''}
                </div>
                <div className="text-xs text-slate-600">{opt.summary}</div>
              </button>
            );
          })}
        </div>

        {/* Mandatory Non-Disableable Safety Controls */}
        <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-900">
            <Lock className="w-4 h-4 text-slate-700" aria-hidden="true" />
            <span>Non-Disableable Safety Controls (Enforced Server-Side)</span>
          </div>
          <div className="flex flex-wrap gap-3 font-mono-tabular text-xs text-slate-700">
            {capQuery.data?.mandatorySafetyCapabilities.map((cap) => (
              <span key={cap}>{cap}: LOCKED_ON</span>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Professional Authority Grants (Owner role !== Pharmacist/Clinician) */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <KeyRound className="w-5 h-5 text-teal-700" aria-hidden="true" />
          <h2>Professional Authority Grants (Pharmacist / Clinician)</h2>
        </div>
        <p className="text-xs text-slate-600">
          Holding an Owner or Manager admin role does not grant pharmacist release authority. Issue an explicit grant with registration reference below.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            grantMutation.mutate();
          }}
          className="grid sm:grid-cols-4 gap-3 items-end"
        >
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Staff Member *</span>
            <select
              required
              value={grantUserId}
              onChange={(e) => setGrantUserId(Number(e.target.value))}
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value="">Select staff...</option>
              {teamQuery.data?.members.map((m) => (
                <option key={m.membershipId} value={m.userId}>
                  {m.displayName || m.email} ({m.role})
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Authority Type *</span>
            <select
              value={grantType}
              onChange={(e) => setGrantType(e.target.value as 'pharmacist' | 'clinician')}
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value="pharmacist">Pharmacist (Quality Release / Rx Gate)</option>
              <option value="clinician">Clinician (Prescribing / Signing)</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">SLMC / NMRA License Ref *</span>
            <input
              required
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
              placeholder="SLMC-PH-4821"
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm font-mono-tabular"
            />
          </label>
          <button
            type="submit"
            disabled={grantMutation.isPending}
            className="min-h-[44px] px-4 bg-teal-700 hover:bg-teal-800 text-white text-sm font-medium rounded-lg"
          >
            Issue Grant
          </button>
        </form>

        <div className="overflow-x-auto pt-2">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                <th className="py-2.5 px-3">Staff Member</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">License Ref</th>
                <th className="py-2.5 px-3">State</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {grantsQuery.data?.grants.map((g) => (
                <tr key={g.id}>
                  <td className="py-2.5 px-3 font-medium text-slate-900">
                    {g.userName || g.userEmail}
                  </td>
                  <td className="py-2.5 px-3 capitalize">{g.grantType}</td>
                  <td className="py-2.5 px-3 font-mono-tabular">{g.licenseNumber}</td>
                  <td className="py-2.5 px-3">{g.active ? 'Active' : 'Revoked'}</td>
                  <td className="py-2.5 px-3 text-right">
                    {g.active && (
                      <button
                        type="button"
                        onClick={() => revokeMutation.mutate(g.id)}
                        className="px-2.5 py-1 text-red-700 border border-red-200 rounded hover:bg-red-50"
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
