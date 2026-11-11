import { z, type ZodError } from 'zod';

/**
 * Mensajes de validación en español.
 *
 * Zod escribe sus mensajes por defecto en inglés ("Invalid input: expected
 * string, received undefined"). Como esos mensajes llegan tal cual al
 * formulario, se instala un mapa global que los traduce.
 *
 * Los mensajes que ya escribe cada esquema (`z.email({ message: 'Correo
 * inválido' })`) tienen prioridad sobre este mapa: el orden de resolución de
 * Zod es esquema → contexto → `customError` → `localeError`.
 */

/** Cómo se nombra cada tipo esperado en el mensaje. */
const TYPE_LABELS: Record<string, string> = {
  string: 'texto',
  number: 'número',
  bigint: 'número entero',
  boolean: 'verdadero o falso',
  array: 'lista',
  object: 'objeto',
  date: 'fecha',
  uuid: 'identificador',
  url: 'URL',
};

/** Cómo se nombra cada formato esperado en el mensaje. */
const FORMAT_LABELS: Record<string, string> = {
  email: 'El correo no tiene un formato válido.',
  uuid: 'El identificador no es válido.',
  url: 'La URL no es válida.',
  datetime: 'La fecha y la hora no son válidas.',
  date: 'La fecha no es válida.',
  time: 'La hora no es válida.',
  ipv4: 'La dirección IPv4 no es válida.',
  ipv6: 'La dirección IPv6 no es válida.',
  regex: 'El formato no es válido.',
};

function typeLabel(expected: unknown): string {
  if (typeof expected !== 'string') return 'ese tipo de valor';
  return TYPE_LABELS[expected] ?? expected;
}

/** Mensaje en español para un issue de Zod, o `undefined` si no aplica. */
function spanishMessage(issue: z.core.$ZodRawIssue): string | undefined {
  switch (issue.code) {
    case 'invalid_type': {
      // Un campo ausente no es un problema de tipo: es un campo obligatorio.
      // Zod v4 marca el valor recibido en `input` (`undefined` si no vino).
      if (issue.input === undefined) return 'Este campo es obligatorio.';
      return `Se esperaba ${typeLabel(issue.expected)}.`;
    }
    case 'invalid_format':
      return FORMAT_LABELS[issue.format] ?? 'El formato no es válido.';
    case 'too_small': {
      if (issue.origin === 'string') {
        const n = Number(issue.minimum);
        return `Debe tener al menos ${n} ${n === 1 ? 'carácter' : 'caracteres'}.`;
      }
      if (issue.origin === 'array') {
        return `Debe tener al menos ${issue.minimum} elementos.`;
      }
      if (issue.origin === 'number' || issue.origin === 'bigint') {
        return issue.inclusive
          ? `Debe ser igual o mayor que ${issue.minimum}.`
          : `Debe ser mayor que ${issue.minimum}.`;
      }
      return `Debe ser igual o mayor que ${issue.minimum}.`;
    }
    case 'too_big': {
      if (issue.origin === 'string') {
        const n = Number(issue.maximum);
        return `Debe tener como máximo ${n} ${n === 1 ? 'carácter' : 'caracteres'}.`;
      }
      if (issue.origin === 'array') {
        return `Debe tener como máximo ${issue.maximum} elementos.`;
      }
      if (issue.origin === 'number' || issue.origin === 'bigint') {
        return issue.inclusive
          ? `Debe ser igual o menor que ${issue.maximum}.`
          : `Debe ser menor que ${issue.maximum}.`;
      }
      return `Debe ser igual o menor que ${issue.maximum}.`;
    }
    case 'invalid_value': {
      const values = Array.isArray(issue.values) ? issue.values : [];
      if (values.length === 0) return 'El valor no es válido.';
      return `El valor no es válido. Se esperaba: ${values.join(', ')}.`;
    }
    case 'unrecognized_keys': {
      const keys = Array.isArray(issue.keys) ? issue.keys : [];
      return `Campos desconocidos: ${keys.join(', ')}.`;
    }
    case 'invalid_union':
      return 'El valor no coincide con ninguna de las opciones esperadas.';
    case 'invalid_element':
      return 'Algún elemento de la lista no es válido.';
    default:
      return undefined;
  }
}

/**
 * Instala el mapa de mensajes en español para todo el proceso.
 *
 * `z.config` es global, así que basta con llamarlo una vez al arrancar: los
 * esquemas ya construidos también lo consultan al validar.
 */
export function applySpanishZodMessages(): void {
  z.config({
    customError: (issue) => spanishMessage(issue),
    localeError: z.locales.es().localeError,
  });
}

/**
 * Resume los fallos de validación en una frase que nombra los campos.
 *
 * `"Datos inválidos: correo (Correo inválido), contraseña (Este campo es
 * obligatorio.)"` es mucho más útil que un `"Datos inválidos"` a secas.
 */
export function summarizeZodIssues(error: ZodError): string {
  const parts = error.issues.slice(0, 3).map((issue) => {
    const field = issue.path.length > 0 ? issue.path.join('.') : 'la petición';
    return `${field} (${issue.message})`;
  });

  if (parts.length === 0) return 'Datos inválidos.';
  if (error.issues.length > parts.length) {
    parts.push(`y ${error.issues.length - parts.length} más`);
  }
  return `Datos inválidos: ${parts.join(', ')}.`;
}

/** Fallos de validación en forma compacta para el cliente. */
export function compactZodIssues(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}
