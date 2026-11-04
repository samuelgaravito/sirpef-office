import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { ChromeConfig, DesignTokens, ResolvedChrome } from '@sirpefoffice/shared';
import { DEFAULT_DESIGN_TOKENS, resolveChrome, withDocumentNumber } from '@sirpefoffice/shared';

import { db } from '../../db/index.js';
import { designs, documentVersions, documents, templates } from '../../db/schema.js';
import { assertDocument, canExportDocument } from '../../lib/access.js';
import { logActivity } from '../../lib/activity.js';
import { authenticate } from '../../lib/auth-guard.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { renderDocumentHtml } from '../../lib/document-html.js';
import { buildDocumentHtml, interpolateDoc } from '../../lib/render.js';
import { renderDocx } from '../../export/docx.js';
import { renderPdf } from '../../export/pdf.js';

const formatSchema = z.object({ format: z.enum(['pdf', 'docx', 'html']) });

function safeFilename(title: string, docNumber: string | null, extension: string): string {
  const base = (docNumber ? `${docNumber} - ${title}` : title)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9\-_ ]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 120);
  return `${base || 'documento'}.${extension}`;
}

async function resolveDesign(designId: string | null): Promise<DesignTokens> {
  if (!designId) return DEFAULT_DESIGN_TOKENS;
  const [design] = await db
    .select()
    .from(designs)
    .where(and(eq(designs.id, designId), isNull(designs.deletedAt)))
    .limit(1);
  return design?.tokens ?? DEFAULT_DESIGN_TOKENS;
}

interface ChromeSourceRow {
  designId: string | null;
  templateId: string | null;
  header: ChromeConfig | null;
  footer: ChromeConfig | null;
}

/** Carga diseño y plantilla y resuelve las bandas efectivas. */
async function resolveDocumentChrome(document: ChromeSourceRow): Promise<{
  design: DesignTokens;
  chrome: ResolvedChrome;
}> {
  const design = await resolveDesign(document.designId);

  let template: { header: ChromeConfig | null; footer: ChromeConfig | null } | undefined;
  if (document.templateId) {
    [template] = await db
      .select({ header: templates.header, footer: templates.footer })
      .from(templates)
      .where(and(eq(templates.id, document.templateId), isNull(templates.deletedAt)))
      .limit(1);
  }

  return {
    design,
    chrome: resolveChrome({ document, template, design }),
  };
}

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  /** Exporta el documento a PDF, DOCX o HTML. */
  app.get('/:id/export/:format', async (request, reply) => {
    const user = await authenticate(request);
    const params = z.object({ id: z.uuid() }).parse(request.params);
    const { format } = formatSchema.parse(request.params);

    const { document } = await assertDocument(user.sub, params.id, 'viewer');

    // Un memo sellado solo lo exporta el administrador que aprobó el envío,
    // los administradores destinatarios o el remitente si fue autorizado.
    if (!(await canExportDocument(user.sub, user.role, document))) {
      throw forbidden('No tienes permiso para exportar este memo sellado');
    }

    const { design, chrome } = await resolveDocumentChrome(document);

    const base = {
      content: document.content,
      design,
      chrome,
      values: withDocumentNumber(document.data, document.docNumber),
      title: document.title,
    };

    switch (format) {
      case 'html': {
        const html = await renderDocumentHtml({ ...base, includeLetterhead: true });
        await logActivity(user.sub, 'document', params.id, 'export', {
          format,
          version: document.version,
        });
        return reply
          .header('Content-Type', 'text/html; charset=utf-8')
          .header(
            'Content-Disposition',
            `attachment; filename="${safeFilename(document.title, document.docNumber, 'html')}"`,
          )
          .send(html);
      }
      case 'pdf': {
        const buffer = await renderPdf({ ...base, includeLetterhead: true });
        await logActivity(user.sub, 'document', params.id, 'export', {
          format,
          version: document.version,
        });
        return reply
          .header('Content-Type', 'application/pdf')
          .header(
            'Content-Disposition',
            `attachment; filename="${safeFilename(document.title, document.docNumber, 'pdf')}"`,
          )
          .send(buffer);
      }
      case 'docx': {
        const buffer = await renderDocx({
          ...base,
          interpolated: interpolateDoc(document.content, document.data),
        });
        await logActivity(user.sub, 'document', params.id, 'export', {
          format,
          version: document.version,
        });
        return reply
          .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
          .header(
            'Content-Disposition',
            `attachment; filename="${safeFilename(document.title, document.docNumber, 'docx')}"`,
          )
          .send(buffer);
      }
      default:
        throw notFound('Formato no soportado');
    }
  });

  /** HTML en línea para la vista de impresión / previsualización. */
  app.get('/:id/html', async (request, reply) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const { embed } = z
      .object({ embed: z.enum(['0', '1']).optional() })
      .parse(request.query);

    const { document } = await assertDocument(user.sub, id, 'viewer');
    const { design, chrome } = await resolveDocumentChrome(document);

    // Las miniaturas solo muestran la primera hoja: no necesitan paginar todo
    // el documento ni lanzar Chrome para medirlo.
    const html =
      embed === '1'
        ? buildDocumentHtml({
            content: document.content,
            design,
            chrome,
            values: withDocumentNumber(document.data, document.docNumber),
            title: document.title,
            includeLetterhead: true,
            embed: true,
          })
        : await renderDocumentHtml({
            content: document.content,
            design,
            chrome,
            values: withDocumentNumber(document.data, document.docNumber),
            title: document.title,
            includeLetterhead: true,
          });

    return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });

  /** HTML de una versión concreta, para previsualizar el historial. */
  app.get('/:id/versions/:version/html', async (request, reply) => {
    const user = await authenticate(request);
    const params = z
      .object({ id: z.uuid(), version: z.coerce.number().int().positive() })
      .parse(request.params);
    const { embed } = z
      .object({ embed: z.enum(['0', '1']).optional() })
      .parse(request.query);

    const { document } = await assertDocument(user.sub, params.id, 'viewer');
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

    const { design, chrome } = await resolveDocumentChrome({
      designId: document.designId,
      templateId: document.templateId,
      // La instantánea manda: reproduce la cabecera/pie de esa versión.
      header: snapshot.header,
      footer: snapshot.footer,
    });

    const html =
      embed === '1'
        ? buildDocumentHtml({
            content: snapshot.content,
            design,
            chrome,
            values: withDocumentNumber(snapshot.data, document.docNumber),
            title: snapshot.title || document.title,
            includeLetterhead: true,
            embed: true,
          })
        : await renderDocumentHtml({
            content: snapshot.content,
            design,
            chrome,
            values: withDocumentNumber(snapshot.data, document.docNumber),
            title: snapshot.title || document.title,
            includeLetterhead: true,
          });

    return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
  });
}
