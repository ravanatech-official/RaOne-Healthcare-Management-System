import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Barcode, FileText, Truck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient, ApiClientError, formatLkrMinor } from '../lib/api-client.ts';

export function PharmacyReceivingPage() {
  const { activeTenantId } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [barcodeScan, setBarcodeScan] = useState('');

  // Quick supplier creation
  const [supplierName, setSupplierName] = useState('');
  const [supplierRegRef, setSupplierRegRef] = useState('');

  // GRN form state
  const [supplierId, setSupplierId] = useState('');
  const [supplierDocRef, setSupplierDocRef] = useState('');
  const [docType, setDocType] = useState<'grn' | 'opening_balance'>('grn');
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().slice(0, 10));
  const [selectedVariantKey, setSelectedVariantKey] = useState(''); // "productId|variantId"
  const [batchNumber, setBatchNumber] = useState('');
  const [printedExpiry, setPrintedExpiry] = useState('2027-12');
  const [expiryPrecision, setExpiryPrecision] = useState<'day' | 'month' | 'unknown'>('month');
  const [receivedPacks, setReceivedPacks] = useState(5);
  const [bonusPacks, setBonusPacks] = useState(0);
  const [quarantinedPacks, setQuarantinedPacks] = useState(0);
  const [unitPackCostLkr, setUnitPackCostLkr] = useState(1000);
  const [condition, setCondition] = useState<'good' | 'damaged' | 'unknown_expiry' | 'inspection_required'>('good');
  const [releaseImmediately, setReleaseImmediately] = useState(false);

  // Separate Supplier Invoice state (does NOT touch stock)
  const [invSupplierId, setInvSupplierId] = useState('');
  const [invGrnId, setInvGrnId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceTotalLkr, setInvoiceTotalLkr] = useState(5000);

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

  const grnQuery = useQuery({
    queryKey: ['pharmacy-grns', activeTenantId],
    queryFn: () => apiClient.getGoodsReceipts(activeTenantId!),
    enabled: Boolean(activeTenantId),
  });

  const invoicesQuery = useQuery({
    queryKey: ['pharmacy-invoices', activeTenantId],
    queryFn: () => apiClient.getSupplierInvoices(activeTenantId!),
    enabled: Boolean(activeTenantId),
  });

  const createSupplierMutation = useMutation({
    mutationFn: () =>
      apiClient.createSupplier(activeTenantId!, {
        name: supplierName.trim(),
        registrationRef: supplierRegRef.trim(),
        status: 'approved',
      }),
    onSuccess: () => {
      setErrorMsg(null);
      setSuccessMsg(`Supplier "${supplierName.trim()}" registered.`);
      setSupplierName('');
      setSupplierRegRef('');
      queryClient.invalidateQueries({ queryKey: ['pharmacy-suppliers', activeTenantId] });
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to register supplier.');
    },
  });

  const postGrnMutation = useMutation({
    mutationFn: () => {
      const [productId, packVariantId] = selectedVariantKey.split('|');
      return apiClient.postGoodsReceipt(activeTenantId!, {
        idempotencyKey: `grn-${crypto.randomUUID()}`,
        supplierId,
        supplierDocRef: supplierDocRef.trim(),
        docType,
        receivedDate,
        lines: [
          {
            productId,
            packVariantId,
            batchNumber: batchNumber.trim(),
            printedExpiry: expiryPrecision === 'unknown' ? 'UNKNOWN' : printedExpiry.trim(),
            expiryPrecision,
            receivedPacks: Number(receivedPacks),
            bonusPacks: Number(bonusPacks),
            quarantinedPacks: Number(quarantinedPacks),
            unitPackCostMinor: Math.round(Number(unitPackCostLkr) * 100),
            condition,
            releaseImmediately,
          },
        ],
      });
    },
    onSuccess: () => {
      setErrorMsg(null);
      setSuccessMsg('Goods Receipt posted cleanly: lot, cost layer, and stock movement recorded.');
      setSupplierDocRef('');
      setBatchNumber('');
      queryClient.invalidateQueries({ queryKey: ['pharmacy-grns', activeTenantId] });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-stock', activeTenantId] });
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to post GRN.');
    },
  });

  const postInvoiceMutation = useMutation({
    mutationFn: () =>
      apiClient.postSupplierInvoice(activeTenantId!, {
        idempotencyKey: `inv-${crypto.randomUUID()}`,
        supplierId: invSupplierId,
        goodsReceiptId: invGrnId || null,
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate: receivedDate,
        totalMinor: Math.round(Number(invoiceTotalLkr) * 100),
      }),
    onSuccess: () => {
      setErrorMsg(null);
      setSuccessMsg('Supplier invoice recorded (zero stock impact confirmed).');
      setInvoiceNumber('');
      queryClient.invalidateQueries({ queryKey: ['pharmacy-invoices', activeTenantId] });
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to record invoice.');
    },
  });

  const variantOptions =
    catalogueQuery.data?.items.flatMap((p) =>
      p.variants.map((v) => ({
        key: `${p.id}|${v.id}`,
        label: `${p.skuCode} · ${p.displayName} — ${v.variantName} (${v.currentBaseQty} ${p.baseUnit})`,
      }))
    ) ?? [];

  const handleBarcodeLookup = () => {
    const code = barcodeScan.trim().toLowerCase();
    if (!code || !catalogueQuery.data) return;
    for (const p of catalogueQuery.data.items) {
      for (const v of p.variants) {
        const hit =
          p.skuCode.toLowerCase() === code ||
          v.barcodes.some((b) => b.barcode.toLowerCase() === code);
        if (hit) {
          setSelectedVariantKey(`${p.id}|${v.id}`);
          setErrorMsg(null);
          setSuccessMsg(`Selected ${p.displayName} (${v.variantName}) via barcode ${barcodeScan.trim()}.`);
          setBarcodeScan('');
          return;
        }
      }
    }
    setErrorMsg(`No catalogue pack variant matches barcode/SKU "${barcodeScan.trim()}".`);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold neon-heading-glow">
          {t('pharmacy.receivingTitle')}
        </h1>
        <p className="text-sm text-slate-300">
          {t('pharmacy.receivingDesc')}
        </p>
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

      {/* 1. Register Supplier */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          createSupplierMutation.mutate();
        }}
        className="neon-card rounded-xl p-5 flex flex-wrap items-end gap-3"
      >
        <label className="block space-y-1 flex-1 min-w-[200px]">
          <span className="text-xs font-medium text-cyan-200">New Supplier Name *</span>
          <input
            required
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
            placeholder="State Pharmaceuticals Corp"
            className="w-full min-h-[44px] px-3 neon-input rounded-lg text-sm"
          />
        </label>
        <label className="block space-y-1 w-52">
          <span className="text-xs font-medium text-cyan-200">Registration Ref</span>
          <input
            value={supplierRegRef}
            onChange={(e) => setSupplierRegRef(e.target.value)}
            placeholder="NMRA-SUP-001"
            className="w-full min-h-[44px] px-3 neon-input rounded-lg text-sm font-mono-tabular"
          />
        </label>
        <button
          type="submit"
          disabled={createSupplierMutation.isPending}
          className="min-h-[44px] px-4 neon-btn-secondary text-sm font-medium rounded-lg"
        >
          Add Supplier
        </button>
      </form>

      {/* 2. Post Physical Goods Receipt (GRN) */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          postGrnMutation.mutate();
        }}
        className="neon-card rounded-xl p-6 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-base font-semibold text-white">
            <Truck className="w-5 h-5 neon-text-cyan" aria-hidden="true" />
            <h2>Post Goods Receipt (GRN / Opening Stock)</h2>
          </div>
          <div className="flex items-center gap-2">
            <Barcode className="w-4 h-4 text-cyan-300" aria-hidden="true" />
            <input
              value={barcodeScan}
              onChange={(e) => setBarcodeScan(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleBarcodeLookup();
                }
              }}
              placeholder="USB Barcode / SKU + Enter"
              className="min-h-[38px] w-52 px-2.5 neon-input rounded-lg text-xs font-mono-tabular"
            />
            <button
              type="button"
              onClick={handleBarcodeLookup}
              className="min-h-[38px] px-3 neon-btn-secondary text-xs font-medium rounded-lg"
            >
              Find
            </button>
          </div>
        </div>

        <div className="grid sm:grid-cols-4 gap-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-cyan-200">Supplier *</span>
            <select
              required
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full min-h-[44px] px-3 neon-input rounded-lg text-sm"
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
            <span className="text-xs font-medium text-cyan-200">Supplier Doc / DN Ref *</span>
            <input
              required
              value={supplierDocRef}
              onChange={(e) => setSupplierDocRef(e.target.value)}
              placeholder="DN-2026-0041"
              className="w-full min-h-[44px] px-3 neon-input rounded-lg text-sm font-mono-tabular"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-cyan-200">Receipt Type</span>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value as 'grn' | 'opening_balance')}
              className="w-full min-h-[44px] px-3 neon-input rounded-lg text-sm"
            >
              <option value="grn">Standard GRN</option>
              <option value="opening_balance">Opening Balance Import</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-cyan-200">Received Date *</span>
            <input
              type="date"
              required
              value={receivedDate}
              onChange={(e) => setReceivedDate(e.target.value)}
              className="w-full min-h-[44px] px-3 neon-input rounded-lg text-sm font-mono-tabular"
            />
          </label>

          <label className="block space-y-1 sm:col-span-2">
            <span className="text-xs font-medium text-cyan-200">Product & Pack Variant *</span>
            <select
              required
              value={selectedVariantKey}
              onChange={(e) => setSelectedVariantKey(e.target.value)}
              className="w-full min-h-[44px] px-3 neon-input rounded-lg text-sm"
            >
              <option value="">Select SKU & pack...</option>
              {variantOptions.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-cyan-200">Batch Number *</span>
            <input
              required
              value={batchNumber}
              onChange={(e) => setBatchNumber(e.target.value)}
              placeholder="B2608A"
              className="w-full min-h-[44px] px-3 neon-input rounded-lg text-sm font-mono-tabular"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-cyan-200">Expiry Precision *</span>
            <select
              value={expiryPrecision}
              onChange={(e) =>
                setExpiryPrecision(e.target.value as 'day' | 'month' | 'unknown')
              }
              className="w-full min-h-[44px] px-3 neon-input rounded-lg text-sm"
            >
              <option value="month">Month (YYYY-MM)</option>
              <option value="day">Day (YYYY-MM-DD)</option>
              <option value="unknown">Unknown (Forced Quarantine)</option>
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-cyan-200">Printed Expiry</span>
            <input
              required={expiryPrecision !== 'unknown'}
              disabled={expiryPrecision === 'unknown'}
              value={expiryPrecision === 'unknown' ? 'UNKNOWN' : printedExpiry}
              onChange={(e) => setPrintedExpiry(e.target.value)}
              placeholder={expiryPrecision === 'day' ? '2027-08-31' : '2027-08'}
              className="w-full min-h-[44px] px-3 neon-input rounded-lg text-sm font-mono-tabular disabled:opacity-60"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-cyan-200">Received Packs *</span>
            <input
              type="number"
              min={0}
              required
              value={receivedPacks}
              onChange={(e) => setReceivedPacks(Number(e.target.value))}
              className="w-full min-h-[44px] px-3 neon-input rounded-lg text-sm font-mono-tabular"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-cyan-200">Bonus / Free Packs</span>
            <input
              type="number"
              min={0}
              value={bonusPacks}
              onChange={(e) => setBonusPacks(Number(e.target.value))}
              className="w-full min-h-[44px] px-3 neon-input rounded-lg text-sm font-mono-tabular"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-cyan-200">Unit Cost / Pack (LKR)</span>
            <input
              type="number"
              min={0}
              value={unitPackCostLkr}
              onChange={(e) => setUnitPackCostLkr(Number(e.target.value))}
              className="w-full min-h-[44px] px-3 neon-input rounded-lg text-sm font-mono-tabular"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-cyan-200">Condition</span>
            <select
              value={condition}
              onChange={(e) =>
                setCondition(
                  e.target.value as 'good' | 'damaged' | 'unknown_expiry' | 'inspection_required'
                )
              }
              className="w-full min-h-[44px] px-3 neon-input rounded-lg text-sm"
            >
              <option value="good">Good</option>
              <option value="inspection_required">Inspection Required (Quarantine)</option>
              <option value="damaged">Damaged (Quarantine)</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-cyan-200">Quarantined Packs (Split)</span>
            <input
              type="number"
              min={0}
              value={quarantinedPacks}
              onChange={(e) => setQuarantinedPacks(Number(e.target.value))}
              className="w-full min-h-[44px] px-3 neon-input rounded-lg text-sm font-mono-tabular"
            />
          </label>
          <label className="flex items-center gap-2 sm:col-span-2 pt-5 cursor-pointer">
            <input
              type="checkbox"
              checked={releaseImmediately}
              onChange={(e) => setReleaseImmediately(e.target.checked)}
              className="w-4 h-4 accent-cyan-400"
            />
            <span className="text-xs text-slate-200">
              Release directly to sellable shelf (requires active Pharmacist grant for Rx/restricted items)
            </span>
          </label>
        </div>

        <button
          type="submit"
          disabled={postGrnMutation.isPending}
          className="min-h-[44px] px-5 neon-btn-primary disabled:opacity-60 text-sm rounded-lg"
        >
          {postGrnMutation.isPending ? 'Posting GRN...' : 'Post Goods Receipt'}
        </button>
      </form>

      {/* 3. Separate Supplier Invoice Entry */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          postInvoiceMutation.mutate();
        }}
        className="neon-card rounded-xl p-6 space-y-4"
      >
        <div className="flex items-center gap-2 text-base font-semibold text-white">
          <FileText className="w-5 h-5 neon-text-cyan" aria-hidden="true" />
          <h2>Record Supplier Invoice (Financial Document Only — Zero Stock Impact)</h2>
        </div>

        <div className="grid sm:grid-cols-4 gap-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-cyan-200">Supplier *</span>
            <select
              required
              value={invSupplierId}
              onChange={(e) => setInvSupplierId(e.target.value)}
              className="w-full min-h-[44px] px-3 neon-input rounded-lg text-sm"
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
            <span className="text-xs font-medium text-cyan-200">Linked GRN (optional)</span>
            <select
              value={invGrnId}
              onChange={(e) => setInvGrnId(e.target.value)}
              className="w-full min-h-[44px] px-3 neon-input rounded-lg text-sm"
            >
              <option value="">None / Standalone Invoice</option>
              {grnQuery.data?.goodsReceipts.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.supplierDocRef} ({g.receivedDate})
                </option>
              ))}
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-cyan-200">Invoice Number *</span>
            <input
              required
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="INV-8841"
              className="w-full min-h-[44px] px-3 neon-input rounded-lg text-sm font-mono-tabular"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-cyan-200">Invoice Total (LKR) *</span>
            <input
              type="number"
              min={0}
              required
              value={invoiceTotalLkr}
              onChange={(e) => setInvoiceTotalLkr(Number(e.target.value))}
              className="w-full min-h-[44px] px-3 neon-input rounded-lg text-sm font-mono-tabular"
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={postInvoiceMutation.isPending}
          className="min-h-[44px] px-5 neon-btn-secondary disabled:opacity-60 text-sm font-medium rounded-lg"
        >
          {postInvoiceMutation.isPending ? 'Recording...' : 'Post Supplier Invoice'}
        </button>

        {invoicesQuery.data && invoicesQuery.data.supplierInvoices.length > 0 && (
          <div className="pt-3 border-t border-cyan-500/20 text-xs text-slate-300 space-y-1">
            <p className="font-semibold text-white">Recent Supplier Invoices</p>
            {invoicesQuery.data.supplierInvoices.slice(0, 5).map((inv) => (
              <div key={inv.id} className="flex justify-between font-mono-tabular">
                <span>
                  {inv.invoiceNumber} · {inv.supplierName} ({inv.invoiceDate})
                </span>
                <span className="neon-text-cyan">{formatLkrMinor(inv.totalMinor, inv.currency)}</span>
              </div>
            ))}
          </div>
        )}
      </form>
    </div>
  );
}
