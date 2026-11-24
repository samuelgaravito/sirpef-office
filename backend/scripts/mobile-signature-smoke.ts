#!/usr/bin/env tsx
/**
 * Flujo completo de firma móvil contra PostgreSQL y Chrome reales.
 *
 *   npm run smoke:mobile-sign
 *
 * Crea un documento y una solicitud de aprobación temporales, registra un
 * dispositivo EC P-256, firma el desafío y comprueba que el PDF sellado y el
 * certificado público existen. Limpia todo al final.
 */
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import QRCode from 'qrcode';
import { and, eq } from 'drizzle-orm';

import { buildApp } from '../src/app.js';
import { db, sql } from '../src/db/index.js';
import {
  documentMessageRecipients,
  documentMessages,
  documents,
  mobileDevices,
  refreshTokens,
  signatureCertificates,
  users,
} from '../src/db/schema.js';
import { closePdfBrowser } from '../src/export/pdf.js';
import { env } from '../src/env.js';
import { generateRefreshToken, refreshTokenExpiry, signAccessToken } from '../src/lib/jwt.js';
import { hashPassword } from '../src/lib/password.js';
import { buildSigningPayload, canonicalContentHash, newVerificationToken } from '../src/lib/signature.js';
import { sha256Hex } from '../src/lib/stable-json.js';

interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

async function call<T = unknown>(
  app: Awaited<ReturnType<typeof buildApp>>,
  path: string,
  token: string,
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<ApiResponse<T>> {
  const response = await app.inject({
    method,
    url: path,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
  const text = response.body;
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* respuesta binaria o texto */
  }
  return { status: response.statusCode, body: parsed as T };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`✖ ${message}`);
  console.log(`✔ ${message}`);
}

async function main(): Promise<void> {
  const [admin] = await db
    .select()
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.isActive, true)))
    .limit(1);
  if (!admin) throw new Error('No hay administrador activo');

  const token = await signAccessToken({
    sub: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });

  const app = await buildApp();
  let documentId: string | null = null;
  let deviceRowId: string | null = null;

  try {
    // Login local móvil: solo para builds de depuración.
    const localEmail = `local-mobile-${Date.now()}@example.test`;
    const [localUser] = await db
      .insert(users)
      .values({
        email: localEmail,
        name: 'Usuario local de prueba',
        role: 'admin',
        passwordHash: await hashPassword('Smoke1234!'),
        isActive: true,
      })
      .returning();
    if (!localUser) throw new Error('No se pudo crear el usuario local');
    try {
      const local = await call<{ accessToken: string }>(
        app,
        '/api/auth/mobile/local',
        '',
        'POST',
        { email: localEmail, password: 'Smoke1234!' },
      );
      assert(local.status === 200, 'El login local móvil emite una sesión');
      const wrong = await call(
        app,
        '/api/auth/mobile/local',
        '',
        'POST',
        { email: localEmail, password: 'incorrecta' },
      );
      assert(wrong.status === 401, 'El login local rechaza una contraseña incorrecta');
    } finally {
      await db.delete(users).where(eq(users.id, localUser.id));
    }

    // Sesión nativa: refresh y logout sin cookies.
    const refresh = generateRefreshToken();
    await db.insert(refreshTokens).values({
      userId: admin.id,
      tokenHash: refresh.hash,
      expiresAt: refreshTokenExpiry(1),
    });
    const refreshed = await call<{ accessToken: string; refreshToken: string }>(
      app,
      '/api/auth/mobile/refresh',
      '',
      'POST',
      { refreshToken: refresh.token },
    );
    assert(refreshed.status === 200, 'La app renueva su sesión sin cookies');
    const loggedOut = await call(
      app,
      '/api/auth/mobile/logout',
      '',
      'POST',
      { refreshToken: refreshed.body.refreshToken },
    );
    assert(loggedOut.status === 200, 'La app revoca el refresh token');
    const revoked = await call(
      app,
      '/api/auth/mobile/refresh',
      '',
      'POST',
      { refreshToken: refreshed.body.refreshToken },
    );
    assert(revoked.status === 401, 'Un refresh revocado ya no sirve');

    const [document] = await db
      .insert(documents)
      .values({
        ownerId: admin.id,
        title: `Prueba de firma ${Date.now()}`,
        description: 'Documento temporal del smoke de firma móvil',
        docType: 'blank',
        status: 'in_review',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Documento de prueba para la firma electrónica móvil.' }],
            },
          ],
        },
        data: {},
        version: 1,
      })
      .returning();
    if (!document) throw new Error('No se pudo crear el documento');
    documentId = document.id;

    const [message] = await db
      .insert(documentMessages)
      .values({
        documentId: document.id,
        senderId: admin.id,
        subject: 'Solicitud de aprobación de prueba',
        body: 'Aprueba y firma este documento de prueba.',
        status: 'pending_approval',
        documentVersion: 1,
      })
      .returning();
    if (!message) throw new Error('No se pudo crear el mensaje');

    await db.insert(documentMessageRecipients).values({
      messageId: message.id,
      userId: admin.id,
    });

    const { publicKey, privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const deviceId = `smoke-device-${Date.now()}`;

    const device = await call<{ device: { id: string } }>(
      app,
      '/api/mobile/devices',
      token,
      'POST',
      {
        deviceId,
        publicKey: publicKeyPem,
        platform: 'test',
        model: 'Node smoke',
        appVersion: '1.0.0',
      },
    );
    assert(device.status === 200, 'Se registra la clave pública del dispositivo');
    deviceRowId = device.body.device.id;

    const challenge = await call<{
      challengeId: string;
      messageId: string;
      version: number;
      contentSha256: string;
    }>(app, `/api/documents/${document.id}/sign-challenge`, token, 'POST', {
      messageId: message.id,
    });
    assert(challenge.status === 200, 'Se crea el desafío de firma');

    const signaturePng = await QRCode.toBuffer(`firma-${document.id}`, {
      type: 'png',
      width: 240,
      margin: 1,
    });
    const signatureBase64 = signaturePng.toString('base64');
    const signatureSha256 = sha256Hex(signaturePng);

    const payload = buildSigningPayload({
      challengeId: challenge.body.challengeId,
      documentId: document.id,
      messageId: message.id,
      version: challenge.body.version,
      contentSha256: challenge.body.contentSha256,
      signatureSha256,
    });

    const deviceAssertion = cryptoSign('sha256', Buffer.from(payload, 'utf8'), {
      key: privateKey,
      dsaEncoding: 'der',
    }).toString('base64');

    const signed = await call<{
      signed: boolean;
      approved: boolean;
      certificate: { serial: string; verificationUrl: string };
    }>(app, `/api/inbox/${message.id}/approve-and-sign`, token, 'POST', {
      expectedVersion: 1,
      challengeId: challenge.body.challengeId,
      signaturePng: signatureBase64,
      strokes: [],
      method: 'drawn',
      deviceAssertion,
      allowSenderExport: true,
    }, { 'x-device-id': deviceId });

    if (signed.status !== 200) {
      throw new Error(`Aprobación y firma falló: ${signed.status} ${JSON.stringify(signed.body)}`);
    }
    assert(signed.body.approved === true && signed.body.signed === true, 'Se aprueba y firma en una llamada');
    assert(typeof signed.body.certificate.serial === 'string', 'Se emite un certificado con serie');

    const [certificate] = await db
      .select()
      .from(signatureCertificates)
      .where(eq(signatureCertificates.documentId, document.id))
      .limit(1);
    assert(Boolean(certificate), 'El certificado queda guardado en la base');

    const sealedStat = await stat(certificate!.sealedPdfPath);
    const certificateStat = await stat(certificate!.certificatePdfPath);
    assert(sealedStat.size > 1_000, 'El PDF sellado existe y tiene contenido');
    assert(certificateStat.size > 1_000, 'El certificado PDF existe y tiene contenido');

    const verificationToken = newVerificationToken();
    // El token real no se puede recuperar (solo se guarda su hash); se
    // comprueba la ruta pública con un token inventado y luego con el hash
    // del certificado.
    const invalid = await app.inject({
      method: 'GET',
      url: `/api/verify/${verificationToken}`,
      headers: { accept: 'application/json' },
    });
    assert(invalid.statusCode === 404, 'Un token de verificación inventado no valida');

    const verify = await app.inject({
      method: 'GET',
      url: `/api/verify/${extractToken(signed.body.certificate.verificationUrl)}`,
      headers: { accept: 'application/json' },
    });
    assert(verify.statusCode === 200, 'El QR público valida el certificado');
    const verifyBody = JSON.parse(verify.body) as {
      valid?: boolean;
      certificate?: { serial?: string; signature?: Record<string, unknown> };
    };
    assert(verifyBody.valid === true, 'La verificación pública responde «válido»');
    assert(verifyBody.certificate?.serial === signed.body.certificate.serial, 'La serie coincide');
    assert(
      !verifyBody.certificate?.signature ||
        !('ip' in (verifyBody.certificate.signature as Record<string, unknown>)),
      'La verificación pública no expone la IP del firmante',
    );

    // El hash del contenido coincide con el que se firmó.
    assert(canonicalContentHash(document) === challenge.body.contentSha256, 'El hash del contenido es estable');

    console.log(`\n✔ Flujo de firma móvil completo (${signed.body.certificate.serial})`);
  } finally {
    if (deviceRowId) {
      await db.delete(mobileDevices).where(eq(mobileDevices.id, deviceRowId));
    }
    if (documentId) {
      await db.delete(documents).where(eq(documents.id, documentId));
      await rm(join(resolve(process.cwd(), env.SIGNATURE_DIR), documentId), {
        recursive: true,
        force: true,
      });
    }
    await app.close();
    await closePdfBrowser();
    await sql.end({ timeout: 5 });
  }
}

function extractToken(url: string): string {
  const parts = url.split('/');
  return parts[parts.length - 1] ?? '';
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
