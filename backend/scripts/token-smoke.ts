#!/usr/bin/env tsx
/**
 * Smoke del token TOTP y de la autorización de firma.
 *
 *   npm run smoke:token
 *
 * Cubre los vectores RFC 6238, la vinculación desde un dispositivo, la
 * autorización de un desafío, el antirreplay, el reset y los códigos de
 * recuperación contra PostgreSQL real. Limpia todo al final.
 */
import { generateKeyPairSync, sign as cryptoSign } from 'node:crypto';
import { rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import QRCode from 'qrcode';
import { eq } from 'drizzle-orm';

import { buildApp } from '../src/app.js';
import { db, sql } from '../src/db/index.js';
import {
  documentMessageRecipients,
  documentMessages,
  documents,
  mobileDevices,
  users,
} from '../src/db/schema.js';
import { closePdfBrowser } from '../src/export/pdf.js';
import { env } from '../src/env.js';
import { signAccessToken } from '../src/lib/jwt.js';
import {
  buildSigningPayload,
  canonicalContentHash,
} from '../src/lib/signature.js';
import { sha256Hex } from '../src/lib/stable-json.js';
import {
  buildTotpDevicePayload,
  currentTotpStep,
  totpCode,
  verifyTotpCode,
} from '../src/lib/totp.js';

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
  // Vectores oficiales del RFC 6238 (SHA-1, 8 dígitos).
  const rfcSecret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  const vectors: Array<[number, string]> = [
    [59, '94287082'],
    [1_111_111_109, '07081804'],
    [1_111_111_111, '14050471'],
    [1_234_567_890, '89005924'],
    [2_000_000_000, '69279037'],
  ];
  for (const [at, expected] of vectors) {
    const step = Math.floor(at / 30);
    assert(totpCode({ secret: rfcSecret, step, digits: 8 }) === expected, `TOTP RFC en t=${at}`);
  }
  assert(
    verifyTotpCode({ secret: rfcSecret, code: '287082', at: 59_000 }).valid,
    'TOTP de 6 dígitos válido en su ventana',
  );

  const [signer] = await db
    .insert(users)
    .values({
      email: `smoke-token-${Date.now()}@example.test`,
      name: 'Firmante Token Smoke',
      role: 'admin',
      isActive: true,
    })
    .returning();
  if (!signer) throw new Error('No se pudo crear el firmante temporal');
  const token = await signAccessToken({
    sub: signer.id,
    email: signer.email,
    name: signer.name,
    role: signer.role,
  });

  const app = await buildApp();
  let documentId: string | null = null;
  let deviceRowId: string | null = null;

  try {
    const { publicKey, privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString();
    const deviceId = `smoke-token-device-${Date.now()}`;

    const device = await call<{ device: { id: string } }>(
      app,
      '/api/mobile/devices',
      token,
      'POST',
      {
        deviceId,
        publicKey: publicKeyPem,
        platform: 'test',
        model: 'Node token smoke',
        appVersion: '1.0.0',
      },
    );
    assert(device.status === 200, 'Se registra el dispositivo de firma');
    deviceRowId = device.body.device.id;

    // 1. La app Firma pide un nonce y lo firma con biometría.
    const pairingChallenge = await call<{ nonce: string }>(
      app,
      '/api/mobile/token/device-challenge',
      token,
      'POST',
      { purpose: 'pairing' },
      { 'x-device-id': deviceId },
    );
    assert(pairingChallenge.status === 200, 'Se crea el desafío de vinculación');

    const pairingPayload = buildTotpDevicePayload({
      purpose: 'pairing',
      nonce: pairingChallenge.body.nonce,
    });
    const pairingAssertion = cryptoSign(
      'sha256',
      Buffer.from(pairingPayload, 'utf8'),
      { key: privateKey, dsaEncoding: 'der' },
    ).toString('base64');

    const pairing = await call<{ code: string; expiresAt: string }>(
      app,
      '/api/mobile/token/pairing',
      token,
      'POST',
      { nonce: pairingChallenge.body.nonce, deviceAssertion: pairingAssertion },
      { 'x-device-id': deviceId },
    );
    assert(pairing.status === 200, 'La app Firma genera un código de vinculación');
    assert(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(pairing.body.code), 'El código de vinculación tiene formato legible');

    // 2. La app Token canjea el código y recibe el secreto una sola vez.
    const phoneDeviceId = `smoke-token-phone-${Date.now()}`;
    const paired = await call<{ secret: string; secretUpdatedAt: string }>(
      app,
      '/api/mobile/token/pair',
      token,
      'POST',
      {
        mode: 'pairing',
        code: pairing.body.code,
        deviceId: phoneDeviceId,
        deviceLabel: 'Teléfono de prueba',
      },
    );
    assert(paired.status === 200, 'La app Token canjea el código de vinculación');
    assert(/^[A-Z2-7]{32}$/.test(paired.body.secret), 'El secreto TOTP es Base32 de 160 bits');
    const secret = paired.body.secret;

    const status = await call<{ paired: boolean; requiredForSigning: boolean }>(
      app,
      '/api/mobile/token/status',
      token,
    );
    assert(status.status === 200 && status.body.paired, 'El estado indica que Token está vinculado');
    assert(status.body.requiredForSigning === true, 'La firma exige Token por configuración');

    // 3. Documento y desafío de firma.
    const [document] = await db
      .insert(documents)
      .values({
        ownerId: signer.id,
        title: `Prueba Token ${Date.now()}`,
        description: 'Documento temporal del smoke de Token',
        docType: 'blank',
        status: 'in_review',
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Documento de prueba para el token TOTP.' }],
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
        senderId: signer.id,
        subject: 'Solicitud de prueba con Token',
        body: 'Aprueba y firma este documento de prueba.',
        status: 'pending_approval',
        documentVersion: 1,
      })
      .returning();
    if (!message) throw new Error('No se pudo crear el mensaje');
    await db.insert(documentMessageRecipients).values({
      messageId: message.id,
      userId: signer.id,
    });

    const createChallenge = async () => {
      const response = await call<{
        challengeId: string;
        version: number;
        contentSha256: string;
      }>(app, `/api/documents/${document.id}/sign-challenge`, token, 'POST', {
        messageId: message.id,
      });
      assert(response.status === 200, 'Se crea el desafío de firma');
      return response.body;
    };

    const challenge = await createChallenge();
    const signaturePng = await QRCode.toBuffer(`firma-token-${document.id}`, {
      type: 'png',
      width: 240,
      margin: 1,
    });
    const signatureBase64 = signaturePng.toString('base64');
    const signatureSha256 = sha256Hex(signaturePng);

    const payload = buildSigningPayload({
      challengeId: challenge.challengeId,
      documentId: document.id,
      messageId: message.id,
      version: challenge.version,
      contentSha256: challenge.contentSha256,
      signatureSha256,
    });
    const deviceAssertion = cryptoSign('sha256', Buffer.from(payload, 'utf8'), {
      key: privateKey,
      dsaEncoding: 'der',
    }).toString('base64');

    const step = currentTotpStep();
    const code = totpCode({ secret, step });

    const authorization = await call<{ authorized: boolean }>(
      app,
      `/api/documents/${document.id}/sign-authorization`,
      token,
      'POST',
      {
        messageId: message.id,
        challengeId: challenge.challengeId,
        code,
        signatureSha256,
        deviceAssertion,
      },
      { 'x-device-id': deviceId },
    );
    assert(authorization.status === 200 && authorization.body.authorized, 'El código autoriza el desafío');

    // 4. El mismo código no puede reutilizarse en otro desafío, aunque el
    // mensaje siga pendiente.
    const replayChallenge = await createChallenge();
    const replayPayload = buildSigningPayload({
      challengeId: replayChallenge.challengeId,
      documentId: document.id,
      messageId: message.id,
      version: replayChallenge.version,
      contentSha256: replayChallenge.contentSha256,
      signatureSha256,
    });
    const replayAssertion = cryptoSign('sha256', Buffer.from(replayPayload, 'utf8'), {
      key: privateKey,
      dsaEncoding: 'der',
    }).toString('base64');
    const replay = await call(
      app,
      `/api/documents/${document.id}/sign-authorization`,
      token,
      'POST',
      {
        messageId: message.id,
        challengeId: replayChallenge.challengeId,
        code,
        signatureSha256,
        deviceAssertion: replayAssertion,
      },
      { 'x-device-id': deviceId },
    );
    assert(
      replay.status === 409 || replay.status === 400,
      'El código TOTP no se puede reutilizar',
    );

    const withoutAuthorization = await call(
      app,
      `/api/inbox/${message.id}/approve-and-sign`,
      token,
      'POST',
      {
        expectedVersion: 1,
        challengeId: replayChallenge.challengeId,
        signaturePng: signatureBase64,
        strokes: [],
        method: 'drawn',
        deviceAssertion: replayAssertion,
        allowSenderExport: true,
      },
      { 'x-device-id': deviceId },
    );
    assert(
      withoutAuthorization.status === 403,
      'Sin autorización TOTP no se puede aprobar ni sellar',
    );

    const signed = await call<{
      approved: boolean;
      signed: boolean;
      certificate: { serial: string };
    }>(app, `/api/inbox/${message.id}/approve-and-sign`, token, 'POST', {
      expectedVersion: 1,
      challengeId: challenge.challengeId,
      signaturePng: signatureBase64,
      strokes: [],
      method: 'drawn',
      deviceAssertion,
      allowSenderExport: true,
    }, { 'x-device-id': deviceId });
    if (signed.status !== 200) {
      throw new Error(`Aprobación y firma falló: ${signed.status} ${JSON.stringify(signed.body)}`);
    }
    assert(signed.body.approved && signed.body.signed, 'El documento se aprueba y sella con Token');
    assert(Boolean(signed.body.certificate.serial), 'Se emite el certificado');

    // 5. Códigos de recuperación.
    const recoveryChallenge = await call<{ nonce: string }>(
      app,
      '/api/mobile/token/device-challenge',
      token,
      'POST',
      { purpose: 'recovery' },
      { 'x-device-id': deviceId },
    );
    assert(recoveryChallenge.status === 200, 'Se crea el desafío de recuperación');
    const recoveryPayload = buildTotpDevicePayload({
      purpose: 'recovery',
      nonce: recoveryChallenge.body.nonce,
    });
    const recoveryAssertion = cryptoSign(
      'sha256',
      Buffer.from(recoveryPayload, 'utf8'),
      { key: privateKey, dsaEncoding: 'der' },
    ).toString('base64');
    const recovery = await call<{ codes: string[] }>(
      app,
      '/api/mobile/token/recovery-codes',
      token,
      'POST',
      { nonce: recoveryChallenge.body.nonce, deviceAssertion: recoveryAssertion },
      { 'x-device-id': deviceId },
    );
    assert(recovery.status === 200 && recovery.body.codes.length === env.TOTP_RECOVERY_CODE_COUNT, 'Se generan los códigos de recuperación');

    const rep = await call<{ secret: string }>(
      app,
      '/api/mobile/token/pair',
      token,
      'POST',
      {
        mode: 'recovery',
        code: recovery.body.codes[0],
        deviceId: phoneDeviceId,
        deviceLabel: 'Teléfono recuperado',
        replace: true,
      },
    );
    assert(rep.status === 200 && rep.body.secret !== secret, 'Un código de recuperación rota el secreto');

    // 6. Reset explícito.
    const reset = await call<{ secret: string }>(
      app,
      '/api/mobile/token/reset',
      token,
      'POST',
      { deviceId: phoneDeviceId, deviceLabel: 'Teléfono rotado' },
    );
    assert(reset.status === 200 && reset.body.secret !== rep.body.secret, 'El reset rota el secreto');

    const unpair = await call(
      app,
      '/api/mobile/token/unpair',
      token,
      'POST',
      { deviceId: phoneDeviceId },
    );
    assert(unpair.status === 200, 'El teléfono Token puede desvincularse');

    // 7. Sin autorización, el sellado se rechaza.
    assert(canonicalContentHash(document) === challenge.contentSha256, 'El hash del contenido es estable');

    console.log('\n✔ Smoke de SirpefOffice Token completo');
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
    await db.delete(users).where(eq(users.id, signer.id));
    await app.close();
    await closePdfBrowser();
    await sql.end({ timeout: 5 });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
