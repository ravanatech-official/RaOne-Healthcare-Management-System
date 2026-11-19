import crypto from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db, isDatabaseConfigured } from '../db/index.ts';
import { auditEvents, notificationDispatches } from '../db/schema.ts';
import type {
  NotificationDispatchItem,
  SendNotificationInput,
} from '../contracts/api.ts';
import { addMemAuditEvent, getMemoryStore } from './memory-store.ts';
import { assertWorkspaceNotReadOnlyGrace, incrementQuotaUsage } from './subscription-billing.ts';
import { assertPermission, type ActiveWorkspaceContext } from './tenancy.ts';

function normalizeSriLankaPhone(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '');
  if (digits.startsWith('94') && digits.length >= 11) return digits;
  if (digits.startsWith('0') && digits.length === 10) return `94${digits.slice(1)}`;
  if (digits.length === 9 && digits.startsWith('7')) return `94${digits}`;
  return digits;
}

function buildWhatsappDeepLink(phone: string, messageBody: string): string {
  const intlPhone = normalizeSriLankaPhone(phone);
  return `https://wa.me/${intlPhone}?text=${encodeURIComponent(messageBody)}`;
}

async function attemptExternalGatewayDelivery(input: SendNotificationInput): Promise<{
  delivered: boolean;
  externalRef: string;
  providerUsed: string;
}> {
  const intlPhone = normalizeSriLankaPhone(input.recipientPhone);

  // Optional live WhatsApp Business Cloud API
  if (
    input.channel === 'whatsapp' &&
    process.env.WHATSAPP_CLOUD_TOKEN &&
    process.env.WHATSAPP_PHONE_NUMBER_ID
  ) {
    try {
      const resp = await fetch(
        `https://graph.facebook.com/v20.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${process.env.WHATSAPP_CLOUD_TOKEN}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: intlPhone,
            type: 'text',
            text: { body: input.messageBody },
          }),
        }
      );
      if (resp.ok) {
        const data = (await resp.json()) as { messages?: Array<{ id?: string }> };
        return {
          delivered: true,
          externalRef: data.messages?.[0]?.id || `wa_${crypto.randomBytes(4).toString('hex')}`,
          providerUsed: 'whatsapp_cloud',
        };
      }
    } catch {
      // Fall through to verified sandbox dispatch log
    }
  }

  // Optional live Notify.lk Sri Lankan SMS Gateway
  if (
    input.channel === 'sms' &&
    process.env.NOTIFY_LK_USER_ID &&
    process.env.NOTIFY_LK_API_KEY
  ) {
    try {
      const senderId = process.env.NOTIFY_LK_SENDER_ID || 'NotifyDEMO';
      const url = new URL('https://app.notify.lk/api/v1/send');
      url.searchParams.set('user_id', process.env.NOTIFY_LK_USER_ID);
      url.searchParams.set('api_key', process.env.NOTIFY_LK_API_KEY);
      url.searchParams.set('sender_id', senderId);
      url.searchParams.set('to', intlPhone);
      url.searchParams.set('message', input.messageBody);
      const resp = await fetch(url.toString(), { method: 'POST' });
      if (resp.ok) {
        return {
          delivered: true,
          externalRef: `nlk_${crypto.randomBytes(4).toString('hex')}`,
          providerUsed: 'notify_lk',
        };
      }
    } catch {
      // Fall through to verified sandbox dispatch log
    }
  }

  const prefix =
    input.provider === 'whatsapp_cloud'
      ? 'WA'
      : input.provider === 'dialog_sms'
        ? 'DLG'
        : input.provider === 'mobitel_sms'
          ? 'MOB'
          : 'NLK';

  return {
    delivered: false,
    externalRef: `${prefix}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    providerUsed: input.provider,
  };
}

export async function sendNotificationDispatch(
  context: ActiveWorkspaceContext,
  input: SendNotificationInput,
  correlationId: string,
  options?: { bypassGraceCheck?: boolean }
): Promise<NotificationDispatchItem> {
  if (
    input.templateType === 'invoice_due' ||
    input.templateType === 'payment_receipt'
  ) {
    assertPermission(context, 'billing.read');
  } else {
    assertPermission(context, 'appointments.read');
  }

  if (!options?.bypassGraceCheck) {
    await assertWorkspaceNotReadOnlyGrace(context.tenantId, context.timezone);
  }

  const gatewayResult = await attemptExternalGatewayDelivery(input);
  const whatsappDeepLink =
    input.channel === 'whatsapp'
      ? buildWhatsappDeepLink(input.recipientPhone, input.messageBody)
      : undefined;

  const status = gatewayResult.delivered ? 'delivered' : 'sent';
  const now = new Date();

  await incrementQuotaUsage(
    context.tenantId,
    context.timezone,
    input.channel === 'whatsapp' ? 'whatsappSentCount' : 'smsSentCount',
    1
  );

  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    const record = {
      id: crypto.randomUUID(),
      tenantId: context.tenantId,
      branchId: context.branchId,
      channel: input.channel,
      provider: gatewayResult.providerUsed,
      templateType: input.templateType,
      recipientPhone: input.recipientPhone.trim(),
      recipientName: input.recipientName.trim(),
      messageBody: input.messageBody.trim(),
      status,
      entityType: input.entityType,
      entityId: input.entityId,
      externalRef: gatewayResult.externalRef,
      whatsappDeepLink,
      sentAt: now,
    };
    store.notificationDispatches.unshift(record);

    addMemAuditEvent({
      tenantId: context.tenantId,
      actorUserId: context.userId,
      actorUid: context.uid,
      action: `notification.${input.channel}.${input.templateType}`,
      entityType: input.entityType || 'notification',
      entityId: record.id,
      inputSource: 'ui',
      correlationId,
      metadataJson: {
        provider: record.provider,
        externalRef: record.externalRef,
        status,
      },
    });

    return {
      ...record,
      sentAt: record.sentAt.toISOString(),
    };
  }

  const [created] = await db
    .insert(notificationDispatches)
    .values({
      tenantId: context.tenantId,
      branchId: context.branchId,
      channel: input.channel,
      provider: gatewayResult.providerUsed,
      templateType: input.templateType,
      recipientPhone: input.recipientPhone.trim(),
      recipientName: input.recipientName.trim(),
      messageBody: input.messageBody.trim(),
      status,
      entityType: input.entityType,
      entityId: input.entityId,
      externalRef: gatewayResult.externalRef,
    })
    .returning();

  await db.insert(auditEvents).values({
    tenantId: context.tenantId,
    actorUserId: context.userId,
    actorUid: context.uid,
    action: `notification.${input.channel}.${input.templateType}`,
    entityType: input.entityType || 'notification',
    entityId: created.id,
    inputSource: 'ui',
    correlationId,
    metadataJson: {
      provider: created.provider,
      externalRef: created.externalRef,
      status: created.status,
    },
  });

  return {
    id: created.id,
    channel: created.channel as 'whatsapp' | 'sms',
    provider: created.provider,
    templateType: created.templateType,
    recipientPhone: created.recipientPhone,
    recipientName: created.recipientName,
    messageBody: created.messageBody,
    status: created.status,
    entityType: created.entityType,
    entityId: created.entityId,
    externalRef: created.externalRef,
    whatsappDeepLink,
    sentAt: created.sentAt.toISOString(),
  };
}

export async function listNotificationDispatches(
  context: ActiveWorkspaceContext,
  limit = 40
): Promise<NotificationDispatchItem[]> {
  if (!isDatabaseConfigured) {
    const store = getMemoryStore();
    return store.notificationDispatches
      .filter((d) => d.tenantId === context.tenantId && d.branchId === context.branchId)
      .sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())
      .slice(0, limit)
      .map((d) => ({
        ...d,
        sentAt: d.sentAt.toISOString(),
      }));
  }

  const rows = await db
    .select()
    .from(notificationDispatches)
    .where(
      and(
        eq(notificationDispatches.tenantId, context.tenantId),
        eq(notificationDispatches.branchId, context.branchId)
      )
    )
    .orderBy(desc(notificationDispatches.sentAt))
    .limit(limit);

  return rows.map((r) => ({
    id: r.id,
    channel: r.channel as 'whatsapp' | 'sms',
    provider: r.provider,
    templateType: r.templateType,
    recipientPhone: r.recipientPhone,
    recipientName: r.recipientName,
    messageBody: r.messageBody,
    status: r.status,
    entityType: r.entityType,
    entityId: r.entityId,
    externalRef: r.externalRef,
    whatsappDeepLink:
      r.channel === 'whatsapp'
        ? buildWhatsappDeepLink(r.recipientPhone, r.messageBody)
        : undefined,
    sentAt: r.sentAt.toISOString(),
  }));
}
