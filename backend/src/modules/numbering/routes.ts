import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authenticate } from '../../lib/auth-guard.js';
import {
  assertCanEditSeries,
  listNumberingStates,
  updateNumberingSeries,
} from '../../lib/numbering.js';

const updateSchema = z.object({
  startValue: z.number().int().min(1).max(999_999).optional(),
  padding: z.number().int().min(1).max(8).optional(),
  includeYear: z.boolean().optional(),
});

const paramsSchema = z.object({ prefix: z.string().trim().min(1).max(20) });

export async function numberingRoutes(app: FastifyInstance): Promise<void> {
  /** Lista las series con su próximo número. */
  app.get('/', async (request) => {
    const user = await authenticate(request);
    return { items: await listNumberingStates({ sub: user.sub, role: user.role }) };
  });

  /** Ajusta el número inicial, el relleno o el uso del año de una serie. */
  app.put('/:prefix', async (request) => {
    const user = await authenticate(request);
    const { prefix } = paramsSchema.parse(request.params);
    const body = updateSchema.parse(request.body ?? {});

    // Cada serie pertenece a una plantilla: solo su propietario puede
    // cambiar sus ajustes.
    await assertCanEditSeries(prefix, { sub: user.sub, role: user.role });

    const series = await updateNumberingSeries(prefix, body, user.sub);
    return { series };
  });
}
