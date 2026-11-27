import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authenticate, requireAdmin } from '../../lib/auth-guard.js';
import { badRequest } from '../../lib/errors.js';
import { totpKeyring } from '../../lib/totp.js';
import {
  authorizeSignature,
  createDeviceChallenge,
  createPairingCode,
  createRecoveryCodes,
  pairToken,
  resetTotpSecret,
  totpStatus,
  unpairTotp,
} from './service.js';

const purposeSchema = z.object({
  purpose: z.enum(['pairing', 'recovery']),
});

const deviceProofSchema = z.object({
  nonce: z.string().min(20).max(200),
  deviceAssertion: z.string().min(20).max(10_000),
});

const pairSchema = z.object({
  mode: z.enum(['pairing', 'recovery']).default('pairing'),
  code: z.string().min(4).max(40),
  deviceId: z.string().trim().min(8).max(200),
  deviceLabel: z.string().trim().max(120).optional(),
  replace: z.boolean().default(false),
});

const signAuthorizationSchema = z.object({
  messageId: z.uuid(),
  challengeId: z.uuid(),
  code: z.string().trim().regex(/^\d{6}$/, 'El código debe tener 6 dígitos'),
  signatureSha256: z.string().regex(/^[0-9a-f]{64}$/i, 'El hash de la firma no es válido'),
  deviceAssertion: z.string().min(20).max(10_000),
});

function deviceIdFrom(headers: Record<string, unknown>): string {
  const value = headers['x-device-id'];
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest('Falta el identificador del dispositivo (X-Device-Id)');
  }
  return value.trim();
}

export async function tokenRoutes(app: FastifyInstance): Promise<void> {
  // Falla al arrancar si el llavero de producción no es válido.
  totpKeyring();

  /** Estado del token. Nunca devuelve el secreto. */
  app.get('/mobile/token/status', async (request, reply) => {
    const auth = await authenticate(request);
    reply.header('Cache-Control', 'no-store');
    return totpStatus(auth);
  });

  /** Nonce de un solo uso firmado por la clave EC del dispositivo de firma. */
  app.post(
    '/mobile/token/device-challenge',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const auth = await authenticate(request);
      const body = purposeSchema.parse(request.body);
      const deviceId = deviceIdFrom(request.headers);
      reply.header('Cache-Control', 'no-store');
      return createDeviceChallenge({ user: auth, deviceId, purpose: body.purpose });
    },
  );

  /** Crea el código temporal que la app Token canjea para vincularse. */
  app.post(
    '/mobile/token/pairing',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const auth = await requireAdmin(request);
      const body = deviceProofSchema.parse(request.body);
      const deviceId = deviceIdFrom(request.headers);
      reply.header('Cache-Control', 'no-store');
      return createPairingCode({
        user: auth,
        deviceId,
        nonce: body.nonce,
        deviceAssertion: body.deviceAssertion,
      });
    },
  );

  /** Genera los códigos de recuperación y los devuelve una sola vez. */
  app.post(
    '/mobile/token/recovery-codes',
    { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const auth = await requireAdmin(request);
      const body = deviceProofSchema.parse(request.body);
      const deviceId = deviceIdFrom(request.headers);
      reply.header('Cache-Control', 'no-store');
      return createRecoveryCodes({
        user: auth,
        deviceId,
        nonce: body.nonce,
        deviceAssertion: body.deviceAssertion,
      });
    },
  );

  /** La app Token canjea el código de vinculación o un código de recuperación. */
  app.post(
    '/mobile/token/pair',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const auth = await authenticate(request);
      const body = pairSchema.parse(request.body);
      const result = await pairToken({
        user: auth,
        mode: body.mode,
        code: body.code,
        deviceId: body.deviceId,
        deviceLabel: body.deviceLabel,
        replace: body.replace,
      });
      reply.header('Cache-Control', 'no-store');
      return result;
    },
  );

  /** Rota el secreto del Token actual. */
  app.post(
    '/mobile/token/reset',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const auth = await authenticate(request);
      const body = z
        .object({
          deviceId: z.string().trim().min(8).max(200),
          deviceLabel: z.string().trim().max(120).optional(),
        })
        .parse(request.body ?? {});
      const result = await resetTotpSecret({
        user: auth,
        deviceId: body.deviceId,
        deviceLabel: body.deviceLabel,
      });
      reply.header('Cache-Control', 'no-store');
      return result;
    },
  );

  /** Desvincula el teléfono Token y borra el secreto del servidor. */
  app.post('/mobile/token/unpair', async (request) => {
    const auth = await authenticate(request);
    const body = z
      .object({ deviceId: z.string().trim().min(8).max(200) })
      .parse(request.body ?? {});
    return unpairTotp(auth, body.deviceId);
  });

  /**
   * Autoriza el desafío de firma con el código TOTP. La aserción EC impide
   * que un código robado sirva sin el dispositivo de firma.
   */
  app.post(
    '/documents/:id/sign-authorization',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const auth = await requireAdmin(request);
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const body = signAuthorizationSchema.parse(request.body);
      const deviceId = deviceIdFrom(request.headers);
      return authorizeSignature({
        user: auth,
        documentId: id,
        messageId: body.messageId,
        challengeId: body.challengeId,
        code: body.code,
        signatureSha256: body.signatureSha256,
        deviceAssertion: body.deviceAssertion,
        deviceId,
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });
    },
  );
}
