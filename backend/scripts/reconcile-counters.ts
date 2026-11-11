/**
 * Reconcilia `document_counters` con los documentos realmente emitidos.
 *
 * La fuente de verdad es `documents.numbering_*`: el contador de cada serie y
 * período debe ser el mayor valor emitido. Este script detecta desviaciones
 * (por ejemplo, tras una restauración o un ajuste manual) y, con `--apply`,
 * las corrige.
 *
 * Solo cuentan los documentos **vivos**: un documento en la papelera libera su
 * correlativo, así que su número puede volver a emitirse y no debe fijar el
 * suelo del contador.
 *
 * Uso:
 *   npx tsx scripts/reconcile-counters.ts          # solo informa
 *   npx tsx scripts/reconcile-counters.ts --apply  # corrige
 */
import postgres from 'postgres';

import { env } from '../src/env.js';

interface CounterRow {
  scope: string;
  year: number;
  counter: number;
}

interface MaxRow {
  prefix: string;
  year: number;
  value: number;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const sql = postgres(env.DATABASE_URL, { max: 5, onnotice: () => {} });

  try {
    const counters = (await sql`
      select scope, year, counter from document_counters
    `) as unknown as CounterRow[];

    const maxima = (await sql`
      select numbering_prefix as prefix,
             numbering_year as year,
             max(numbering_value) as value
      from documents
      where numbering_value is not null
        and deleted_at is null
      group by numbering_prefix, numbering_year
    `) as unknown as MaxRow[];

    const maxByKey = new Map<string, number>();
    for (const row of maxima) maxByKey.set(`${row.prefix}:${row.year}`, Number(row.value));

    const orphan = (await sql`
      select id, doc_number
      from documents
      where doc_number is not null
        and numbering_value is null
      limit 100
    `) as unknown as Array<{ id: string; doc_number: string }>;


    const pending: Array<{ scope: string; year: number; current: number; expected: number }> = [];

    for (const row of counters) {
      const expected = maxByKey.get(`${row.scope}:${row.year}`) ?? 0;
      if (Number(row.counter) !== expected) {
        pending.push({
          scope: row.scope,
          year: Number(row.year),
          current: Number(row.counter),
          expected,
        });
      }
    }

    if (orphan.length > 0) {
      console.warn(
        `\n⚠ Hay ${orphan.length} documento(s) con número pero sin identidad de numeración.`,
      );
      console.warn('  Ejecuta primero: npx tsx scripts/backfill-document-numbering.ts\n');
      for (const row of orphan.slice(0, 20)) {
        console.warn(`  - ${row.doc_number}  (documento ${row.id})`);
      }
    }

    if (pending.length === 0) {
      console.log('Los contadores ya coinciden con los documentos emitidos.');
      return;
    }

    console.log('Desviaciones encontradas:\n');
    for (const row of pending) {
      console.log(
        `  serie "${row.scope || '(sin prefijo)'}" · período ${row.year}: ` +
          `contador ${row.current} → debería ser ${row.expected}`,
      );
    }

    if (!apply) {
      console.log('\nModo informativo. Vuelve a ejecutar con --apply para corregir.');
      return;
    }

    await sql.begin(async (tx) => {
      for (const row of pending) {
        if (row.expected === 0) {
          // La serie no tiene documentos emitidos en ese período: se elimina
          // la fila para que la próxima reserva arranque desde `start_value`.
          await tx`
            delete from document_counters
            where scope = ${row.scope} and year = ${row.year}
          `;
          continue;
        }
        await tx`
          update document_counters
          set counter = ${row.expected}
          where scope = ${row.scope} and year = ${row.year}
        `;
      }
    });

    console.log(`\n✔ ${pending.length} contador(es) corregido(s).`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error('Error en la reconciliación:', error);
  process.exit(1);
});
