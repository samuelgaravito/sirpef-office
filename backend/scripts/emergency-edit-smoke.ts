#!/usr/bin/env tsx
/**
 * Smoke de edición de emergencia con TOTP.
 *
 *   npm run smoke:emergency-edit
 *
 * Verifica que solo el aprobador vigente pueda abrirla, que el código TOTP sea
 * obligatorio, que el mensaje anterior quede supersedido y que al terminar se
 * cree una revisión pendiente.
 */
import { eq } from 'drizzle-orm';

import { buildApp } from '../src/app.js';
import { db, sql } from '../src/db/index.js';
import {
  documentEmergencyEdits,
  documentMessages,
  documentSignatures,
  documents,
  signatureCertificates,
  totpCredentials,
  users,
} from '../src/db/schema.js';
import { closePdfBrowser } from '../src/export/pdf.js';
import { signAccessToken } from '../src/lib/jwt.js';
import { sha256Hex } from '../src/lib/stable-json.js';
import {
  currentTotpStep,
  encryptTotpSecret,
  generateTotpSecret,
  totpCode,
} from '../src/lib/totp.js';

interface ApiResponse<T = unknown> {
  status: number;
  body: T;
}

async function call<T = unknown>(
  app: Awaited<ReturnType<typeof buildApp>>,
  path: string,
  token: string,
  method: 'GET' | 'POST' | 'PUT' = 'GET',
  body?: unknown,
): Promise<ApiResponse<T>> {
  const response = await app.inject({
    method,
    url: path,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
  const text = response.body;
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* respuesta de texto */
  }
  return { status: response.statusCode, body: parsed as T };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`✖ ${message}`);
  console.log(`✔ ${message}`);
}

async function main(): Promise<void> {
  const [approver] = await db
    .insert(users)
    .values({
      email: `smoke-emergency-${Date.now()}@example.test`,
      name: 'Aprobador de emergencia',
      role: 'admin',
      isActive: true,
    })
    .returning();
  const [otherAdmin] = await db
    .insert(users)
    .values({
      email: `smoke-emergency-other-${Date.now()}@example.test`,
      name: 'Otro administrador',
      role: 'admin',
      isActive: true,
    })
    .returning();
  if (!approver || !otherAdmin) throw new Error('No se pudieron crear los usuarios');

  const secret = generateTotpSecret();
  const encrypted = encryptTotpSecret({ userId: approver.id, secret });
  await db.insert(totpCredentials).values({
    userId: approver.id,
    secretEncrypted: encrypted.encrypted,
    keyId: encrypted.keyId,
    pairedDeviceId: 'smoke-emergency-phone',
    pairedDeviceLabel: 'Teléfono de prueba',
  });

  const approverToken = await signAccessToken({
    sub: approver.id,
    email: approver.email,
    name: approver.name,
    role: approver.role,
  });
  const otherToken = await signAccessToken({
    sub: otherAdmin.id,
    email: otherAdmin.email,
    name: otherAdmin.name,
    role: otherAdmin.role,
  });

  const docNumber = `EMG-${Date.now()}`;
  const [document] = await db
    .insert(documents)
    .values({
      ownerId: approver.id,
      title: `Documento emergencia ${Date.now()}`,
      description: 'Documento temporal del smoke de emergencia',
      docType: 'blank',
      status: 'sent',
      docNumber,
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Contenido original.' }],
          },
        ],
      },
      data: {},
      version: 1,
      lockedAt: new Date(),
      lockedBy: approver.id,
    })
    .returning();
  if (!document) throw new Error('No se pudo crear el documento');

  const [originalMessage] = await db
    .insert(documentMessages)
    .values({
      documentId: document.id,
      senderId: approver.id,
      subject: 'Envío original',
      body: 'Aprobado original',
      status: 'sent',
      documentVersion: 1,
      approvedById: approver.id,
      approvedAt: new Date(),
      sentAt: new Date(),
    })
    .returning();
  if (!originalMessage) throw new Error('No se pudo crear el mensaje original');

  const [oldSignature] = await db
    .insert(documentSignatures)
    .values({
      documentId: document.id,
      messageId: originalMessage.id,
      userId: approver.id,
      method: 'drawn',
      signaturePng: 'iVBORw0KGgo=',
      strokes: [],
      contentSha256: 'old-content',
      signatureSha256: 'old-signature',
      status: 'sealed',
    })
    .returning();
  if (!oldSignature) throw new Error('No se pudo crear la firma antigua');
  const verificationToken = 'smoke-emergency-certificate';
  await db.insert(signatureCertificates).values({
    serial: `EMG-${Date.now()}`,
    documentId: document.id,
    signatureId: oldSignature.id,
    verificationTokenHash: sha256Hex(verificationToken),
    certJson: { status: 'valid' },
    sealedPdfPath: '/tmp/smoke-emergency.pdf',
    certificatePdfPath: '/tmp/smoke-emergency-cert.pdf',
    sealedPdfSha256: 'old-pdf',
  });

  const app = await buildApp();
  try {
    const code = totpCode({ secret, step: currentTotpStep() });

    const other = await call(
      app,
      `/api/documents/${document.id}/emergency-edit`,
      otherToken,
      'POST',
      {
        reason: 'Intento de otro administrador',
        expectedVersion: 1,
        code,
      },
    );
    assert(other.status === 403, 'Otro administrador no puede abrir la emergencia');

    const start = await call<{ emergencyEditId: string }>(
      app,
      `/api/documents/${document.id}/emergency-edit`,
      approverToken,
      'POST',
      {
        reason: 'Corregir el contenido aprobado',
        expectedVersion: 1,
        code,
      },
    );
    assert(start.status === 200 && Boolean(start.body.emergencyEditId), 'El aprobador abre la emergencia con TOTP');

    const saved = await call(
      app,
      `/api/documents/${document.id}/content`,
      approverToken,
      'PUT',
      {
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'Contenido corregido de emergencia.' }],
            },
          ],
        },
        title: document.title,
        description: document.description,
        data: {},
        expectedVersion: 1,
      },
    );
    assert(saved.status === 200, 'Se guarda el contenido durante la emergencia');

    const [documentAfterSave] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, document.id))
      .limit(1);
    assert(documentAfterSave?.status === 'in_review', 'El documento pasa a revisión');
    assert(documentAfterSave?.emergencyEditOpen === true, 'El documento queda marcado en emergencia');

    const [oldMessage] = await db
      .select()
      .from(documentMessages)
      .where(eq(documentMessages.id, originalMessage.id))
      .limit(1);
    assert(oldMessage?.status === 'superseded', 'El mensaje anterior queda supersedido');

    const [oldCertificate] = await db
      .select()
      .from(signatureCertificates)
      .where(eq(signatureCertificates.documentId, document.id))
      .limit(1);
    assert(Boolean(oldCertificate?.supersededAt), 'El certificado anterior queda supersedido');

    const verifyOld = await app.inject({
      method: 'GET',
      url: `/api/verify/${verificationToken}`,
      headers: { accept: 'application/json' },
    });
    const verifyBody = JSON.parse(verifyOld.body) as { valid?: boolean; superseded?: boolean };
    assert(verifyBody.valid === false && verifyBody.superseded === true, 'El QR anterior ya no valida');

    const finish = await call<{ changed: boolean; messageId: string }>(
      app,
      `/api/documents/${document.id}/emergency-edit/${start.body.emergencyEditId}/finish`,
      approverToken,
      'POST',
      {},
    );
    assert(finish.status === 200 && finish.body.changed, 'Se cierra la emergencia y se crea la revisión');

    const [newMessage] = await db
      .select()
      .from(documentMessages)
      .where(eq(documentMessages.id, finish.body.messageId))
      .limit(1);
    assert(newMessage?.status === 'pending_approval', 'La revisión queda pendiente de aprobación');

    const [edit] = await db
      .select()
      .from(documentEmergencyEdits)
      .where(eq(documentEmergencyEdits.id, start.body.emergencyEditId))
      .limit(1);
    assert(edit?.status === 'finished', 'La edición de emergencia queda auditada como terminada');

    console.log('\n✔ Smoke de edición de emergencia completo');
  } finally {
    await db.delete(documents).where(eq(documents.id, document.id));
    await db.delete(users).where(eq(users.id, approver.id));
    await db.delete(users).where(eq(users.id, otherAdmin.id));
    await app.close();
    await closePdfBrowser();
    await sql.end({ timeout: 5 });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
