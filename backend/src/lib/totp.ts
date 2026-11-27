import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { env, isProduction } from '../env.js';

/* ───────────────────────────── Base32 ──────────────────────────────── */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(value: string): Buffer {
  const clean = value.toUpperCase().replace(/[\s=-]+/g, '').replace(/0/g, 'O').replace(/1/g, 'I');
  let bits = 0;
  let current = 0;
  const output: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Secreto Base32 inválido');
    current = (current << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((current >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

/* ───────────────────────────── TOTP ─────────────────────────────────── */

export interface TotpParams {
  algorithm: 'SHA1';
  digits: number;
  period: number;
}

export function defaultTotpParams(): TotpParams {
  return {
    algorithm: 'SHA1',
    digits: env.TOTP_DIGITS,
    period: env.TOTP_PERIOD,
  };
}

/** Secreto aleatorio de 160 bits, como recomienda el RFC 4226. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function currentTotpStep(period = env.TOTP_PERIOD, at = Date.now()): number {
  return Math.floor(at / 1000 / period);
}

export function totpCode(input: {
  secret: string;
  step: number;
  digits?: number;
}): string {
  const digits = input.digits ?? env.TOTP_DIGITS;
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(input.step));
  const hmac = createHmac('sha1', base32Decode(input.secret)).update(counter).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const binary =
    ((hmac[offset] ?? 0) & 0x7f) * 0x1000000 +
    ((hmac[offset + 1] ?? 0) << 16) +
    ((hmac[offset + 2] ?? 0) << 8) +
    (hmac[offset + 3] ?? 0);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export interface TotpVerification {
  valid: boolean;
  step: number | null;
  reason?: 'format' | 'invalid' | 'replay';
}

/**
 * Valida un código en la ventana permitida. Devuelve el paso concreto que
 * coincide para poder registrar el consumo y evitar reutilizaciones.
 */
export function verifyTotpCode(input: {
  secret: string;
  code: string;
  lastUsedStep?: number | null;
  window?: number;
  digits?: number;
  period?: number;
  at?: number;
}): TotpVerification {
  const code = input.code.replace(/\s+/g, '');
  const digits = input.digits ?? env.TOTP_DIGITS;
  if (!new RegExp(`^\\d{${digits}}$`).test(code)) {
    return { valid: false, step: null, reason: 'format' };
  }

  const current = currentTotpStep(input.period ?? env.TOTP_PERIOD, input.at ?? Date.now());
  const window = input.window ?? env.TOTP_WINDOW;
  const expected = Buffer.from(code, 'utf8');

  for (let delta = -window; delta <= window; delta += 1) {
    const step = current + delta;
    if (step < 0) continue;
    const candidate = Buffer.from(totpCode({ secret: input.secret, step, digits }), 'utf8');
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      if (input.lastUsedStep !== null && input.lastUsedStep !== undefined && step <= input.lastUsedStep) {
        return { valid: false, step, reason: 'replay' };
      }
      return { valid: true, step };
    }
  }

  return { valid: false, step: null, reason: 'invalid' };
}

export function otpauthUrl(input: {
  secret: string;
  account: string;
  issuer?: string;
  digits?: number;
  period?: number;
}): string {
  const issuer = input.issuer ?? env.TOTP_ISSUER;
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(input.account)}`;
  const params = new URLSearchParams({
    secret: input.secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(input.digits ?? env.TOTP_DIGITS),
    period: String(input.period ?? env.TOTP_PERIOD),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/* ─────────────────────── Cifrado del secreto ───────────────────────── */

export interface Keyring {
  keys: Map<string, Buffer>;
  activeKeyId: string;
}

let cachedKeyring: Keyring | null = null;

function parseKey(raw: string): Buffer {
  const trimmed = raw.trim();
  const bytes = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64');
  if (bytes.length !== 32) {
    throw new Error('Cada clave TOTP debe tener exactamente 32 bytes');
  }
  return bytes;
}

export function totpKeyring(): Keyring {
  if (cachedKeyring) return cachedKeyring;

  const raw = env.TOTP_ENCRYPTION_KEYS.trim();
  if (raw) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('TOTP_ENCRYPTION_KEYS debe ser un JSON válido');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('TOTP_ENCRYPTION_KEYS debe ser un objeto { "id": "clave" }');
    }
    const keys = new Map<string, Buffer>();
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value !== 'string') {
        throw new Error(`La clave TOTP "${id}" no es una cadena`);
      }
      keys.set(id, parseKey(value));
    }
    if (!keys.has(env.TOTP_ACTIVE_KEY_ID)) {
      throw new Error(
        `TOTP_ACTIVE_KEY_ID="${env.TOTP_ACTIVE_KEY_ID}" no existe en TOTP_ENCRYPTION_KEYS`,
      );
    }
    cachedKeyring = { keys, activeKeyId: env.TOTP_ACTIVE_KEY_ID };
    return cachedKeyring;
  }

  if (isProduction) {
    throw new Error('TOTP_ENCRYPTION_KEYS es obligatorio en producción');
  }

  // Desarrollo: clave estable derivada del secreto JWT. No usar en producción.
  const derived = createHash('sha256')
    .update(`sirpefoffice-totp-dev:${env.JWT_ACCESS_SECRET}`)
    .digest();
  cachedKeyring = { keys: new Map([['dev', derived]]), activeKeyId: 'dev' };
  return cachedKeyring;
}

export function activeTotpKeyId(): string {
  return totpKeyring().activeKeyId;
}

function keyFor(keyId: string): Buffer {
  const key = totpKeyring().keys.get(keyId);
  if (!key) throw new Error(`No existe la clave TOTP "${keyId}"`);
  return key;
}

function aad(userId: string, keyId: string): Buffer {
  return Buffer.from(`sirpefoffice-totp:${userId}:${keyId}`, 'utf8');
}

export function encryptTotpSecret(input: { userId: string; secret: string }): {
  encrypted: string;
  keyId: string;
} {
  const keyring = totpKeyring();
  const keyId = keyring.activeKeyId;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFor(keyId), iv);
  cipher.setAAD(aad(input.userId, keyId));
  const ciphertext = Buffer.concat([cipher.update(input.secret, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = [
    'v1',
    keyId,
    iv.toString('base64'),
    tag.toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
  return { encrypted: payload, keyId };
}

export function decryptTotpSecret(input: {
  userId: string;
  encrypted: string;
  keyId?: string;
}): { secret: string; keyId: string } {
  const parts = input.encrypted.split(':');
  if (parts.length !== 5 || parts[0] !== 'v1') {
    throw new Error('El secreto TOTP almacenado tiene un formato inválido');
  }
  const [, keyId, ivB64, tagB64, dataB64] = parts as [string, string, string, string, string];
  if (input.keyId && input.keyId !== keyId) {
    throw new Error('La clave del secreto TOTP no coincide con la fila');
  }
  const decipher = createDecipheriv('aes-256-gcm', keyFor(keyId), Buffer.from(ivB64, 'base64'));
  decipher.setAAD(aad(input.userId, keyId));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]).toString('utf8');
  return { secret: plain, keyId };
}

/* ─────────────────── Códigos de vinculación y recuperación ──────────── */

const SAFE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(groups: number, groupSize: number): string {
  const chars: string[] = [];
  const needed = groups * groupSize;
  const bytes = randomBytes(needed);
  for (let i = 0; i < needed; i += 1) {
    chars.push(SAFE_ALPHABET[(bytes[i] ?? 0) % SAFE_ALPHABET.length] ?? 'A');
  }
  return Array.from({ length: groups }, (_, index) =>
    chars.slice(index * groupSize, (index + 1) * groupSize).join(''),
  ).join('-');
}

export function newPairingCode(): string {
  return randomCode(2, 4);
}

export function newRecoveryCode(): string {
  return randomCode(2, 5);
}

export function normalizeHumanCode(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

export function hashHumanCode(value: string, purpose: string, userId: string): string {
  return createHash('sha256')
    .update(`sirpefoffice-${purpose}:${userId}:${normalizeHumanCode(value)}`)
    .digest('hex');
}

export function newDeviceNonce(): string {
  return randomBytes(32).toString('base64url');
}

export function hashDeviceNonce(nonce: string): string {
  return createHash('sha256').update(nonce).digest('hex');
}

/** Payload que firma la clave EC del dispositivo para operaciones TOTP. */
export function buildTotpDevicePayload(input: {
  purpose: 'pairing' | 'recovery';
  nonce: string;
}): string {
  return ['SIRPEF-TOKEN', input.purpose, input.nonce].join('|');
}
