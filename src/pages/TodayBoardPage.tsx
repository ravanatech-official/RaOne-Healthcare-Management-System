import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Banknote, CalendarPlus, Check, Clock, RefreshCw, UserPlus, XCircle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.tsx';
import { apiClient, ApiClientError, formatLkrMinor, formatTimeColombo } from '../lib/api-client.ts';

type StatusFilter = 'all' | 'scheduled' | 'arrived' | 'completed' | 'cancelled';

export function TodayBoardPage() {
  const { t, i18n } = useTranslation();
  const { activeTenantId, session } = useAuth();
  const queryClient = useQueryClient();

  const [selectedDate, setSelectedDate] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [feedback, setFeedback] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Patient directory quick add + duplicate disambiguation
  const [showPatientForm, setShowPatientForm] = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonPhone, setNewPersonPhone] = useState('');
  const [duplicatePendingConfirm, setDuplicatePendingConfirm] = useState(false);

  // New Appointment form
  const [showBookForm, setShowBookForm] = useState(false);
  const [bookPersonId, setBookPersonId] = useState('');
  const [bookServiceId, setBookServiceId] = useState('');
  const [bookResourceId, setBookResourceId] = useState('');
  const [bookStartsAtLocal, setBookStartsAtLocal] = useState(() => {
    const d = new Date(Date.now() + 3600_000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });

  // Reschedule inline target
  const [rescheduleTarget, setRescheduleTarget] = useState<{
    id: string;
    version: number;
    startsAtLocal: string;
  } | null>(null);

  // Collect payment form
  const [showPaymentForm, setShowPaymentForm] = useState(false);
  const [payPersonId, setPayPersonId] = useState('');
  const [payAppointmentId, setPayAppointmentId] = useState('');
  const [payDescription, setPayDescription] = useState('Consultation Fee');
  const [payAmountLkr, setPayAmountLkr] = useState(2500);
  const [payMethod, setPayMethod] = useState<'cash' | 'card' | 'bank'>('cash');
  const [payRef, setPayRef] = useState('');

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['today', activeTenantId, selectedDate || 'current'],
    queryFn: () => apiClient.getTodaySummary(activeTenantId!, selectedDate || undefined),
    enabled: Boolean(activeTenantId),
    refetchInterval: 30_000,
  });

  const peopleQuery = useQuery({
    queryKey: ['clinic-people', activeTenantId],
    queryFn: () => apiClient.getClinicPeople(activeTenantId!),
    enabled: Boolean(activeTenantId),
  });

  const paymentsQuery = useQuery({
    queryKey: ['clinic-payments', activeTenantId],
    queryFn: () => apiClient.getClinicPayments(activeTenantId!),
    enabled: Boolean(activeTenantId),
  });

  const canVoidPayment =
    session?.workspace?.permissions.includes('payments.reverse_stepup') ?? false;

  const createPersonMutation = useMutation({
    mutationFn: (confirmDuplicate: boolean) =>
      apiClient.createClinicPerson(activeTenantId!, {
        displayName: newPersonName.trim(),
        phone: newPersonPhone.trim(),
        confirmDuplicate,
      }),
    onSuccess: (res) => {
      setFeedback({ type: 'ok', text: `Registered patient: ${res.person.displayName}` });
      setNewPersonName('');
      setNewPersonPhone('');
      setDuplicatePendingConfirm(false);
      setShowPatientForm(false);
      setBookPersonId(res.person.id);
      queryClient.invalidateQueries({ queryKey: ['clinic-people', activeTenantId] });
    },
    onError: (err) => {
      if (err instanceof ApiClientError && err.envelope.code === 'POSSIBLE_DUPLICATE_PERSON') {
        setDuplicatePendingConfirm(true);
        setFeedback({ type: 'err', text: err.envelope.message });
      } else {
        setFeedback({
          type: 'err',
          text: err instanceof ApiClientError ? err.envelope.message : 'Unable to register patient.',
        });
      }
    },
  });

  const createApptMutation = useMutation({
    mutationFn: () =>
      apiClient.createClinicAppointment(activeTenantId!, {
        idempotencyKey: `apt-${crypto.randomUUID()}`,
        personId: bookPersonId || peopleQuery.data?.people[0]?.id || '',
        serviceId: bookServiceId || data?.services[0]?.id || '',
        resourceId: bookResourceId || data?.resources[0]?.id || '',
        startsAt: new Date(`${bookStartsAtLocal}:00+05:30`).toISOString(),
      }),
    onSuccess: () => {
      setFeedback({ type: 'ok', text: 'Appointment booked cleanly (zero slot conflict verified).' });
      setShowBookForm(false);
      queryClient.invalidateQueries({ queryKey: ['today', activeTenantId] });
    },
    onError: (err) => {
      setFeedback({
        type: 'err',
        text: err instanceof ApiClientError ? err.envelope.message : 'Unable to book appointment.',
      });
    },
  });

  const rescheduleMutation = useMutation({
    mutationFn: () =>
      apiClient.rescheduleClinicAppointment(activeTenantId!, rescheduleTarget!.id, {
        idempotencyKey: `resch-${crypto.randomUUID()}`,
        startsAt: new Date(`${rescheduleTarget!.startsAtLocal}:00+05:30`).toISOString(),
        expectedVersion: rescheduleTarget!.version,
      }),
    onSuccess: () => {
      setFeedback({ type: 'ok', text: 'Appointment rescheduled.' });
      setRescheduleTarget(null);
      queryClient.invalidateQueries({ queryKey: ['today', activeTenantId] });
    },
    onError: (err) => {
      setFeedback({
        type: 'err',
        text: err instanceof ApiClientError ? err.envelope.message : 'Unable to reschedule.',
      });
    },
  });

  const statusMutation = useMutation({
    mutationFn: (vars: {
      id: string;
      status: 'arrived' | 'completed' | 'cancelled' | 'no_show';
      version: number;
    }) =>
      apiClient.transitionAppointmentStatus(activeTenantId!, vars.id, {
        idempotencyKey: `st-${vars.id}-${vars.status}-${vars.version}`,
        status: vars.status,
        expectedVersion: vars.version,
      }),
    onSuccess: () => {
      setFeedback({ type: 'ok', text: 'Appointment status updated.' });
      queryClient.invalidateQueries({ queryKey: ['today', activeTenantId] });
    },
    onError: (err) => {
      setFeedback({
        type: 'err',
        text: err instanceof ApiClientError ? err.envelope.message : 'Unable to update status.',
      });
    },
  });

  const paymentMutation = useMutation({
    mutationFn: () =>
      apiClient.recordClinicPayment(activeTenantId!, {
        idempotencyKey: `pay-${crypto.randomUUID()}`,
        personId: payPersonId || peopleQuery.data?.people[0]?.id || '',
        appointmentId: payAppointmentId || null,
        description: payDescription.trim(),
        amountMinor: Math.round(Number(payAmountLkr) * 100),
        method: payMethod,
        referenceNumber: payRef.trim(),
      }),
    onSuccess: (res) => {
      setFeedback({
        type: 'ok',
        text: `Payment recorded. Receipt issued: ${res.receipt.receiptNumber}`,
      });
      setShowPaymentForm(false);
      setPayRef('');
      queryClient.invalidateQueries({ queryKey: ['today', activeTenantId] });
      queryClient.invalidateQueries({ queryKey: ['clinic-payments', activeTenantId] });
    },
    onError: (err) => {
      setFeedback({
        type: 'err',
        text: err instanceof ApiClientError ? err.envelope.message : 'Unable to record payment.',
      });
    },
  });

  const voidPaymentMutation = useMutation({
    mutationFn: (paymentId: string) =>
      apiClient.voidClinicPayment(activeTenantId!, paymentId, {
        idempotencyKey: `void-${paymentId}`,
        reason: 'Owner voided receipt via Today Board',
      }),
    onSuccess: () => {
      setFeedback({ type: 'ok', text: 'Payment voided and charge allocation reversed.' });
      queryClient.invalidateQueries({ queryKey: ['today', activeTenantId] });
      queryClient.invalidateQueries({ queryKey: ['clinic-payments', activeTenantId] });
    },
    onError: (err) => {
      setFeedback({
        type: 'err',
        text: err instanceof ApiClientError ? err.envelope.message : 'Unable to void payment.',
      });
    },
  });

  const filteredAppointments =
    data?.appointments.filter((item) =>
      statusFilter === 'all' ? true : item.status === statusFilter
    ) ?? [];

  const filterButtons: Array<{ key: StatusFilter; label: string }> = [
    { key: 'all', label: t('today.filterAll') },
    { key: 'scheduled', label: t('today.filterScheduled') },
    { key: 'arrived', label: t('today.filterArrived') },
    { key: 'completed', label: t('today.filterCompleted') },
    { key: 'cancelled', label: t('today.filterCancelled') },
  ];

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold text-slate-900">{t('today.title')}</h1>
          {data && (
            <p className="text-xs text-slate-500 font-mono-tabular">
              {data.businessDate} · {data.timezone} · {t('today.updatedAt')}:{' '}
              {formatTimeColombo(data.dataFreshAt, data.timezone)}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setShowPatientForm((v) => !v);
              setDuplicatePendingConfirm(false);
            }}
            className="min-h-[40px] px-3.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-800 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <UserPlus className="w-4 h-4" aria-hidden="true" />
            <span>{t('today.newPatientBtn')}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowBookForm((v) => !v)}
            className="min-h-[40px] px-3.5 bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <CalendarPlus className="w-4 h-4" aria-hidden="true" />
            <span>{t('today.newAppointmentBtn')}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowPaymentForm((v) => !v)}
            className="min-h-[40px] px-3.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Banknote className="w-4 h-4" aria-hidden="true" />
            <span>{t('today.collectPaymentBtn')}</span>
          </button>
          <input
            type="date"
            aria-label="Business date"
            value={selectedDate || data?.businessDate || ''}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="min-h-[40px] px-3 bg-white border border-slate-300 rounded-lg text-xs font-mono-tabular"
          />
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="min-h-[40px] px-3 bg-white border border-slate-200 hover:bg-slate-100 text-slate-800 text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{t('today.refresh')}</span>
          </button>
        </div>
      </div>

      {feedback && (
        <div
          role={feedback.type === 'err' ? 'alert' : 'status'}
          className={`p-3 rounded-lg border text-sm ${
            feedback.type === 'err'
              ? 'bg-red-50 border-red-200 text-red-800'
              : 'bg-teal-50 border-teal-200 text-teal-900'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* Quick Patient Registration Form (w/ duplicate disambiguation) */}
      {showPatientForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createPersonMutation.mutate(duplicatePendingConfirm);
          }}
          className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
        >
          <h2 className="text-sm font-semibold text-slate-900">{t('today.patientDirTitle')}</h2>
          <div className="grid sm:grid-cols-3 gap-3 items-end">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700">Patient Name *</span>
              <input
                required
                value={newPersonName}
                onChange={(e) => {
                  setNewPersonName(e.target.value);
                  setDuplicatePendingConfirm(false);
                }}
                placeholder="Kasun Perera"
                className="w-full min-h-[40px] px-3 border border-slate-300 rounded-lg text-sm"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700">Phone</span>
              <input
                value={newPersonPhone}
                onChange={(e) => {
                  setNewPersonPhone(e.target.value);
                  setDuplicatePendingConfirm(false);
                }}
                placeholder="0771234567"
                className="w-full min-h-[40px] px-3 border border-slate-300 rounded-lg text-sm font-mono-tabular"
              />
            </label>
            <button
              type="submit"
              disabled={createPersonMutation.isPending}
              className={`min-h-[40px] px-4 text-white text-xs font-medium rounded-lg ${
                duplicatePendingConfirm
                  ? 'bg-amber-700 hover:bg-amber-800'
                  : 'bg-teal-700 hover:bg-teal-800'
              }`}
            >
              {duplicatePendingConfirm ? t('today.duplicateConfirm') : t('today.newPatientBtn')}
            </button>
          </div>
        </form>
      )}

      {/* Book Appointment Form */}
      {showBookForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            createApptMutation.mutate();
          }}
          className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
        >
          <h2 className="text-sm font-semibold text-slate-900">{t('today.bookTitle')}</h2>
          <div className="grid sm:grid-cols-5 gap-3 items-end">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700">Patient *</span>
              <select
                value={bookPersonId || peopleQuery.data?.people[0]?.id || ''}
                onChange={(e) => setBookPersonId(e.target.value)}
                className="w-full min-h-[40px] px-3 bg-white border border-slate-300 rounded-lg text-xs"
              >
                {peopleQuery.data?.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName} {p.phone ? `(${p.phone})` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700">Service *</span>
              <select
                value={bookServiceId || data?.services[0]?.id || ''}
                onChange={(e) => setBookServiceId(e.target.value)}
                className="w-full min-h-[40px] px-3 bg-white border border-slate-300 rounded-lg text-xs"
              >
                {data?.services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.durationMinutes}m · {formatLkrMinor(s.priceMinor)})
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700">Practitioner *</span>
              <select
                value={bookResourceId || data?.resources[0]?.id || ''}
                onChange={(e) => setBookResourceId(e.target.value)}
                className="w-full min-h-[40px] px-3 bg-white border border-slate-300 rounded-lg text-xs"
              >
                {data?.resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700">Start Time (Colombo) *</span>
              <input
                type="datetime-local"
                required
                value={bookStartsAtLocal}
                onChange={(e) => setBookStartsAtLocal(e.target.value)}
                className="w-full min-h-[40px] px-3 bg-white border border-slate-300 rounded-lg text-xs font-mono-tabular"
              />
            </label>
            <button
              type="submit"
              disabled={createApptMutation.isPending}
              className="min-h-[40px] px-4 bg-teal-700 hover:bg-teal-800 text-white text-xs font-medium rounded-lg"
            >
              {createApptMutation.isPending ? 'Booking...' : t('today.newAppointmentBtn')}
            </button>
          </div>
        </form>
      )}

      {/* Collect Payment Form */}
      {showPaymentForm && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            paymentMutation.mutate();
          }}
          className="bg-white border border-slate-200 rounded-xl p-5 space-y-3"
        >
          <h2 className="text-sm font-semibold text-slate-900">{t('today.paymentTitle')}</h2>
          <div className="grid sm:grid-cols-5 gap-3 items-end">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700">Patient *</span>
              <select
                value={payPersonId || peopleQuery.data?.people[0]?.id || ''}
                onChange={(e) => setPayPersonId(e.target.value)}
                className="w-full min-h-[40px] px-3 bg-white border border-slate-300 rounded-lg text-xs"
              >
                {peopleQuery.data?.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700">Description *</span>
              <input
                required
                value={payDescription}
                onChange={(e) => setPayDescription(e.target.value)}
                className="w-full min-h-[40px] px-3 border border-slate-300 rounded-lg text-xs"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700">Amount (LKR) *</span>
              <input
                type="number"
                min={1}
                required
                value={payAmountLkr}
                onChange={(e) => setPayAmountLkr(Number(e.target.value))}
                className="w-full min-h-[40px] px-3 border border-slate-300 rounded-lg text-xs font-mono-tabular"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-slate-700">Method *</span>
              <select
                value={payMethod}
                onChange={(e) => setPayMethod(e.target.value as 'cash' | 'card' | 'bank')}
                className="w-full min-h-[40px] px-3 bg-white border border-slate-300 rounded-lg text-xs"
              >
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="bank">Bank Transfer</option>
              </select>
            </label>
            <button
              type="submit"
              disabled={paymentMutation.isPending}
              className="min-h-[40px] px-4 bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium rounded-lg"
            >
              {paymentMutation.isPending ? 'Posting...' : t('today.collectPaymentBtn')}
            </button>
          </div>
        </form>
      )}

      {/* 4-column KPI summary strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
          <p className="text-xs text-slate-500">{t('today.total')}</p>
          <p className="text-2xl font-bold font-mono-tabular text-slate-900">
            {isLoading ? '—' : data?.counts.total ?? 0}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
          <p className="text-xs text-slate-500">{t('today.scheduled')}</p>
          <p className="text-2xl font-bold font-mono-tabular text-slate-900">
            {isLoading ? '—' : data?.counts.scheduled ?? 0}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
          <p className="text-xs text-slate-500">{t('today.arrived')}</p>
          <p className="text-2xl font-bold font-mono-tabular text-teal-700">
            {isLoading ? '—' : data?.counts.arrived ?? 0}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4 space-y-1">
          <p className="text-xs text-slate-500">{t('today.receipts')}</p>
          <p className="text-2xl font-bold font-mono-tabular text-slate-900">
            {isLoading
              ? '—'
              : error
                ? 'Unavailable'
                : formatLkrMinor(data?.recordedReceiptsMinor ?? 0, data?.currency ?? 'LKR')}
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-1 p-1 bg-slate-200/60 rounded-lg w-fit">
        {filterButtons.map((btn) => (
          <button
            key={btn.key}
            type="button"
            onClick={() => setStatusFilter(btn.key)}
            className={`px-3 py-2 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
              statusFilter === btn.key
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* Appointments Table with Write Actions */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((row) => (
              <div key={row} className="h-11 bg-slate-100 rounded animate-pulse" />
            ))}
          </div>
        ) : error ? (
          <div role="alert" className="p-6 space-y-3">
            <p className="text-sm font-medium text-red-800">{t('common.errorTitle')}</p>
            <button
              type="button"
              onClick={() => refetch()}
              className="min-h-[40px] px-4 bg-slate-900 text-white text-xs font-medium rounded-lg"
            >
              {t('common.retry')}
            </button>
          </div>
        ) : filteredAppointments.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <p className="text-base font-medium text-slate-900">{t('today.emptyTitle')}</p>
            <p className="text-sm text-slate-500">{t('today.emptyDesc')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-600">
                  <th className="py-3 px-4">Time</th>
                  <th className="py-3 px-4">Patient / Person</th>
                  <th className="py-3 px-4">Service</th>
                  <th className="py-3 px-4">Practitioner</th>
                  <th className="py-3 px-4 text-right">Fee</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-sm">
                {filteredAppointments.map((apt) => (
                  <React.Fragment key={apt.id}>
                    <tr className="hover:bg-slate-50">
                      <td className="py-3.5 px-4 font-mono-tabular whitespace-nowrap text-slate-900">
                        {formatTimeColombo(apt.startsAt, data?.timezone)} –{' '}
                        {formatTimeColombo(apt.endsAt, data?.timezone)}
                      </td>
                      <td className="py-3.5 px-4">
                        <div className="font-medium text-slate-900">{apt.personName}</div>
                        <div className="text-xs text-slate-500 font-mono-tabular">
                          {apt.phoneLast4 ? `···${apt.phoneLast4}` : '—'}
                          {apt.isSample && ` · ${t('today.sampleTag')}`}
                        </div>
                      </td>
                      <td className="py-3.5 px-4 text-slate-700">
                        {i18n.language === 'si-LK' && apt.serviceNameSi
                          ? apt.serviceNameSi
                          : apt.serviceName}
                      </td>
                      <td className="py-3.5 px-4 text-slate-700">{apt.resourceName}</td>
                      <td className="py-3.5 px-4 text-right font-mono-tabular text-slate-900 whitespace-nowrap">
                        {formatLkrMinor(apt.bookedPriceMinor, apt.currency)}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap font-medium text-slate-800">
                        {t(`today.statusLabels.${apt.status}`)}
                      </td>
                      <td className="py-3.5 px-4 text-right whitespace-nowrap space-x-1.5">
                        {apt.status === 'scheduled' && (
                          <button
                            type="button"
                            onClick={() =>
                              statusMutation.mutate({
                                id: apt.id,
                                status: 'arrived',
                                version: apt.version,
                              })
                            }
                            className="px-2.5 py-1 text-xs font-medium bg-teal-700 text-white rounded hover:bg-teal-800"
                          >
                            {t('today.markArrived')}
                          </button>
                        )}
                        {(apt.status === 'scheduled' || apt.status === 'arrived') && (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                statusMutation.mutate({
                                  id: apt.id,
                                  status: 'completed',
                                  version: apt.version,
                                })
                              }
                              className="px-2.5 py-1 text-xs font-medium border border-slate-300 bg-white text-slate-800 rounded hover:bg-slate-50 inline-flex items-center gap-1"
                            >
                              <Check className="w-3 h-3" aria-hidden="true" />
                              <span>{t('today.markCompleted')}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setRescheduleTarget({
                                  id: apt.id,
                                  version: apt.version,
                                  startsAtLocal: bookStartsAtLocal,
                                })
                              }
                              className="px-2.5 py-1 text-xs font-medium border border-slate-300 bg-white text-slate-700 rounded hover:bg-slate-50 inline-flex items-center gap-1"
                            >
                              <Clock className="w-3 h-3" aria-hidden="true" />
                              <span>{t('today.rescheduleBtn')}</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setPayPersonId(apt.personId);
                                setPayAppointmentId(apt.id);
                                setPayAmountLkr(Math.round(apt.bookedPriceMinor / 100));
                                setPayDescription(apt.serviceName);
                                setShowPaymentForm(true);
                              }}
                              className="px-2.5 py-1 text-xs font-medium bg-slate-900 text-white rounded hover:bg-slate-800"
                            >
                              Pay
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                statusMutation.mutate({
                                  id: apt.id,
                                  status: 'cancelled',
                                  version: apt.version,
                                })
                              }
                              className="px-2 py-1 text-xs font-medium text-red-700 border border-red-200 rounded hover:bg-red-50 inline-flex items-center gap-1"
                            >
                              <XCircle className="w-3 h-3" aria-hidden="true" />
                              <span>{t('today.cancelAppt')}</span>
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                    {rescheduleTarget?.id === apt.id && (
                      <tr className="bg-slate-50">
                        <td colSpan={7} className="p-3">
                          <div className="flex flex-wrap items-center gap-3">
                            <span className="text-xs font-medium text-slate-700">New Colombo Start Time:</span>
                            <input
                              type="datetime-local"
                              value={rescheduleTarget.startsAtLocal}
                              onChange={(e) =>
                                setRescheduleTarget({
                                  ...rescheduleTarget,
                                  startsAtLocal: e.target.value,
                                })
                              }
                              className="min-h-[36px] px-2.5 bg-white border border-slate-300 rounded text-xs font-mono-tabular"
                            />
                            <button
                              type="button"
                              onClick={() => rescheduleMutation.mutate()}
                              disabled={rescheduleMutation.isPending}
                              className="min-h-[36px] px-3 bg-teal-700 text-white text-xs font-medium rounded"
                            >
                              Confirm Reschedule
                            </button>
                            <button
                              type="button"
                              onClick={() => setRescheduleTarget(null)}
                              className="min-h-[36px] px-3 border border-slate-300 bg-white text-slate-700 text-xs rounded"
                            >
                              Cancel
                            </button>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Recent Clinic Receipts & Step-up Void */}
      {paymentsQuery.data && paymentsQuery.data.payments.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-3">
          <h2 className="text-base font-semibold text-slate-900">{t('today.paymentTitle')}</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600">
                  <th className="py-2.5 px-3">Receipt</th>
                  <th className="py-2.5 px-3">Patient</th>
                  <th className="py-2.5 px-3">Method</th>
                  <th className="py-2.5 px-3 text-right">Amount</th>
                  <th className="py-2.5 px-3">Status</th>
                  {canVoidPayment && <th className="py-2.5 px-3 text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paymentsQuery.data.payments.slice(0, 10).map((p) => (
                  <tr key={p.paymentId}>
                    <td className="py-2.5 px-3 font-mono-tabular font-medium text-slate-900">
                      {p.receiptNumber || p.paymentId.slice(0, 8)}
                    </td>
                    <td className="py-2.5 px-3">{p.personName}</td>
                    <td className="py-2.5 px-3 uppercase">{p.method}</td>
                    <td className="py-2.5 px-3 text-right font-mono-tabular">
                      {formatLkrMinor(p.amountMinor, p.currency)}
                    </td>
                    <td className="py-2.5 px-3 capitalize">{p.status}</td>
                    {canVoidPayment && (
                      <td className="py-2.5 px-3 text-right">
                        {p.status === 'posted' && (
                          <button
                            type="button"
                            onClick={() => voidPaymentMutation.mutate(p.paymentId)}
                            className="px-2.5 py-1 text-red-700 border border-red-200 rounded hover:bg-red-50"
                          >
                            {t('today.voidReceipt')}
                          </button>
                        )}
                      </td>
                    )}
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
