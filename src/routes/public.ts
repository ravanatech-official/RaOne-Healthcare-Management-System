import express from 'express';
import { PublicSelfCheckInSchema } from '../contracts/api.ts';
import {
  getPublicKioskInfo,
  submitPublicSelfCheckIn,
} from '../domain/autopilot-ops.ts';
import { ValidationError } from '../domain/errors.ts';
import type { AuthRequest } from '../middleware/auth.ts';
import { sendApiError } from './error-helper.ts';

export const publicRouter = express.Router();

publicRouter.get('/kiosk/:tenantSlug', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const correlationId = req.correlationId!;
  try {
    const branchId = typeof req.query.branchId === 'string' ? req.query.branchId : undefined;
    const info = await getPublicKioskInfo(String(req.params.tenantSlug), branchId);
    return res.json({ kiosk: info, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});

publicRouter.post('/kiosk/:tenantSlug/checkin', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const correlationId = req.correlationId!;
  try {
    const parsed = PublicSelfCheckInSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message || 'Please complete name, phone, service and doctor selection'
      );
    }
    const result = await submitPublicSelfCheckIn(
      String(req.params.tenantSlug),
      parsed.data,
      correlationId
    );
    return res.status(201).json({ checkin: result, correlationId });
  } catch (err) {
    return sendApiError(res, err, correlationId);
  }
});
