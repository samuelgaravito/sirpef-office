import { and, eq, inArray } from 'drizzle-orm';

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

async function main(): Promise<void> {
  const [admin] = await db
    .select()
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.isActive, true)))
    .limit(1);

  // Se usa siempre un miembro temporal para que los contadores de la bandeja
  // no se contaminen con datos de demostración de ejecuciones anteriores.
  const [member] = await db
    .insert(users)
    .values({
      email: `smoke-member-${Date.now()}@example.com`,
      name: 'Asistente de prueba',
      role: 'member',
      isActive: true,
    })
    .returning();

  const temporaryMemberId: string | null = member?.id ?? null;

  if (!admin || !member) throw new Error('Se necesitan un admin y un member activos');

  const adminToken = await signAccessToken({
    sub: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });
  const memberToken = await signAccessToken({
    sub: member.id,
    email: member.email,
    name: member.name,
    role: member.role,
  });

  const createdIds: string[] = [];

  try {
    const created = await call<{ document: { id: string; version: number } }>(
      '/documents',
      memberToken,
      'POST',
      {},
    );
    assert(created.status === 201, 'El asistente crea un borrador');
    const documentId = created.body.document.id;
    createdIds.push(documentId);
    const version = created.body.document.version;

    const submitted = await call<{ id: string; status: string }>('/inbox', memberToken, 'POST', {
      documentId,
      recipientIds: [admin.id],
      subject: 'Prueba de envío',
      body: 'Adjunto el memo para revisión.',
      expectedVersion: version,
    });
    assert(submitted.status === 201, 'El asistente solicita el envío');
    assert(submitted.body.status === 'pending_approval', 'El envío queda pendiente de aprobación');

    const detailAfterSubmit = await call<{
      document: { status: string; pendingMessage: { id: string } | null };
    }>(`/documents/${documentId}`, memberToken);
    assert(detailAfterSubmit.body.document.status === 'in_review', 'El documento pasa a in_review');
    assert(Boolean(detailAfterSubmit.body.document.pendingMessage), 'El editor conoce el envío pendiente');

    const deletePending = await call(`/documents/${documentId}`, memberToken, 'DELETE');
    assert(deletePending.status === 409, 'No se puede eliminar un memo con envío pendiente');

    const pending = await call<{ items: { id: string }[] }>(
      '/inbox?scope=received&filter=pending',
      adminToken,
    );
    assert(
      pending.body.items.some((item) => item.id === submitted.body.id),
      'El jefe ve el envío pendiente en Recibidos → Pendientes',
    );

    const memberSent = await call<{ items: { id: string }[] }>('/inbox?scope=sent', memberToken);
    assert(
      memberSent.body.items.some((item) => item.id === submitted.body.id),
      'El asistente ve su solicitud pendiente en Enviados',
    );

    const memberPendingFilter = await call<{ items: { id: string }[] }>(
      '/inbox?scope=sent&status=pending_approval',
      memberToken,
    );
    assert(
      memberPendingFilter.body.items.some((item) => item.id === submitted.body.id),
      'El filtro «Pendientes» de Enviados funciona',
    );

    const messageDetail = await call<{ canApprove: boolean; recipients: unknown[] }>(
      `/inbox/${submitted.body.id}`,
      adminToken,
    );
    assert(messageDetail.body.canApprove === true, 'El jefe puede aprobar el envío');

    const approved = await call<{ status: string }>(
      `/inbox/${submitted.body.id}/approve`,
      adminToken,
      'POST',
      { expectedVersion: version, recipientIds: [admin.id] },
    );
    assert(approved.status === 200 && approved.body.status === 'sent', 'El jefe aprueba y envía');

    const sentDetail = await call<{ document: { status: string; lockedAt: string | null } }>(
      `/documents/${documentId}`,
      adminToken,
    );
    assert(sentDetail.body.document.status === 'sent', 'El documento queda como enviado');
    assert(Boolean(sentDetail.body.document.lockedAt), 'El documento queda sellado');

    const memberExport = await call(`/documents/${documentId}/export/pdf`, memberToken);
    assert(memberExport.status === 403, 'El asistente no puede exportar un memo sellado');
    const adminExport = await call(`/documents/${documentId}/export/pdf`, adminToken);
    assert(adminExport.status === 200, 'El administrador sí puede exportar un memo sellado');
    const adminExportDocx = await call(`/documents/${documentId}/export/docx`, adminToken);
    assert(adminExportDocx.status === 200, 'El administrador elige el formato Word');
    const adminExportHtml = await call(`/documents/${documentId}/export/html`, adminToken);
    assert(adminExportHtml.status === 200, 'El administrador elige el formato HTML');

    const memberDetail = await call<{ canExport: boolean }>(
      `/documents/${documentId}`,
      memberToken,
    );
    assert(memberDetail.body.canExport === false, 'El asistente ve la exportación bloqueada');
    const adminDetail = await call<{ canExport: boolean }>(
      `/documents/${documentId}`,
      adminToken,
    );
    assert(adminDetail.body.canExport === true, 'El administrador ve la exportación habilitada');

    const adminApproved = await call<{ items: { id: string }[] }>('/inbox?scope=approved', adminToken);
    assert(
      adminApproved.body.items.some((item) => item.id === submitted.body.id),
      'El jefe ve el memo en Aprobados',
    );

    const adminSentApproved = await call<{ items: { id: string }[] }>(
      '/inbox?scope=sent&status=sent',
      adminToken,
    );
    assert(
      adminSentApproved.body.items.some((item) => item.id === submitted.body.id),
      'El jefe ve en Enviados el memo que aprobó',
    );

    const memberApproved = await call<{ items: { id: string; unread: boolean }[] }>(
      '/inbox?scope=sent&status=sent',
      memberToken,
    );
    const approvedRow = memberApproved.body.items.find(
      (item) => item.id === submitted.body.id,
    );
    assert(Boolean(approvedRow), 'El asistente ve su memo aprobado en Aprobados');
    assert(approvedRow?.unread === true, 'El memo aprobado aparece como nuevo para el asistente');

    const memberCounts = await call<{
      results: number;
      latestResult: { status: string } | null;
      sections: { received: number; sent: number; approved: number; rejected: number };
    }>('/inbox/unread-count', memberToken);
    assert(memberCounts.body.results === 1, 'El asistente tiene un resultado sin ver');
    assert(
      memberCounts.body.latestResult?.status === 'sent',
      'El último resultado notificado es una aprobación',
    );
    assert(
      memberCounts.body.sections.sent === 1,
      'La pestaña Enviados marca 1 novedad',
    );
    assert(
      memberCounts.body.sections.approved === 1,
      'El desglose de Aprobados marca 1 novedad',
    );
    assert(
      memberCounts.body.sections.rejected === 0,
      'La pestaña Rechazados no marca novedades',
    );

    const resultRead = await call(`/inbox/${submitted.body.id}`, memberToken, 'PATCH', {
      resultRead: true,
    });
    assert(resultRead.status === 200, 'El asistente marca el resultado como visto');

    const memberCountsAfter = await call<{ results: number }>(
      '/inbox/unread-count',
      memberToken,
    );
    assert(
      memberCountsAfter.body.results === 0,
      'El contador de resultados vuelve a cero tras abrirlo',
    );

    const receivedSent = await call<{ items: { id: string }[] }>(
      '/inbox?scope=received&filter=sent',
      adminToken,
    );
    assert(
      receivedSent.body.items.some((item) => item.id === submitted.body.id),
      'El memo enviado aparece en Recibidos → Enviados',
    );

    const edit = await call('/documents/' + documentId + '/content', adminToken, 'PUT', {
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      expectedVersion: version,
    });
    assert(edit.status === 409 && (edit.body as { error?: string }).error === 'DOCUMENT_LOCKED', 'La edición queda bloqueada');

    const remove = await call(`/documents/${documentId}`, memberToken, 'DELETE');
    assert(
      remove.status === 409 && (remove.body as { error?: string }).error === 'DOCUMENT_LOCKED',
      'El borrado queda bloqueado',
    );

    const received = await call<{ items: { id: string; unread: boolean }[] }>(
      '/inbox?scope=received',
      adminToken,
    );
    const receivedMessage = received.body.items.find((item) => item.id === submitted.body.id);
    assert(Boolean(receivedMessage), 'El destinatario lo recibe en «Recibidos»');
    assert(receivedMessage?.unread === true, 'El mensaje nuevo aparece como no leído');

    const adminSections = await call<{ sections: { received: number } }>(
      '/inbox/unread-count',
      adminToken,
    );
    assert(
      adminSections.body.sections.received >= 1,
      'La pestaña Recibidos marca novedades para el jefe',
    );

    const read = await call(`/inbox/${submitted.body.id}`, adminToken, 'PATCH', { read: true });
    assert(read.status === 200, 'El destinatario puede marcarlo como leído');

    // Aprobación que autoriza al asistente a exportar el memo sellado.
    const createdExport = await call<{ document: { id: string; version: number } }>(
      '/documents',
      memberToken,
      'POST',
      {},
    );
    const documentIdExport = createdExport.body.document.id;
    createdIds.push(documentIdExport);

    const submittedExport = await call<{ id: string }>('/inbox', memberToken, 'POST', {
      documentId: documentIdExport,
      recipientIds: [admin.id],
      subject: 'Prueba de exportación autorizada',
      body: '',
      expectedVersion: createdExport.body.document.version,
    });
    assert(submittedExport.status === 201, 'Se crea el envío para autorizar exportación');

    const approvedExport = await call(`/inbox/${submittedExport.body.id}/approve`, adminToken, 'POST', {
      expectedVersion: createdExport.body.document.version,
      recipientIds: [admin.id],
      allowSenderExport: true,
    });
    assert(approvedExport.status === 200, 'El jefe aprueba autorizando la exportación');

    const exportMessage = await call<{ allowSenderExport: boolean }>(
      `/inbox/${submittedExport.body.id}`,
      memberToken,
    );
    assert(
      exportMessage.body.allowSenderExport === true,
      'El mensaje conserva la autorización de exportación',
    );

    const memberExportAllowed = await call(
      `/documents/${documentIdExport}/export/pdf`,
      memberToken,
    );
    assert(memberExportAllowed.status === 200, 'El asistente autorizado puede exportar el memo');

    const memberDetailAllowed = await call<{ canExport: boolean }>(
      `/documents/${documentIdExport}`,
      memberToken,
    );
    assert(memberDetailAllowed.body.canExport === true, 'El editor habilita la exportación al asistente');

    const exportResultRead = await call(
      `/inbox/${submittedExport.body.id}`,
      memberToken,
      'PATCH',
      { resultRead: true },
    );
    assert(exportResultRead.status === 200, 'El asistente marca visto el resultado de la prueba');

    // Flujo de rechazo
    const created2 = await call<{ document: { id: string; version: number } }>(
      '/documents',
      memberToken,
      'POST',
      {},
    );
    const documentId2 = created2.body.document.id;
    createdIds.push(documentId2);

    const submitted2 = await call<{ id: string }>('/inbox', memberToken, 'POST', {
      documentId: documentId2,
      recipientIds: [admin.id],
      subject: 'Prueba de rechazo',
      body: '',
      expectedVersion: created2.body.document.version,
    });
    assert(submitted2.status === 201, 'Se crea un segundo envío');

    const rejected = await call(`/inbox/${submitted2.body.id}/reject`, adminToken, 'POST', {
      reason: 'Falta la firma del jefe.',
    });
    assert(rejected.status === 200, 'El jefe rechaza el envío');

    const rejectedDetail = await call<{ document: { status: string; lockedAt: string | null } }>(
      `/documents/${documentId2}`,
      memberToken,
    );
    assert(rejectedDetail.body.document.status === 'draft', 'El documento rechazado vuelve a borrador');
    assert(rejectedDetail.body.document.lockedAt === null, 'El documento rechazado sigue desbloqueado');

    const rejectedMessage = await call<{ allowSenderEdit: boolean }>(
      `/inbox/${submitted2.body.id}`,
      memberToken,
    );
    assert(
      rejectedMessage.body.allowSenderEdit === true,
      'El rechazo por defecto permite que el asistente edite',
    );

    const memberRejected = await call<{ items: { id: string; unread: boolean }[] }>(
      '/inbox?scope=sent&status=rejected',
      memberToken,
    );
    const rejectedRow = memberRejected.body.items.find(
      (item) => item.id === submitted2.body.id,
    );
    assert(Boolean(rejectedRow), 'El asistente ve el envío rechazado en Rechazados');
    assert(rejectedRow?.unread === true, 'El rechazo aparece como nuevo para el asistente');

    const rejectedCounts = await call<{
      results: number;
      latestResult: { status: string } | null;
      sections: { received: number; sent: number; approved: number; rejected: number };
    }>('/inbox/unread-count', memberToken);
    assert(rejectedCounts.body.results === 1, 'El asistente tiene el rechazo sin ver');
    assert(
      rejectedCounts.body.latestResult?.status === 'rejected',
      'El último resultado notificado es un rechazo',
    );
    assert(
      rejectedCounts.body.sections.sent === 1,
      'La pestaña Enviados vuelve a marcar 1 novedad',
    );
    assert(
      rejectedCounts.body.sections.rejected === 1,
      'El desglose de Rechazados marca 1 novedad',
    );

    const adminRejected = await call<{ items: { id: string }[] }>('/inbox?scope=rejected', adminToken);
    assert(
      adminRejected.body.items.some((item) => item.id === submitted2.body.id),
      'El jefe ve el envío que rechazó en Rechazados',
    );

    const adminSentRejected = await call<{ items: { id: string }[] }>(
      '/inbox?scope=sent&status=rejected',
      adminToken,
    );
    assert(
      adminSentRejected.body.items.some((item) => item.id === submitted2.body.id),
      'El jefe ve en Enviados el memo que rechazó',
    );

    const editRejected = await call(`/documents/${documentId2}/content`, memberToken, 'PUT', {
      content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Corregido' }] }] },
      expectedVersion: created2.body.document.version,
    });
    assert(editRejected.status === 200, 'El asistente puede corregir el memo rechazado');

    // Rechazo definitivo: el memo queda cerrado y no editable.
    const created3 = await call<{ document: { id: string; version: number } }>(
      '/documents',
      memberToken,
      'POST',
      {},
    );
    const documentId3 = created3.body.document.id;
    createdIds.push(documentId3);

    const submitted3 = await call<{ id: string }>('/inbox', memberToken, 'POST', {
      documentId: documentId3,
      recipientIds: [admin.id],
      subject: 'Prueba de rechazo definitivo',
      body: '',
      expectedVersion: created3.body.document.version,
    });
    assert(submitted3.status === 201, 'Se crea el envío para rechazo definitivo');

    const rejectedFinal = await call(`/inbox/${submitted3.body.id}/reject`, adminToken, 'POST', {
      reason: 'No corresponde al área.',
      allowEdit: false,
    });
    assert(rejectedFinal.status === 200, 'El jefe rechaza definitivamente el envío');

    const finalMessage = await call<{ allowSenderEdit: boolean }>(
      `/inbox/${submitted3.body.id}`,
      memberToken,
    );
    assert(
      finalMessage.body.allowSenderEdit === false,
      'El rechazo definitivo no permite editar',
    );

    const finalDoc = await call<{ document: { status: string; lockedAt: string | null } }>(
      `/documents/${documentId3}`,
      memberToken,
    );
    assert(finalDoc.body.document.status === 'rejected', 'El documento queda como rechazado');
    assert(Boolean(finalDoc.body.document.lockedAt), 'El documento rechazado queda sellado');

    const editFinal = await call(`/documents/${documentId3}/content`, memberToken, 'PUT', {
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
      expectedVersion: created3.body.document.version,
    });
    assert(editFinal.status === 409, 'El asistente no puede editar un memo rechazado y cerrado');

    const finalExport = await call(`/documents/${documentId3}/export/pdf`, memberToken);
    assert(
      finalExport.status === 403,
      'El asistente no puede exportar un memo rechazado y cerrado',
    );

    const finalAdminExport = await call(`/documents/${documentId3}/export/pdf`, adminToken);
    assert(
      finalAdminExport.status === 200,
      'El administrador que rechazó puede exportar el memo cerrado',
    );

    console.log('\n✔ Flujo de bandeja completo');
  } finally {
    if (createdIds.length > 0) {
      const messages = await db
        .select({ id: documentMessages.id })
        .from(documentMessages)
        .where(inArray(documentMessages.documentId, createdIds));
      if (messages.length > 0) {
        await db
          .delete(documentMessageRecipients)
          .where(inArray(documentMessageRecipients.messageId, messages.map((m) => m.id)));
        await db.delete(documentMessages).where(inArray(documentMessages.documentId, createdIds));
      }
      await db.delete(documentVersions).where(inArray(documentVersions.documentId, createdIds));
      await db.delete(documentShares).where(inArray(documentShares.documentId, createdIds));
      await db.delete(documents).where(inArray(documents.id, createdIds));
    }
    if (temporaryMemberId) {
      await db.delete(users).where(eq(users.id, temporaryMemberId));
    }
    await sql.end();
  }
}

main().catch(async (error) => {
  console.error(error);
  await sql.end().catch(() => undefined);
  process.exit(1);
});
