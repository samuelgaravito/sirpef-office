import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  LevelFormat,
  LineRuleType,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlignTable,
  WidthType,
  convertMillimetersToTwip,
} from 'docx';

import type {
  ChromeConfig,
  DesignTokens,
  JSONContent,
  ResolvedChrome,
  VariableValues,
} from '@sirpefoffice/shared';
import { clampChromeWidth, PAGE_SIZES_CM } from '@sirpefoffice/shared';

import { paginateDocument } from '../lib/paginate.js';
import { interpolateDoc } from '../lib/render.js';

/* ───────────────────────────── Utilidades ───────────────────────────── */

const CM_TO_MM = 10;

function twips(cm: number): number {
  return convertMillimetersToTwip(cm * CM_TO_MM);
}

function hex(color: string | undefined): string | undefined {
  if (!color) return undefined;

  const value = color.trim();
  const rgb = value.match(
    /^rgba?\(\s*(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})/i,
  );
  if (rgb) {
    const channel = (input: string | undefined): string =>
      Math.min(255, Math.max(0, Number(input) || 0))
        .toString(16)
        .padStart(2, '0')
        .toUpperCase();
    return `${channel(rgb[1])}${channel(rgb[2])}${channel(rgb[3])}`;
  }

  const match = value.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match?.[1]) return undefined;
  const raw = match[1];
  const expanded = raw.length === 3 ? raw.split('').map((part) => part + part).join('') : raw;
  return expanded.toUpperCase();
}

function alignment(value: unknown): (typeof AlignmentType)[keyof typeof AlignmentType] | undefined {
  switch (value) {
    case 'center':
      return AlignmentType.CENTER;
    case 'right':
      return AlignmentType.RIGHT;
    case 'justify':
      return AlignmentType.JUSTIFIED;
    case 'left':
      return AlignmentType.LEFT;
    default:
      return undefined;
  }
}

const HEADINGS: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
};

interface TextContext {
  design: DesignTokens;
  /** Convierte {page} y {total} en campos de numeración de Word. */
  pageFields?: boolean;
  /** Tamaño por defecto en medios puntos (18 = 9 pt) para cabeceras/pies. */
  defaultSize?: number;
}

type PageTokenField = 'page' | 'total';

/** Divide un texto en fragmentos normales y campos de página. */
function splitPageTokens(text: string): { text?: string; field?: PageTokenField }[] {
  const output: { text?: string; field?: PageTokenField }[] = [];
  const pattern = /\{(page|total)\}/g;
  let last = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > last) output.push({ text: text.slice(last, match.index) });
    output.push({ field: match[1] as PageTokenField });
    last = pattern.lastIndex;
  }

  if (last < text.length) output.push({ text: text.slice(last) });
  return output.length > 0 ? output : [{ text }];
}

/** Convierte los nodos de texto con sus marcas en TextRun de docx. */
function inlineRuns(node: JSONContent, ctx: TextContext): (TextRun | ExternalHyperlink)[] {
  const output: (TextRun | ExternalHyperlink)[] = [];

  for (const child of node.content ?? []) {
    if (child.type === 'hardBreak') {
      output.push(new TextRun({ break: 1 }));
      continue;
    }
    if (child.type !== 'text' || !child.text) continue;

    const marks = child.marks ?? [];
    const byName = new Map(marks.map((m) => [m.type, m]));
    const textStyle = byName.get('textStyle')?.attrs as
      | { color?: string; fontSize?: string; fontFamily?: string }
      | undefined;

    const link = byName.get('link')?.attrs as { href?: string } | undefined;

    const base = {
      bold: byName.has('bold'),
      italics: byName.has('italic'),
      strike: byName.has('strike'),
      underline: byName.has('underline') ? {} : undefined,
      color: hex(textStyle?.color) ?? hex(ctx.design.textColor),
      font: textStyle?.fontFamily ?? ctx.design.fontFamily.split(',')[0]?.trim(),
      size: textStyle?.fontSize
        ? Math.round(Number.parseFloat(textStyle.fontSize) * 2)
        : ctx.defaultSize,
      highlight: byName.has('highlight') ? ('yellow' as const) : undefined,
      superScript: byName.has('superscript'),
      subScript: byName.has('subscript'),
    };

    const pieces = ctx.pageFields ? splitPageTokens(child.text) : [{ text: child.text }];

    for (const piece of pieces) {
      if (piece.field) {
        output.push(
          new TextRun({
            ...base,
            children: [piece.field === 'page' ? PageNumber.CURRENT : PageNumber.TOTAL_PAGES],
          }),
        );
        continue;
      }

      if (!piece.text) continue;
      const run = new TextRun({ ...base, text: piece.text });
      output.push(link?.href ? new ExternalHyperlink({ link: link.href, children: [run] }) : run);
    }
  }

  return output;
}

/* ────────────────────────────── Bloques ─────────────────────────────── */

function paragraphFrom(node: JSONContent, ctx: TextContext): Paragraph {
  const attrs = node.attrs ?? {};
  const runs = inlineRuns(node, ctx);

  return new Paragraph({
    children: runs.length > 0 ? runs : [new TextRun('')],
    alignment: alignment(attrs.textAlign),
    // El editor no añade espacio entre párrafos; solo el interlineado.
    spacing: { before: 0, after: 0 },
  });
}

const HEADING_SPACING_TWIPS: Record<number, { before: number; after: number }> = {
  1: { before: 220, after: 88 },
  2: { before: 220, after: 77 },
  3: { before: 198, after: 66 },
  4: { before: 176, after: 55 },
};

function headingFrom(
  node: JSONContent,
  ctx: TextContext,
  suppressBefore = false,
): Paragraph {
  const level = Number(node.attrs?.level ?? 1);
  const spacing = HEADING_SPACING_TWIPS[level] ?? HEADING_SPACING_TWIPS[1]!;
  return new Paragraph({
    children: inlineRuns(node, ctx),
    heading: HEADINGS[level] ?? HeadingLevel.HEADING_1,
    alignment: alignment(node.attrs?.textAlign),
    spacing: suppressBefore ? { ...spacing, before: 0 } : spacing,
  });
}

function parseImageData(src: string): {
  data: Buffer;
  type: 'png' | 'jpg' | 'gif';
} | null {
  const match = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i.exec(src);
  if (!match) return null;
  const data = Buffer.from(match[2] ?? '', 'base64');
  const rawType = (match[1] ?? 'png').toLowerCase();
  const type = (rawType === 'jpeg' ? 'jpg' : rawType) as 'png' | 'jpg' | 'gif';
  return { data, type };
}

/**
 * Convierte las imágenes de una banda en dibujos flotantes anclados a la
 * página. El header/footer de Word se repite en cada hoja, así que las
 * imágenes también lo hacen.
 */
function bandImageParagraphs(
  config: ChromeConfig,
  design: DesignTokens,
  kind: 'header' | 'footer',
  pageHeightCm: number,
): Paragraph[] {
  if (!config.enabled || !config.images?.length) return [];

  const mmToEmu = (mm: number): number => Math.round(mm * 36000);
  const mmToPx = (mm: number): number => Math.round((mm * 96) / 25.4);
  const pageHeightMm = pageHeightCm * 10;
  const bandHeightMm = config.heightMm;
  const letterheadMm =
    design.logo.enabled || design.letterhead.enabled ? 12 : 0;

  // La banda se mide sobre la página completa y se centra en ella. En Word las
  // imágenes se anclan a la página, así que hay que sumar ese desplazamiento.
  const size = PAGE_SIZES_CM[design.pageFormat] ?? PAGE_SIZES_CM.A4!;
  const pageWidthMm =
    (design.orientation === 'landscape' ? size.height : size.width) * 10;
  const widthPercent = clampChromeWidth(config.widthPercent);
  const bandWidthMm = (pageWidthMm * widthPercent) / 100;
  const bandOffsetMm = (pageWidthMm - bandWidthMm) / 2;

  const runs: ImageRun[] = [];

  for (const image of config.images) {
    const parsed = parseImageData(image.src);
    if (!parsed) continue;

    // Caja lógica de la imagen. En modo `contain` el dibujo se escala dentro
    // de la caja y se centra; en modo `fill` ocupa toda la caja.
    let drawWidthMm = image.widthMm;
    let drawHeightMm = image.heightMm;
    let drawOffsetX = 0;
    let drawOffsetY = 0;
    if (image.fit !== 'fill') {
      const naturalWidth = Number(image.naturalWidth) || 0;
      const naturalHeight = Number(image.naturalHeight) || 0;
      const ratio =
        naturalWidth > 0 && naturalHeight > 0
          ? naturalWidth / naturalHeight
          : image.widthMm / Math.max(1, image.heightMm);
      drawWidthMm = image.widthMm;
      drawHeightMm = drawWidthMm / ratio;
      if (drawHeightMm > image.heightMm) {
        drawHeightMm = image.heightMm;
        drawWidthMm = drawHeightMm * ratio;
      }
      drawOffsetX = (image.widthMm - drawWidthMm) / 2;
      drawOffsetY = (image.heightMm - drawHeightMm) / 2;
    }

    // Las coordenadas de la banda son relativas a su esquina superior
    // izquierda. En Word las anclamos a la página completa.
    const xMm = bandOffsetMm + image.xMm + drawOffsetX;
    const yMm =
      kind === 'header'
        ? letterheadMm + image.yMm + drawOffsetY
        : pageHeightMm - bandHeightMm + image.yMm + drawOffsetY;

    runs.push(
      new ImageRun({
        type: parsed.type,
        data: parsed.data,
        transformation: {
          width: Math.max(1, mmToPx(drawWidthMm)),
          height: Math.max(1, mmToPx(drawHeightMm)),
        },
        floating: {
          horizontalPosition: { relative: 'page' as const, offset: mmToEmu(xMm) },
          verticalPosition: { relative: 'page' as const, offset: mmToEmu(yMm) },
          wrap: { type: 0 as const, side: 'bothSides' as const },
          allowOverlap: true,
          behindDocument: false,
          zIndex: image.zIndex ?? 1,
        },
      }),
    );
  }

  if (runs.length === 0) return [];
  // El párrafo solo contiene dibujos flotantes; con una altura exacta mínima
  // no añade una línea extra al flujo del encabezado/pie.
  return [
    new Paragraph({
      children: runs,
      spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACT },
    }),
  ];
}

function imageFrom(node: JSONContent): Paragraph | null {
  const src = String(node.attrs?.src ?? '');
  const match = /^data:image\/(png|jpe?g|gif|webp);base64,(.+)$/i.exec(src);
  if (!match) return null;

  const data = Buffer.from(match[2] ?? '', 'base64');
  const rawType = (match[1] ?? 'png').toLowerCase();
  const type = (rawType === 'jpeg' ? 'jpg' : rawType) as 'png' | 'jpg' | 'gif';

  const attrs = node.attrs ?? {};
  const width = Number(attrs.width ?? 400) || 400;
  const height = Number(attrs.height ?? 300) || 300;
  const float = String(attrs.float ?? 'none');
  const align = String(attrs.align ?? 'center');
  const offsetX = Number(attrs.offsetX) || 0;
  const offsetY = Number(attrs.offsetY) || 0;

  const transformation = { width, height };
  // docx expresa las posiciones flotantes en EMU (1 px a 96 dpi = 9525 EMU).
  const emu = (px: number): number => Math.round(px * 9525);

  // Imagen flotante (izquierda/derecha/detrás del texto): se ancla con envoltura.
  if (float === 'left' || float === 'right' || float === 'behind') {
    const horizontal =
      float === 'right'
        ? { relative: 'margin' as const, align: 'right' as const }
        : { relative: 'margin' as const, offset: emu(offsetX) };

    return new Paragraph({
      children: [
        new ImageRun({
          type,
          data,
          transformation,
          floating: {
            horizontalPosition: horizontal,
            verticalPosition: { relative: 'paragraph' as const, offset: emu(offsetY) },
            wrap: {
              type: (float === 'behind' ? 0 : 1) as 0 | 1,
              side: 'bothSides' as const,
            },
            behindDocument: float === 'behind',
            allowOverlap: true,
            zIndex: (float === 'behind' ? 0 : 1) as 0 | 1,
          },
        }),
      ],
      spacing: { after: 120 },
    });
  }

  // Imagen en línea: se alinea dentro del párrafo.
  const alignment =
    align === 'center' ? AlignmentType.CENTER : align === 'right' ? AlignmentType.RIGHT : AlignmentType.LEFT;

  return new Paragraph({
    children: [new ImageRun({ type, data, transformation })],
    alignment,
    spacing: { after: 120 },
  });
}

function listFrom(node: JSONContent, ctx: TextContext, level = 0): Paragraph[] {
  const ordered = node.type === 'orderedList';
  const reference = ordered ? 'ordered-list' : 'bullet-list';
  const output: Paragraph[] = [];

  for (const item of node.content ?? []) {
    for (const child of item.content ?? []) {
      if (child.type === 'paragraph') {
        output.push(
          new Paragraph({
            children: inlineRuns(child, ctx),
            numbering: { reference, level: Math.min(level, 8) },
            spacing: { after: 60 },
          }),
        );
      } else if (child.type === 'bulletList' || child.type === 'orderedList') {
        output.push(...listFrom(child, ctx, level + 1));
      }
    }
  }

  return output;
}

function tableBorderStyle(value: string): (typeof BorderStyle)[keyof typeof BorderStyle] {
  switch (value) {
    case 'dashed':
      return BorderStyle.DASHED;
    case 'dotted':
      return BorderStyle.DOTTED;
    case 'none':
      return BorderStyle.NONE;
    default:
      return BorderStyle.SINGLE;
  }
}

function tableVerticalAlign(value: unknown): (typeof VerticalAlignTable)[keyof typeof VerticalAlignTable] {
  switch (value) {
    case 'middle':
    case 'center':
      return VerticalAlignTable.CENTER;
    case 'bottom':
      return VerticalAlignTable.BOTTOM;
    default:
      return VerticalAlignTable.TOP;
  }
}

interface ParsedCell {
  node: JSONContent;
  col: number;
  colspan: number;
  rowspan: number;
}

function tableFrom(node: JSONContent, ctx: TextContext, contentWidthTwips: number): Table {
  const rows = node.content ?? [];
  const tableAttrs = node.attrs ?? {};
  const occupied: boolean[][] = [];
  const parsedRows: ParsedCell[][] = [];
  let columnCount = 1;

  // Primera pasada: reconstruye la rejilla real y coloca cada celda teniendo
  // en cuenta los huecos que dejan las celdas combinadas verticalmente.
  rows.forEach((row, rowIndex) => {
    occupied[rowIndex] ??= [];
    let col = 0;
    const cells: ParsedCell[] = [];

    for (const cellNode of row.content ?? []) {
      while (occupied[rowIndex]?.[col]) col += 1;
      const colspan = Math.max(1, Number(cellNode.attrs?.colspan) || 1);
      const rowspan = Math.max(1, Number(cellNode.attrs?.rowspan) || 1);

      cells.push({ node: cellNode, col, colspan, rowspan });

      for (let r = rowIndex; r < rowIndex + rowspan; r += 1) {
        occupied[r] ??= [];
        for (let c = col; c < col + colspan; c += 1) {
          occupied[r]![c] = true;
        }
      }

      col += colspan;
      columnCount = Math.max(columnCount, col);
    }

    parsedRows.push(cells);
  });

  for (const row of occupied) columnCount = Math.max(columnCount, row.length);

  // Anchos: TipTap guarda `colwidth` en píxeles. Se normalizan al ancho real
  // del contenido para que Word reciba una rejilla coherente.
  const rawWidths = Array.from({ length: columnCount }, () => 0);
  for (const cells of parsedRows) {
    for (const info of cells) {
      const attrs = info.node.attrs ?? {};
      const colwidth = Array.isArray(attrs.colwidth)
        ? attrs.colwidth.map((value) => Number(value)).filter((value) => Number.isFinite(value))
        : [];
      for (let i = 0; i < info.colspan; i += 1) {
        const width = Number(colwidth[i] ?? colwidth[0] ?? 0);
        if (width > 0) {
          rawWidths[info.col + i] = Math.max(rawWidths[info.col + i] ?? 0, width);
        }
      }
    }
  }

  const known = rawWidths.filter((width) => width > 0);
  const fallback = known.length > 0 ? known.reduce((sum, width) => sum + width, 0) / known.length : 1;
  const normalized = rawWidths.map((width) => (width > 0 ? width : fallback));
  const totalWidth = normalized.reduce((sum, width) => sum + width, 0) || 1;
  const columnWidths = normalized.map((width) =>
    Math.max(1, Math.round((width / totalWidth) * contentWidthTwips)),
  );
  if (columnWidths.length > 0) {
    const difference =
      contentWidthTwips - columnWidths.reduce((sum, width) => sum + width, 0);
    columnWidths[columnWidths.length - 1] = Math.max(
      1,
      (columnWidths[columnWidths.length - 1] ?? contentWidthTwips) + difference,
    );
  }

  const borderWidthPx = Number(tableAttrs.borderWidth ?? 1) || 0;
  const borderColor = hex(String(tableAttrs.borderColor ?? ctx.design.tableBorderColor)) ?? 'C9D2DD';
  const borderStyle = String(tableAttrs.borderStyle ?? 'solid');
  const border = {
    style: borderWidthPx <= 0 ? BorderStyle.NONE : tableBorderStyle(borderStyle),
    size: borderWidthPx <= 0 ? 0 : Math.max(2, Math.round(borderWidthPx * 6)),
    color: borderColor,
  };
  const borders = {
    top: border,
    bottom: border,
    left: border,
    right: border,
    insideHorizontal: border,
    insideVertical: border,
  };

  const cellPaddingPx = Number(tableAttrs.cellPadding ?? 7) || 0;
  const tablePaddingTwips = Math.max(0, Math.round(cellPaddingPx * 15));
  const tableBackground =
    typeof tableAttrs.tableBackground === 'string' && tableAttrs.tableBackground
      ? hex(tableAttrs.tableBackground)
      : undefined;

  const columnWidthFor = (info: ParsedCell): number =>
    columnWidths
      .slice(info.col, info.col + info.colspan)
      .reduce((sum, width) => sum + width, 0) || columnWidths[0] || contentWidthTwips;

  const cellBlocks = (info: ParsedCell, width: number): (Paragraph | Table)[] => {
    const attrs = info.node.attrs ?? {};
    const align = typeof attrs.align === 'string' ? attrs.align : undefined;
    const nodes = (info.node.content ?? []).map((child) => {
      if (align && (child.type === 'paragraph' || child.type === 'heading')) {
        return {
          ...child,
          attrs: { ...(child.attrs ?? {}), textAlign: child.attrs?.textAlign ?? align },
        };
      }
      return child;
    });
    const blocks = blocksFrom(nodes, ctx, width);
    return blocks.length > 0 ? blocks : [new Paragraph({ children: [new TextRun('')] })];
  };

  return new Table({
    width: { size: contentWidthTwips, type: WidthType.DXA },
    columnWidths,
    layout: TableLayoutType.FIXED,
    alignment: alignment(tableAttrs.tableAlign),
    borders,
    rows: parsedRows.map(
      (cells) =>
        new TableRow({
          tableHeader: cells.some((info) => info.node.type === 'tableHeader'),
          cantSplit: true,
          children: cells.map((info) => {
            const attrs = info.node.attrs ?? {};
            const isHeader = info.node.type === 'tableHeader';
            const width = columnWidthFor(info);
            const background =
              typeof attrs.backgroundColor === 'string' && attrs.backgroundColor
                ? hex(attrs.backgroundColor)
                : isHeader
                  ? hex(ctx.design.tableHeadColor)
                  : tableBackground;
            const padding =
              attrs.padding !== null && attrs.padding !== undefined
                ? Math.max(0, Math.round(Number(attrs.padding) * 15))
                : tablePaddingTwips;

            return new TableCell({
              columnSpan: info.colspan > 1 ? info.colspan : undefined,
              rowSpan: info.rowspan > 1 ? info.rowspan : undefined,
              width: { size: width, type: WidthType.DXA },
              verticalAlign: tableVerticalAlign(attrs.verticalAlign),
              borders,
              shading:
                background !== undefined
                  ? { type: ShadingType.CLEAR, fill: background }
                  : undefined,
              margins: { top: padding, bottom: padding, left: padding, right: padding },
              children: cellBlocks(info, width),
            });
          }),
        }),
    ),
  });
}

function blocksFrom(
  nodes: JSONContent[],
  ctx: TextContext,
  contentWidthTwips: number,
  options?: { suppressFirstHeadingBefore?: boolean },
): (Paragraph | Table)[] {
  const output: (Paragraph | Table)[] = [];
  let index = -1;

  for (const node of nodes) {
    index += 1;
    switch (node.type) {
      case 'paragraph':
        output.push(paragraphFrom(node, ctx));
        break;
      case 'heading':
        output.push(
          headingFrom(
            node,
            ctx,
            Boolean(options?.suppressFirstHeadingBefore && index === 0),
          ),
        );
        break;
      case 'bulletList':
      case 'orderedList':
        output.push(...listFrom(node, ctx));
        break;
      case 'blockquote': {
        const text = plainText(node);
        output.push(
          new Paragraph({
            children: [new TextRun({ text, italics: true })],
            indent: { left: twips(1) },
            border: {
              left: {
                style: BorderStyle.SINGLE,
                size: 12,
                color: hex(ctx.design.primaryColor),
                space: 8,
              },
            },
            spacing: { after: 120 },
          }),
        );
        break;
      }
      case 'horizontalRule':
        output.push(
          new Paragraph({
            children: [new TextRun('')],
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: hex(ctx.design.tableBorderColor) } },
            spacing: { before: 120, after: 200 },
          }),
        );
        break;
      case 'pageBreak':
        output.push(new Paragraph({ children: [new PageBreak()] }));
        break;
      case 'codeBlock':
        output.push(
          new Paragraph({
            children: [new TextRun({ text: plainText(node), font: 'Consolas', size: 18 })],
            shading: { type: ShadingType.CLEAR, fill: 'F2F4F7' },
            spacing: { before: 120, after: 120 },
          }),
        );
        break;
      case 'image': {
        const image = imageFrom(node);
        if (image) output.push(image);
        break;
      }
      case 'table':
        output.push(tableFrom(node, ctx, contentWidthTwips));
        break;
      case 'taskList':
      case 'taskItem':
        output.push(
          new Paragraph({
            children: [new TextRun({ text: `☐ ${plainText(node)}` })],
            spacing: { after: 60 },
          }),
        );
        break;
      default: {
        if (node.content && node.content.length > 0) {
          output.push(...blocksFrom(node.content, ctx, contentWidthTwips));
        }
      }
    }
  }

  return output;
}

function plainText(node: JSONContent): string {
  if (node.text) return node.text;
  return (node.content ?? []).map(plainText).join('');
}

/* ────────────────────────────── Documento ───────────────────────────── */

export interface DocxOptions {
  content: JSONContent;
  design: DesignTokens;
  values?: VariableValues;
  title?: string;
  /** Contenido ya interpolado (evita volver a interpolar). */
  interpolated?: JSONContent;
  /** Cabecera y pie efectivos (documento → plantilla → diseño). */
  chrome?: ResolvedChrome | null;
}

/** Bloques de una banda con variables y campos de página ya resueltos. */
function chromeBlocks(
  config: ChromeConfig,
  values: VariableValues,
  design: DesignTokens,
  contentWidthTwips: number,
): (Paragraph | Table)[] {
  if (!config.enabled) return [];
  const content = interpolateDoc(config.content, values);
  return blocksFrom(
    content.content ?? [],
    { design, pageFields: true, defaultSize: 18 },
    contentWidthTwips,
  );
}

/**
 * Word no tiene un concepto de "ancho de encabezado": envolvemos el contenido
 * en una tabla de una celda, sin bordes ni márgenes, centrada en la página.
 * La sangría negativa permite que la banda llegue a los bordes de la hoja.
 */
function chromeBlocksWithWidth(
  config: ChromeConfig,
  values: VariableValues,
  design: DesignTokens,
  _contentWidthTwips: number,
): (Paragraph | Table)[] {
  const size = PAGE_SIZES_CM[design.pageFormat] ?? PAGE_SIZES_CM.A4!;
  const pageWidthMm =
    (design.orientation === 'landscape' ? size.height : size.width) * 10;
  const pageWidthTwips = Math.max(1, Math.round(twips(pageWidthMm / 10)));
  const widthPercent = clampChromeWidth(config.widthPercent);
  const bandWidthTwips = Math.max(
    1,
    Math.round((pageWidthTwips * widthPercent) / 100),
  );
  const bandLeftTwips = Math.round((pageWidthTwips - bandWidthTwips) / 2);
  const contentLeftTwips = Math.round(twips(design.margins.left));
  const indentTwips = bandLeftTwips - contentLeftTwips;

  const blocks = chromeBlocks(config, values, design, bandWidthTwips);
  if (blocks.length === 0) return [];

  const none = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const borders = {
    top: none,
    bottom: none,
    left: none,
    right: none,
    insideHorizontal: none,
    insideVertical: none,
  };

  return [
    new Table({
      width: { size: bandWidthTwips, type: WidthType.DXA },
      columnWidths: [bandWidthTwips],
      layout: TableLayoutType.FIXED,
      indent: { size: indentTwips, type: WidthType.DXA },
      alignment: AlignmentType.LEFT,
      borders,
      rows: [
        new TableRow({
          cantSplit: true,
          children: [
            new TableCell({
              width: { size: bandWidthTwips, type: WidthType.DXA },
              borders,
              margins: { top: 0, bottom: 0, left: 0, right: 0 },
              children: blocks,
            }),
          ],
        }),
      ],
    }),
  ];
}

/** Genera un .docx respetando el tamaño de página, márgenes y tipografía. */
export async function renderDocx(options: DocxOptions): Promise<Buffer> {
  const { design } = options;
  const size = PAGE_SIZES_CM[design.pageFormat] ?? PAGE_SIZES_CM.A4!;
  const landscape = design.orientation === 'landscape';
  const pageWidthCm = landscape ? size.height : size.width;
  const pageHeightCm = landscape ? size.width : size.height;

  const contentWidthCm = pageWidthCm - design.margins.left - design.margins.right;
  const contentWidthTwips = twips(contentWidthCm);

  const chrome = options.chrome;
  const values = options.values ?? {};
  const paginated = await paginateDocument({
    content: options.interpolated ?? options.content,
    design,
    chrome,
    values,
    title: options.title,
    includeLetterhead: true,
  });
  const docContent = paginated.content;
  const pageBlocks = paginated.layout.pageBlocks;
  const children: (Paragraph | Table)[] = [];

  for (let pageIndex = 0; pageIndex < pageBlocks.length; pageIndex += 1) {
    if (pageIndex > 0) {
      children.push(new Paragraph({ children: [new PageBreak()] }));
    }
    const nodes = (pageBlocks[pageIndex] ?? [])
      .map((index) => docContent.content?.[index])
      .filter((node): node is JSONContent => Boolean(node));
    if (nodes.length > 0) {
      children.push(
        ...blocksFrom(nodes, { design }, contentWidthTwips, {
          suppressFirstHeadingBefore: pageIndex === 0,
        }),
      );
    } else {
      // Una hoja en blanco (por un salto manual final) también debe existir.
      children.push(new Paragraph({ children: [new TextRun('')] }));
    }
  }

  const pxToCm = (px: number): number => (px * 2.54) / 96;
  // Los márgenes salen de la misma medición que usan el editor/HTML/PDF.
  const topMarginCm = Math.max(design.margins.top, pxToCm(paginated.layout.topInsetPx));
  const footerImageReserveCm =
    chrome?.footer.enabled && chrome.footer.images?.length ? 0.3 : 0;
  const bottomMarginCm =
    Math.max(design.margins.bottom, pxToCm(paginated.layout.bottomInsetPx)) +
    footerImageReserveCm;
  const headerNodes: (Paragraph | Table)[] = [];

  if (design.logo.enabled && design.logo.dataUrl) {
    const logo = imageFrom({
      type: 'image',
      attrs: {
        src: design.logo.dataUrl,
        width: design.logo.width,
        align: design.logo.align,
        float: 'none',
      },
    });
    if (logo) headerNodes.push(logo);
  }

  if (design.letterhead.enabled) {
    headerNodes.push(
      new Paragraph({
        alignment: alignment(design.letterhead.align),
        children: [
          new TextRun({
            text: [design.letterhead.title, design.letterhead.subtitle].filter(Boolean).join(' — '),
            bold: true,
            color: hex(design.primaryColor),
            size: 16,
          }),
        ],
      }),
    );
  }

  if (chrome?.header.enabled) {
    headerNodes.push(
      ...chromeBlocksWithWidth(chrome.header, values, design, contentWidthTwips),
    );
    headerNodes.push(...bandImageParagraphs(chrome.header, design, 'header', pageHeightCm));
  }

  const header = headerNodes.length > 0 ? new Header({ children: headerNodes }) : undefined;

  const footerNodes: (Paragraph | Table)[] = [];
  if (chrome) {
    if (chrome.footer.enabled) {
      footerNodes.push(
        ...chromeBlocksWithWidth(chrome.footer, values, design, contentWidthTwips),
      );
      footerNodes.push(...bandImageParagraphs(chrome.footer, design, 'footer', pageHeightCm));
    }
  } else if (design.footer.enabled) {
    // Compatibilidad con llamadas sin chrome resuelto.
    footerNodes.push(
      new Paragraph({
        alignment: alignment(design.footer.align),
        children: [
          new TextRun({
            text: design.footer.content.replace(/\{page\}/g, '').replace(/\{total\}/g, '').trim() + ' ',
            size: 16,
            color: hex(design.textColor),
          }),
          ...(design.footer.showPageNumber
            ? [
                new TextRun({ children: ['Página ', PageNumber.CURRENT], size: 16 }),
                ...(design.footer.showTotal
                  ? [new TextRun({ children: [' de ', PageNumber.TOTAL_PAGES], size: 16 })]
                  : []),
              ]
            : []),
        ],
      }),
    );
  }

  const footer = footerNodes.length > 0 ? new Footer({ children: footerNodes }) : undefined;

  const doc = new Document({
    title: options.title ?? 'Documento',
    creator: 'SirpefOffice',
    styles: {
      default: {
        document: {
          run: {
            font: design.fontFamily.split(',')[0]?.trim() ?? 'Arial',
            size: Math.round(design.fontSize * 2),
            color: hex(design.textColor),
          },
          paragraph: {
            spacing: {
              line: Math.round(design.fontSize * design.lineHeight * 20),
            },
          },
        },
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: {
            size: Math.round(design.fontSize * 2 * 1.9 * design.headingScale),
            bold: true,
            color: hex(design.primaryColor),
          },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: {
            size: Math.round(design.fontSize * 2 * 1.45 * design.headingScale),
            bold: true,
            color: hex(design.primaryColor),
          },
          paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 },
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: {
            size: Math.round(design.fontSize * 2 * 1.2 * design.headingScale),
            bold: true,
            color: hex(design.primaryColor),
          },
          paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2 },
        },
      ],
    },
    numbering: {
      config: [
        {
          reference: 'bullet-list',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '•',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
            {
              level: 1,
              format: LevelFormat.BULLET,
              text: '◦',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 1440, hanging: 360 } } },
            },
          ],
        },
        {
          reference: 'ordered-list',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
            {
              level: 1,
              format: LevelFormat.LOWER_LETTER,
              text: '%2.',
              alignment: AlignmentType.LEFT,
              style: { paragraph: { indent: { left: 1440, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: twips(pageWidthCm),
              height: twips(pageHeightCm),
              orientation: landscape ? 'landscape' : 'portrait',
            },
            margin: {
              top: twips(topMarginCm),
              right: twips(design.margins.right),
              bottom: twips(bottomMarginCm),
              left: twips(design.margins.left),
              // Con imágenes de banda, el texto empieza en el mismo origen que
              // las imágenes (borde superior / margen inferior) para que ambos
              // compartan el sistema de coordenadas.
              header: twips(
                chrome?.header.enabled && chrome.header.images?.length
                  ? 0
                  : design.margins.header,
              ),
              footer: twips(design.margins.footer),
            },
          },
        },
        headers: header ? { default: header } : undefined,
        footers: footer ? { default: footer } : undefined,
        children,
      },
    ],
  });

  return Packer.toBuffer(doc);
}
