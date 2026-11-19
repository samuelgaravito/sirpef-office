/**
 * Gráficos guardados («Informes»).
 *
 * Se almacena el plan, no las cifras: al abrir un informe se ejecuta de nuevo
 * con los permisos actuales. Solo el propietario los ve; ajena ⇒ 404.
 */
import { and, asc, desc, eq, isNull, max } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { SavedChart } from '@sirpefoffice/shared';

import { askPlanSchema } from '../ai/ask.js';
import { db } from '../../db/index.js';
import { savedCharts } from '../../db/schema.js';
import { authenticate } from '../../lib/auth-guard.js';
import { notFound } from '../../lib/errors.js';

const createSchema = z.object({
  title: z.string().trim().min(1).max(120),
  plan: askPlanSchema,
});

const updateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  position: z.number().int().min(0).max(10_000).optional(),
  plan: askPlanSchema.optional(),
});

const idParams = z.object({ id: z.uuid() });

function toSavedChart(row: typeof savedCharts.$inferSelect): SavedChart {
  return {
    id: row.id,
    title: row.title,
    plan: row.plan,
    position: row.position,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function assertOwned(userId: string, id: string): Promise<void> {
  const [row] = await db
    .select({ id: savedCharts.id })
    .from(savedCharts)
    .where(
      and(
        eq(savedCharts.id, id),
        eq(savedCharts.userId, userId),
        isNull(savedCharts.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw notFound('Gráfico no encontrado');
}

export async function chartRoutes(app: FastifyInstance): Promise<void> {
  app.get('/charts', async (request): Promise<{ items: SavedChart[] }> => {
    const user = await authenticate(request);
    const rows = await db
      .select()
      .from(savedCharts)
      .where(and(eq(savedCharts.userId, user.sub), isNull(savedCharts.deletedAt)))
      .orderBy(asc(savedCharts.position), desc(savedCharts.updatedAt));
    return { items: rows.map(toSavedChart) };
  });

  app.post('/charts', async (request, reply) => {
    const user = await authenticate(request);
    const body = createSchema.parse(request.body);

    const [maxRow] = await db
      .select({ value: max(savedCharts.position) })
      .from(savedCharts)
      .where(eq(savedCharts.userId, user.sub));

    const [row] = await db
      .insert(savedCharts)
      .values({
        userId: user.sub,
        title: body.title,
        plan: body.plan,
        position: Number(maxRow?.value ?? -1) + 1,
      })
      .returning();

    if (!row) throw notFound('No se pudo guardar el gráfico');
    return reply.status(201).send(toSavedChart(row));
  });

  app.patch('/charts/:id', async (request): Promise<SavedChart> => {
    const user = await authenticate(request);
    const { id } = idParams.parse(request.params);
    const body = updateSchema.parse(request.body);
    await assertOwned(user.sub, id);

    const [row] = await db
      .update(savedCharts)
      .set({
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.position !== undefined ? { position: body.position } : {}),
        ...(body.plan !== undefined ? { plan: body.plan } : {}),
        updatedAt: new Date(),
      })
      .where(eq(savedCharts.id, id))
      .returning();

    if (!row) throw notFound('Gráfico no encontrado');
    return toSavedChart(row);
  });

  app.delete('/charts/:id', async (request): Promise<{ ok: true }> => {
    const user = await authenticate(request);
    const { id } = idParams.parse(request.params);
    await assertOwned(user.sub, id);
    await db
      .update(savedCharts)
      .set({ deletedAt: new Date() })
      .where(eq(savedCharts.id, id));
    return { ok: true };
  });
}
