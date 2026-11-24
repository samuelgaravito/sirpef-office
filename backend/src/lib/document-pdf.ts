import { and, eq, isNull } from 'drizzle-orm';

import type { ChromeConfig, DesignTokens, ResolvedChrome } from '@sirpefoffice/shared';
import {
  ANNULED_WATERMARK,
  DEFAULT_DESIGN_TOKENS,
  resolveChrome,
  withDocumentNumber,
} from '@sirpefoffice/shared';

import { db } from '../db/index.js';
import { designs, templates, type DocumentRow } from '../db/schema.js';
import { pendingNumberForDocument } from './counter.js';
import { renderPdf } from '../export/pdf.js';

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

export async function resolveDocumentChrome(document: ChromeSourceRow): Promise<{
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

/** Renderiza el PDF actual de un documento con su diseño y cabecera resueltos. */
export async function renderDocumentPdf(document: DocumentRow): Promise<Buffer> {
  const { design, chrome } = await resolveDocumentChrome(document);
  const pendingNumber = await pendingNumberForDocument(document);

  return renderPdf({
    content: document.content,
    design,
    chrome,
    values: withDocumentNumber(document.data, document.docNumber, pendingNumber),
    title: document.title,
    includeLetterhead: true,
    watermark: document.status === 'cancelled' ? ANNULED_WATERMARK : null,
  });
}
