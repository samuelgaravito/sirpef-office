import type { DesignTokens } from './types.js';

/** Tokens de diseño por defecto: A4, Arial 11pt, paleta institutional sobria. */
export const DEFAULT_DESIGN_TOKENS: DesignTokens = {
  fontFamily: 'Arial, Helvetica, sans-serif',
  fontSize: 11,
  lineHeight: 1.5,
  primaryColor: '#1f3a5f',
  textColor: '#1a1a1a',
  backgroundColor: '#ffffff',
  tableHeadColor: '#e8eef5',
  tableBorderColor: '#c9d2dd',
  accentColor: '#c0392b',
  pageFormat: 'A4',
  orientation: 'portrait',
  margins: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5, header: 1.25, footer: 1.25 },
  header: {
    enabled: false,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    align: 'center',
    heightMm: 18,
    widthPercent: 100,
    images: [],
  },
  footer: {
    enabled: true,
    content: 'Página {page} de {total}',
    align: 'center',
    showPageNumber: true,
    showTotal: true,
    heightMm: 16,
    widthPercent: 100,
    images: [],
  },
  logo: { enabled: false, dataUrl: '', width: 120, align: 'center' },
  letterhead: { enabled: false, title: '', subtitle: '', align: 'center' },
  headingScale: 1,
};

/** Tamaño de página en centímetros. */
export const PAGE_SIZES_CM: Record<string, { width: number; height: number }> = {
  A4: { width: 21, height: 29.7 },
  Letter: { width: 21.59, height: 27.94 },
  Legal: { width: 21.59, height: 35.56 },
  Folio: { width: 21.59, height: 33 },
};

/** Formatos de archivo para exportar. */
export const EXPORT_FORMATS = ['pdf', 'docx', 'html'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
