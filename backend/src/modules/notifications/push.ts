import { existsSync, readFileSync } from 'node:fs';

import { and, eq, inArray } from 'drizzle-orm';
import { sendNotification, setVapidDetails } from 'web-push';

import { isInboxRealtimeEvent } from '@sirpefoffice/shared';
import type {
  InboxRealtimeEventPayload,
  RealtimeEvent,
} from '@sirpefoffice/shared';

import { db } from '../../db/index.js';
import { pushSubscriptions } from '../../db/schema.js';
import { env } from '../../env.js';

export interface PushPayload {
  title: string;
  body: string;
  /** Ruta que se abre al pulsar. */
  url: string;
  messageId?: string;
  documentId?: string;
  type: string;
}

let webPushConfigured = false;
let webPushTried = false;
let fcmApp: unknown = null;

function ensureWebPush(): boolean {
  if (webPushTried) return webPushConfigured;
  webPushTried = true;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    console.info('Web Push desactivado: faltan VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY.');
    return false;
  }
  try {
    setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
    webPushConfigured = true;
    return true;
  } catch (error) {
    console.error('No se pudo configurar Web Push:', error);
    return false;
  }
}

/** Clave pública que el navegador necesita para suscribirse. */
export function vapidPublicKey(): string | null {
  if (!env.VAPID_PUBLIC_KEY) return null;
  ensureWebPush();
  return webPushConfigured ? env.VAPID_PUBLIC_KEY : null;
}

async function sendWebPush(
  subscriptions: Array<{
    id: string;
    endpoint: string;
    p256dh: string | null;
    auth: string | null;
  }>,
  payload: PushPayload,
): Promise<void> {
  if (subscriptions.length === 0 || !ensureWebPush()) return;

  const body = JSON.stringify(payload);
  await Promise.all(
    subscriptions.map(async (subscription) => {
      if (!subscription.p256dh || !subscription.auth) return;
      try {
        await sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          body,
          { TTL: 60 * 60 },
        );
        await db
          .update(pushSubscriptions)
          .set({ lastUsedAt: new Date(), failureCount: 0 })
          .where(eq(pushSubscriptions.id, subscription.id));
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, subscription.id));
          return;
        }
        await db
          .update(pushSubscriptions)
          .set({ failureCount: 1, status: status && status >= 400 ? 'expired' : 'active' })
          .where(eq(pushSubscriptions.id, subscription.id));
      }
    }),
  );
}

function readServiceAccount(): Record<string, unknown> | null {
  const value = env.FCM_SERVICE_ACCOUNT_JSON.trim();
  if (!value) return null;
  try {
    if (existsSync(value)) return JSON.parse(readFileSync(value, 'utf8')) as Record<string, unknown>;
    if (value.startsWith('{')) return JSON.parse(value) as Record<string, unknown>;
    const decoded = Buffer.from(value, 'base64').toString('utf8');
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch (error) {
    console.error('FCM_SERVICE_ACCOUNT_JSON no es válido:', error);
    return null;
  }
}

async function ensureFcm(): Promise<boolean> {
  if (fcmApp) return true;
  const account = readServiceAccount();
  if (!account) return false;

  try {
    const { getApps, initializeApp, cert } = await import('firebase-admin/app');
    fcmApp =
      getApps()[0] ??
      initializeApp({
        credential: cert(account as Parameters<typeof cert>[0]),
      });
    return true;
  } catch (error) {
    console.error('No se pudo inicializar Firebase Admin:', error);
    return false;
  }
}

async function sendFcm(
  tokens: Array<{ id: string; endpoint: string }>,
  payload: PushPayload,
): Promise<void> {
  if (tokens.length === 0 || !(await ensureFcm())) return;

  try {
    const { getMessaging } = await import('firebase-admin/messaging');
    const result = await getMessaging().sendEachForMulticast({
      tokens: tokens.map((token) => token.endpoint),
      notification: { title: payload.title, body: payload.body },
      data: {
        type: payload.type,
        ...(payload.messageId ? { messageId: payload.messageId } : {}),
        ...(payload.documentId ? { documentId: payload.documentId } : {}),
        url: payload.url,
      },
      android: {
        priority: 'high',
        notification: { channelId: 'sirpef_documentos' },
      },
    });

    await Promise.all(
      result.responses.map(async (response, index) => {
        const token = tokens[index];
        if (!token) return;
        if (response.success) {
          await db
            .update(pushSubscriptions)
            .set({ lastUsedAt: new Date(), failureCount: 0 })
            .where(eq(pushSubscriptions.id, token.id));
          return;
        }
        const code = response.error?.code ?? '';
        if (
          code === 'messaging/registration-token-not-registered' ||
          code === 'messaging/invalid-registration-token' ||
          code === 'messaging/invalid-argument'
        ) {
          await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, token.id));
        }
      }),
    );
  } catch (error) {
    console.error('No se pudo enviar el push FCM:', error);
  }
}

/** Envía el aviso a todas las suscripciones activas de esos usuarios. */
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return;

  try {
    const rows = await db
      .select({
        id: pushSubscriptions.id,
        platform: pushSubscriptions.platform,
        endpoint: pushSubscriptions.endpoint,
        p256dh: pushSubscriptions.p256dh,
        auth: pushSubscriptions.auth,
      })
      .from(pushSubscriptions)
      .where(
        and(
          inArray(pushSubscriptions.userId, unique),
          eq(pushSubscriptions.status, 'active'),
        ),
      );

    const web = rows.filter((row) => row.platform === 'web');
    const android = rows.filter((row) => row.platform === 'android');
    await Promise.all([sendWebPush(web, payload), sendFcm(android, payload)]);
  } catch (error) {
    // El push es accesorio: nunca debe romper la operación de origen.
    console.error('No se pudieron enviar las notificaciones push:', error);
  }
}

/**
 * Traduce un evento de tiempo real a un push.
 *
 * Solo se notifican los hitos del flujo: documento nuevo, pendiente de
 * aprobación, compartido y resultado. Los autoguardados no generan ruido.
 */
export async function sendPushForRealtimeEvent(event: RealtimeEvent): Promise<void> {
  // Sin ningún canal configurado no se consulta la tabla en cada evento.
  if (!env.VAPID_PUBLIC_KEY && !env.FCM_SERVICE_ACCOUNT_JSON) return;

  const payload = event.payload;
  if (!payload) return;

  const actorId = 'actorId' in payload ? payload.actorId : undefined;
  const recipients = event.userIds.filter((id) => id !== actorId);
  if (recipients.length === 0) return;

  // Texto genérico por privacidad: el detalle se ve dentro de la app.
  const body = 'Abre SirpefOffice para revisarlo.';

  if (isInboxRealtimeEvent(event.type)) {
    const data = event.payload as InboxRealtimeEventPayload;
    switch (event.type) {
      case 'inbox.message.created':
        await sendPushToUsers(recipients, {
          title: 'Tienes un documento nuevo',
          body,
          url: `/inbox/${data.messageId}`,
          messageId: data.messageId,
          documentId: data.documentId,
          type: event.type,
        });
        return;
      case 'inbox.message.pending':
        await sendPushToUsers(recipients, {
          title: 'Documento pendiente de aprobación',
          body,
          url: `/inbox/${data.messageId}`,
          messageId: data.messageId,
          documentId: data.documentId,
          type: event.type,
        });
        return;
      case 'inbox.message.approved':
      case 'inbox.result.approved':
        await sendPushToUsers(recipients, {
          title: 'Documento aprobado',
          body,
          url: `/inbox/${data.messageId}`,
          messageId: data.messageId,
          documentId: data.documentId,
          type: event.type,
        });
        return;
      case 'inbox.result.rejected':
        await sendPushToUsers(recipients, {
          title: 'Documento devuelto para corrección',
          body,
          url: `/inbox/${data.messageId}`,
          messageId: data.messageId,
          documentId: data.documentId,
          type: event.type,
        });
        return;
      case 'inbox.message.cancelled':
        await sendPushToUsers(recipients, {
          title: 'Envío cancelado',
          body,
          url: `/inbox/${data.messageId}`,
          messageId: data.messageId,
          documentId: data.documentId,
          type: event.type,
        });
        return;
      default:
        return;
    }
  }

  if (event.type === 'document.shared') {
    await sendPushToUsers(recipients, {
      title: 'Han compartido un documento contigo',
      body,
      url: `/documents/${payload.documentId}`,
      documentId: payload.documentId,
      type: event.type,
    });
  }
}
