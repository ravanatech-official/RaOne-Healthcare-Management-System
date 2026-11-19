import express from 'express';
import { SendNotificationSchema } from '../contracts/api.ts';
import { ValidationError } from '../domain/errors.ts';
import {
  listNotificationDispatches,
  sendNotificationDispatch,
} from '../domain/notifications.ts';
import { requireActiveWorkspace } from '../domain/tenancy.ts';
import { type AuthRequest, requireAuth } from '../middleware/auth.ts';
import { sendApiError } from './error-helper.ts';

export const notificationsRouter = express.Router();

notificationsRouter.use(requireAuth);

notificationsRouter.get('/', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const dispatches = await listNotificationDispatches(context);
    return res.json({ dispatches, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

notificationsRouter.post('/send', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = SendNotificationSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message || 'Invalid notification dispatch payload'
      );
    }
    const dispatch = await sendNotificationDispatch(context, parsed.data, correlationId);
    return res.status(201).json({ dispatch, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});
