import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { FileText, Truck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient, ApiClientError, formatLkrMinor } from '../lib/api-client.ts';

export function PharmacyReceivingPage() {
  const { activeTenantId } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

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

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold text-slate-900">
          {t('pharmacy.receivingTitle')}
        </h1>
        <p className="text-sm text-slate-600">
          {t('pharmacy.receivingDesc')}
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

      {/* 1. Register Supplier */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          createSupplierMutation.mutate();
        }}
        className="bg-white border border-slate-200 rounded-xl p-5 flex flex-wrap items-end gap-3"
      >
        <label className="block space-y-1 flex-1 min-w-[200px]">
          <span className="text-xs font-medium text-slate-700">New Supplier Name *</span>
          <input
            required
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
            placeholder="State Pharmaceuticals Corp"
            className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm"
          />
        </label>
        <label className="block space-y-1 w-52">
          <span className="text-xs font-medium text-slate-700">Registration Ref</span>
          <input
            value={supplierRegRef}
            onChange={(e) => setSupplierRegRef(e.target.value)}
            placeholder="NMRA-SUP-001"
            className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm font-mono-tabular"
          />
        </label>
        <button
          type="submit"
          disabled={createSupplierMutation.isPending}
          className="min-h-[44px] px-4 bg-slate-900 text-white text-sm font-medium rounded-lg hover:bg-slate-800"
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
        className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
      >
        <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Truck className="w-5 h-5 text-teal-700" aria-hidden="true" />
          <h2>Post Goods Receipt (GRN / Opening Stock)</h2>
        </div>

        <div className="grid sm:grid-cols-4 gap-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Supplier *</span>
            <select
              required
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm bg-white"
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
            <span className="text-xs font-medium text-slate-700">Supplier Doc / DN Ref *</span>
            <input
              required
              value={supplierDocRef}
              onChange={(e) => setSupplierDocRef(e.target.value)}
              placeholder="DN-2026-0041"
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm font-mono-tabular"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Receipt Type</span>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value as 'grn' | 'opening_balance')}
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value="grn">Standard GRN</option>
              <option value="opening_balance">Opening Balance Import</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Received Date *</span>
            <input
              type="date"
              required
              value={receivedDate}
              onChange={(e) => setReceivedDate(e.target.value)}
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm font-mono-tabular"
            />
          </label>

          <label className="block space-y-1 sm:col-span-2">
            <span className="text-xs font-medium text-slate-700">Product & Pack Variant *</span>
            <select
              required
              value={selectedVariantKey}
              onChange={(e) => setSelectedVariantKey(e.target.value)}
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm bg-white"
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
            <span className="text-xs font-medium text-slate-700">Batch Number *</span>
            <input
              required
              value={batchNumber}
              onChange={(e) => setBatchNumber(e.target.value)}
              placeholder="B2608A"
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm font-mono-tabular"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Expiry Precision *</span>
            <select
              value={expiryPrecision}
              onChange={(e) =>
                setExpiryPrecision(e.target.value as 'day' | 'month' | 'unknown')
              }
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value="month">Month (YYYY-MM)</option>
              <option value="day">Day (YYYY-MM-DD)</option>
              <option value="unknown">Unknown (Forced Quarantine)</option>
            </select>
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Printed Expiry</span>
            <input
              required={expiryPrecision !== 'unknown'}
              disabled={expiryPrecision === 'unknown'}
              value={expiryPrecision === 'unknown' ? 'UNKNOWN' : printedExpiry}
              onChange={(e) => setPrintedExpiry(e.target.value)}
              placeholder={expiryPrecision === 'day' ? '2027-08-31' : '2027-08'}
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm font-mono-tabular"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Received Packs *</span>
            <input
              type="number"
              min={0}
              required
              value={receivedPacks}
              onChange={(e) => setReceivedPacks(Number(e.target.value))}
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm font-mono-tabular"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Bonus / Free Packs</span>
            <input
              type="number"
              min={0}
              value={bonusPacks}
              onChange={(e) => setBonusPacks(Number(e.target.value))}
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm font-mono-tabular"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Unit Cost / Pack (LKR)</span>
            <input
              type="number"
              min={0}
              value={unitPackCostLkr}
              onChange={(e) => setUnitPackCostLkr(Number(e.target.value))}
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm font-mono-tabular"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Condition</span>
            <select
              value={condition}
              onChange={(e) =>
                setCondition(
                  e.target.value as 'good' | 'damaged' | 'unknown_expiry' | 'inspection_required'
                )
              }
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value="good">Good</option>
              <option value="inspection_required">Inspection Required (Quarantine)</option>
              <option value="damaged">Damaged (Quarantine)</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Quarantined Packs (Split)</span>
            <input
              type="number"
              min={0}
              value={quarantinedPacks}
              onChange={(e) => setQuarantinedPacks(Number(e.target.value))}
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm font-mono-tabular"
            />
          </label>
          <label className="flex items-center gap-2 sm:col-span-2 pt-5 cursor-pointer">
            <input
              type="checkbox"
              checked={releaseImmediately}
              onChange={(e) => setReleaseImmediately(e.target.checked)}
              className="w-4 h-4 accent-teal-700"
            />
            <span className="text-xs text-slate-800">
              Release directly to sellable shelf (requires active Pharmacist grant for Rx/restricted items)
            </span>
          </label>
        </div>

        <button
          type="submit"
          disabled={postGrnMutation.isPending}
          className="min-h-[44px] px-5 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg"
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
        className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
      >
        <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <FileText className="w-5 h-5 text-slate-700" aria-hidden="true" />
          <h2>Record Supplier Invoice (Financial Document Only — Zero Stock Impact)</h2>
        </div>

        <div className="grid sm:grid-cols-4 gap-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Supplier *</span>
            <select
              required
              value={invSupplierId}
              onChange={(e) => setInvSupplierId(e.target.value)}
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm bg-white"
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
            <span className="text-xs font-medium text-slate-700">Linked GRN (optional)</span>
            <select
              value={invGrnId}
              onChange={(e) => setInvGrnId(e.target.value)}
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm bg-white"
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
            <span className="text-xs font-medium text-slate-700">Invoice Number *</span>
            <input
              required
              value={invoiceNumber}
              onChange={(e) => setInvoiceNumber(e.target.value)}
              placeholder="INV-8841"
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm font-mono-tabular"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Invoice Total (LKR) *</span>
            <input
              type="number"
              min={0}
              required
              value={invoiceTotalLkr}
              onChange={(e) => setInvoiceTotalLkr(Number(e.target.value))}
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm font-mono-tabular"
            />
          </label>
        </div>

        <button
          type="submit"
          disabled={postInvoiceMutation.isPending}
          className="min-h-[44px] px-5 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg"
        >
          {postInvoiceMutation.isPending ? 'Recording...' : 'Post Supplier Invoice'}
        </button>

        {invoicesQuery.data && invoicesQuery.data.supplierInvoices.length > 0 && (
          <div className="pt-3 border-t border-slate-200 text-xs text-slate-700 space-y-1">
            <p className="font-semibold text-slate-900">Recent Supplier Invoices</p>
            {invoicesQuery.data.supplierInvoices.slice(0, 5).map((inv) => (
              <div key={inv.id} className="flex justify-between font-mono-tabular">
                <span>
                  {inv.invoiceNumber} · {inv.supplierName} ({inv.invoiceDate})
                </span>
                <span>{formatLkrMinor(inv.totalMinor, inv.currency)}</span>
              </div>
            ))}
          </div>
        )}
      </form>
    </div>
  );
}
