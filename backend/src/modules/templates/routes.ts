import { and, desc, eq, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  designTokensForList,
  resolveChrome,
  DEFAULT_DESIGN_TOKENS,
  DOC_TYPE_PREFIX,
  DOC_TYPES_WITHOUT_NUMBER,
  formatDocumentNumber,
  normalizeNumberingPrefix,
  withDocumentNumber,
} from '@sirpefoffice/shared';
import type { DesignTokens, DocType, JSONContent } from '@sirpefoffice/shared';

import { db } from '../../db/index.js';
import { designs, templateVersions, templates } from '../../db/schema.js';
import { authenticate } from '../../lib/auth-guard.js';
import { logActivity } from '../../lib/activity.js';
import { previewDocumentNumber } from '../../lib/counter.js';
import { getActiveDesigns, resolveTemplateDesign } from '../../lib/active-design.js';
import { forbidden, notFound } from '../../lib/errors.js';
import {
  ensureNumberingSeries,
  getNumberingSeries,
  getNumberingState,
  parseNumberingPrefix,
  updateNumberingSeries,
} from '../../lib/numbering.js';
import { renderDocumentHtml } from '../../lib/document-html.js';
import { buildDocumentHtml, sampleValues } from '../../lib/render.js';
import {
  chromeOverrideSchema,
  docTypeSchema,
  jsonContentSchema,
  variableDefSchema,
} from '../../lib/validators.js';

const numberingInputSchema = z.object({
  enabled: z.boolean().optional(),
  prefix: z.string().trim().max(10).nullable().optional(),
  startValue: z.number().int().min(1).max(999_999).optional(),
  padding: z.number().int().min(1).max(8).optional(),
  includeYear: z.boolean().optional(),
});

const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(1000).default(''),
  docType: docTypeSchema.default('blank'),
  designId: z.uuid().nullable().optional(),
  schema: z.array(variableDefSchema).max(200).default([]),
  body: jsonContentSchema,
  header: chromeOverrideSchema.optional(),
  footer: chromeOverrideSchema.optional(),
  aiInstructions: z.string().max(8000).nullable().optional(),
  isShared: z.boolean().default(false),
  numbering: numberingInputSchema.optional(),
});

/**
 * Actualización parcial: sin valores por defecto, para que un PATCH que solo
 * envía un campo no borre la descripción, el esquema ni la compartición.
 */
const updateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().max(1000).optional(),
  docType: docTypeSchema.optional(),
  designId: z.uuid().nullable().optional(),
  schema: z.array(variableDefSchema).max(200).optional(),
  body: jsonContentSchema.optional(),
  header: chromeOverrideSchema.optional(),
  footer: chromeOverrideSchema.optional(),
  aiInstructions: z.string().max(8000).nullable().optional(),
  isShared: z.boolean().optional(),
  numbering: numberingInputSchema.optional(),
  /** Se envía para control optimista de concurrencia. */
  expectedVersion: z.number().int().positive().optional(),
  /** Nota que se guarda junto a la versión creada. */
  note: z.string().max(500).optional(),
});

const listQuery = z.object({
  q: z.string().max(200).optional(),
  docType: docTypeSchema.optional(),
  status: z.enum(['all', 'active', 'inactive']).default('all'),
  scope: z.enum(['all', 'mine', 'shared']).default('all'),
  /** `true` lista solo las plantillas en la papelera del usuario. */
  trashed: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

const previewQuery = z.object({
  /** `none` pide la vista previa sin diseño. */
  designId: z.union([z.uuid(), z.literal('none')]).optional(),
  embed: z.enum(['0', '1']).optional(),
});

const draftPreviewSchema = z.object({
  name: z.string().trim().max(160).optional(),
  body: jsonContentSchema,
  schema: z.array(variableDefSchema).max(200).default([]),
  designId: z.uuid().nullable().optional(),
  header: chromeOverrideSchema.optional(),
  footer: chromeOverrideSchema.optional(),
  numbering: numberingInputSchema.optional(),
  embed: z.boolean().optional(),
});

async function visibleDesign(
  ownerId: string,
  designId: string | null | undefined,
): Promise<typeof designs.$inferSelect | null> {
  if (!designId) return null;
  const [design] = await db
    .select()
    .from(designs)
    .where(and(eq(designs.id, designId), isNull(designs.deletedAt)))
    .limit(1);
  if (!design) return null;
  if (design.ownerId !== ownerId && !design.isShared) return null;
  return design;
}

interface TemplateAccessUser {
  sub: string;
  role: 'admin' | 'member';
}

interface TemplateAccessRow {
  ownerId: string;
  isShared: boolean;
  isActive: boolean;
}

/** Propietario, o cualquier usuario sobre una plantilla compartida activa. */
function canViewTemplate(user: TemplateAccessUser, row: TemplateAccessRow): boolean {
  if (row.ownerId === user.sub) return true;
  if (!row.isShared) return false;
  // Los administradores también ven las compartidas inactivas para mantenerlas.
  return user.role === 'admin' || row.isActive;
}

/** Propietario, o administrador sobre una plantilla compartida. */
function canEditTemplate(
  user: TemplateAccessUser,
  row: Pick<TemplateAccessRow, 'ownerId' | 'isShared'>,
): boolean {
  return row.ownerId === user.sub || (user.role === 'admin' && row.isShared);
}

interface TemplateNumbering {
  enabled: boolean;
  prefix: string | null;
}

/**
 * Resuelve la serie de numeración de una plantilla. Reutiliza la serie si el
 * prefijo ya existe y solo la modifica cuando el usuario cambia de verdad el
 * número inicial, el relleno o el uso del año.
 */
async function resolveTemplateNumbering(options: {
  userId: string;
  docType: DocType;
  input?: z.infer<typeof numberingInputSchema>;
  current?: { numberingEnabled: boolean; numberingPrefix: string | null } | null;
}): Promise<TemplateNumbering> {
  const { input, current } = options;
  const fallbackPrefix = DOC_TYPE_PREFIX[options.docType];
  const enabled =
    input?.enabled ??
    current?.numberingEnabled ??
    !DOC_TYPES_WITHOUT_NUMBER.includes(options.docType);

  // `prefix: ''` explícito significa “sin prefijo”. Si el campo no se envía,
  // se conserva el prefijo actual o se usa el sugerido por tipo.
  const requestedPrefix = input?.prefix;
  const rawPrefix =
    requestedPrefix !== undefined && requestedPrefix !== null
      ? requestedPrefix
      : current?.numberingPrefix ?? fallbackPrefix;
  const prefix = normalizeNumberingPrefix(rawPrefix ?? '');
  parseNumberingPrefix(prefix);

  if (!enabled) {
    // Asegura la serie para que la clave foránea de templates no falle.
    await ensureNumberingSeries({
      prefix,
      startValue: input?.startValue ?? 1,
      padding: input?.padding ?? 4,
      includeYear: input?.includeYear ?? true,
      createdBy: options.userId,
    });
    return { enabled: false, prefix };
  }

  const existing = await getNumberingSeries(prefix);
  if (!existing) {
    await ensureNumberingSeries({
      prefix,
      startValue: input?.startValue ?? 1,
      padding: input?.padding ?? 4,
      includeYear: input?.includeYear ?? true,
      createdBy: options.userId,
    });
  } else if (
    input &&
    ((input.startValue !== undefined && input.startValue !== existing.startValue) ||
      (input.padding !== undefined && input.padding !== existing.padding) ||
      (input.includeYear !== undefined && input.includeYear !== existing.includeYear))
  ) {
    await updateNumberingSeries(
      prefix,
      {
        startValue: input.startValue,
        padding: input.padding,
        includeYear: input.includeYear,
      },
      options.userId,
    );
  }

  return { enabled: true, prefix };
}

/** Número de ejemplo para la vista previa de una plantilla guardada. */
async function templateSampleNumber(template: {
  numberingEnabled: boolean;
  numberingPrefix: string | null;
  docType: DocType;
}): Promise<string> {
  if (!template.numberingEnabled) return '';
  const prefix = template.numberingPrefix ?? DOC_TYPE_PREFIX[template.docType];
  if (prefix === null || prefix === undefined) return '';

  const state = await getNumberingState(prefix);
  if (state) return state.nextNumber;

  return formatDocumentNumber({
    prefix,
    value: 1,
    year: new Date().getFullYear(),
    padding: 4,
    includeYear: true,
  });
}

/** Número de ejemplo para un borrador aún no guardado. */
function draftSampleNumber(input?: {
  enabled?: boolean;
  prefix?: string | null;
  startValue?: number;
  padding?: number;
  includeYear?: boolean;
}): string {
  if (!input?.enabled) return '';
  return formatDocumentNumber({
    prefix: normalizeNumberingPrefix(input.prefix ?? ''),
    value: input.startValue ?? 1,
    year: new Date().getFullYear(),
    padding: input.padding ?? 4,
    includeYear: input.includeYear ?? true,
  });
}

async function previewHtml(options: {
  title: string;
  body: JSONContent;
  schema: Parameters<typeof sampleValues>[0];
  template: { header: typeof templates.$inferSelect.header; footer: typeof templates.$inferSelect.footer };
  /** Tokens del diseño efectivo (base o variante activada). */
  tokens: DesignTokens;
  /** Número de ejemplo para la variable de sistema del documento. */
  documentNumber?: string | null;
  embed?: boolean;
}): Promise<string> {
  const renderOptions = {
    content: options.body,
    design: options.tokens,
    chrome: resolveChrome({ template: options.template, design: options.tokens }),
    values: withDocumentNumber(sampleValues(options.schema), options.documentNumber),
    title: options.title,
    includeLetterhead: true,
  };

  // Las miniaturas no necesitan medir ni paginar el documento completo.
  return options.embed
    ? buildDocumentHtml({ ...renderOptions, embed: true })
    : renderDocumentHtml(renderOptions);
}

export async function templateRoutes(app: FastifyInstance): Promise<void> {
  /** Lista plantillas visibles para el usuario. */
  app.get('/', async (request) => {
    const user = await authenticate(request);
    const query = listQuery.parse(request.query);

    const own = eq(templates.ownerId, user.sub);
    // Los administradores ven las compartidas aunque estén inactivas; el resto
    // solo las activas. Las privadas ajenas nunca se listan.
    const sharedVisible = and(
      eq(templates.isShared, true),
      user.role === 'admin' ? undefined : eq(templates.isActive, true),
      sql`${templates.ownerId} <> ${user.sub}`,
    );
    const visibility =
      query.scope === 'mine' ? own : query.scope === 'shared' ? sharedVisible : or(own, sharedVisible);

    const where = query.trashed === 'true'
      ? [eq(templates.ownerId, user.sub), isNotNull(templates.deletedAt)]
      : [visibility, isNull(templates.deletedAt)];
    if (query.docType) where.push(eq(templates.docType, query.docType));
    if (query.status !== 'all') where.push(eq(templates.isActive, query.status === 'active'));
    if (query.q) where.push(ilike(templates.name, `%${query.q}%`));

    const items = await db
      .select({
        id: templates.id,
        name: templates.name,
        description: templates.description,
        docType: templates.docType,
        designId: templates.designId,
        designName: designs.name,
        designTokens: designs.tokens,
        designUpdatedAt: designs.updatedAt,
        version: templates.version,
        isShared: templates.isShared,
        isActive: templates.isActive,
        ownerId: templates.ownerId,
        schema: templates.schema,
        isMine: sql<boolean>`${templates.ownerId} = ${user.sub}`,
        updatedAt: templates.updatedAt,
        deletedAt: templates.deletedAt,
      })
      .from(templates)
      .leftJoin(designs, and(eq(designs.id, templates.designId), isNull(designs.deletedAt)))
      .where(and(...where))
      .orderBy(desc(templates.updatedAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);

    const countRows = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(templates)
      .where(and(...where));

    // Diseño en uso de cada cuenta: es el que dibujan sus plantillas.
    const activeDesigns = await getActiveDesigns(items.map((item) => item.ownerId));

    return {
      items: items.map((item) => {
        const active = activeDesigns.get(item.ownerId) ?? null;
        const tokens = active?.tokens ?? item.designTokens ?? DEFAULT_DESIGN_TOKENS;
        return {
          ...item,
          designTokens: designTokensForList(tokens),
          /** Diseño realmente aplicado (el que está en uso). */
          effectiveDesignId: active?.id ?? item.designId,
          effectiveDesignName: active?.name ?? item.designName,
          /** Fecha del diseño aplicado: invalida la caché de la vista previa. */
          effectiveDesignUpdatedAt: active?.updatedAt ?? item.designUpdatedAt,
        };
      }),
      total: countRows[0]?.count ?? 0,
      page: query.page,
      pageSize: query.pageSize,
    };
  });

  /** Vista previa HTML real de una plantilla, con un diseño opcional. */
  app.get('/:id/preview', async (request, reply) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const query = previewQuery.parse(request.query);

    const [row] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.id, id), isNull(templates.deletedAt)))
      .limit(1);
    if (!row) throw notFound('Plantilla no encontrada');
    if (!canViewTemplate(user, row)) throw notFound('Plantilla no encontrada');

    let tokens: DesignTokens = DEFAULT_DESIGN_TOKENS;
    if (query.designId === 'none') {
      tokens = DEFAULT_DESIGN_TOKENS;
    } else if (query.designId) {
      const design = await visibleDesign(user.sub, query.designId);
      // Si el diseño original de una plantilla compartida ya no es visible,
      // se muestra la plantilla igualmente con los valores predeterminados.
      if (!design && query.designId !== row.designId) throw notFound('Diseño no encontrado');
      if (design) tokens = design.tokens;
    } else {
      // La plantilla se dibuja con el diseño en uso de su propietario.
      tokens = (await resolveTemplateDesign(row.ownerId, row.designId)).tokens;
    }

    const html = await previewHtml({
      title: row.name,
      body: row.body,
      schema: row.schema,
      template: row,
      tokens,
      documentNumber: await templateSampleNumber(row),
      embed: query.embed === '1',
    });

    return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  /** Vista previa de un borrador del editor de plantilla (no guarda nada). */
  app.post('/preview', async (request, reply) => {
    const user = await authenticate(request);
    const body = draftPreviewSchema.parse(request.body);

    let tokens: DesignTokens = DEFAULT_DESIGN_TOKENS;
    if (body.designId) {
      const design = await visibleDesign(user.sub, body.designId);
      if (!design) throw notFound('Diseño no encontrado');
      tokens = design.tokens;
    } else {
      // El borrador se dibuja con el diseño en uso de quien lo edita.
      tokens = (await resolveTemplateDesign(user.sub, null)).tokens;
    }

    const html = await previewHtml({
      title: body.name || 'Vista previa de plantilla',
      body: body.body,
      schema: body.schema,
      template: {
        header: body.header ?? null,
        footer: body.footer ?? null,
      },
      tokens,
      documentNumber: draftSampleNumber(body.numbering),
      embed: body.embed,
    });

    return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  /** Detalle de una plantilla. */
  app.get('/:id', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);

    const [row] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.id, id), isNull(templates.deletedAt)))
      .limit(1);
    if (!row) throw notFound('Plantilla no encontrada');
    if (!canViewTemplate(user, row)) throw notFound('Plantilla no encontrada');

    // El diseño efectivo es el que está en uso en la cuenta de la plantilla.
    const resolved = await resolveTemplateDesign(row.ownerId, row.designId);

    return {
      template: row,
      /** Diseño que se aplica ahora (el que está en uso). */
      design: resolved.design ?? null,
      effectiveDesignId: resolved.design?.id ?? null,
      effectiveDesignName: resolved.design?.name ?? null,
      chrome: resolveChrome({ template: row, design: resolved.tokens }),
      inheritedChrome: resolveChrome({ template: null, design: resolved.tokens }),
      // Número que tendría un documento creado con esta plantilla. Es solo una
      // lectura: no reserva el correlativo.
      numberingPreview: await previewDocumentNumber({ docType: row.docType, template: row }),
    };
  });

  /** Crea una plantilla. */
  app.post('/', async (request, reply) => {
    const user = await authenticate(request);
    const body = createSchema.parse(request.body);

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

    const numbering = await resolveTemplateNumbering({
      userId: user.sub,
      docType: body.docType,
      input: body.numbering,
    });

    const [created] = await db
      .insert(templates)
      .values({
        ownerId: user.sub,
        designId: body.designId ?? null,
        name: body.name,
        description: body.description,
        docType: body.docType,
        schema: body.schema,
        body: body.body,
        header: body.header ?? null,
        footer: body.footer ?? null,
        aiInstructions: body.aiInstructions ?? null,
        isShared: body.isShared,
        numberingEnabled: numbering.enabled,
        numberingPrefix: numbering.prefix,
      })
      .returning();

    if (!created) throw new Error('No se pudo crear la plantilla');

    await logActivity(user.sub, 'template', created.id, 'created', { name: created.name });
    return reply.status(201).send({ template: created });
  });

  /** Activa o desactiva una plantilla sin crear una versión nueva. */
  app.patch('/:id/status', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = z.object({ isActive: z.boolean() }).parse(request.body);

    const [row] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.id, id), isNull(templates.deletedAt)))
      .limit(1);
    if (!row) throw notFound('Plantilla no encontrada');
    if (!canEditTemplate(user, row)) {
      throw forbidden('Solo el propietario o un administrador pueden cambiar el estado de esta plantilla');
    }

    const [updated] = await db
      .update(templates)
      .set({ isActive: body.isActive, updatedAt: new Date() })
      .where(eq(templates.id, id))
      .returning();

    if (!updated) throw new Error('No se pudo actualizar la plantilla');
    await logActivity(user.sub, 'template', id, body.isActive ? 'activated' : 'deactivated', {
      name: updated.name,
    });
    return { template: updated };
  });

  /** Actualiza una plantilla creando una nueva versión. */
  app.patch('/:id', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = updateSchema.parse(request.body);

    const [row] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.id, id), isNull(templates.deletedAt)))
      .limit(1);
    if (!row) throw notFound('Plantilla no encontrada');
    if (!canEditTemplate(user, row)) {
      throw forbidden('Solo el propietario o un administrador pueden editar esta plantilla');
    }

    if (body.expectedVersion !== undefined && body.expectedVersion !== row.version) {
      throw Object.assign(new Error('La plantilla cambió en otra sesión'), {
        statusCode: 409,
        code: 'VERSION_CONFLICT',
      });
    }

    const nextVersion = row.version + 1;
    const effectiveDocType = body.docType ?? row.docType;
    const numbering = await resolveTemplateNumbering({
      userId: user.sub,
      docType: effectiveDocType,
      input: body.numbering,
      current: {
        numberingEnabled: row.numberingEnabled,
        numberingPrefix: row.numberingPrefix,
      },
    });
    // La instantánea guarda los tokens del diseño efectivo (el que está en
    // uso en el momento de la edición).
    const resolved = await resolveTemplateDesign(row.ownerId, row.designId);

    const [updated] = await db
      .update(templates)
      .set({
        name: body.name ?? row.name,
        description: body.description ?? row.description,
        docType: body.docType ?? row.docType,
        designId: body.designId === undefined ? row.designId : body.designId,
        schema: body.schema ?? row.schema,
        body: body.body ?? row.body,
        header: body.header === undefined ? row.header : body.header,
        footer: body.footer === undefined ? row.footer : body.footer,
        aiInstructions: body.aiInstructions === undefined ? row.aiInstructions : body.aiInstructions,
        isShared: body.isShared ?? row.isShared,
        numberingEnabled: numbering.enabled,
        numberingPrefix: numbering.prefix,
        version: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(templates.id, id))
      .returning();

    if (!updated) throw new Error('No se pudo actualizar la plantilla');

    await db.insert(templateVersions).values({
      templateId: id,
      version: nextVersion,
      snapshot: {
        name: updated.name,
        description: updated.description,
        docType: updated.docType,
        schema: updated.schema,
        body: updated.body,
        header: updated.header,
        footer: updated.footer,
        aiInstructions: updated.aiInstructions,
        tokens: resolved.tokens,
      },
      note: body.note ?? 'Edición manual',
      createdBy: user.sub,
    });

    await logActivity(user.sub, 'template', id, 'updated', { version: nextVersion });
    return { template: updated };
  });

  /** Duplica una plantilla (propia o compartida) en la cuenta del usuario. */
  app.post('/:id/clone', async (request, reply) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = z.object({ name: z.string().trim().min(1).max(160).optional() }).parse(request.body ?? {});

    const [row] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.id, id), isNull(templates.deletedAt)))
      .limit(1);
    if (!row) throw notFound('Plantilla no encontrada');
    if (!canViewTemplate(user, row)) throw notFound('Plantilla no encontrada');

    const design = await visibleDesign(user.sub, row.designId);

    const [created] = await db
      .insert(templates)
      .values({
        ownerId: user.sub,
        designId: design?.id ?? null,
        name: body.name ?? `${row.name} (copia)`,
        description: row.description,
        docType: row.docType,
        schema: row.schema,
        body: row.body,
        header: row.header,
        footer: row.footer,
        aiInstructions: row.aiInstructions,
        isShared: false,
        isActive: true,
        numberingEnabled: row.numberingEnabled,
        numberingPrefix: row.numberingPrefix,
      })
      .returning();

    if (!created) throw new Error('No se pudo duplicar la plantilla');
    await logActivity(user.sub, 'template', created.id, 'cloned', { from: id });
    return reply.status(201).send({ template: created });
  });

  /** Elimina (borrado lógico) una plantilla propia. Los documentos conservan la referencia. */
  app.delete('/:id', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);

    const [row] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.id, id), isNull(templates.deletedAt)))
      .limit(1);
    if (!row) throw notFound('Plantilla no encontrada');
    if (row.ownerId !== user.sub) throw forbidden('Solo el propietario puede eliminar esta plantilla');

    await db
      .update(templates)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(templates.id, id));
    await logActivity(user.sub, 'template', id, 'deleted', { name: row.name });
    return { ok: true };
  });

  /** Restaura una plantilla de la papelera. */
  app.post('/:id/restore', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);

    const [row] = await db.select().from(templates).where(eq(templates.id, id)).limit(1);
    if (!row || !row.deletedAt) throw notFound('Plantilla no encontrada');
    if (row.ownerId !== user.sub) throw forbidden('Solo el propietario puede restaurar esta plantilla');

    await db
      .update(templates)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(templates.id, id));

    await logActivity(user.sub, 'template', id, 'restored', { name: row.name });
    return { ok: true };
  });

  /** Historial de versiones de la plantilla. */
  app.get('/:id/versions', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);

    const [row] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.id, id), isNull(templates.deletedAt)))
      .limit(1);
    if (!row) throw notFound('Plantilla no encontrada');
    if (!canViewTemplate(user, row)) throw notFound('Plantilla no encontrada');

    const items = await db
      .select({
        id: templateVersions.id,
        version: templateVersions.version,
        note: templateVersions.note,
        createdAt: templateVersions.createdAt,
        createdBy: templateVersions.createdBy,
      })
      .from(templateVersions)
      .where(eq(templateVersions.templateId, id))
      .orderBy(desc(templateVersions.version))
      .limit(100);

    return { items };
  });
}
