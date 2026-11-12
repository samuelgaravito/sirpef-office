import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
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
import {
  designs,
  templateShares,
  templateVersions,
  templates,
  users,
} from '../../db/schema.js';
import { authenticate } from '../../lib/auth-guard.js';
import { logActivity } from '../../lib/activity.js';
import { previewDocumentNumber, templateNumberingFrom } from '../../lib/counter.js';
import { getActiveDesigns, resolveTemplateDesign } from '../../lib/active-design.js';
import { getTemplateAccess, type Permission } from '../../lib/access.js';
import { AppError, badRequest, forbidden, internal, notFound } from '../../lib/errors.js';
import {
  getNumberingState,
  resolveTemplateNumbering as resolveTemplateNumberingConfig,
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
  /** Prefijo de 1 a 20 caracteres; vacío = que el servidor asigne uno. */
  prefix: z.string().trim().max(20).nullable().optional(),
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

/**
 * Permiso efectivo sobre una plantilla concreta, para las rutas que ya
 * tienen la fila cargada (listados).
 */
function permissionFor(
  user: TemplateAccessUser,
  row: { ownerId: string; isShared: boolean; isActive: boolean },
  sharePermission?: Permission | null,
): Permission {
  if (row.ownerId === user.sub) return 'owner';
  if (sharePermission) {
    // Una compartición explícita de tipo 'owner' no existe: el propietario es
    // quien la tiene. Por seguridad se degrada a editor.
    const granted = sharePermission === 'owner' ? 'editor' : sharePermission;
    return user.role === 'admin' ? 'editor' : granted;
  }
  if (row.isShared && (row.isActive || user.role === 'admin')) {
    return user.role === 'admin' ? 'editor' : 'viewer';
  }
  return 'viewer';
}

/**
 * ¿La plantilla se ha compartido con alguien, explícitamente o con todos?
 *
 * El administrador mantiene sobre las plantillas compartidas los mismos
 * poderes que tenía antes (editarlas y activarlas), así que necesita saber si
 * la plantilla es de dominio compartido o privada.
 */
async function isSharedWithOthers(templateId: string, isSharedGlobally: boolean): Promise<boolean> {
  if (isSharedGlobally) return true;
  const [row] = await db
    .select({ templateId: templateShares.templateId })
    .from(templateShares)
    .where(eq(templateShares.templateId, templateId))
    .limit(1);
  return Boolean(row);
}

interface TemplateNumbering {
  enabled: boolean;
  prefix: string | null;
  /** Serie de la plantilla: es la dueña de su enumeración. */
  seriesId: string | null;
  /** El prefijo lo asignó el servidor, no el usuario. */
  auto: boolean;
}

/**
 * Resuelve la serie de numeración de una plantilla.
 *
 * Cada plantilla tiene su propia serie: su contador no se comparte con nadie
 * más, aunque otra plantilla use el mismo prefijo. Si el usuario deja el
 * prefijo vacío, el servidor le asigna un código corto único.
 */
async function resolveTemplateNumbering(options: {
  userId: string;
  role: 'admin' | 'member';
  docType: DocType;
  templateId: string;
  input?: z.infer<typeof numberingInputSchema>;
  current?: {
    numberingEnabled: boolean;
    numberingPrefix: string | null;
    numberingPrefixAuto: boolean;
    numberingSeriesId: string | null;
  } | null;
}): Promise<TemplateNumbering> {
  const resolved = await resolveTemplateNumberingConfig({
    templateId: options.templateId,
    docType: options.docType,
    user: { sub: options.userId, role: options.role },
    input: options.input,
    current: options.current,
  });

  return {
    enabled: resolved.enabled,
    prefix: resolved.prefix,
    seriesId: resolved.series?.id ?? null,
    auto: resolved.auto,
  };
}

/** Número de ejemplo para la vista previa de una plantilla guardada. */
async function templateSampleNumber(template: {
  numberingEnabled: boolean;
  numberingPrefix: string | null;
  numberingSeriesId: string | null;
  docType: DocType;
}): Promise<string> {
  if (!template.numberingEnabled) return '';
  if (template.numberingSeriesId) {
    const state = await getNumberingState(template.numberingSeriesId);
    if (state) return state.nextNumber;
  }

  const prefix = template.numberingPrefix ?? DOC_TYPE_PREFIX[template.docType];
  if (prefix === null || prefix === undefined) return '';

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
    // Compartidas con este usuario por nombre (editor o lector).
    const sharedWithMe = inArray(
      templates.id,
      db
        .select({ templateId: templateShares.templateId })
        .from(templateShares)
        .where(eq(templateShares.userId, user.sub)),
    );
    // Compartidas con todo el mundo. Los administradores ven las inactivas
    // para poder mantenerlas; el resto, solo las activas. Las privadas ajenas
    // nunca se listan.
    const sharedGlobal = and(
      eq(templates.isShared, true),
      user.role === 'admin' ? undefined : eq(templates.isActive, true),
      sql`${templates.ownerId} <> ${user.sub}`,
    );

    const visibility =
      query.scope === 'mine'
        ? own
        : query.scope === 'shared'
          ? or(sharedWithMe, sharedGlobal)
          : or(own, sharedWithMe, sharedGlobal);

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
        ownerName: users.name,
        schema: templates.schema,
        isMine: sql<boolean>`${templates.ownerId} = ${user.sub}`,
        /** Permiso de este usuario: viene del acceso explícito, si lo hay. */
        sharePermission: templateShares.permission,
        /** Numeración de la plantilla: prefijo propio o código automático. */
        numberingEnabled: templates.numberingEnabled,
        numberingSeriesId: templates.numberingSeriesId,
        numberingPrefix: templates.numberingPrefix,
        numberingPrefixAuto: templates.numberingPrefixAuto,
        updatedAt: templates.updatedAt,
        deletedAt: templates.deletedAt,
      })
      .from(templates)
      .leftJoin(designs, and(eq(designs.id, templates.designId), isNull(designs.deletedAt)))
      .leftJoin(users, eq(users.id, templates.ownerId))
      .leftJoin(
        templateShares,
        and(eq(templateShares.templateId, templates.id), eq(templateShares.userId, user.sub)),
      )
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
          /** Permiso efectivo del usuario sobre esta plantilla. */
          permission: permissionFor(user, item, item.sharePermission),
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

    const { template: row } = await getTemplateAccess(user.sub, id, user.role);

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

    const { template: row, permission } = await getTemplateAccess(user.sub, id, user.role);

    // El diseño efectivo es el que está en uso en la cuenta de la plantilla.
    const resolved = await resolveTemplateDesign(row.ownerId, row.designId);

    // Los accesos son datos del propietario: solo él (o un administrador)
    // necesita ver quién puede mejorar la plantilla.
    const shares =
      permission === 'owner' || user.role === 'admin'
        ? await db
            .select({
              userId: templateShares.userId,
              permission: templateShares.permission,
              name: users.name,
              email: users.email,
            })
            .from(templateShares)
            .innerJoin(users, eq(users.id, templateShares.userId))
            .where(eq(templateShares.templateId, id))
        : [];

    const [owner] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, row.ownerId))
      .limit(1);

    return {
      template: row,
      /** Permiso efectivo del usuario: 'owner' | 'editor' | 'viewer'. */
      permission,
      /** Nombre del propietario de la plantilla. */
      ownerName: owner?.name ?? null,
      /** Diseño que se aplica ahora (el que está en uso). */
      design: resolved.design ?? null,
      effectiveDesignId: resolved.design?.id ?? null,
      effectiveDesignName: resolved.design?.name ?? null,
      chrome: resolveChrome({ template: row, design: resolved.tokens }),
      inheritedChrome: resolveChrome({ template: null, design: resolved.tokens }),
      // Número que tendría un documento creado con esta plantilla. Es solo una
      // lectura: no reserva el correlativo.
      numberingPreview: await previewDocumentNumber({
        docType: row.docType,
        template: templateNumberingFrom(row),
      }),
      shares,
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

    // El identificador se genera aquí para poder derivar de él el prefijo
    // automático cuando la plantilla no lleva prefijo propio.
    const templateId = randomUUID();

    const numbering = await resolveTemplateNumbering({
      userId: user.sub,
      role: user.role,
      docType: body.docType,
      templateId,
      input: body.numbering,
    });

    const [created] = await db
      .insert(templates)
      .values({
        id: templateId,
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
        numberingSeriesId: numbering.seriesId,
        numberingPrefix: numbering.prefix,
        numberingPrefixAuto: numbering.auto,
      })
      .returning();

    if (!created) throw internal('TEMPLATE_CREATE_FAILED', 'No se pudo crear la plantilla');

    await logActivity(user.sub, 'template', created.id, 'created', { name: created.name });
    return reply.status(201).send({ template: created });
  });

  /** Activa o desactiva una plantilla sin crear una versión nueva. */
  app.patch('/:id/status', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = z.object({ isActive: z.boolean() }).parse(request.body);

    const { template: row, permission } = await getTemplateAccess(user.sub, id, user.role);
    const canToggle =
      permission === 'owner' ||
      (user.role === 'admin' && (await isSharedWithOthers(id, row.isShared)));
    if (!canToggle) {
      throw forbidden('Solo el propietario puede cambiar el estado de esta plantilla');
    }

    const [updated] = await db
      .update(templates)
      .set({ isActive: body.isActive, updatedAt: new Date() })
      .where(eq(templates.id, id))
      .returning();

    if (!updated) throw internal('TEMPLATE_STATUS_FAILED', 'No se pudo actualizar el estado de la plantilla');
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

    const { template: row, permission } = await getTemplateAccess(user.sub, id, user.role);
    if (permission !== 'owner' && permission !== 'editor') {
      throw forbidden('Necesitas permiso de edición sobre esta plantilla');
    }

    // Los ajustes de propiedad (visibilidad, numeración, tipo, diseño) son del
    // propietario: quien solo puede mejorar la plantilla no los cambia. El
    // administrador mantiene esos poderes sobre las plantillas compartidas.
    const ownsSettings =
      permission === 'owner' ||
      (user.role === 'admin' && (await isSharedWithOthers(id, row.isShared)));
    if (!ownsSettings) {
      const attempted = [
        body.isShared !== undefined ? 'la visibilidad' : null,
        body.numbering !== undefined ? 'la numeración' : null,
        body.docType !== undefined ? 'el tipo de documento' : null,
        body.designId !== undefined ? 'el diseño' : null,
      ].filter((item): item is string => item !== null);
      if (attempted.length > 0) {
        throw forbidden(
          `Solo el propietario puede cambiar ${attempted.join(', ')} de la plantilla`,
        );
      }
    }

    if (body.expectedVersion !== undefined && body.expectedVersion !== row.version) {
      throw new AppError(
        409,
        'VERSION_CONFLICT',
        'La plantilla cambió en otra sesión. Recarga para ver la versión más reciente.',
      );
    }

    const nextVersion = row.version + 1;
    const effectiveDocType = body.docType ?? row.docType;
    // Quien no gobierna los ajustes de propiedad conserva la numeración tal
    // como está: no se recalcula ni se toca la serie.
    const numbering = ownsSettings
      ? await resolveTemplateNumbering({
          userId: user.sub,
          role: user.role,
          docType: effectiveDocType,
          templateId: id,
          input: body.numbering,
          current: {
            numberingEnabled: row.numberingEnabled,
            numberingPrefix: row.numberingPrefix,
            numberingPrefixAuto: row.numberingPrefixAuto,
            numberingSeriesId: row.numberingSeriesId,
          },
        })
      : {
          enabled: row.numberingEnabled,
          prefix: row.numberingPrefix,
          seriesId: row.numberingSeriesId,
          auto: row.numberingPrefixAuto,
        };
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
        numberingSeriesId: numbering.seriesId,
        numberingPrefix: numbering.prefix,
        numberingPrefixAuto: numbering.auto,
        version: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(templates.id, id))
      .returning();

    if (!updated) throw internal('TEMPLATE_UPDATE_FAILED', 'No se pudo actualizar la plantilla');

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
      note: body.note ?? (permission === 'owner' ? 'Edición manual' : 'Mejora de un colaborador'),
      createdBy: user.sub,
    });

    await logActivity(user.sub, 'template', id, 'updated', {
      version: nextVersion,
      permission,
    });
    return { template: updated };
  });

  /** Duplica una plantilla (propia o compartida) en la cuenta del usuario. */
  app.post('/:id/clone', async (request, reply) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = z.object({ name: z.string().trim().min(1).max(160).optional() }).parse(request.body ?? {});

    const { template: row } = await getTemplateAccess(user.sub, id, user.role);

    const design = await visibleDesign(user.sub, row.designId);

    // La copia es una plantilla nueva: recibe su propia serie y, con ella,
    // su propia enumeración. Puede repetir el prefijo del original, porque
    // el prefijo es solo la etiqueta del número.
    const cloneId = randomUUID();
    const numbering = await resolveTemplateNumbering({
      userId: user.sub,
      role: user.role,
      docType: row.docType,
      templateId: cloneId,
      input: {
        enabled: row.numberingEnabled,
        prefix: row.numberingPrefix,
      },
    });

    const [created] = await db
      .insert(templates)
      .values({
        id: cloneId,
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
        numberingEnabled: numbering.enabled,
        numberingSeriesId: numbering.seriesId,
        numberingPrefix: numbering.prefix,
        numberingPrefixAuto: numbering.auto,
      })
      .returning();

    if (!created) throw internal('TEMPLATE_CLONE_FAILED', 'No se pudo duplicar la plantilla');
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

    // La plantilla conserva su serie y su enumeración: restaurar no reinicia
    // sus números ni los mezcla con los de otra plantilla.
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

    await getTemplateAccess(user.sub, id, user.role);

    const items = await db
      .select({
        id: templateVersions.id,
        version: templateVersions.version,
        note: templateVersions.note,
        createdAt: templateVersions.createdAt,
        createdBy: templateVersions.createdBy,
        /** Quién hizo el cambio: la mejora de un colaborador queda firmada. */
        authorName: users.name,
      })
      .from(templateVersions)
      .leftJoin(users, eq(users.id, templateVersions.createdBy))
      .where(eq(templateVersions.templateId, id))
      .orderBy(desc(templateVersions.version))
      .limit(100);

    return { items };
  });

  /** Restaura una versión anterior de la plantilla como una versión nueva. */
  app.post('/:id/versions/:version/restore', async (request) => {
    const user = await authenticate(request);
    const { id, version } = z.object({ id: z.uuid(), version: z.coerce.number().int().positive() })
      .parse(request.params);

    const { template: row } = await getTemplateAccess(user.sub, id, user.role);

    const [snapshot] = await db
      .select()
      .from(templateVersions)
      .where(and(eq(templateVersions.templateId, id), eq(templateVersions.version, version)))
      .limit(1);
    if (!snapshot) throw notFound('La versión no existe');

    const nextVersion = row.version + 1;
    const [updated] = await db
      .update(templates)
      .set({
        name: snapshot.snapshot.name,
        description: snapshot.snapshot.description,
        docType: snapshot.snapshot.docType,
        schema: snapshot.snapshot.schema,
        body: snapshot.snapshot.body,
        header: snapshot.snapshot.header,
        footer: snapshot.snapshot.footer,
        aiInstructions: snapshot.snapshot.aiInstructions,
        version: nextVersion,
        updatedAt: new Date(),
      })
      .where(eq(templates.id, id))
      .returning();

    if (!updated) throw internal('TEMPLATE_VERSION_RESTORE_FAILED', 'No se pudo restaurar la versión');

    // La restauración no borra la historia: se guarda como una versión nueva.
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
        tokens: snapshot.snapshot.tokens,
      },
      note: `Restaurada la versión ${version}`,
      createdBy: user.sub,
    });

    await logActivity(user.sub, 'template', id, 'restored', { version: nextVersion, from: version });
    return { template: updated };
  });

  /** Lista las personas con acceso explícito a la plantilla. */
  app.get('/:id/shares', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);

    const { permission } = await getTemplateAccess(user.sub, id, user.role);
    if (permission !== 'owner' && user.role !== 'admin') {
      throw forbidden('Solo el propietario puede ver los accesos de esta plantilla');
    }

    const items = await db
      .select({
        userId: templateShares.userId,
        permission: templateShares.permission,
        name: users.name,
        email: users.email,
      })
      .from(templateShares)
      .innerJoin(users, eq(users.id, templateShares.userId))
      .where(eq(templateShares.templateId, id));

    return { items };
  });

  /** Comparte la plantilla con una persona (editor o lector). */
  app.post('/:id/shares', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = z
      .object({
        userId: z.uuid(),
        permission: z.enum(['editor', 'viewer']).default('editor'),
      })
      .parse(request.body);

    const { template: row, permission } = await getTemplateAccess(user.sub, id, user.role);
    if (permission !== 'owner') {
      throw forbidden('Solo el propietario puede compartir esta plantilla');
    }

    const [target] = await db.select().from(users).where(eq(users.id, body.userId)).limit(1);
    if (!target) throw notFound('Usuario no encontrado');
    if (target.id === user.sub) throw badRequest('No puedes compartir contigo mismo');
    if (!target.isActive) throw badRequest('El usuario está inactivo');

    await db
      .insert(templateShares)
      .values({ templateId: id, userId: body.userId, permission: body.permission })
      .onConflictDoUpdate({
        target: [templateShares.templateId, templateShares.userId],
        set: { permission: body.permission },
      });

    await logActivity(user.sub, 'template', id, 'shared', {
      userId: body.userId,
      permission: body.permission,
      name: row.name,
    });

    return { ok: true };
  });

  /** Retira el acceso de una persona. */
  app.delete('/:id/shares/:userId', async (request) => {
    const user = await authenticate(request);
    const params = z.object({ id: z.uuid(), userId: z.uuid() }).parse(request.params);

    const { permission } = await getTemplateAccess(user.sub, params.id, user.role);
    if (permission !== 'owner') {
      throw forbidden('Solo el propietario puede compartir esta plantilla');
    }

    await db
      .delete(templateShares)
      .where(
        and(eq(templateShares.templateId, params.id), eq(templateShares.userId, params.userId)),
      );

    await logActivity(user.sub, 'template', params.id, 'unshared', {
      userId: params.userId,
    });

    return { ok: true };
  });
}
