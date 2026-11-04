import type { Extensions } from '@tiptap/core';
import { mergeAttributes } from '@tiptap/core';

import { HardBreak } from '@tiptap/extension-hard-break';
import Highlight from '@tiptap/extension-highlight';
import { Image as BaseImage } from '@tiptap/extension-image';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import TaskItem from '@tiptap/extension-task-item';
import TaskList from '@tiptap/extension-task-list';
import TextAlign from '@tiptap/extension-text-align';
import { TextStyleKit } from '@tiptap/extension-text-style';
import Typography from '@tiptap/extension-typography';
import { UniqueID } from '@tiptap/extension-unique-id';
import { CharacterCount, Placeholder } from '@tiptap/extensions';
import StarterKit from '@tiptap/starter-kit';

import { createImageNodeView, imageStyle } from './image-node-view.js';
import type { ImageFloat } from './image-node-view.js';
import { PageBreak } from './page-break.js';

/**
 * HardBreak de StarterKit con `Shift-Enter` únicamente.
 *
 * `Ctrl/Cmd+Enter` queda libre para el salto de página manual, que es el
 * atajo habitual en procesadores de texto.
 */
const HardBreakWithoutModEnter = HardBreak.extend({
  addKeyboardShortcuts() {
    return {
      'Shift-Enter': () => this.editor.commands.setHardBreak(),
    };
  },
});

/**
 * Imagen extendida: además de src/alt/title/width/height soporta
 * posicionamiento flotante (float, align, offsetX, offsetY) y un
 * redimensionado por esquinas con arrastre libre en los modos flotantes.
 * El `style` inline generado es la única fuente de verdad y se usa igual en
 * el editor, la vista previa y el PDF/HTML exportados.
 */
export const ExtendedImage = BaseImage.extend({
  name: 'image',

  addAttributes() {
    return {
      src: { default: null },
      alt: { default: null },
      title: { default: null },
      width: { default: null },
      height: { default: null },
      float: { default: 'none' },
      align: { default: 'center' },
      offsetX: { default: 0 },
      offsetY: { default: 0 },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'img[src]',
        getAttrs: (el) => {
          const element = el as HTMLElement;
          const style = element.style;
          const width = element.getAttribute('width');
          const height = element.getAttribute('height');
          const cssWidth = style?.width ? parseFloat(style.width) : null;
          const cssHeight = style?.height ? parseFloat(style.height) : null;
          const float = (style?.float as ImageFloat) || 'none';
          const marginLeft = style?.marginLeft ? parseFloat(style.marginLeft) : 0;
          const marginRight = style?.marginRight ? parseFloat(style.marginRight) : 0;
          const marginTop = style?.marginTop ? parseFloat(style.marginTop) : 0;
          return {
            src: element.getAttribute('src'),
            alt: element.getAttribute('alt'),
            title: element.getAttribute('title'),
            width: width ? Number(width) : cssWidth,
            height: height ? Number(height) : cssHeight,
            float,
            align: float === 'right' ? 'right' : 'left',
            offsetX: float === 'right' ? marginRight : marginLeft,
            offsetY: marginTop,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    const merged = { ...HTMLAttributes };
    const attrs = {
      src: merged.src,
      alt: merged.alt,
      title: merged.title,
      width: merged.width,
      height: merged.height,
      float: merged.float,
      align: merged.align,
      offsetX: merged.offsetX,
      offsetY: merged.offsetY,
    };
    return [
      'img',
      mergeAttributes(HTMLAttributes, {
        style: imageStyle(attrs),
        'data-float': attrs.float,
      }),
    ];
  },

  addNodeView() {
    if (typeof document === 'undefined') return null;
    return (props) => createImageNodeView(props as never);
  },
}).configure({ inline: false, allowBase64: true });

/**
 * Extensiones de tabla.
 *
 * TipTap ya soporta `colspan`, `rowspan`, `colwidth` y `align` (texto) en las
 * celdas. Añadimos los atributos que faltan para que el editor y los
 * exportadores compartan la misma información: color de fondo, alineación
 * vertical, padding y propiedades de la tabla.
 */

function parseCssColor(element: HTMLElement): string | null {
  const value = element.getAttribute('data-bg') ?? element.style.backgroundColor;
  return value && value !== 'transparent' ? value : null;
}

function parseVerticalAlign(element: HTMLElement): string | null {
  const value = element.getAttribute('data-valign') ?? element.style.verticalAlign;
  return value === 'top' || value === 'middle' || value === 'bottom' ? value : null;
}

function parsePadding(element: HTMLElement): number | null {
  const raw = element.getAttribute('data-padding') ?? element.style.padding;
  if (!raw) return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

function numberAttr(element: HTMLElement, name: string): number | null {
  const raw = element.getAttribute(name);
  if (raw === null || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

const cellAttributes = {
  backgroundColor: {
    default: null,
    parseHTML: (element: HTMLElement) => parseCssColor(element),
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.backgroundColor ? { 'data-bg': attributes.backgroundColor } : {},
  },
  verticalAlign: {
    default: null,
    parseHTML: (element: HTMLElement) => parseVerticalAlign(element),
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.verticalAlign ? { 'data-valign': attributes.verticalAlign } : {},
  },
  padding: {
    default: null,
    parseHTML: (element: HTMLElement) => parsePadding(element),
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.padding !== null && attributes.padding !== undefined
        ? { 'data-padding': attributes.padding }
        : {},
  },
};

function cellStyle(node: { attrs?: Record<string, unknown> }, HTMLAttributes: Record<string, any>): string {
  const attrs = node.attrs ?? {};
  return [
    HTMLAttributes.style,
    attrs.backgroundColor ? `background-color:${String(attrs.backgroundColor)}` : '',
    attrs.verticalAlign ? `vertical-align:${String(attrs.verticalAlign)}` : '',
    attrs.padding !== null && attrs.padding !== undefined
      ? `padding:${Number(attrs.padding)}px`
      : '',
  ]
    .filter(Boolean)
    .join(';');
}

export const ExtendedTableCell = TableCell.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...cellAttributes,
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const next = { ...HTMLAttributes };
    const style = cellStyle(node, HTMLAttributes);
    if (style) next.style = style;
    return (this.parent as ((props: any) => any) | undefined)?.({ node, HTMLAttributes: next }) ?? ['td', next, 0];
  },
});

export const ExtendedTableHeader = TableHeader.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...cellAttributes,
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const next = { ...HTMLAttributes };
    const style = cellStyle(node, HTMLAttributes);
    if (style) next.style = style;
    return (this.parent as ((props: any) => any) | undefined)?.({ node, HTMLAttributes: next }) ?? ['th', next, 0];
  },
});

const tableAttributes = {
  tableWidth: {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute('data-table-width'),
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.tableWidth ? { 'data-table-width': attributes.tableWidth } : {},
  },
  tableAlign: {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute('data-table-align'),
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.tableAlign ? { 'data-table-align': attributes.tableAlign } : {},
  },
  borderColor: {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute('data-border-color'),
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.borderColor ? { 'data-border-color': attributes.borderColor } : {},
  },
  borderWidth: {
    default: null,
    parseHTML: (element: HTMLElement) => numberAttr(element, 'data-border-width'),
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.borderWidth !== null && attributes.borderWidth !== undefined
        ? { 'data-border-width': attributes.borderWidth }
        : {},
  },
  borderStyle: {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute('data-border-style'),
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.borderStyle ? { 'data-border-style': attributes.borderStyle } : {},
  },
  cellPadding: {
    default: null,
    parseHTML: (element: HTMLElement) => numberAttr(element, 'data-cell-padding'),
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.cellPadding !== null && attributes.cellPadding !== undefined
        ? { 'data-cell-padding': attributes.cellPadding }
        : {},
  },
  tableBackground: {
    default: null,
    parseHTML: (element: HTMLElement) => element.getAttribute('data-table-bg'),
    renderHTML: (attributes: Record<string, unknown>) =>
      attributes.tableBackground ? { 'data-table-bg': attributes.tableBackground } : {},
  },
};

function tableStyle(node: { attrs?: Record<string, unknown> }, HTMLAttributes: Record<string, any>): string {
  const attrs = node.attrs ?? {};
  const width =
    attrs.tableWidth === 'full' || attrs.tableWidth === '100%'
      ? '100%'
      : attrs.tableWidth === 'auto'
        ? 'auto'
        : attrs.tableWidth
          ? `${Number(attrs.tableWidth)}px`
          : '';
  const align = String(attrs.tableAlign ?? '');
  const margin =
    align === 'center'
      ? 'margin-left:auto;margin-right:auto'
      : align === 'right'
        ? 'margin-left:auto;margin-right:0'
        : align === 'left'
          ? 'margin-left:0;margin-right:auto'
          : '';
  const borderWidth = Number(attrs.borderWidth);
  const borderColor = String(attrs.borderColor ?? '');
  const borderStyle = String(attrs.borderStyle ?? 'solid');
  const border =
    Number.isFinite(borderWidth) && borderWidth > 0 && borderColor
      ? `--sd-table-border:${borderWidth}px ${borderStyle} ${borderColor}`
      : '';
  const padding =
    attrs.cellPadding !== null && attrs.cellPadding !== undefined
      ? `--sd-table-padding:${Number(attrs.cellPadding)}px`
      : '';
  const background = attrs.tableBackground
    ? `--sd-table-bg:${String(attrs.tableBackground)}`
    : '';

  return [HTMLAttributes.style, width ? `width:${width}` : '', margin, border, padding, background]
    .filter(Boolean)
    .join(';');
}

export const ExtendedTable = Table.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...tableAttributes,
    };
  },

  renderHTML({ node, HTMLAttributes }) {
    const next = { ...HTMLAttributes };
    const style = tableStyle(node, HTMLAttributes);
    if (style) next.style = style;
    return (
      (this.parent as ((props: any) => any) | undefined)?.({ node, HTMLAttributes: next }) ?? [
        'table',
        next,
        0,
      ]
    );
  },
});

/**
 * Conjunto único de extensiones usado por el editor (Vue) y por el
 * renderizador del servidor. Mantener una sola fuente evita que el HTML
 * exportado difiera de lo que el usuario ve.
 */
export function createEditorExtensions(options?: {
  placeholder?: string;
  /** Las bandas de cabecera/pie no necesitan saltos de página. */
  pageBreak?: boolean;
}): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3, 4] },
      // El historial se gestiona con undo/redo nativo de ProseMirror
      undoRedo: { depth: 200 },
      // Reemplazado abajo para liberar `Mod-Enter`.
      hardBreak: false,
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: { rel: 'noopener noreferrer nofollow', target: '_blank' },
      },
    }),
    HardBreakWithoutModEnter,
    ...(options?.pageBreak === false ? [] : [PageBreak]),
    ExtendedTable.configure({
      resizable: true,
      allowTableNodeSelection: true,
    }),
    TableRow,
    ExtendedTableHeader,
    ExtendedTableCell,
    TextStyleKit,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Highlight.configure({ multicolor: true }),
    Typography,
    ExtendedImage,
    TaskList,
    TaskItem.configure({ nested: true }),
    Subscript,
    Superscript,
    UniqueID.configure({ types: ['heading', 'paragraph', 'tableRow'] }),
    CharacterCount,
    Placeholder.configure({
      placeholder: options?.placeholder ?? 'Escribe aquí o pulsa “/” para insertar contenido…',
      includeChildren: false,
    }),
  ];
}

/** Extensiones sin opciones, para renderizar en el servidor. */
export const editorExtensions: Extensions = createEditorExtensions();
