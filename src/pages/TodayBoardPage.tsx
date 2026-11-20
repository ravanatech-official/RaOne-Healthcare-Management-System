import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Banknote,
  BellRing,
  CalendarPlus,
  Check,
  Clock,
  ExternalLink,
  History,
  MonitorPlay,
  Pill,
  QrCode,
  RefreshCw,
  Repeat,
  Trash2,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../context/AuthContext.tsx';
import {
  apiClient,
  ApiClientError,
  formatLkrMinor,
  formatTimeColombo,
  toColomboDatetimeLocal,
  todayColomboDate,
} from '../lib/api-client.ts';

type StatusFilter = 'all' | 'scheduled' | 'arrived' | 'completed' | 'cancelled';
type BoardTab = 'today' | 'schedules' | 'payouts';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function TodayBoardPage() {
  const { t, i18n } = useTranslation();
  const { activeTenantId, session } = useAuth();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<BoardTab>('today');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [feedback, setFeedback] = useState<{
    type: 'ok' | 'err';
    text: string;
    waLink?: string;
  } | null>(null);

  // Patient directory quick add + duplicate disambiguation
  const [showPatientForm, setShowPatientForm] = useState(false);
  const [newPersonName, setNewPersonName] = useState('');
  const [newPersonPhone, setNewPersonPhone] = useState('');
  const [duplicatePendingConfirm, setDuplicatePendingConfirm] = useState(false);

  // New Appointment form + Quick Slot Picker
  const [showBookForm, setShowBookForm] = useState(false);
  const [bookPersonId, setBookPersonId] = useState('');
  const [bookServiceId, setBookServiceId] = useState('');
  const [bookResourceId, setBookResourceId] = useState('');
  const [bookStartsAtLocal, setBookStartsAtLocal] = useState(() =>
    toColomboDatetimeLocal(new Date(Date.now() + 3600_000))
  );

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

  // Doctor delay broadcast
  const [delayResourceId, setDelayResourceId] = useState('');
  const [delayMinutes, setDelayMinutes] = useState(15);

  // Patient Visit History Panel
  const [historyPersonId, setHistoryPersonId] = useState<string | null>(null);

  // Send Rx to Pharmacy Dispense Queue
  const [rxTarget, setRxTarget] = useState<{
    personId: string;
    personName: string;
    appointmentId: string;
    prescriberName: string;
  } | null>(null);
  const [rxProductId, setRxProductId] = useState('');
  const [rxPackVariantId, setRxPackVariantId] = useState('');
  const [rxQtyPacks, setRxQtyPacks] = useState(1);
  const [rxDosage, setRxDosage] = useState('1 tab TDS after meals');
  const [rxNotes, setRxNotes] = useState('');

  // Doctor Schedule & Holiday form states
  const [schedResourceId, setSchedResourceId] = useState('');
  const [schedDayOfWeek, setSchedDayOfWeek] = useState(1);
  const [schedStartTime, setSchedStartTime] = useState('16:00');
  const [schedEndTime, setSchedEndTime] = useState('19:00');
  const [schedSlotMin, setSchedSlotMin] = useState(20);
  const [holidayResourceId, setHolidayResourceId] = useState('');
  const [holidayDate, setHolidayDate] = useState(() => todayColomboDate());
  const [holidayReason, setHolidayReason] = useState('Poya Day / Doctor Leave');

  // Commission split editor
  const [commissionEdits, setCommissionEdits] = useState<Record<string, number>>({});

  const caps = session?.workspace?.capabilities ?? {};
  const hasPharmacyDispense = Boolean(caps['pharmacy.pos'] || caps['pharmacy.catalogue']);

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

  const effectiveDate = selectedDate || data?.businessDate || todayColomboDate();
  const effectiveBookResourceId = bookResourceId || data?.resources[0]?.id || '';
  const slotQueryDate = bookStartsAtLocal.slice(0, 10) || effectiveDate;

  const slotsQuery = useQuery({
    queryKey: ['clinic-slots', activeTenantId, effectiveBookResourceId, slotQueryDate],
    queryFn: () =>
      apiClient.getAvailableDoctorSlots(activeTenantId!, effectiveBookResourceId, slotQueryDate),
    enabled: Boolean(activeTenantId && showBookForm && effectiveBookResourceId && slotQueryDate),
  });

  const historyQuery = useQuery({
    queryKey: ['patient-history', activeTenantId, historyPersonId],
    queryFn: () => apiClient.getPatientVisitHistory(activeTenantId!, historyPersonId!),
    enabled: Boolean(activeTenantId && historyPersonId),
  });

  const schedulesQuery = useQuery({
    queryKey: ['doctor-schedules', activeTenantId],
    queryFn: () => apiClient.getDoctorSchedules(activeTenantId!),
    enabled: Boolean(activeTenantId && activeTab === 'schedules'),
  });

  const holidaysQuery = useQuery({
    queryKey: ['doctor-holidays', activeTenantId],
    queryFn: () => apiClient.getDoctorHolidays(activeTenantId!),
    enabled: Boolean(activeTenantId && activeTab === 'schedules'),
  });

  const payoutsQuery = useQuery({
    queryKey: ['doctor-payouts', activeTenantId, effectiveDate],
    queryFn: () => apiClient.getDoctorPayouts(activeTenantId!, effectiveDate),
    enabled: Boolean(activeTenantId && activeTab === 'payouts'),
  });

  const pharmacyCatalogueQuery = useQuery({
    queryKey: ['pharmacy-catalogue-bridge', activeTenantId],
    queryFn: () => apiClient.getCatalogueProducts(activeTenantId!),
    enabled: Boolean(activeTenantId && hasPharmacyDispense && rxTarget !== null),
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
      queryClient.invalidateQueries({ queryKey: ['clinic-slots', activeTenantId] });
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

  const queueMutation = useMutation({
    mutationFn: (vars: { appointmentId: string; queueState: 'waiting' | 'serving' | 'completed' }) =>
      apiClient.updateAppointmentQueueState(activeTenantId!, vars.appointmentId, {
        queueState: vars.queueState,
      }),
    onSuccess: () => {
      setFeedback({ type: 'ok', text: 'Waiting room display token updated.' });
      queryClient.invalidateQueries({ queryKey: ['today', activeTenantId] });
    },
    onError: (err) => {
      setFeedback({
        type: 'err',
        text: err instanceof ApiClientError ? err.envelope.message : 'Unable to update queue token.',
      });
    },
  });

  const delayBroadcastMutation = useMutation({
    mutationFn: () =>
      apiClient.broadcastDoctorDelay(activeTenantId!, {
        resourceId: delayResourceId || data?.resources[0]?.id || '',
        delayMinutes,
      }),
    onSuccess: (res) => {
      setFeedback({
        type: 'ok',
        text: `Doctor delay (+${res.delayMinutes}m) broadcasted to ${res.affectedTokens} active queue token(s).`,
      });
      queryClient.invalidateQueries({ queryKey: ['today', activeTenantId] });
    },
    onError: (err) => {
      setFeedback({
        type: 'err',
        text: err instanceof ApiClientError ? err.envelope.message : 'Unable to broadcast delay.',
      });
    },
  });

  const reminderMutation = useMutation({
    mutationFn: (apt: NonNullable<typeof data>['appointments'][number]) => {
      const phone = apt.phone || (apt.phoneLast4 ? `077000${apt.phoneLast4}` : '0770000000');
      const timeLabel = formatTimeColombo(apt.startsAt, data?.timezone);
      return apiClient.sendNotification(activeTenantId!, {
        channel: 'whatsapp',
        provider: 'whatsapp_cloud',
        templateType: 'appointment_reminder',
        recipientPhone: phone,
        recipientName: apt.personName,
        entityType: 'appointment',
        entityId: apt.id,
        messageBody: `Ayubowan ${apt.personName}, reminder for your appointment with ${apt.resourceName} at ${timeLabel} (Token #${apt.tokenNumber ?? 1}).`,
      });
    },
    onSuccess: (res) => {
      setFeedback({
        type: 'ok',
        text: `Reminder queued via ${res.dispatch.channel.toUpperCase()} (${res.dispatch.externalRef}).`,
        waLink: res.dispatch.whatsappDeepLink,
      });
    },
    onError: (err) => {
      setFeedback({
        type: 'err',
        text: err instanceof ApiClientError ? err.envelope.message : 'Unable to send reminder.',
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

  const sendRxMutation = useMutation({
    mutationFn: () => {
      const selectedProd =
        pharmacyCatalogueQuery.data?.items.find((p) => p.id === rxProductId) ??
        pharmacyCatalogueQuery.data?.items[0];
      const selectedVar =
        selectedProd?.variants.find((v) => v.id === rxPackVariantId) ??
        selectedProd?.variants[0];
      if (!selectedProd || !selectedVar || !rxTarget) {
        throw new Error('Select a medicine and pack variant.');
      }
      return apiClient.createDispenseOrder(activeTenantId!, {
        personId: rxTarget.personId,
        appointmentId: rxTarget.appointmentId,
        prescriberName: rxTarget.prescriberName,
        clinicalNotes: rxNotes.trim(),
        lines: [
          {
            productId: selectedProd.id,
            packVariantId: selectedVar.id,
            qtyPacks: rxQtyPacks,
            dosageInstruction: rxDosage.trim(),
          },
        ],
      });
    },
    onSuccess: () => {
      setFeedback({
        type: 'ok',
        text: 'Prescription dispatched cleanly to Pharmacy Dispense Queue.',
      });
      setRxTarget(null);
      setRxNotes('');
      queryClient.invalidateQueries({ queryKey: ['pharmacy-dispense-queue', activeTenantId] });
    },
    onError: (err) => {
      setFeedback({
        type: 'err',
        text: err instanceof ApiClientError ? err.envelope.message : 'Unable to send Rx order.',
      });
    },
  });

  const createScheduleMutation = useMutation({
    mutationFn: () =>
      apiClient.createDoctorSchedule(activeTenantId!, {
        resourceId: schedResourceId || data?.resources[0]?.id || '',
        dayOfWeek: schedDayOfWeek,
        startTime: schedStartTime,
        endTime: schedEndTime,
        slotDurationMinutes: schedSlotMin,
      }),
    onSuccess: () => {
      setFeedback({ type: 'ok', text: 'Doctor session template added.' });
      queryClient.invalidateQueries({ queryKey: ['doctor-schedules', activeTenantId] });
    },
    onError: (err) => {
      setFeedback({
        type: 'err',
        text: err instanceof ApiClientError ? err.envelope.message : 'Unable to create schedule.',
      });
    },
  });

  const deleteScheduleMutation = useMutation({
    mutationFn: (id: string) => apiClient.deleteDoctorSchedule(activeTenantId!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['doctor-schedules', activeTenantId] });
    },
  });

  const createHolidayMutation = useMutation({
    mutationFn: () =>
      apiClient.createDoctorHoliday(activeTenantId!, {
        resourceId: holidayResourceId || data?.resources[0]?.id || '',
        blockDate: holidayDate,
        reason: holidayReason.trim(),
      }),
    onSuccess: () => {
      setFeedback({ type: 'ok', text: 'Doctor holiday / leave block recorded.' });
      queryClient.invalidateQueries({ queryKey: ['doctor-holidays', activeTenantId] });
    },
    onError: (err) => {
      setFeedback({
        type: 'err',
        text: err instanceof ApiClientError ? err.envelope.message : 'Unable to add holiday block.',
      });
    },
  });

  const updateCommissionMutation = useMutation({
    mutationFn: (vars: { resourceId: string; doctorSharePercent: number }) =>
      apiClient.upsertDoctorCommission(activeTenantId!, vars),
    onSuccess: () => {
      setFeedback({ type: 'ok', text: 'Doctor channeling commission split updated.' });
      queryClient.invalidateQueries({ queryKey: ['doctor-payouts', activeTenantId] });
    },
    onError: (err) => {
      setFeedback({
        type: 'err',
        text: err instanceof ApiClientError ? err.envelope.message : 'Unable to update commission.',
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

  const selectedRxProduct = useMemo(() => {
    const items = pharmacyCatalogueQuery.data?.items ?? [];
    return items.find((p) => p.id === rxProductId) ?? items[0] ?? null;
  }, [pharmacyCatalogueQuery.data, rxProductId]);

  const toLocalDateTimeString = (iso: string) => {
    const d = new Date(iso);
    const utcPlusColombo = new Date(d.getTime() + 5.5 * 3600_000);
    return utcPlusColombo.toISOString().slice(0, 16);
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-bold neon-heading-glow">{t('today.title')}</h1>
          {data && (
            <p className="text-xs text-cyan-200/80 font-mono-tabular">
              {data.businessDate} · {data.timezone} · {t('today.updatedAt')}:{' '}
              {formatTimeColombo(data.dataFreshAt, data.timezone)}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/queue-display"
            className="min-h-[40px] px-3.5 neon-btn-secondary text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <MonitorPlay className="w-4 h-4 neon-text-cyan" aria-hidden="true" />
            <span>Waiting Room TV</span>
          </Link>
          <Link
            to="/autopilot"
            className="min-h-[40px] px-3.5 neon-btn-secondary text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <QrCode className="w-4 h-4 neon-text-cyan" aria-hidden="true" />
            <span>QR Kiosk &amp; Shift SOP</span>
          </Link>
          <button
            type="button"
            onClick={() => {
              setShowPatientForm((v) => !v);
              setDuplicatePendingConfirm(false);
            }}
            className="min-h-[40px] px-3.5 neon-btn-secondary text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <UserPlus className="w-4 h-4 neon-text-cyan" aria-hidden="true" />
            <span>{t('today.newPatientBtn')}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowBookForm((v) => !v)}
            className="min-h-[40px] px-3.5 neon-btn-primary text-xs rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <CalendarPlus className="w-4 h-4" aria-hidden="true" />
            <span>{t('today.newAppointmentBtn')}</span>
          </button>
          <button
            type="button"
            onClick={() => setShowPaymentForm((v) => !v)}
            className="min-h-[40px] px-3.5 neon-btn-secondary text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <Banknote className="w-4 h-4 neon-text-cyan" aria-hidden="true" />
            <span>{t('today.collectPaymentBtn')}</span>
          </button>
          <input
            type="date"
            aria-label="Business date"
            value={selectedDate || data?.businessDate || ''}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="min-h-[40px] px-3 neon-input rounded-lg text-xs font-mono-tabular"
          />
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="min-h-[40px] px-3 neon-btn-secondary text-xs font-medium rounded-lg inline-flex items-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
            <span>{t('today.refresh')}</span>
          </button>
        </div>
      </div>

      {/* Sub-navigation Tabs */}
      <div className="flex flex-wrap gap-1 p-1 bg-[#040e22] border border-cyan-500/20 rounded-lg w-fit">
        {(
          [
            { key: 'today', label: 'Daily Queue & Schedule' },
            { key: 'schedules', label: 'Doctor Schedules & Holidays' },
            { key: 'payouts', label: 'Doctor Commission Payouts' },
          ] as Array<{ key: BoardTab; label: string }>
        ).map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setActiveTab(tab.key)}
            className={`px-3.5 py-2 text-xs font-medium rounded-md whitespace-nowrap transition-colors ${
              activeTab === tab.key
                ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/40 shadow-[0_0_12px_-4px_rgba(34,211,238,0.45)]'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {feedback && (
        <div
          role={feedback.type === 'err' ? 'alert' : 'status'}
          className={`p-3 rounded-lg border text-sm flex flex-wrap items-center justify-between gap-2 ${
            feedback.type === 'err'
              ? 'bg-rose-950/60 border-rose-400/50 text-rose-200'
              : 'bg-cyan-950/60 border-cyan-400/40 text-cyan-100'
          }`}
        >
          <span>{feedback.text}</span>
          {feedback.waLink && (
            <a
              href={feedback.waLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs font-semibold underline neon-text-cyan"
            >
              <span>Open WhatsApp Thread</span>
              <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
            </a>
          )}
        </div>
      )}

      {activeTab === 'today' && (
        <>
          {/* Quick Patient Registration Form (w/ duplicate disambiguation) */}
          {showPatientForm && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createPersonMutation.mutate(duplicatePendingConfirm);
              }}
              className="neon-card rounded-xl p-5 space-y-3"
            >
              <h2 className="text-sm font-semibold text-white">{t('today.patientDirTitle')}</h2>
              <div className="grid sm:grid-cols-3 gap-3 items-end">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-200">Patient Name *</span>
                  <input
                    required
                    value={newPersonName}
                    onChange={(e) => {
                      setNewPersonName(e.target.value);
                      setDuplicatePendingConfirm(false);
                    }}
                    placeholder="Kasun Perera"
                    className="w-full min-h-[40px] px-3 neon-input rounded-lg text-sm"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-200">Phone</span>
                  <input
                    value={newPersonPhone}
                    onChange={(e) => {
                      setNewPersonPhone(e.target.value);
                      setDuplicatePendingConfirm(false);
                    }}
                    placeholder="0771234567"
                    className="w-full min-h-[40px] px-3 neon-input rounded-lg text-sm font-mono-tabular"
                  />
                </label>
                <button
                  type="submit"
                  disabled={createPersonMutation.isPending}
                  className={`min-h-[40px] px-4 text-xs rounded-lg ${
                    duplicatePendingConfirm
                      ? 'bg-amber-950/80 border border-amber-400/60 text-amber-200 hover:bg-amber-900/80 font-medium'
                      : 'neon-btn-primary'
                  }`}
                >
                  {duplicatePendingConfirm ? t('today.duplicateConfirm') : t('today.newPatientBtn')}
                </button>
              </div>
            </form>
          )}

          {/* Book Appointment Form + Quick Slot Picker */}
          {showBookForm && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createApptMutation.mutate();
              }}
              className="neon-card rounded-xl p-5 space-y-4"
            >
              <h2 className="text-sm font-semibold text-white">{t('today.bookTitle')}</h2>
              <div className="grid sm:grid-cols-5 gap-3 items-end">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-200">Patient *</span>
                  <select
                    value={bookPersonId || peopleQuery.data?.people[0]?.id || ''}
                    onChange={(e) => setBookPersonId(e.target.value)}
                    className="w-full min-h-[40px] px-3 neon-input rounded-lg text-xs"
                  >
                    {peopleQuery.data?.people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.displayName} {p.phone ? `(${p.phone})` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-200">Service *</span>
                  <select
                    value={bookServiceId || data?.services[0]?.id || ''}
                    onChange={(e) => setBookServiceId(e.target.value)}
                    className="w-full min-h-[40px] px-3 neon-input rounded-lg text-xs"
                  >
                    {data?.services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.durationMinutes}m · {formatLkrMinor(s.priceMinor)})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-200">Practitioner *</span>
                  <select
                    value={effectiveBookResourceId}
                    onChange={(e) => setBookResourceId(e.target.value)}
                    className="w-full min-h-[40px] px-3 neon-input rounded-lg text-xs"
                  >
                    {data?.resources.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-200">Start Time (Colombo) *</span>
                  <input
                    type="datetime-local"
                    required
                    value={bookStartsAtLocal}
                    onChange={(e) => setBookStartsAtLocal(e.target.value)}
                    className="w-full min-h-[40px] px-3 neon-input rounded-lg text-xs font-mono-tabular"
                  />
                </label>
                <button
                  type="submit"
                  disabled={createApptMutation.isPending}
                  className="min-h-[40px] px-4 neon-btn-primary text-xs rounded-lg"
                >
                  {createApptMutation.isPending ? 'Booking...' : t('today.newAppointmentBtn')}
                </button>
              </div>

              {slotsQuery.data && (
                <div className="pt-3 border-t border-cyan-500/20 space-y-2">
                  <div className="text-xs font-medium text-cyan-200">
                    Quick Slot Picker ({slotsQuery.data.date})
                  </div>
                  {slotsQuery.data.isHoliday ? (
                    <p className="text-xs text-rose-300 font-medium">
                      Practitioner blocked for holiday/leave: {slotsQuery.data.holidayReason}
                    </p>
                  ) : slotsQuery.data.slots.length === 0 ? (
                    <p className="text-xs text-slate-400">
                      No session template configured for this weekday. Add a session in Doctor Schedules tab or pick custom time above.
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {slotsQuery.data.slots.map((slot) => {
                        const localVal = toLocalDateTimeString(slot.startsAt);
                        const selected = bookStartsAtLocal === localVal;
                        return (
                          <button
                            key={slot.startsAt}
                            type="button"
                            disabled={!slot.available}
                            onClick={() => setBookStartsAtLocal(localVal)}
                            className={`px-2.5 py-1.5 text-xs font-mono-tabular rounded border transition-colors ${
                              !slot.available
                                ? 'bg-[#040e22]/60 border-slate-700/60 text-slate-500 line-through cursor-not-allowed'
                                : selected
                                  ? 'neon-btn-primary border-cyan-300'
                                  : 'bg-[#040e22]/90 border-cyan-500/25 text-slate-200 hover:border-cyan-400'
                            }`}
                          >
                            {slot.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </form>
          )}

          {/* Collect Payment Form */}
          {showPaymentForm && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                paymentMutation.mutate();
              }}
              className="neon-card rounded-xl p-5 space-y-3"
            >
              <h2 className="text-sm font-semibold text-white">{t('today.paymentTitle')}</h2>
              <div className="grid sm:grid-cols-5 gap-3 items-end">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-200">Patient *</span>
                  <select
                    value={payPersonId || peopleQuery.data?.people[0]?.id || ''}
                    onChange={(e) => setPayPersonId(e.target.value)}
                    className="w-full min-h-[40px] px-3 neon-input rounded-lg text-xs"
                  >
                    {peopleQuery.data?.people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-200">Description *</span>
                  <input
                    required
                    value={payDescription}
                    onChange={(e) => setPayDescription(e.target.value)}
                    className="w-full min-h-[40px] px-3 neon-input rounded-lg text-xs"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-200">Amount (LKR) *</span>
                  <input
                    type="number"
                    min={1}
                    required
                    value={payAmountLkr}
                    onChange={(e) => setPayAmountLkr(Number(e.target.value))}
                    className="w-full min-h-[40px] px-3 neon-input rounded-lg text-xs font-mono-tabular"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-200">Method *</span>
                  <select
                    value={payMethod}
                    onChange={(e) => setPayMethod(e.target.value as 'cash' | 'card' | 'bank')}
                    className="w-full min-h-[40px] px-3 neon-input rounded-lg text-xs"
                  >
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="bank">Bank Transfer</option>
                  </select>
                </label>
                <button
                  type="submit"
                  disabled={paymentMutation.isPending}
                  className="min-h-[40px] px-4 neon-btn-primary text-xs rounded-lg"
                >
                  {paymentMutation.isPending ? 'Posting...' : t('today.collectPaymentBtn')}
                </button>
              </div>
            </form>
          )}

          {/* 4-column KPI summary strip */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="neon-card rounded-xl p-4 space-y-1">
              <p className="text-xs text-slate-300">{t('today.total')}</p>
              <p className="text-2xl font-bold font-mono-tabular text-white">
                {isLoading ? '—' : data?.counts.total ?? 0}
              </p>
            </div>
            <div className="neon-card rounded-xl p-4 space-y-1">
              <p className="text-xs text-slate-300">{t('today.scheduled')}</p>
              <p className="text-2xl font-bold font-mono-tabular text-white">
                {isLoading ? '—' : data?.counts.scheduled ?? 0}
              </p>
            </div>
            <div className="neon-card rounded-xl p-4 space-y-1">
              <p className="text-xs text-slate-300">{t('today.arrived')}</p>
              <p className="text-2xl font-bold font-mono-tabular neon-text-cyan">
                {isLoading ? '—' : data?.counts.arrived ?? 0}
              </p>
            </div>
            <div className="neon-card-glow rounded-xl p-4 space-y-1">
              <p className="text-xs text-cyan-200">{t('today.receipts')}</p>
              <p className="text-2xl font-bold font-mono-tabular neon-text-cyan">
                {isLoading
                  ? '—'
                  : error
                    ? 'Unavailable'
                    : formatLkrMinor(data?.recordedReceiptsMinor ?? 0, data?.currency ?? 'LKR')}
              </p>
            </div>
          </div>

          {/* Filter Bar + Doctor Delay Broadcast */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1 p-1 bg-[#040e22] border border-cyan-500/20 rounded-lg w-fit">
              {filterButtons.map((btn) => (
                <button
                  key={btn.key}
                  type="button"
                  onClick={() => setStatusFilter(btn.key)}
                  className={`px-3 py-2 text-xs font-medium rounded-md whitespace-nowrap shrink-0 transition-colors ${
                    statusFilter === btn.key
                      ? 'bg-cyan-500/20 text-cyan-200 border border-cyan-400/40'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {btn.label}
                </button>
              ))}
            </div>

            {data && data.resources.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 neon-card rounded-lg px-3 py-1.5">
                <span className="text-xs font-medium text-cyan-200">Doctor Delay:</span>
                <select
                  value={delayResourceId || data.resources[0]?.id || ''}
                  onChange={(e) => setDelayResourceId(e.target.value)}
                  className="text-xs neon-input rounded px-2 py-1"
                >
                  {data.resources.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <select
                  value={delayMinutes}
                  onChange={(e) => setDelayMinutes(Number(e.target.value))}
                  className="text-xs neon-input rounded px-2 py-1 font-mono-tabular"
                >
                  <option value={15}>+15 min</option>
                  <option value={30}>+30 min</option>
                  <option value={45}>+45 min</option>
                </select>
                <button
                  type="button"
                  disabled={delayBroadcastMutation.isPending}
                  onClick={() => delayBroadcastMutation.mutate()}
                  className="px-2.5 py-1 bg-amber-950/70 border border-amber-400/50 hover:bg-amber-900/70 text-amber-200 text-xs font-medium rounded whitespace-nowrap"
                >
                  Broadcast TV Alert
                </button>
              </div>
            )}
          </div>

          {/* Patient Visit History Panel */}
          {historyPersonId && (
            <div className="neon-card-glow rounded-xl p-5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <History className="w-4 h-4 neon-text-cyan" aria-hidden="true" />
                  <h2>
                    Patient Visit History:{' '}
                    {historyQuery.data?.person.displayName ?? 'Loading...'}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setHistoryPersonId(null)}
                  className="text-xs text-slate-300 hover:text-white"
                >
                  Close History
                </button>
              </div>

              {historyQuery.data && (
                <div className="space-y-3 text-xs">
                  <div className="grid sm:grid-cols-3 gap-3 font-mono-tabular">
                    <div className="p-3 bg-[#040e22]/90 border border-cyan-500/20 rounded-lg">
                      <div className="text-slate-400">Total Visits</div>
                      <div className="text-base font-bold text-white">
                        {historyQuery.data.totalVisits}
                      </div>
                    </div>
                    <div className="p-3 bg-[#040e22]/90 border border-cyan-500/20 rounded-lg">
                      <div className="text-slate-400">Total Paid</div>
                      <div className="text-base font-bold neon-text-cyan">
                        {formatLkrMinor(historyQuery.data.totalPaidMinor)}
                      </div>
                    </div>
                    <div className="p-3 bg-[#040e22]/90 border border-cyan-500/20 rounded-lg">
                      <div className="text-slate-400">Unpaid Balance</div>
                      <div className="text-base font-bold text-amber-300">
                        {formatLkrMinor(historyQuery.data.unpaidBalanceMinor)}
                      </div>
                    </div>
                  </div>

                  {historyQuery.data.appointments.length > 0 && (
                    <div className="divide-y divide-cyan-500/15">
                      {historyQuery.data.appointments.slice(0, 6).map((h) => (
                        <div key={h.id} className="py-2 flex flex-wrap items-center justify-between gap-2 text-slate-200">
                          <div>
                            <span className="font-mono-tabular font-semibold neon-text-cyan">
                              {h.businessDate}
                            </span>{' '}
                            · {h.serviceName} · {h.resourceName} ({h.status})
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setBookPersonId(historyQuery.data!.person.id);
                              setBookServiceId(h.serviceId);
                              setBookResourceId(h.resourceId);
                              setShowBookForm(true);
                              setHistoryPersonId(null);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1 neon-btn-primary rounded text-xs"
                          >
                            <Repeat className="w-3 h-3" aria-hidden="true" />
                            <span>1-Click Rebook</span>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Clinical Consultation -> Pharmacy Dispense Queue Handoff Form */}
          {rxTarget && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendRxMutation.mutate();
              }}
              className="neon-card-glow rounded-xl p-5 space-y-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Pill className="w-4 h-4 neon-text-cyan" aria-hidden="true" />
                  <h2>
                    Send Prescription to Pharmacy Queue — {rxTarget.personName} ({rxTarget.prescriberName})
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setRxTarget(null)}
                  className="text-xs text-slate-300 hover:text-white"
                >
                  Cancel
                </button>
              </div>
              <div className="grid sm:grid-cols-5 gap-3 items-end">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-200">Medicine *</span>
                  <select
                    value={selectedRxProduct?.id ?? ''}
                    onChange={(e) => {
                      setRxProductId(e.target.value);
                      setRxPackVariantId('');
                    }}
                    className="w-full min-h-[38px] px-2.5 neon-input rounded text-xs"
                  >
                    {pharmacyCatalogueQuery.data?.items.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.displayName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-200">Pack *</span>
                  <select
                    value={rxPackVariantId || selectedRxProduct?.variants[0]?.id || ''}
                    onChange={(e) => setRxPackVariantId(e.target.value)}
                    className="w-full min-h-[38px] px-2.5 neon-input rounded text-xs"
                  >
                    {selectedRxProduct?.variants.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.variantName}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-200">Qty Packs</span>
                  <input
                    type="number"
                    min={1}
                    value={rxQtyPacks}
                    onChange={(e) => setRxQtyPacks(Math.max(1, Number(e.target.value)))}
                    className="w-full min-h-[38px] px-2.5 neon-input rounded text-xs font-mono-tabular"
                  />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-cyan-200">Dosage Instructions</span>
                  <input
                    value={rxDosage}
                    onChange={(e) => setRxDosage(e.target.value)}
                    className="w-full min-h-[38px] px-2.5 neon-input rounded text-xs"
                  />
                </label>
                <button
                  type="submit"
                  disabled={sendRxMutation.isPending || !selectedRxProduct}
                  className="min-h-[38px] px-4 neon-btn-primary text-xs rounded"
                >
                  {sendRxMutation.isPending ? 'Dispatching...' : 'Send to POS Queue'}
                </button>
              </div>
              <input
                value={rxNotes}
                onChange={(e) => setRxNotes(e.target.value)}
                placeholder="Clinical notes for pharmacist (optional)"
                className="w-full min-h-[36px] px-3 neon-input rounded text-xs"
              />
            </form>
          )}

          {/* Appointments Table with Write Actions */}
          <div className="neon-card rounded-xl overflow-hidden">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {[1, 2, 3].map((row) => (
                  <div key={row} className="h-11 bg-cyan-500/10 rounded animate-pulse" />
                ))}
              </div>
            ) : error ? (
              <div role="alert" className="p-6 space-y-3">
                <p className="text-sm font-medium text-rose-300">{t('common.errorTitle')}</p>
                <button
                  type="button"
                  onClick={() => refetch()}
                  className="min-h-[40px] px-4 neon-btn-secondary text-xs font-medium rounded-lg"
                >
                  {t('common.retry')}
                </button>
              </div>
            ) : filteredAppointments.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <p className="text-base font-medium text-white">{t('today.emptyTitle')}</p>
                <p className="text-sm text-slate-400">{t('today.emptyDesc')}</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-cyan-500/20 bg-[#040e22]/90 text-xs font-medium text-cyan-200">
                      <th className="py-3 px-4">Token / Time</th>
                      <th className="py-3 px-4">Patient / Person</th>
                      <th className="py-3 px-4">Service</th>
                      <th className="py-3 px-4">Practitioner</th>
                      <th className="py-3 px-4 text-right">Fee</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cyan-500/15 text-sm">
                    {filteredAppointments.map((apt, idx) => (
                      <React.Fragment key={apt.id}>
                        <tr className="hover:bg-cyan-500/5 transition-colors">
                          <td className="py-3.5 px-4 font-mono-tabular whitespace-nowrap text-white">
                            <span className="font-bold neon-text-cyan mr-2">
                              #{apt.tokenNumber ?? idx + 1}
                            </span>
                            {formatTimeColombo(apt.startsAt, data?.timezone)}
                          </td>
                          <td className="py-3.5 px-4">
                            <button
                              type="button"
                              onClick={() => setHistoryPersonId(apt.personId)}
                              className="font-medium text-white hover:text-cyan-300 hover:underline text-left"
                            >
                              {apt.personName}
                            </button>
                            <div className="text-xs text-slate-400 font-mono-tabular">
                              {apt.phoneLast4 ? `···${apt.phoneLast4}` : '—'}
                              {apt.queueState === 'serving' && (
                                <span className="neon-text-cyan font-semibold"> · NOW SERVING</span>
                              )}
                              {apt.isSample && ` · ${t('today.sampleTag')}`}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 text-slate-200">
                            {i18n.language === 'si-LK' && apt.serviceNameSi
                              ? apt.serviceNameSi
                              : apt.serviceName}
                          </td>
                          <td className="py-3.5 px-4 text-slate-200">{apt.resourceName}</td>
                          <td className="py-3.5 px-4 text-right font-mono-tabular neon-text-cyan whitespace-nowrap">
                            {formatLkrMinor(apt.bookedPriceMinor, apt.currency)}
                          </td>
                          <td className="py-3.5 px-4 whitespace-nowrap font-medium text-cyan-100">
                            {t(`today.statusLabels.${apt.status}`)}
                          </td>
                          <td className="py-3.5 px-4 text-right whitespace-nowrap space-x-1">
                            {(apt.status === 'scheduled' || apt.status === 'arrived') && (
                              <button
                                type="button"
                                onClick={() =>
                                  queueMutation.mutate({
                                    appointmentId: apt.id,
                                    queueState: 'serving',
                                  })
                                }
                                className="px-2 py-1 text-xs font-medium neon-btn-secondary rounded"
                              >
                                Call Token
                              </button>
                            )}
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
                                className="px-2.5 py-1 text-xs neon-btn-primary rounded"
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
                                  className="px-2 py-1 text-xs font-medium neon-btn-secondary rounded inline-flex items-center gap-1"
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
                                      startsAtLocal: toColomboDatetimeLocal(new Date(apt.startsAt)),
                                    })
                                  }
                                  className="px-2 py-1 text-xs font-medium neon-btn-secondary rounded inline-flex items-center gap-1"
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
                                  className="px-2 py-1 text-xs neon-btn-primary rounded"
                                >
                                  Pay
                                </button>
                                <button
                                  type="button"
                                  onClick={() => reminderMutation.mutate(apt)}
                                  className="px-2 py-1 text-xs font-medium neon-btn-secondary rounded inline-flex items-center gap-1"
                                >
                                  <BellRing className="w-3 h-3" aria-hidden="true" />
                                  <span>Remind</span>
                                </button>
                                {hasPharmacyDispense && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setRxTarget({
                                        personId: apt.personId,
                                        personName: apt.personName,
                                        appointmentId: apt.id,
                                        prescriberName: apt.resourceName,
                                      })
                                    }
                                    className="px-2 py-1 text-xs font-medium neon-btn-secondary rounded inline-flex items-center gap-1"
                                  >
                                    <Pill className="w-3 h-3" aria-hidden="true" />
                                    <span>Send Rx</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    statusMutation.mutate({
                                      id: apt.id,
                                      status: 'cancelled',
                                      version: apt.version,
                                    })
                                  }
                                  className="px-2 py-1 text-xs font-medium text-rose-300 border border-rose-400/40 bg-rose-950/50 rounded hover:bg-rose-900/50 inline-flex items-center gap-1"
                                >
                                  <XCircle className="w-3 h-3" aria-hidden="true" />
                                  <span>{t('today.cancelAppt')}</span>
                                </button>
                              </>
                            )}
                          </td>
                        </tr>
                        {rescheduleTarget?.id === apt.id && (
                          <tr className="bg-[#040e22]/90">
                            <td colSpan={7} className="p-3">
                              <div className="flex flex-wrap items-center gap-3">
                                <span className="text-xs font-medium text-cyan-200">
                                  New Colombo Start Time:
                                </span>
                                <input
                                  type="datetime-local"
                                  value={rescheduleTarget.startsAtLocal}
                                  onChange={(e) =>
                                    setRescheduleTarget({
                                      ...rescheduleTarget,
                                      startsAtLocal: e.target.value,
                                    })
                                  }
                                  className="min-h-[36px] px-2.5 neon-input rounded text-xs font-mono-tabular"
                                />
                                <button
                                  type="button"
                                  onClick={() => rescheduleMutation.mutate()}
                                  disabled={rescheduleMutation.isPending}
                                  className="min-h-[36px] px-3 neon-btn-primary text-xs rounded"
                                >
                                  Confirm Reschedule
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setRescheduleTarget(null)}
                                  className="min-h-[36px] px-3 neon-btn-secondary text-xs rounded"
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
            <div className="neon-card rounded-xl p-5 space-y-3">
              <h2 className="text-base font-semibold text-white">{t('today.paymentTitle')}</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-cyan-500/20 bg-[#040e22]/90 text-cyan-200">
                      <th className="py-2.5 px-3">Receipt</th>
                      <th className="py-2.5 px-3">Patient</th>
                      <th className="py-2.5 px-3">Method</th>
                      <th className="py-2.5 px-3 text-right">Amount</th>
                      <th className="py-2.5 px-3">Status</th>
                      {canVoidPayment && <th className="py-2.5 px-3 text-right">Action</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-cyan-500/15">
                    {paymentsQuery.data.payments.slice(0, 10).map((p) => (
                      <tr key={p.paymentId} className="hover:bg-cyan-500/5 transition-colors">
                        <td className="py-2.5 px-3 font-mono-tabular font-medium text-white">
                          {p.receiptNumber || p.paymentId.slice(0, 8)}
                        </td>
                        <td className="py-2.5 px-3 text-slate-200">{p.personName}</td>
                        <td className="py-2.5 px-3 uppercase text-slate-300">{p.method}</td>
                        <td className="py-2.5 px-3 text-right font-mono-tabular neon-text-cyan">
                          {formatLkrMinor(p.amountMinor, p.currency)}
                        </td>
                        <td className="py-2.5 px-3 capitalize text-slate-200">{p.status}</td>
                        {canVoidPayment && (
                          <td className="py-2.5 px-3 text-right">
                            {p.status === 'posted' && (
                              <button
                                type="button"
                                onClick={() => voidPaymentMutation.mutate(p.paymentId)}
                                className="px-2.5 py-1 text-rose-300 border border-rose-400/40 bg-rose-950/50 rounded hover:bg-rose-900/50"
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
        </>
      )}

      {/* TAB 2: Doctor Weekly Channeling Sessions & Holiday Blocks */}
      {activeTab === 'schedules' && (
        <div className="grid lg:grid-cols-2 gap-6 items-start">
          <div className="neon-card rounded-xl p-5 space-y-4">
            <h2 className="text-base font-semibold text-white">Weekly Channeling Session Templates</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createScheduleMutation.mutate();
              }}
              className="grid sm:grid-cols-2 gap-3 items-end"
            >
              <label className="block space-y-1">
                <span className="text-xs font-medium text-cyan-200">Practitioner</span>
                <select
                  value={schedResourceId || data?.resources[0]?.id || ''}
                  onChange={(e) => setSchedResourceId(e.target.value)}
                  className="w-full min-h-[38px] px-2.5 neon-input rounded text-xs"
                >
                  {data?.resources.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-cyan-200">Day of Week</span>
                <select
                  value={schedDayOfWeek}
                  onChange={(e) => setSchedDayOfWeek(Number(e.target.value))}
                  className="w-full min-h-[38px] px-2.5 neon-input rounded text-xs"
                >
                  {WEEKDAYS.map((day, idx) => (
                    <option key={day} value={idx}>
                      {day}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-cyan-200">Start Time</span>
                <input
                  type="time"
                  value={schedStartTime}
                  onChange={(e) => setSchedStartTime(e.target.value)}
                  className="w-full min-h-[38px] px-2.5 neon-input rounded text-xs font-mono-tabular"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-cyan-200">End Time</span>
                <input
                  type="time"
                  value={schedEndTime}
                  onChange={(e) => setSchedEndTime(e.target.value)}
                  className="w-full min-h-[38px] px-2.5 neon-input rounded text-xs font-mono-tabular"
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-cyan-200">Slot Minutes</span>
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={schedSlotMin}
                  onChange={(e) => setSchedSlotMin(Number(e.target.value))}
                  className="w-full min-h-[38px] px-2.5 neon-input rounded text-xs font-mono-tabular"
                />
              </label>
              <button
                type="submit"
                disabled={createScheduleMutation.isPending}
                className="min-h-[38px] px-4 neon-btn-primary text-xs rounded"
              >
                Add Session Template
              </button>
            </form>

            <div className="divide-y divide-cyan-500/15 text-xs pt-2">
              {schedulesQuery.data?.schedules.map((s) => (
                <div key={s.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-white">
                      {s.resourceName} · {WEEKDAYS[s.dayOfWeek] ?? s.dayOfWeek}
                    </div>
                    <div className="font-mono-tabular text-cyan-200/80">
                      {s.startTime} – {s.endTime} ({s.slotDurationMinutes}m slots)
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteScheduleMutation.mutate(s.id)}
                    className="p-1.5 text-rose-300 hover:bg-rose-950/60 rounded"
                    aria-label="Delete session"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="neon-card rounded-xl p-5 space-y-4">
            <h2 className="text-base font-semibold text-white">Holiday & Leave Blocks</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                createHolidayMutation.mutate();
              }}
              className="grid sm:grid-cols-2 gap-3 items-end"
            >
              <label className="block space-y-1">
                <span className="text-xs font-medium text-cyan-200">Practitioner</span>
                <select
                  value={holidayResourceId || data?.resources[0]?.id || ''}
                  onChange={(e) => setHolidayResourceId(e.target.value)}
                  className="w-full min-h-[38px] px-2.5 neon-input rounded text-xs"
                >
                  {data?.resources.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-cyan-200">Block Date</span>
                <input
                  type="date"
                  required
                  value={holidayDate}
                  onChange={(e) => setHolidayDate(e.target.value)}
                  className="w-full min-h-[38px] px-2.5 neon-input rounded text-xs font-mono-tabular"
                />
              </label>
              <label className="block space-y-1 sm:col-span-2">
                <span className="text-xs font-medium text-cyan-200">Reason</span>
                <input
                  required
                  value={holidayReason}
                  onChange={(e) => setHolidayReason(e.target.value)}
                  className="w-full min-h-[38px] px-2.5 neon-input rounded text-xs"
                />
              </label>
              <button
                type="submit"
                disabled={createHolidayMutation.isPending}
                className="min-h-[38px] px-4 neon-btn-secondary text-xs font-medium rounded sm:col-span-2"
              >
                Block Date for Doctor
              </button>
            </form>

            <div className="divide-y divide-cyan-500/15 text-xs pt-2">
              {holidaysQuery.data?.holidays.map((h) => (
                <div key={h.id} className="py-2.5 flex items-center justify-between gap-2">
                  <div>
                    <div className="font-semibold text-white font-mono-tabular">
                      {h.blockDate} · {h.resourceName}
                    </div>
                    <div className="text-slate-300">{h.reason}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* TAB 3: Doctor Channeling Commission Payouts */}
      {activeTab === 'payouts' && (
        <div className="space-y-4">
          {payoutsQuery.data && (
            <>
              <div className="grid sm:grid-cols-3 gap-4">
                <div className="neon-card rounded-xl p-4 space-y-1">
                  <div className="text-xs text-slate-300">Total Channeling Fees ({payoutsQuery.data.businessDate})</div>
                  <div className="text-2xl font-bold font-mono-tabular text-white">
                    {formatLkrMinor(payoutsQuery.data.totalGrossMinor, payoutsQuery.data.currency)}
                  </div>
                </div>
                <div className="neon-card-glow rounded-xl p-4 space-y-1">
                  <div className="text-xs text-cyan-200">Doctor Settlement Share</div>
                  <div className="text-2xl font-bold font-mono-tabular neon-text-cyan">
                    {formatLkrMinor(payoutsQuery.data.totalDoctorShareMinor, payoutsQuery.data.currency)}
                  </div>
                </div>
                <div className="neon-card rounded-xl p-4 space-y-1">
                  <div className="text-xs text-slate-300">Clinic Retention Share</div>
                  <div className="text-2xl font-bold font-mono-tabular text-white">
                    {formatLkrMinor(payoutsQuery.data.totalClinicShareMinor, payoutsQuery.data.currency)}
                  </div>
                </div>
              </div>

              <div className="neon-card rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-cyan-500/20 bg-[#040e22]/90 text-cyan-200">
                        <th className="py-3 px-4">Practitioner</th>
                        <th className="py-3 px-4">Visits / Completed</th>
                        <th className="py-3 px-4 text-right">Gross Fees</th>
                        <th className="py-3 px-4">Doctor Share %</th>
                        <th className="py-3 px-4 text-right">Doctor Payout</th>
                        <th className="py-3 px-4 text-right">Clinic Share</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-cyan-500/15">
                      {payoutsQuery.data.doctors.map((doc) => {
                        const editedPct = commissionEdits[doc.resourceId] ?? doc.doctorSharePercent;
                        return (
                          <tr key={doc.resourceId} className="hover:bg-cyan-500/5 transition-colors">
                            <td className="py-3 px-4">
                              <div className="font-semibold text-white">{doc.doctorName}</div>
                              <div className="text-slate-400">{doc.specialty}</div>
                            </td>
                            <td className="py-3 px-4 font-mono-tabular text-slate-200">
                              {doc.visitCount} / {doc.completedCount}
                            </td>
                            <td className="py-3 px-4 text-right font-mono-tabular font-medium text-white">
                              {formatLkrMinor(doc.grossFeesMinor)}
                            </td>
                            <td className="py-3 px-4">
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="number"
                                  min={0}
                                  max={100}
                                  value={editedPct}
                                  onChange={(e) =>
                                    setCommissionEdits((prev) => ({
                                      ...prev,
                                      [doc.resourceId]: Math.min(100, Math.max(0, Number(e.target.value))),
                                    }))
                                  }
                                  className="w-16 min-h-[30px] px-2 neon-input rounded font-mono-tabular"
                                />
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateCommissionMutation.mutate({
                                      resourceId: doc.resourceId,
                                      doctorSharePercent: editedPct,
                                    })
                                  }
                                  className="px-2 py-1 neon-btn-secondary rounded text-[11px] font-medium"
                                >
                                  Save %
                                </button>
                              </div>
                            </td>
                            <td className="py-3 px-4 text-right font-mono-tabular font-semibold neon-text-cyan">
                              {formatLkrMinor(doc.doctorShareMinor)}
                            </td>
                            <td className="py-3 px-4 text-right font-mono-tabular text-white">
                              {formatLkrMinor(doc.clinicShareMinor)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
