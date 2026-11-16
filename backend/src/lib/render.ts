import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import type {
  ChromeConfig,
  DesignTokens,
  DocumentPageLayout,
  JSONContent,
  ResolvedChrome,
  VariableDef,
  VariableValues,
} from '@sirpefoffice/shared';
import {
  clampChromeWidth,
  editorExtensions,
  PAGE_SIZES_CM,
  withEmptyParagraphHeights,
} from '@sirpefoffice/shared';
import { renderToHTMLString } from '@tiptap/static-renderer';

/* ────────────────────────── Interpolación ─────────────────────────── */

const PLACEHOLDER = /\{\{\s*([\w.[\]]+)\s*\}\}/g;
const TEMPLATE_ROW = /\{\{\s*([\w-]+)\.0\.([\w.[\]]+)\s*\}\}/;

function getPath(values: VariableValues, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = values;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(part);
      current = Number.isInteger(index) ? current[index] : undefined;
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

export function formatValue(value: unknown, type?: string): string {
  if (value === null || value === undefined) return '';
  if (type === 'money') {
    const n = Number(value);
    if (!Number.isFinite(n)) return String(value);
    return n.toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  if (type === 'date' && typeof value === 'string') {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleDateString('es-PE', { day: '2-digit', month: 'long', year: 'numeric' });
    }
  }
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

/** Espacio duro: el HTML no lo colapsa y el texto conserva la alineación. */
const NBSP = '\u00A0';

/**
 * Conserva los espacios que el usuario escribió en un campo.
 *
 * HTML colapsa los espacios múltiples y las sangrías. Para que una observación
 * con columnas alineadas se vea igual en el editor, la vista previa, el PDF y
 * el DOCX, se convierten en espacios duros solo los que importan: las
 * sangrías de cada línea y las secuencias de dos o más espacios. Un espacio
 * normal entre palabras sigue siendo normal para que el texto pueda partirse.
 */
export function preserveSpacing(value: string): string {
  return value
    .replace(/\t/g, NBSP.repeat(4))
    .replace(/^ +/gm, (spaces) => NBSP.repeat(spaces.length))
    .replace(/ {2,}/g, (spaces) => NBSP.repeat(spaces.length));
}

export function interpolateText(text: string, values: VariableValues): string {
  return text.replace(PLACEHOLDER, (_match, path: string) => {
    const value = getPath(values, path);
    return value === undefined ? '' : preserveSpacing(formatValue(value));
  });
}

/**
 * Convierte los saltos de línea de un valor en nodos `hardBreak`.
 *
 * Un `\n` dentro de un nodo de texto no produce un salto en HTML ni en DOCX:
 * el navegador lo colapsa y el exportador de Word solo entiende `hardBreak`.
 * Al expandirlo aquí, la vista previa, el PDF, el HTML y el DOCX coinciden.
 */
function withHardBreaks(node: JSONContent): JSONContent {
  if (!node.content) return node;

  const content: JSONContent[] = [];
  for (const child of node.content) {
    if (child.type === 'text' && child.text?.includes('\n')) {
      child.text.split('\n').forEach((part, index) => {
        if (index > 0) content.push({ type: 'hardBreak' });
        if (part) content.push({ ...child, text: part });
      });
      continue;
    }
    content.push(child.type === 'text' ? child : withHardBreaks(child));
  }

  node.content = content;
  return node;
}

/** Clona una fila de tabla sustituyendo el índice 0 por el de cada elemento. */
function expandRow(row: JSONContent, collection: string, index: number): JSONContent {
  const clone = structuredClone(row);
  const walk = (node: JSONContent): void => {
    if (node.text) {
      node.text = node.text.replace(
        new RegExp(`\\{\\{\\s*${collection}\\.0\\.([\\w.[\\]]+)\\s*\\}\\}`, 'g'),
        (_m, field: string) => `{{${collection}.${index}.${field}}}`,
      );
    }
    node.content?.forEach(walk);
  };
  walk(clone);
  return clone;
}

/** Detecta si una fila es plantilla repetible y devuelve la colección. */
function repeatingCollection(row: JSONContent): string | null {
  let found: string | null = null;
  const walk = (node: JSONContent): void => {
    if (found) return;
    if (node.text) {
      const match = node.text.match(TEMPLATE_ROW);
      if (match?.[1]) found = match[1];
    }
    node.content?.forEach(walk);
  };
  walk(row);
  return found;
}

/** Interpola las variables sobre un árbol TipTap y expande filas repetibles. */
export function interpolateDoc(content: JSONContent, values: VariableValues): JSONContent {
  const clone = structuredClone(content);

  const walk = (node: JSONContent): JSONContent => {
    if (node.type === 'table' && node.content) {
      const rows: JSONContent[] = [];
      for (const row of node.content) {
        const collection = repeatingCollection(row);
        if (!collection) {
          rows.push(walk(row));
          continue;
        }
        const items = getPath(values, collection);
        const list = Array.isArray(items) ? items : [];
        if (list.length === 0) continue; // sin datos: se omite la fila
        for (let i = 0; i < list.length; i += 1) {
          rows.push(walk(expandRow(row, collection, i)));
        }
      }
      node.content = rows;
      return node;
    }

    // La tabla puede estar anidada en cualquier nivel del documento (doc →
    // párrafos/tablas), así que hay que descender por todos los hijos.
    if (node.content) node.content = node.content.map(walk);
    // Se conservan tanto los espacios del valor como los que el diseño de la
    // plantilla usa para alinear (p. ej. «OBSERVACIONES:    {{texto}}»).
    if (node.text) node.text = preserveSpacing(interpolateText(node.text, values));
    return node;
  };

  return withHardBreaks(walk(clone));
}

/**
 * ProseMirror no admite nodos de texto vacíos. Tras interpolar, muchos
 * marcadores quedan en cadena vacía, así que se eliminan esos nodos y se
 * limpian los contenedores que quedaron sin hijos.
 */
function cleanDoc(node: JSONContent): JSONContent {
  if (node.type === 'text') return node;
  if (node.content) {
    const children: JSONContent[] = [];
    for (const child of node.content) {
      if (child.type === 'text') {
        if (child.text && child.text.length > 0) children.push(child);
        continue;
      }
      children.push(cleanDoc(child));
    }
    if (children.length === 0) {
      delete node.content;
    } else {
      node.content = children;
    }
  }
  return node;
}

/* ───────────────────────── Valores de muestra ─────────────────────── */

function sampleDate(): string {
  return new Date().toLocaleDateString('es-PE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function sampleColumnValue(type: string | undefined, index: number, label: string): string {
  switch (type) {
    case 'number':
      return String(index + 1);
    case 'money':
      return '1,234.50';
    case 'date':
      return sampleDate();
    default:
      return `«${label}»`;
  }
}

/**
 * Genera datos de ejemplo a partir del esquema de una plantilla.
 *
 * Se usa solo para las vistas previas: así el usuario ve el aspecto real de la
 * plantilla sin tener que rellenar el formulario y sin guardar datos falsos.
 */
export function sampleValues(schema: VariableDef[]): VariableValues {
  const values: VariableValues = {};

  for (const variable of schema) {
    if (variable.defaultValue !== undefined && variable.defaultValue !== null) {
      values[variable.key] = variable.defaultValue;
      continue;
    }

    const label = variable.label || variable.key;

    switch (variable.type) {
      case 'date':
        values[variable.key] = sampleDate();
        break;
      case 'number':
        values[variable.key] = '123';
        break;
      case 'money':
        values[variable.key] = '1,234.50';
        break;
      case 'checkbox':
        values[variable.key] = 'Sí';
        break;
      case 'select':
        values[variable.key] =
          variable.options?.[0]?.label ?? variable.options?.[0]?.value ?? `«${label}»`;
        break;
      case 'multiselect':
        values[variable.key] =
          variable.options?.slice(0, 2).map((option) => option.label).join(', ') || `«${label}»`;
        break;
      case 'table':
        values[variable.key] = variable.columns?.length
          ? [0, 1].map((index) =>
              Object.fromEntries(
                variable.columns!.map((column) => [
                  column.key,
                  sampleColumnValue(column.type, index, column.label || column.key),
                ]),
              ),
            )
          : [];
        break;
      case 'image':
        values[variable.key] = '';
        break;
      default:
        values[variable.key] = `«${label}»`;
        break;
    }
  }

  return values;
}

/* ───────────────────────────── Render HTML ────────────────────────── */

const FONT_STACK_FALLBACK = "Arial, Helvetica, sans-serif";
const fontRequire = createRequire(import.meta.url);

const GEORAMA_FACES = [
  { weight: 400, style: 'normal', file: 'georama-latin-400-normal.woff2' },
  { weight: 500, style: 'normal', file: 'georama-latin-500-normal.woff2' },
  { weight: 600, style: 'normal', file: 'georama-latin-600-normal.woff2' },
  { weight: 700, style: 'normal', file: 'georama-latin-700-normal.woff2' },
  { weight: 400, style: 'italic', file: 'georama-latin-400-italic.woff2' },
  { weight: 700, style: 'italic', file: 'georama-latin-700-italic.woff2' },
] as const;

/**
 * Georama se embebe en el HTML/PDF como WOFF2 en base64. Así el documento
 * exportado no depende de Google Fonts ni de que el equipo tenga la fuente.
 */
function buildGeoramaFontCss(): string {
  return GEORAMA_FACES.map(({ weight, style, file }) => {
    try {
      const path = fontRequire.resolve(`@fontsource/georama/files/${file}`);
      const base64 = readFileSync(path).toString('base64');
      return `@font-face { font-family: 'Georama'; font-style: ${style}; font-weight: ${weight}; font-display: swap; src: url(data:font/woff2;base64,${base64}) format('woff2'); }`;
    } catch (error) {
      console.warn(`No se pudo cargar la fuente Georama (${file}).`, error);
      return '';
    }
  })
    .filter(Boolean)
    .join('\n');
}

const GEORAMA_FONT_CSS = buildGeoramaFontCss();

function cssValue(value: string): string {
  // Evita inyección de CSS en los tokens del diseño
  return value.replace(/[;{}<>]/g, '');
}

/** Convierte los tokens de diseño en CSS para la página y el contenido. */
function designCss(design: DesignTokens, forPdf = false, embed = false): string {
  const size = PAGE_SIZES_CM[design.pageFormat] ?? PAGE_SIZES_CM.A4!;
  const width = design.orientation === 'landscape' ? size.height : size.width;
  const height = design.orientation === 'landscape' ? size.width : size.height;
  const m = design.margins;

  return `
  ${GEORAMA_FONT_CSS}
  :root {
    --doc-font: ${cssValue(design.fontFamily || FONT_STACK_FALLBACK)};
    --doc-size: ${design.fontSize}pt;
    --doc-leading: ${design.lineHeight};
    --doc-primary: ${cssValue(design.primaryColor)};
    --doc-accent: ${cssValue(design.accentColor)};
    --doc-text: ${cssValue(design.textColor)};
    --doc-bg: ${cssValue(design.backgroundColor)};
    --doc-th-bg: ${cssValue(design.tableHeadColor)};
    --doc-th-border: ${cssValue(design.tableBorderColor)};
    --page-w: ${width}cm;
    --page-h: ${height}cm;
    --m-top: ${m.top}cm;
    --m-right: ${m.right}cm;
    --m-bottom: ${m.bottom}cm;
    --m-left: ${m.left}cm;
    --scale: ${design.headingScale};
  }

  @page {
    size: ${width}cm ${height}cm;
    /* Las hojas ya llevan sus márgenes internos; Chrome no debe añadir otros. */
    margin: 0;
  }

  * { box-sizing: border-box; }

  html, body { margin: 0; padding: 0; }

  body {
    font-family: var(--doc-font);
    font-size: var(--doc-size);
    line-height: var(--doc-leading);
    color: var(--doc-text);
    background: var(--doc-bg);
    -webkit-font-smoothing: antialiased;
  }

  .doc-page {
    width: var(--page-w);
    min-height: var(--page-h);
    padding: 0;
    margin: 0 auto;
    background: var(--doc-bg);
    position: relative;
    display: grid;
    grid-template-rows: auto 1fr auto;
  }

  .doc-page-top {
    min-height: var(--m-top);
    padding-bottom: 4mm;
    display: flex;
    flex-direction: column;
  }

  .doc-body {
    outline: none;
    position: relative;
    z-index: 0;
    min-height: 0;
    padding: 0 var(--m-right) 0 var(--m-left);
  }

  .doc-page-bottom {
    min-height: var(--m-bottom);
    padding-top: 4mm;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
  }

  .doc-header-band {
    margin-bottom: 8px;
    position: relative;
    font-size: .9em;
    /* Las imágenes de banda son absolutas: si sobresalen de la franja no
       deben aumentar el scroll de la hoja ni generar una página extra. */
    overflow: hidden;
  }
  .doc-footer-band {
    margin-top: 8px;
    position: relative;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    font-size: .9em;
    overflow: hidden;
  }
  .doc-header-band p,
  .doc-footer-band p { margin: 0; }
  .doc-header-band > * + *,
  .doc-footer-band > * + * { margin-top: .65em; }
  .doc-header-band > :first-child,
  .doc-footer-band > :first-child { margin-top: 0; }
  .doc-header-band h1,
  .doc-header-band h2,
  .doc-header-band h3,
  .doc-header-band h4,
  .doc-footer-band h1,
  .doc-footer-band h2,
  .doc-footer-band h3,
  .doc-footer-band h4 {
    color: var(--doc-primary);
    line-height: 1.25;
    font-weight: 700;
  }
  .doc-header-band h1, .doc-footer-band h1 { font-size: 1.9em; margin: 1em 0 .4em; }
  .doc-header-band h2, .doc-footer-band h2 { font-size: 1.45em; margin: 1em 0 .35em; }
  .doc-header-band h3, .doc-footer-band h3 { font-size: 1.2em; margin: .9em 0 .3em; }
  .doc-header-band h4, .doc-footer-band h4 { font-size: 1.05em; margin: .8em 0 .25em; }

  .letterhead { text-align: var(--lh-align, center); margin-bottom: 16px; }
  .letterhead .lh-title { font-size: 1.4em; font-weight: 700; color: var(--doc-primary); letter-spacing: .04em; }
  .letterhead .lh-subtitle { font-size: .9em; color: var(--doc-text); opacity: .8; }
  .letterhead .lh-rule { border: 0; border-top: 2px solid var(--doc-primary); margin: .5em 0 0; }

  .doc-logo { display: block; margin-bottom: 12px; }
  .doc-logo img { max-height: 100%; }

  /* La misma escala y espaciado que usa el editor (.doc-paged-flow .tiptap). */
  .doc-body > * + * { margin-top: .65em; }
  /* La primera hoja no arrastra el margen del primer bloque; las siguientes
     sí, igual que el flujo continuo del editor tras un salto. */
  .doc-page[data-page="1"] .doc-body > :first-child { margin-top: 0; }
  .doc-body h1,
  .doc-body h2,
  .doc-body h3,
  .doc-body h4 { color: var(--doc-primary); }
  /* Los tamaños, pesos e interlineados replican los del editor para que el
     alto de cada bloque coincida bloque a bloque entre la pantalla y el PDF. */
  .doc-body h1 { font-size: calc(var(--doc-size) * 1.9 * var(--scale)); font-weight: 700; line-height: 1.2; margin: 1em 0 .4em; }
  .doc-body h2 { font-size: calc(var(--doc-size) * 1.45 * var(--scale)); font-weight: 700; line-height: 1.25; margin: 1em 0 .35em; }
  .doc-body h3 { font-size: calc(var(--doc-size) * 1.2 * var(--scale)); font-weight: 600; margin: .9em 0 .3em; }
  .doc-body h4 { font-size: calc(var(--doc-size) * 1.05 * var(--scale)); font-weight: 600; margin: .8em 0 .25em; }
  .doc-body p { margin: 0; }

  a { color: var(--doc-primary); text-decoration: underline; }
  strong { font-weight: 700; }
  em { font-style: italic; }
  u { text-decoration: underline; }
  s { text-decoration: line-through; }
  code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .9em; background: rgba(0,0,0,.06); padding: .1em .3em; border-radius: 3px; }
  mark { background: #fff3a3; padding: 0 .1em; }

  .doc-body ul,
  .doc-body ol { margin: .4em 0; padding-left: 1.6em; }
  .doc-body li { margin: .15em 0; }
  .doc-body li > p { margin: 0; }

  .doc-body blockquote { margin: .7em 0; padding-left: 1em; border-left: 3px solid var(--doc-primary); }

  .doc-body hr { border: 0; border-top: 1px solid var(--doc-th-border); margin: 1.2em 0; }

  .doc-body pre { background: #f6f8fa; border: 1px solid var(--doc-th-border); border-radius: 8px; padding: 12px 14px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .88em; overflow-x: auto; }

  .doc-body table { border-collapse: collapse; width: 100%; margin: .8em 0; background: var(--sd-table-bg, transparent); table-layout: fixed; }
  .doc-body th,
  .doc-body td { border: var(--sd-table-border, 1px solid var(--doc-th-border)); padding: var(--sd-table-padding, 7px 9px); vertical-align: top; background: var(--sd-cell-bg, transparent); }
  .doc-body th { background: var(--sd-cell-bg, var(--doc-th-bg)); font-weight: 600; text-align: left; }
  .doc-body td p,
  .doc-body th p { margin: 0; }

  img { max-width: 100%; height: auto; }
  /* Las imágenes de cabecera/pie se dimensionan en mm desde el editor; no
     deben quedar limitadas por el ancho de la banda ni por la regla img. */
  .doc-chrome-image { max-width: none; }

  .doc-footer {
    margin-top: 1.6em;
    padding-top: .5em;
    border-top: 1px solid var(--doc-th-border);
    font-size: .82em;
    color: var(--doc-text);
    opacity: .85;
  }

  .doc-pages {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
  }

  @media screen {
    body {
      background: ${embed ? 'transparent' : '#e9edf2'};
      padding: ${embed ? '0' : '24px 12px'};
    }
    .doc-page {
      box-shadow: ${embed ? 'none' : '0 2px 18px rgba(15, 30, 50, .18)'};
      margin: ${embed ? '0' : '0 auto'};
    }
    ${
      embed
        ? `
    /* Miniaturas: una sola hoja con cabecera y pie anclados. El cuerpo se
       recorta en lugar de empujar el pie fuera del iframe. */
    .doc-pages { display: block; gap: 0; }
    .doc-page { height: var(--page-h); overflow: hidden; }
    .doc-body { min-height: 0; overflow: hidden; }
    `
        : ''
    }
  }

  @media print {
    html, body { background: #fff; margin: 0; padding: 0; }
    .doc-pages { display: block; gap: 0; }
    .doc-page {
      box-shadow: none;
      margin: 0;
      width: var(--page-w);
      min-height: var(--page-h);
      padding: 0;
      border-radius: 0;
      break-after: page;
      page-break-after: always;
    }
    .doc-page:last-child { break-after: auto; page-break-after: auto; }
    /* Salto manual: se fuerza después del nodo y se evita que Chrome lo
       absorba dentro del bloque siguiente. */
    .page-break {
      height: 0;
      margin: 0;
      padding: 0;
      border: 0;
      break-after: page;
      page-break-after: always;
    }
    /* Evita huérfanos y cortes desaconsejados para acercar el PDF a lo que
       muestra el editor paginado. */
    .doc-body h1,
    .doc-body h2,
    .doc-body h3,
    .doc-body h4 { break-after: avoid; page-break-after: avoid; }
    .doc-body img,
    .doc-body table,
    .doc-body blockquote,
    .doc-body pre { break-inside: avoid; page-break-inside: avoid; }
    .doc-body tr { break-inside: avoid; page-break-inside: avoid; }
  }
  ${
    forPdf
      ? `
  /* En PDF los márgenes los aplica Chrome (page.pdf margin) para que las
     cabeceras y pies repetidos encajen en el área correcta. */
  .doc-page {
    display: block !important;
    padding: 0 !important;
    width: auto !important;
    min-height: 0 !important;
  }
  .doc-body { padding: 0 !important; }
  `
      : ''
  }
  `;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * HTML de una imagen de banda. Se usan milímetros tanto en la hoja de preview
 * como en la plantilla de cabecera/pie de Chrome para conservar la posición.
 */
function bandImagesHtml(config: ChromeConfig): string {
  if (!config.enabled || !config.images?.length) return '';
  return config.images
    .map((image) => {
      const style = [
        'position:absolute',
        // El margen entre bloques de la banda no debe desplazar las imágenes:
        // su posición se define en mm desde el borde de la franja.
        'margin:0',
        `left:${Number(image.xMm) || 0}mm`,
        `top:${Number(image.yMm) || 0}mm`,
        `width:${Number(image.widthMm) || 1}mm`,
        `height:${Number(image.heightMm) || 1}mm`,
        `object-fit:${image.fit === 'fill' ? 'fill' : 'contain'}`,
        `opacity:${image.opacity ?? 1}`,
        `z-index:${image.zIndex ?? 1}`,
      ].join(';');
      return `<img class="doc-chrome-image" src="${escapeHtml(image.src)}" alt="" style="${style}" />`;
    })
    .join('');
}

function letterheadHtml(design: DesignTokens): string {
  const parts: string[] = [];

  if (design.logo.enabled && design.logo.dataUrl) {
    const align = design.logo.align === 'center' ? 'center' : design.logo.align === 'right' ? 'right' : 'left';
    parts.push(
      `<div class="doc-logo" style="text-align:${align}"><img src="${escapeHtml(design.logo.dataUrl)}" style="width:${Number(design.logo.width) || 120}px" alt="Logotipo" /></div>`,
    );
  }

  if (design.letterhead.enabled && (design.letterhead.title || design.letterhead.subtitle)) {
    parts.push(
      `<div class="letterhead" style="--lh-align:${design.letterhead.align}">` +
        (design.letterhead.title ? `<div class="lh-title">${escapeHtml(design.letterhead.title)}</div>` : '') +
        (design.letterhead.subtitle ? `<div class="lh-subtitle">${escapeHtml(design.letterhead.subtitle)}</div>` : '') +
        `<hr class="lh-rule" /></div>`,
    );
  }

  return parts.join('\n');
}

export interface RenderOptions {
  content: JSONContent;
  design: DesignTokens;
  values?: VariableValues;
  title?: string;
  /** 'print' omite la decoración de pantalla. */
  mode?: 'screen' | 'print';
  /** Incluye el membrete dentro del flujo (para vista previa y HTML). */
  includeLetterhead?: boolean;
  /** Generación de PDF: los márgenes los aplica Chrome. */
  forPdf?: boolean;
  /** Previsualización embebida: sin fondo, padding ni sombra alrededor de la hoja. */
  embed?: boolean;
  /** Cabecera y pie efectivos (documento → plantilla → diseño). */
  chrome?: ResolvedChrome | null;
}

/**
 * Renderiza una banda de cabecera/pie con las variables ya interpoladas.
 * En modo PDF los marcadores `{page}` y `{total}` se convierten en los spans
 * que Chrome rellena con la numeración real de cada página.
 */
export function renderChromeHtml(
  config: ChromeConfig | null | undefined,
  values: VariableValues = {},
  mode: 'preview' | 'pdf' = 'preview',
  pageNumber = 1,
  pageCount = 1,
): string {
  if (!config?.enabled) return '';

  const interpolated = cleanDoc(interpolateDoc(config.content, values));
  const html = sanitizeRendered(
    renderToHTMLString({
      content: interpolated as never,
      extensions: editorExtensions,
    }),
  );

  const imageHtml = bandImagesHtml(config);

  if (mode === 'pdf') {
    return (
      html
        .replace(/\{page\}/g, '<span class="pageNumber"></span>')
        .replace(/\{total\}/g, '<span class="totalPages"></span>') + imageHtml
    );
  }

  return (
    html
      .replace(/\{page\}/g, String(pageNumber))
      .replace(/\{total\}/g, String(pageCount)) + imageHtml
  );
}

function chromeBandStyle(config: ChromeConfig): string {
  const height = Number(config.heightMm);
  const width = clampChromeWidth(config.widthPercent);
  // El ancho debe ser explícito incluso al 100 %: estas bandas viven dentro de
  // contenedores flex y, con márgenes automáticos, sin `width` se encogen al
  // ancho de su contenido (la cabecera vacía desaparece y el pie se comprime).
  const rules = [
    'position:relative;',
    `width:${width}%;`,
    'margin-left:auto;',
    'margin-right:auto;',
  ];
  if (Number.isFinite(height) && height > 0) rules.push(`min-height:${height}mm;`);
  return rules.join('');
}

/** Interpola valores y limpia nodos vacíos una sola vez para todo el pipeline. */
export function prepareContent(
  content: JSONContent,
  values: VariableValues = {},
): JSONContent {
  return cleanDoc(interpolateDoc(content, values));
}

/** Renderiza contenido ya interpolado (sin volver a sustituir variables). */
export function renderPreparedContentHtml(content: JSONContent): string {
  return sanitizeRendered(
    renderToHTMLString({
      content: content as never,
      extensions: editorExtensions,
    }),
  );
}

/** Renderiza los nodos indicados como un cuerpo independiente. */
export function renderContentNodesHtml(nodes: JSONContent[]): string {
  return renderPreparedContentHtml({ type: 'doc', content: nodes });
}

/** Renderiza el cuerpo del documento a HTML usando las extensiones de TipTap. */
export function renderContentHtml(options: RenderOptions): string {
  const values = options.values ?? {};
  const interpolated = cleanDoc(interpolateDoc(options.content, values));
  return sanitizeRendered(
    renderToHTMLString({
      content: interpolated as never,
      extensions: editorExtensions,
    }),
  );
}

/**
 * El renderizador de TipTap no aplica estilos inline; quitamos scripts por
 * seguridad y restituyimos la altura de los párrafos vacíos.
 */
function sanitizeRendered(html: string): string {
  return withEmptyParagraphHeights(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/\son\w+="[^"]*"/gi, '')
      .replace(/\son\w+='[^']*'/gi, ''),
  );
}

/** Documento HTML completo y autónomo (para exportar o previsualizar). */
export function buildDocumentHtml(options: RenderOptions): string {
  const { design, title = 'Documento', values = {} } = options;
  const body = renderContentHtml(options);
  const head = options.includeLetterhead === false ? '' : letterheadHtml(design);

  const chrome = options.chrome;
  const headerHtml = chrome && !options.forPdf ? renderChromeHtml(chrome.header, values, 'preview') : '';
  const footerHtml = chrome && !options.forPdf ? renderChromeHtml(chrome.footer, values, 'preview') : '';

  // Compatibilidad: si no se pasó chrome, se conserva el pie del diseño.
  let legacyFooter = '';
  if (!chrome && design.footer.enabled && !options.forPdf) {
    const text = design.footer.content.replace(/\{page\}/g, '1').replace(/\{total\}/g, '1');
    legacyFooter = `<div class="doc-footer" style="text-align:${design.footer.align}">${escapeHtml(text)}</div>`;
  }

  const headerBand = headerHtml
    ? `<div class="doc-header-band" style="${chromeBandStyle(chrome!.header)}">${headerHtml}</div>`
    : '';
  const footerBand = footerHtml
    ? `<div class="doc-footer-band" style="${chromeBandStyle(chrome!.footer)}">${footerHtml}</div>`
    : '';

  const pageContent = options.forPdf
    ? `<div class="doc-body">${body}</div>`
    : `      <div class="doc-page-top">
        ${head}
        ${headerBand}
      </div>
      <div class="doc-body">${body}</div>
      <div class="doc-page-bottom">
        ${footerBand || legacyFooter}
      </div>`;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${designCss(design, options.forPdf === true, options.embed === true)}</style>
</head>
<body${options.mode === 'print' ? ' class="print"' : ''}>
  <div class="doc-page" data-page="1">
    ${pageContent}
  </div>
</body>
</html>`;
}

export interface PaginatedRenderOptions extends RenderOptions {
  /** Contenido ya interpolado con la misma estructura que se midió. */
  preparedContent: JSONContent;
  pageLayout: DocumentPageLayout;
}

/** Documento completo con hojas físicas, cabecera/pie por hoja y paginación. */
export function buildPaginatedDocumentHtml(options: PaginatedRenderOptions): string {
  const { design, title = 'Documento', values = {}, pageLayout } = options;
  const allNodes = options.preparedContent.content ?? [];
  const pageCount = Math.max(1, pageLayout.pageBlocks.length);
  const chrome = options.chrome;
  const includeLetterhead = options.includeLetterhead !== false;
  const head = includeLetterhead ? letterheadHtml(design) : '';

  const pageHtml = pageLayout.pageBlocks.map((indices, pageIndex) => {
    const pageNumber = pageIndex + 1;
    const nodes = indices
      .map((index) => allNodes[index])
      .filter((node): node is JSONContent => Boolean(node));
    const body = renderContentNodesHtml(nodes);

    const headerHtml = chrome
      ? renderChromeHtml(chrome.header, values, 'preview', pageNumber, pageCount)
      : '';
    const footerHtml = chrome
      ? renderChromeHtml(chrome.footer, values, 'preview', pageNumber, pageCount)
      : '';
    const headerBand = headerHtml
      ? `<div class="doc-header-band" style="${chromeBandStyle(chrome!.header)}">${headerHtml}</div>`
      : '';
    const footerBand = footerHtml
      ? `<div class="doc-footer-band" style="${chromeBandStyle(chrome!.footer)}">${footerHtml}</div>`
      : '';

    let legacyFooter = '';
    if (!chrome && design.footer.enabled) {
      const text = design.footer.content
        .replace(/\{page\}/g, String(pageNumber))
        .replace(/\{total\}/g, String(pageCount));
      legacyFooter = `<div class="doc-footer" style="text-align:${design.footer.align}">${escapeHtml(text)}</div>`;
    }

    const height = pageLayout.pageHeightsPx[pageIndex] ?? pageLayout.pageHeightPx;
    return `      <section class="doc-page" data-page="${pageNumber}" style="height:${height}px">
        <div class="doc-page-top">
          ${head}
          ${headerBand}
        </div>
        <div class="doc-body">${body}</div>
        <div class="doc-page-bottom">
          ${footerBand || legacyFooter}
        </div>
      </section>`;
  });

  // Las miniaturas solo necesitan la primera hoja.
  const visiblePages = options.embed ? pageHtml.slice(0, 1) : pageHtml;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${designCss(design, false, options.embed === true)}</style>
</head>
<body${options.mode === 'print' ? ' class="print"' : ''}>
  <div class="doc-pages">
${visiblePages.join('\n')}
  </div>
</body>
</html>`;
}

/** CSS mínimo autocontenido para las plantillas de Chrome. */
function chromeTemplateCss(design: DesignTokens): string {
  const font = cssValue(design.fontFamily || FONT_STACK_FALLBACK);
  const text = cssValue(design.textColor);
  const primary = cssValue(design.primaryColor);
  return `<style>
  ${GEORAMA_FONT_CSS}
  .doc-chrome { box-sizing: border-box; width: 100%; font-family: ${font}; font-size: ${design.fontSize}pt; line-height: ${design.lineHeight}; color: ${text}; }
  .doc-chrome * { box-sizing: border-box; }
  .doc-chrome p { margin: 0 0 .35em; }
  .doc-chrome p:last-child { margin-bottom: 0; }
  .doc-chrome img { max-width: 100%; height: auto; }
  .doc-chrome .doc-chrome-image { max-width: none; }
  .doc-chrome h1, .doc-chrome h2, .doc-chrome h3, .doc-chrome h4 { color: ${primary}; line-height: 1.2; margin: .4em 0 .2em; }
  .doc-chrome ul, .doc-chrome ol { margin: 0 0 .35em; padding-left: 1.4em; }
  .doc-chrome a { color: ${primary}; text-decoration: underline; }
  </style>`;
}

/**
 * Chrome coloca las plantillas de cabecera/pie con un pequeño margen interno.
 * Las desplazamos para que una banda a sangre toque el borde real de la hoja.
 */
const PDF_HEADER_OFFSET_MM = -6.5;
const PDF_FOOTER_OFFSET_MM = 5.5;

/**
 * El desplazamiento debe ir en el propio `.doc-chrome`: un `div` envolvente
 * hace que Chrome no pinte la plantilla de cabecera/pie.
 */
function pdfChromeOffsetStyle(kind: 'header' | 'footer'): string {
  const offset = kind === 'header' ? PDF_HEADER_OFFSET_MM : PDF_FOOTER_OFFSET_MM;
  return `position:relative;top:${offset}mm;`;
}

/** Cabecera que Chrome repite en cada página al generar el PDF. */
export function buildPdfHeaderTemplate(
  design: DesignTokens,
  chrome?: ResolvedChrome | null,
  values: VariableValues = {},
): string {
  const parts: string[] = [];

  if (design.logo.enabled && design.logo.dataUrl) {
    const align = design.logo.align === 'center' ? 'center' : design.logo.align === 'right' ? 'right' : 'left';
    parts.push(
      `<div style="text-align:${align};margin-bottom:2mm;"><img src="${escapeHtml(design.logo.dataUrl)}" style="width:${Number(design.logo.width) || 120}px;max-height:24mm;" alt="Logotipo" /></div>`,
    );
  }

  if (design.letterhead.enabled && (design.letterhead.title || design.letterhead.subtitle)) {
    parts.push(
      `<div style="text-align:${design.letterhead.align};margin-bottom:2mm;">` +
        (design.letterhead.title
          ? `<div style="font-weight:700;letter-spacing:.05em;color:${cssValue(design.primaryColor)};">${escapeHtml(design.letterhead.title)}</div>`
          : '') +
        (design.letterhead.subtitle ? `<div style="opacity:.75;">${escapeHtml(design.letterhead.subtitle)}</div>` : '') +
        `<div style="border-top:2px solid ${cssValue(design.primaryColor)};margin-top:2mm;"></div>` +
        `</div>`,
    );
  }

  const chromeHtml = renderChromeHtml(chrome?.header, values, 'pdf');
  if (chromeHtml && chrome) {
    parts.push(
      `<div class="doc-chrome-band" style="${chromeBandStyle(chrome.header)}">${chromeHtml}</div>`,
    );
  }

  if (parts.length === 0) return '<div style="width:100%;"></div>';

  return `${chromeTemplateCss(design)}<div class="doc-chrome" style="${pdfChromeOffsetStyle('header')}">${parts.join('\n')}</div>`;
}

/** Pie que Chrome repite en cada página al generar el PDF. */
export function buildPdfFooterTemplate(
  design: DesignTokens,
  chrome?: ResolvedChrome | null,
  values: VariableValues = {},
): string {
  if (chrome) {
    const html = renderChromeHtml(chrome.footer, values, 'pdf');
    if (!html) return '<div></div>';
    return `${chromeTemplateCss(design)}<div class="doc-chrome" style="${pdfChromeOffsetStyle('footer')}"><div class="doc-chrome-band" style="${chromeBandStyle(chrome.footer)}">${html}</div></div>`;
  }

  if (!design.footer.enabled) return '<div></div>';

  // Compatibilidad con llamadas antiguas sin chrome resuelto.
  const escaped = escapeHtml(design.footer.content);
  const withPages = escaped
    .replace(/\{page\}/g, '<span class="pageNumber"></span>')
    .replace(/\{total\}/g, '<span class="totalPages"></span>');

  const content =
    withPages.trim().length > 0
      ? withPages
      : [design.footer.showPageNumber ? 'Página <span class="pageNumber"></span>' : '', design.footer.showTotal ? 'de <span class="totalPages"></span>' : '']
          .filter(Boolean)
          .join(' ');

  return `<div style="${pdfChromeOffsetStyle('footer')}width:100%;padding:0 12mm;font-family:${cssValue(design.fontFamily)};font-size:8pt;color:${cssValue(design.textColor)};text-align:${design.footer.align};opacity:.85;">
    ${content}
  </div>`;
}
