import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Barcode,
  CheckCircle2,
  ClipboardList,
  Lock,
  Plus,
  Printer,
  RotateCcw,
  Search,
  ShieldCheck,
  ShoppingCart,
  Trash2,
  WifiOff,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient, ApiClientError, formatLkrMinor } from '../lib/api-client.ts';
import {
  enqueueOfflinePosSale,
  loadOfflineCatalogueSnapshot,
  saveOfflineCatalogueSnapshot,
} from '../lib/offline-pos.ts';

interface CartLine {
  productId: string;
  packVariantId: string;
  skuCode: string;
  displayName: string;
  variantName: string;
  baseQtyPerPack: number;
  qtyPacks: number;
  unitSalePriceMinor: number;
  requiresPharmacistRelease: boolean;
}

export function PharmacyPosPage() {
  const { t } = useTranslation();
  const { activeTenantId, session } = useAuth();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [discountLkr, setDiscountLkr] = useState(0);
  const [cashTenderLkr, setCashTenderLkr] = useState(0);
  const [cardTenderLkr, setCardTenderLkr] = useState(0);
  const [prescriptionRef, setPrescriptionRef] = useState('');
  const [approvalInfo, setApprovalInfo] = useState<{
    id: string;
    cartSignature: string;
    licenseNumber: string;
  } | null>(null);

  // Till shift inputs
  const [openingFloatLkr, setOpeningFloatLkr] = useState(5000);
  const [countedCashLkr, setCountedCashLkr] = useState(0);
  const [cashEventType, setCashEventType] = useState<'drop' | 'paid_out' | 'top_up'>('drop');
  const [cashEventLkr, setCashEventLkr] = useState(1000);
  const [cashEventReason, setCashEventReason] = useState('Safe drop');

  // Return modal/inline state
  const [returnTarget, setReturnTarget] = useState<{
    saleId: string;
    saleLineId: string;
    productName: string;
    maxQtyBase: number;
    qtyBase: number;
    reason: string;
  } | null>(null);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [lastReceipt, setLastReceipt] = useState<Record<string, unknown> | null>(null);

  // Launch enhancements: Barcode scanner, Clinical Dispense Queue & Offline PWA
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const [barcodeInput, setBarcodeInput] = useState('');
  const [activeDispenseOrderId, setActiveDispenseOrderId] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const hasPharmacistGrant =
    session?.workspace?.professionalGrants.some((g) => g.grantType === 'pharmacist' && g.active) ??
    false;

  const shiftsQuery = useQuery({
    queryKey: ['pharmacy-shifts', activeTenantId],
    queryFn: () => apiClient.getTillShifts(activeTenantId!),
    enabled: Boolean(activeTenantId),
  });

  const catalogueQuery = useQuery({
    queryKey: ['pharmacy-catalogue', activeTenantId, search],
    queryFn: () => apiClient.getCatalogueProducts(activeTenantId!, search || undefined),
    enabled: Boolean(activeTenantId),
  });

  const stockQuery = useQuery({
    queryKey: ['pharmacy-stock', activeTenantId],
    queryFn: () => apiClient.getStockSummary(activeTenantId!),
    enabled: Boolean(activeTenantId),
  });

  const salesQuery = useQuery({
    queryKey: ['pharmacy-pos-sales', activeTenantId],
    queryFn: () => apiClient.getPosSales(activeTenantId!),
    enabled: Boolean(activeTenantId),
  });

  const dispenseQueueQuery = useQuery({
    queryKey: ['pharmacy-dispense-queue', activeTenantId],
    queryFn: () => apiClient.getDispenseQueue(activeTenantId!),
    enabled: Boolean(activeTenantId),
    refetchInterval: 15_000,
  });

  // Cache live catalogue snapshot locally for offline PWA POS fallback
  useEffect(() => {
    if (activeTenantId && !search && catalogueQuery.data?.items?.length) {
      saveOfflineCatalogueSnapshot(activeTenantId, catalogueQuery.data.items);
    }
  }, [activeTenantId, search, catalogueQuery.data]);

  type CatalogueItem = NonNullable<typeof catalogueQuery.data>['items'][number];

  const displayCatalogueItems: CatalogueItem[] = useMemo(() => {
    if (catalogueQuery.data?.items) {
      return catalogueQuery.data.items;
    }
    if (!activeTenantId) return [];
    const cached = loadOfflineCatalogueSnapshot<CatalogueItem[]>(activeTenantId) ?? [];
    if (!search.trim()) return cached;
    const q = search.trim().toLowerCase();
    return cached.filter(
      (item) =>
        item.displayName.toLowerCase().includes(q) ||
        item.genericName.toLowerCase().includes(q) ||
        item.skuCode.toLowerCase().includes(q) ||
        item.variants.some((v) => v.barcodes.some((b) => b.barcode.toLowerCase().includes(q)))
    );
  }, [catalogueQuery.data, activeTenantId, search]);

  const pendingDispenseOrders = useMemo(
    () => (dispenseQueueQuery.data?.orders ?? []).filter((o) => o.status === 'pending'),
    [dispenseQueueQuery.data]
  );

  const openShift = shiftsQuery.data?.shifts.find((s) => s.status === 'open') ?? null;

  // Compute available sellable base qty per product for instant POS feedback
  const availableByProduct = useMemo(() => {
    const map = new Map<string, number>();
    for (const b of stockQuery.data?.balances ?? []) {
      if (b.qualityStatus === 'released' && b.availableQty > 0) {
        map.set(b.productId, (map.get(b.productId) ?? 0) + b.availableQty);
      }
    }
    return map;
  }, [stockQuery.data]);

  const subtotalMinor = cart.reduce((acc, l) => acc + l.unitSalePriceMinor * l.qtyPacks, 0);
  const discountMinor = Math.round(Number(discountLkr) * 100);
  const totalMinor = Math.max(0, subtotalMinor - discountMinor);
  const requiresGate = cart.some((c) => c.requiresPharmacistRelease);

  const currentCartSignature = JSON.stringify({
    items: cart.map((c) => ({
      productId: c.productId,
      packVariantId: c.packVariantId,
      qtyPacks: c.qtyPacks,
      unitSalePriceMinor: c.unitSalePriceMinor,
    })),
    discountMinor,
  });

  const approvalStillMatches =
    Boolean(approvalInfo && approvalInfo.cartSignature === currentCartSignature);

  const openShiftMutation = useMutation({
    mutationFn: () =>
      apiClient.openTillShift(activeTenantId!, {
        counterId: shiftsQuery.data?.counters[0]?.id,
        openingFloatMinor: Math.round(Number(openingFloatLkr) * 100),
      }),
    onSuccess: () => {
      setErrorMsg(null);
      setSuccessMsg('Till shift opened cleanly.');
      queryClient.invalidateQueries({ queryKey: ['pharmacy-shifts', activeTenantId] });
    },
    onError: (err) => {
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to open shift.');
    },
  });

  const cashEventMutation = useMutation({
    mutationFn: () =>
      apiClient.recordTillCashEvent(activeTenantId!, openShift!.id, {
        eventType: cashEventType,
        amountMinor: Math.round(Number(cashEventLkr) * 100),
        reason: cashEventReason.trim(),
      }),
    onSuccess: () => {
      setErrorMsg(null);
      setSuccessMsg('Till cash movement recorded.');
      queryClient.invalidateQueries({ queryKey: ['pharmacy-shifts', activeTenantId] });
    },
    onError: (err) => {
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to record event.');
    },
  });

  const closeShiftMutation = useMutation({
    mutationFn: () =>
      apiClient.closeTillShift(activeTenantId!, openShift!.id, {
        countedCashMinor: Math.round(Number(countedCashLkr) * 100),
        closeNotes: 'Blind till close',
      }),
    onSuccess: () => {
      setErrorMsg(null);
      setSuccessMsg('Till shift closed and variance audited.');
      queryClient.invalidateQueries({ queryKey: ['pharmacy-shifts', activeTenantId] });
    },
    onError: (err) => {
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Unable to close shift.');
    },
  });

  const approveCartMutation = useMutation({
    mutationFn: () =>
      apiClient.approvePosCart(activeTenantId!, {
        items: cart.map((c) => ({
          productId: c.productId,
          packVariantId: c.packVariantId,
          qtyPacks: c.qtyPacks,
          unitSalePriceMinor: c.unitSalePriceMinor,
        })),
        discountMinor,
        prescriptionRef: prescriptionRef.trim(),
      }),
    onSuccess: (res) => {
      setErrorMsg(null);
      setApprovalInfo({
        id: res.approval.id,
        cartSignature: currentCartSignature,
        licenseNumber: res.approval.licenseNumber,
      });
      setSuccessMsg(`Pharmacist cart approval active (${res.approval.licenseNumber}).`);
    },
    onError: (err) => {
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Pharmacist approval failed.');
    },
  });

  const checkoutMutation = useMutation({
    mutationFn: () => {
      const payments: Array<{ method: 'cash' | 'card' | 'bank'; amountMinor: number }> = [];
      const cashMin = Math.round(Number(cashTenderLkr) * 100);
      const cardMin = Math.round(Number(cardTenderLkr) * 100);
      if (cashMin > 0) payments.push({ method: 'cash', amountMinor: cashMin });
      if (cardMin > 0) payments.push({ method: 'card', amountMinor: cardMin });
      if (payments.length === 0 && totalMinor >= 0) {
        payments.push({ method: 'cash', amountMinor: totalMinor });
      }
      return apiClient.checkoutPosSale(activeTenantId!, {
        idempotencyKey: `pos-${crypto.randomUUID()}`,
        shiftId: openShift!.id,
        items: cart.map((c) => ({
          productId: c.productId,
          packVariantId: c.packVariantId,
          qtyPacks: c.qtyPacks,
          unitSalePriceMinor: c.unitSalePriceMinor,
        })),
        discountMinor,
        approvalId: approvalStillMatches ? approvalInfo!.id : null,
        payments,
      });
    },
    onSuccess: async (res) => {
      if (activeDispenseOrderId && activeTenantId) {
        try {
          await apiClient.updateDispenseOrderStatus(activeTenantId, activeDispenseOrderId, {
            status: 'dispensed',
            posSaleId: res.sale.id,
          });
          queryClient.invalidateQueries({ queryKey: ['pharmacy-dispense-queue', activeTenantId] });
        } catch {
          // Non-blocking: receipt already posted
        }
      }
      setErrorMsg(null);
      setSuccessMsg(
        `Sale completed (${res.sale.saleNumber}) · Receipt: ${res.receipt.receiptNumber} · Change: ${formatLkrMinor(res.sale.changeMinor)}`
      );
      setLastReceipt(res.receipt.snapshotJson);
      setCart([]);
      setApprovalInfo(null);
      setActiveDispenseOrderId(null);
      setPrescriptionRef('');
      setDiscountLkr(0);
      setCashTenderLkr(0);
      setCardTenderLkr(0);
      queryClient.invalidateQueries({ queryKey: ['pharmacy-stock', activeTenantId] });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-shifts', activeTenantId] });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-pos-sales', activeTenantId] });
      barcodeInputRef.current?.focus();
    },
    onError: (err) => {
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'POS checkout failed.');
    },
  });

  const returnMutation = useMutation({
    mutationFn: () =>
      apiClient.createPosReturn(activeTenantId!, returnTarget!.saleId, {
        idempotencyKey: `ret-${crypto.randomUUID()}`,
        shiftId: openShift!.id,
        reason: returnTarget!.reason.trim(),
        refundMethod: 'cash',
        lines: [{ saleLineId: returnTarget!.saleLineId, qtyBase: returnTarget!.qtyBase }],
      }),
    onSuccess: (res) => {
      setErrorMsg(null);
      setSuccessMsg(
        `Return ${res.posReturn.returnNumber} recorded (${formatLkrMinor(res.posReturn.refundAmountMinor)}). Stock routed strictly to Returned Quarantine.`
      );
      setReturnTarget(null);
      queryClient.invalidateQueries({ queryKey: ['pharmacy-stock', activeTenantId] });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-shifts', activeTenantId] });
      queryClient.invalidateQueries({ queryKey: ['pharmacy-pos-sales', activeTenantId] });
    },
    onError: (err) => {
      setErrorMsg(err instanceof ApiClientError ? err.envelope.message : 'Return processing failed.');
    },
  });

  const addToCart = (
    p: CatalogueItem,
    v: CatalogueItem['variants'][number],
    qtyPacks = 1
  ) => {
    setCart((prev) => {
      const idx = prev.findIndex((i) => i.packVariantId === v.id);
      if (idx >= 0) {
        const copy = [...prev];
        copy[idx] = { ...copy[idx], qtyPacks: copy[idx].qtyPacks + qtyPacks };
        return copy;
      }
      return [
        ...prev,
        {
          productId: p.id,
          packVariantId: v.id,
          skuCode: p.skuCode,
          displayName: p.displayName,
          variantName: v.variantName,
          baseQtyPerPack: v.currentBaseQty,
          qtyPacks,
          unitSalePriceMinor: v.defaultSalePriceMinor,
          requiresPharmacistRelease: p.requiresPharmacistRelease,
        },
      ];
    });
  };

  const handleBarcodeScanSubmit = (rawCode: string) => {
    const code = rawCode.trim().toLowerCase();
    if (!code) return;
    for (const p of displayCatalogueItems) {
      if (p.skuCode.toLowerCase() === code && p.variants[0]) {
        addToCart(p, p.variants[0], 1);
        setBarcodeInput('');
        setErrorMsg(null);
        setSuccessMsg(`Scanned ${p.displayName} (${p.variants[0].variantName}) added to cart.`);
        barcodeInputRef.current?.focus();
        return;
      }
      for (const v of p.variants) {
        if (v.barcodes.some((b) => b.barcode.toLowerCase() === code && b.status === 'active')) {
          addToCart(p, v, 1);
          setBarcodeInput('');
          setErrorMsg(null);
          setSuccessMsg(`Barcode matched ${p.displayName} (${v.variantName}).`);
          barcodeInputRef.current?.focus();
          return;
        }
      }
    }
    setErrorMsg(`No active product or pack barcode matched "${rawCode.trim()}".`);
    setBarcodeInput('');
    barcodeInputRef.current?.focus();
  };

  const loadDispenseOrderIntoCart = (
    order: NonNullable<typeof dispenseQueueQuery.data>['orders'][number]
  ) => {
    const nextCart: CartLine[] = [];
    for (const line of order.lines) {
      const product = displayCatalogueItems.find((p) => p.id === line.productId);
      const variant =
        product?.variants.find((v) => v.id === line.packVariantId) ?? product?.variants[0];
      if (product && variant) {
        nextCart.push({
          productId: product.id,
          packVariantId: variant.id,
          skuCode: product.skuCode,
          displayName: product.displayName,
          variantName: variant.variantName,
          baseQtyPerPack: variant.currentBaseQty,
          qtyPacks: line.qtyPacks,
          unitSalePriceMinor: variant.defaultSalePriceMinor,
          requiresPharmacistRelease: product.requiresPharmacistRelease,
        });
      }
    }
    if (nextCart.length === 0) {
      setErrorMsg('Dispense order items could not be matched to active catalogue variants.');
      return;
    }
    setCart(nextCart);
    setActiveDispenseOrderId(order.id);
    setPrescriptionRef(order.orderNumber);
    setApprovalInfo(null);
    setErrorMsg(null);
    setSuccessMsg(
      `Loaded Rx ${order.orderNumber} for ${order.personName} (${order.prescriberName}) into POS cart.`
    );
  };

  const handleQueueOfflineSale = () => {
    if (!activeTenantId || !openShift || cart.length === 0) return;
    const payments: Array<{ method: 'cash' | 'card' | 'bank'; amountMinor: number }> = [];
    const cashMin = Math.round(Number(cashTenderLkr) * 100);
    const cardMin = Math.round(Number(cardTenderLkr) * 100);
    if (cashMin > 0) payments.push({ method: 'cash', amountMinor: cashMin });
    if (cardMin > 0) payments.push({ method: 'card', amountMinor: cardMin });
    if (payments.length === 0) {
      payments.push({ method: 'cash', amountMinor: totalMinor });
    }
    enqueueOfflinePosSale(activeTenantId, {
      queueId: crypto.randomUUID(),
      tenantId: activeTenantId,
      createdAt: new Date().toISOString(),
      totalMinor,
      summaryLabel: `${cart.length} items · ${formatLkrMinor(totalMinor)}`,
      payload: {
        idempotencyKey: `pos-offline-${crypto.randomUUID()}`,
        shiftId: openShift.id,
        items: cart.map((c) => ({
          productId: c.productId,
          packVariantId: c.packVariantId,
          qtyPacks: c.qtyPacks,
          unitSalePriceMinor: c.unitSalePriceMinor,
        })),
        discountMinor,
        approvalId: approvalStillMatches ? approvalInfo!.id : null,
        payments,
      },
    });
    setCart([]);
    setDiscountLkr(0);
    setCashTenderLkr(0);
    setCardTenderLkr(0);
    setApprovalInfo(null);
    setErrorMsg(null);
    setSuccessMsg(
      'Offline PWA Sale queued locally. Will sync automatically when internet reconnects.'
    );
    window.dispatchEvent(new Event('storage'));
  };

  const handlePrintThermalReceipt = () => {
    document.body.classList.add('printing-thermal-80mm');
    const cleanup = () => {
      document.body.classList.remove('printing-thermal-80mm');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.print();
    window.setTimeout(cleanup, 600);
  };

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-2xl font-bold neon-heading-glow">{t('pharmacy.posTitle')}</h1>
        <p className="text-sm text-slate-300">{t('pharmacy.posDesc')}</p>
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

      {/* 1. Till Shift Controls */}
      <div className="neon-card rounded-xl p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-white">
            Till Shift & Cash Drawer Control
          </h2>
          {openShift ? (
            <span className="text-xs font-mono-tabular font-semibold neon-text-cyan">
              Shift OPEN · Expected Cash: {formatLkrMinor(openShift.expectedCashMinor)}
            </span>
          ) : (
            <span className="text-xs font-medium text-amber-300">
              No active open shift — open a shift before checkout or returns
            </span>
          )}
        </div>

        {!openShift ? (
          <div className="flex flex-wrap items-end gap-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-cyan-200">Opening Float (LKR)</span>
              <input
                type="number"
                min={0}
                value={openingFloatLkr}
                onChange={(e) => setOpeningFloatLkr(Number(e.target.value))}
                className="min-h-[40px] w-40 px-3 neon-input rounded-lg text-sm font-mono-tabular"
              />
            </label>
            <button
              type="button"
              onClick={() => openShiftMutation.mutate()}
              disabled={openShiftMutation.isPending}
              className="min-h-[40px] px-4 neon-btn-primary text-xs rounded-lg"
            >
              {t('pharmacy.openShiftBtn')}
            </button>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4 pt-2 border-t border-cyan-500/20">
            <div className="flex flex-wrap items-end gap-2">
              <select
                value={cashEventType}
                onChange={(e) => setCashEventType(e.target.value as 'drop' | 'paid_out' | 'top_up')}
                className="min-h-[40px] px-2.5 neon-input rounded-lg text-xs"
              >
                <option value="drop">Safe Drop</option>
                <option value="paid_out">Paid-Out</option>
                <option value="top_up">Float Top-up</option>
              </select>
              <input
                type="number"
                min={1}
                value={cashEventLkr}
                onChange={(e) => setCashEventLkr(Number(e.target.value))}
                placeholder="LKR"
                className="min-h-[40px] w-28 px-2.5 neon-input rounded-lg text-xs font-mono-tabular"
              />
              <input
                value={cashEventReason}
                onChange={(e) => setCashEventReason(e.target.value)}
                placeholder="Reason"
                className="min-h-[40px] flex-1 min-w-[120px] px-2.5 neon-input rounded-lg text-xs"
              />
              <button
                type="button"
                onClick={() => cashEventMutation.mutate()}
                disabled={cashEventMutation.isPending}
                className="min-h-[40px] px-3 neon-btn-secondary text-xs font-medium rounded-lg"
              >
                {t('pharmacy.cashEventBtn')}
              </button>
            </div>

            <div className="flex flex-wrap items-end justify-end gap-2">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-cyan-200">Counted Drawer Cash (LKR)</span>
                <input
                  type="number"
                  min={0}
                  value={countedCashLkr}
                  onChange={(e) => setCountedCashLkr(Number(e.target.value))}
                  className="min-h-[40px] w-36 px-2.5 neon-input rounded-lg text-xs font-mono-tabular"
                />
              </label>
              <button
                type="button"
                onClick={() => closeShiftMutation.mutate()}
                disabled={closeShiftMutation.isPending}
                className="min-h-[40px] px-3 bg-amber-950/70 border border-amber-400/50 hover:bg-amber-900/70 text-amber-200 text-xs font-medium rounded-lg"
              >
                {t('pharmacy.closeShiftBtn')}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 1b. Doctor -> Pharmacy Dispense Queue Handoff */}
      {pendingDispenseOrders.length > 0 && (
        <div className="neon-card-glow rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <ClipboardList className="w-4 h-4 neon-text-cyan" aria-hidden="true" />
              <h2>Clinical Dispense Queue ({pendingDispenseOrders.length} Pending Rx)</h2>
            </div>
            <span className="text-xs text-cyan-200/80">Doctor consultation handoff</span>
          </div>
          <div className="grid md:grid-cols-2 gap-3">
            {pendingDispenseOrders.map((order) => (
              <div
                key={order.id}
                className="p-3 bg-[#040e22]/90 border border-cyan-500/20 rounded-lg flex flex-wrap items-center justify-between gap-2"
              >
                <div className="space-y-0.5 text-xs">
                  <div className="font-semibold text-white font-mono-tabular">
                    {order.orderNumber} · {order.personName}
                  </div>
                  <div className="text-slate-300">
                    {order.prescriberName} ·{' '}
                    {order.lines.map((l) => `${l.productName} x${l.qtyPacks}`).join(', ')}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => loadDispenseOrderIntoCart(order)}
                  className="min-h-[34px] px-3 neon-btn-primary text-xs rounded-lg whitespace-nowrap"
                >
                  Load Rx to Cart
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 2. POS Catalogue Picker + Active Cart */}
      <div className="grid lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 neon-card rounded-xl p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-white">Dispense Catalogue (FEFO)</h2>
            {!isOnline && (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-300">
                <WifiOff className="w-3.5 h-3.5" aria-hidden="true" />
                Cached Offline Catalogue
              </span>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-2.5">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleBarcodeScanSubmit(barcodeInput);
              }}
              className="relative flex items-center"
            >
              <Barcode className="w-4 h-4 neon-text-cyan absolute left-3" aria-hidden="true" />
              <input
                ref={barcodeInputRef}
                autoFocus
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                placeholder="USB Barcode Scan + Enter..."
                aria-label="USB Barcode Scanner Input"
                className="w-full min-h-[40px] pl-9 pr-3 neon-input rounded-lg text-xs font-mono-tabular"
              />
            </form>
            <label className="relative flex items-center">
              <Search className="w-4 h-4 text-cyan-300 absolute left-3" aria-hidden="true" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search medicine or SKU..."
                className="w-full min-h-[40px] pl-9 pr-3 neon-input rounded-lg text-xs"
              />
            </label>
          </div>

          <div className="divide-y divide-cyan-500/15 max-h-[440px] overflow-y-auto">
            {displayCatalogueItems.map((p) => {
              const avail = availableByProduct.get(p.id) ?? 0;
              return (
                <div key={p.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="text-sm font-semibold text-white">
                      {p.displayName}{' '}
                      {p.requiresPharmacistRelease && (
                        <span className="text-xs font-medium text-amber-300">· Rx Gate</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-400 font-mono-tabular">
                      {p.skuCode} · Released Sellable: <span className="neon-text-cyan">{avail}</span> {p.baseUnit}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {p.variants.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => addToCart(p, v)}
                        className="px-3 py-1.5 text-xs font-medium neon-btn-secondary hover:border-cyan-300 rounded-lg inline-flex items-center gap-1 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5 neon-text-cyan" aria-hidden="true" />
                        <span>
                          {v.variantName} · {formatLkrMinor(v.defaultSalePriceMinor)}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Cart & Checkout */}
        <div className="lg:col-span-5 neon-card-glow rounded-xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-base font-semibold text-white">
              <ShoppingCart className="w-5 h-5 neon-text-cyan" aria-hidden="true" />
              <h2>Active Cart</h2>
            </div>
            <span className="text-xs font-mono-tabular text-cyan-200">{cart.length} items</span>
          </div>

          {cart.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">
              Select medicines on the left to start dispensing.
            </p>
          ) : (
            <div className="space-y-3">
              {cart.map((c, idx) => (
                <div
                  key={c.packVariantId}
                  className="flex items-center justify-between gap-2 pb-2 border-b border-cyan-500/15 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="font-semibold text-white">{c.displayName}</div>
                    <div className="text-slate-400 font-mono-tabular">
                      {c.variantName} ({c.qtyPacks * c.baseQtyPerPack} base)
                      {c.requiresPharmacistRelease && ' · Rx'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      value={c.qtyPacks}
                      onChange={(e) => {
                        const qty = Math.max(1, Number(e.target.value));
                        setCart((prev) =>
                          prev.map((line, i) => (i === idx ? { ...line, qtyPacks: qty } : line))
                        );
                      }}
                      className="w-16 min-h-[34px] px-2 neon-input rounded font-mono-tabular text-right"
                    />
                    <span className="font-mono-tabular w-24 text-right font-medium neon-text-cyan">
                      {formatLkrMinor(c.unitSalePriceMinor * c.qtyPacks)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setCart((prev) => prev.filter((_, i) => i !== idx))}
                      className="p-1.5 text-rose-300 hover:bg-rose-950/60 rounded"
                      aria-label="Remove item"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}

              {/* Cart-Hash Pharmacist Gate */}
              {requiresGate && (
                <div className="p-3 bg-[#040e22]/90 border border-cyan-500/20 rounded-lg space-y-2">
                  {approvalStillMatches ? (
                    <div className="flex items-center gap-2 text-xs font-semibold neon-text-cyan">
                      <ShieldCheck className="w-4 h-4 shrink-0" aria-hidden="true" />
                      <span>
                        {t('pharmacy.pharmacistApprovedBadge')} · {approvalInfo?.licenseNumber}
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                        <Lock className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>{t('pharmacy.pharmacistRequiredBadge')}</span>
                      </div>
                      <input
                        value={prescriptionRef}
                        onChange={(e) => setPrescriptionRef(e.target.value)}
                        placeholder="Prescription ref (optional)"
                        className="w-full min-h-[36px] px-2.5 neon-input rounded text-xs font-mono-tabular"
                      />
                      <button
                        type="button"
                        disabled={!hasPharmacistGrant || approveCartMutation.isPending}
                        onClick={() => approveCartMutation.mutate()}
                        className="w-full min-h-[36px] px-3 bg-amber-950/70 border border-amber-400/50 hover:bg-amber-900/70 disabled:opacity-50 text-amber-200 text-xs font-medium rounded"
                      >
                        {hasPharmacistGrant
                          ? t('pharmacy.pharmacistApproveBtn')
                          : 'Active Pharmacist Grant Required'}
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Totals & Split Tender */}
              <div className="space-y-2 pt-2 text-xs">
                <div className="flex justify-between text-slate-300">
                  <span>Subtotal</span>
                  <span className="font-mono-tabular">{formatLkrMinor(subtotalMinor)}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-slate-300">Discount (LKR)</span>
                  <input
                    type="number"
                    min={0}
                    value={discountLkr}
                    onChange={(e) => setDiscountLkr(Number(e.target.value))}
                    className="w-28 min-h-[34px] px-2 neon-input rounded font-mono-tabular text-right"
                  />
                </div>
                <div className="flex justify-between text-base font-bold text-white pt-1 border-t border-cyan-500/20">
                  <span>Total Due</span>
                  <span className="font-mono-tabular neon-text-cyan">{formatLkrMinor(totalMinor)}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 pt-1">
                  <label className="block space-y-1">
                    <span className="text-cyan-200">Cash Tender (LKR)</span>
                    <input
                      type="number"
                      min={0}
                      value={cashTenderLkr}
                      onChange={(e) => setCashTenderLkr(Number(e.target.value))}
                      className="w-full min-h-[36px] px-2 neon-input rounded font-mono-tabular"
                    />
                  </label>
                  <label className="block space-y-1">
                    <span className="text-cyan-200">Card Tender (LKR)</span>
                    <input
                      type="number"
                      min={0}
                      value={cardTenderLkr}
                      onChange={(e) => setCardTenderLkr(Number(e.target.value))}
                      className="w-full min-h-[36px] px-2 neon-input rounded font-mono-tabular"
                    />
                  </label>
                </div>
              </div>

              <div className="space-y-2">
                <button
                  type="button"
                  disabled={
                    !openShift ||
                    checkoutMutation.isPending ||
                    (requiresGate && !approvalStillMatches)
                  }
                  onClick={() => checkoutMutation.mutate()}
                  className="w-full min-h-[44px] px-4 neon-btn-primary disabled:opacity-50 text-sm rounded-lg"
                >
                  {checkoutMutation.isPending ? 'Processing FEFO...' : t('pharmacy.checkoutBtn')}
                </button>

                {!isOnline && (
                  <button
                    type="button"
                    disabled={!openShift || (requiresGate && !approvalStillMatches)}
                    onClick={handleQueueOfflineSale}
                    className="w-full min-h-[40px] px-4 bg-amber-950/70 border border-amber-400/50 hover:bg-amber-900/70 disabled:opacity-50 text-amber-200 text-xs font-medium rounded-lg inline-flex items-center justify-center gap-1.5"
                  >
                    <WifiOff className="w-4 h-4" aria-hidden="true" />
                    <span>Save Sale to Offline Queue (PWA)</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {lastReceipt && (
            <div className="p-3 bg-[#040e22]/90 border border-cyan-500/25 rounded-lg space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-semibold neon-text-cyan">
                  <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                  <span>Immutable POS Receipt Snapshot</span>
                </div>
                <button
                  type="button"
                  onClick={handlePrintThermalReceipt}
                  className="min-h-[32px] px-3 neon-btn-secondary text-xs font-medium rounded inline-flex items-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Print 80mm Thermal</span>
                </button>
              </div>
              <pre className="font-mono-tabular overflow-x-auto text-[11px] text-slate-300">
                {JSON.stringify(lastReceipt, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* 80mm Thermal ESC/POS Print Receipt Root */}
      {lastReceipt && (
        <div className="thermal-80mm-only thermal-80mm-root hidden">
          <div style={{ textAlign: 'center', borderBottom: '1px dashed #000', paddingBottom: '4px', marginBottom: '4px' }}>
            <div style={{ fontWeight: 700, fontSize: '12px' }}>
              {session?.workspace?.tenantName ?? 'SuwaSeva Pharmacy'}
            </div>
            <div>{session?.workspace?.branchName ?? 'Main Branch'}</div>
            <div>Receipt: {String(lastReceipt.receiptNumber ?? '')}</div>
            <div>Sale: {String(lastReceipt.saleNumber ?? '')}</div>
          </div>
          <div style={{ borderBottom: '1px dashed #000', paddingBottom: '4px', marginBottom: '4px' }}>
            {Array.isArray(lastReceipt.lines) &&
              (lastReceipt.lines as Array<Record<string, unknown>>).map((line, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                  <span>
                    {String(line.productName ?? 'Item')} x{String(line.qtyPacks ?? line.qtyBase ?? 1)}
                  </span>
                  <span>
                    {formatLkrMinor(Number(line.lineTotalMinor ?? 0))}
                  </span>
                </div>
              ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
            <span>TOTAL</span>
            <span>{formatLkrMinor(Number(lastReceipt.totalMinor ?? 0))}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>PAID</span>
            <span>{formatLkrMinor(Number(lastReceipt.paidMinor ?? 0))}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span>CHANGE</span>
            <span>{formatLkrMinor(Number(lastReceipt.changeMinor ?? 0))}</span>
          </div>
          <div style={{ textAlign: 'center', marginTop: '6px', borderTop: '1px dashed #000', paddingTop: '4px' }}>
            Thank you for choosing {session?.workspace?.tenantName ?? 'SuwaSeva'}!
          </div>
        </div>
      )}

      {/* 3. Recent POS Sales & Safe Returns to Quarantine */}
      {salesQuery.data && salesQuery.data.sales.length > 0 && (
        <div className="neon-card rounded-xl p-5 space-y-3">
          <h2 className="text-base font-semibold text-white">
            Recent POS Sales & Customer Returns (Quarantine Routed)
          </h2>
          <div className="divide-y divide-cyan-500/15 text-xs">
            {salesQuery.data.sales.map((sale) => (
              <div key={sale.id} className="py-3 space-y-2">
                <div className="flex flex-wrap justify-between gap-2 font-mono-tabular">
                  <span className="font-semibold text-white">
                    {sale.saleNumber} · {sale.receipt?.receiptNumber} · <span className="neon-text-cyan">{sale.status}</span>
                  </span>
                  <span className="font-bold neon-text-cyan">
                    {formatLkrMinor(sale.totalMinor, sale.currency)}
                  </span>
                </div>
                <div className="flex flex-wrap gap-3">
                  {sale.lines.map((line) => {
                    const returnable = line.qtyBase - line.returnedQtyBase;
                    return (
                      <div
                        key={line.id}
                        className="flex items-center gap-2 bg-[#040e22]/90 border border-cyan-500/20 rounded px-2.5 py-1.5 text-slate-200"
                      >
                        <span>
                          {line.productName} ({line.qtyBase} {line.baseUnit}, returned:{' '}
                          {line.returnedQtyBase})
                        </span>
                        {returnable > 0 && openShift && (
                          <button
                            type="button"
                            onClick={() =>
                              setReturnTarget({
                                saleId: sale.id,
                                saleLineId: line.id,
                                productName: line.productName,
                                maxQtyBase: returnable,
                                qtyBase: returnable,
                                reason: 'Customer return for inspection',
                              })
                            }
                            className="inline-flex items-center gap-1 text-amber-300 font-medium hover:underline"
                          >
                            <RotateCcw className="w-3 h-3" aria-hidden="true" />
                            <span>Return</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          {returnTarget && (
            <div className="p-4 bg-amber-950/60 border border-amber-400/50 rounded-lg flex flex-wrap items-end gap-3">
              <div className="text-xs font-semibold text-amber-200 w-full">
                Return {returnTarget.productName} (Routes strictly to Returned Quarantine)
              </div>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-amber-100">
                  Qty Base (max {returnTarget.maxQtyBase})
                </span>
                <input
                  type="number"
                  min={1}
                  max={returnTarget.maxQtyBase}
                  value={returnTarget.qtyBase}
                  onChange={(e) =>
                    setReturnTarget({ ...returnTarget, qtyBase: Number(e.target.value) })
                  }
                  className="min-h-[38px] w-28 px-2.5 neon-input rounded text-xs font-mono-tabular"
                />
              </label>
              <label className="block space-y-1 flex-1 min-w-[200px]">
                <span className="text-xs font-medium text-amber-100">Reason *</span>
                <input
                  value={returnTarget.reason}
                  onChange={(e) =>
                    setReturnTarget({ ...returnTarget, reason: e.target.value })
                  }
                  className="min-h-[38px] w-full px-2.5 neon-input rounded text-xs"
                />
              </label>
              <button
                type="button"
                disabled={returnMutation.isPending}
                onClick={() => returnMutation.mutate()}
                className="min-h-[38px] px-4 bg-amber-900/80 border border-amber-400/60 text-amber-100 text-xs font-medium rounded hover:bg-amber-800/80"
              >
                {t('pharmacy.processReturnBtn')}
              </button>
              <button
                type="button"
                onClick={() => setReturnTarget(null)}
                className="min-h-[38px] px-3 neon-btn-secondary text-xs rounded"
              >
                Cancel
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
