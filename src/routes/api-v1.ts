import crypto from 'node:crypto';
import express, { type Response } from 'express';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  InterpretTurnInputSchema,
  OnboardingBootstrapSchema,
  SupportedLocaleSchema,
} from '../contracts/api.ts';
import { db } from '../db/index.ts';
import { auditEvents, branches, memberships, users } from '../db/schema.ts';
import { DomainError, ValidationError } from '../domain/errors.ts';
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
import { type AuthRequest, attachCorrelationId, requireAuth } from '../middleware/auth.ts';
import { sendApiError } from './error-helper.ts';
import { clinicRouter } from './clinic.ts';
import { pharmacyRouter } from './pharmacy.ts';
import { platformRouter } from './platform.ts';

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

    await db
      .update(users)
      .set({ preferredLocale: parsed.data.preferredLocale, updatedAt: new Date() })
      .where(eq(users.id, req.authUser!.id));

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

// 6. Read-only Assistant Utterance Interpretation (never writes to DB)
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

    return res.json({
      interpretation,
      correlationId,
    });
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

    const rows = await db
      .select({
        membershipId: memberships.id,
        userId: memberships.userId,
        role: memberships.role,
        active: memberships.active,
        branchName: branches.name,
        email: users.email,
        displayName: users.displayName,
        createdAt: memberships.createdAt,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .innerJoin(branches, eq(memberships.branchId, branches.id))
      .where(eq(memberships.tenantId, context.tenantId));

    return res.json({
      members: rows,
      correlationId,
    });
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
    assertPermission(context, 'audit.read');

    const events = await db
      .select({
        id: auditEvents.id,
        action: auditEvents.action,
        entityType: auditEvents.entityType,
        entityId: auditEvents.entityId,
        inputSource: auditEvents.inputSource,
        correlationId: auditEvents.correlationId,
        metadataJson: auditEvents.metadataJson,
        createdAt: auditEvents.createdAt,
      })
      .from(auditEvents)
      .where(eq(auditEvents.tenantId, context.tenantId))
      .orderBy(desc(auditEvents.createdAt))
      .limit(50);

    return res.json({ events, correlationId });
  } catch (error) {
    return sendError(res, error, correlationId);
  }
});

// 9. Modular Platform, Clinic Writes & Pharmacy Routers
apiV1Router.use('/platform', platformRouter);
apiV1Router.use('/clinic', clinicRouter);
apiV1Router.use('/pharmacy', pharmacyRouter);
