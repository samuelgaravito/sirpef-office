import { and, desc, eq, ilike, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { DEFAULT_DESIGN_TOKENS } from '@sirpefoffice/shared';

import { db } from '../../db/index.js';
import { designs } from '../../db/schema.js';
import { logActivity } from '../../lib/activity.js';
import { authenticate } from '../../lib/auth-guard.js';
import { setActiveDesign } from '../../lib/active-design.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { designTokensSchema } from '../../lib/validators.js';

const createSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: z.string().max(1000).default(''),
  tokens: designTokensSchema.default(DEFAULT_DESIGN_TOKENS),
  isShared: z.boolean().default(false),
});

/**
 * Actualización parcial explícita: `createSchema.partial()` conserva los
 * valores por defecto de Zod, de modo que un PATCH que solo enviara el nombre
 * borraría la descripción, la compartición y los tokens del diseño.
 */
const updateSchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  description: z.string().max(1000).optional(),
  tokens: designTokensSchema.optional(),
  isShared: z.boolean().optional(),
  expectedVersion: z.number().int().positive().optional(),
});

/** El interruptor «en uso» del diseño. */
const activateSchema = z.object({
  isCurrent: z.boolean(),
});

const listQuery = z.object({
  q: z.string().max(200).optional(),
  scope: z.enum(['all', 'mine', 'shared']).default('all'),
  /** `true` lista solo los diseños en la papelera del usuario. */
  trashed: z.enum(['true', 'false']).optional(),
});

export async function designRoutes(app: FastifyInstance): Promise<void> {
  /** Lista de diseños visibles para el usuario. */
  app.get('/', async (request) => {
    const user = await authenticate(request);
    const query = listQuery.parse(request.query);

    const visibility =
      query.scope === 'mine'
        ? eq(designs.ownerId, user.sub)
        : query.scope === 'shared'
          ? and(eq(designs.isShared, true), sql`${designs.ownerId} <> ${user.sub}`)
          : or(eq(designs.ownerId, user.sub), eq(designs.isShared, true));

    const where = query.trashed === 'true'
      ? [eq(designs.ownerId, user.sub), isNotNull(designs.deletedAt)]
      : [visibility, isNull(designs.deletedAt)];
    if (query.q) where.push(ilike(designs.name, `%${query.q}%`));

    const items = await db
      .select({
        id: designs.id,
        name: designs.name,
        description: designs.description,
        tokens: designs.tokens,
        version: designs.version,
        isShared: designs.isShared,
        isActive: designs.isActive,
        /** Interruptor «en uso»: solo uno por cuenta. */
        isCurrent: designs.isCurrent,
        ownerId: designs.ownerId,
        isMine: sql<boolean>`${designs.ownerId} = ${user.sub}`,
        updatedAt: designs.updatedAt,
        deletedAt: designs.deletedAt,
      })
      .from(designs)
      .where(and(...where))
      .orderBy(desc(designs.updatedAt))
      .limit(200);

    return { items };
  });

  /** Detalle de un diseño. */
  app.get('/:id', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);

    const [row] = await db
      .select()
      .from(designs)
      .where(and(eq(designs.id, id), isNull(designs.deletedAt)))
      .limit(1);
    if (!row) throw notFound('Diseño no encontrado');
    if (row.ownerId !== user.sub && !row.isShared) throw notFound('Diseño no encontrado');

    return { design: row };
  });

  /** Crea un diseño. */
  app.post('/', async (request, reply) => {
    const user = await authenticate(request);
    const body = createSchema.parse(request.body);

    const [created] = await db
      .insert(designs)
      .values({
        ownerId: user.sub,
        name: body.name,
        description: body.description,
        tokens: body.tokens,
        isShared: body.isShared,
      })
      .returning();

    if (!created) throw new Error('No se pudo crear el diseño');
    await logActivity(user.sub, 'design', created.id, 'created', { name: created.name });
    return reply.status(201).send({ design: created });
  });

  /** Actualiza un diseño propio. */
  app.patch('/:id', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = updateSchema.parse(request.body);

    const [row] = await db
      .select()
      .from(designs)
      .where(and(eq(designs.id, id), isNull(designs.deletedAt)))
      .limit(1);
    if (!row) throw notFound('Diseño no encontrado');
    if (row.ownerId !== user.sub) throw forbidden('Solo el propietario puede editar este diseño');

    if (body.expectedVersion !== undefined && body.expectedVersion !== row.version) {
      throw Object.assign(new Error('El diseño cambió en otra sesión'), {
        statusCode: 409,
        code: 'VERSION_CONFLICT',
      });
    }

    const [updated] = await db
      .update(designs)
      .set({
        name: body.name ?? row.name,
        description: body.description ?? row.description,
        tokens: body.tokens ?? row.tokens,
        isShared: body.isShared ?? row.isShared,
        version: row.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(designs.id, id))
      .returning();

    if (!updated) throw new Error('No se pudo actualizar el diseño');
    await logActivity(user.sub, 'design', id, 'updated', { version: updated.version });
    return { design: updated };
  });

  /**
   * Interruptor «en uso».
   *
   * Enciende un diseño y apaga el que lo estuviera: solo puede haber uno en
   * uso por cuenta y es el que dibujan todas las plantillas. Los documentos ya
   * creados no cambian.
   */
  app.post('/:id/activate', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = activateSchema.parse(request.body ?? {});

    const [row] = await db
      .select()
      .from(designs)
      .where(and(eq(designs.id, id), isNull(designs.deletedAt)))
      .limit(1);
    if (!row) throw notFound('Diseño no encontrado');
    if (row.ownerId !== user.sub) {
      throw forbidden('Solo el propietario puede cambiar el diseño en uso');
    }

    const updated = await setActiveDesign(row, body.isCurrent);
    await logActivity(user.sub, 'design', id, body.isCurrent ? 'activated_as_current' : 'deactivated_as_current', {
      name: updated.name,
    });
    return { design: updated };
  });

  /** Duplica un diseño (propio o compartido) en la cuenta del usuario. */
  app.post('/:id/clone', async (request, reply) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = z.object({ name: z.string().trim().min(1).max(160).optional() }).parse(request.body ?? {});

    const [row] = await db
      .select()
      .from(designs)
      .where(and(eq(designs.id, id), isNull(designs.deletedAt)))
      .limit(1);
    if (!row) throw notFound('Diseño no encontrado');
    if (row.ownerId !== user.sub && !row.isShared) throw notFound('Diseño no encontrado');

    const [created] = await db
      .insert(designs)
      .values({
        ownerId: user.sub,
        name: body.name ?? `${row.name} (copia)`,
        description: row.description,
        tokens: row.tokens,
        isShared: false,
      })
      .returning();

    if (!created) throw new Error('No se pudo duplicar el diseño');
    await logActivity(user.sub, 'design', created.id, 'cloned', { from: id });
    return reply.status(201).send({ design: created });
  });

  /** Elimina (borrado lógico) un diseño propio. Las plantillas conservan la referencia. */
  app.delete('/:id', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);

    const [row] = await db
      .select()
      .from(designs)
      .where(and(eq(designs.id, id), isNull(designs.deletedAt)))
      .limit(1);
    if (!row) throw notFound('Diseño no encontrado');
    if (row.ownerId !== user.sub) throw forbidden('Solo el propietario puede eliminar este diseño');

    await db
      .update(designs)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(designs.id, id));
    await logActivity(user.sub, 'design', id, 'deleted', { name: row.name });
    return { ok: true };
  });

  /** Restaura un diseño de la papelera. */
  app.post('/:id/restore', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);

    const [row] = await db.select().from(designs).where(eq(designs.id, id)).limit(1);
    if (!row || !row.deletedAt) throw notFound('Diseño no encontrado');
    if (row.ownerId !== user.sub) throw forbidden('Solo el propietario puede restaurar este diseño');

    await db
      .update(designs)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(designs.id, id));

    await logActivity(user.sub, 'design', id, 'restored', { name: row.name });
    return { ok: true };
  });
}
