import express from 'express';
import { z } from 'zod';
import {
  CompleteShiftChecklistSchema,
  ToggleChecklistItemSchema,
  UpdateGovernanceRulesSchema,
} from '../contracts/api.ts';
import {
  completeShiftChecklist,
  generateAndDispatchOwnerBriefing,
  generateAutoDraftPurchaseOrders,
  getAutopilotCockpit,
  toggleShiftChecklistItem,
  updateGovernanceRules,
} from '../domain/autopilot-ops.ts';
import { ValidationError } from '../domain/errors.ts';
import { requireActiveWorkspace } from '../domain/tenancy.ts';
import { type AuthRequest, requireAuth } from '../middleware/auth.ts';
import { sendApiError } from './error-helper.ts';

export const autopilotRouter = express.Router();

autopilotRouter.get('/cockpit', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(
      req.authUser!,
      req.header('x-tenant-id') || undefined
    );
    const date = typeof req.query.date === 'string' ? req.query.date : undefined;
    const cockpit = await getAutopilotCockpit(context, date);
    return res.json({ cockpit, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

autopilotRouter.put('/governance', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(
      req.authUser!,
      req.header('x-tenant-id') || undefined
    );
    const parsed = UpdateGovernanceRulesSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message || 'Invalid governance rule values'
      );
    }
    const rules = await updateGovernanceRules(context, parsed.data, correlationId);
    return res.json({ rules, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

autopilotRouter.post('/checklists/:id/toggle', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(
      req.authUser!,
      req.header('x-tenant-id') || undefined
    );
    const parsed = ToggleChecklistItemSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message || 'Invalid checklist item payload'
      );
    }
    const checklist = await toggleShiftChecklistItem(
      context,
      String(req.params.id),
      parsed.data,
      req.authUser!.displayName || req.authUser!.email || 'Staff Member',
      correlationId
    );
    return res.json({ checklist, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

autopilotRouter.post('/checklists/:id/complete', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(
      req.authUser!,
      req.header('x-tenant-id') || undefined
    );
    const parsed = CompleteShiftChecklistSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message || 'Invalid checklist sign-off payload'
      );
    }
    const checklist = await completeShiftChecklist(
      context,
      String(req.params.id),
      parsed.data,
      correlationId
    );
    return res.json({ checklist, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

autopilotRouter.post('/reorders/draft-pos', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(
      req.authUser!,
      req.header('x-tenant-id') || undefined
    );
    const result = await generateAutoDraftPurchaseOrders(context, correlationId);
    return res.status(201).json({ ...result, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

autopilotRouter.post('/briefings/generate', requireAuth, async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const context = await requireActiveWorkspace(
      req.authUser!,
      req.header('x-tenant-id') || undefined
    );
    const parsed = z
      .object({ sendWhatsapp: z.boolean().optional().default(true) })
      .safeParse(req.body ?? {});
    const sendWhatsapp = parsed.success ? parsed.data.sendWhatsapp : true;
    const briefing = await generateAndDispatchOwnerBriefing(
      context,
      { sendWhatsapp },
      correlationId
    );
    return res.status(201).json({ briefing, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});
