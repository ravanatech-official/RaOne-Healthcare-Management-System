import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ShieldAlert, ShieldCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient, ApiClientError } from '../lib/api-client.ts';

export function PharmacyStockPage() {
  const { activeTenantId, session } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const hasPharmacistGrant =
    session?.workspace?.professionalGrants.some((g) => g.grantType === 'pharmacist' && g.active) ??
    false;

  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy-stock', activeTenantId],
    queryFn: () => apiClient.getStockSummary(activeTenantId!),
    enabled: Boolean(activeTenantId),
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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold text-slate-900">
            {t('pharmacy.stockTitle')}
          </h1>
          <p className="text-sm text-slate-600">
            {t('pharmacy.stockDesc')}
          </p>
        </div>

        <div className="text-xs font-medium text-slate-700">
          {hasPharmacistGrant
            ? 'Pharmacist Grant: Active (Quality Release Enabled)'
            : 'Pharmacist Grant: Not Held (Owner/Admin role cannot release quarantine)'}
        </div>
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

      {/* Lot Balances Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-slate-500">Loading lot inventory...</div>
        ) : !data || data.balances.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-600">
            No stock lots recorded yet. Post a Goods Receipt (GRN) to receive inventory.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 font-medium text-slate-600">
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
              <tbody className="divide-y divide-slate-200">
                {data.balances.map((b) => (
                  <tr key={b.balanceId}>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900">{b.productName}</div>
                      <div className="font-mono-tabular text-slate-500">
                        {b.skuCode} · {b.baseUnit}
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono-tabular">
                      <div className="text-slate-900">{b.batchNumber}</div>
                      <div className="text-slate-600">
                        {b.printedExpiry} ({b.expiryPrecision}) · {b.qualityStatus}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-700">{b.locationCode}</td>
                    <td className="py-3 px-4 text-right font-mono-tabular font-medium text-slate-900">
                      {b.sellableOnHand}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-slate-600">
                      {b.reservedQty}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular font-semibold text-teal-800">
                      {b.availableQty}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-amber-800 font-medium">
                      {b.quarantineQty}
                    </td>
                    <td className="py-3 px-4 text-right font-mono-tabular text-red-700">
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
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-teal-700 text-white rounded hover:bg-teal-800 disabled:opacity-50"
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
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 border border-amber-300 bg-amber-50 text-amber-900 rounded hover:bg-amber-100"
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

      {/* Immutable Stock Movements */}
      {data && data.recentMovements.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h2 className="text-base font-semibold text-slate-900">Recent Append-Only Stock Movements</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs font-mono-tabular">
              <thead>
                <tr className="border-b border-slate-200 text-slate-600">
                  <th className="py-2 px-3">Type</th>
                  <th className="py-2 px-3">Product / Batch</th>
                  <th className="py-2 px-3">Qty (Base)</th>
                  <th className="py-2 px-3">Bucket Transition</th>
                  <th className="py-2 px-3">UOM Ver</th>
                  <th className="py-2 px-3">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recentMovements.map((m) => (
                  <tr key={m.id}>
                    <td className="py-2 px-3 text-slate-900">{m.movementType}</td>
                    <td className="py-2 px-3">
                      {m.productName} ({m.batchNumber})
                    </td>
                    <td className="py-2 px-3 font-semibold">{m.qtyBase}</td>
                    <td className="py-2 px-3">
                      {m.fromBucket} → {m.toBucket}
                    </td>
                    <td className="py-2 px-3">{m.uomConversionVersion ? `v${m.uomConversionVersion}` : '—'}</td>
                    <td className="py-2 px-3 font-sans text-slate-700">{m.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
