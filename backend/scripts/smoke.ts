#!/usr/bin/env tsx
/**
 * Comprobación rápida del motor de documentos:
 *   npx tsx scripts/smoke.ts
 *
 * Renderiza la plantilla de nota de entrega con datos de ejemplo y verifica
 * la interpolación de variables y la expansión de filas repetibles.
 */
import { eq } from 'drizzle-orm';

import { db, sql } from '../src/db/index.js';
import { designs, templates } from '../src/db/schema.js';
import { buildDocumentHtml } from '../src/lib/render.js';

const [template] = await db
  .select()
  .from(templates)
  .where(eq(templates.docType, 'delivery_note'))
  .limit(1);

if (!template) throw new Error('No hay plantilla de nota de entrega. Ejecuta el seed.');

const [design] = template.designId
  ? await db.select().from(designs).where(eq(designs.id, template.designId)).limit(1)
  : [undefined];

if (!design) throw new Error('La plantilla no tiene diseño asociado.');

const html = buildDocumentHtml({
  content: template.body,
  design: design.tokens,
  title: 'Nota de entrega',
  values: {
    numero: 'NDE-2026-0001',
    fecha: '2026-10-22',
    receptor: 'María Quispe',
    cargo_receptor: 'Jefa de Almacén',
    entregado_por: 'Samuel Marcos',
    area: 'Logística',
    items: [
      { cantidad: 4, descripcion: 'Laptops Lenovo ThinkPad', unidad: 'unidad', observacion: 'Nuevas' },
      { cantidad: 10, descripcion: 'Cables HDMI', unidad: 'unidad', observacion: '' },
      { cantidad: 2, descripcion: 'Proyectores Epson', unidad: 'unidad', observacion: 'Con estuche' },
    ],
    observaciones: 'Entrega conforme.',
  },
  includeLetterhead: true,
});

const rows = (html.match(/<tr>/g) ?? []).length;
const unresolved = (html.match(/\{\{/g) ?? []).length;

console.log('HTML:', html.length, 'bytes');
console.log('filas <tr>:', rows, '(esperado: 6 = cabecera + 3 ítems + 2 firmas)');
console.log('placeholders sin resolver:', unresolved, '(esperado: 0)');
console.log('contiene "Laptops Lenovo":', html.includes('Laptops Lenovo'));
console.log('contiene "Proyectores":', html.includes('Proyectores'));
console.log('contiene membrete:', html.includes('letterhead'));

let ok = true;
if (rows !== 6) ok = false;
if (unresolved !== 0) ok = false;
if (!html.includes('Laptops Lenovo') || !html.includes('Proyectores')) ok = false;

console.log(ok ? '\n✔ Render OK' : '\n✖ Render con problemas');

await sql.end();
process.exit(ok ? 0 : 1);
