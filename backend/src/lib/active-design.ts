/**
 * Diseño en uso.
 *
 * Cada cuenta tiene **un único diseño en uso**: es el que dibujan todas sus
 * plantillas (vista previa, PDF, DOCX). Al encender un diseño se apagan los
 * demás, así que cambiar de aspecto (Navidad → año nuevo) es una sola
 * operación y no obliga a rehacer ninguna plantilla.
 *
 * Los documentos **no** siguen al diseño en uso: al crearse guardan el
 * diseño concreto con el que nacieron, de modo que un documento de diciembre
 * se sigue exportando con el diseño de Navidad aunque en enero se encienda
 * otro diseño.
 */

import { and, eq, inArray, isNull, ne } from 'drizzle-orm';

import { DEFAULT_DESIGN_TOKENS } from '@sirpefoffice/shared';
import type { DesignTokens } from '@sirpefoffice/shared';

import { db } from '../db/index.js';
import { designs } from '../db/schema.js';
import { internal } from './errors.js';

export type DesignRow = typeof designs.$inferSelect;

/** Diseño que se aplica y de dónde viene. */
export interface ResolvedDesign {
  /** Fila del diseño aplicado. */
  design: DesignRow | null;
  /** Tokens con los que se dibuja. */
  tokens: DesignTokens;
  /** El diseño aplicado es el que está en uso en la cuenta. */
  isActiveDesign: boolean;
}

function emptyResolution(): ResolvedDesign {
  return { design: null, tokens: DEFAULT_DESIGN_TOKENS, isActiveDesign: false };
}

/** Diseño en uso de una cuenta (`null` si no hay ninguno). */
export async function getActiveDesign(ownerId: string): Promise<DesignRow | null> {
  const [row] = await db
    .select()
    .from(designs)
    .where(
      and(
        eq(designs.ownerId, ownerId),
        eq(designs.isCurrent, true),
        isNull(designs.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Diseños en uso de varias cuentas (para listados). */
export async function getActiveDesigns(
  ownerIds: string[],
): Promise<Map<string, DesignRow>> {
  const unique = [...new Set(ownerIds.filter(Boolean))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select()
    .from(designs)
    .where(
      and(
        eq(designs.isCurrent, true),
        isNull(designs.deletedAt),
        inArray(designs.ownerId, unique),
      ),
    );
  return new Map(rows.map((row) => [row.ownerId, row]));
}

/**
 * Enciende o apaga el diseño en uso de la cuenta.
 *
 * Al encender uno se apagan los demás: solo puede haber uno en uso (lo
 * garantiza además el índice único parcial de la base de datos).
 *
 * No se toca `updatedAt`: encender un diseño no debe reordenar la lista de
 * diseños, porque salta de sitio y confunde.
 */
export async function setActiveDesign(
  design: DesignRow,
  isCurrent: boolean,
): Promise<DesignRow> {
  if (isCurrent) {
    await db
      .update(designs)
      .set({ isCurrent: false })
      .where(and(eq(designs.ownerId, design.ownerId), ne(designs.id, design.id)));
  }

  const [updated] = await db
    .update(designs)
    .set({ isCurrent })
    .where(eq(designs.id, design.id))
    .returning();
  if (!updated) throw internal('DESIGN_STATUS_FAILED', 'No se pudo actualizar el diseño');
  return updated;
}

/**
 * Resuelve el diseño de una plantilla.
 *
 * Las plantillas siguen al diseño en uso de su propietario. Si la cuenta no
 * tiene ninguno en uso, se usa el diseño que la plantilla tenía guardado y,
 * si tampoco lo tiene, los valores predeterminados.
 */
export async function resolveTemplateDesign(
  ownerId: string,
  designId?: string | null,
): Promise<ResolvedDesign> {
  const active = await getActiveDesign(ownerId);
  if (active) {
    return { design: active, tokens: active.tokens, isActiveDesign: true };
  }

  if (designId) {
    const [design] = await db
      .select()
      .from(designs)
      .where(and(eq(designs.id, designId), isNull(designs.deletedAt)))
      .limit(1);
    if (design) return { design, tokens: design.tokens, isActiveDesign: false };
  }

  return emptyResolution();
}
