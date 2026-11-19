import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowRightLeft,
  ClipboardCheck,
  Package,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient, ApiClientError } from '../lib/api-client.ts';

type StockTab = 'lots' | 'alerts' | 'stocktakes' | 'transfers';

export function PharmacyStockPage() {
  const { activeTenantId, session } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<StockTab>('lots');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Stocktake input state
  const [stocktakeNotes, setStocktakeNotes] = useState('Monthly Shelf Count');
  const [draftCounts, setDraftCounts] = useState<Record<string, { qty: number; reason: string }>>({});

  // Multi-branch transfer form state
  const [transferToBranchId, setTransferToBranchId] = useState('');
  const [transferLotKey, setTransferLotKey] = useState(''); // "productId|lotId"
  const [transferQtyBase, setTransferQtyBase] = useState(10);
  const [transferNotes, setTransferNotes] = useState('Routine branch replenishment');

  const hasPharmacistGrant =
    session?.workspace?.professionalGrants.some((g) => g.grantType === 'pharmacist' && g.active) ??
    false;

  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy-stock', activeTenantId],
    queryFn: () => apiClient.getStockSummary(activeTenantId!),
    enabled: Boolean(activeTenantId),
  });

  const alertsQuery = useQuery({
    queryKey: ['pharmacy-alerts', activeTenantId],
    queryFn: () => apiClient.getPharmacyAlerts(activeTenantId!),
    enabled: Boolean(activeTenantId),
  });

  const stocktakesQuery = useQuery({
    queryKey: ['pharmacy-stocktakes', activeTenantId],
    queryFn: () => apiClient.getStocktakes(activeTenantId!),
    enabled: Boolean(activeTenantId && tab === 'stocktakes'),
  });

  const transfersQuery = useQuery({
    queryKey: ['pharmacy-transfers', activeTenantId],
    queryFn: () => apiClient.getStockTransfers(activeTenantId!),
    enabled: Boolean(activeTenantId && tab === 'transfers'),
  });

  const branchesQuery = useQuery({
    queryKey: ['workspace-branches', activeTenantId],
    queryFn: () => apiClient.getWorkspaceBranches(activeTenantId!),
    enabled: Boolean(activeTenantId && tab === 'transfers'),
  });

  const qualityMutation = useMutation({
    mutationFn: (vars: {
      lotId: string;
      locationId: string;
      action: 'release_to_sellable' | 'place_quarantine' | 'place_recall_hold';
      reason: string;
    }) =>
      apiClient.transitionLotQuality(activeTenantId!, vars.lotId, {
        action: vars.action,
        locationId: vars.locationId,
        reason: vars.reason,
      }),
    onSuccess: () => {
      setErrorMsg(null);
      setSuccessMsg('Lot quality bucket updated and ledger movement recorded.');
      queryClient.invalidateQueries({ queryKey: ['pharmacy-stock', activeTenantId] });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-alerts', activeTenantId] });
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(
        err instanceof ApiClientError
          ? `${err.envelope.message} (${err.envelope.code})`
          : 'Unable to transition lot quality.'
      );
    },
  });

  const createStocktakeMutation = useMutation({
    mutationFn: () => apiClient.createStocktake(activeTenantId!, stocktakeNotes),
    onSuccess: () => {
      setErrorMsg(null);
      setSuccessMsg('Physical stocktake sheet created from live lot balances.');
      queryClient.invalidateQueries({ queryKey: ['pharmacy-stocktakes', activeTenantId] });
    },
    onError: (err) => {
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to start stocktake.');
    },
  });

  const submitCountsMutation = useMutation({
    mutationFn: (vars: {
      stocktakeId: string;
      lines: Array<{ id: string; systemQtyBase: number; countedQtyBase: number | null }>;
    }) =>
      apiClient.submitStocktakeCounts(
        activeTenantId!,
        vars.stocktakeId,
        vars.lines.map((l) => ({
          lineId: l.id,
          countedQtyBase: draftCounts[l.id]?.qty ?? l.countedQtyBase ?? l.systemQtyBase,
          reason: draftCounts[l.id]?.reason || 'Physical shelf count',
        }))
      ),
    onSuccess: () => {
      setErrorMsg(null);
      setSuccessMsg('Physical counts saved and variance calculated.');
      queryClient.invalidateQueries({ queryKey: ['pharmacy-stocktakes', activeTenantId] });
    },
    onError: (err) => {
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to save counts.');
    },
  });

  const reconcileStocktakeMutation = useMutation({
    mutationFn: (stocktakeId: string) => apiClient.reconcileStocktake(activeTenantId!, stocktakeId),
    onSuccess: () => {
      setErrorMsg(null);
      setSuccessMsg('Stocktake reconciled and inventory adjustments posted to append-only ledger.');
      queryClient.invalidateQueries({ queryKey: ['pharmacy-stocktakes', activeTenantId] });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-stock', activeTenantId] });
    },
    onError: (err) => {
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to reconcile stocktake.');
    },
  });

  const createTransferMutation = useMutation({
    mutationFn: () => {
      const [productId, lotId] = transferLotKey.split('|');
      return apiClient.createStockTransfer(activeTenantId!, {
        idempotencyKey: `trf-${crypto.randomUUID()}`,
        toBranchId: transferToBranchId,
        notes: transferNotes,
        lines: [{ productId, lotId, qtyBase: Number(transferQtyBase) }],
      });
    },
    onSuccess: () => {
      setErrorMsg(null);
      setSuccessMsg('Inter-branch stock transfer dispatched (status: In Transit).');
      queryClient.invalidateQueries({ queryKey: ['pharmacy-transfers', activeTenantId] });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-stock', activeTenantId] });
    },
    onError: (err) => {
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to dispatch transfer.');
    },
  });

  const receiveTransferMutation = useMutation({
    mutationFn: (vars: { transferId: string; receiveIntoSellable: boolean }) =>
      apiClient.receiveStockTransfer(activeTenantId!, vars.transferId, {
        receiveIntoSellable: vars.receiveIntoSellable,
        notes: vars.receiveIntoSellable ? 'Pharmacist verified sellable' : 'Quarantine intake',
      }),
    onSuccess: () => {
      setErrorMsg(null);
      setSuccessMsg('Transfer received cleanly.');
      queryClient.invalidateQueries({ queryKey: ['pharmacy-transfers', activeTenantId] });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-stock', activeTenantId] });
    },
    onError: (err) => {
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to receive transfer.');
    },
  });

  const alerts = alertsQuery.data;
  const sellableLots = (data?.balances ?? []).filter((b) => b.sellableOnHand > 0);
  const targetBranches = (branchesQuery.data?.branches ?? []).filter(
    (b) => b.id !== session?.workspace?.branchId
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold neon-heading-glow">
            {t('pharmacy.stockTitle')}
          </h1>
          <p className="text-sm text-slate-300">{t('pharmacy.stockDesc')}</p>
        </div>

        <div className="text-xs font-medium text-cyan-200">
          {hasPharmacistGrant
            ? 'Pharmacist Grant: Active (Quality Release Enabled)'
            : 'Pharmacist Grant: Not Held (Owner/Admin role cannot release quarantine)'}
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-[#040e22] border border-cyan-500/20 rounded-lg w-fit">
        {(
          [
            { id: 'lots', label: 'Lot Stock & Movements', Icon: Package },
            {
              id: 'alerts',
              label: `Expiry & Low-Stock Alerts (${
                (alerts?.summary.expiredCount ?? 0) +
                (alerts?.summary.expiring30Count ?? 0) +
                (alerts?.summary.lowStockCount ?? 0)
              })`,
              Icon: AlertTriangle,
            },
            { id: 'stocktakes', label: 'Physical Stocktake', Icon: ClipboardCheck },
            { id: 'transfers', label: 'Multi-Branch Transfers', Icon: ArrowRightLeft },
          ] as const
        ).map(({ id, label, Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`px-3 py-2 text-xs font-medium rounded-md inline-flex items-center gap-1.5 whitespace-nowrap transition-colors ${
              tab === id
                ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 shadow-[0_0_12px_-4px_rgba(34,211,238,0.45)]'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Icon className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>

      {errorMsg && (
        <div role="alert" className="p-3 bg-rose-950/60 border border-rose-400/50 rounded-lg text-sm text-rose-200">
          {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="p-3 bg-cyan-950/60 border border-cyan-400/40 rounded-lg text-sm text-cyan-100">
          {successMsg}
        </div>
      )}

      {/* TAB 1: Lot Balances Table & Movements */}
      {tab === 'lots' && (
        <>
          <div className="neon-card rounded-xl overflow-hidden">
            {isLoading ? (
              <div className="p-6 text-sm text-slate-400">Loading lot inventory...</div>
            ) : !data || data.balances.length === 0 ? (
              <div className="p-8 text-center text-sm text-slate-300">
                No stock lots recorded yet. Post a Goods Receipt (GRN) to receive inventory.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-cyan-500/20 bg-[#040e22]/90 font-medium text-cyan-200">
                      <th className="py-3 px-4">SKU / Medicine</th>
                      <th className="py-3 px-4">Batch & Expiry</th>
                      <th className="py-3 px-4">Location</th>
                      <th className="py-3 px-4 text-right">Sellable</th>
                      <th className="py-3 px-4 text-right">Reserved</th>
                      <th className="py-3 px-4 text-right">Available</th>
                      <th className="py-3 px-4 text-right">Quarantine</th>
                      <th className="py-3 px-4 text-right">Expired/Recall</th>
                      <th className="py-3 px-4 text-right">Quality Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cyan-500/15">
                    {data.balances.map((b) => (
                      <tr key={b.balanceId} className="hover:bg-cyan-500/5 transition-colors">
                        <td className="py-3 px-4">
                          <div className="font-semibold text-white">{b.productName}</div>
                          <div className="font-mono-tabular text-slate-400">
                            {b.skuCode} · {b.baseUnit}
                          </div>
                        </td>
                        <td className="py-3 px-4 font-mono-tabular">
                          <div className="text-white">{b.batchNumber}</div>
                          <div className="text-slate-300">
                            {b.printedExpiry} ({b.expiryPrecision}) · {b.qualityStatus}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-slate-300">{b.locationCode}</td>
                        <td className="py-3 px-4 text-right font-mono-tabular font-medium text-white">
                          {b.sellableOnHand}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-slate-400">
                          {b.reservedQty}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular font-semibold neon-text-cyan">
                          {b.availableQty}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-amber-300 font-medium">
                          {b.quarantineQty}
                        </td>
                        <td className="py-3 px-4 text-right font-mono-tabular text-rose-300">
                          {b.expiredQty + b.recalledQty}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap space-x-2">
                          {b.quarantineQty > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                qualityMutation.mutate({
                                  lotId: b.lotId,
                                  locationId: b.locationId,
                                  action: 'release_to_sellable',
                                  reason: 'Pharmacist inspection passed',
                                })
                              }
                              disabled={qualityMutation.isPending}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 neon-btn-primary rounded disabled:opacity-50"
                            >
                              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Release</span>
                            </button>
                          )}
                          {b.sellableOnHand > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                qualityMutation.mutate({
                                  lotId: b.lotId,
                                  locationId: b.locationId,
                                  action: 'place_quarantine',
                                  reason: 'Manual quality hold placed',
                                })
                              }
                              disabled={qualityMutation.isPending}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-amber-400/50 bg-amber-950/60 text-amber-200 rounded hover:bg-amber-900/60"
                            >
                              <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
                              <span>Hold</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {data && data.recentMovements.length > 0 && (
            <div className="neon-card rounded-xl p-5 space-y-3">
              <h2 className="text-base font-semibold text-white">
                Recent Append-Only Stock Movements
              </h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs font-mono-tabular">
                  <thead>
                    <tr className="border-b border-cyan-500/20 text-cyan-200">
                      <th className="py-2 px-3">Type</th>
                      <th className="py-2 px-3">Product / Batch</th>
                      <th className="py-2 px-3">Qty (Base)</th>
                      <th className="py-2 px-3">Bucket Transition</th>
                      <th className="py-2 px-3">UOM Ver</th>
                      <th className="py-2 px-3">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cyan-500/15">
                    {data.recentMovements.map((m) => (
                      <tr key={m.id}>
                        <td className="py-2 px-3 neon-text-cyan">{m.movementType}</td>
                        <td className="py-2 px-3 text-white">
                          {m.productName} ({m.batchNumber})
                        </td>
                        <td className="py-2 px-3 font-semibold text-white">{m.qtyBase}</td>
                        <td className="py-2 px-3 text-slate-300">
                          {m.fromBucket} → {m.toBucket}
                        </td>
                        <td className="py-2 px-3 text-slate-300">
                          {m.uomConversionVersion ? `v${m.uomConversionVersion}` : '—'}
                        </td>
                        <td className="py-2 px-3 font-sans text-slate-300">{m.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}

      {/* TAB 2: Near-Expiry (30/60/90d), Low-Stock & Dead-Stock Alerts Dashboard */}
      {tab === 'alerts' && alerts && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 text-xs">
            <div className="neon-card rounded-xl p-4">
              <div className="text-slate-300">Expired</div>
              <div className="text-2xl font-bold font-mono-tabular text-rose-300">
                {alerts.summary.expiredCount}
              </div>
            </div>
            <div className="neon-card rounded-xl p-4">
              <div className="text-slate-300">≤ 30 Days</div>
              <div className="text-2xl font-bold font-mono-tabular text-amber-300">
                {alerts.summary.expiring30Count}
              </div>
            </div>
            <div className="neon-card rounded-xl p-4">
              <div className="text-slate-300">31–60 Days</div>
              <div className="text-2xl font-bold font-mono-tabular text-white">
                {alerts.summary.expiring60Count}
              </div>
            </div>
            <div className="neon-card rounded-xl p-4">
              <div className="text-slate-300">61–90 Days</div>
              <div className="text-2xl font-bold font-mono-tabular text-white">
                {alerts.summary.expiring90Count}
              </div>
            </div>
            <div className="neon-card rounded-xl p-4">
              <div className="text-slate-300">Low Stock SKUs</div>
              <div className="text-2xl font-bold font-mono-tabular text-amber-300">
                {alerts.summary.lowStockCount}
              </div>
            </div>
            <div className="neon-card rounded-xl p-4">
              <div className="text-slate-300">Dead Stock SKUs</div>
              <div className="text-2xl font-bold font-mono-tabular neon-text-cyan">
                {alerts.summary.deadStockCount}
              </div>
            </div>
          </div>

          <div className="neon-card rounded-xl p-5 space-y-3">
            <h2 className="text-base font-semibold text-white">
              Near-Expiry & Expired Batches (FEFO Return Priority)
            </h2>
            {alerts.expiringLots.length === 0 ? (
              <p className="text-xs text-slate-400">No batches expiring within 90 days.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-cyan-500/20 bg-[#040e22]/90 text-cyan-200">
                      <th className="py-2.5 px-3">Medicine / Batch</th>
                      <th className="py-2.5 px-3">Expiry</th>
                      <th className="py-2.5 px-3">Bucket</th>
                      <th className="py-2.5 px-3 text-right">Qty On Hand</th>
                      <th className="py-2.5 px-3">Suggested Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cyan-500/15">
                    {alerts.expiringLots.map((lot) => (
                      <tr key={lot.lotId}>
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-white">{lot.productName}</div>
                          <div className="font-mono-tabular text-slate-400">{lot.batchNumber}</div>
                        </td>
                        <td className="py-2.5 px-3 font-mono-tabular text-slate-200">
                          {lot.printedExpiry}{' '}
                          {lot.daysUntilExpiry !== null ? `(${lot.daysUntilExpiry}d)` : ''}
                        </td>
                        <td
                          className={`py-2.5 px-3 font-semibold ${
                            lot.bucket === 'expired' ? 'text-rose-300' : 'text-amber-300'
                          }`}
                        >
                          {lot.bucket.replace('_', ' ')}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-tabular text-white">
                          {lot.sellableOnHand} {lot.baseUnit}
                        </td>
                        <td className="py-2.5 px-3 text-slate-300">{lot.suggestedAction}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="neon-card rounded-xl p-5 space-y-3">
              <h2 className="text-base font-semibold text-white">
                Low-Stock Reorder Suggestions
              </h2>
              {alerts.lowStockSkus.length === 0 ? (
                <p className="text-xs text-slate-400">All active SKUs above threshold.</p>
              ) : (
                <div className="divide-y divide-cyan-500/15 text-xs">
                  {alerts.lowStockSkus.map((s) => (
                    <div key={s.productId} className="py-2.5 flex justify-between gap-3">
                      <div>
                        <div className="font-semibold text-white">{s.productName}</div>
                        <div className="text-slate-400">
                          {s.skuCode} · Supplier: {s.manufacturer}
                        </div>
                      </div>
                      <div className="text-right font-mono-tabular">
                        <div className="text-rose-300 font-semibold">
                          {s.sellableOnHand} / {s.reorderThreshold} {s.baseUnit}
                        </div>
                        <div className="neon-text-cyan">Order +{s.suggestedOrderQty}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="neon-card rounded-xl p-5 space-y-3">
              <h2 className="text-base font-semibold text-white">Dead-Stock Candidates</h2>
              {alerts.deadStockSkus.length === 0 ? (
                <p className="text-xs text-slate-400">No slow-moving stock flagged.</p>
              ) : (
                <div className="divide-y divide-cyan-500/15 text-xs">
                  {alerts.deadStockSkus.map((s) => (
                    <div key={s.productId} className="py-2.5 space-y-1">
                      <div className="flex justify-between font-semibold text-white">
                        <span>{s.productName}</span>
                        <span className="font-mono-tabular neon-text-cyan">
                          {s.sellableOnHand} {s.baseUnit}
                        </span>
                      </div>
                      <div className="text-slate-300">{s.suggestion}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Physical Stocktake & Variance Reconciliation */}
      {tab === 'stocktakes' && (
        <div className="space-y-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createStocktakeMutation.mutate();
            }}
            className="neon-card rounded-xl p-5 flex flex-wrap items-end gap-3"
          >
            <label className="block space-y-1 flex-1 min-w-[200px]">
              <span className="text-xs font-medium text-cyan-200">Stocktake Sheet Notes</span>
              <input
                value={stocktakeNotes}
                onChange={(e) => setStocktakeNotes(e.target.value)}
                className="w-full min-h-[40px] px-3 neon-input rounded-lg text-xs"
              />
            </label>
            <button
              type="submit"
              disabled={createStocktakeMutation.isPending}
              className="min-h-[40px] px-4 neon-btn-primary text-xs rounded-lg"
            >
              Start Physical Stocktake
            </button>
          </form>

          {stocktakesQuery.data?.stocktakes.map((st) => (
            <div key={st.id} className="neon-card rounded-xl p-5 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white">
                    Stocktake {st.id.slice(0, 8)} ·{' '}
                    <span className="uppercase neon-text-cyan">{st.status}</span>
                  </div>
                  <div className="text-xs text-slate-400">{st.notes}</div>
                </div>
                {st.status === 'open' && (
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={submitCountsMutation.isPending}
                      onClick={() =>
                        submitCountsMutation.mutate({ stocktakeId: st.id, lines: st.lines })
                      }
                      className="min-h-[38px] px-3 neon-btn-secondary text-xs font-medium rounded-lg"
                    >
                      Save Physical Counts
                    </button>
                    <button
                      type="button"
                      disabled={reconcileStocktakeMutation.isPending}
                      onClick={() => reconcileStocktakeMutation.mutate(st.id)}
                      className="min-h-[38px] px-3 neon-btn-primary text-xs rounded-lg"
                    >
                      Approve & Reconcile Variance
                    </button>
                  </div>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-cyan-500/20 bg-[#040e22]/90 text-cyan-200">
                      <th className="py-2 px-3">Product / Batch</th>
                      <th className="py-2 px-3 text-right">System Qty</th>
                      <th className="py-2 px-3 text-right">Physical Count</th>
                      <th className="py-2 px-3 text-right">Variance</th>
                      <th className="py-2 px-3">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cyan-500/15">
                    {st.lines.map((line) => {
                      const val =
                        draftCounts[line.id]?.qty ?? line.countedQtyBase ?? line.systemQtyBase;
                      const variance =
                        line.varianceQtyBase !== null
                          ? line.varianceQtyBase
                          : val - line.systemQtyBase;
                      return (
                        <tr key={line.id}>
                          <td className="py-2 px-3 font-medium text-white">
                            {line.productName} ·{' '}
                            <span className="font-mono-tabular text-slate-400">
                              {line.batchNumber}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right font-mono-tabular text-slate-200">
                            {line.systemQtyBase}
                          </td>
                          <td className="py-2 px-3 text-right">
                            {st.status === 'open' ? (
                              <input
                                type="number"
                                min={0}
                                value={val}
                                onChange={(e) =>
                                  setDraftCounts((prev) => ({
                                    ...prev,
                                    [line.id]: {
                                      qty: Number(e.target.value),
                                      reason: prev[line.id]?.reason ?? line.reason ?? '',
                                    },
                                  }))
                                }
                                className="w-20 min-h-[32px] px-2 neon-input rounded font-mono-tabular text-right"
                              />
                            ) : (
                              <span className="font-mono-tabular text-white">{line.countedQtyBase}</span>
                            )}
                          </td>
                          <td
                            className={`py-2 px-3 text-right font-mono-tabular font-semibold ${
                              variance < 0
                                ? 'text-rose-300'
                                : variance > 0
                                  ? 'neon-text-cyan'
                                  : 'text-slate-400'
                            }`}
                          >
                            {variance > 0 ? `+${variance}` : variance}
                          </td>
                          <td className="py-2 px-3 text-slate-300">{line.reason || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 4: Multi-Branch Stock Transfers */}
      {tab === 'transfers' && (
        <div className="space-y-6">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createTransferMutation.mutate();
            }}
            className="neon-card rounded-xl p-5 space-y-4"
          >
            <h2 className="text-base font-semibold text-white">
              Dispatch Inter-Branch Stock Transfer (Quarantine-Safe Intake)
            </h2>
            {targetBranches.length === 0 ? (
              <p className="text-xs text-slate-300">
                Add a second branch under Team & Branches to dispatch inter-branch stock transfers.
              </p>
            ) : (
              <div className="grid sm:grid-cols-4 gap-3 items-end">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-200">Destination Branch *</span>
                  <select
                    required
                    value={transferToBranchId}
                    onChange={(e) => setTransferToBranchId(e.target.value)}
                    className="w-full min-h-[40px] px-2.5 neon-input rounded-lg text-xs"
                  >
                    <option value="">Select branch...</option>
                    {targetBranches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.code})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-200">Sellable Lot *</span>
                  <select
                    required
                    value={transferLotKey}
                    onChange={(e) => setTransferLotKey(e.target.value)}
                    className="w-full min-h-[40px] px-2.5 neon-input rounded-lg text-xs"
                  >
                    <option value="">Select batch...</option>
                    {sellableLots.map((b) => (
                      <option key={b.lotId} value={`${b.productId}|${b.lotId}`}>
                        {b.productName} ({b.batchNumber} · Avail {b.availableQty})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-200">Qty (Base) *</span>
                  <input
                    type="number"
                    min={1}
                    required
                    value={transferQtyBase}
                    onChange={(e) => setTransferQtyBase(Number(e.target.value))}
                    className="w-full min-h-[40px] px-2.5 neon-input rounded-lg text-xs font-mono-tabular"
                  />
                </label>
                <button
                  type="submit"
                  disabled={createTransferMutation.isPending}
                  className="min-h-[40px] px-4 neon-btn-primary text-xs rounded-lg"
                >
                  Dispatch Transfer
                </button>
              </div>
            )}
          </form>

          <div className="neon-card rounded-xl p-5 space-y-3">
            <h2 className="text-base font-semibold text-white">Branch Transfer Notes</h2>
            {!transfersQuery.data || transfersQuery.data.transfers.length === 0 ? (
              <p className="text-xs text-slate-400">No inter-branch transfers dispatched yet.</p>
            ) : (
              <div className="divide-y divide-cyan-500/15 text-xs">
                {transfersQuery.data.transfers.map((trf) => (
                  <div key={trf.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                    <div className="space-y-1">
                      <div className="font-mono-tabular font-semibold text-white">
                        {trf.transferNumber} · {trf.fromBranchName} → {trf.toBranchName} ·{' '}
                        <span className="uppercase neon-text-cyan">{trf.status}</span>
                      </div>
                      <div className="text-slate-300">
                        {trf.lines
                          .map((l) => `${l.productName} (${l.batchNumber}): ${l.qtyBase} base`)
                          .join(', ')}
                      </div>
                    </div>
                    {trf.status === 'in_transit' && (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            receiveTransferMutation.mutate({
                              transferId: trf.id,
                              receiveIntoSellable: false,
                            })
                          }
                          className="min-h-[36px] px-3 bg-amber-950/70 border border-amber-400/50 text-amber-200 text-xs font-medium rounded-lg hover:bg-amber-900/70"
                        >
                          Receive to Quarantine
                        </button>
                        {hasPharmacistGrant && (
                          <button
                            type="button"
                            onClick={() =>
                              receiveTransferMutation.mutate({
                                transferId: trf.id,
                                receiveIntoSellable: true,
                              })
                            }
                            className="min-h-[36px] px-3 neon-btn-primary text-xs rounded-lg"
                          >
                            Receive to Sellable (Pharmacist)
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
