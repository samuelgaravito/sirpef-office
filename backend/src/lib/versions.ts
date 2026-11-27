import { desc, eq } from 'drizzle-orm';

import { db } from '../db/index.js';
import { documentVersions, documents } from '../db/schema.js';

/**
 * Guarda un snapshot en el historial. Para no llenar la tabla con un registro
 * por cada autoguardado, si la última versión es 'auto' y tiene menos de
 * `AUTO_MERGE_MS`, se reemplaza en lugar de insertar otra.
 */
const AUTO_MERGE_MS = 90_000;

export async function saveVersion(
  documentId: string,
  userId: string,
  kind: 'auto' | 'manual' | 'ai' | 'export' | 'restore' | 'emergency',
  note = '',
): Promise<void> {
  const [doc] = await db.select().from(documents).where(eq(documents.id, documentId)).limit(1);
  if (!doc) return;

  const [last] = await db
    .select()
    .from(documentVersions)
    .where(eq(documentVersions.documentId, documentId))
    .orderBy(desc(documentVersions.version))
    .limit(1);

  const snapshot = {
    content: doc.content,
    header: doc.header,
    footer: doc.footer,
    data: doc.data,
    title: doc.title,
    kind,
    note,
    createdBy: userId,
  };

  if (last && last.version === doc.version) {
    await db.update(documentVersions).set(snapshot).where(eq(documentVersions.id, last.id));
    return;
  }

  const canMerge =
    kind === 'auto' &&
    last?.kind === 'auto' &&
    Date.now() - last.createdAt.getTime() < AUTO_MERGE_MS;

  if (canMerge && last) {
    // Reemplaza la versión auto reciente (misma fila, nuevo contenido)
    await db
      .update(documentVersions)
      .set({ ...snapshot, version: doc.version })
      .where(eq(documentVersions.id, last.id));
    return;
  }

  await db.insert(documentVersions).values({
    documentId,
    version: doc.version,
    ...snapshot,
  });
}
