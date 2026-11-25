import { and, eq, inArray } from 'drizzle-orm';
import { inflateRawSync } from 'node:zlib';

import { db, sql } from '../src/db/index.js';
import {
  documentMessageRecipients,
  documentMessages,
  documentShares,
  documentVersions,
  documents,
  users,
} from '../src/db/schema.js';
import { signAccessToken } from '../src/lib/jwt.js';

const API = process.env.SD_API ?? 'http://localhost:3101/api';

interface ApiResult<T = unknown> {
  status: number;
  body: T;
}

async function call<T = unknown>(
  path: string,
  token: string,
  method = 'GET',
  body?: unknown,
): Promise<ApiResult<T>> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* respuesta de texto */
  }
  return { status: response.status, body: parsed as T };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`✖ ${message}`);
  console.log(`✔ ${message}`);
}

async function callBuffer(
  path: string,
  token: string,
): Promise<{ status: number; buffer: Buffer }> {
  const response = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return {
    status: response.status,
    buffer: Buffer.from(await response.arrayBuffer()),
  };
}

/** Extrae un archivo de un ZIP (DOCX) sin dependencias externas. */
function readZipEntry(zip: Buffer, entryName: string): string | null {
  let eocd = -1;
  for (let i = zip.length - 22; i >= 0; i -= 1) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return null;

  const entries = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);

  for (let i = 0; i < entries; i += 1) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) return null;
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);

    if (name === entryName) {
      const localNameLength = zip.readUInt16LE(localOffset + 26);
      const localExtraLength = zip.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const data = zip.subarray(dataStart, dataStart + compressedSize);
      return (method === 0 ? data : inflateRawSync(data)).toString('utf8');
    }

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

async function tokenFor(user: { id: string; email: string; name: string; role: 'admin' | 'member' }) {
  return signAccessToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });
}

async function main(): Promise<void> {
  const [admin] = await db
    .select()
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.isActive, true)))
    .limit(1);

  if (!admin) throw new Error('Hace falta un administrador activo');

  const suffix = Date.now();
  const [member] = await db
    .insert(users)
    .values({
      email: `smoke-annul-member-${suffix}@example.com`,
      name: 'Asistente de anulación',
      role: 'member',
      isActive: true,
    })
    .returning();

  const [otherAdmin] = await db
    .insert(users)
    .values({
      email: `smoke-annul-admin-${suffix}@example.com`,
      name: 'Otro administrador',
      role: 'admin',
      isActive: true,
    })
    .returning();

  const [recipient] = await db
    .insert(users)
    .values({
      email: `smoke-annul-recipient-${suffix}@example.com`,
      name: 'Destinatario de prueba',
      role: 'member',
      isActive: true,
    })
    .returning();

  if (!member || !otherAdmin || !recipient) throw new Error('No se pudieron crear los usuarios');

  const temporaryUserIds = [member.id, otherAdmin.id, recipient.id];
  const adminToken = await tokenFor(admin);
  const memberToken = await tokenFor(member);
  const otherAdminToken = await tokenFor(otherAdmin);
  const recipientToken = await tokenFor(recipient);

  const createdIds: string[] = [];

  try {
    const created = await call<{ document: { id: string; version: number } }>(
      '/documents',
      memberToken,
      'POST',
      {},
    );
    assert(created.status === 201, 'El asistente crea el memo');
    const documentId = created.body.document.id;
    const version = created.body.document.version;
    createdIds.push(documentId);

    const submitted = await call<{ id: string }>('/inbox', memberToken, 'POST', {
      documentId,
      recipientIds: [recipient.id],
      subject: 'Memo que se anulará',
      body: '',
      expectedVersion: version,
    });
    assert(submitted.status === 201, 'El asistente envía el memo a aprobación');

    const approved = await call<{ status: string; docNumber: string | null }>(
      `/inbox/${submitted.body.id}/approve`,
      adminToken,
      'POST',
      { expectedVersion: version, recipientIds: [recipient.id] },
    );
    assert(approved.status === 200 && approved.body.status === 'sent', 'El jefe aprueba el memo');

    const sealed = await call<{ document: { status: string; docNumber: string | null; lockedAt: string | null } }>(
      `/documents/${documentId}`,
      adminToken,
    );
    const sealedNumber = sealed.body.document.docNumber;
    assert(sealed.body.document.status === 'sent', 'El memo queda enviado');
    assert(Boolean(sealed.body.document.lockedAt), 'El memo queda sellado');

    const approverDetail = await call<{ canAnnul: boolean; isSender: boolean; isRecipient: boolean }>(
      `/inbox/${submitted.body.id}`,
      adminToken,
    );
    assert(approverDetail.status === 200, 'El aprobador abre el mensaje aprobado');
    assert(approverDetail.body.canAnnul === true, 'El aprobador ve la opción de anular');

    const memberCannot = await call(`/inbox/${submitted.body.id}/annul`, memberToken, 'POST', {
      expectedVersion: version,
    });
    assert(memberCannot.status === 403, 'Un miembro no puede anular aunque sea el remitente');

    const otherAdminCannot = await call(`/inbox/${submitted.body.id}/annul`, otherAdminToken, 'POST', {
      expectedVersion: version,
    });
    assert(otherAdminCannot.status === 403, 'Otro administrador distinto del aprobador no puede anular');

    const wrongVersion = await call(`/inbox/${submitted.body.id}/annul`, adminToken, 'POST', {
      expectedVersion: version + 99,
    });
    assert(wrongVersion.status === 409, 'La anulación respeta el versionado optimista');

    const annulled = await call<{ ok: boolean; status: string }>(
      `/inbox/${submitted.body.id}/annul`,
      adminToken,
      'POST',
      { expectedVersion: version, reason: 'Se emitió por error.' },
    );
    assert(annulled.status === 200, 'El aprobador anula el memo');

    const annulledDetail = await call<{
      status: string;
      canAnnul: boolean;
      annulledAt: string | null;
      annulledByName: string | null;
      annulledReason: string | null;
      document: { status: string; docNumber: string | null; lockedAt: string | null };
    }>(`/inbox/${submitted.body.id}`, adminToken);
    assert(annulledDetail.body.status === 'cancelled', 'El mensaje queda anulado');
    assert(annulledDetail.body.canAnnul === false, 'Un memo anulado ya no se puede volver a anular');
    assert(annulledDetail.body.annulledByName === admin.name, 'Se conoce quién lo anuló');
    assert(
      annulledDetail.body.annulledReason === 'Se emitió por error.',
      'Se conserva el motivo de la anulación',
    );
    assert(annulledDetail.body.document.status === 'cancelled', 'El documento queda anulado');
    assert(
      annulledDetail.body.document.docNumber === sealedNumber,
      'El número correlativo se conserva',
    );
    assert(Boolean(annulledDetail.body.document.lockedAt), 'El memo anulado sigue bloqueado');

    const secondAnnul = await call(`/inbox/${submitted.body.id}/annul`, adminToken, 'POST', {
      expectedVersion: version,
    });
    assert(secondAnnul.status === 409, 'No se puede anular dos veces');

    const recipientDetail = await call(`/inbox/${submitted.body.id}`, recipientToken);
    assert(recipientDetail.status === 404, 'El destinatario deja de ver el mensaje anulado');

    const recipientReceived = await call<{ items: { id: string }[] }>(
      '/inbox?scope=received',
      recipientToken,
    );
    assert(
      !recipientReceived.body.items.some((item) => item.id === submitted.body.id),
      'El memo anulado desaparece de Recibidos del destinatario',
    );

    const senderCancelled = await call<{ items: { id: string }[] }>(
      '/inbox?scope=sent&status=cancelled',
      memberToken,
    );
    assert(
      senderCancelled.body.items.some((item) => item.id === submitted.body.id),
      'El remitente conserva el memo en Anulados',
    );

    const approverCancelled = await call<{ items: { id: string }[] }>(
      '/inbox?scope=sent&status=cancelled',
      adminToken,
    );
    assert(
      approverCancelled.body.items.some((item) => item.id === submitted.body.id),
      'El aprobador conserva el memo en Anulados',
    );

    const previewHtml = await call<string>(
      `/documents/${documentId}/html?preview=1`,
      recipientToken,
    );
    assert(previewHtml.status === 200, 'La vista previa sigue disponible para quien conserva acceso');
    assert(
      typeof previewHtml.body === 'string' &&
        previewHtml.body.includes('<div class="doc-watermark"') &&
        previewHtml.body.includes('ANULADO'),
      'La vista previa lleva la marca de agua «ANULADO»',
    );

    const fullHtml = await call<string>(`/documents/${documentId}/export/html`, adminToken);
    assert(fullHtml.status === 200, 'El aprobador exporta el memo anulado');
    assert(
      typeof fullHtml.body === 'string' &&
        fullHtml.body.includes('<div class="doc-watermark"') &&
        fullHtml.body.includes('ANULADO'),
      'El HTML exportado lleva la marca de agua',
    );

    const pdf = await call(`/documents/${documentId}/export/pdf`, adminToken);
    assert(pdf.status === 200, 'El PDF del memo anulado se genera');

    const docx = await callBuffer(`/documents/${documentId}/export/docx`, adminToken);
    assert(docx.status === 200, 'El DOCX del memo anulado se genera');
    const docxHeader = readZipEntry(docx.buffer, 'word/header1.xml');
    assert(
      Boolean(docxHeader?.includes('ANULADO') && docxHeader.includes('textpath')),
      'El DOCX incluye la marca de agua nativa de Word',
    );

    console.log('\n✔ Anulación y marca de agua verificadas');
  } finally {
    if (createdIds.length > 0) {
      const messages = await db
        .select({ id: documentMessages.id })
        .from(documentMessages)
        .where(inArray(documentMessages.documentId, createdIds));
      if (messages.length > 0) {
        const messageIds = messages.map((m) => m.id);
        await db
          .delete(documentMessageRecipients)
          .where(inArray(documentMessageRecipients.messageId, messageIds));
        await db.delete(documentMessages).where(inArray(documentMessages.id, messageIds));
      }
      await db.delete(documentVersions).where(inArray(documentVersions.documentId, createdIds));
      await db.delete(documentShares).where(inArray(documentShares.documentId, createdIds));
      await db.delete(documents).where(inArray(documents.id, createdIds));
    }
    await db.delete(users).where(inArray(users.id, temporaryUserIds));
    await sql.end();
  }
}

main().catch(async (error) => {
  console.error(error);
  await sql.end().catch(() => undefined);
  process.exit(1);
});
