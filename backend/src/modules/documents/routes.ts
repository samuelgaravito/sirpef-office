import { and, asc, desc, eq, gte, ilike, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  buildAutoDescription,
  designTokensForList,
  DOCUMENT_STATUSES,
  resolveChrome,
} from '@sirpefoffice/shared';
import type { DesignTokens, VariableDef, VariableValues } from '@sirpefoffice/shared';

import { db } from '../../db/index.js';
import {
  designs,
  documentMessages,
  documentShares,
  documentVersions,
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
import { authenticate } from '../../lib/auth-guard.js';
import { documentNumberFor } from '../../lib/counter.js';
import { badRequest, conflict, forbidden, locked, notFound } from '../../lib/errors.js';
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

    const items = rows.map((row) =>
      toSummary(
        row.doc,
        row.ownerName,
        row.doc.ownerId === user.sub ? 'owner' : (row.sharePermission ?? 'viewer'),
        row.designTokens ?? null,
        row.designUpdatedAt ?? null,
        (row.templateSchema ?? []) as VariableDef[],
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
              name: templates.name,
              schema: templates.schema,
              header: templates.header,
              footer: templates.footer,
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
        ),
        content: document.content,
        data: document.data,
        header: document.header,
        footer: document.footer,
        pendingMessage: pendingMessage ?? null,
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
    let content: typeof documents.$inferInsert.content = {
      type: 'doc',
      content: [{ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Documento sin título' }] }, { type: 'paragraph' }],
    };
    let designId = body.designId ?? null;
    let data: VariableValues = body.data ?? {};
    let title = body.title ?? 'Documento sin título';
    let description = body.description ?? '';
    let selectedTemplate: typeof templates.$inferSelect | null = null;

    if (body.templateId) {
      const [template] = await db
        .select()
        .from(templates)
        .where(and(eq(templates.id, body.templateId), isNull(templates.deletedAt)))
        .limit(1);
      if (!template) throw notFound('Plantilla no encontrada');
      if (template.ownerId !== user.sub && !template.isShared) throw notFound('Plantilla no encontrada');
      if (!template.isActive) throw badRequest('La plantilla está inactiva y no se puede usar para crear documentos');

      selectedTemplate = template;
      content = template.body;
      docType = template.docType;
      designId = body.designId === undefined ? (template.designId ?? null) : body.designId;
      data = { ...defaultData(template.schema), ...(body.data ?? {}) };
      title = body.title ?? template.name;
      description = body.description ?? template.description.slice(0, 500);
    }

    if (designId) {
      const [design] = await db
        .select()
        .from(designs)
        .where(and(eq(designs.id, designId), isNull(designs.deletedAt)))
        .limit(1);
      if (!design || (design.ownerId !== user.sub && !design.isShared)) designId = null;
    }

    const docNumber = await documentNumberFor({ docType, template: selectedTemplate });
    // Compatibilidad: las plantillas antiguas usan {{numero}} como campo manual.
    // Al crear el documento se precarga con el correlativo automático.
    if (docNumber && !data.numero) data.numero = docNumber;

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
        docNumber,
      })
      .returning();

    if (!created) throw new Error('No se pudo crear el documento');

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
      docNumber,
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

    const [updated] = await db
      .update(documents)
      .set({
        content: body.content,
        header: body.header === undefined ? document.header : body.header,
        footer: body.footer === undefined ? document.footer : body.footer,
        data: body.data ?? document.data,
        title: body.title ?? document.title,
        description: body.description ?? document.description,
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

    const [updated] = await db
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

    if (!updated) throw new Error('No se pudo actualizar el documento');

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

    await db
      .update(documents)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(documents.id, id));

    await logActivity(user.sub, 'document', id, 'restored', { title: row.title });
    return { ok: true };
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

    if (!updated) throw new Error('No se pudo restaurar la versión');

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
