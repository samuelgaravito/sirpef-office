import { eq, sql } from 'drizzle-orm';

import {
  DOC_TYPE_PREFIX,
  DOC_TYPES_WITHOUT_NUMBER,
} from '@sirpefoffice/shared';

import { env } from '../env.js';
import { hashPassword } from '../lib/password.js';
import { db } from './index.js';
import { designs, numberingSeries, templates, users } from './schema.js';
import { seedDesigns, seedTemplates } from './template-seeds.js';

/**
 * Seed idempotente: se puede ejecutar varias veces sin duplicar datos.
 * Crea el administrador, los diseños base y las plantillas iniciales.
 */
async function seed(): Promise<void> {
  console.log('→ Sembrando datos iniciales…\n');

  /* ── Administrador ──────────────────────────────────────────────────── */
  const email = env.SEED_ADMIN_EMAIL.trim().toLowerCase();
  const [existingAdmin] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email}`)
    .limit(1);

  let admin = existingAdmin;

  if (!admin) {
    const passwordHash = await hashPassword(env.SEED_ADMIN_PASSWORD);
    const inserted = await db
      .insert(users)
      .values({
        email,
        name: env.SEED_ADMIN_NAME,
        passwordHash,
        role: 'admin',
      })
      .returning();
    admin = inserted[0];
    console.log(`  ✓ Administrador creado: ${email}`);
  } else {
    console.log(`  · Administrador ya existente: ${email}`);
  }

  if (!admin) throw new Error('No se pudo crear el administrador');

  /* ── Diseños ────────────────────────────────────────────────────────── */
  const designIds: string[] = [];

  for (const design of seedDesigns) {
    const [existing] = await db
      .select({ id: designs.id })
      .from(designs)
      .where(sql`${designs.ownerId} = ${admin.id} and ${designs.name} = ${design.name}`)
      .limit(1);

    if (existing) {
      designIds.push(existing.id);
      console.log(`  · Diseño ya existente: ${design.name}`);
      continue;
    }

    const [created] = await db
      .insert(designs)
      .values({
        ownerId: admin.id,
        name: design.name,
        description: design.description,
        tokens: design.tokens,
        isShared: true,
      })
      .returning({ id: designs.id });

    if (created) {
      designIds.push(created.id);
      console.log(`  ✓ Diseño creado: ${design.name}`);
    }
  }

  /* ── Diseño en uso ──────────────────────────────────────────────────── */
  // Solo puede haber uno por cuenta: si la cuenta aún no tiene ninguno, se
  // enciende el primero (el que usan la mayoría de plantillas).
  const [current] = await db
    .select({ id: designs.id })
    .from(designs)
    .where(sql`${designs.ownerId} = ${admin.id} and ${designs.isCurrent} = true`)
    .limit(1);

  if (!current && designIds.length > 0) {
    await db
      .update(designs)
      .set({ isCurrent: true })
      .where(eq(designs.id, designIds[0]!));
    console.log('  ✓ Diseño en uso: el primero de los diseños');
  }

  /* ── Plantillas ─────────────────────────────────────────────────────── */
  for (const template of seedTemplates) {
    const [existing] = await db
      .select({ id: templates.id })
      .from(templates)
      .where(sql`${templates.ownerId} = ${admin.id} and ${templates.name} = ${template.name}`)
      .limit(1);

    if (existing) {
      console.log(`  · Plantilla ya existente: ${template.name}`);
      continue;
    }

    // Cada plantilla tiene su propia serie: su enumeración (su contador) no
    // se comparte con ninguna otra. El prefijo es solo la etiqueta del
    // número y puede repetirse. Las que no llevan numeración no ocupan serie.
    const numberingEnabled = !DOC_TYPES_WITHOUT_NUMBER.includes(template.docType);
    const prefix = numberingEnabled ? DOC_TYPE_PREFIX[template.docType] : null;

    const [created] = await db
      .insert(templates)
      .values({
        ownerId: admin.id,
        designId: designIds[template.designIndex] ?? null,
        name: template.name,
        docType: template.docType,
        description: template.description,
        schema: template.schema,
        body: template.body,
        aiInstructions: template.aiInstructions,
        isShared: true,
        numberingEnabled,
        numberingPrefix: prefix,
      })
      .returning({ id: templates.id });

    // La serie declara a su plantilla, así que se crea cuando la plantilla ya
    // existe.
    if (prefix && created) {
      await db.insert(numberingSeries).values({
        templateId: created.id,
        templateName: template.name,
        prefix,
        startValue: 1,
        padding: 4,
        includeYear: true,
        createdBy: admin.id,
        updatedBy: admin.id,
      });
    }

    console.log(`  ✓ Plantilla creada: ${template.name}`);
  }

  console.log('\n✔ Seed completado.');
  console.log(`\n  Usuario:    ${email}`);
  console.log(`  Contraseña: ${env.SEED_ADMIN_PASSWORD}\n`);
}

seed()
  .then(async () => {
    await db.$client.end({ timeout: 5 });
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('\n✖ Error en el seed:', error);
    await db.$client.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
