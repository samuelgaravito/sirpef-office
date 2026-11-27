import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { authenticate } from '../../lib/auth-guard.js';
import { AppError } from '../../lib/errors.js';
import {
  cancelEmergencyEdit,
  currentApproverId,
  finishEmergencyEdit,
  listEmergencyEdits,
  startEmergencyEdit,
} from './emergency.js';

const startSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, 'Explica el motivo de la edición de emergencia')
    .max(500),
  expectedVersion: z.number().int().positive(),
  code: z.string().trim().regex(/^\d{6}$/, 'El código debe tener 6 dígitos'),
});

const editIdSchema = z.object({ id: z.uuid(), editId: z.uuid() });

export async function emergencyRoutes(app: FastifyInstance): Promise<void> {
  /** Solo el aprobador vigente puede abrir la edición de emergencia. */
  app.post(
    '/documents/:id/emergency-edit',
    { config: { rateLimit: { max: 5, timeWindow: '1 hour' } } },
    async (request) => {
      const user = await authenticate(request);
      const { id } = z.object({ id: z.uuid() }).parse(request.params);
      const body = startSchema.parse(request.body);
      return startEmergencyEdit({
        user,
        documentId: id,
        reason: body.reason,
        expectedVersion: body.expectedVersion,
        code: body.code,
        ip: request.ip,
        userAgent: request.headers['user-agent'] ?? null,
      });
    },
  );

  app.post('/documents/:id/emergency-edit/:editId/finish', async (request) => {
    const user = await authenticate(request);
    const { id, editId } = editIdSchema.parse(request.params);
    const result = await finishEmergencyEdit({ user, documentId: id, editId });
    return { ok: true, ...result };
  });

  app.post('/documents/:id/emergency-edit/:editId/cancel', async (request) => {
    const user = await authenticate(request);
    const { id, editId } = editIdSchema.parse(request.params);
    return cancelEmergencyEdit({ user, documentId: id, editId });
  });

  app.get('/documents/:id/emergency-edits', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    if (user.role !== 'admin') {
      throw new AppError(403, 'EMERGENCY_EDIT_NOT_APPROVER', 'Solo administradores');
    }
    const approverId = await currentApproverId(id);
    if (approverId !== user.sub) {
      throw new AppError(
        403,
        'EMERGENCY_EDIT_NOT_APPROVER',
        'Solo el administrador que aprobó este documento puede ver su historial de emergencia.',
      );
    }
    return { items: await listEmergencyEdits(id) };
  });
}
