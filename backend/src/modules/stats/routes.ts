import {
  and,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import {
  DOCUMENT_STATUSES,
  DOC_TYPES,
  STATS_DETAIL_KINDS,
  type DocType,
  type DocumentStatus,
  type StatsDetailItem,
  type StatsDetailPage,
  type StatsDocumentFilter,
  type StatsPanel,
  type WorkspaceStats,
} from '@sirpefoffice/shared';

import { db } from '../../db/index.js';
import {
  designs,
  documentMessages,
  documents,
  templates,
  templateShares,
  users,
} from '../../db/schema.js';
import { authenticate } from '../../lib/auth-guard.js';
import { badRequest } from '../../lib/errors.js';
import {
  listDocuments,
  monthWindow,
  STALE_DRAFT_DAYS,
  statsFor,
  visibleDocuments,
} from './query.js';

const DAY_MS = 86_400_000;

const periodSchema = {
  /** Límites ISO ya convertidos desde el día local del navegador. */
  dateFrom: z.iso.datetime().optional(),
  dateTo: z.iso.datetime().optional(),
};

const overviewQuery = z.object(periodSchema);

/** Filtros de documento que comparten el panel y el chat de consulta. */
const documentFilterSchema = {
  scope: z.enum(['mine', 'all']).optional(),
  docType: z.string().max(200).optional(),
  status: z.string().max(400).optional(),
  q: z.string().trim().max(200).optional(),
  dateField: z.enum(['created', 'updated']).optional(),
};

const panelQuery = z.object({
  ...periodSchema,
  ...documentFilterSchema,
  templateId: z.union([z.uuid(), z.literal('none')]).optional(),
});

const detailQuery = z.object({
  ...periodSchema,
  ...documentFilterSchema,
  kind: z.enum(STATS_DETAIL_KINDS),
  /** uuid de la plantilla o `none` para los documentos sin plantilla. */
  templateId: z.union([z.uuid(), z.literal('none')]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
});

/** Lista de tipos separada por comas, descartando valores inventados. */
function parseDocTypes(value: string | undefined): DocType[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is DocType => (DOC_TYPES as readonly string[]).includes(item));
}

/** Lista de estados separada por comas, descartando valores inventados. */
function parseStatuses(value: string | undefined): DocumentStatus[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is DocumentStatus =>
      (DOCUMENT_STATUSES as readonly string[]).includes(item),
    );
}

/** Valida el rango y lo convierte en fechas. */
function periodBounds(query: {
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}): { from: Date | null; to: Date | null } {
  if (query.dateFrom && query.dateTo && new Date(query.dateFrom) > new Date(query.dateTo)) {
    throw badRequest('La fecha inicial no puede ser posterior a la fecha final');
  }
  return {
    from: query.dateFrom ? new Date(query.dateFrom) : null,
    to: query.dateTo ? new Date(query.dateTo) : null,
  };
}

/** Página de la lista de detalle. */
interface DetailPaging {
  page: number;
  pageSize: number;
}

/**
 * Filas de mensajes con su documento para las listas de aprobaciones.
 *
 * `resolved` ordena y fecha por la resolución (aprobado/rechazado); `created`
 * por el envío, que es lo que tiene sentido para la cola de pendientes.
 */
async function messageDetailPage(
  where: SQL | undefined,
  order: 'resolved' | 'created',
  paging: DetailPaging,
): Promise<StatsDetailPage> {
  const approver = alias(users, 'approver');
  const resolvedAt = sql<Date>`coalesce(${documentMessages.approvedAt}, ${documentMessages.updatedAt})`;
  const dateColumn = order === 'resolved' ? resolvedAt : documentMessages.createdAt;

  const rows = await db
    .select({
      documentId: documents.id,
      messageId: documentMessages.id,
      title: documents.title,
      docNumber: documents.docNumber,
      docType: documents.docType,
      status: documents.status,
      ownerName: users.name,
      templateName: templates.name,
      date: dateColumn,
      subject: documentMessages.subject,
      resolvedByName: approver.name,
    })
    .from(documentMessages)
    .innerJoin(documents, eq(documents.id, documentMessages.documentId))
    .innerJoin(users, eq(users.id, documents.ownerId))
    .leftJoin(templates, eq(templates.id, documents.templateId))
    .leftJoin(approver, eq(approver.id, documentMessages.approvedById))
    .where(where)
    .orderBy(desc(dateColumn))
    .limit(paging.pageSize)
    .offset((paging.page - 1) * paging.pageSize);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(documentMessages)
    .where(where);

  const items: StatsDetailItem[] = rows.map((row) => ({
    documentId: row.documentId,
    messageId: row.messageId,
    title: row.title,
    docNumber: row.docNumber,
    docType: row.docType,
    status: row.status,
    ownerName: row.ownerName,
    templateName: row.templateName ?? null,
    date: row.date.toISOString(),
    subject: row.subject,
    resolvedByName: row.resolvedByName ?? null,
  }));

  return {
    items,
    total: Number(countRow?.count ?? 0),
    page: paging.page,
    pageSize: paging.pageSize,
  };
}

export async function statsRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Panel de estadísticas de un conjunto de documentos.
   *
   * Es la misma pieza que alimenta las respuestas del chat de consulta. Acepta
   * los filtros que la IA ya validó (tipo, estado, plantilla, texto, rango) y
   * devuelve cifras, desgloses y tendencia calculados sobre ese conjunto.
   */
  app.get('/panel', async (request): Promise<StatsPanel> => {
    const user = await authenticate(request);
    const query = panelQuery.parse(request.query);

    return statsFor(user.sub, {
      scope: query.scope,
      docTypes: parseDocTypes(query.docType),
      statuses: parseStatuses(query.status),
      templateId: query.templateId,
      text: query.q,
      from: query.dateFrom,
      to: query.dateTo,
      dateField: query.dateField,
    });
  });

  /**
   * Panel estadístico del espacio: propios + compartidos.
   *
   * Usa **el mismo criterio de visibilidad que `GET /documents?scope=all`**.
   * El filtro `dateFrom`/`dateTo` limita por fecha de **creación** de
   * documentos, plantillas y diseños. La bandeja y la salud del espacio son
   * siempre el estado actual, porque una cola de aprobación no tiene sentido
   * histórico.
   */
  app.get('/overview', async (request): Promise<WorkspaceStats> => {
    const user = await authenticate(request);
    const query = overviewQuery.parse(request.query);
    const now = new Date();
    const { from, to } = periodBounds(query);

    // Propios o compartidos, nunca en papelera.
    const visible = visibleDocuments(user.sub);

    /** Documentos visibles creados dentro del periodo. */
    const documentsInPeriod = and(
      visible,
      from ? gte(documents.createdAt, from) : undefined,
      to ? lte(documents.createdAt, to) : undefined,
    );

    /* ── Documentos del periodo ───────────────────────────────────── */

    const [documentsRow] = await db
      .select({
        count: sql<number>`count(*)::int`,
        drafts: sql<number>`(count(*) filter (where ${documents.status} = 'draft'))::int`,
        official: sql<number>`(count(*) filter (where ${documents.status} in ('sent', 'approved', 'final', 'archived')))::int`,
      })
      .from(documents)
      .where(documentsInPeriod);

    const documentsTotal = Number(documentsRow?.count ?? 0);
    const drafts = Number(documentsRow?.drafts ?? 0);
    const official = Number(documentsRow?.official ?? 0);

    const templateRows = await db
      .select({
        id: documents.templateId,
        name: templates.name,
        isShared: templates.isShared,
        count: sql<number>`count(*)::int`,
      })
      .from(documents)
      .leftJoin(templates, eq(templates.id, documents.templateId))
      .where(documentsInPeriod)
      .groupBy(documents.templateId, templates.name, templates.isShared)
      .orderBy(desc(sql`count(*)`))
      .limit(5);

    const topTemplates = templateRows.map((row) => ({
      id: row.id,
      name: row.name ?? 'Sin plantilla',
      count: Number(row.count),
      isShared: Boolean(row.isShared),
    }));

    /* ── Papelera y borradores abandonados (estado actual) ─────────── */

    const [trashedRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(documents)
      .where(and(isNotNull(documents.deletedAt), eq(documents.ownerId, user.sub)));

    const staleBefore = new Date(now.getTime() - STALE_DRAFT_DAYS * DAY_MS);
    const [staleRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(documents)
      .where(and(visible, eq(documents.status, 'draft'), lt(documents.updatedAt, staleBefore)));

    /* ── Plantillas y diseños del periodo ─────────────────────────── */
    // Mismo criterio que el inicio: plantillas activas propias, compartidas
    // conmigo o abiertas a todos; diseños propios o compartidos.
    const [templatesRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(templates)
      .where(
        and(
          isNull(templates.deletedAt),
          eq(templates.isActive, true),
          from ? gte(templates.createdAt, from) : undefined,
          to ? lte(templates.createdAt, to) : undefined,
          or(
            eq(templates.ownerId, user.sub),
            inArray(
              templates.id,
              db
                .select({ templateId: templateShares.templateId })
                .from(templateShares)
                .where(eq(templateShares.userId, user.sub)),
            ),
            and(eq(templates.isShared, true), sql`${templates.ownerId} <> ${user.sub}`),
          ),
        ),
      );

    const [designsRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(designs)
      .where(
        and(
          isNull(designs.deletedAt),
          from ? gte(designs.createdAt, from) : undefined,
          to ? lte(designs.createdAt, to) : undefined,
          or(eq(designs.ownerId, user.sub), eq(designs.isShared, true)),
        ),
      );

    const templateTotal = Number(templatesRow?.count ?? 0);
    const designTotal = Number(designsRow?.count ?? 0);

    /* ── Tendencia del periodo ────────────────────────────────────── */

    const { months, start: windowStart } = monthWindow(from, to, now);

    const createdRows = await db
      .select({
        month: sql<string>`to_char(date_trunc('month', ${documents.createdAt}), 'YYYY-MM')`,
        count: sql<number>`count(*)::int`,
      })
      .from(documents)
      .where(and(documentsInPeriod, gte(documents.createdAt, windowStart)))
      .groupBy(sql`date_trunc('month', ${documents.createdAt})`);

    const approvedRows = await db
      .select({
        month: sql<string>`to_char(date_trunc('month', ${documentMessages.approvedAt}), 'YYYY-MM')`,
        count: sql<number>`count(*)::int`,
      })
      .from(documentMessages)
      .innerJoin(documents, eq(documents.id, documentMessages.documentId))
      .where(
        and(
          eq(documentMessages.status, 'sent'),
          isNotNull(documentMessages.approvedAt),
          gte(documentMessages.approvedAt, windowStart),
          to ? lte(documentMessages.approvedAt, to) : undefined,
          visible,
        ),
      )
      .groupBy(sql`date_trunc('month', ${documentMessages.approvedAt})`);

    const createdByMonth = new Map(createdRows.map((row) => [row.month, Number(row.count)]));
    const approvedByMonth = new Map(approvedRows.map((row) => [row.month, Number(row.count)]));

    const monthly = months.map((month) => ({
      month,
      created: createdByMonth.get(month) ?? 0,
      approved: approvedByMonth.get(month) ?? 0,
    }));

    /* ── Aprobaciones del periodo ──────────────────────────────────── */
    // El tiempo medio se mide sobre los envíos del propio usuario; así la
    // cifra significa lo mismo para un miembro y para un administrador.
    const [approvalRow] = await db
      .select({
        approved: sql<number>`(count(*) filter (where ${documentMessages.status} = 'sent'))::int`,
        rejected: sql<number>`(count(*) filter (where ${documentMessages.status} = 'rejected'))::int`,
        avgHours: sql<number | null>`(avg(extract(epoch from (${documentMessages.approvedAt} - ${documentMessages.createdAt})) / 3600) filter (where ${documentMessages.status} = 'sent' and ${documentMessages.approvedAt} is not null))::float8`,
      })
      .from(documentMessages)
      .where(
        and(
          eq(documentMessages.senderId, user.sub),
          inArray(documentMessages.status, ['sent', 'rejected']),
          from ? gte(documentMessages.updatedAt, from) : undefined,
          to ? lte(documentMessages.updatedAt, to) : undefined,
        ),
      );

    const [pendingRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(documentMessages)
      .where(
        user.role === 'admin'
          ? eq(documentMessages.status, 'pending_approval')
          : and(
              eq(documentMessages.status, 'pending_approval'),
              eq(documentMessages.senderId, user.sub),
            ),
      );

    const approved = Number(approvalRow?.approved ?? 0);
    const rejected = Number(approvalRow?.rejected ?? 0);
    const results = approved + rejected;

    return {
      generatedAt: now.toISOString(),
      totals: {
        elements: documentsTotal + templateTotal + designTotal,
        documents: documentsTotal,
        drafts,
        official,
        trashed: Number(trashedRow?.count ?? 0),
        templates: templateTotal,
        designs: designTotal,
      },
      topTemplates,
      monthly,
      approvals: {
        pending: Number(pendingRow?.count ?? 0),
        approved,
        rejected,
        approvalRate: results > 0 ? approved / results : null,
        avgHours: approvalRow?.avgHours ?? null,
      },
      health: {
        staleDrafts: Number(staleRow?.count ?? 0),
      },
    };
  });

  /**
   * Documentos que hay detrás de un valor del panel.
   *
   * Cada `kind` replica el criterio exacto de su contador: así el total de la
   * lista coincide con el número que se pulsó y no aparecen documentos que el
   * resumen no estaba contando.
   */
  app.get('/detail', async (request): Promise<StatsDetailPage> => {
    const user = await authenticate(request);
    const query = detailQuery.parse(request.query);
    const { from, to } = periodBounds(query);
    const paging: DetailPaging = { page: query.page, pageSize: query.pageSize };

    const documentFilter: StatsDocumentFilter = {
      scope: query.scope,
      docTypes: parseDocTypes(query.docType),
      statuses: parseStatuses(query.status),
      text: query.q,
      from: query.dateFrom,
      to: query.dateTo,
      dateField: query.dateField ?? 'created',
    };

    if (query.kind === 'template') {
      if (!query.templateId) {
        throw badRequest('Falta la plantilla de la que se quiere ver el detalle');
      }
      return listDocuments(
        user.sub,
        { ...documentFilter, templateId: query.templateId },
        paging,
      );
    }

    if (query.kind === 'documents') {
      return listDocuments(user.sub, documentFilter, paging);
    }

    if (query.kind === 'drafts') {
      return listDocuments(user.sub, { ...documentFilter, statuses: ['draft'] }, paging);
    }

    if (query.kind === 'official') {
      return listDocuments(
        user.sub,
        { ...documentFilter, statuses: ['sent', 'approved', 'final', 'archived'] },
        paging,
      );
    }

    if (query.kind === 'trashed') {
      return listDocuments(user.sub, { ...documentFilter, trashed: true }, paging);
    }

    if (query.kind === 'stale') {
      return listDocuments(user.sub, { ...documentFilter, stale: true }, paging);
    }

    if (query.kind === 'pending') {
      return messageDetailPage(
        and(
          eq(documentMessages.status, 'pending_approval'),
          user.role === 'admin' ? undefined : eq(documentMessages.senderId, user.sub),
        ),
        'created',
        paging,
      );
    }

    // approved | rejected: mis envíos resueltos dentro del periodo.
    // En la bandeja un envío aprobado termina con estado `sent`.
    const messageStatus = query.kind === 'approved' ? 'sent' : 'rejected';
    return messageDetailPage(
      and(
        eq(documentMessages.senderId, user.sub),
        eq(documentMessages.status, messageStatus),
        from ? gte(documentMessages.updatedAt, from) : undefined,
        to ? lte(documentMessages.updatedAt, to) : undefined,
      ),
      'resolved',
      paging,
    );
  });
}
