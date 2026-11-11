/**
 * Documentos de demostración para probar el panel de revisión del editor.
 *
 * Crea un miembro demo con contraseña conocida y dos documentos suyos:
 *   1. Pendiente de aprobación → el admin lo abre, lo edita y lo aprueba desde
 *      el panel de revisión del editor.
 *   2. Devuelto para corrección → conserva el motivo del rechazo para probar
 *      la tarjeta «Mensaje del revisor» y el reenvío.
 *
 * Es idempotente: borra los documentos cuyo título empieza por «DEMO REVISIÓN ·»
 * antes de recrearlos. No modifica usuarios existentes salvo el miembro demo.
 *
 * Uso: npm run demo:review  (con la API levantada)
 */
import { and, eq, inArray, isNull, like } from 'drizzle-orm';

import { db } from '../src/db/index.js';
import {
  activities,
  documentMessageRecipients,
  documentMessages,
  documentShares,
  documentVersions,
  documents,
  templates,
  users,
} from '../src/db/schema.js';
import { signAccessToken } from '../src/lib/jwt.js';
import { hashPassword } from '../src/lib/password.js';

const API = process.env.SD_API ?? 'http://localhost:3101/api';
const TITLE_PREFIX = 'DEMO REVISIÓN ·';
const DEMO_MEMBER_EMAIL = 'demo.miembro@sirpefoffice.local';
const DEMO_MEMBER_PASSWORD = 'Demo1234!';

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

async function tokenFor(user: typeof users.$inferSelect): Promise<string> {
  return signAccessToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });
}

/** Limpia solo los documentos de esta demo, no el resto de la bandeja. */
async function cleanPreviousDemo(): Promise<void> {
  const old = await db
    .select({ id: documents.id })
    .from(documents)
    .where(like(documents.title, `${TITLE_PREFIX}%`));

  if (old.length === 0) return;

  const ids = old.map((row) => row.id);
  const messages = await db
    .select({ id: documentMessages.id })
    .from(documentMessages)
    .where(inArray(documentMessages.documentId, ids));

  if (messages.length > 0) {
    await db
      .delete(documentMessageRecipients)
      .where(inArray(documentMessageRecipients.messageId, messages.map((row) => row.id)));
    await db
      .delete(documentMessages)
      .where(inArray(documentMessages.documentId, ids));
  }

  await db
    .delete(activities)
    .where(and(eq(activities.entityType, 'document'), inArray(activities.entityId, ids)));
  await db.delete(documentVersions).where(inArray(documentVersions.documentId, ids));
  await db.delete(documentShares).where(inArray(documentShares.documentId, ids));
  await db.delete(documents).where(inArray(documents.id, ids));
  console.log(`• Limpiados ${ids.length} documentos de demostración anteriores`);
}

async function ensureDemoMember(): Promise<typeof users.$inferSelect> {
  const [existing] = await db
    .select()
    .from(users)
    .where(eq(users.email, DEMO_MEMBER_EMAIL))
    .limit(1);

  const passwordHash = await hashPassword(DEMO_MEMBER_PASSWORD);

  if (existing) {
    const [updated] = await db
      .update(users)
      .set({
        name: 'Miembro de prueba',
        role: 'member',
        isActive: true,
        passwordHash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id))
      .returning();
    assert(Boolean(updated), 'Miembro demo listo');
    return updated!;
  }

  const [created] = await db
    .insert(users)
    .values({
      email: DEMO_MEMBER_EMAIL,
      name: 'Miembro de prueba',
      role: 'member',
      isActive: true,
      passwordHash,
    })
    .returning();

  assert(Boolean(created), 'Miembro demo creado');
  return created!;
}

interface DemoDocument {
  id: string;
  version: number;
}

async function createDemoDocument(
  token: string,
  templateId: string | null,
  title: string,
  data: Record<string, unknown>,
): Promise<DemoDocument> {
  const created = await call<{ document: { id: string; version: number } }>(
    '/documents',
    token,
    'POST',
    {
      ...(templateId ? { templateId } : {}),
      title: `${TITLE_PREFIX} ${title}`,
      description: 'Documento de demostración para probar la revisión dentro del editor.',
      docType: 'memorandum',
      data,
    },
  );
  assert(created.status === 201, `Documento creado: ${title}`);
  return created.body.document;
}

async function submitToApproval(
  token: string,
  documentId: string,
  expectedVersion: number,
  adminId: string,
  subject: string,
  body: string,
): Promise<string> {
  const submitted = await call<{ id: string; status: string }>('/inbox', token, 'POST', {
    documentId,
    recipientIds: [adminId],
    subject,
    body,
    expectedVersion,
  });
  assert(submitted.status === 201, `Envío a aprobación creado: ${subject}`);
  return submitted.body.id;
}

async function main(): Promise<void> {
  const [admin] = await db
    .select()
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.isActive, true)))
    .limit(1);

  if (!admin) throw new Error('No hay un administrador activo');

  const member = await ensureDemoMember();
  const memberToken = await tokenFor(member);
  const adminToken = await tokenFor(admin);

  const [template] = await db
    .select({ id: templates.id })
    .from(templates)
    .where(
      and(
        eq(templates.name, 'Memorándum'),
        eq(templates.isActive, true),
        isNull(templates.deletedAt),
      ),
    )
    .limit(1);

  await cleanPreviousDemo();

  const today = new Date().toISOString().slice(0, 10);
  const data = {
    numero: 'MEM-DEMO-0001',
    destinatario: admin.name,
    cargo_destinatario: 'Administrador',
    remitente: member.name,
    cargo_remitente: 'Asistente administrativo',
    asunto: 'Revisión del memorándum de prueba',
    fecha: today,
    referencia: 'DEMO-REV-001',
    cuerpo:
      'Por medio del presente se remite el memorándum de prueba para su revisión y aprobación.\n\n' +
      'Este documento fue creado por un miembro para probar el panel de revisión dentro del editor. ' +
      'Puedes modificar el contenido o los datos antes de aprobarlo.',
    firma: member.name,
  };

  /* ── 1. Documento pendiente de aprobación ── */
  const pendingDoc = await createDemoDocument(
    memberToken,
    template?.id ?? null,
    'Memorándum pendiente',
    data,
  );
  const pendingMessageId = await submitToApproval(
    memberToken,
    pendingDoc.id,
    pendingDoc.version,
    admin.id,
    'Solicitud de revisión · Memorándum de prueba',
    'Adjunto el memorándum para su revisión y aprobación. Puedes editarlo y decidir desde el panel de revisión del editor.',
  );

  /* ── 2. Documento devuelto para corrección ── */
  const rejectedDoc = await createDemoDocument(
    memberToken,
    template?.id ?? null,
    'Memorándum devuelto',
    { ...data, numero: 'MEM-DEMO-0002', asunto: 'Documento devuelto para corrección' },
  );
  const rejectedMessageId = await submitToApproval(
    memberToken,
    rejectedDoc.id,
    rejectedDoc.version,
    admin.id,
    'Solicitud de revisión · Documento para corrección',
    'Adjunto el memorándum para su revisión.',
  );
  const rejected = await call(`/inbox/${rejectedMessageId}/reject`, adminToken, 'POST', {
    reason: 'Falta la firma del jefe y ajustar el párrafo final del cuerpo.',
    allowEdit: true,
  });
  assert(rejected.status === 200, 'Documento devuelto para corrección');

  console.log('');
  console.log('──────────────────────────────────────────────');
  console.log('Demo de revisión lista');
  console.log('──────────────────────────────────────────────');
  console.log(`Admin:  ${admin.email}`);
  console.log(`Miembro demo: ${DEMO_MEMBER_EMAIL} / ${DEMO_MEMBER_PASSWORD}`);
  console.log('');
  console.log('Documento pendiente (apruébalo desde el editor):');
  console.log(`  /documents/${pendingDoc.id}`);
  console.log(`  mensaje: /inbox/${pendingMessageId}`);
  console.log('Documento devuelto (para probar la corrección):');
  console.log(`  /documents/${rejectedDoc.id}`);
  console.log(`  mensaje: /inbox/${rejectedMessageId}`);
  console.log('');
  console.log('Abre el documento pendiente como admin: el envío fue creado por el');
  console.log('miembro demo y el backend lo compartió contigo como editor.');
  console.log('──────────────────────────────────────────────');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
