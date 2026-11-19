import express from 'express';
import { z } from 'zod';
import {
  GenerateSubscriptionInvoiceSchema,
  PayHereWebhookSchema,
  PaySubscriptionInvoiceSchema,
  UpdateSubscriptionPlanSchema,
} from '../contracts/api.ts';
import { ValidationError } from '../domain/errors.ts';
import { sendNotificationDispatch } from '../domain/notifications.ts';
import {
  confirmBankTransferPayment,
  generateNextMonthlyInvoice,
  getSubscriptionOverview,
  getWorkspaceQuotaSummary,
  paySubscriptionInvoice,
  processPayHereWebhook,
  triggerSandboxPayHereWebhook,
  updateSubscriptionPlan,
} from '../domain/subscription-billing.ts';
import { requireActiveWorkspace } from '../domain/tenancy.ts';
import { type AuthRequest, requireAuth } from '../middleware/auth.ts';
import { sendApiError } from './error-helper.ts';

export const billingRouter = express.Router();

// Public callback endpoint for PayHere / WebXPay / Genie server-to-server webhook (verified via MD5 signature)
billingRouter.post('/webhooks/payhere', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const correlationId = req.correlationId!;
  try {
    const parsed = PayHereWebhookSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message || 'Invalid PayHere webhook payload'
      );
    }
    const result = await processPayHereWebhook(parsed.data, correlationId);
    return res.json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

billingRouter.use(requireAuth);

billingRouter.get('/overview', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const overview = await getSubscriptionOverview(context);
    return res.json({ ...overview, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

billingRouter.get('/quotas', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const quotas = await getWorkspaceQuotaSummary(context);
    return res.json({ quotas, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

billingRouter.patch('/plan', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = UpdateSubscriptionPlanSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message || 'Invalid subscription plan selection'
      );
    }
    const overview = await updateSubscriptionPlan(context, parsed.data, correlationId);
    return res.json({ ...overview, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

billingRouter.post('/invoices', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = GenerateSubscriptionInvoiceSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message || 'Invalid invoice generation request'
      );
    }
    const overview = await generateNextMonthlyInvoice(context, parsed.data, correlationId);
    return res.status(201).json({ ...overview, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

billingRouter.post('/pay', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const parsed = PaySubscriptionInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError(
        parsed.error.issues[0]?.message || 'Invalid subscription payment details'
      );
    }
    const result = await paySubscriptionInvoice(context, parsed.data, correlationId);
    return res.status(201).json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

billingRouter.post('/payments/:id/confirm', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const overview = await confirmBankTransferPayment(
      context,
      String(req.params.id),
      correlationId
    );
    return res.json({ ...overview, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

billingRouter.post('/webhooks/payhere/sandbox-trigger', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const schema = z.object({
      invoiceId: z.string().min(4),
      statusCode: z.enum(['2', '-1', '-2']).default('2'),
      gatewayProvider: z.enum(['payhere', 'webxpay', 'genie']).default('payhere'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid sandbox webhook trigger request');
    }
    const result = await triggerSandboxPayHereWebhook(context, parsed.data, correlationId);
    return res.json({ ...result, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});

billingRouter.post('/notifications/invoice-reminder', async (req: AuthRequest, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const correlationId = req.correlationId!;
  try {
    const requestedTenantId = req.header('x-tenant-id') || undefined;
    const context = await requireActiveWorkspace(req.authUser!, requestedTenantId);
    const schema = z.object({
      invoiceId: z.string().min(4),
      recipientPhone: z.string().trim().min(7).max(24),
      channel: z.enum(['whatsapp', 'sms']).default('whatsapp'),
      provider: z.enum(['whatsapp_cloud', 'notify_lk', 'dialog_sms', 'mobitel_sms']).default('whatsapp_cloud'),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid invoice reminder request');
    }
    const overview = await getSubscriptionOverview(context);
    const inv =
      overview.invoices.find((i) => i.id === parsed.data.invoiceId) ?? overview.invoices[0];
    if (!inv) {
      throw new ValidationError('No invoice found to remind');
    }
    const amountLkr = ((inv.totalMinor - inv.paidMinor) / 100).toLocaleString('en-LK', {
      minimumFractionDigits: 2,
    });
    const messageBody =
      inv.status === 'paid'
        ? `SuwaSeva Payment Receipt: Invoice ${inv.invoiceNumber} (LKR ${(inv.totalMinor / 100).toLocaleString('en-LK')}) for ${context.tenantName} is PAID. Thank you!`
        : `SuwaSeva Billing Reminder: Invoice ${inv.invoiceNumber} (LKR ${amountLkr}) for ${context.tenantName} is due on ${inv.dueDate}. Pay easily via PayHere/LankaQR inside SuwaSeva Billing.`;

    const dispatch = await sendNotificationDispatch(
      context,
      {
        channel: parsed.data.channel,
        provider: parsed.data.provider,
        templateType: inv.status === 'paid' ? 'payment_receipt' : 'invoice_due',
        recipientPhone: parsed.data.recipientPhone,
        recipientName: context.tenantName,
        messageBody,
        entityType: 'subscription_invoice',
        entityId: inv.id,
      },
      correlationId,
      { bypassGraceCheck: true }
    );
    return res.status(201).json({ dispatch, correlationId });
  } catch (error) {
    return sendApiError(res, error, correlationId);
  }
});
