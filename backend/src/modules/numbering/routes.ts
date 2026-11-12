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

/**
 * La serie se identifica por su id y no por el prefijo: el prefijo es la
 * etiqueta del número y puede repetirse entre plantillas.
 */
const paramsSchema = z.object({ seriesId: z.uuid() });

export async function numberingRoutes(app: FastifyInstance): Promise<void> {
  /** Lista las series con su próximo número. */
  app.get('/', async (request) => {
    const user = await authenticate(request);
    return { items: await listNumberingStates({ sub: user.sub, role: user.role }) };
  });

  /** Ajusta el número inicial, el relleno o el uso del año de una serie. */
  app.put('/:seriesId', async (request) => {
    const user = await authenticate(request);
    const { seriesId } = paramsSchema.parse(request.params);
    const body = updateSchema.parse(request.body ?? {});

    // Cada serie pertenece a una plantilla: solo su propietario puede
    // cambiar sus ajustes.
    await assertCanEditSeries(seriesId, { sub: user.sub, role: user.role });

    const series = await updateNumberingSeries(seriesId, body, user.sub);
    return { series };
  });
}
