import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  buildAutoDescription,
  designTokensForList,
  DOCUMENT_STATUSES,
  resolveChrome,
} from '@sirpefoffice/shared';
import type {
  DesignTokens,
  DocumentRejection,
  NumberingPreview,
  VariableDef,
  VariableValues,
} from '@sirpefoffice/shared';

import { db } from '../../db/index.js';
import {
  designs,
  documentMessageRecipients,
  documentMessages,
  documentShares,
  documentVersions,
  documents,
  templateShares,
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
import { authenticate } from '../../lib/auth-guard.js';
import {
  numberDocumentInTx,
  numberingPreviewsFor,
  previewDocumentNumber,
  templateNumberingFrom,
} from '../../lib/counter.js';
import { badRequest, conflict, forbidden, internal, locked, notFound } from '../../lib/errors.js';
import { resolveTemplateDesign } from '../../lib/active-design.js';
import { sameJson } from '../../lib/json.js';
import {
  chromeOverrideSchema,
  docTypeSchema,
  jsonContentSchema,
} from '../../lib/validators.js';

/* ───────────────────────────── Esquemas ───────────────────────────── */

const createSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  description: z.string().trim().max(500).optional(),
  templateId: z.uuid().nullable().optional(),
  designId: z.uuid().nullable().optional(),
  docType: docTypeSchema.optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  // Contenido inicial: permite materializar un borrador del editor en un solo
  // viaje, sin crear una fila vacía y sobrescribirla después.
  content: jsonContentSchema.optional(),
  header: chromeOverrideSchema.optional(),
  footer: chromeOverrideSchema.optional(),
});

const contentSchema = z.object({
  content: jsonContentSchema,
  header: chromeOverrideSchema.optional(),
  footer: chromeOverrideSchema.optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  title: z.string().trim().min(1).max(240).optional(),
  description: z.string().trim().max(500).optional(),
  /** Versión que el cliente cree tener. Si no coincide → 409. */
  expectedVersion: z.number().int().positive(),
  /** Fuerza la creación de una entrada en el historial. */
  checkpoint: z.boolean().optional(),
  note: z.string().max(500).optional(),
});

const listQuery = z.object({
  q: z.string().max(200).optional(),
  docType: docTypeSchema.optional(),
  /** Filtra por la plantilla con la que se creó el documento. */
  templateId: z.uuid().optional(),
  status: z.enum(DOCUMENT_STATUSES).optional(),
  scope: z.enum(['all', 'mine', 'shared']).default('all'),
  /** `true` lista solo los documentos en la papelera del usuario. */
  trashed: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
  sort: z.enum(['updated', 'created', 'title']).default('updated'),
});

const shareSchema = z.object({
  userId: z.uuid(),
  permission: z.enum(['editor', 'viewer']),
});

/**
 * Estados que convierten al documento en un registro oficial y, por tanto,
 * disparan la asignación del correlativo.
 */
const OFFICIAL_STATUSES: ReadonlyArray<(typeof DOCUMENT_STATUSES)[number]> = [
  'sent',
  'approved',
  'final',
  'archived',
];

/* ─────────────────────── Guardado de versiones ─────────────────────── */

/**
 * Guarda un snapshot en el historial. Para no llenar la tabla con un registro
 * por cada autoguardado, si la última versión es 'auto' y tiene menos de
 * `AUTO_MERGE_MS`, se reemplaza en lugar de insertar otra.
 */
const AUTO_MERGE_MS = 90_000;

async function saveVersion(
  documentId: string,
  userId: string,
  kind: 'auto' | 'manual' | 'ai' | 'export' | 'restore',
  note = '',
): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) return;

  const [last] = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.version))
    .limit(1);

  const snapshot = {
    content: doc.content,
    header: doc.header,
    footer: doc.footer,
    data: doc.data,
    title: doc.title,
    kind,
    note,
    createdBy: userId,
  };

  if (last && last.version === doc.version) {
    await db.update(documentVersions).set(snapshot).where(eq(documentVersions.id, last.id));
    return;
  }

  const canMerge =
    kind === 'auto' &&
    last?.kind === 'auto' &&
    Date.now() - last.createdAt.getTime() < AUTO_MERGE_MS;

  if (canMerge && last) {
    // Reemplaza la versión auto reciente (misma fila, nuevo contenido)
    await db
      .update(documentVersions)
      .set({ ...snapshot, version: doc.version })
      .where(eq(documentVersions.id, last.id));
    return;
  }

  await db.insert(documentVersions).values({
    documentId,
    version: doc.version,
    ...snapshot,
  });
}

/**
 * Un documento con una solicitud pendiente no puede borrarse ni cambiar sus
 * accesos: el jefe debe poder aprobarlo o rechazarlo con el mismo alcance.
 */
async function assertNoPendingSend(documentId: string): Promise<void> {
  const [pending] = await db
    .select({ id: documentMessages.id })
    .from(documentMessages)
    .where(
      and(
        eq(documentMessages.documentId, documentId),
        eq(documentMessages.status, 'pending_approval'),
      ),
    )
    .limit(1);

  if (pending) {
    throw conflict(
      'Hay un envío pendiente de aprobación. Cancélalo antes de eliminar el documento o cambiar sus accesos',
    );
  }
}

/* ──────────────────────────── Serialización ─────────────────────────── */

export function toSummary(
  row: typeof documents.$inferSelect,
  ownerName: string,
  permission: 'owner' | 'editor' | 'viewer',
  designTokens: DesignTokens | null = null,
  designUpdatedAt: Date | null = null,
  templateSchema: VariableDef[] = [],
  numberingPreview: NumberingPreview | null = null,
) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    autoDescription: buildAutoDescription({
      docType: row.docType,
      schema: templateSchema,
      data: row.data,
    }),
    docType: row.docType,
    status: row.status,
    docNumber: row.docNumber,
    /**
     * Número que le tocaría si se oficializara ahora. Solo se calcula para
     * borradores y es orientativo: no reserva el correlativo.
     */
    pendingDocNumber: row.docNumber ? null : (numberingPreview?.number ?? null),
    numberingPreview: row.docNumber ? null : numberingPreview,
    version: row.version,
    ownerId: row.ownerId,
    ownerName,
    templateId: row.templateId,
    designId: row.designId,
    designTokens: designTokensForList(designTokens),
    designUpdatedAt: designUpdatedAt?.toISOString() ?? null,
    permission,
    lockedAt: row.lockedAt?.toISOString() ?? null,
    lockedBy: row.lockedBy ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

function defaultData(schema: VariableDef[]): VariableValues {
  const data: VariableValues = {};
  for (const variable of schema) {
    if (variable.defaultValue !== undefined) data[variable.key] = variable.defaultValue;
    else if (variable.type === 'table') data[variable.key] = [];
    else if (variable.type === 'multiselect') data[variable.key] = [];
    else if (variable.type === 'checkbox') data[variable.key] = false;
  }
  return data;
}

/* ─────────────────────────────── Rutas ──────────────────────────────── */

export async function documentRoutes(app: FastifyInstance): Promise<void> {
  /** Lista documentos propios y compartidos. */
  app.get('/', async (request) => {
    const user = await authenticate(request);
    const query = listQuery.parse(request.query);

    const base = query.trashed === 'true'
      ? [isNotNull(documents.deletedAt), eq(documents.ownerId, user.sub)]
      : [isNull(documents.deletedAt)];

    let where;
    if (query.trashed === 'true') {
      where = and(...base);
    } else if (query.scope === 'mine') {
      where = and(...base, eq(documents.ownerId, user.sub));
    } else if (query.scope === 'shared') {
      where = and(
        ...base,
        sql`${documents.ownerId} <> ${user.sub}`,
        sql`exists (select 1 from ${documentShares} where ${documentShares.documentId} = ${documents.id} and ${documentShares.userId} = ${user.sub})`,
      );
    } else {
      where = and(
        ...base,
        or(
          eq(documents.ownerId, user.sub),
          sql`exists (select 1 from ${documentShares} where ${documentShares.documentId} = ${documents.id} and ${documentShares.userId} = ${user.sub})`,
        ),
      );
    }

    if (query.docType) where = and(where, eq(documents.docType, query.docType));
    if (query.templateId) where = and(where, eq(documents.templateId, query.templateId));
    if (query.status) where = and(where, eq(documents.status, query.status));
    if (query.q) {
      const pattern = `%${query.q}%`;
      where = and(
        where,
        or(
          ilike(documents.title, pattern),
          ilike(documents.description, pattern),
          ilike(sql`${documents.data}::text`, pattern),
        ),
      );
    }

    const order =
      query.sort === 'created'
        ? desc(documents.createdAt)
        : query.sort === 'title'
          ? asc(documents.title)
          : desc(documents.updatedAt);

    const rows = await db
      .select({
        doc: documents,
        ownerName: users.name,
        sharePermission: documentShares.permission,
        designTokens: designs.tokens,
        designUpdatedAt: designs.updatedAt,
        templateSchema: templates.schema,
        templateNumberingEnabled: templates.numberingEnabled,
        templateNumberingPrefix: templates.numberingPrefix,
        templateId: templates.id,
      })
      .from(documents)
      .innerJoin(users, eq(users.id, documents.ownerId))
      .leftJoin(designs, and(eq(designs.id, documents.designId), isNull(designs.deletedAt)))
      .leftJoin(templates, and(eq(templates.id, documents.templateId), isNull(templates.deletedAt)))
      .leftJoin(
        documentShares,
        and(eq(documentShares.documentId, documents.id), eq(documentShares.userId, user.sub)),
      )
      .where(where)
      .orderBy(order)
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const countRows = await db.select({ count: sql<number>`count(*)::int` }).from(documents).where(where);

    // Los números previstos se calculan en lote (una consulta de series y otra
    // de contadores) para no hacer N+1 con el listado.
    const previews = await numberingPreviewsFor(
      rows.map((row) => ({
        docType: row.doc.docType,
        template:
          row.templateNumberingEnabled !== null
            ? {
                templateId: row.templateId,
                numberingEnabled: row.templateNumberingEnabled,
                numberingPrefix: row.templateNumberingPrefix,
              }
            : null,
      })),
    );

    const items = rows.map((row, index) =>
      toSummary(
        row.doc,
        row.ownerName,
        row.doc.ownerId === user.sub ? 'owner' : (row.sharePermission ?? 'viewer'),
        row.designTokens ?? null,
        row.designUpdatedAt ?? null,
        (row.templateSchema ?? []) as VariableDef[],
        previews[index] ?? null,
      ),
    );

    return {
      items,
      total: countRows[0]?.count ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  });

  /** Detalle completo con contenido, diseño y permisos. */
  app.get('/:id', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const { document, permission } = await getDocumentAccess(user.sub, id);

    const [owner] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, document.ownerId))
      .limit(1);

    const design = document.designId
      ? (
          await db
            .select()
            .from(designs)
            .where(and(eq(designs.id, document.designId), isNull(designs.deletedAt)))
            .limit(1)
        )[0]
      : undefined;

    const template = document.templateId
      ? (
          await db
            .select({
              id: templates.id,
              name: templates.name,
              schema: templates.schema,
              header: templates.header,
              footer: templates.footer,
              numberingEnabled: templates.numberingEnabled,
              numberingPrefix: templates.numberingPrefix,
            })
            .from(templates)
            .where(and(eq(templates.id, document.templateId), isNull(templates.deletedAt)))
            .limit(1)
        )[0]
      : undefined;

    const chrome = resolveChrome({
      document,
      template,
      design: design?.tokens,
    });
    // Lo que se vería si el documento dejara de sobrescribir sus bandas.
    const inheritedChrome = resolveChrome({
      document: null,
      template,
      design: design?.tokens,
    });

    const shares = await db
      .select({
        userId: documentShares.userId,
        permission: documentShares.permission,
        name: users.name,
        email: users.email,
      })
      .from(documentShares)
      .innerJoin(users, eq(users.id, documentShares.userId))
      .where(eq(documentShares.documentId, id));

    const [pendingMessage] = await db
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
          eq(documentMessages.documentId, id),
          eq(documentMessages.status, 'pending_approval'),
        ),
      )
      .orderBy(desc(documentMessages.createdAt))
      .limit(1);

    const numberingPreview = document.docNumber
      ? null
      : await previewDocumentNumber({
          docType: document.docType,
          template: template ? templateNumberingFrom(template) : null,
        });

    // Si la solicitud más reciente fue rechazada, el remitente necesita el
    // motivo y los datos del envío para poder corregir y reenviar.
    const [lastMessage] = await db
      .select({
        id: documentMessages.id,
        senderId: documentMessages.senderId,
        status: documentMessages.status,
        subject: documentMessages.subject,
        body: documentMessages.body,
        documentVersion: documentMessages.documentVersion,
        rejectedReason: documentMessages.rejectedReason,
        allowSenderEdit: documentMessages.allowSenderEdit,
        approvedById: documentMessages.approvedById,
        approvedAt: documentMessages.approvedAt,
      })
      .from(documentMessages)
      .where(eq(documentMessages.documentId, id))
      .orderBy(desc(documentMessages.createdAt))
      .limit(1);

    let lastRejection: DocumentRejection | null = null;
    if (
      lastMessage &&
      lastMessage.status === 'rejected' &&
      lastMessage.senderId === user.sub
    ) {
      let rejectedByName: string | null = null;
      if (lastMessage.approvedById) {
        const [rejecter] = await db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, lastMessage.approvedById))
          .limit(1);
        rejectedByName = rejecter?.name ?? null;
      }

      const recipientRows = await db
        .select({ userId: documentMessageRecipients.userId })
        .from(documentMessageRecipients)
        .innerJoin(users, eq(users.id, documentMessageRecipients.userId))
        .where(
          and(
            eq(documentMessageRecipients.messageId, lastMessage.id),
            eq(users.isActive, true),
          ),
        );

      lastRejection = {
        messageId: lastMessage.id,
        reason: lastMessage.rejectedReason,
        rejectedAt: lastMessage.approvedAt?.toISOString() ?? null,
        rejectedByName,
        allowSenderEdit: lastMessage.allowSenderEdit,
        subject: lastMessage.subject,
        body: lastMessage.body,
        recipientIds: recipientRows.map((row) => row.userId),
        documentVersion: lastMessage.documentVersion,
      };
    }

    return {
      canExport: await canExportDocument(user.sub, user.role, document),
      document: {
        ...toSummary(
          document,
          owner?.name ?? '',
          permission,
          design?.tokens ?? null,
          design?.updatedAt ?? null,
          (template?.schema ?? []) as VariableDef[],
          numberingPreview,
        ),
        content: document.content,
        data: document.data,
        header: document.header,
        footer: document.footer,
        pendingMessage: pendingMessage ?? null,
        lastRejection,
      },
      design: design ?? null,
      templateSchema: template?.schema ?? [],
      templateName: template?.name ?? null,
      chrome,
      inheritedChrome,
      shares,
    };
  });

  /** Crea un documento desde una plantilla o en blanco. */
  app.post('/', async (request, reply) => {
    const user = await authenticate(request);
    const body = createSchema.parse(request.body);

    let docType = body.docType ?? 'blank';
    let content: typeof documents.$inferInsert.content = body.content ?? {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Documento sin título' }] }, { type: 'paragraph' }],
    };
    let designId = body.designId ?? null;
    let data: VariableValues = body.data ?? {};
    let title = body.title ?? 'Documento sin título';
    let description = body.description ?? '';
    /** El diseño lo aporta la plantilla: no hay que validarlo como propio. */
    let designFromTemplate = false;

    if (body.templateId) {
      const [template] = await db
        .select()
        .from(templates)
        .where(and(eq(templates.id, body.templateId), isNull(templates.deletedAt)))
        .limit(1);
      if (!template) throw notFound('Plantilla no encontrada');
      // Se puede usar una plantilla propia, una compartida con todo el mundo o
      // una compartida con esta persona por nombre.
      if (template.ownerId !== user.sub && !template.isShared) {
        const [share] = await db
          .select({ templateId: templateShares.templateId })
          .from(templateShares)
          .where(
            and(
              eq(templateShares.templateId, template.id),
              eq(templateShares.userId, user.sub),
            ),
          )
          .limit(1);
        if (!share) throw notFound('Plantilla no encontrada');
      }
      if (!template.isActive) throw badRequest('La plantilla está inactiva y no se puede usar para crear documentos');

      content = body.content ?? template.body;
      docType = template.docType;
      designId = body.designId === undefined ? (template.designId ?? null) : body.designId;
      data = { ...defaultData(template.schema), ...(body.data ?? {}) };
      title = body.title ?? template.name;
      description = body.description ?? template.description.slice(0, 500);

      // El documento guarda el diseño concreto con el que nace: el que está en
      // uso en ese momento. Así, un cambio de diseño posterior no altera el
      // aspecto de los documentos ya emitidos.
      if (body.designId === undefined) {
        const resolved = await resolveTemplateDesign(template.ownerId, template.designId);
        if (resolved.design) {
          designId = resolved.design.id;
          // El diseño viene de la plantilla (puede ser de otro propietario):
          // no se vuelve a validar la pertenencia.
          designFromTemplate = true;
        }
      }
    }

    if (designId && !designFromTemplate) {
      const [design] = await db
        .select()
        .from(designs)
        .where(and(eq(designs.id, designId), isNull(designs.deletedAt)))
        .limit(1);
      if (!design || (design.ownerId !== user.sub && !design.isShared)) designId = null;
    }

    /**
     * El número correlativo NO se reserva al crear: un borrador no debe
     * consumir la secuencia. Se asigna cuando el documento se oficializa
     * (aprobar/enviar o pasar a un estado final).
     */
    const [created] = await db
      .insert(documents)
      .values({
        ownerId: user.sub,
        templateId: body.templateId ?? null,
        designId,
        title,
        description,
        docType,
        content,
        data,
        header: body.header ?? null,
        footer: body.footer ?? null,
        docNumber: null,
      })
      .returning();

    if (!created) throw internal('DOCUMENT_CREATE_FAILED', 'No se pudo crear el documento');

    await db.insert(documentVersions).values({
      documentId: created.id,
      version: created.version,
      content: created.content,
      data: created.data,
      title: created.title,
      kind: 'manual',
      note: 'Documento creado',
      createdBy: user.sub,
    });

    await logActivity(user.sub, 'document', created.id, 'created', {
      docType,
      templateId: body.templateId ?? null,
    });

    return reply.status(201).send({
      document: toSummary(created, user.name, 'owner'),
    });
  });

  /**
   * Guarda el contenido. Usa versionado optimista: si `expectedVersion` no
   * coincide con la versión actual se responde 409 con la versión vigente.
   */
  app.put('/:id/content', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = contentSchema.parse(request.body);

    const { document, permission } = await assertDocument(user.sub, id, 'editor');
    assertDocumentMutable(document);

    const next = {
      content: body.content,
      header: body.header === undefined ? document.header : body.header,
      footer: body.footer === undefined ? document.footer : body.footer,
      data: body.data ?? document.data,
      title: body.title ?? document.title,
      description: body.description ?? document.description,
    };

    /**
     * Abrir un documento no debe escribir nada. Si el cliente envía el mismo
     * contenido (por ejemplo, el autoguardado al cargar), no se incrementa la
     * versión, no cambia `updated_at` y no se crea una entrada en el historial.
     */
    const unchanged =
      sameJson(next.content, document.content) &&
      sameJson(next.header, document.header) &&
      sameJson(next.footer, document.footer) &&
      sameJson(next.data, document.data) &&
      next.title === document.title &&
      next.description === document.description;

    if (unchanged) {
      return {
        version: document.version,
        updatedAt: document.updatedAt.toISOString(),
        permission,
      };
    }

    const [updated] = await db
      .update(documents)
      .set({
        ...next,
        version: document.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(documents.id, id), eq(documents.version, body.expectedVersion)))
      .returning();

    if (!updated) {
      const [current] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
      throw conflict('El documento se modificó en otra sesión', {
        currentVersion: current?.version ?? null,
        updatedAt: current?.updatedAt ?? null,
      });
    }

    await saveVersion(
      id,
      user.sub,
      body.checkpoint ? 'manual' : 'auto',
      body.note ?? (body.checkpoint ? 'Punto de control' : ''),
    );

    if (body.checkpoint) {
      await logActivity(user.sub, 'document', id, 'checkpoint', { version: updated.version });
    }

    return {
      version: updated.version,
      updatedAt: updated.updatedAt.toISOString(),
      permission,
    };
  });

  /** Cambia metadatos del documento. */
  app.patch('/:id', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = z
      .object({
        title: z.string().trim().min(1).max(240).optional(),
        description: z.string().trim().max(500).optional(),
        status: z.enum(DOCUMENT_STATUSES).optional(),
        designId: z.uuid().nullable().optional(),
        data: z.record(z.string(), z.unknown()).optional(),
      })
      .parse(request.body);

    const { document } = await assertDocument(user.sub, id, 'editor');
    assertDocumentMutable(document);

    if (body.status !== undefined && body.status !== document.status) {
      if (user.role !== 'admin') {
        throw forbidden('Solo los administradores pueden cambiar el estado del documento');
      }
      if (body.status === 'sent' || body.status === 'approved' || body.status === 'cancelled') {
        throw badRequest('Los estados finales solo se asignan desde la bandeja de envío');
      }
    }

    if (body.designId) {
      const [design] = await db
        .select()
        .from(designs)
        .where(and(eq(designs.id, body.designId), isNull(designs.deletedAt)))
        .limit(1);
      if (!design || (design.ownerId !== user.sub && !design.isShared)) {
        throw notFound('Diseño no encontrado');
      }
    }

    let updated: typeof documents.$inferSelect | undefined;
    const becomesOfficial =
      body.status !== undefined &&
      OFFICIAL_STATUSES.includes(body.status) &&
      !document.docNumber;

    if (becomesOfficial) {
      // El cambio de estado y la asignación del número deben ser atómicos.
      updated = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(documents)
          .set({
            title: body.title ?? document.title,
            description: body.description ?? document.description,
            status: body.status ?? document.status,
            designId: body.designId === undefined ? document.designId : body.designId,
            data: body.data ?? document.data,
            updatedAt: new Date(),
          })
          .where(eq(documents.id, id))
          .returning();
        if (!row) return undefined;

        await numberDocumentInTx(tx, row.id);

        const [numbered] = await tx
          .select()
          .from(documents)
          .where(eq(documents.id, id))
          .limit(1);
        return numbered ?? row;
      });
    } else {
      [updated] = await db
        .update(documents)
        .set({
          title: body.title ?? document.title,
          description: body.description ?? document.description,
          status: body.status ?? document.status,
          designId: body.designId === undefined ? document.designId : body.designId,
          data: body.data ?? document.data,
          updatedAt: new Date(),
        })
        .where(eq(documents.id, id))
        .returning();
    }

    if (!updated) throw internal('DOCUMENT_UPDATE_FAILED', 'No se pudo actualizar el documento');

    return {
      document: toSummary(updated, user.name, updated.ownerId === user.sub ? 'owner' : 'editor'),
    };
  });

  /** Borrado lógico. */
  app.delete('/:id', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const { document } = await assertDocument(user.sub, id, 'owner');
    assertDocumentMutable(document);
    await assertNoPendingSend(id);

    await db
      .update(documents)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(documents.id, id));

    await logActivity(user.sub, 'document', id, 'deleted', { title: document.title });
    return { ok: true };
  });

  /** Restaura un documento de la papelera. */
  app.post('/:id/restore', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);

    const [row] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
    if (!row || !row.deletedAt) throw notFound('Documento no encontrado');
    if (row.ownerId !== user.sub) throw forbidden('Solo el propietario puede restaurar este documento');
    if (row.lockedAt || row.status === 'sent') throw locked();

    /**
     * Restaurar nunca falla por un número. Como el correlativo solo lo
     * reservan los documentos vivos, un documento que sale de la papelera
     * puede encontrarse con que su número ya lo ocupa otro de **su misma
     * serie**. En ese caso se le libera el número: vuelve a ser un borrador y
     * recibirá uno nuevo la próxima vez que se oficialice. Dos series que
     * compartan prefijo pueden mostrar el mismo texto sin interferir.
     */
    let releasedDocNumber: string | null = null;

    if (row.docNumber) {
      const [occupied] = await db
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.docNumber, row.docNumber),
            isNull(documents.deletedAt),
            ne(documents.id, id),
            row.numberingSeriesId
              ? eq(documents.numberingSeriesId, row.numberingSeriesId)
              : isNull(documents.numberingSeriesId),
          ),
        )
        .limit(1);

      if (occupied) {
        releasedDocNumber = row.docNumber;
        // La variable heredada `numero` seguía al correlativo asignado.
        const nextData: VariableValues = { ...(row.data ?? {}) };
        delete nextData.numero;

        await db
          .update(documents)
          .set({
            docNumber: null,
            numberingPrefix: null,
            numberingYear: null,
            numberingValue: null,
            numberingSeriesId: null,
            data: nextData,
            updatedAt: new Date(),
          })
          .where(eq(documents.id, id));
      }
    }

    await db
      .update(documents)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(documents.id, id));

    await logActivity(user.sub, 'document', id, 'restored', {
      title: row.title,
      ...(releasedDocNumber ? { releasedDocNumber } : {}),
    });
    return { ok: true, releasedDocNumber };
  });

  /** Historial de versiones. */
  app.get('/:id/versions', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    await assertDocument(user.sub, id, 'viewer');

    const items = await db
      .select({
        id: documentVersions.id,
        version: documentVersions.version,
        kind: documentVersions.kind,
        note: documentVersions.note,
        title: documentVersions.title,
        createdAt: documentVersions.createdAt,
        createdBy: documentVersions.createdBy,
        authorName: users.name,
      })
      .from(documentVersions)
      .leftJoin(users, eq(users.id, documentVersions.createdBy))
      .where(eq(documentVersions.documentId, id))
      .orderBy(desc(documentVersions.version))
      .limit(200);

    return { items };
  });

  /** Contenido de una versión concreta. */
  app.get('/:id/versions/:version', async (request) => {
    const user = await authenticate(request);
    const params = z
      .object({ id: z.uuid(), version: z.coerce.number().int().positive() })
      .parse(request.params);
    await assertDocument(user.sub, params.id, 'viewer');

    const [row] = await db
      .select()
      .from(documentVersions)
      .where(
        and(eq(documentVersions.documentId, params.id), eq(documentVersions.version, params.version)),
      )
      .limit(1);

    if (!row) throw notFound('Versión no encontrada');
    return { version: row };
  });

  /** Restaura una versión anterior como nueva versión actual. */
  app.post('/:id/restore/:version', async (request) => {
    const user = await authenticate(request);
    const params = z
      .object({ id: z.uuid(), version: z.coerce.number().int().positive() })
      .parse(request.params);
    const { document } = await assertDocument(user.sub, params.id, 'editor');
    assertDocumentMutable(document);

    const [snapshot] = await db
      .select()
      .from(documentVersions)
      .where(
        and(
          eq(documentVersions.documentId, params.id),
          eq(documentVersions.version, params.version),
        ),
      )
      .limit(1);

    if (!snapshot) throw notFound('Versión no encontrada');

    const [updated] = await db
      .update(documents)
      .set({
        content: snapshot.content,
        header: snapshot.header ?? null,
        footer: snapshot.footer ?? null,
        data: snapshot.data,
        title: snapshot.title || document.title,
        version: document.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(documents.id, params.id))
      .returning();

    if (!updated) throw internal('VERSION_RESTORE_FAILED', 'No se pudo restaurar la versión');

    await saveVersion(params.id, user.sub, 'restore', `Restaurada la versión ${params.version}`);
    await logActivity(user.sub, 'document', params.id, 'restored', { version: params.version });

    return { version: updated.version, content: updated.content };
  });

  /** Comparte el documento con otro usuario. */
  app.post('/:id/shares', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = shareSchema.parse(request.body);
    const { document } = await assertDocument(user.sub, id, 'owner');
    assertDocumentMutable(document);
    await assertNoPendingSend(id);

    const [target] = await db.select().from(users).where(eq(users.id, body.userId)).limit(1);
    if (!target) throw notFound('Usuario no encontrado');
    if (target.id === user.sub) throw badRequest('No puedes compartir contigo mismo');

    await db
      .insert(documentShares)
      .values({ documentId: id, userId: body.userId, permission: body.permission })
      .onConflictDoUpdate({
        target: [documentShares.documentId, documentShares.userId],
        set: { permission: body.permission },
      });

    await logActivity(user.sub, 'document', id, 'shared', {
      userId: body.userId,
      permission: body.permission,
    });

    return { ok: true };
  });

  /** Retira el acceso a un usuario. */
  app.delete('/:id/shares/:userId', async (request) => {
    const user = await authenticate(request);
    const params = z.object({ id: z.uuid(), userId: z.uuid() }).parse(request.params);
    const { document } = await assertDocument(user.sub, params.id, 'owner');
    assertDocumentMutable(document);
    await assertNoPendingSend(params.id);

    await db
      .delete(documentShares)
      .where(
        and(eq(documentShares.documentId, params.id), eq(documentShares.userId, params.userId)),
      );

    return { ok: true };
  });

  /** Actividad reciente del documento. */
  app.get('/:id/activity', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    await assertDocument(user.sub, id, 'viewer');

    const { activities } = await import('../../db/schema.js');
    const items = await db
      .select({
        id: activities.id,
        action: activities.action,
        meta: activities.meta,
        createdAt: activities.createdAt,
        userName: users.name,
      })
      .from(activities)
      .leftJoin(users, eq(users.id, activities.userId))
      .where(and(eq(activities.entityType, 'document'), eq(activities.entityId, id)))
      .orderBy(desc(activities.createdAt))
      .limit(50);

    return { items };
  });
}

export { saveVersion, defaultData };
