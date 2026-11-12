/**
 * Migra los correlativos existentes al modelo de numeración por plantilla.
 *
 * Hace tres cosas, de forma idempotente (se registra en `app_migrations`):
 *
 * 1. Libera el número de los documentos que siguen en borrador: un borrador
 *    no debe consumir la secuencia.
 * 2. Rellena la identidad de numeración de los documentos ya oficiales
 *    (`numbering_prefix/year/value` y `numbering_series_id`) para poder
 *    recalcular `document_counters` sin parsear el texto formateado.
 * 3. Recalcula `document_counters` desde los documentos realmente emitidos.
 *
 * Cada serie pertenece a una plantilla, así que el documento se asocia a la
 * serie de su plantilla (si el prefijo coincide) y no a una serie suelta
 * elegida por el prefijo: dos plantillas pueden compartir prefijo y cada una
 * lleva su propia enumeración.
 *
 * Antes de tocar nada guarda una copia JSON de `documents` y
 * `document_counters` en `data/backups/`. Si algún documento con número no
 * encaja con ninguna serie, aborta sin aplicar: reutilizar un número ya
 * emitido rompería el índice único.
 *
 * Uso: npx tsx scripts/backfill-document-numbering.ts
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import postgres from 'postgres';

import { env } from '../src/env.js';

const MIGRATION_ID = 'numbering-backfill-v1';

interface SeriesRow {
  id: string;
  prefix: string;
  start_value: number;
  padding: number;
  include_year: boolean;
}

interface ParsedNumber {
  prefix: string;
  year: number;
  value: number;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Asocia un número formateado con su serie. Se prueban primero los prefijos
 * más largos para resolver la ambigüedad de `2026-0007` (serie `2026` sin año
 * frente a serie sin prefijo con año).
 *
 * El formato actual es `PREFIX-CORRELATIVO-AÑO` (`MEM-0007-2026`). Los
 * números emitidos antes del cambio de orden son `PREFIX-AÑO-CORRELATIVO`
 * (`MEM-2026-0007`).
 *
 * Cuando ambos formatos son posibles (los dos últimos bloques tienen cuatro
 * dígitos) se prefiere el actual, que es el que genera el sistema hoy. Los
 * números antiguos solo se distinguen cuando el bloque final parece un año y
 * el anterior no.
 */
function parseNumber(number: string, series: SeriesRow[]): ParsedNumber | null {
  const ordered = [...series].sort((a, b) => b.prefix.length - a.prefix.length);

  for (const row of ordered) {
    const head = row.prefix ? `${escapeRegex(row.prefix)}-` : '';

    if (!row.include_year) {
      const match = new RegExp(`^${head}(\\d+)$`).exec(number);
      if (match) {
        return { prefix: row.prefix, year: 0, value: Number(match[1]) };
      }
      continue;
    }

    const current = new RegExp(`^${head}(\\d+)-(\\d{4})$`).exec(number);
    const legacy = new RegExp(`^${head}(\\d{4})-(\\d+)$`).exec(number);

    // Sin ambigüedad: solo uno de los dos patrones encaja.
    if (current && !legacy) {
      return { prefix: row.prefix, year: Number(current[2]), value: Number(current[1]) };
    }
    if (legacy && !current) {
      return { prefix: row.prefix, year: Number(legacy[1]), value: Number(legacy[2]) };
    }

    if (current && legacy) {
      // Ambos encajan: el año es el bloque de cuatro dígitos que parece un
      // año. El formato actual lo pone al final.
      const currentYear = Number(current[2]);
      const legacyYear = Number(legacy[1]);
      const plausible = (value: number) => value >= 1990 && value <= 2999;

      if (plausible(currentYear) && !plausible(legacyYear)) {
        return { prefix: row.prefix, year: currentYear, value: Number(current[1]) };
      }
      if (plausible(legacyYear) && !plausible(currentYear)) {
        return { prefix: row.prefix, year: legacyYear, value: Number(legacy[2]) };
      }
      // Si los dos son años plausibles, manda el formato vigente.
      return { prefix: row.prefix, year: currentYear, value: Number(current[1]) };
    }
  }

  return null;
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

    const series = (await sql`
      select id, prefix, start_value, padding, include_year from numbering_series
    `) as unknown as SeriesRow[];

    const numbered = (await sql`
      select d.id, d.doc_number, d.status, d.data, d.template_id,
             t.numbering_series_id as template_series_id,
             s.prefix as template_series_prefix
      from documents d
      left join templates t on t.id = d.template_id
      left join numbering_series s on s.id = t.numbering_series_id
      where d.doc_number is not null
      order by d.created_at
    `) as unknown as Array<{
      id: string;
      doc_number: string;
      status: string;
      data: Record<string, unknown> | null;
      template_id: string | null;
      template_series_id: string | null;
      template_series_prefix: string | null;
    }>;

    interface Resolved {
      id: string;
      seriesId: string | null;
      prefix: string;
      year: number;
      value: number;
    }

    const parsed = new Map<string, Resolved>();
    const unmatched: Array<{ id: string; docNumber: string }> = [];

    for (const row of numbered) {
      const match = parseNumber(row.doc_number, series);
      if (!match) {
        unmatched.push({ id: row.id, docNumber: row.doc_number });
        continue;
      }

      // La serie del documento es la de su plantilla (si el prefijo coincide);
      // si no, la serie huérfana que lleva ese prefijo.
      let seriesId: string | null = null;
      if (row.template_series_id && row.template_series_prefix === match.prefix) {
        seriesId = row.template_series_id;
      } else {
        const [orphan] = (await sql`
          select s.id from numbering_series s
          where s.prefix = ${match.prefix}
            and not exists (
              select 1 from templates t where t.numbering_series_id = s.id
            )
          order by s.created_at
          limit 1
        `) as unknown as Array<{ id: string }>;
        seriesId = orphan?.id ?? null;
      }

      parsed.set(row.id, { id: row.id, seriesId, ...match });
    }

    if (unmatched.length > 0) {
      console.error(
        `\n✖ Hay ${unmatched.length} documento(s) con número que no encajan en ninguna serie.`,
      );
      console.error('  No se aplicó ningún cambio. Corrige las series y vuelve a ejecutar:\n');
      for (const row of unmatched.slice(0, 50)) {
        console.error(`  - ${row.docNumber}  (documento ${row.id})`);
      }
      process.exit(1);
    }

    const backup = {
      createdAt: new Date().toISOString(),
      migration: MIGRATION_ID,
      documents: await sql`select * from documents`,
      documentCounters: await sql`select * from document_counters`,
    };

    const backupDir = resolve(process.cwd(), 'data/backups');
    await mkdir(backupDir, { recursive: true });
    const backupPath = resolve(
      backupDir,
      `numbering-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    );
    await writeFile(backupPath, JSON.stringify(backup, null, 2), 'utf8');
    console.log(`Copia de seguridad: ${backupPath}`);

    const counts = {
      releasedDrafts: 0,
      numbered: 0,
      countersUpdated: 0,
      countersKept: 0,
    };

    await sql.begin(async (tx) => {
      /* 1. Liberar borradores. */
      const released = await tx`
        update documents
        set doc_number = null,
            numbering_prefix = null,
            numbering_year = null,
            numbering_value = null,
            numbering_series_id = null,
            data = case
              when data ? 'numero' then data - 'numero'
              else data
            end
        where doc_number is not null
          and status = 'draft'
          and deleted_at is null
        returning id
      `;
      counts.releasedDrafts = released.length;

      /* 2. Rellenar la identidad de numeración de los oficiales. */
      for (const row of numbered) {
        if (row.status === 'draft') continue;
        const match = parsed.get(row.id);
        if (!match) continue;

        await tx`
          update documents
          set numbering_prefix = ${match.prefix},
              numbering_year = ${match.year},
              numbering_value = ${match.value},
              numbering_series_id = ${match.seriesId}
          where id = ${row.id}
        `;
        counts.numbered += 1;
      }

      /* 3. Recalcular contadores desde los documentos emitidos. */
      const maxima = (await tx`
        select numbering_series_id as series_id,
               numbering_year as year,
               max(numbering_value) as value
        from documents
        where numbering_value is not null
          and deleted_at is null
          and numbering_series_id is not null
        group by numbering_series_id, numbering_year
      `) as unknown as Array<{ series_id: string; year: number; value: number }>;

      for (const row of maxima) {
        await tx`
          insert into document_counters (series_id, year, counter)
          values (${row.series_id}, ${row.year}, ${row.value})
          on conflict (series_id, year)
          do update set counter = ${row.value}
        `;
        counts.countersUpdated += 1;
      }

      /**
       * Series cuyos documentos eran todos borradores: el contador vigente se
       * quedó alto. Si no hay ningún documento emitido en el período actual,
       * se devuelve al valor inicial para no arrastrar el hueco.
       */
      for (const row of series) {
        const year = row.include_year ? new Date().getFullYear() : 0;
        const hasOfficial = maxima.some(
          (item) => item.series_id === row.id && Number(item.year) === year,
        );
        if (hasOfficial) continue;

        const updated = await tx`
          update document_counters
          set counter = ${row.start_value - 1}
          where series_id = ${row.id}
            and year = ${year}
            and counter >= ${row.start_value}
          returning series_id
        `;
        counts.countersUpdated += updated.length;
        counts.countersKept += 1;
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
