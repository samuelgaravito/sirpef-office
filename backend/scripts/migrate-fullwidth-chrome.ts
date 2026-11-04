/**
 * Migra las cabeceras y pies existentes al modelo de ancho de página.
 *
 * Antes, `widthPercent` era un porcentaje del área útil y la banda se centraba
 * dentro de los márgenes. Ahora es un porcentaje del ancho de la página y las
 * bandas se anclan a los bordes. Para que las imágenes no salten de sitio,
 * pasamos todas las bandas a 100 % y desplazamos su `xMm` con el borde
 * izquierdo que tenía la banda antigua.
 *
 * La migración es idempotente: se registra en `app_migrations`.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import postgres from 'postgres';

import { env } from '../src/env.js';
import type { BandImage } from '@sirpefoffice/shared';

const MIGRATION_ID = 'fullwidth-chrome-v1';
const DEFAULT_PAGE = { width: 21, height: 29.7 };

type ChromeLike = {
  widthPercent?: number;
  images?: BandImage[];
  [key: string]: unknown;
};

type DesignContext = {
  pageFormat?: string;
  orientation?: string;
  margins?: {
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
  };
};

type DesignTokensLike = DesignContext & {
  header?: ChromeLike;
  footer?: ChromeLike;
};

type SnapshotLike = {
  tokens?: DesignTokensLike | null;
  header?: ChromeLike | null;
  footer?: ChromeLike | null;
  [key: string]: unknown;
};

const PAGE_SIZES_CM: Record<string, { width: number; height: number }> = {
  A4: DEFAULT_PAGE,
  Letter: { width: 21.59, height: 27.94 },
  Legal: { width: 21.59, height: 35.56 },
  Folio: { width: 21.59, height: 33 },
};

function pageWidthMm(design: DesignContext | null | undefined): number {
  const size = PAGE_SIZES_CM[design?.pageFormat ?? 'A4'] ?? DEFAULT_PAGE;
  return (design?.orientation === 'landscape' ? size.height : size.width) * 10;
}

function pageMargins(design: DesignContext | null | undefined): {
  left: number;
  right: number;
} {
  return {
    left: Number(design?.margins?.left ?? 2.2) * 10,
    right: Number(design?.margins?.right ?? 2.2) * 10,
  };
}

function oldWidthPercent(chrome: ChromeLike): number {
  const value = Number(chrome.widthPercent);
  if (!Number.isFinite(value) || value <= 0) return 100;
  return Math.min(200, Math.max(20, Math.round(value)));
}

/**
 * Convierte una banda al nuevo modelo. Las imágenes que ya ocupaban la página
 * completa se dejan intactas; el resto se desplaza para conservar su posición
 * absoluta en la hoja.
 */
function migrateChrome<T extends ChromeLike>(
  chrome: T | null | undefined,
  design: DesignContext | null | undefined,
): T | null | undefined {
  if (!chrome) return chrome;

  const pageWidth = pageWidthMm(design);
  const { left, right } = pageMargins(design);
  const contentWidth = Math.max(1, pageWidth - left - right);
  const percent = oldWidthPercent(chrome);
  const oldBandWidth = (contentWidth * percent) / 100;
  const oldBandLeft = left + (contentWidth - oldBandWidth) / 2;

  const images = Array.isArray(chrome.images)
    ? chrome.images.map((image) => {
        const x = Number(image.xMm) || 0;
        const width = Number(image.widthMm) || 0;
        // Un encabezado/pie a sangre ya estaba medido contra la página.
        const alreadyFullPage = x <= 1.5 && width >= pageWidth - 2;
        const shift = alreadyFullPage ? 0 : oldBandLeft;
        const maxX = Math.max(0, pageWidth - width);
        const newX = Math.min(maxX, Math.max(0, x + shift));
        return {
          ...image,
          xMm: Math.round(newX * 100) / 100,
          fit: image.fit === 'fill' ? ('fill' as const) : ('contain' as const),
        };
      })
    : chrome.images;

  return {
    ...chrome,
    widthPercent: 100,
    ...(images ? { images } : {}),
  };
}

function migrateDesignTokens(tokens: DesignTokensLike): DesignTokensLike {
  return {
    ...tokens,
    header: migrateChrome(tokens.header, tokens) ?? tokens.header,
    footer: migrateChrome(tokens.footer, tokens) ?? tokens.footer,
  };
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

async function main(): Promise<void> {
  const sql = postgres(env.DATABASE_URL, { max: 5, onnotice: () => {} });

  try {
    await sql`
      create table if not exists app_migrations (
        id text primary key,
        applied_at timestamptz not null default now(),
        details jsonb not null default '{}'::jsonb
      )
    `;

    const [already] = await sql`
      select id from app_migrations where id = ${MIGRATION_ID} limit 1
    `;
    if (already) {
      console.log(`La migración ${MIGRATION_ID} ya se aplicó. Nada que hacer.`);
      return;
    }

    const backup = {
      createdAt: new Date().toISOString(),
      migration: MIGRATION_ID,
      designs: await sql`select * from designs`,
      templates: await sql`select * from templates`,
      documents: await sql`select * from documents`,
      documentVersions: await sql`select * from document_versions`,
      templateVersions: await sql`select * from template_versions`,
    };

    const backupDir = resolve(process.cwd(), 'data/backups');
    await mkdir(backupDir, { recursive: true });
    const backupPath = resolve(
      backupDir,
      `fullwidth-chrome-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    );
    await writeFile(backupPath, JSON.stringify(backup, null, 2), 'utf8');
    console.log(`Copia de seguridad: ${backupPath}`);

    const counts = {
      designs: 0,
      templates: 0,
      documents: 0,
      documentVersions: 0,
      templateVersions: 0,
    };

    await sql.begin(async (tx) => {
      /* ── Diseños ─────────────────────────────────────────────────────── */
      const designContexts = new Map<string, DesignTokensLike>();
      for (const row of backup.designs as Array<{ id: string; tokens: DesignTokensLike }>) {
        designContexts.set(row.id, row.tokens);
      }

      for (const row of backup.designs as Array<{ id: string; tokens: DesignTokensLike }>) {
        const next = migrateDesignTokens(row.tokens);
        if (sameJson(next, row.tokens)) continue;
        await tx`update designs set tokens = ${tx.json(next)} where id = ${row.id}`;
        counts.designs += 1;
      }

      /* ── Plantillas ──────────────────────────────────────────────────── */
      const templateDesigns = new Map<string, DesignTokensLike | null>();
      for (const row of backup.templates as Array<{
        id: string;
        designId: string | null;
        header: ChromeLike | null;
        footer: ChromeLike | null;
      }>) {
        const design = row.designId ? designContexts.get(row.designId) ?? null : null;
        templateDesigns.set(row.id, design);

        const header = migrateChrome(row.header, design);
        const footer = migrateChrome(row.footer, design);
        if (sameJson(header, row.header) && sameJson(footer, row.footer)) continue;

        await tx`
          update templates
          set header = ${header ? tx.json(header) : null},
              footer = ${footer ? tx.json(footer) : null}
          where id = ${row.id}
        `;
        counts.templates += 1;
      }

      /* ── Documentos ──────────────────────────────────────────────────── */
      const documentDesigns = new Map<string, DesignTokensLike | null>();
      for (const row of backup.documents as Array<{
        id: string;
        designId: string | null;
        templateId: string | null;
        header: ChromeLike | null;
        footer: ChromeLike | null;
      }>) {
        const design =
          (row.designId ? designContexts.get(row.designId) : null) ??
          (row.templateId ? templateDesigns.get(row.templateId) : null) ??
          null;
        documentDesigns.set(row.id, design);

        const header = migrateChrome(row.header, design);
        const footer = migrateChrome(row.footer, design);
        if (sameJson(header, row.header) && sameJson(footer, row.footer)) continue;

        await tx`
          update documents
          set header = ${header ? tx.json(header) : null},
              footer = ${footer ? tx.json(footer) : null}
          where id = ${row.id}
        `;
        counts.documents += 1;
      }

      /* ── Versiones de documentos ─────────────────────────────────────── */
      for (const row of backup.documentVersions as Array<{
        id: string;
        documentId: string;
        header: ChromeLike | null;
        footer: ChromeLike | null;
      }>) {
        const design = documentDesigns.get(row.documentId) ?? null;
        const header = migrateChrome(row.header, design);
        const footer = migrateChrome(row.footer, design);
        if (sameJson(header, row.header) && sameJson(footer, row.footer)) continue;

        await tx`
          update document_versions
          set header = ${header ? tx.json(header) : null},
              footer = ${footer ? tx.json(footer) : null}
          where id = ${row.id}
        `;
        counts.documentVersions += 1;
      }

      /* ── Versiones de plantillas ─────────────────────────────────────── */
      for (const row of backup.templateVersions as Array<{
        id: string;
        templateId: string;
        snapshot: SnapshotLike;
      }>) {
        const currentDesign = templateDesigns.get(row.templateId) ?? null;
        const context = row.snapshot.tokens ?? currentDesign;
        const next: SnapshotLike = {
          ...row.snapshot,
          ...(row.snapshot.tokens
            ? { tokens: migrateDesignTokens(row.snapshot.tokens) }
            : {}),
          header: migrateChrome(row.snapshot.header, context),
          footer: migrateChrome(row.snapshot.footer, context),
        };
        if (sameJson(next, row.snapshot)) continue;

        await tx`
          update template_versions
          set snapshot = ${tx.json(next)}
          where id = ${row.id}
        `;
        counts.templateVersions += 1;
      }

      await tx`
        insert into app_migrations (id, details)
        values (${MIGRATION_ID}, ${tx.json(counts)})
      `;
    });

    console.log('Migración completada:', counts);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error('Error en la migración:', error);
  process.exit(1);
});
