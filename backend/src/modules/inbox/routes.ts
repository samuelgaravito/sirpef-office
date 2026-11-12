import { and, desc, eq, ilike, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { InboxMessageSummary, VariableDef } from '@sirpefoffice/shared';

import { db } from '../../db/index.js';
import {
  designs,
  documentMessageRecipients,
  documentMessages,
  documentShares,
  documents,
  templates,
  users,
} from '../../db/schema.js';
import {
  assertDocument,
  assertDocumentMutable,
  canExportDocument,
  getDocumentAccess,
} from '../../lib/access.js';
import { logActivity } from '../../lib/activity.js';
import { authenticate, requireAdmin } from '../../lib/auth-guard.js';
import { numberDocumentInTx, previewDocumentNumber } from '../../lib/counter.js';
import { badRequest, conflict, forbidden, internal, notFound } from '../../lib/errors.js';
import { saveVersion, toSummary } from '../documents/routes.js';
import { publishInboxEvent } from '../realtime/events.js';

/* ───────────────────────────── Esquemas ───────────────────────────── */

const listQuery = z.object({
  scope: z.enum(['received', 'sent', 'approved', 'rejected']).default('received'),
  /** Filtro interno de Recibidos (compatibilidad). */
  filter: z.enum(['all', 'pending', 'sent']).default('all'),
  /** Filtro por estado dentro de Enviados. */
  status: z
    .enum(['all', 'pending_approval', 'sent', 'rejected', 'cancelled'])
    .default('all'),
  q: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const createSchema = z.object({
  documentId: z.uuid(),
  recipientIds: z.array(z.uuid()).min(1).max(50),
  subject: z.string().trim().min(1).max(240),
  body: z.string().max(5000).default(''),
  expectedVersion: z.number().int().positive(),
});

const approveSchema = z.object({
  expectedVersion: z.number().int().positive(),
  subject: z.string().trim().min(1).max(240).optional(),
  body: z.string().max(5000).optional(),
  recipientIds: z.array(z.uuid()).min(1).max(50).optional(),
  /** Si el asistente podrá exportar el memo una vez sellado. */
  allowSenderExport: z.boolean().default(false),
});

const rejectSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
  /** Si el asistente puede corregir y reenviar el memo (por defecto, sí). */
  allowEdit: z.boolean().default(true),
});

const patchSchema = z
  .object({
    read: z.boolean().optional(),
    /** El remitente marca como visto el resultado (aprobado/rechazado). */
    resultRead: z.boolean().optional(),
  })
  .refine((value) => (value.read === undefined) !== (value.resultRead === undefined), {
    message: 'Indica si quieres marcar el mensaje o el resultado como leído',
  });

/* ─────────────────────────── Consultas base ────────────────────────── */

const recipientCount = sql<number>`(
  select count(*)::int from ${documentMessageRecipients}
  where ${documentMessageRecipients.messageId} = ${documentMessages.id}
)`;

const messageColumns = () => ({
  message: documentMessages,
  documentTitle: documents.title,
  documentDocNumber: documents.docNumber,
  documentStatus: documents.status,
  senderName: users.name,
  senderAvatarUrl: users.avatarUrl,
  recipientCount,
  readAt: documentMessageRecipients.readAt,
  archivedAt: documentMessageRecipients.archivedAt,
  recipientMessageId: documentMessageRecipients.messageId,
});

const recipientJoin = (userId: string) =>
  and(
    eq(documentMessageRecipients.messageId, documentMessages.id),
    eq(documentMessageRecipients.userId, userId),
  );

type MessageListRow = {
  message: typeof documentMessages.$inferSelect;
  documentTitle: string;
  documentDocNumber: string | null;
  documentStatus: typeof documents.$inferSelect.status;
  senderName: string;
  senderAvatarUrl: string | null;
  recipientCount: number | null;
  readAt: Date | null;
  archivedAt: Date | null;
  recipientMessageId: string | null;
};

function serializeMessage(row: MessageListRow, unread: boolean): InboxMessageSummary {
  return {
    id: row.message.id,
    documentId: row.message.documentId,
    documentTitle: row.documentTitle,
    documentDocNumber: row.documentDocNumber,
    documentStatus: row.documentStatus,
    documentVersion: row.message.documentVersion,
    senderId: row.message.senderId,
    senderName: row.senderName,
    senderAvatarUrl: row.senderAvatarUrl,
    subject: row.message.subject,
    body: row.message.body,
    status: row.message.status,
    recipientCount: Number(row.recipientCount ?? 0),
    unread,
    createdAt: row.message.createdAt.toISOString(),
    sentAt: row.message.sentAt?.toISOString() ?? null,
    approvedAt: row.message.approvedAt?.toISOString() ?? null,
  };
}

/** Valida destinatarios activos, sin duplicados y, opcionalmente, sin el remitente. */
async function validateRecipients(ids: string[], excludeUserId: string | null): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) throw badRequest('Selecciona al menos un destinatario');
  if (excludeUserId && unique.includes(excludeUserId)) {
    throw badRequest('No puedes enviarte el documento a ti mismo');
  }

  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, unique), eq(users.isActive, true)));

  if (rows.length !== unique.length) {
    throw badRequest('Uno o más destinatarios no existen o están inactivos');
  }
  return unique;
}

async function activeAdminIds(): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.isActive, true)));
  return rows.map((row) => row.id);
}

/* ─────────────────────────────── Rutas ─────────────────────────────── */

export async function inboxRoutes(app: FastifyInstance): Promise<void> {
  /** Contador de mensajes sin leer, pendientes de aprobación y resultados sin ver. */
  app.get('/unread-count', async (request) => {
    const user = await authenticate(request);

    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(documentMessageRecipients)
      .innerJoin(
        documentMessages,
        eq(documentMessages.id, documentMessageRecipients.messageId),
      )
      .where(
        and(
          eq(documentMessageRecipients.userId, user.sub),
          isNull(documentMessageRecipients.readAt),
          eq(documentMessages.status, 'sent'),
        ),
      );

    let pending = 0;
    if (user.role === 'admin') {
      const [pendingRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(documentMessages)
        .where(eq(documentMessages.status, 'pending_approval'));
      pending = Number(pendingRow?.count ?? 0);
    }

    // Resultados (aprobado/rechazado) que el remitente aún no ha visto. Se
    // excluyen los envíos directos que el propio remitente aprobó.
    const resultConditions = and(
      eq(documentMessages.senderId, user.sub),
      inArray(documentMessages.status, ['sent', 'rejected']),
      isNull(documentMessages.senderReadAt),
      ne(documentMessages.approvedById, user.sub),
    );

    const [resultRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(documentMessages)
      .where(resultConditions);

    const resultGroups = await db
      .select({
        status: documentMessages.status,
        count: sql<number>`count(*)::int`,
      })
      .from(documentMessages)
      .where(resultConditions)
      .groupBy(documentMessages.status);

    const approvedCount = Number(
      resultGroups.find((group) => group.status === 'sent')?.count ?? 0,
    );
    const rejectedCount = Number(
      resultGroups.find((group) => group.status === 'rejected')?.count ?? 0,
    );
    const receivedCount = Number(row?.count ?? 0) + pending;

    const [latest] = await db
      .select({
        status: documentMessages.status,
        subject: documentMessages.subject,
        approverName: users.name,
      })
      .from(documentMessages)
      .innerJoin(users, eq(users.id, documentMessages.approvedById))
      .where(resultConditions)
      .orderBy(desc(documentMessages.approvedAt))
      .limit(1);

    return {
      count: Number(row?.count ?? 0),
      pending,
      results: Number(resultRow?.count ?? 0),
      latestResult: latest ?? null,
      sections: {
        received: receivedCount,
        sent: approvedCount + rejectedCount,
        approved: approvedCount,
        rejected: rejectedCount,
      },
    };
  });

  /** Listado de la bandeja según el ámbito solicitado. */
  app.get('/', async (request) => {
    const user = await authenticate(request);
    const query = listQuery.parse(request.query);

    if (query.scope === 'received' && user.role !== 'admin' && query.filter === 'pending') {
      throw forbidden('Solo los administradores pueden ver los envíos pendientes');
    }

    const isRecipient = sql`exists (
      select 1 from ${documentMessageRecipients}
      where ${documentMessageRecipients.messageId} = ${documentMessages.id}
        and ${documentMessageRecipients.userId} = ${user.sub}
    )`;

    let where;
    if (query.scope === 'received') {
      if (query.filter === 'sent') {
        where = and(eq(documentMessages.status, 'sent'), isRecipient);
      } else if (query.filter === 'pending') {
        where = eq(documentMessages.status, 'pending_approval');
      } else {
        const receivedConditions = [and(eq(documentMessages.status, 'sent'), isRecipient)];
        if (user.role === 'admin') {
          receivedConditions.push(eq(documentMessages.status, 'pending_approval'));
        }
        where = or(...receivedConditions);
      }
    } else if (query.scope === 'sent') {
      // "Enviados" reúne lo que envié y los memos que aprobé o rechacé,
      // para que el jefe conserve el seguimiento de sus decisiones.
      const sentOrDecided = or(
        eq(documentMessages.senderId, user.sub),
        and(
          eq(documentMessages.approvedById, user.sub),
          inArray(documentMessages.status, ['sent', 'rejected']),
        ),
      );
      where =
        query.status === 'all'
          ? sentOrDecided
          : and(sentOrDecided, eq(documentMessages.status, query.status));
    } else if (query.scope === 'approved') {
      where = and(
        eq(documentMessages.status, 'sent'),
        or(
          eq(documentMessages.senderId, user.sub),
          eq(documentMessages.approvedById, user.sub),
        ),
      );
    } else {
      where = and(
        eq(documentMessages.status, 'rejected'),
        or(
          eq(documentMessages.senderId, user.sub),
          eq(documentMessages.approvedById, user.sub),
        ),
      );
    }

    if (query.q) {
      const pattern = `%${query.q}%`;
      where = and(
        where,
        or(
          ilike(documentMessages.subject, pattern),
          ilike(documentMessages.body, pattern),
          ilike(documents.title, pattern),
          ilike(documents.docNumber, pattern),
        ),
      );
    }

    const rows = await db
      .select(messageColumns())
      .from(documentMessages)
      .innerJoin(documents, eq(documents.id, documentMessages.documentId))
      .innerJoin(users, eq(users.id, documentMessages.senderId))
      .leftJoin(documentMessageRecipients, recipientJoin(user.sub))
      .where(where)
      .orderBy(
        sql`case when ${documentMessages.status} = 'pending_approval' then 0 else 1 end`,
        desc(documentMessages.createdAt),
      )
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(documentMessages)
      .innerJoin(documents, eq(documents.id, documentMessages.documentId))
      .innerJoin(users, eq(users.id, documentMessages.senderId))
      .where(where);

    const items = rows.map((row) => {
      const message = row.message;
      const isResultUnread =
        message.senderId === user.sub &&
        (message.status === 'sent' || message.status === 'rejected') &&
        message.approvedById !== user.sub &&
        message.senderReadAt === null;

      const unread =
        query.scope === 'received'
          ? Boolean(row.readAt === null && row.recipientMessageId)
          : isResultUnread;

      return serializeMessage(row as MessageListRow, unread);
    });

    return {
      items,
      total: Number(countRow?.count ?? 0),
      page: query.page,
      pageSize: query.pageSize,
    };
  });

  /** Detalle del mensaje, sus destinatarios y el documento adjunto. */
  app.get('/:id', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);

    const [row] = await db
      .select(messageColumns())
      .from(documentMessages)
      .innerJoin(documents, eq(documents.id, documentMessages.documentId))
      .innerJoin(users, eq(users.id, documentMessages.senderId))
      .leftJoin(documentMessageRecipients, recipientJoin(user.sub))
      .where(eq(documentMessages.id, id))
      .limit(1);

    if (!row) throw notFound('Mensaje no encontrado');

    const message = row.message;
    const isSender = message.senderId === user.sub;
    const isRecipient = Boolean(row.recipientMessageId);
    const canApprove = user.role === 'admin' && message.status === 'pending_approval';

    if (!isSender && !isRecipient && !canApprove) {
      throw notFound('Mensaje no encontrado');
    }

    const recipients = await db
      .select({
        userId: documentMessageRecipients.userId,
        name: users.name,
        email: users.email,
        readAt: documentMessageRecipients.readAt,
        archivedAt: documentMessageRecipients.archivedAt,
      })
      .from(documentMessageRecipients)
      .innerJoin(users, eq(users.id, documentMessageRecipients.userId))
      .where(eq(documentMessageRecipients.messageId, id))
      .orderBy(users.name);

    const [docRow] = await db
      .select({
        doc: documents,
        ownerName: users.name,
        designTokens: designs.tokens,
        designUpdatedAt: designs.updatedAt,
        templateSchema: templates.schema,
        templateNumberingEnabled: templates.numberingEnabled,
        templateId: templates.id,
      })
      .from(documents)
      .innerJoin(users, eq(users.id, documents.ownerId))
      .leftJoin(designs, and(eq(designs.id, documents.designId), isNull(designs.deletedAt)))
      .leftJoin(
        templates,
        and(eq(templates.id, documents.templateId), isNull(templates.deletedAt)),
      )
      .where(eq(documents.id, message.documentId))
      .limit(1);

    if (!docRow) throw notFound('Documento no encontrado');

    // El jefe puede abrir una solicitud pendiente aunque aún no tuviera el
    // documento compartido; se le concede acceso de editor para revisarlo.
    let permission: 'owner' | 'editor' | 'viewer';
    try {
      permission = (await getDocumentAccess(user.sub, message.documentId)).permission;
    } catch (error) {
      if (!canApprove) throw error;
      await db
        .insert(documentShares)
        .values({
          documentId: message.documentId,
          userId: user.sub,
          permission: 'editor',
        })
        .onConflictDoNothing();
      permission = 'editor';
    }

    let approvedByName: string | null = null;
    if (message.approvedById) {
      const [approver] = await db
        .select({ name: users.name })
        .from(users)
        .where(eq(users.id, message.approvedById))
        .limit(1);
      approvedByName = approver?.name ?? null;
    }

    const [pending] = await db
      .select({
        id: documentMessages.id,
        status: documentMessages.status,
        subject: documentMessages.subject,
        senderName: users.name,
      })
      .from(documentMessages)
      .innerJoin(users, eq(users.id, documentMessages.senderId))
      .where(
        and(
          eq(documentMessages.documentId, message.documentId),
          eq(documentMessages.status, 'pending_approval'),
        ),
      )
      .limit(1);

    const isResultUnread =
      isSender &&
      (message.status === 'sent' || message.status === 'rejected') &&
      message.approvedById !== user.sub &&
      message.senderReadAt === null;

    // Número previsto para el revisor: no reserva el correlativo.
    const numberingPreview = docRow.doc.docNumber
      ? null
      : await previewDocumentNumber({
          docType: docRow.doc.docType,
          template:
            docRow.doc.templateId && docRow.templateNumberingEnabled !== null
              ? {
                  templateId: docRow.templateId,
                  numberingEnabled: docRow.templateNumberingEnabled,
                }
              : null,
        });

    return {
      ...serializeMessage(
        row as MessageListRow,
        Boolean((isRecipient && row.readAt === null) || isResultUnread),
      ),
      recipients: recipients.map((recipient) => ({
        ...recipient,
        readAt: recipient.readAt?.toISOString() ?? null,
        archivedAt: recipient.archivedAt?.toISOString() ?? null,
      })),
      approvedByName,
      rejectedReason: message.rejectedReason,
      allowSenderEdit: message.allowSenderEdit,
      allowSenderExport: message.allowSenderExport,
      canExport: await canExportDocument(user.sub, user.role, docRow.doc),
      canApprove,
      isRecipient,
      isSender,
      readAt: row.readAt?.toISOString() ?? null,
      senderReadAt: message.senderReadAt?.toISOString() ?? null,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      document: toSummary(
        docRow.doc,
        docRow.ownerName,
        permission,
        docRow.designTokens ?? null,
        docRow.designUpdatedAt ?? null,
        (docRow.templateSchema ?? []) as VariableDef[],
        numberingPreview,
      ),
      pendingMessage: pending ?? null,
    };
  });

  /**
   * Crea un envío. Un miembro lo deja pendiente de aprobación; un
   * administrador lo envía directamente.
   */
  app.post('/', async (request, reply) => {
    const user = await authenticate(request);
    const body = createSchema.parse(request.body);
    const recipientIds = await validateRecipients(body.recipientIds, user.sub);

    const { document } = await assertDocument(user.sub, body.documentId, 'editor');
    assertDocumentMutable(document);

    if (document.version !== body.expectedVersion) {
      throw conflict('El documento cambió desde que abriste el envío', {
        currentVersion: document.version,
      });
    }

    const [pending] = await db
      .select({ id: documentMessages.id })
      .from(documentMessages)
      .where(
        and(
          eq(documentMessages.documentId, document.id),
          eq(documentMessages.status, 'pending_approval'),
        ),
      )
      .limit(1);

    if (pending) {
      throw conflict('Ya existe una solicitud de aprobación pendiente para este documento');
    }

    const now = new Date();
    let messageId = '';
    let assignedDocNumber: string | null = null;
    const direct = user.role === 'admin';
    let adminIds: string[] = [];

    await db.transaction(async (tx) => {
      const [message] = await tx
        .insert(documentMessages)
        .values({
          documentId: document.id,
          senderId: user.sub,
          subject: body.subject,
          body: body.body,
          status: direct ? 'sent' : 'pending_approval',
          documentVersion: document.version,
          approvedById: direct ? user.sub : null,
          approvedAt: direct ? now : null,
          sentAt: direct ? now : null,
        })
        .returning();

      if (!message) throw internal('MESSAGE_CREATE_FAILED', 'No se pudo crear el mensaje');

      messageId = message.id;

      await tx
        .insert(documentMessageRecipients)
        .values(recipientIds.map((userId) => ({ messageId: message.id, userId })));

      if (direct) {
        await tx
          .update(documents)
          .set({ status: 'sent', lockedAt: now, lockedBy: user.sub, updatedAt: now })
          .where(eq(documents.id, document.id));

        // El administrador envía directamente: el documento se oficializa y
        // recibe su correlativo en la misma transacción del sello.
        assignedDocNumber = await numberDocumentInTx(tx, document.id);

        await tx
          .insert(documentShares)
          .values(
            recipientIds.map((userId) => ({
              documentId: document.id,
              userId,
              permission: 'viewer' as const,
            })),
          )
          .onConflictDoNothing();
      } else {
        await tx
          .update(documents)
          .set({ status: 'in_review', updatedAt: now })
          .where(eq(documents.id, document.id));

        adminIds = await activeAdminIds();
        if (adminIds.length > 0) {
          await tx
            .insert(documentShares)
            .values(
              adminIds.map((userId) => ({
                documentId: document.id,
                userId,
                permission: 'editor' as const,
              })),
            )
            .onConflictDoNothing();
        }
      }
    });

    if (direct) {
      await saveVersion(document.id, user.sub, 'manual', 'Aprobado y enviado desde la bandeja');
      await logActivity(user.sub, 'document', document.id, 'sent', {
        messageId,
        recipientIds,
        direct: true,
      });
      await publishInboxEvent({
        type: 'inbox.message.created',
        userIds: recipientIds,
        messageId,
        documentId: document.id,
        documentTitle: document.title,
        subject: body.subject,
        actorName: user.name,
        status: 'sent',
      });
    } else {
      await logActivity(user.sub, 'document', document.id, 'submitted', {
        messageId,
        recipientIds,
      });
      // Guarda la versión exacta que se envió a revisión para poder compararla
      // con los cambios posteriores desde el editor.
      await saveVersion(document.id, user.sub, 'manual', 'Enviado a aprobación');
      // El aviso va a los administradores: son los que pueden aprobarlo.
      await publishInboxEvent({
        type: 'inbox.message.pending',
        userIds: adminIds,
        messageId,
        documentId: document.id,
        documentTitle: document.title,
        subject: body.subject,
        actorName: user.name,
        status: 'pending_approval',
      });
    }

    return reply.status(201).send({
      id: messageId,
      status: direct ? 'sent' : 'pending_approval',
      docNumber: assignedDocNumber,
    });
  });

  /** El jefe aprueba, sella el documento y lo envía a los destinatarios. */
  app.post('/:id/approve', async (request) => {
    const user = await requireAdmin(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = approveSchema.parse(request.body);

    const [message] = await db
      .select()
      .from(documentMessages)
      .where(eq(documentMessages.id, id))
      .limit(1);

    if (!message) throw notFound('Mensaje no encontrado');
    if (message.status !== 'pending_approval') {
      throw conflict('Este envío ya fue procesado');
    }

    const [document] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, message.documentId))
      .limit(1);

    if (!document || document.deletedAt) throw notFound('Documento no encontrado');
    assertDocumentMutable(document);

    if (document.version !== body.expectedVersion) {
      throw conflict('El documento cambió desde que lo abriste', {
        currentVersion: document.version,
      });
    }

    const recipientIds = body.recipientIds
      ? await validateRecipients(body.recipientIds, null)
      : null;

    const now = new Date();
    let assignedDocNumber: string | null = null;
    let currentRecipients: string[] = [];

    await db.transaction(async (tx) => {
      if (recipientIds) {
        await tx
          .delete(documentMessageRecipients)
          .where(eq(documentMessageRecipients.messageId, id));
        await tx
          .insert(documentMessageRecipients)
          .values(recipientIds.map((userId) => ({ messageId: id, userId })));
      }

      currentRecipients = recipientIds
        ? recipientIds
        : (
            await tx
              .select({ userId: documentMessageRecipients.userId })
              .from(documentMessageRecipients)
              .where(eq(documentMessageRecipients.messageId, id))
          ).map((row) => row.userId);

      if (currentRecipients.length === 0) {
        throw badRequest('El envío no tiene destinatarios');
      }

      await tx
        .update(documentMessages)
        .set({
          status: 'sent',
          subject: body.subject ?? message.subject,
          body: body.body ?? message.body,
          approvedById: user.sub,
          approvedAt: now,
          sentAt: now,
          allowSenderExport: body.allowSenderExport,
          documentVersion: document.version,
          updatedAt: now,
        })
        .where(eq(documentMessages.id, id));

      await tx
        .update(documents)
        .set({ status: 'sent', lockedAt: now, lockedBy: user.sub, updatedAt: now })
        .where(eq(documents.id, document.id));

      // Aprobación: el memo se sella y recibe su número correlativo de forma
      // atómica con el cambio de estado. Si ya tenía número, es idempotente.
      assignedDocNumber = await numberDocumentInTx(tx, document.id);

      await tx
        .insert(documentShares)
        .values(
          currentRecipients.map((userId) => ({
            documentId: document.id,
            userId,
            permission: 'viewer' as const,
          })),
        )
        .onConflictDoNothing();
    });

    await saveVersion(document.id, user.sub, 'manual', 'Aprobado y enviado');
    await logActivity(user.sub, 'document', document.id, 'approved', {
      messageId: id,
      version: document.version,
    });
    await logActivity(user.sub, 'document', document.id, 'sent', { messageId: id });

    const subject = body.subject ?? message.subject;
    // Los destinatarios reciben el documento ya oficializado.
    await publishInboxEvent({
      type: 'inbox.message.approved',
      userIds: currentRecipients,
      messageId: id,
      documentId: document.id,
      documentTitle: document.title,
      subject,
      actorName: user.name,
      status: 'sent',
    });
    // El remitente recibe el resultado de su solicitud.
    await publishInboxEvent({
      type: 'inbox.result.approved',
      userIds: [message.senderId],
      messageId: id,
      documentId: document.id,
      documentTitle: document.title,
      subject,
      actorName: user.name,
      status: 'sent',
    });

    return { ok: true, id, status: 'sent', docNumber: assignedDocNumber };
  });

  /** Devuelve el documento al asistente con un motivo. */
  app.post('/:id/reject', async (request) => {
    const user = await requireAdmin(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = rejectSchema.parse(request.body);

    const [message] = await db
      .select()
      .from(documentMessages)
      .where(eq(documentMessages.id, id))
      .limit(1);

    if (!message) throw notFound('Mensaje no encontrado');
    if (message.status !== 'pending_approval') {
      throw conflict('Este envío ya fue procesado');
    }

    const [document] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, message.documentId))
      .limit(1);

    if (!document || document.deletedAt) throw notFound('Documento no encontrado');
    assertDocumentMutable(document);

    const now = new Date();
    const allowEdit = body.allowEdit;
    await db.transaction(async (tx) => {
      await tx
        .update(documentMessages)
        .set({
          status: 'rejected',
          rejectedReason: body.reason,
          allowSenderEdit: allowEdit,
          approvedById: user.sub,
          approvedAt: now,
          updatedAt: now,
        })
        .where(eq(documentMessages.id, id));

      await tx
        .update(documents)
        .set({
          status: allowEdit ? 'draft' : 'rejected',
          // Si no se permite corregir, el memo queda cerrado como solo lectura.
          lockedAt: allowEdit ? null : now,
          lockedBy: allowEdit ? null : user.sub,
          updatedAt: now,
        })
        .where(eq(documents.id, document.id));
    });

    await logActivity(user.sub, 'document', document.id, 'rejected', {
      messageId: id,
      reason: body.reason,
      allowEdit,
    });

    // Solo el remitente se entera del rechazo.
    await publishInboxEvent({
      type: 'inbox.result.rejected',
      userIds: [message.senderId],
      messageId: id,
      documentId: document.id,
      documentTitle: document.title,
      subject: message.subject,
      actorName: user.name,
      status: 'rejected',
    });

    return { ok: true, id, status: 'rejected', allowEdit };
  });

  /** El remitente (o un admin) cancela una solicitud pendiente. */
  app.post('/:id/cancel', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);

    const [message] = await db
      .select()
      .from(documentMessages)
      .where(eq(documentMessages.id, id))
      .limit(1);

    if (!message) throw notFound('Mensaje no encontrado');
    if (message.senderId !== user.sub && user.role !== 'admin') {
      throw forbidden('Solo el remitente o un administrador pueden cancelar el envío');
    }
    if (message.status !== 'pending_approval') {
      throw conflict('Solo se puede cancelar un envío pendiente');
    }

    const { document } = await assertDocument(user.sub, message.documentId, 'viewer');
    assertDocumentMutable(document);

    const now = new Date();
    await db.transaction(async (tx) => {
      await tx
        .update(documentMessages)
        .set({ status: 'cancelled', updatedAt: now })
        .where(eq(documentMessages.id, id));

      await tx
        .update(documents)
        .set({ status: 'draft', updatedAt: now })
        .where(eq(documents.id, document.id));
    });

    await logActivity(user.sub, 'document', document.id, 'cancelled', { messageId: id });

    // El remitente y los administradores se enteran de la cancelación.
    await publishInboxEvent({
      type: 'inbox.message.cancelled',
      userIds: [message.senderId, ...(await activeAdminIds())],
      messageId: id,
      documentId: document.id,
      documentTitle: document.title,
      subject: message.subject,
      actorName: user.name,
      status: 'cancelled',
    });

    return { ok: true, id, status: 'cancelled' };
  });

  /** Marca como leído el mensaje (destinatario) o su resultado (remitente). */
  app.patch('/:id', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = patchSchema.parse(request.body);

    const [message] = await db
      .select({
        id: documentMessages.id,
        status: documentMessages.status,
        senderId: documentMessages.senderId,
      })
      .from(documentMessages)
      .where(eq(documentMessages.id, id))
      .limit(1);

    if (!message) throw notFound('Mensaje no encontrado');

    // El remitente marca como visto el resultado de su solicitud.
    if (body.resultRead !== undefined) {
      if (message.senderId !== user.sub) {
        throw forbidden('Solo el remitente puede marcar el resultado como visto');
      }
      if (message.status !== 'sent' && message.status !== 'rejected') {
        throw badRequest('El resultado aún no está disponible');
      }

      await db
        .update(documentMessages)
        .set({ senderReadAt: body.resultRead ? new Date() : null })
        .where(eq(documentMessages.id, id));

      return { ok: true };
    }

    if (message.status !== 'sent') {
      throw badRequest('Solo los mensajes enviados se pueden marcar como leídos');
    }

    const [recipient] = await db
      .select({ userId: documentMessageRecipients.userId })
      .from(documentMessageRecipients)
      .where(
        and(
          eq(documentMessageRecipients.messageId, id),
          eq(documentMessageRecipients.userId, user.sub),
        ),
      )
      .limit(1);

    if (!recipient) throw forbidden('Solo los destinatarios pueden modificar este mensaje');

    await db
      .update(documentMessageRecipients)
      .set({ readAt: body.read ? new Date() : null })
      .where(
        and(
          eq(documentMessageRecipients.messageId, id),
          eq(documentMessageRecipients.userId, user.sub),
        ),
      );

    return { ok: true };
  });
}
