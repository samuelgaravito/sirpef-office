import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { MENU_CATALOG, MENU_KEYS, normalizeMenuKeys } from '@sirpefoffice/shared';

import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { authenticate, requireAdmin } from '../../lib/auth-guard.js';
import { notFound } from '../../lib/errors.js';
import { toPublicUser } from '../../lib/mappers.js';

const updateMenusSchema = z.object({
  menus: z.array(z.enum(MENU_KEYS)),
});

export async function menuRoutes(app: FastifyInstance): Promise<void> {
  /** Catálogo de secciones disponibles para la pantalla de asignación. */
  app.get('/catalog', async (request) => {
    await authenticate(request);
    return { menus: MENU_CATALOG };
  });

  /** Usuarios locales con los menús que tienen asignados (solo administradores). */
  app.get('/users', async (request) => {
    await requireAdmin(request);

    const rows = await db.select().from(users).orderBy(asc(users.name));
    return { items: rows.map(toPublicUser) };
  });

  /** Reemplaza la selección de menús de un usuario. */
  app.put('/users/:id', async (request) => {
    await requireAdmin(request);

    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = updateMenusSchema.parse(request.body);

    const [updated] = await db
      .update(users)
      .set({
        menuKeys: normalizeMenuKeys(body.menus),
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();

    if (!updated) throw notFound('Usuario no encontrado');

    return { user: toPublicUser(updated) };
  });
}
