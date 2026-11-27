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
  /** Presente solo en sesiones de la app Firma, para revocarlas al instante. */
  deviceId?: string;
}

/** Firma un access token JWT de corta duración. */
export async function signAccessToken(payload: AccessTokenPayload): Promise<string> {
  return new SignJWT({
    email: payload.email,
    name: payload.name,
    role: payload.role,
    ...(payload.deviceId ? { deviceId: payload.deviceId } : {}),
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setIssuer('sirpefoffice')
    .setAudience('sirpefoffice-web')
    .setExpirationTime(env.ACCESS_TOKEN_TTL)
    .sign(accessSecret);
}

export interface PairingTokenPayload {
  userId: string;
  codeId: string;
  deviceId: string;
}

/**
 * Token intermedio del alta de un teléfono. No es una sesión: solo permite
 * confirmar el código después de que el usuario revise sus datos y firme la
 * prueba de posesión de la clave del dispositivo.
 */
export async function signPairingToken(payload: PairingTokenPayload): Promise<string> {
  return new SignJWT({ codeId: payload.codeId, deviceId: payload.deviceId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setIssuer('sirpefoffice')
    .setAudience('sirpefoffice-pairing')
    .setExpirationTime('5m')
    .sign(accessSecret);
}

export async function verifyPairingToken(
  token: string,
): Promise<PairingTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, accessSecret, {
      issuer: 'sirpefoffice',
      audience: 'sirpefoffice-pairing',
    });
    const codeId = String(payload.codeId ?? '');
    const deviceId = String(payload.deviceId ?? '');
    if (!payload.sub || !codeId || !deviceId) return null;
    return { userId: payload.sub, codeId, deviceId };
  } catch {
    return null;
  }
}

export interface LoginChallengePayload {
  userId: string;
  deviceId: string;
  identifier: string;
  nonce: string;
}

/**
 * Desafío de login diario. La app lo firma con la clave del teléfono y lo
 * presenta junto al código TOTP; no es una sesión.
 */
export async function signLoginChallenge(
  payload: LoginChallengePayload,
): Promise<string> {
  return new SignJWT({
    deviceId: payload.deviceId,
    identifier: payload.identifier,
    nonce: payload.nonce,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(payload.userId)
    .setIssuedAt()
    .setIssuer('sirpefoffice')
    .setAudience('sirpefoffice-login')
    .setExpirationTime('10m')
    .sign(accessSecret);
}

export async function verifyLoginChallenge(
  token: string,
): Promise<LoginChallengePayload | null> {
  try {
    const { payload } = await jwtVerify(token, accessSecret, {
      issuer: 'sirpefoffice',
      audience: 'sirpefoffice-login',
    });
    const deviceId = String(payload.deviceId ?? '');
    const identifier = String(payload.identifier ?? '');
    const nonce = String(payload.nonce ?? '');
    if (!payload.sub || !deviceId || !identifier || !nonce) return null;
    return { userId: payload.sub, deviceId, identifier, nonce };
  } catch {
    return null;
  }
}

/**
 * Convierte el TTL del access token a segundos para la cookie.
 *
 * Acepta las mismas unidades que `jose` (s, m, h, d) y "sin unidad"
 * (minutos). Si el valor no se puede interpretar, cae a 8 horas para que la
 * cookie nunca expire antes que el token que lleva dentro.
 */
export function accessTokenMaxAgeSeconds(): number {
  const ttl = env.ACCESS_TOKEN_TTL.trim();
  const match = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)?$/i.exec(ttl);
  if (!match) return 8 * 60 * 60;

  const value = Number.parseFloat(match[1]!);
  const unit = (match[2] ?? 'm').toLowerCase();
  const factor = unit === 's' ? 1 : unit === 'h' ? 3600 : unit === 'd' ? 86_400 : 60;
  const seconds = Math.floor(value * factor);
  return seconds > 0 ? seconds : 8 * 60 * 60;
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
      ...(typeof payload.deviceId === 'string' && payload.deviceId
        ? { deviceId: payload.deviceId }
        : {}),
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
