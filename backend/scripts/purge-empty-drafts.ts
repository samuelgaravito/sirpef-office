/**
 * Elimina definitivamente los borradores que nunca llegaron a usarse.
 *
 * Un documento cuenta como "vacío" cuando:
 * - sigue en estado `draft` y no está en la papelera;
 * - nunca se guardó (`version = 1`);
 * - no tiene envíos ni accesos compartidos;
 * - su actividad se limita a la creación;
 * - conserva el título y el contenido por defecto de su plantilla.
 *
 * Son las filas que dejaba el flujo antiguo al abrir una plantilla: se creaba
 * el documento en la base de datos antes de que el usuario escribiera nada.
 *
 * El borrado es **definitivo**: las tablas hijas (`document_versions`,
 * `document_shares`, `comments`, `document_messages`) caen en cascada. Antes
 * de borrar se escribe una bitácora con los datos mínimos de cada fila para
 * poder reconstruirla a mano si hiciera falta.
 *
 * Uso:
 *   npx tsx scripts/purge-empty-drafts.ts                 # simulación
 *   npx tsx scripts/purge-empty-drafts.ts --apply         # ejecuta
 *   npx tsx scripts/purge-empty-drafts.ts --apply --hours=72
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import postgres from 'postgres';

import { stableStringify } from '../src/lib/json.js';
import { env } from '../src/env.js';

const BLANK_CONTENT = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Documento sin título' }],
    },
    { type: 'paragraph' },
  ],
};

const DEFAULT_TITLES = new Set(['Documento sin título', 'Sin título']);

interface Candidate {
  id: string;
  title: string;
  owner_id: string;
  template_id: string | null;
  content: unknown;
  template_name: string | null;
  template_body: unknown;
  created_at: string;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const hoursArg = process.argv.find((arg) => arg.startsWith('--hours='));
  const hours = Math.max(1, Number(hoursArg?.split('=')[1] ?? 24));

  const sql = postgres(env.DATABASE_URL, { max: 5, onnotice: () => {} });

  try {
    const rows = (await sql`
      select d.id,
             d.title,
             d.owner_id,
             d.template_id,
             d.content,
             d.created_at,
             t.name as template_name,
             t.body as template_body
      from documents d
      left join templates t on t.id = d.template_id
      where d.status = 'draft'
        and d.deleted_at is null
        and d.version = 1
        and d.updated_at < now() - ${`${hours} hours`}::interval
        and not exists (select 1 from document_messages m where m.document_id = d.id)
        and not exists (select 1 from document_shares s where s.document_id = d.id)
        and not exists (
          select 1 from activities a
          where a.entity_type = 'document'
            and a.entity_id = d.id
            and a.action <> 'created'
        )
      order by d.updated_at asc
    `) as unknown as Candidate[];

    const empty = rows.filter((row) => {
      const expectedContent = row.template_id ? row.template_body : BLANK_CONTENT;
      const defaultTitle = row.template_name ?? 'Documento sin título';
      return (
        stableStringify(row.content) === stableStringify(expectedContent) &&
        (DEFAULT_TITLES.has(row.title) || row.title === defaultTitle)
      );
    });

    if (empty.length === 0) {
      console.log('No hay borradores vacíos que eliminar.');
      return;
    }

    console.log(`Borradores vacíos encontrados: ${empty.length}\n`);
    for (const row of empty) {
      console.log(
        `  ${row.id}  ${new Date(row.created_at).toISOString().slice(0, 10)}  ` +
          `"${row.title}"`,
      );
    }

    if (!apply) {
      console.log('\nSimulación. Vuelve a ejecutar con --apply para eliminar definitivamente.');
      return;
    }

    const logDir = resolve(process.cwd(), 'data/backups');
    await mkdir(logDir, { recursive: true });
    const logPath = resolve(
      logDir,
      `purge-empty-drafts-${new Date().toISOString().replace(/[:.]/g, '-')}.log`,
    );
    await writeFile(
      logPath,
      `${empty
        .map(
          (row) =>
            `${row.id}\t${row.owner_id}\t${row.template_id ?? '-'}\t${JSON.stringify(row.title)}`,
        )
        .join('\n')}\n`,
      'utf8',
    );
    console.log(`\nBitácora de recuperación: ${logPath}`);

    let deleted = 0;
    await sql.begin(async (tx) => {
      for (const row of empty) {
        await tx`delete from documents where id = ${row.id}`;
        deleted += 1;
      }
    });

    console.log(`\n✔ ${deleted} borrador(es) eliminado(s) definitivamente.`);
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error('Error en la purga:', error);
  process.exit(1);
});
