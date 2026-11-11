/**
 * Genera un token de acceso para un usuario (para las pruebas de interfaz).
 *
 *   tsx scripts/dev-token.ts <email>
 */
import { eq } from 'drizzle-orm';

import { db } from '../src/db/index.js';
import { users } from '../src/db/schema.js';
import { signAccessToken } from '../src/lib/jwt.js';

async function main(): Promise<void> {
  const email = (process.argv[2] ?? '').trim().toLowerCase();
  if (!email) throw new Error('Falta el correo del usuario');

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!user) throw new Error(`No existe el usuario ${email}`);

  const token = await signAccessToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
  });

  console.log(token);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
