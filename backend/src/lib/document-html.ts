import type { RenderOptions } from './render.js';
import { paginateDocument } from './paginate.js';
import { buildPaginatedDocumentHtml } from './render.js';

/**
 * HTML completo con la misma paginación que el editor: mide el documento,
 * reparte los bloques en hojas y repite cabecera/pie en cada una.
 */
export async function renderDocumentHtml(options: RenderOptions): Promise<string> {
  const paginated = await paginateDocument({
    content: options.content,
    design: options.design,
    chrome: options.chrome ?? null,
    values: options.values,
    title: options.title,
    includeLetterhead: options.includeLetterhead !== false,
  });

  return buildPaginatedDocumentHtml({
    ...options,
    preparedContent: paginated.content,
    pageLayout: paginated.layout,
  });
}
