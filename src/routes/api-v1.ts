import crypto from 'node:crypto';
import express, { type Response } from 'express';
import { z } from 'zod';
import {
  InterpretTurnInputSchema,
  JarvisConverseInputSchema,
  OnboardingBootstrapSchema,
  SupportedLocaleSchema,
} from '../contracts/api.ts';
import { db, isDatabaseConfigured } from '../db/index.ts';
import { auditEvents } from '../db/schema.ts';
import { updateUserPreferredLocale } from '../db/users.ts';
import { ValidationError } from '../domain/errors.ts';
import { addMemAuditEvent } from '../domain/memory-store.ts';
import {
  formatCombinedZReportCsv,
  getCombinedZReport,
} from '../domain/pharmacy-ops.ts';
import { listTeamMembers, listWorkspaceAuditEvents } from '../domain/team-ops.ts';
import {
  assertCapability,
  assertPermission,
  bootstrapClinicWorkspace,
  getBusinessDateInTimezone,
  requireActiveWorkspace,
  resolveSessionContext,
} from '../domain/tenancy.ts';
import { getAppointmentByIdForTenant, getTodayWorkspaceSummary } from '../domain/today.ts';
import { interpretAdministrativeUtterance } from '../adapters/gemini.ts';
import {
  runJarvisConversationalTurn,
  synthesizeJarvisSpeech,
} from '../adapters/gemini-jarvis.ts';
import { type AuthRequest, attachCorrelationId, requireAuth } from '../middleware/auth.ts';
import { sendApiError } from './error-helper.ts';
import { clinicRouter } from './clinic.ts';
import { notificationsRouter } from './notifications.ts';
import { pharmacyRouter } from './pharmacy.ts';
import { platformRouter } from './platform.ts';
import { billingRouter } from './billing.ts';
import { accountsRouter } from './accounts.ts';
import { purchasingRouter } from './purchasing.ts';
import { hrAdminRouter } from './hr-admin.ts';
import { autopilotRouter } from './autopilot.ts';
import { publicRouter } from './public.ts';

export const apiV1Router = express.Router();

apiV1Router.use(attachCorrelationId);

function sendError(res: Response, error: unknown, correlationId: string) {
  return sendApiError(res, error, correlationId);
}

// Health endpoint (no eager DB probe; liveness only)
apiV1Router.get('/health', (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    status: 'ok',
    service: 'suwaseva-clinic-api',
    apiVersion: 'v1',
    correlationId: req.correlationId,
    timestamp: new Date().toISOString(),
  });
});

// 1. Session & workspace membership context
apiV1Router.get('/session/context', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const { session } = await resolveSessionContext(req.authUser!, requestedTenantId);
    return res.json(session);
  } catch (error) {
    return sendError(res, error, correlationId);
  }
});

// 2. Controlled Owner Onboarding Bootstrap
apiV1Router.post('/onboarding/bootstrap', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const parsed = OnboardingBootstrapSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message || 'Invalid onboarding details',
        'errors.onboarding_invalid'
      );
    }
    const workspace = await bootstrapClinicWorkspace(req.authUser!, parsed.data, correlationId);
    return res.status(201).json({
      created: true,
      workspace,
      correlationId,
    });
  } catch (error) {
    return sendError(res, error, correlationId);
  }
});

// 3. Update user preferred UI language (si-LK / en-LK)
apiV1Router.post('/user/locale', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const schema = z.object({ preferredLocale: SupportedLocaleSchema });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Unsupported locale', 'errors.unsupported_locale');
    }

    await updateUserPreferredLocale(req.authUser!.id, parsed.data.preferredLocale);

    return res.json({
      preferredLocale: parsed.data.preferredLocale,
      correlationId,
    });
  } catch (error) {
    return sendError(res, error, correlationId);
  }
});

// 4. Authorised Today Board Read (Clinic mode capability check)
apiV1Router.get('/today', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    assertCapability(context, 'appointments.manage');
    assertPermission(context, 'appointments.read');
    const requestedDate = typeof req.query.date === 'string' ? req.query.date : undefined;
    const summary = await getTodayWorkspaceSummary(context, requestedDate);
    return res.json(summary);
  } catch (error) {
    return sendError(res, error, correlationId);
  }
});

// 5. Tenant-isolated Appointment Detail Read
apiV1Router.get('/appointments/:id', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    assertCapability(context, 'appointments.manage');
    assertPermission(context, 'appointments.read');
    const appointmentId = String(req.params.id);
    const appointment = await getAppointmentByIdForTenant(context, appointmentId);
    return res.json({ appointment, correlationId });
  } catch (error) {
    return sendError(res, error, correlationId);
  }
});

// 6. Legacy Read-only Assistant Utterance Interpretation
apiV1Router.post('/assistant/interpret', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    assertCapability(context, 'assistant.text');

    const parsed = InterpretTurnInputSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid assistant message input', 'errors.validation_failed');
    }

    const businessDate = getBusinessDateInTimezone(context.timezone);
    const interpretation = await interpretAdministrativeUtterance({
      text: parsed.data.text,
      locale: parsed.data.locale,
      timezone: context.timezone,
      businessDate,
    });

    if (!isDatabaseConfigured) {
      addMemAuditEvent({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorUid: context.uid,
        action: 'assistant.utterance_interpreted',
        entityType: 'assistant_turn',
        entityId: crypto.randomUUID(),
        inputSource: parsed.data.source,
        correlationId,
        metadataJson: {
          intent: interpretation.intent,
          status: interpretation.status,
          modelVersion: interpretation.modelVersion,
        },
      });
    } else {
      await db.insert(auditEvents).values({
        tenantId: context.tenantId,
        actorUserId: context.userId,
        actorUid: context.uid,
        action: 'assistant.utterance_interpreted',
        entityType: 'assistant_turn',
        entityId: crypto.randomUUID(),
        inputSource: parsed.data.source,
        correlationId,
        metadataJson: {
          intent: interpretation.intent,
          status: interpretation.status,
          modelVersion: interpretation.modelVersion,
        },
      });
    }

    return res.json({
      interpretation,
      correlationId,
    });
  } catch (error) {
    return sendError(res, error, correlationId);
  }
});

// 6b. J.A.R.V.I.S. Conversational Voice/Text Turn (Live Tool-Calling + Draft->Confirm + Quota)
apiV1Router.post('/assistant/converse', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = JarvisConverseInputSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message || 'Invalid J.A.R.V.I.S. conversation input',
        'errors.validation_failed'
      );
    }
    const response = await runJarvisConversationalTurn(context, parsed.data, correlationId);
    return res.json({ ...response, correlationId });
  } catch (error) {
    return sendError(res, error, correlationId);
  }
});

// 6c. J.A.R.V.I.S. Speech Synthesis (Gemini TTS WAV or Browser SpeechSynthesis fallback)
apiV1Router.post('/assistant/tts', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    assertCapability(context, 'assistant.voice');
    const schema = z.object({
      text: z.string().trim().min(1).max(600),
      locale: SupportedLocaleSchema.default('si-LK'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid TTS payload');
    }
    const speech = await synthesizeJarvisSpeech(parsed.data.text, parsed.data.locale);
    return res.json({ ...speech, correlationId });
  } catch (error) {
    return sendError(res, error, correlationId);
  }
});

// 7. Team Members & Role Matrix (Scoped to active tenant)
apiV1Router.get('/team', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const members = await listTeamMembers(context);
    return res.json({ members, correlationId });
  } catch (error) {
    return sendError(res, error, correlationId);
  }
});

// 8. Scoped Audit Events (Owner / Manager only)
apiV1Router.get('/audit', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const events = await listWorkspaceAuditEvents(context);
    return res.json({ events, correlationId });
  } catch (error) {
    return sendError(res, error, correlationId);
  }
});

// 8b. Combined Daily Profit & Reconciliation Z-Report (JSON & CSV)
apiV1Router.get('/reports/z-report', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const dateStr = typeof req.query.date === 'string' ? req.query.date : undefined;
    const report = await getCombinedZReport(context, dateStr);
    return res.json({ report, correlationId });
  } catch (error) {
    return sendError(res, error, correlationId);
  }
});

apiV1Router.get('/reports/z-report.csv', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const dateStr = typeof req.query.date === 'string' ? req.query.date : undefined;
    const report = await getCombinedZReport(context, dateStr);
    const csv = formatCombinedZReportCsv(report);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="suwaseva-z-report-${report.businessDate}.csv"`
    );
    return res.send(csv);
  } catch (error) {
    return sendError(res, error, correlationId);
  }
});

// 9. Modular Platform, Billing, Notifications, Clinic Writes, Pharmacy & Department Add-On Routers
apiV1Router.use('/platform', platformRouter);
apiV1Router.use('/billing', billingRouter);
apiV1Router.use('/notifications', notificationsRouter);
apiV1Router.use('/clinic', clinicRouter);
apiV1Router.use('/pharmacy', pharmacyRouter);
apiV1Router.use('/accounts', accountsRouter);
apiV1Router.use('/purchasing', purchasingRouter);
apiV1Router.use('/hr-admin', hrAdminRouter);
apiV1Router.use('/autopilot', autopilotRouter);
apiV1Router.use('/public', publicRouter);
