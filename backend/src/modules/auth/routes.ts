import { createPublicKey } from 'node:crypto';

import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { AuthResponse } from '@sirpefoffice/shared';

import { db } from '../../db/index.js';
import {
  mobileDevices,
  mobilePairingCodes,
  refreshTokens,
  totpCredentials,
  totpPairingCodes,
  totpRecoveryCodes,
  users,
  type UserRow,
} from '../../db/schema.js';
import { env } from '../../env.js';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  authenticate,
  clearAuthCookies,
  requireAdmin,
  setAuthCookies,
} from '../../lib/auth-guard.js';
import { AppError, badRequest, conflict, forbidden, internal, notFound, unauthorized } from '../../lib/errors.js';
import {
  generateRefreshToken,
  hashToken,
  refreshTokenExpiry,
  signAccessToken,
  signLoginChallenge,
  signPairingToken,
  verifyLoginChallenge,
  verifyPairingToken,
} from '../../lib/jwt.js';
import { toPublicUser } from '../../lib/mappers.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import { recoveryCodeHashes } from '../../lib/recovery-words.js';
import { verifyDeviceAssertion } from '../../lib/signature.js';
import { pairToken, verifyUserTotp } from '../token/service.js';
import {
  SvaAccessError,
  SvaUnavailableError,
  verifySvaSession,
} from '../../lib/sva.js';
import { syncSvaUsers, upsertSvaUser } from '../../lib/sva-sync.js';
import {
  hashHumanCode,
  newDeviceNonce,
  newPairingCode,
  normalizeHumanCode,
} from '../../lib/totp.js';

const registerSchema = z.object({
  email: z.email({ message: 'Correo inválido' }).max(200).transform((v) => v.trim().toLowerCase()),
  name: z.string().trim().min(2, 'El nombre es muy corto').max(120),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200),
});

const loginSchema = z.object({
  email: z.email({ message: 'Correo inválido' }).transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1),
});

const mobileSvaSchema = z.object({
  token: z.string().min(1).optional(),
});

const mobileRefreshSchema = z.object({
  refreshToken: z.string().min(20, 'El token de sesión no es válido'),
});

const mobileLocalSchema = z.object({
  email: z.email({ message: 'Correo inválido' }).max(200).transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1),
});

const mobilePairPreviewSchema = z.object({
  code: z.string().trim().min(4).max(40),
  deviceId: z.string().trim().min(8).max(200),
});

const mobilePairConfirmSchema = z.object({
  pairToken: z.string().min(20).max(4_000),
  deviceId: z.string().trim().min(8).max(200),
  publicKey: z.string().min(100).max(10_000),
  deviceAssertion: z.string().min(20).max(10_000),
  model: z.string().trim().max(120).default(''),
  appVersion: z.string().trim().max(40).default(''),
});

const mobileLoginChallengeSchema = z.object({
  identifier: z.string().trim().min(3).max(200),
  deviceId: z.string().trim().min(8).max(200),
});

const mobileLoginSchema = z.object({
  challengeToken: z.string().min(20).max(4_000),
  deviceId: z.string().trim().min(8).max(200),
  identifier: z.string().trim().min(3).max(200),
  deviceAssertion: z.string().min(20).max(10_000),
  code: z.string().trim().max(20).optional(),
  recoveryCode: z.string().trim().max(40).optional(),
});

const tokenPairSchema = z.object({
  code: z.string().trim().min(4).max(40),
  deviceId: z.string().trim().min(8).max(200),
  deviceLabel: z.string().trim().max(120).optional(),
  replace: z.boolean().optional(),
});

/** Payload que firma la app para demostrar que posee la clave del teléfono. */
function pairingPayload(pairToken: string, deviceId: string): string {
  return `SIRPEF-PAIR|${pairToken}|${deviceId}`;
}

/** Normaliza correo o cédula para que app y servidor firmen lo mismo. */
function normalizeIdentifier(value: string): string {
  const trimmed = value.trim();
  if (trimmed.includes('@')) return trimmed.toLowerCase();
  return trimmed.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Payload del login diario; debe coincidir con buildLoginPayload de la app. */
function loginPayload(nonce: string, deviceId: string, identifier: string): string {
  return `SIRPEF-LOGIN|${nonce}|${deviceId}|${identifier}`;
}

const updateMeSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    avatarUrl: z.string().max(2_000_000).nullable().optional(),
    currentPassword: z.string().optional(),
    newPassword: z.string().min(8).max(200).optional(),
  })
  .refine((v) => !v.newPassword || !!v.currentPassword, {
    message: 'Debes indicar la contraseña actual',
    path: ['currentPassword'],
  });

/** Nombres de cookie que puede usar SVA, según su versión/despliegue. */
const SVA_COOKIE_NAMES = ['SVA-TOKEN', 'sva-token', 'svatoken'] as const;

function svaTokenFrom(request: FastifyRequest): string | undefined {
  for (const name of SVA_COOKIE_NAMES) {
    const value = request.cookies?.[name];
    if (value) return value;
  }
  const header = request.headers['svatoken'];
  if (typeof header === 'string' && header) return header;
  return undefined;
}

function deviceIdFrom(request: FastifyRequest): string | undefined {
  const value = request.headers['x-device-id'];
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

/** Emite la sesión local (access + refresh) para cualquier forma de login. */
async function issueSession(
  request: FastifyRequest,
  reply: Parameters<typeof setAuthCookies>[0],
  user: UserRow,
  refreshDays = env.REFRESH_TOKEN_TTL_DAYS,
): Promise<AuthResponse> {
  const accessToken = await signAccessToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });
  const refresh = generateRefreshToken();
  const expiresAt = refreshTokenExpiry(refreshDays);

  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: refresh.hash,
    expiresAt,
    userAgent: request.headers['user-agent'] ?? null,
    ip: request.ip,
  });

  setAuthCookies(reply, accessToken, refresh.token, expiresAt.getTime() - Date.now());
  return { user: toPublicUser(user), accessToken };
}

/**
 * Emite una sesión para clientes nativos. A diferencia de la web, no usa
 * cookies: devuelve el refresh token en el cuerpo para que la app lo guarde
 * cifrado en el Keystore.
 */
async function issueMobileSession(
  request: FastifyRequest,
  user: UserRow,
  refreshDays = env.REFRESH_TOKEN_TTL_DAYS,
  deviceId?: string,
  authAt = new Date(),
  bindAccessToken = true,
): Promise<{
  user: ReturnType<typeof toPublicUser>;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
}> {
  const accessToken = await signAccessToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    ...(deviceId && bindAccessToken ? { deviceId } : {}),
  });
  const refresh = generateRefreshToken();
  const expiresAt = refreshTokenExpiry(refreshDays);

  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash: refresh.hash,
    expiresAt,
    userAgent: request.headers['user-agent'] ?? null,
    ip: request.ip,
    deviceId: deviceId ?? null,
    authAt,
  });

  return {
    user: toPublicUser(user),
    accessToken,
    refreshToken: refresh.token,
    refreshExpiresAt: expiresAt.toISOString(),
  };
}

function svaError(error: unknown): AppError {
  if (error instanceof SvaUnavailableError) {
    return new AppError(503, 'SVA_UNAVAILABLE', error.message);
  }
  if (error instanceof SvaAccessError) {
    return new AppError(error.statusCode, 'SVA_ACCESS_DENIED', error.message);
  }
  // Cualquier otro fallo de SVA es una incidencia del servicio: no se filtra
  // el detalle técnico al usuario, solo se registra en el log.
  return new AppError(
    502,
    'SVA_ERROR',
    'SVA respondió con un error inesperado. Inténtalo de nuevo en unos minutos.',
  );
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /** Configuración pública de autenticación para que el frontend sepa qué mostrar. */
  app.get('/config', async () => ({
    authMode: env.AUTH_MODE,
  }));

  /** Registro local. Deshabilitado en cuanto SVA administra los usuarios. */
  app.post('/register', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (env.AUTH_MODE !== 'local') {
      throw forbidden('Los usuarios se crean y administran en SVA');
    }

    const body = registerSchema.parse(request.body);

    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${body.email}`)
      .limit(1);

    if (existing) throw conflict('Ya existe una cuenta con ese correo');

    const countRows = await db.select({ count: sql<number>`count(*)::int` }).from(users);
    const isFirstUser = (countRows[0]?.count ?? 0) === 0;

    const passwordHash = await hashPassword(body.password);

    const [created] = await db
      .insert(users)
      .values({
        email: body.email,
        name: body.name,
        passwordHash,
        role: isFirstUser ? 'admin' : 'member',
      })
      .returning();

    if (!created) throw internal('USER_CREATE_FAILED', 'No se pudo crear el usuario');

    const response = await issueSession(request, reply, created);
    return reply.status(201).send(response);
  });

  /** Inicio de sesión local (break-glass). */
  app.post('/login', { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (env.AUTH_MODE === 'sva') {
      throw forbidden('El acceso local está deshabilitado: inicia sesión en SVA');
    }

    const body = loginSchema.parse(request.body);

    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${body.email}`)
      .limit(1);

    // Mismo error para correo inexistente y contraseña incorrecta (evita enumeración)
    if (!user) throw unauthorized('Correo o contraseña incorrectos');
    if (!user.isActive) throw unauthorized('Cuenta deshabilitada');

    // En modo híbrido solo sobrevive el acceso local de emergencia.
    if (env.AUTH_MODE === 'hybrid' && user.authProvider !== 'local') {
      throw unauthorized('Tu cuenta se administra en SVA; entra desde el portal SVA');
    }

    if (!user.passwordHash) throw unauthorized('Correo o contraseña incorrectos');

    const valid = await verifyPassword(body.password, user.passwordHash);
    if (!valid) throw unauthorized('Correo o contraseña incorrectos');

    const response = await issueSession(request, reply, user);
    return response;
  });

  /**
   * Canjea la cookie de SVA por una sesión local.
   * No crea usuarios a mano: materializa la identidad que ya existe en SVA.
   */
  app.post('/sva', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    if (env.AUTH_MODE === 'local') {
      throw notFound('La autenticación con SVA no está habilitada');
    }

    const token = svaTokenFrom(request);
    if (!token) throw unauthorized('No hay sesión de SVA. Inicia sesión en el portal SVA.');

    try {
      const identity = await verifySvaSession(token);
      const user = await upsertSvaUser(identity);
      return await issueSession(request, reply, user, env.SVA_REFRESH_TOKEN_TTL_DAYS);
    } catch (error) {
      if (error instanceof SvaAccessError || error instanceof SvaUnavailableError) {
        throw svaError(error);
      }
      // El conflicto de correo ya viene tipado desde `upsertSvaUser`.
      throw error;
    }
  });

  /**
   * Login nativo local, solo para desarrollo y para el admin de emergencia.
   * En `AUTH_MODE=sva` queda deshabilitado, igual que el login web local.
   */
  app.post(
    '/mobile/local',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request) => {
      if (env.AUTH_MODE === 'sva') {
        throw forbidden('El acceso local está deshabilitado: inicia sesión en SVA');
      }

      const body = mobileLocalSchema.parse(request.body);
      const [user] = await db
        .select()
        .from(users)
        .where(sql`lower(${users.email}) = ${body.email}`)
        .limit(1);

      if (!user) throw unauthorized('Correo o contraseña incorrectos');
      if (!user.isActive) throw unauthorized('Cuenta deshabilitada');
      if (env.AUTH_MODE === 'hybrid' && user.authProvider !== 'local') {
        throw unauthorized('Tu cuenta se administra en SVA; entra desde el portal SVA');
      }
      if (!user.passwordHash) throw unauthorized('Correo o contraseña incorrectos');

      const valid = await verifyPassword(body.password, user.passwordHash);
      if (!valid) throw unauthorized('Correo o contraseña incorrectos');

      return await issueMobileSession(
        request,
        user,
        env.REFRESH_TOKEN_TTL_DAYS,
        deviceIdFrom(request),
        new Date(),
        false,
      );
    },
  );

  /**
   * Login nativo: canjea un token de SVA por una sesión local sin cookies.
   * La app envía `{ token }` o la cabecera `svatoken`.
   */
  app.post(
    '/mobile/sva',
    { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } },
    async (request) => {
      if (env.AUTH_MODE === 'local') {
        throw notFound('La autenticación con SVA no está habilitada');
      }

      const body = mobileSvaSchema.parse(request.body ?? {});
      const token = body.token ?? svaTokenFrom(request);
      if (!token) throw unauthorized('No hay sesión de SVA. Inicia sesión en el portal SVA.');

      try {
        const identity = await verifySvaSession(token);
        const user = await upsertSvaUser(identity);
        return await issueMobileSession(
          request,
          user,
          env.SVA_REFRESH_TOKEN_TTL_DAYS,
          deviceIdFrom(request),
          new Date(),
          false,
        );
      } catch (error) {
        if (error instanceof SvaAccessError || error instanceof SvaUnavailableError) {
          throw svaError(error);
        }
        throw error;
      }
    },
  );

  /**
   * La web genera el código de alta del teléfono. Solo un administrador con
   * nombre, correo y cédula completos puede vincular un dispositivo.
   */
  app.post(
    '/mobile/pairing',
    { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
    async (request) => {
      const auth = await requireAdmin(request);
      const [user] = await db.select().from(users).where(eq(users.id, auth.sub)).limit(1);
      if (!user) throw unauthorized('Usuario no encontrado');
      if (!user.cedula?.trim()) {
        throw badRequest('Completa tu cédula en SVA antes de vincular un teléfono');
      }

      await db
        .update(mobilePairingCodes)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(mobilePairingCodes.userId, user.id),
            isNull(mobilePairingCodes.usedAt),
          ),
        );

      const code = newPairingCode();
      const expiresAt = new Date(
        Date.now() + env.MOBILE_PAIRING_TTL_SECONDS * 1000,
      );
      await db.insert(mobilePairingCodes).values({
        userId: user.id,
        codeHash: hashHumanCode(code, 'mobile-pairing', user.id),
        createdByUserId: auth.sub,
        expiresAt,
      });

      return {
        code,
        expiresAt: expiresAt.toISOString(),
        user: {
          name: user.name,
          email: user.email,
          cedula: user.cedula,
        },
      };
    },
  );

  /**
   * Primer paso del alta: la app canjea el código por los datos del usuario y
   * un token intermedio. El código no se consume hasta confirmar la identidad
   * y demostrar la posesión de la clave del teléfono.
   */
  app.post(
    '/mobile/pair',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const body = mobilePairPreviewSchema.parse(request.body ?? {});
      const normalized = normalizeHumanCode(body.code);
      if (!normalized) throw unauthorized('El código de vinculación no es válido');

      const rows = await db
        .select()
        .from(mobilePairingCodes)
        .where(
          and(
            isNull(mobilePairingCodes.usedAt),
            gt(mobilePairingCodes.expiresAt, new Date()),
          ),
        )
        .limit(100);

      let match: (typeof rows)[number] | undefined;
      for (const row of rows) {
        if (row.attempts >= env.TOTP_MAX_ATTEMPTS) continue;
        if (hashHumanCode(normalized, 'mobile-pairing', row.userId) === row.codeHash) {
          match = row;
          break;
        }
      }
      if (!match) {
        throw unauthorized('El código de vinculación no es válido o expiró');
      }

      const [user] = await db.select().from(users).where(eq(users.id, match.userId)).limit(1);
      if (!user?.isActive) throw unauthorized('La cuenta no está activa');

      const pairToken = await signPairingToken({
        userId: user.id,
        codeId: match.id,
        deviceId: body.deviceId,
      });

      return {
        user: toPublicUser(user),
        pairToken,
        expiresAt: match.expiresAt.toISOString(),
      };
    },
  );

  /**
   * Segundo paso: confirma el alta con la clave pública del teléfono y la
   * firma biométrica del payload. Solo entonces se consume el código, se
   * revoca el teléfono anterior y se emite la sesión nativa.
   */
  app.post(
    '/mobile/pair/confirm',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const body = mobilePairConfirmSchema.parse(request.body ?? {});
      const token = await verifyPairingToken(body.pairToken);
      if (!token || token.deviceId !== body.deviceId) {
        throw unauthorized('La vinculación expiró. Genera un código nuevo.');
      }

      let key: ReturnType<typeof createPublicKey>;
      try {
        key = createPublicKey(body.publicKey);
      } catch {
        throw badRequest('La clave pública del dispositivo no es válida');
      }
      if (key.asymmetricKeyType !== 'ec') {
        throw badRequest('La clave del dispositivo debe ser EC P-256');
      }
      const curve = key.asymmetricKeyDetails?.namedCurve;
      if (curve && !['prime256v1', 'secp256r1'].includes(curve)) {
        throw badRequest('La clave del dispositivo debe usar la curva P-256');
      }
      if (
        !verifyDeviceAssertion({
          publicKeyPem: body.publicKey,
          payload: pairingPayload(body.pairToken, body.deviceId),
          signatureBase64: body.deviceAssertion,
        })
      ) {
        throw forbidden('No se pudo verificar la firma del dispositivo');
      }

      const [claimed] = await db
        .update(mobilePairingCodes)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(mobilePairingCodes.id, token.codeId),
            isNull(mobilePairingCodes.usedAt),
            gt(mobilePairingCodes.expiresAt, new Date()),
          ),
        )
        .returning({ id: mobilePairingCodes.id });
      if (!claimed) {
        throw unauthorized('El código de vinculación ya se usó o expiró');
      }

      const [user] = await db.select().from(users).where(eq(users.id, token.userId)).limit(1);
      if (!user?.isActive) throw unauthorized('La cuenta no está activa');

      await db
        .update(mobileDevices)
        .set({ status: 'revoked', revokedAt: new Date() })
        .where(
          and(eq(mobileDevices.userId, user.id), eq(mobileDevices.status, 'active')),
        );

      const [device] = await db
        .insert(mobileDevices)
        .values({
          userId: user.id,
          deviceId: body.deviceId,
          publicKey: body.publicKey,
          algorithm: 'ES256',
          platform: 'android',
          model: body.model,
          appVersion: body.appVersion,
          status: 'active',
          lastSeenAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [mobileDevices.userId, mobileDevices.deviceId],
          set: {
            publicKey: body.publicKey,
            algorithm: 'ES256',
            platform: 'android',
            model: body.model,
            appVersion: body.appVersion,
            status: 'active',
            revokedAt: null,
            lastSeenAt: new Date(),
          },
        })
        .returning();
      if (!device) {
        throw internal('DEVICE_CREATE_FAILED', 'No se pudo registrar el dispositivo');
      }

      return await issueMobileSession(
        request,
        user,
        env.REFRESH_TOKEN_TTL_DAYS,
        body.deviceId,
      );
    },
  );

  /**
   * Vinculación de la app Token sin SVA: el código que generó la app Firma
   * identifica al usuario y entrega el secreto una sola vez.
   */
  app.post(
    '/token/pair',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const body = tokenPairSchema.parse(request.body ?? {});
      const normalized = normalizeHumanCode(body.code);
      if (!normalized) {
        throw unauthorized('El código de vinculación de Token no es válido');
      }

      const rows = await db
        .select()
        .from(totpPairingCodes)
        .where(
          and(
            isNull(totpPairingCodes.usedAt),
            gt(totpPairingCodes.expiresAt, new Date()),
          ),
        )
        .limit(100);

      let match: (typeof rows)[number] | undefined;
      for (const row of rows) {
        if (hashHumanCode(normalized, 'pairing', row.userId) === row.codeHash) {
          match = row;
          break;
        }
      }
      if (!match) {
        throw unauthorized('El código de vinculación de Token no es válido o expiró');
      }

      const [user] = await db.select().from(users).where(eq(users.id, match.userId)).limit(1);
      if (!user?.isActive) throw unauthorized('La cuenta no está activa');

      const result = await pairToken({
        user: {
          sub: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          menus: user.menuKeys,
        },
        mode: 'pairing',
        code: body.code,
        deviceId: body.deviceId,
        deviceLabel: body.deviceLabel,
        replace: body.replace,
      });

      const session = await issueMobileSession(
        request,
        user,
        env.REFRESH_TOKEN_TTL_DAYS,
        undefined,
        new Date(),
        false,
      );

      return { ...result, ...session };
    },
  );

  /**
   * Inicio de sesión diario, paso 1: identifica el teléfono y devuelve un
   * desafío firmado. La app lo firma con la clave EC y lo presenta junto al
   * código TOTP.
   */
  app.post(
    '/mobile/login-challenge',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const body = mobileLoginChallengeSchema.parse(request.body ?? {});
      const identifier = normalizeIdentifier(body.identifier);
      if (!identifier) throw unauthorized('Escribe tu cédula o correo');

      const rows = identifier.includes('@')
        ? await db
            .select()
            .from(users)
            .where(sql`lower(${users.email}) = ${identifier}`)
            .limit(1)
        : await db
            .select()
            .from(users)
            .where(
              sql`regexp_replace(upper(${users.cedula}), '[^A-Z0-9]', '', 'g') = ${identifier}`,
            )
            .limit(1);
      const user = rows[0];
      if (!user?.isActive) {
        throw unauthorized('No se pudo iniciar sesión con este teléfono');
      }

      const [device] = await db
        .select()
        .from(mobileDevices)
        .where(
          and(
            eq(mobileDevices.userId, user.id),
            eq(mobileDevices.deviceId, body.deviceId),
          ),
        )
        .limit(1);
      if (!device) {
        throw unauthorized('No se pudo iniciar sesión con este teléfono');
      }
      if (device.status !== 'active') {
        throw new AppError(
          401,
          'DEVICE_REVOKED',
          'Este teléfono fue desvinculado. Pide un nuevo código en la web.',
        );
      }

      const [credential] = await db
        .select({ id: totpCredentials.id })
        .from(totpCredentials)
        .where(eq(totpCredentials.userId, user.id))
        .limit(1);

      const nonce = newDeviceNonce();
      const challengeToken = await signLoginChallenge({
        userId: user.id,
        deviceId: body.deviceId,
        identifier,
        nonce,
      });

      return {
        challengeToken,
        nonce,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        requiresTotp: Boolean(credential),
        hasToken: Boolean(credential),
        identifier,
        user: toPublicUser(user),
      };
    },
  );

  /** Inicio de sesión diario, paso 2: firma del teléfono + TOTP/recuperación. */
  app.post(
    '/mobile/login',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request) => {
      const body = mobileLoginSchema.parse(request.body ?? {});
      const challenge = await verifyLoginChallenge(body.challengeToken);
      if (!challenge || challenge.deviceId !== body.deviceId) {
        throw unauthorized('El inicio de sesión expiró. Vuelve a intentarlo');
      }
      const identifier = normalizeIdentifier(body.identifier);
      if (identifier !== challenge.identifier) {
        throw unauthorized('Los datos no coinciden con este teléfono');
      }

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, challenge.userId))
        .limit(1);
      if (!user?.isActive) throw unauthorized('La cuenta no está activa');

      const [device] = await db
        .select()
        .from(mobileDevices)
        .where(
          and(
            eq(mobileDevices.userId, user.id),
            eq(mobileDevices.deviceId, body.deviceId),
          ),
        )
        .limit(1);
      if (!device) throw forbidden('Este teléfono ya no está autorizado');
      if (device.status !== 'active') {
        throw new AppError(
          401,
          'DEVICE_REVOKED',
          'Este teléfono fue desvinculado. Pide un nuevo código en la web.',
        );
      }

      if (
        !verifyDeviceAssertion({
          publicKeyPem: device.publicKey,
          payload: loginPayload(
            challenge.nonce,
            body.deviceId,
            challenge.identifier,
          ),
          signatureBase64: body.deviceAssertion,
        })
      ) {
        throw forbidden('No se pudo verificar la firma del dispositivo');
      }

      const [credential] = await db
        .select({ id: totpCredentials.id })
        .from(totpCredentials)
        .where(eq(totpCredentials.userId, user.id))
        .limit(1);

      if (body.code) {
        await verifyUserTotp({
          userId: user.id,
          code: body.code,
          purpose: 'login',
        });
      } else if (body.recoveryCode) {
        const hashes = recoveryCodeHashes(body.recoveryCode, user.id);
        const [recovery] = await db
          .select()
          .from(totpRecoveryCodes)
          .where(
            and(
              eq(totpRecoveryCodes.userId, user.id),
              inArray(totpRecoveryCodes.codeHash, hashes),
              isNull(totpRecoveryCodes.usedAt),
            ),
          )
          .limit(1);
        if (!recovery) {
          throw unauthorized('El código de recuperación no es válido o ya se usó');
        }
        const [claimed] = await db
          .update(totpRecoveryCodes)
          .set({ usedAt: new Date() })
          .where(
            and(
              eq(totpRecoveryCodes.id, recovery.id),
              isNull(totpRecoveryCodes.usedAt),
            ),
          )
          .returning({ id: totpRecoveryCodes.id });
        if (!claimed) {
          throw unauthorized('El código de recuperación ya se usó');
        }
      } else if (credential) {
        throw badRequest('Escribe el código de SirpefOffice Token');
      }

      await db
        .update(mobileDevices)
        .set({ lastSeenAt: new Date() })
        .where(eq(mobileDevices.id, device.id));

      return await issueMobileSession(
        request,
        user,
        env.REFRESH_TOKEN_TTL_DAYS,
        body.deviceId,
        new Date(),
      );
    },
  );

  /** Renueva la sesión nativa rotando el refresh token. */
  app.post('/mobile/refresh', async (request) => {
    const body = mobileRefreshSchema.parse(request.body ?? {});
    const tokenHash = hashToken(body.refreshToken);

    const [stored] = await db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!stored) throw unauthorized('Sesión expirada, vuelve a iniciar sesión');

    if (stored.deviceId) {
      const requestDevice = deviceIdFrom(request);
      if (!requestDevice || requestDevice !== stored.deviceId) {
        throw unauthorized('La sesión no pertenece a este dispositivo');
      }
      const maxAgeMs = env.MOBILE_REAUTH_HOURS * 60 * 60 * 1000;
      if (
        env.MOBILE_REAUTH_HOURS === 0 ||
        Date.now() - stored.authAt.getTime() > maxAgeMs
      ) {
        throw new AppError(
          401,
          'REAUTH_REQUIRED',
          'Vuelve a iniciar sesión con tu cédula o correo, huella y Token',
        );
      }
    }

    const [user] = await db.select().from(users).where(eq(users.id, stored.userId)).limit(1);
    if (!user) throw unauthorized('Usuario no encontrado');
    if (!user.isActive) throw unauthorized('Cuenta deshabilitada');

    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, stored.id));

    const days =
      user.authProvider === 'sva'
        ? env.SVA_REFRESH_TOKEN_TTL_DAYS
        : env.REFRESH_TOKEN_TTL_DAYS;
    return await issueMobileSession(
      request,
      user,
      days,
      stored.deviceId ?? undefined,
      stored.authAt,
    );
  });

  /** Revoca la sesión nativa sin depender de cookies. */
  app.post('/mobile/logout', async (request) => {
    const body = mobileRefreshSchema.partial().parse(request.body ?? {});
    if (body.refreshToken) {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.tokenHash, hashToken(body.refreshToken)));
    }
    return { ok: true };
  });

  /** Fuerza una sincronización manual con SVA (solo administradores). */
  app.post('/sva/sync', async (request) => {
    if (env.AUTH_MODE === 'local') {
      throw notFound('La sincronización con SVA no está habilitada');
    }

    const auth = await authenticate(request);
    if (auth.role !== 'admin') throw forbidden('Solo los administradores pueden sincronizar');

    try {
      return await syncSvaUsers();
    } catch (error) {
      if (error instanceof SvaUnavailableError) throw svaError(error);
      throw error;
    }
  });

  /** Renueva el access token rotando el refresh token. */
  app.post('/refresh', async (request, reply) => {
    const presented = request.cookies?.[REFRESH_COOKIE];
    if (!presented) throw unauthorized('No hay sesión que renovar');

    const tokenHash = hashToken(presented);
    const [stored] = await db
      .select()
      .from(refreshTokens)
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!stored) {
      clearAuthCookies(reply);
      throw unauthorized('Sesión expirada, vuelve a iniciar sesión');
    }

    const [user] = await db.select().from(users).where(eq(users.id, stored.userId)).limit(1);
    if (!user) {
      clearAuthCookies(reply);
      throw unauthorized('Usuario no encontrado');
    }
    if (!user.isActive) {
      clearAuthCookies(reply);
      throw unauthorized('Cuenta deshabilitada');
    }

    // Rotación: se revoca el token presentado y se emite uno nuevo.
    await db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, stored.id));

    const days =
      user.authProvider === 'sva'
        ? env.SVA_REFRESH_TOKEN_TTL_DAYS
        : env.REFRESH_TOKEN_TTL_DAYS;
    return await issueSession(request, reply, user, days);
  });

  /** Cierre de sesión: revoca el refresh token y limpia cookies. */
  app.post('/logout', async (request, reply) => {
    const presented = request.cookies?.[REFRESH_COOKIE];
    if (presented) {
      await db
        .update(refreshTokens)
        .set({ revokedAt: new Date() })
        .where(eq(refreshTokens.tokenHash, hashToken(presented)));
    }
    clearAuthCookies(reply);
    return { ok: true };
  });

  /** Datos del usuario autenticado. */
  app.get('/me', async (request, reply) => {
    const auth = await authenticate(request);
    const [user] = await db.select().from(users).where(eq(users.id, auth.sub)).limit(1);
    if (!user) {
      clearAuthCookies(reply);
      throw unauthorized('Usuario no encontrado');
    }
    return { user: toPublicUser(user) };
  });

  /** Actualiza el perfil (nombre, avatar y contraseña). */
  app.patch('/me', async (request) => {
    const auth = await authenticate(request);
    const body = updateMeSchema.parse(request.body);

    const [user] = await db.select().from(users).where(eq(users.id, auth.sub)).limit(1);
    if (!user) throw unauthorized('Usuario no encontrado');

    if (user.authProvider === 'sva') {
      throw forbidden('Tu perfil se administra en SVA: allí se cambian nombre, correo y contraseña');
    }

    const patch: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };

    if (body.name !== undefined) patch.name = body.name;
    if (body.avatarUrl !== undefined) patch.avatarUrl = body.avatarUrl;

    if (body.newPassword) {
      if (!user.passwordHash) throw badRequest('Esta cuenta no tiene contraseña local');
      const ok = await verifyPassword(body.currentPassword ?? '', user.passwordHash);
      if (!ok) throw badRequest('La contraseña actual no es correcta');
      patch.passwordHash = await hashPassword(body.newPassword);
    }

    const [updated] = await db.update(users).set(patch).where(eq(users.id, user.id)).returning();
    if (!updated) throw internal('PROFILE_UPDATE_FAILED', 'No se pudo actualizar el perfil');

    return { user: toPublicUser(updated) };
  });

  /** Lista de usuarios activos, para compartir documentos (solo lectura). */
  app.get('/users', async (request) => {
    const auth = await authenticate(request);
    if (auth.role !== 'admin') {
      // Un miembro puede buscar usuarios para compartir, pero no ve emails completos
      const rows = await db
        .select({ id: users.id, name: users.name, role: users.role, avatarUrl: users.avatarUrl })
        .from(users)
        .where(eq(users.isActive, true))
        .limit(200);
      return { items: rows };
    }
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.isActive, true))
      .limit(500);
    return { items: rows.map(toPublicUser) };
  });
}

export { ACCESS_COOKIE, REFRESH_COOKIE };
