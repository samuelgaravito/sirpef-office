import { createPublicKey, randomBytes, verify as cryptoVerify } from 'node:crypto';

import type { DocumentRow } from '../db/schema.js';
import { env } from '../env.js';
import { badRequest } from './errors.js';
import { sha256Hex, stableStringify } from './stable-json.js';

export interface VerifiedSignatureImage {
  bytes: Buffer;
  base64: string;
  sha256: string;
}

/**
 * Hash del contenido que se firma. Incluye solo lo que el usuario ve y
 * aprueba, no el estado administrativo ni el número correlativo: así el hash
 * sigue siendo válido cuando la aprobación asigna el número.
 */
export function canonicalContentHash(doc: DocumentRow): string {
  return sha256Hex(
    stableStringify({
      content: doc.content,
      data: doc.data,
      title: doc.title,
      header: doc.header,
      footer: doc.footer,
      docType: doc.docType,
      templateId: doc.templateId,
      designId: doc.designId,
      version: doc.version,
    }),
  );
}

/** Texto exacto que firma la clave EC del dispositivo. */
export function buildSigningPayload(input: {
  challengeId: string;
  documentId: string;
  messageId: string | null;
  version: number;
  contentSha256: string;
  signatureSha256: string;
}): string {
  return [
    'SIRPEF-SIGN',
    input.challengeId,
    input.documentId,
    input.messageId ?? '-',
    String(input.version),
    input.contentSha256,
    input.signatureSha256,
  ].join('|');
}

/**
 * Valida y normaliza el PNG de la rúbrica. Acepta base64 puro o data URL.
 * Nunca se guarda el data URL: se guarda base64 y su hash.
 */
export function parseSignaturePng(input: string): VerifiedSignatureImage {
  if (typeof input !== 'string' || !input.trim()) {
    throw badRequest('La firma está vacía');
  }

  const comma = input.startsWith('data:') ? input.indexOf(',') : -1;
  const base64 = (comma >= 0 ? input.slice(comma + 1) : input).replace(/\s+/g, '');
  if (!base64) throw badRequest('La firma está vacía');

  let bytes: Buffer;
  try {
    bytes = Buffer.from(base64, 'base64');
  } catch {
    throw badRequest('La firma no es una imagen válida');
  }

  if (bytes.length === 0) throw badRequest('La firma está vacía');
  if (bytes.length > env.SIGNATURE_MAX_PNG_BYTES) {
    throw badRequest('La firma supera el tamaño máximo permitido');
  }

  const pngMagic = '89504e470d0a1a0a';
  if (bytes.subarray(0, 8).toString('hex') !== pngMagic) {
    throw badRequest('La firma debe ser una imagen PNG');
  }

  // IHDR: ancho y alto en los bytes 16..23.
  if (bytes.length < 24) throw badRequest('La firma no es una imagen PNG válida');
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1) throw badRequest('La firma no tiene dimensiones válidas');
  if (width > 2000 || height > 1000) {
    throw badRequest('La firma es demasiado grande; usa como máximo 2000 × 1000 px');
  }

  // Evita que un base64 con relleno inválido pase silenciosamente.
  if (Buffer.from(bytes.toString('base64'), 'base64').compare(bytes) !== 0) {
    throw badRequest('La firma no es una imagen válida');
  }

  return { bytes, base64: bytes.toString('base64'), sha256: sha256Hex(bytes) };
}

/** Verifica la aserción ECDSA SHA-256 del dispositivo. */
export function verifyDeviceAssertion(input: {
  publicKeyPem: string;
  payload: string;
  signatureBase64: string;
}): boolean {
  try {
    const key = createPublicKey(input.publicKeyPem);
    const sig = Buffer.from(input.signatureBase64, 'base64');
    if (sig.length === 0) return false;
    return cryptoVerify('sha256', Buffer.from(input.payload, 'utf8'), {
      key,
      dsaEncoding: 'der',
    }, sig);
  } catch {
    return false;
  }
}

/** Serie legible del certificado: SF-2026-AB12CD34. */
export function newCertificateSerial(): string {
  const year = new Date().getUTCFullYear();
  const random = randomBytes(5).toString('hex').toUpperCase();
  return `${env.SIGNATURE_CERT_SERIAL_PREFIX}-${year}-${random}`;
}

/** Token opaco que viaja en el QR; en la base solo se guarda su SHA-256. */
export function newVerificationToken(): string {
  return randomBytes(32).toString('base64url');
}
