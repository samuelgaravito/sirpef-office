import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { AuthResponse } from '@sirpefoffice/shared';

import { db } from '../../db/index.js';
import { refreshTokens, users, type UserRow } from '../../db/schema.js';
import { env } from '../../env.js';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  authenticate,
  clearAuthCookies,
  setAuthCookies,
} from '../../lib/auth-guard.js';
import { AppError, badRequest, conflict, forbidden, internal, notFound, unauthorized } from '../../lib/errors.js';
import {
  generateRefreshToken,
  hashToken,
  refreshTokenExpiry,
  signAccessToken,
} from '../../lib/jwt.js';
import { toPublicUser } from '../../lib/mappers.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import {
  SvaAccessError,
  SvaUnavailableError,
  verifySvaSession,
} from '../../lib/sva.js';
import { syncSvaUsers, upsertSvaUser } from '../../lib/sva-sync.js';

const registerSchema = z.object({
  email: z.email({ message: 'Correo inválido' }).max(200).transform((v) => v.trim().toLowerCase()),
  name: z.string().trim().min(2, 'El nombre es muy corto').max(120),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres').max(200),
});

const loginSchema = z.object({
  email: z.email({ message: 'Correo inválido' }).transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1),
});

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
