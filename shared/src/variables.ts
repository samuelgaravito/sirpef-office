import type { JSONContent, VariableDef, VariableValues } from './types.js';

/**
 * Valores de muestra para las vistas previas y el modo «datos de ejemplo»
 * del editor de plantillas.
 *
 * Son datos ficticios pero con una longitud realista: permiten comprobar el
 * aspecto final del documento sin rellenar ni guardar el formulario.
 */

function sampleDate(): string {
  return new Date().toLocaleDateString('es-PE', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function sampleColumnValue(type: string | undefined, index: number, label: string): string {
  switch (type) {
    case 'number':
      return String(index + 1);
    case 'money':
      return '1,234.50';
    case 'date':
      return sampleDate();
    default:
      return `«${label}»`;
  }
}

/** Genera datos de ejemplo a partir del esquema de una plantilla. */
export function sampleValues(schema: VariableDef[]): VariableValues {
  const values: VariableValues = {};

  for (const variable of schema) {
    if (variable.defaultValue !== undefined && variable.defaultValue !== null) {
      values[variable.key] = variable.defaultValue;
      continue;
    }

    const label = variable.label || variable.key;

    switch (variable.type) {
      case 'date':
        values[variable.key] = sampleDate();
        break;
      case 'number':
        values[variable.key] = '123';
        break;
      case 'money':
        values[variable.key] = '1,234.50';
        break;
      case 'checkbox':
        values[variable.key] = 'Sí';
        break;
      case 'select':
        values[variable.key] =
          variable.options?.[0]?.label ?? variable.options?.[0]?.value ?? `«${label}»`;
        break;
      case 'multiselect':
        values[variable.key] =
          variable.options?.slice(0, 2).map((option) => option.label).join(', ') || `«${label}»`;
        break;
      case 'table':
        values[variable.key] = variable.columns?.length
          ? [0, 1].map((index) =>
              Object.fromEntries(
                variable.columns!.map((column) => [
                  column.key,
                  sampleColumnValue(column.type, index, column.label || column.key),
                ]),
              ),
            )
          : [];
        break;
      case 'image':
        values[variable.key] = '';
        break;
      default:
        values[variable.key] = `«${label}»`;
        break;
    }
  }

  return values;
}


/** Espacio duro: conserva la alineación que el usuario escribió. */
function preserveSpacing(value: string): string {
  return value
    .replace(/\t/g, '\u00A0'.repeat(4))
    .replace(/^ +/gm, (spaces) => '\u00A0'.repeat(spaces.length))
    .replace(/ {2,}/g, (spaces) => '\u00A0'.repeat(spaces.length));
}

function valueAt(values: VariableValues, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = values;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(part);
      current = Number.isInteger(index) ? current[index] : undefined;
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return current;
}

/** Texto que produce el servidor para un valor interpolado. */
export function variableValueText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return preserveSpacing(value.join(', '));
  return preserveSpacing(String(value));
}

/**
 * Sustituye variables en el contenido de una cabecera/pie para que el editor
 * mida el mismo HTML que la vista previa. No expande tablas repetibles.
 */
export function interpolateSimpleContent(
  content: JSONContent,
  values: VariableValues,
): JSONContent {
  const clone = JSON.parse(JSON.stringify(content)) as JSONContent;
  const walk = (node: JSONContent): void => {
    if (node.text) {
      node.text = node.text.replace(/\{\{\s*([\w.[\]]+)\s*\}\}/g, (_match, path: string) =>
        variableValueText(valueAt(values, path)),
      );
    }
    node.content?.forEach(walk);
  };
  walk(clone);
  return clone;
}
