import { eq } from 'drizzle-orm';

import { db } from '../src/db/index.js';
import { users } from '../src/db/schema.js';
import { env } from '../src/env.js';
import { hashPassword } from '../src/lib/password.js';

/**
 * Actualiza el email y la contraseña del administrador a los valores del seed.
 * Se usa después de migrar una base de datos antigua para alinear las
 * credenciales con la nueva marca.
 */
async function main(): Promise<void> {
  const email = env.SEED_ADMIN_EMAIL.trim().toLowerCase();
  const passwordHash = await hashPassword(env.SEED_ADMIN_PASSWORD);

  const [admin] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.role, 'admin'))
    .limit(1);

  if (!admin) throw new Error('No se encontró ningún administrador.');

  await db
    .update(users)
    .set({ email, passwordHash, updatedAt: new Date() })
    .where(eq(users.id, admin.id));

  console.log(`Administrador actualizado: ${email}`);
}

main()
  .then(async () => {
    await db.$client.end({ timeout: 5 });
    process.exit(0);
  })
  .catch(async (error) => {
    console.error('\n✖ Error al actualizar el administrador:', error);
    await db.$client.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
