import { db } from '../db/index.js';
import { activities } from '../db/schema.js';

/** Registra una acción en el historial de auditoría. */
export async function logActivity(
  userId: string | null,
  entityType: 'document' | 'template' | 'design' | 'user' | 'comment',
  entityId: string,
  action: string,
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(activities).values({ userId, entityType, entityId, action, meta });
  } catch (error) {
    // La auditoría nunca debe romper la operación principal
    console.error('No se pudo registrar la actividad:', error);
  }
}
