import type { FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';

import { normalizeMenuKeys, type MenuKey } from '@sirpefoffice/shared';

import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { env, isProduction } from '../env.js';
import { forbidden, unauthorized } from './errors.js';
import { accessTokenMaxAgeSeconds, verifyAccessToken, type AccessTokenPayload } from './jwt.js';

/** Identidad autenticada con los menús vigentes leídos de la base local. */
export interface AuthenticatedUser extends AccessTokenPayload {
  menus: MenuKey[];
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

export const ACCESS_COOKIE = 'sd_access';
export const REFRESH_COOKIE = 'sd_refresh';

/** Extrae el token del header Authorization o de la cookie httpOnly. */
function extractToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  const cookie = request.cookies?.[ACCESS_COOKIE];
  return cookie || undefined;
}

/** Exige un usuario autenticado y lo deja en request.user. */
export async function authenticate(request: FastifyRequest): Promise<AuthenticatedUser> {
  // Los hooks de un mismo request pueden llamar a authenticate varias veces.
  if (request.user?.menus) return request.user;

  const token = extractToken(request);
  if (!token) throw unauthorized('Falta el token de acceso');

  const payload = await verifyAccessToken(token);
  if (!payload) throw unauthorized('Sesión expirada o inválida');

  // El estado, el rol y los menús se leen de la base local (proyección de
  // SVA) para que una baja o un cambio surtan efecto sin esperar al token.
  const [row] = await db
    .select({ isActive: users.isActive, role: users.role, menuKeys: users.menuKeys })
    .from(users)
    .where(eq(users.id, payload.sub))
    .limit(1);

  if (!row?.isActive) throw unauthorized('Cuenta deshabilitada');

  const current: AuthenticatedUser = {
    ...payload,
    role: row.role,
    menus: normalizeMenuKeys(row.menuKeys),
  };
  request.user = current;
  return current;
}

/** Exige rol de administrador. */
export async function requireAdmin(request: FastifyRequest): Promise<AuthenticatedUser> {
  const user = await authenticate(request);
  if (user.role !== 'admin') throw forbidden('Solo los administradores pueden hacer esto');
  return user;
}

export function setAuthCookies(
  reply: FastifyReply,
  accessToken: string,
  refreshToken: string,
  refreshMaxAgeMs: number,
): void {
  // COOKIE_SECURE permite usar HTTP sin poner NODE_ENV=development.
  const secure = env.COOKIE_SECURE ?? isProduction;

  reply.setCookie(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    // La cookie vive lo mismo que el token que envuelve: si el token sigue
    // siendo válido, la cookie también, y al revés.
    maxAge: accessTokenMaxAgeSeconds(),
  });

  reply.setCookie(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/api/auth',
    maxAge: Math.floor(refreshMaxAgeMs / 1000),
  });
}

export function clearAuthCookies(reply: FastifyReply): void {
  reply.clearCookie(ACCESS_COOKIE, { path: '/' });
  reply.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
}
