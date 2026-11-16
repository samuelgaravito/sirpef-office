import { eq } from 'drizzle-orm';

import type { VariableDef, VariableValues } from '@sirpefoffice/shared';

import { db } from '../db/index.js';
import { templates } from '../db/schema.js';
import { badRequest } from './errors.js';

/**
 * Datos obligatorios que faltan para poder oficializar un documento.
 *
 * El editor ya lo avisa antes de abrir el envío, pero la comprobación vive
 * también aquí: una pestaña vieja o una llamada directa a la API no deben
 * poder aprobar un documento con huecos.
 */
export function missingRequiredVariables(
  schema: VariableDef[],
  data: VariableValues,
): VariableDef[] {
  return schema.filter((variable) => {
    if (!variable.required) return false;
    const value = data[variable.key];
    if (variable.type === 'table') return !Array.isArray(value) || value.length === 0;
    // Una casilla obligatoria se marca, no se exige: mismo criterio que el editor.
    if (variable.type === 'checkbox') return false;
    if (typeof value === 'string') return value.trim() === '';
    return value === undefined || value === null;
  });
}

/** Lanza un 400 claro si al documento le faltan datos obligatorios. */
export async function assertDocumentDataComplete(document: {
  templateId: string | null;
  data: VariableValues;
}): Promise<void> {
  if (!document.templateId) return;

  const [template] = await db
    .select({ schema: templates.schema })
    .from(templates)
    .where(eq(templates.id, document.templateId))
    .limit(1);

  const missing = missingRequiredVariables(template?.schema ?? [], document.data ?? {});
  if (missing.length === 0) return;

  const labels = missing.map((variable) => variable.label);
  throw badRequest(
    `Faltan datos obligatorios: ${labels.slice(0, 5).join(', ')}${labels.length > 5 ? '…' : ''}`,
    { fields: missing.map((variable) => variable.key) },
  );
}
