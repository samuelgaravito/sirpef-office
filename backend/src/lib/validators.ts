import { z } from 'zod';

import { DOCUMENT_NUMBER_VARIABLE, DOC_TYPES, type ChromeConfig, type DesignTokens, type JSONContent } from '@sirpefoffice/shared';

export const docTypeSchema = z.enum(DOC_TYPES);

/* ─────────────────────────── Contenido TipTap ─────────────────────────── */

export const jsonContentSchema: z.ZodType<JSONContent> = z.lazy(() =>
  z.object({
    type: z.string().optional(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    content: z.array(jsonContentSchema).optional(),
    marks: z
      .array(
        z.object({
          type: z.string(),
          attrs: z.record(z.string(), z.unknown()).optional(),
        }),
      )
      .optional(),
    text: z.string().optional(),
  }),
);

/* ────────────────────────── Cabecera y pie ──────────────────────────── */

export const bandImageSchema = z.object({
  id: z.string().min(1).max(120),
  src: z.string().min(1).max(3_000_000),
  xMm: z.number().min(0).max(1000),
  yMm: z.number().min(0).max(1000),
  widthMm: z.number().min(1).max(500),
  heightMm: z.number().min(1).max(500),
  fit: z.enum(['contain', 'fill']).optional(),
  naturalWidth: z.number().min(1).max(100_000).optional(),
  naturalHeight: z.number().min(1).max(100_000).optional(),
  opacity: z.number().min(0).max(1).optional(),
  zIndex: z.number().int().min(-20).max(20).optional(),
});

export const chromeConfigSchema: z.ZodType<ChromeConfig> = z.object({
  enabled: z.boolean(),
  content: jsonContentSchema,
  heightMm: z.number().min(5).max(80),
  widthPercent: z.number().min(20).max(100).optional(),
  images: z.array(bandImageSchema).max(20).optional(),
});

/** `null` significa heredar del nivel siguiente. */
export const chromeOverrideSchema = chromeConfigSchema.nullable();

/* ────────────────────────────── Variables ────────────────────────────── */

export const variableTypeSchema = z.enum([
  'text',
  'longtext',
  'date',
  'number',
  'money',
  'select',
  'multiselect',
  'checkbox',
  'table',
  'image',
  'user',
]);

export const variableDefSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z][a-zA-Z0-9_]*$/, 'La clave debe empezar por letra y usar solo letras, números o _'),
    label: z.string().min(1).max(200),
    type: variableTypeSchema,
    required: z.boolean().optional(),
    description: z.string().max(500).optional(),
    defaultValue: z.unknown().optional(),
    options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
    columns: z
      .array(
        z.object({
          key: z.string(),
          label: z.string(),
          type: z.enum(['text', 'number', 'money', 'date']).optional(),
        }),
      )
      .optional(),
    aiHint: z.string().max(1000).optional(),
  })
  .refine((variable) => variable.key !== DOCUMENT_NUMBER_VARIABLE, {
    message: `La clave "${DOCUMENT_NUMBER_VARIABLE}" está reservada para el sistema`,
    path: ['key'],
  });

/* ─────────────────────────────── Diseños ─────────────────────────────── */

export const pageFormatSchema = z.enum(['A4', 'Letter', 'Legal', 'Folio']);

export const designTokensSchema: z.ZodType<DesignTokens> = z.object({
  fontFamily: z.string().min(1).max(200),
  fontSize: z.number().min(6).max(36),
  lineHeight: z.number().min(0.8).max(3),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  textColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  backgroundColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  tableHeadColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  tableBorderColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  pageFormat: pageFormatSchema,
  orientation: z.enum(['portrait', 'landscape']),
  margins: z.object({
    top: z.number().min(0).max(10),
    right: z.number().min(0).max(10),
    bottom: z.number().min(0).max(10),
    left: z.number().min(0).max(10),
    header: z.number().min(0).max(10),
    footer: z.number().min(0).max(10),
  }),
  header: z.object({
    enabled: z.boolean(),
    content: jsonContentSchema,
    align: z.enum(['left', 'center', 'right']),
    heightMm: z.number().min(5).max(80).optional(),
    widthPercent: z.number().min(20).max(100).optional(),
    images: z.array(bandImageSchema).max(20).optional(),
  }),
  footer: z.object({
    enabled: z.boolean(),
    content: z.string().max(500),
    align: z.enum(['left', 'center', 'right']),
    showPageNumber: z.boolean(),
    showTotal: z.boolean(),
    heightMm: z.number().min(5).max(80).optional(),
    widthPercent: z.number().min(20).max(100).optional(),
    images: z.array(bandImageSchema).max(20).optional(),
  }),
  logo: z.object({
    enabled: z.boolean(),
    dataUrl: z.string().max(2_000_000),
    width: z.number().min(20).max(600),
    align: z.enum(['left', 'center', 'right']),
  }),
  letterhead: z.object({
    enabled: z.boolean(),
    title: z.string().max(200),
    subtitle: z.string().max(300),
    align: z.enum(['left', 'center', 'right']),
  }),
  headingScale: z.number().min(0.6).max(1.8),
});
