/**
 * Siembra de demostración de la bandeja con resultados de aprobación.
 *
 * Crea cuatro escenarios para revisar visualmente la bandeja y el aviso al
 * asistente cuando el jefe aprueba o rechaza:
 *
 *   1. Envío directo de un administrador → Recibidos del jefe (sin leer).
 *   2. Solicitud pendiente del asistente → Recibidos → Pendientes.
 *   3. Memo aprobado por el jefe → Enviados del asistente, estado «Aprobados».
 *   4. Memo rechazado por el jefe → Enviados del asistente, estado «Rechazados».
 *   5. Envío cancelado por el asistente → Enviados con chip gris.
 *
 * Es idempotente: borra los documentos cuyo título empieza por «DEMO BANDEJA ·»
 * antes de volver a crearlos.
 *
 * Uso: npm run demo:inbox  (con la API levantada)
 */
import { and, eq, inArray, like } from 'drizzle-orm';

import { db, sql } from '../src/db/index.js';
import {
  activities,
  documentMessageRecipients,
  documentMessages,
  documentShares,
  documentVersions,
  documents,
  users,
} from '../src/db/schema.js';
import { signAccessToken } from '../src/lib/jwt.js';

const API = 'http://localhost:3101/api';
const BOSS_EMAIL = 'garavito350@gmail.com';
const ADMIN_EMAIL = 'velizsamuel50@gmail.com';
const MEMBER_EMAIL = 'asistente@sirpefoffice.local';
const TITLE_PREFIX = 'DEMO BANDEJA ·';

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

function memoContent(heading: string, paragraphs: string[]) {
  return {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: heading }] },
      ...paragraphs.map((text) => ({
        type: 'paragraph',
        content: [{ type: 'text', text }],
      })),
    ],
  };
}

async function tokenFor(user: typeof users.$inferSelect): Promise<string> {
  return signAccessToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });
}

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

  await db.delete(activities).where(
    and(eq(activities.entityType, 'document'), inArray(activities.entityId, ids)),
  );
  await db.delete(documentVersions).where(inArray(documentVersions.documentId, ids));
  await db.delete(documentShares).where(inArray(documentShares.documentId, ids));
  await db.delete(documents).where(inArray(documents.id, ids));
  console.log(`• Limpiados ${ids.length} documentos de demostración anteriores`);
}

interface Scenario {
  id: string;
  version: number;
}

async function createMemo(
  token: string,
  title: string,
  description: string,
  paragraphs: string[],
): Promise<Scenario> {
  const created = await call<{ document: { id: string; version: number } }>(
    '/documents',
    token,
    'POST',
    { title: `${TITLE_PREFIX} ${title}`, description, docType: 'memorandum' },
  );
  assert(created.status === 201, `Documento creado: ${title}`);

  const updated = await call<{ version: number }>(
    `/documents/${created.body.document.id}/content`,
    token,
    'PUT',
    {
      content: memoContent('MEMORÁNDUM', paragraphs),
      expectedVersion: created.body.document.version,
      title: `${TITLE_PREFIX} ${title}`,
      description,
      checkpoint: true,
      note: 'Contenido de demostración',
    },
  );
  assert(updated.status === 200, `Contenido redactado: ${title}`);

  return { id: created.body.document.id, version: updated.body.version };
}

async function submit(
  token: string,
  scenario: Scenario,
  recipientId: string,
  subject: string,
  body: string,
): Promise<string> {
  const response = await call<{ id: string; status: string }>('/inbox', token, 'POST', {
    documentId: scenario.id,
    recipientIds: [recipientId],
    subject,
    body,
    expectedVersion: scenario.version,
  });
  assert(response.status === 201, `Envío creado: ${subject}`);
  return response.body.id;
}

async function createBossApproval(
  boss: typeof users.$inferSelect,
  admin: typeof users.$inferSelect,
  bossToken: string,
  adminToken: string,
  suffix = '',
): Promise<string> {
  const label = suffix ? ` (${suffix})` : '';
  const bossMemo = await createMemo(
    bossToken,
    `Aviso de aprobación para el jefe${label}`,
    'Simulación para ver el aviso de aprobación en la bandeja del jefe.',
    [
      `Para: ${boss.name}`,
      `De: ${boss.name}`,
      'Este memo quedó pendiente y lo aprobó otro administrador para mostrar el aviso «Nuevo» y el toast.',
    ],
  );
  const [bossMessage] = await db
    .insert(documentMessages)
    .values({
      documentId: bossMemo.id,
      senderId: boss.id,
      subject: `[DEMO] Memo del jefe aprobado por otro administrador${label}`,
      body: 'Solicitud simulada para comprobar el aviso de aprobación del remitente.',
      status: 'pending_approval',
      documentVersion: bossMemo.version,
    })
    .returning();
  if (!bossMessage) throw new Error('No se pudo crear la solicitud del jefe');

  await db
    .insert(documentMessageRecipients)
    .values({ messageId: bossMessage.id, userId: admin.id });
  await db
    .update(documents)
    .set({ status: 'in_review' })
    .where(eq(documents.id, bossMemo.id));
  await db
    .insert(documentShares)
    .values({ documentId: bossMemo.id, userId: admin.id, permission: 'editor' })
    .onConflictDoNothing();

  const bossApprove = await call(`/inbox/${bossMessage.id}/approve`, adminToken, 'POST', {
    expectedVersion: bossMemo.version,
    recipientIds: [admin.id],
  });
  assert(bossApprove.status === 200, 'Otro administrador aprueba el memo del jefe');

  return bossMessage.id;
}

async function main(): Promise<void> {
  const [boss] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, BOSS_EMAIL), eq(users.isActive, true)))
    .limit(1);
  const [admin] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, ADMIN_EMAIL), eq(users.isActive, true)))
    .limit(1);

  if (!boss) throw new Error(`No existe el jefe ${BOSS_EMAIL}`);
  if (!admin) throw new Error(`No existe el administrador ${ADMIN_EMAIL}`);

  const bossToken = await tokenFor(boss);
  const adminToken = await tokenFor(admin);

  // Modo rápido para ver el aviso en vivo: solo crea una aprobación nueva
  // del jefe sin tocar el resto de la demostración.
  if (process.argv.includes('--notify')) {
    const suffix = new Date().toISOString().slice(11, 19);
    const id = await createBossApproval(boss, admin, bossToken, adminToken, suffix);
    console.log(`\n✔ Aviso de aprobación creado (${id}).`);
    console.log(
      'Con la bandeja abierta, el badge y el chip «Nuevo» aparecerán en el próximo sondeo (≤60 s).',
    );
    return;
  }

  let [member] = await db
    .select()
    .from(users)
    .where(eq(users.email, MEMBER_EMAIL))
    .limit(1);

  if (!member) {
    const [created] = await db
      .insert(users)
      .values({
        email: MEMBER_EMAIL,
        name: 'Asistente de Prueba',
        role: 'member',
        isActive: true,
      })
      .returning();
    member = created;
    console.log('• Usuario asistente creado: asistente@sirpefoffice.local');
  }

  if (!member) throw new Error('No se pudo preparar el asistente');

  await cleanPreviousDemo();

  const memberToken = await tokenFor(member);

  /* 1. Envío directo del administrador (sin leer en Recibidos del jefe). */
  const direct = await createMemo(
    adminToken,
    'Envío directo',
    'Memo enviado directamente por un administrador.',
    [
      `Para: ${boss.name}`,
      `De: ${admin.name}`,
      'Este memo ya está aprobado y enviado. Aparece en Recibidos con el chip verde.',
    ],
  );
  const directId = await submit(
    adminToken,
    direct,
    boss.id,
    '[DEMO] Envío directo — sin leer',
    'Memo directo para revisar la pestaña Recibidos.',
  );
  assert(
    (await call<{ status: string }>(`/inbox/${directId}`, bossToken)).body.status === 'sent',
    'El envío directo está aprobado y enviado',
  );

  /* 2. Solicitud pendiente del asistente. */
  const pending = await createMemo(
    memberToken,
    'Solicitud pendiente',
    'Memo del asistente esperando la aprobación del jefe.',
    [
      `Para: ${boss.name}`,
      'De: Asistente de Prueba',
      'Este memo sigue pendiente. El jefe lo ve en Recibidos → Pendientes y puede aprobarlo o rechazarlo.',
    ],
  );
  const pendingId = await submit(
    memberToken,
    pending,
    boss.id,
    '[DEMO] Solicitud pendiente de aprobación',
    'Jefe, este memo espera tu revisión.',
  );
  assert(
    (await call<{ status: string }>(`/inbox/${pendingId}`, bossToken)).body.status ===
      'pending_approval',
    'La solicitud sigue pendiente de aprobación',
  );

  /* 3. Memo aprobado: deja aviso «Nuevo» al asistente. */
  const approved = await createMemo(
    memberToken,
    'Memo aprobado',
    'Memo aprobado por el jefe para probar el aviso al asistente.',
    [
      `Para: ${boss.name}`,
      'De: Asistente de Prueba',
      'Este memo fue aprobado por el jefe. El asistente debe verlo como «Nuevo» en Enviados con el estado Aprobados.',
    ],
  );
  const approvedId = await submit(
    memberToken,
    approved,
    boss.id,
    '[DEMO] Memo aprobado por el jefe',
    'Jefe, preparé este memo para tu aprobación.',
  );
  const approve = await call(`/inbox/${approvedId}/approve`, bossToken, 'POST', {
    expectedVersion: approved.version,
  });
  assert(approve.status === 200, 'El jefe aprueba el memo');
  assert(
    (await call<{ status: string }>(`/inbox/${approvedId}`, memberToken)).body.status === 'sent',
    'El asistente ve el memo como aprobado y enviado',
  );

  /* 4. Memo rechazado: deja aviso «Nuevo» al asistente. */
  const rejected = await createMemo(
    memberToken,
    'Memo rechazado',
    'Memo rechazado por el jefe para probar el aviso al asistente.',
    [
      `Para: ${boss.name}`,
      'De: Asistente de Prueba',
      'Este memo fue rechazado. El asistente debe verlo como «Nuevo» en Enviados con el estado Rechazados.',
    ],
  );
  const rejectedId = await submit(
    memberToken,
    rejected,
    boss.id,
    '[DEMO] Memo rechazado por el jefe',
    'Jefe, preparé este memo para tu revisión.',
  );
  const reject = await call(`/inbox/${rejectedId}/reject`, bossToken, 'POST', {
    reason: 'Falta el número de memorándum y la firma.',
  });
  assert(reject.status === 200, 'El jefe rechaza el memo');

  /* 5. Envío cancelado por el asistente. */
  const cancelled = await createMemo(
    memberToken,
    'Envío cancelado',
    'Solicitud cancelada por el asistente antes de la aprobación.',
    [
      `Para: ${boss.name}`,
      'De: Asistente de Prueba',
      'Esta solicitud fue cancelada. Aparece en Enviados con el chip gris.',
    ],
  );
  const cancelledId = await submit(
    memberToken,
    cancelled,
    boss.id,
    '[DEMO] Envío cancelado por el asistente',
    'Solicitud que se cancela antes de aprobar.',
  );
  const cancel = await call(`/inbox/${cancelledId}/cancel`, memberToken, 'POST');
  assert(cancel.status === 200, 'El asistente cancela su solicitud');

  /* 6. Aviso visible para el jefe: otro admin aprueba un memo suyo. */
  const bossMessageId = await createBossApproval(boss, admin, bossToken, adminToken);

  /* ── Comprobaciones de la bandeja y de los avisos ── */

  const bossCounts = await call<{ count: number; pending: number }>(
    '/inbox/unread-count',
    bossToken,
  );
  assert(bossCounts.body.count >= 2, 'El jefe tiene mensajes sin leer en Recibidos');
  assert(bossCounts.body.pending >= 1, 'El jefe tiene al menos una solicitud pendiente');

  const bossPending = await call<{ items: { id: string }[] }>(
    '/inbox?scope=received&filter=pending',
    bossToken,
  );
  assert(
    bossPending.body.items.some((item) => item.id === pendingId),
    'La solicitud pendiente aparece en Recibidos → Pendientes',
  );

  const bossReceived = await call<{ items: { id: string }[] }>(
    '/inbox?scope=received&filter=sent',
    bossToken,
  );
  assert(
    bossReceived.body.items.some((item) => item.id === directId) &&
      bossReceived.body.items.some((item) => item.id === approvedId),
    'Los memos enviados aparecen en Recibidos → Ya enviados',
  );

  const bossResultCounts = await call<{
    results: number;
    latestResult: { status: string } | null;
  }>('/inbox/unread-count', bossToken);
  assert(
    bossResultCounts.body.results === 1,
    'El jefe ve un aviso de aprobación en su propia bandeja',
  );
  assert(
    bossResultCounts.body.latestResult?.status === 'sent',
    'El aviso del jefe corresponde a una aprobación',
  );

  const bossApprovedTab = await call<{ items: { id: string; unread: boolean }[] }>(
    '/inbox?scope=sent&status=sent',
    bossToken,
  );
  assert(
    bossApprovedTab.body.items.some((item) => item.id === bossMessageId && item.unread),
    'El memo del jefe aparece como «Nuevo» en Enviados → Aprobados',
  );
  assert(
    bossApprovedTab.body.items.some((item) => item.id === approvedId),
    'El jefe ve en Enviados el memo del asistente que aprobó',
  );

  const bossRejectedTab = await call<{ items: { id: string }[] }>(
    '/inbox?scope=sent&status=rejected',
    bossToken,
  );
  assert(
    bossRejectedTab.body.items.some((item) => item.id === rejectedId),
    'El jefe ve en Enviados el memo del asistente que rechazó',
  );

  const memberCounts = await call<{
    count: number;
    results: number;
    latestResult: { status: string; subject: string } | null;
  }>('/inbox/unread-count', memberToken);
  assert(memberCounts.body.results === 2, 'El asistente tiene 2 resultados sin ver');
  assert(
    memberCounts.body.latestResult?.status === 'rejected',
    'El último resultado notificado es el rechazo',
  );

  const memberApproved = await call<{ items: { id: string; unread: boolean }[] }>(
    '/inbox?scope=sent&status=sent',
    memberToken,
  );
  assert(
    memberApproved.body.items.some((item) => item.id === approvedId && item.unread),
    'El memo aprobado aparece como «Nuevo» en Enviados → Aprobados',
  );

  const memberRejected = await call<{ items: { id: string; unread: boolean }[] }>(
    '/inbox?scope=sent&status=rejected',
    memberToken,
  );
  assert(
    memberRejected.body.items.some((item) => item.id === rejectedId && item.unread),
    'El memo rechazado aparece como «Nuevo» en Enviados → Rechazados',
  );

  const memberSent = await call<{ items: { id: string; status: string }[] }>(
    '/inbox?scope=sent',
    memberToken,
  );
  for (const [id, status, label] of [
    [pendingId, 'pending_approval', 'pendiente'],
    [approvedId, 'sent', 'aprobado'],
    [rejectedId, 'rejected', 'rechazado'],
    [cancelledId, 'cancelled', 'cancelado'],
  ] as const) {
    assert(
      memberSent.body.items.some((item) => item.id === id && item.status === status),
      `El asistente ve su envío ${label} en Enviados`,
    );
  }

  console.log('\n──────────── Resumen de la demostración ────────────');
  console.log(`Jefe (${BOSS_EMAIL}):`);
  console.log('  Recibidos:                 2 memos enviados + 1 solicitud pendiente');
  console.log('  Enviados:                  3 documentos (1 propio + 2 decisiones)');
  console.log('  Enviados → Aprobados:      2 memos');
  console.log('  Enviados → Rechazados:     1 memo');
  console.log('  Badge:                     2 no leídos + 1 pendiente + 1 resultado');
  console.log(`Asistente (${MEMBER_EMAIL}):`);
  console.log('  Enviados → Todos:          1 pendiente, 1 aprobado, 1 rechazado, 1 cancelado');
  console.log('  Enviados → Aprobados:      1 con chip «Nuevo»');
  console.log('  Enviados → Rechazados:     1 con chip «Nuevo»');
  console.log('  Badge:                     2 resultados sin ver');
  console.log('────────────────────────────────────────────────────');
}

main()
  .then(async () => {
    await sql.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await sql.end().catch(() => undefined);
    process.exit(1);
  });
