import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { CreditCard, KeyRound, Layers, Lock, Sliders } from 'lucide-react';
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

const DEPARTMENT_ADDONS = [
  {
    key: 'accounts.ledger',
    title: 'Accounts Pack (P&L, OpEx, AR/AP)',
    desc: 'Daily Operating Expenses, True Daily Net P&L, Patient/Customer Credit Aging & Supplier Payables.',
  },
  {
    key: 'purchasing.orders',
    title: 'Purchasing Pack (PO → GRN & Debit Notes)',
    desc: 'Draft Purchase Orders from Low Stock, Owner Approval, 1-Click GRN Conversion & Supplier Returns.',
  },
  {
    key: 'hr.management',
    title: 'HR & Payroll Pack (Shift PIN + EPF/ETF)',
    desc: 'Staff Attendance, Leave Approvals, Sri Lanka 8%/12% EPF & 3% ETF Monthly Payroll & Commission Sync.',
  },
  {
    key: 'admin.operations',
    title: 'Admin Ops & Compliance Vault',
    desc: 'Lab/Blood Test Orders (Clinic), Cold-Chain Fridge Logs (Pharmacy) & NMRA/SLMC License Alerts.',
  },
] as const;

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
    mutationFn: (payload: { productMode: ProductMode; extraCapabilities?: Record<string, boolean> }) =>
      apiClient.updateProductMode(activeTenantId!, payload),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg('Updated workspace product mode and departmental add-on packs.');
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

  const activeCaps = capQuery.data?.capabilities ?? {};

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold neon-heading-glow">
            {t('platform.title')}
          </h1>
          <p className="text-sm text-cyan-100/75">{t('platform.desc')}</p>
        </div>
        <Link
          to="/billing"
          className="min-h-[42px] px-4 rounded-lg text-xs font-medium neon-btn-secondary inline-flex items-center gap-2 whitespace-nowrap shrink-0"
        >
          <CreditCard className="w-4 h-4 text-cyan-300" aria-hidden="true" />
          <span>{t('nav.billing')}</span>
        </Link>
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
        <div className="p-3.5 bg-cyan-950/70 border border-cyan-400/50 rounded-xl text-sm text-cyan-200">
          {successMsg}
        </div>
      )}

      {/* 1. Product Mode Selector */}
      <div className="neon-card rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 text-base font-semibold text-white">
          <Sliders className="w-5 h-5 text-cyan-300" aria-hidden="true" />
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
                onClick={() => modeMutation.mutate({ productMode: opt.mode })}
                className={`p-4 rounded-xl border text-left transition-all space-y-1 ${
                  active
                    ? 'neon-card-glow text-white'
                    : 'bg-[#040e22]/80 border-cyan-500/20 hover:border-cyan-400/45 text-slate-200'
                }`}
              >
                <div className={`text-sm font-semibold ${active ? 'neon-text-cyan' : 'text-white'}`}>
                  {opt.label} {active ? '(Active)' : ''}
                </div>
                <div className="text-xs text-slate-300">{opt.summary}</div>
              </button>
            );
          })}
        </div>

        {/* Departmental Add-On Packs */}
        <div className="pt-3 border-t border-cyan-500/20 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Layers className="w-4 h-4 text-cyan-300" aria-hidden="true" />
            <h3>Departmental Add-On Packs (Toggle Individually)</h3>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            {DEPARTMENT_ADDONS.map((addon) => {
              const enabled = Boolean(activeCaps[addon.key]);
              return (
                <div
                  key={addon.key}
                  className={`p-4 rounded-xl border flex items-start justify-between gap-3 ${
                    enabled
                      ? 'bg-[#071936]/90 border-cyan-400/40'
                      : 'bg-[#040e22]/70 border-slate-700/60'
                  }`}
                >
                  <div className="space-y-1">
                    <div className="text-sm font-semibold text-white">{addon.title}</div>
                    <p className="text-xs text-slate-300 leading-relaxed">{addon.desc}</p>
                  </div>
                  <button
                    type="button"
                    disabled={modeMutation.isPending || !capQuery.data?.productMode}
                    onClick={() =>
                      modeMutation.mutate({
                        productMode: capQuery.data!.productMode,
                        extraCapabilities: { [addon.key]: !enabled },
                      })
                    }
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap shrink-0 ${
                      enabled ? 'neon-btn-primary' : 'neon-btn-secondary'
                    }`}
                  >
                    {enabled ? 'Enabled' : 'Enable'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Mandatory Non-Disableable Safety Controls */}
        <div className="p-4 bg-[#040e22]/90 border border-cyan-500/20 rounded-lg space-y-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-cyan-200">
            <Lock className="w-4 h-4 text-cyan-300" aria-hidden="true" />
            <span>Non-Disableable Safety Controls (Enforced Server-Side)</span>
          </div>
          <div className="flex flex-wrap gap-3 font-mono-tabular text-xs text-emerald-300">
            {capQuery.data?.mandatorySafetyCapabilities.map((cap) => (
              <span key={cap}>{cap}: LOCKED_ON</span>
            ))}
          </div>
        </div>
      </div>

      {/* 2. Professional Authority Grants */}
      <div className="neon-card rounded-xl p-6 space-y-4">
        <div className="flex items-center gap-2 text-base font-semibold text-white">
          <KeyRound className="w-5 h-5 text-cyan-300" aria-hidden="true" />
          <h2>Professional Authority Grants (Pharmacist / Clinician)</h2>
        </div>
        <p className="text-xs text-slate-300">
          Holding an Owner or Manager admin role does not grant pharmacist release authority. Issue
          an explicit grant with registration reference below.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            grantMutation.mutate();
          }}
          className="grid sm:grid-cols-4 gap-3 items-end"
        >
          <label className="block space-y-1">
            <span className="text-xs font-medium text-cyan-100/80">Staff Member *</span>
            <select
              required
              value={grantUserId}
              onChange={(e) => setGrantUserId(Number(e.target.value))}
              className="w-full min-h-[44px] px-3 rounded-lg text-sm neon-input"
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
            <span className="text-xs font-medium text-cyan-100/80">Authority Type *</span>
            <select
              value={grantType}
              onChange={(e) => setGrantType(e.target.value as 'pharmacist' | 'clinician')}
              className="w-full min-h-[44px] px-3 rounded-lg text-sm neon-input"
            >
              <option value="pharmacist">Pharmacist (Quality Release / Rx Gate)</option>
              <option value="clinician">Clinician (Prescribing / Signing)</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-cyan-100/80">SLMC / NMRA License Ref *</span>
            <input
              required
              value={licenseNumber}
              onChange={(e) => setLicenseNumber(e.target.value)}
              placeholder="SLMC-PH-4821"
              className="w-full min-h-[44px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
            />
          </label>
          <button
            type="submit"
            disabled={grantMutation.isPending}
            className="min-h-[44px] px-4 text-sm rounded-lg neon-btn-primary"
          >
            Issue Grant
          </button>
        </form>

        <div className="overflow-x-auto pt-2">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-cyan-500/20 text-cyan-200/75">
                <th className="py-2.5 px-3">Staff Member</th>
                <th className="py-2.5 px-3">Type</th>
                <th className="py-2.5 px-3">License Ref</th>
                <th className="py-2.5 px-3">State</th>
                <th className="py-2.5 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-cyan-500/15">
              {grantsQuery.data?.grants.map((g) => (
                <tr key={g.id} className="hover:bg-cyan-950/20">
                  <td className="py-2.5 px-3 font-medium text-white">
                    {g.userName || g.userEmail}
                  </td>
                  <td className="py-2.5 px-3 capitalize text-slate-300">{g.grantType}</td>
                  <td className="py-2.5 px-3 font-mono-tabular text-cyan-300">{g.licenseNumber}</td>
                  <td className="py-2.5 px-3">
                    <span className={g.active ? 'text-emerald-300' : 'text-slate-500'}>
                      {g.active ? 'Active' : 'Revoked'}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    {g.active && (
                      <button
                        type="button"
                        onClick={() => revokeMutation.mutate(g.id)}
                        className="px-2.5 py-1 text-rose-300 border border-rose-400/40 rounded hover:bg-rose-950/50"
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
