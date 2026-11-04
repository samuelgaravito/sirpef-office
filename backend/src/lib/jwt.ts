import { createHash, randomBytes } from 'node:crypto';

import { SignJWT, jwtVerify } from 'jose';

import { env } from '../env.js';
import type { UserRole } from '@sirpefoffice/shared';

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export interface AccessTokenPayload {
  sub: string;
  email: string;
  name: string;
  role: UserRole;
}

/** Firma un access token JWT de corta duración. */
export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({ email: payload.email, name: payload.name, role: payload.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setIssuer('sirpefoffice')
    .setAudience('sirpefoffice-web')
    .setExpirationTime(env.ACCESS_TOKEN_TTL)
    .sign(accessSecret);
}

/** Verifica un access token y devuelve su payload, o null si no es válido. */
export async function verifyAccessToken(token: string): Promise<AccessTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, accessSecret, {
      issuer: 'sirpefoffice',
      audience: 'sirpefoffice-web',
    });
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      email: String(payload.email ?? ''),
      name: String(payload.name ?? ''),
      role: (payload.role === 'admin' ? 'admin' : 'member') as UserRole,
    };
  } catch {
    return null;
  }
}

/**
 * El refresh token es un valor opaco aleatorio. En la base de datos solo se
 * guarda su SHA-256, de forma que una fuga de la tabla no permite reutilizarlos.
 */
export function generateRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(48).toString('base64url');
  return { token, hash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function refreshTokenExpiry(days = env.REFRESH_TOKEN_TTL_DAYS): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
