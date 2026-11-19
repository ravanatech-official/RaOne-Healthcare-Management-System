import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { PackagePlus, Search } from 'lucide-react';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient, ApiClientError, formatLkrMinor } from '../lib/api-client.ts';

export function PharmacyCataloguePage() {
  const { activeTenantId } = useAuth();
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Create Product SKU state
  const [skuCode, setSkuCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [genericName, setGenericName] = useState('');
  const [brandName, setBrandName] = useState('');
  const [strengthValue, setStrengthValue] = useState('500');
  const [strengthUnit, setStrengthUnit] = useState('mg');
  const [dosageForm, setDosageForm] = useState('tablet');
  const [manufacturer, setManufacturer] = useState('');
  const [regulatoryClass, setRegulatoryClass] = useState('prescription_only');
  const [baseUnit, setBaseUnit] = useState('tablet');
  const [packName, setPackName] = useState('Box of 100 Tablets');
  const [packUnit, setPackUnit] = useState('box');
  const [baseQtyPerPack, setBaseQtyPerPack] = useState(100);
  const [salePriceLkr, setSalePriceLkr] = useState(1500);
  const [barcode, setBarcode] = useState('');

  // Versioned UOM conversion editor state
  const [editingVariantId, setEditingVariantId] = useState<string | null>(null);
  const [newBaseQty, setNewBaseQty] = useState(100);
  const [conversionNotes, setConversionNotes] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['pharmacy-catalogue', activeTenantId, search],
    queryFn: () => apiClient.getCatalogueProducts(activeTenantId!, search || undefined),
    enabled: Boolean(activeTenantId),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      apiClient.createProduct(activeTenantId!, {
        skuCode: skuCode.trim(),
        displayName: displayName.trim(),
        genericName: genericName.trim(),
        brandName: brandName.trim(),
        strengthValue: strengthValue.trim(),
        strengthUnit: strengthUnit.trim(),
        dosageForm,
        manufacturer: manufacturer.trim(),
        regulatoryClass,
        baseUnit,
        initialPack: {
          variantName: packName.trim(),
          packUnit,
          baseQtyPerPack: Number(baseQtyPerPack),
          defaultSalePriceMinor: Math.round(Number(salePriceLkr) * 100),
          ...(barcode.trim() ? { barcode: barcode.trim(), barcodeType: 'ean13' } : {}),
        },
      }),
    onSuccess: () => {
      setErrorMsg(null);
      setSuccessMsg(`Created SKU ${skuCode.trim()} with initial pack conversion v1.`);
      setSkuCode('');
      setDisplayName('');
      setGenericName('');
      setBrandName('');
      setBarcode('');
      queryClient.invalidateQueries({ queryKey: ['pharmacy-catalogue', activeTenantId] });
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to create product.');
    },
  });

  const conversionMutation = useMutation({
    mutationFn: () =>
      apiClient.updatePackConversion(activeTenantId!, editingVariantId!, {
        newBaseQtyPerPack: Number(newBaseQty),
        notes: conversionNotes.trim(),
      }),
    onSuccess: () => {
      setErrorMsg(null);
      setSuccessMsg('Updated pack conversion as a new immutable version (historical GRNs preserved).');
      setEditingVariantId(null);
      setConversionNotes('');
      queryClient.invalidateQueries({ queryKey: ['pharmacy-catalogue', activeTenantId] });
    },
    onError: (err) => {
      setSuccessMsg(null);
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to update conversion.');
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold text-slate-900">{t('pharmacy.catalogueTitle')}</h1>
          <p className="text-sm text-slate-600">
            {t('pharmacy.catalogueDesc')}
          </p>
        </div>

        <label className="relative flex items-center">
          <Search className="w-4 h-4 text-slate-400 absolute left-3" aria-hidden="true" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search SKU, generic, or barcode..."
            className="min-h-[44px] pl-9 pr-3 w-full sm:w-72 bg-white border border-slate-300 rounded-lg text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700"
          />
        </label>
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
      {data?.ambiguityWarning && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-900">
          Multiple strengths or forms matched "{search}". Verify exact strength and pack size before receiving or dispensing.
        </div>
      )}

      {/* New SKU + Pack Variant Form */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          createMutation.mutate();
        }}
        className="bg-white border border-slate-200 rounded-xl p-6 space-y-4"
      >
        <div className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <PackagePlus className="w-5 h-5 text-teal-700" aria-hidden="true" />
          <h2>Register Product SKU & Initial Pack</h2>
        </div>

        <div className="grid sm:grid-cols-4 gap-3">
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">SKU Code *</span>
            <input
              required
              value={skuCode}
              onChange={(e) => setSkuCode(e.target.value)}
              placeholder="AMOX-500-CAP"
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm font-mono-tabular"
            />
          </label>
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-xs font-medium text-slate-700">Display Name *</span>
            <input
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Amoxicillin 500mg Capsule"
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Generic Name *</span>
            <input
              required
              value={genericName}
              onChange={(e) => setGenericName(e.target.value)}
              placeholder="Amoxicillin"
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Strength Value *</span>
            <input
              required
              value={strengthValue}
              onChange={(e) => setStrengthValue(e.target.value)}
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm font-mono-tabular"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Strength Unit *</span>
            <input
              required
              value={strengthUnit}
              onChange={(e) => setStrengthUnit(e.target.value)}
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Dosage Form *</span>
            <select
              value={dosageForm}
              onChange={(e) => setDosageForm(e.target.value)}
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value="tablet">Tablet</option>
              <option value="capsule">Capsule</option>
              <option value="syrup_bottle">Syrup Bottle</option>
              <option value="cream_tube">Cream Tube</option>
              <option value="inhaler">Inhaler</option>
              <option value="vial">Vial</option>
              <option value="sachet">Sachet</option>
              <option value="device">Device</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Manufacturer *</span>
            <input
              required
              value={manufacturer}
              onChange={(e) => setManufacturer(e.target.value)}
              placeholder="SPMC / GSK"
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Regulatory Class *</span>
            <select
              value={regulatoryClass}
              onChange={(e) => setRegulatoryClass(e.target.value)}
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value="otc">OTC (Over-the-Counter)</option>
              <option value="prescription_only">Prescription Only (Pharmacist Gate)</option>
              <option value="controlled">Controlled / Schedule (Pharmacist Gate)</option>
              <option value="unknown_restricted">Unknown Restricted (Pharmacist Gate)</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Base Unit *</span>
            <select
              value={baseUnit}
              onChange={(e) => setBaseUnit(e.target.value)}
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value="tablet">tablet</option>
              <option value="capsule">capsule</option>
              <option value="sealed_bottle">sealed_bottle</option>
              <option value="tube">tube</option>
              <option value="inhaler">inhaler</option>
              <option value="vial">vial</option>
              <option value="sachet">sachet</option>
              <option value="unit">unit</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Initial Pack Name *</span>
            <input
              required
              value={packName}
              onChange={(e) => setPackName(e.target.value)}
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Pack Unit *</span>
            <select
              value={packUnit}
              onChange={(e) => setPackUnit(e.target.value)}
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm bg-white"
            >
              <option value="box">box</option>
              <option value="strip">strip</option>
              <option value="bottle">bottle</option>
              <option value="tablet">tablet</option>
              <option value="capsule">capsule</option>
              <option value="pack">pack</option>
              <option value="unit">unit</option>
            </select>
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Base Qty / Pack *</span>
            <input
              type="number"
              min={1}
              required
              value={baseQtyPerPack}
              onChange={(e) => setBaseQtyPerPack(Number(e.target.value))}
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm font-mono-tabular"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Default Pack Price (LKR)</span>
            <input
              type="number"
              min={0}
              value={salePriceLkr}
              onChange={(e) => setSalePriceLkr(Number(e.target.value))}
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm font-mono-tabular"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-slate-700">Barcode (optional)</span>
            <input
              value={barcode}
              onChange={(e) => setBarcode(e.target.value)}
              placeholder="8901234567890"
              className="w-full min-h-[44px] px-3 border border-slate-300 rounded-lg text-sm font-mono-tabular"
            />
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="w-full min-h-[44px] px-4 bg-teal-700 hover:bg-teal-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg"
            >
              {createMutation.isPending ? 'Saving...' : 'Save SKU'}
            </button>
          </div>
        </div>
      </form>

      {/* Product & Pack Conversion Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-slate-500">Loading pharmacy catalogue...</div>
        ) : !data || data.items.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-600">
            No products registered yet. Add your first SKU above before posting a Goods Receipt (GRN).
          </div>
        ) : (
          <div className="divide-y divide-slate-200">
            {data.items.map((item) => (
              <div key={item.id} className="p-5 space-y-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono-tabular text-xs font-semibold text-slate-700">
                        {item.skuCode}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="text-base font-semibold text-slate-900">{item.displayName}</span>
                    </div>
                    <div className="text-xs text-slate-600 flex flex-wrap gap-2">
                      <span>{item.genericName}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono-tabular">
                        {item.strengthValue} {item.strengthUnit} {item.dosageForm}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{item.manufacturer}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-medium text-slate-800">
                        Class: {item.regulatoryClass.replace('_', ' ')}
                      </span>
                      {item.requiresPharmacistRelease && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-amber-800 font-medium">Pharmacist Release Gate</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 text-slate-600 bg-slate-50">
                        <th className="py-2 px-3">Pack Variant</th>
                        <th className="py-2 px-3">Conversion (Current)</th>
                        <th className="py-2 px-3">Default Sale Price</th>
                        <th className="py-2 px-3">Barcodes</th>
                        <th className="py-2 px-3">Version History</th>
                        <th className="py-2 px-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {item.variants.map((v) => (
                        <tr key={v.id}>
                          <td className="py-2.5 px-3 font-medium text-slate-900">{v.variantName}</td>
                          <td className="py-2.5 px-3 font-mono-tabular text-slate-800">
                            1 {v.packUnit} = {v.currentBaseQty} {item.baseUnit} (v{v.currentConversionVersion})
                          </td>
                          <td className="py-2.5 px-3 font-mono-tabular text-slate-800">
                            {formatLkrMinor(v.defaultSalePriceMinor, v.currency)}
                          </td>
                          <td className="py-2.5 px-3 font-mono-tabular text-slate-600">
                            {v.barcodes.length > 0
                              ? v.barcodes.map((b) => `${b.barcode}${b.status === 'conflict_review' ? ' (CONFLICT)' : ''}`).join(', ')
                              : '—'}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600">
                            {v.conversionHistory.map((h) => `v${h.version}:${h.baseQtyPerPack}`).join(' ← ')}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <button
                              type="button"
                              onClick={() => {
                                setEditingVariantId(v.id);
                                setNewBaseQty(v.currentBaseQty);
                                setConversionNotes('Manufacturer pack size change');
                              }}
                              className="px-2.5 py-1.5 text-xs font-medium text-teal-800 border border-teal-200 rounded hover:bg-teal-50"
                            >
                              New UOM Version
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {item.variants.some((v) => v.id === editingVariantId) && (
                  <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex flex-wrap items-end gap-3">
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-slate-700">New Base Qty / Pack</span>
                      <input
                        type="number"
                        min={1}
                        value={newBaseQty}
                        onChange={(e) => setNewBaseQty(Number(e.target.value))}
                        className="min-h-[40px] w-32 px-3 bg-white border border-slate-300 rounded text-sm font-mono-tabular"
                      />
                    </label>
                    <label className="block space-y-1 flex-1 min-w-[200px]">
                      <span className="text-xs font-medium text-slate-700">Audit Reason *</span>
                      <input
                        value={conversionNotes}
                        onChange={(e) => setConversionNotes(e.target.value)}
                        className="min-h-[40px] w-full px-3 bg-white border border-slate-300 rounded text-sm"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => conversionMutation.mutate()}
                      disabled={conversionMutation.isPending || !conversionNotes.trim()}
                      className="min-h-[40px] px-4 bg-teal-700 text-white text-xs font-medium rounded hover:bg-teal-800"
                    >
                      Save Version
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingVariantId(null)}
                      className="min-h-[40px] px-3 border border-slate-300 bg-white text-slate-700 text-xs font-medium rounded"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
