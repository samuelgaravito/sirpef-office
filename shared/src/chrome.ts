/**
 * Resolución de cabecera y pie de página.
 *
 * Orden de herencia: documento → plantilla → diseño → valores por defecto.
 * Es código puro para poder usarlo tanto en el servidor (exportación) como en
 * la web (bandas del editor y cambios de diseño sin recargar).
 */

import { DEFAULT_DESIGN_TOKENS } from './defaults.js';
import type {
  BandImage,
  ChromeConfig,
  ChromeHolder,
  ChromeKind,
  ChromeSource,
  DesignTokens,
  JSONContent,
  ResolvedChrome,
} from './types.js';

/** Altura de banda por defecto, en milímetros. */
export const DEFAULT_CHROME_HEIGHTS_MM: Record<ChromeKind, number> = {
  header: 18,
  footer: 16,
};

const MIN_HEIGHT_MM = 5;
const MAX_HEIGHT_MM = 80;
export const MIN_CHROME_WIDTH_PERCENT = 20;
export const MAX_CHROME_WIDTH_PERCENT = 100;
export const DEFAULT_CHROME_WIDTH_PERCENT = 100;

type ChromeAlign = 'left' | 'center' | 'right';

/** Documento TipTap vacío (siempre una instancia nueva). */
export function emptyDoc(): JSONContent {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

/** Cabecera o pie vacío y desactivado. */
export function emptyChrome(kind: ChromeKind): ChromeConfig {
  return {
    enabled: false,
    content: emptyDoc(),
    heightMm: DEFAULT_CHROME_HEIGHTS_MM[kind],
    widthPercent: DEFAULT_CHROME_WIDTH_PERCENT,
    images: [],
  };
}

function clampHeight(value: unknown, kind: ChromeKind): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_CHROME_HEIGHTS_MM[kind];
  return Math.min(MAX_HEIGHT_MM, Math.max(MIN_HEIGHT_MM, Math.round(number * 10) / 10));
}

/** Normaliza el ancho de banda como porcentaje del ancho de página. */
export function clampChromeWidth(
  value: unknown,
  maxPercent = MAX_CHROME_WIDTH_PERCENT,
): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return DEFAULT_CHROME_WIDTH_PERCENT;
  return Math.min(
    Math.min(MAX_CHROME_WIDTH_PERCENT, Math.max(1, maxPercent)),
    Math.max(MIN_CHROME_WIDTH_PERCENT, Math.round(number)),
  );
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** Normaliza las imágenes de banda guardadas en JSON (datos antiguos incluidos). */
export function normalizeBandImages(images: BandImage[] | null | undefined): BandImage[] {
  if (!Array.isArray(images)) return [];
  return images
    .map((image, index) => {
      const widthMm = Math.min(500, Math.max(1, finiteNumber(image.widthMm, 30)));
      const heightMm = Math.min(500, Math.max(1, finiteNumber(image.heightMm, 20)));
      return {
        id: String(image.id || `band-image-${index + 1}`).slice(0, 120),
        src: String(image.src ?? ''),
        xMm: Math.max(0, finiteNumber(image.xMm, 0)),
        yMm: Math.max(0, finiteNumber(image.yMm, 0)),
        widthMm,
        heightMm,
        fit: image.fit === 'fill' ? ('fill' as const) : ('contain' as const),
        ...(Number(image.naturalWidth) > 0
          ? { naturalWidth: Math.round(Number(image.naturalWidth)) }
          : {}),
        ...(Number(image.naturalHeight) > 0
          ? { naturalHeight: Math.round(Number(image.naturalHeight)) }
          : {}),
        opacity: Math.min(1, Math.max(0, finiteNumber(image.opacity, 1))),
        zIndex: Math.round(finiteNumber(image.zIndex, 1)),
      };
    })
    .filter((image) => image.src.length > 0);
}

/** Normaliza una configuración guardada en la base de datos. */
export function normalizeChrome(config: ChromeConfig | null | undefined, kind: ChromeKind): ChromeConfig {
  if (!config) return emptyChrome(kind);
  return {
    enabled: Boolean(config.enabled),
    content: config.content ?? emptyDoc(),
    heightMm: clampHeight(config.heightMm, kind),
    widthPercent: clampChromeWidth(config.widthPercent),
    images: normalizeBandImages(config.images),
  };
}

function textDoc(text: string, align: ChromeAlign = 'center'): JSONContent {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { textAlign: align },
        content: [{ type: 'text', text }],
      },
    ],
  };
}

/** Aplica la alineación histórica del diseño a los párrafos de la cabecera. */
export function applyChromeAlign(content: JSONContent, align: ChromeAlign = 'left'): JSONContent {
  // Copia por JSON: el contenido puede llegar envuelto en un proxy de Vue.
  const clone = JSON.parse(JSON.stringify(content)) as JSONContent;
  for (const node of clone.content ?? []) {
    if (node.type === 'paragraph') {
      node.attrs = { ...(node.attrs ?? {}), textAlign: align };
    }
  }
  return clone;
}

/**
 * Convierte los tokens del diseño a la nueva estructura de bandas.
 * El diseño conserva su formato anterior para no romper datos existentes.
 */
export function chromeFromDesign(design: DesignTokens | null | undefined): {
  header: ChromeConfig;
  footer: ChromeConfig;
} {
  const tokens = design ?? DEFAULT_DESIGN_TOKENS;

  const header: ChromeConfig = {
    enabled: Boolean(tokens.header?.enabled),
    content: tokens.header?.content
      ? applyChromeAlign(tokens.header.content, tokens.header.align ?? 'left')
      : emptyDoc(),
    heightMm: clampHeight(tokens.header?.heightMm, 'header'),
    widthPercent: clampChromeWidth(tokens.header?.widthPercent),
    images: normalizeBandImages(tokens.header?.images),
  };

  const footerTokens = tokens.footer;
  let footerText = (footerTokens?.content ?? '').trim();
  if (!footerText) {
    if (footerTokens?.showPageNumber && footerTokens.showTotal) {
      footerText = 'Página {page} de {total}';
    } else if (footerTokens?.showPageNumber) {
      footerText = 'Página {page}';
    } else if (footerTokens?.showTotal) {
      footerText = '{total}';
    }
  }

  const footer: ChromeConfig = {
    enabled: Boolean(footerTokens?.enabled),
    content: footerText ? textDoc(footerText, footerTokens?.align ?? 'center') : emptyDoc(),
    heightMm: clampHeight(footerTokens?.heightMm, 'footer'),
    widthPercent: clampChromeWidth(footerTokens?.widthPercent),
    images: normalizeBandImages(footerTokens?.images),
  };

  return { header, footer };
}

/**
 * Copia los tokens para listados sin las imágenes de banda.
 *
 * Las miniaturas de documentos/plantillas cargan el HTML real desde el
 * servidor, así que no necesitan transportar base64 en cada fila. El detalle
 * del diseño sí conserva las imágenes para poder editarlas.
 */
export function designTokensForList(design: DesignTokens | null | undefined): DesignTokens | null {
  if (!design) return null;
  return {
    ...design,
    header: { ...design.header, images: [] },
    footer: { ...design.footer, images: [] },
  };
}

export interface ResolveChromeInput {
  document?: ChromeHolder | null;
  template?: ChromeHolder | null;
  design?: DesignTokens | null;
}

interface PickedChrome {
  config: ChromeConfig;
  source: ChromeSource;
}

function pickChrome(
  kind: ChromeKind,
  input: ResolveChromeInput,
  designChrome: { header: ChromeConfig; footer: ChromeConfig },
): PickedChrome {
  const own = input.document?.[kind];
  if (own) return { config: normalizeChrome(own, kind), source: 'document' };

  const inherited = input.template?.[kind];
  if (inherited) return { config: normalizeChrome(inherited, kind), source: 'template' };

  return { config: designChrome[kind], source: 'design' };
}

/**
 * Resuelve la cabecera y el pie efectivos.
 * Pasar `document: null` devuelve lo heredado (útil para "restablecer").
 */
export function resolveChrome(input: ResolveChromeInput): ResolvedChrome {
  const designChrome = chromeFromDesign(input.design);
  const header = pickChrome('header', input, designChrome);
  const footer = pickChrome('footer', input, designChrome);

  return {
    header: header.config,
    footer: footer.config,
    headerSource: header.source,
    footerSource: footer.source,
  };
}
