/**
 * Catálogo compartido de tipografías e interlineados.
 *
 * Los stacks completos se guardan en `DesignTokens.fontFamily`; el nombre
 * corto se usa en el selector de texto del editor. Georama se sirve desde la
 * propia aplicación (frontend y backend), no desde Google Fonts.
 */

export interface DesignFontOption {
  label: string;
  /** Stack CSS completo que se guarda en el diseño. */
  value: string;
  /** Nombre corto para aplicar a un fragmento de texto. */
  inlineValue: string;
}

export const DESIGN_FONT_OPTIONS: readonly DesignFontOption[] = [
  {
    label: 'Inter',
    value: "Inter, 'Helvetica Neue', Arial, sans-serif",
    inlineValue: 'Inter',
  },
  {
    label: 'Georama',
    value: "Georama, Inter, 'Helvetica Neue', Arial, sans-serif",
    inlineValue: 'Georama',
  },
  {
    label: 'Georgia',
    value: "Georgia, 'Times New Roman', serif",
    inlineValue: 'Georgia',
  },
  {
    label: 'Calibri',
    value: "Calibri, 'Segoe UI', Arial, sans-serif",
    inlineValue: 'Calibri',
  },
  {
    label: 'Arial',
    value: 'Arial, Helvetica, sans-serif',
    inlineValue: 'Arial',
  },
  {
    label: 'Times New Roman',
    value: "'Times New Roman', Times, serif",
    inlineValue: 'Times New Roman',
  },
  {
    label: 'Trebuchet MS',
    value: "'Trebuchet MS', 'Segoe UI', sans-serif",
    inlineValue: 'Trebuchet MS',
  },
  {
    label: 'Monoespaciada',
    value: 'ui-monospace, Menlo, Consolas, monospace',
    inlineValue: 'Courier New',
  },
];

/** Opciones del selector de tipografía por fragmento (incluye «Predeterminada»). */
export const INLINE_FONT_OPTIONS = [
  { label: 'Predeterminada', value: '' },
  ...DESIGN_FONT_OPTIONS.map(({ label, inlineValue }) => ({
    label,
    value: inlineValue,
  })),
] as const;

export const MIN_LINE_HEIGHT = 0.8;
export const MAX_LINE_HEIGHT = 3;

export interface LineHeightPreset {
  label: string;
  value: number;
  hint: string;
}

export const LINE_HEIGHT_PRESETS: readonly LineHeightPreset[] = [
  { label: 'Sencillo', value: 1, hint: '1,00' },
  { label: 'Compacto', value: 1.15, hint: '1,15' },
  { label: 'Normal', value: 1.5, hint: '1,50' },
  { label: 'Amplio', value: 1.75, hint: '1,75' },
  { label: 'Doble', value: 2, hint: '2,00' },
];

/** Normaliza el interlineado al rango que acepta el backend. */
export function clampLineHeight(value: unknown, fallback = 1.5): number {
  const numeric = Number(value);
  const safe = Number.isFinite(numeric) ? numeric : fallback;
  return Math.round(Math.min(MAX_LINE_HEIGHT, Math.max(MIN_LINE_HEIGHT, safe)) * 100) / 100;
}
