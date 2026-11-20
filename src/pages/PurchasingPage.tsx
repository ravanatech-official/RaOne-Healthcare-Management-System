import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  CheckCircle2,
  ClipboardCheck,
  FileWarning,
  PackagePlus,
  Printer,
  ShoppingCart,
  Sparkles,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient, ApiClientError, formatLkrMinor } from '../lib/api-client.ts';

type TabId = 'orders' | 'debit_notes';

export function PurchasingPage() {
  const { activeTenantId, session } = useAuth();
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const isSinhala = i18n.language !== 'en-LK';

  const canManagePurchasing =
    (session?.workspace?.permissions.includes('purchasing.write') ||
      session?.workspace?.permissions.includes('purchasing.approve')) ??
    false;

  const [tab, setTab] = useState<TabId>('orders');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // New PO state
  const [supplierId, setSupplierId] = useState('');
  const [expectedDate, setExpectedDate] = useState('');
  const [poNotes, setPoNotes] = useState('');
  const [productId, setProductId] = useState('');
  const [packVariantId, setPackVariantId] = useState('');
  const [orderedPacks, setOrderedPacks] = useState('10');
  const [packCostLkr, setPackCostLkr] = useState('450');

  // Convert to GRN inline panel
  const [convertingPoId, setConvertingPoId] = useState<string | null>(null);
  const [batchNumber, setBatchNumber] = useState('BATCH-PO-01');
  const [printedExpiry, setPrintedExpiry] = useState('2027-12-31');
  const [releaseImmediately, setReleaseImmediately] = useState(true);

  // Debit Note state
  const [dnSupplierId, setDnSupplierId] = useState('');
  const [dnBalanceId, setDnBalanceId] = useState('');
  const [dnQtyBase, setDnQtyBase] = useState('10');
  const [dnReason, setDnReason] = useState<
    'near_expiry' | 'damaged' | 'overcharged' | 'dead_stock'
  >('near_expiry');
  const [dnAmountLkr, setDnAmountLkr] = useState('1500');
  const [dnNotes, setDnNotes] = useState('');

  const purchasingQuery = useQuery({
    queryKey: ['purchasing-overview', activeTenantId],
    queryFn: () => apiClient.getPurchasingOverview(activeTenantId!),
    enabled: Boolean(activeTenantId),
  });

  const suppliersQuery = useQuery({
    queryKey: ['pharmacy-suppliers', activeTenantId],
    queryFn: () => apiClient.getSuppliers(activeTenantId!),
    enabled: Boolean(activeTenantId),
  });

  const catalogueQuery = useQuery({
    queryKey: ['pharmacy-catalogue', activeTenantId],
    queryFn: () => apiClient.getCatalogueProducts(activeTenantId!),
    enabled: Boolean(activeTenantId),
  });

  const alertsQuery = useQuery({
    queryKey: ['pharmacy-alerts', activeTenantId],
    queryFn: () => apiClient.getPharmacyAlerts(activeTenantId!),
    enabled: Boolean(activeTenantId),
  });

  const stockQuery = useQuery({
    queryKey: ['pharmacy-stock', activeTenantId],
    queryFn: () => apiClient.getStockSummary(activeTenantId!),
    enabled: Boolean(activeTenantId),
  });

  const selectedProduct = useMemo(
    () => catalogueQuery.data?.items.find((p) => p.id === productId),
    [catalogueQuery.data?.items, productId]
  );

  const selectedLotBalance = useMemo(
    () => stockQuery.data?.balances.find((b) => b.balanceId === dnBalanceId),
    [stockQuery.data?.balances, dnBalanceId]
  );

  const invalidateAll = async () => {
    await queryClient.invalidateQueries({ queryKey: ['purchasing-overview', activeTenantId] });
    await queryClient.invalidateQueries({ queryKey: ['pharmacy-stock', activeTenantId] });
    await queryClient.invalidateQueries({ queryKey: ['pharmacy-grns', activeTenantId] });
    await queryClient.invalidateQueries({ queryKey: ['accounts-overview', activeTenantId] });
  };

  const createPoMutation = useMutation({
    mutationFn: () =>
      apiClient.createPurchaseOrder(activeTenantId!, {
        supplierId,
        expectedDate: expectedDate || undefined,
        notes: poNotes.trim(),
        lines: [
          {
            productId,
            packVariantId,
            orderedPacks: Number(orderedPacks),
            estimatedUnitPackCostMinor: Math.round(Number(packCostLkr || 0) * 100),
          },
        ],
      }),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg('Purchase Order drafted. Owner/Manager can approve and convert to GRN.');
      setPoNotes('');
      await invalidateAll();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to create PO.');
    },
  });

  const approvePoMutation = useMutation({
    mutationFn: (poId: string) => apiClient.approvePurchaseOrder(activeTenantId!, poId),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg('Purchase Order approved — ready to send to supplier or convert into GRN.');
      await invalidateAll();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to approve PO.');
    },
  });

  const convertPoMutation = useMutation({
    mutationFn: (poId: string) =>
      apiClient.convertPoToGrn(activeTenantId!, poId, {
        batchNumber: batchNumber.trim(),
        printedExpiry,
        releaseImmediately,
        notes: '1-Click PO to GRN receipt',
      }),
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg('PO converted to GRN and batch stock posted!');
      setConvertingPoId(null);
      await invalidateAll();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(
        err instanceof ApiClientError ? err.envelope.message : 'Unable to convert PO to GRN.'
      );
    },
  });

  const debitNoteMutation = useMutation({
    mutationFn: () => {
      if (!selectedLotBalance) throw new Error('Select a stock batch to return.');
      return apiClient.createSupplierDebitNote(activeTenantId!, {
        supplierId: dnSupplierId,
        productId: selectedLotBalance.productId,
        lotId: selectedLotBalance.lotId,
        qtyBase: Number(dnQtyBase),
        reason: dnReason,
        amountLkr: Number(dnAmountLkr),
        notes: dnNotes.trim(),
      });
    },
    onSuccess: async () => {
      setErrorMsg(null);
      setSuccessMsg('Supplier Debit Note issued — batch adjusted & supplier AP credited.');
      setDnNotes('');
      await invalidateAll();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(
        err instanceof ApiClientError ? err.envelope.message : 'Unable to issue debit note.'
      );
    },
  });

  const autoDraftMutation = useMutation({
    mutationFn: () => apiClient.generateAutoDraftPos(activeTenantId!),
    onSuccess: async (res) => {
      setErrorMsg(null);
      setSuccessMsg(
        res.createdCount > 0
          ? `Velocity Engine generated ${res.createdCount} supplier-grouped Draft Purchase Order(s).`
          : 'All SKUs are currently above their configured Reorder Points.'
      );
      await invalidateAll();
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(
        err instanceof Error ? err.message : 'Unable to auto-generate draft purchase orders.'
      );
    },
  });

  const overview = purchasingQuery.data?.overview;
  const lowStockAlerts = alertsQuery.data?.lowStockSkus ?? [];

  const prefillFromLowStock = (prodId: string) => {
    const prod = catalogueQuery.data?.items.find((p) => p.id === prodId);
    if (!prod) return;
    setProductId(prod.id);
    if (prod.variants[0]) {
      setPackVariantId(prod.variants[0].id);
    }
    if (!supplierId && suppliersQuery.data?.suppliers[0]) {
      setSupplierId(suppliersQuery.data.suppliers[0].id);
    }
    setPoNotes(`Low-stock reorder for ${prod.displayName}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 no-print">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold neon-heading-glow">
            {isSinhala
              ? 'මිලදී ගැනීම් (Purchasing) — PO සහ ආපසු යැවීම්'
              : 'Purchasing Department — Purchase Orders & Supplier Returns'}
          </h1>
          <p className="text-sm text-cyan-100/75">
            {isSinhala
              ? 'අඩු තොග ලැයිස්තුවෙන්ම Purchase Order හදන්න, Approve කරන්න, බඩු ආවම 1-Click GRN කරන්න, සහ කල් ඉකුත් බෙහෙත් ආපසු යවන්න.'
              : 'Draft POs directly from low-stock alerts, approve orders, convert into GRN in 1 click, and issue supplier debit notes.'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => window.print()}
          className="min-h-[40px] px-4 rounded-lg text-xs font-medium neon-btn-secondary inline-flex items-center gap-1.5"
        >
          <Printer className="w-4 h-4" aria-hidden="true" />
          <span>Print PO Summary</span>
        </button>
      </div>

      {/* Tabs */}
      <div
        role="tablist"
        aria-label="Purchasing tabs"
        className="flex flex-wrap gap-2 p-1.5 bg-[#051126] border border-cyan-500/25 rounded-xl w-fit no-print"
      >
        {[
          { id: 'orders' as const, label: 'Purchase Orders (PO → GRN)', Icon: ShoppingCart },
          { id: 'debit_notes' as const, label: 'Supplier Debit Notes', Icon: FileWarning },
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

      {tab === 'orders' && (
        <div className="space-y-6">
          {/* Low Stock Quick-Draft Strip */}
          {lowStockAlerts.length > 0 && (
            <section className="neon-card rounded-xl p-4 space-y-2.5 border-amber-400/40 no-print">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-amber-300">
                  Low-Stock Alert Reorder Suggestions ({lowStockAlerts.length})
                </div>
                {canManagePurchasing && (
                  <button
                    type="button"
                    disabled={autoDraftMutation.isPending}
                    onClick={() => autoDraftMutation.mutate()}
                    className="min-h-[34px] px-3 rounded-lg text-xs font-semibold neon-btn-primary inline-flex items-center gap-1.5"
                  >
                    <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>
                      {autoDraftMutation.isPending
                        ? 'Drafting POs...'
                        : '1-Click Auto-Draft POs (Velocity Engine)'}
                    </span>
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {lowStockAlerts.slice(0, 6).map((item) => (
                  <button
                    key={item.productId}
                    type="button"
                    onClick={() => prefillFromLowStock(item.productId)}
                    className="px-3 py-1.5 rounded-lg bg-[#051226] border border-amber-400/35 text-xs text-amber-200 hover:border-cyan-400 hover:text-cyan-200 transition-colors"
                  >
                    + Reorder {item.productName} ({item.sellableOnHand} {item.baseUnit} left)
                  </button>
                ))}
              </div>
            </section>
          )}

          <div className="grid lg:grid-cols-12 gap-6">
            {/* Create Purchase Order Form */}
            <section className="lg:col-span-5 neon-card rounded-xl p-6 space-y-4 no-print">
              <div className="flex items-center gap-2 text-base font-semibold text-white">
                <PackagePlus className="w-5 h-5 text-cyan-300" aria-hidden="true" />
                <h2>Create Purchase Order</h2>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  createPoMutation.mutate();
                }}
                className="space-y-3"
              >
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-100/80">Supplier *</span>
                  <select
                    required
                    value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-lg text-sm neon-input"
                  >
                    <option value="">Select supplier...</option>
                    {suppliersQuery.data?.suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-100/80">Product SKU *</span>
                  <select
                    required
                    value={productId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setProductId(nextId);
                      const prod = catalogueQuery.data?.items.find((p) => p.id === nextId);
                      setPackVariantId(prod?.variants[0]?.id ?? '');
                    }}
                    className="w-full min-h-[42px] px-3 rounded-lg text-sm neon-input"
                  >
                    <option value="">Select medicine / SKU...</option>
                    {catalogueQuery.data?.items.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.displayName} ({p.skuCode})
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-100/80">Pack Variant *</span>
                  <select
                    required
                    value={packVariantId}
                    onChange={(e) => setPackVariantId(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-lg text-sm neon-input"
                  >
                    <option value="">Select pack...</option>
                    {selectedProduct?.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.variantName} ({v.currentBaseQty} {selectedProduct.baseUnit})
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid grid-cols-2 gap-3">
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-cyan-100/80">Order Packs *</span>
                    <input
                      required
                      type="number"
                      min="1"
                      value={orderedPacks}
                      onChange={(e) => setOrderedPacks(e.target.value)}
                      className="w-full min-h-[42px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-cyan-100/80">
                      Est. Cost / Pack (LKR)
                    </span>
                    <input
                      required
                      type="number"
                      min="0"
                      step="0.01"
                      value={packCostLkr}
                      onChange={(e) => setPackCostLkr(e.target.value)}
                      className="w-full min-h-[42px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                    />
                  </label>
                </div>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-100/80">Expected Date</span>
                  <input
                    type="date"
                    value={expectedDate}
                    onChange={(e) => setExpectedDate(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-100/80">Notes</span>
                  <input
                    value={poNotes}
                    onChange={(e) => setPoNotes(e.target.value)}
                    placeholder="Urgent reorder"
                    className="w-full min-h-[42px] px-3 rounded-lg text-sm neon-input"
                  />
                </label>

                <button
                  type="submit"
                  disabled={createPoMutation.isPending || !canManagePurchasing}
                  className="w-full min-h-[44px] rounded-lg text-sm neon-btn-primary disabled:opacity-50"
                >
                  {createPoMutation.isPending ? 'Creating...' : 'Create Purchase Order'}
                </button>
              </form>
            </section>

            {/* PO List */}
            <section className="lg:col-span-7 neon-card rounded-xl p-6 space-y-4">
              <h2 className="text-base font-semibold text-white">Purchase Orders Queue</h2>
              <div className="space-y-3">
                {(overview?.purchaseOrders ?? []).length === 0 ? (
                  <p className="text-sm text-slate-400 py-6 text-center">
                    No purchase orders created yet.
                  </p>
                ) : (
                  overview?.purchaseOrders.map((po) => (
                    <div
                      key={po.id}
                      className="p-4 rounded-xl bg-[#040e22]/90 border border-cyan-500/20 space-y-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <div className="text-sm font-bold text-white font-mono-tabular">
                            {po.poNumber}{' '}
                            <span className="ml-2 text-xs font-sans font-semibold text-cyan-300 uppercase">
                              [{po.status.replace(/_/g, ' ')}]
                            </span>
                          </div>
                          <div className="text-xs text-slate-300">
                            {po.supplierName} · Expected: {po.expectedDate} · Est:{' '}
                            <span className="font-mono-tabular font-semibold text-white">
                              {formatLkrMinor(po.totalEstimatedMinor)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 no-print">
                          {po.status === 'draft' && canManagePurchasing && (
                            <button
                              type="button"
                              disabled={approvePoMutation.isPending}
                              onClick={() => approvePoMutation.mutate(po.id)}
                              className="min-h-[36px] px-3 rounded-lg text-xs font-semibold neon-btn-secondary inline-flex items-center gap-1.5"
                            >
                              <ClipboardCheck className="w-3.5 h-3.5" />
                              <span>Approve PO</span>
                            </button>
                          )}
                          {po.status === 'approved' && canManagePurchasing && (
                            <button
                              type="button"
                              onClick={() =>
                                setConvertingPoId(convertingPoId === po.id ? null : po.id)
                              }
                              className="min-h-[36px] px-3 rounded-lg text-xs neon-btn-primary inline-flex items-center gap-1.5"
                            >
                              <span>1-Click Convert to GRN</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <div className="text-xs text-slate-300 space-y-1">
                        {po.lines.map((l) => (
                          <div key={l.id} className="flex justify-between">
                            <span>
                              {l.productName} ({l.variantName}) × {l.orderedPacks} packs
                            </span>
                            <span className="font-mono-tabular">
                              {formatLkrMinor(l.orderedPacks * l.estimatedUnitPackCostMinor)}
                            </span>
                          </div>
                        ))}
                      </div>

                      {convertingPoId === po.id && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            convertPoMutation.mutate(po.id);
                          }}
                          className="pt-3 border-t border-cyan-500/20 grid sm:grid-cols-3 gap-2.5 items-end no-print"
                        >
                          <label className="block space-y-1">
                            <span className="text-[11px] text-cyan-200/80">Batch Number *</span>
                            <input
                              required
                              value={batchNumber}
                              onChange={(e) => setBatchNumber(e.target.value)}
                              className="w-full min-h-[38px] px-2.5 rounded-lg text-xs font-mono-tabular neon-input"
                            />
                          </label>
                          <label className="block space-y-1">
                            <span className="text-[11px] text-cyan-200/80">Printed Expiry *</span>
                            <input
                              required
                              type="date"
                              value={printedExpiry}
                              onChange={(e) => setPrintedExpiry(e.target.value)}
                              className="w-full min-h-[38px] px-2.5 rounded-lg text-xs font-mono-tabular neon-input"
                            />
                          </label>
                          <div className="space-y-2">
                            <label className="flex items-center gap-1.5 text-[11px] text-cyan-100">
                              <input
                                type="checkbox"
                                checked={releaseImmediately}
                                onChange={(e) => setReleaseImmediately(e.target.checked)}
                                className="accent-cyan-400"
                              />
                              <span>Release to sellable</span>
                            </label>
                            <button
                              type="submit"
                              disabled={convertPoMutation.isPending}
                              className="w-full min-h-[38px] px-3 rounded-lg text-xs neon-btn-primary"
                            >
                              Post GRN Now
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        </div>
      )}

      {tab === 'debit_notes' && (
        <div className="grid lg:grid-cols-12 gap-6">
          <section className="lg:col-span-5 neon-card rounded-xl p-6 space-y-4">
            <h2 className="text-base font-semibold text-white">Issue Supplier Debit Note</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                debitNoteMutation.mutate();
              }}
              className="space-y-3"
            >
              <label className="block space-y-1">
                <span className="text-xs font-medium text-cyan-100/80">Supplier *</span>
                <select
                  required
                  value={dnSupplierId}
                  onChange={(e) => setDnSupplierId(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-lg text-sm neon-input"
                >
                  <option value="">Select supplier...</option>
                  {suppliersQuery.data?.suppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-cyan-100/80">Stock Batch / Lot *</span>
                <select
                  required
                  value={dnBalanceId}
                  onChange={(e) => setDnBalanceId(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-lg text-sm neon-input"
                >
                  <option value="">Select lot...</option>
                  {stockQuery.data?.balances.map((b) => (
                    <option key={b.balanceId} value={b.balanceId}>
                      {b.productName} · Batch {b.batchNumber} (Avail {b.availableQty} / Quar{' '}
                      {b.quarantineQty} {b.baseUnit})
                    </option>
                  ))}
                </select>
              </label>

              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-100/80">Qty (Base Units) *</span>
                  <input
                    required
                    type="number"
                    min="1"
                    value={dnQtyBase}
                    onChange={(e) => setDnQtyBase(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-100/80">
                    Credit Value (LKR) *
                  </span>
                  <input
                    required
                    type="number"
                    min="1"
                    step="0.01"
                    value={dnAmountLkr}
                    onChange={(e) => setDnAmountLkr(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-lg text-sm font-mono-tabular neon-input"
                  />
                </label>
              </div>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-cyan-100/80">Return Reason</span>
                <select
                  value={dnReason}
                  onChange={(e) =>
                    setDnReason(
                      e.target.value as 'near_expiry' | 'damaged' | 'overcharged' | 'dead_stock'
                    )
                  }
                  className="w-full min-h-[42px] px-3 rounded-lg text-sm neon-input"
                >
                  <option value="near_expiry">Near Expiry Return</option>
                  <option value="damaged">Damaged Goods</option>
                  <option value="dead_stock">Slow / Dead Stock</option>
                  <option value="overcharged">Supplier Overcharge</option>
                </select>
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium text-cyan-100/80">Notes</span>
                <input
                  value={dnNotes}
                  onChange={(e) => setDnNotes(e.target.value)}
                  placeholder="Returned with delivery van"
                  className="w-full min-h-[42px] px-3 rounded-lg text-sm neon-input"
                />
              </label>

              <button
                type="submit"
                disabled={debitNoteMutation.isPending || !canManagePurchasing}
                className="w-full min-h-[44px] rounded-lg text-sm neon-btn-primary disabled:opacity-50"
              >
                Issue Supplier Debit Note
              </button>
            </form>
          </section>

          <section className="lg:col-span-7 neon-card rounded-xl p-6 space-y-4">
            <h2 className="text-base font-semibold text-white">Issued Debit Notes</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-cyan-500/20 text-cyan-200/75">
                    <th className="py-2.5 px-3">Ref #</th>
                    <th className="py-2.5 px-3">Supplier</th>
                    <th className="py-2.5 px-3">Product / Batch</th>
                    <th className="py-2.5 px-3 text-right">Qty</th>
                    <th className="py-2.5 px-3 text-right">Credit (LKR)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-cyan-500/15">
                  {(overview?.debitNotes ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-400">
                        No supplier debit notes recorded yet.
                      </td>
                    </tr>
                  ) : (
                    overview?.debitNotes.map((dn) => (
                      <tr key={dn.id} className="hover:bg-cyan-950/20">
                        <td className="py-2.5 px-3 font-mono-tabular text-cyan-300">
                          {dn.debitNoteNumber}
                        </td>
                        <td className="py-2.5 px-3 text-white">{dn.supplierName}</td>
                        <td className="py-2.5 px-3 text-slate-300">
                          {dn.productName} ({dn.batchNumber}) ·{' '}
                          <span className="capitalize text-amber-300">
                            {dn.reason.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono-tabular">{dn.qtyBase}</td>
                        <td className="py-2.5 px-3 text-right font-mono-tabular font-semibold text-emerald-300">
                          {formatLkrMinor(dn.amountMinor)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
