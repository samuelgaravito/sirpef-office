import type { VariableDef, VariableValues } from './types.js';

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
