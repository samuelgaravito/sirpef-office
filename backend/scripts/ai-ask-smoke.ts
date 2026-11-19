/**
 * Regresión del modo consulta, sin proveedor ni base de datos.
 *
 *   npm run smoke:ai-ask
 *
 * Comprueba que la interpretación del modelo se valida de forma tolerante:
 * un `limit` fuera de rango se recorta, un estado inventado se descarta y un
 * JSON roto cae a la búsqueda por texto.
 */
import { applyQuestionHints, fallbackFilters, parseFilters } from '../src/modules/ai/ask.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const valido = parseFilters(
  JSON.stringify({
    intent: 'count',
    groupBy: 'docType',
    scope: 'mine',
    docTypes: ['delivery_note'],
    statuses: ['sent'],
    templateName: 'Nota de entrega',
    recipient: 'Samuel Carico',
    text: '',
    from: '2026-11-01',
    to: '2026-11-30',
    dateField: 'created',
    approvedByMe: false,
    limit: 100,
  }),
);

assert(valido, 'La interpretación válida se descartó');
assert(valido.intent === 'count', 'No se conservó el intent');
assert(valido.groupBy === 'docType', 'No se conservó la agrupación');
assert(valido.scope === 'mine', 'No se conservó el alcance');
assert(valido.dateField === 'created', 'No se conservó el campo de fecha');
assert(valido.docTypes[0] === 'delivery_note', 'No se conservó el tipo de documento');
assert(valido.statuses[0] === 'sent', 'No se conservó el estado');
assert(valido.limit === 20, `El límite no se recortó a 20 (quedó en ${valido.limit})`);
console.log('ok  : la interpretación válida se conserva y el límite se recorta');

const tolerante = parseFilters(
  JSON.stringify({
    intent: 'cuantos',
    groupBy: 'mes',
    scope: 'todo',
    docTypes: ['delivery_note', 'inventado'],
    statuses: ['enviado', 'sent'],
    approvedByMe: 'true',
    limit: 'muchos',
  }),
);

assert(tolerante, 'La interpretación con campos raros se descartó entera');
assert(tolerante.intent === 'list', 'El intent inválido no cayó al valor por defecto');
assert(tolerante.groupBy === 'none', 'La agrupación inválida no cayó al valor por defecto');
assert(tolerante.scope === 'all', 'El alcance inválido no cayó al valor por defecto');
assert(
  tolerante.docTypes.length === 1 && tolerante.docTypes[0] === 'delivery_note',
  'No se descartó el tipo inventado',
);
assert(
  tolerante.statuses.length === 1 && tolerante.statuses[0] === 'sent',
  'No se descartó el estado inventado',
);
assert(tolerante.approvedByMe === true, 'No se interpretó «true» como booleano');
assert(tolerante.limit === 8, 'El límite ilegible no cayó al valor por defecto');
assert(tolerante.dateField === 'created', 'El campo de fecha inválido no cayó a «created»');

const conPosesivo = applyQuestionHints(
  fallbackFilters('mis últimos documentos'),
  '¿Mis últimos 5 documentos?',
);
assert(conPosesivo.scope === 'mine', 'Un posesivo no corrigió el alcance a «solo míos»');

const sinPosesivo = applyQuestionHints(
  fallbackFilters('documentos compartidos'),
  '¿Qué documentos compartieron conmigo?',
);
assert(sinPosesivo.scope === 'all', 'Se cambió el alcance sin una señal en la pregunta');

const noviembre = new Date(2026, 10, 19);
const esteMes = applyQuestionHints(
  fallbackFilters('certificados'),
  '¿Cuántos certificados hice este mes?',
  noviembre,
);
assert(
  esteMes.from === '2026-11-01' && esteMes.to === '2026-11-30',
  `«Este mes» no se resolvió al mes actual (${esteMes.from} → ${esteMes.to})`,
);

const mesPasado = applyQuestionHints(
  fallbackFilters('certificados'),
  '¿Y el mes pasado?',
  noviembre,
);
assert(
  mesPasado.from === '2026-10-01' && mesPasado.to === '2026-10-31',
  `«El mes pasado» no se resolvió al mes anterior (${mesPasado.from} → ${mesPasado.to})`,
);
console.log('ok  : los campos inválidos caen a su valor por defecto y los inventados se descartan');

const conVallas = parseFilters('```json\n{"intent":"count","limit":5}\n```');
assert(conVallas?.intent === 'count', 'No se limpiaron las vallas de Markdown');
assert(conVallas.limit === 5, 'No se conservó el límite válido');
console.log('ok  : el JSON con vallas de Markdown se interpreta');

assert(parseFilters('no es json') === null, 'Un texto sin JSON no debe devolver filtros');
assert(parseFilters('') === null, 'Una respuesta vacía no debe devolver filtros');
console.log('ok  : una respuesta sin JSON devuelve null (y el llamador usa el respaldo)');

const respaldo = fallbackFilters('buscame la nota de Samuel');
assert(respaldo.intent === 'find', 'El respaldo no busca');
assert(respaldo.text === 'buscame la nota de Samuel', 'El respaldo no conserva la pregunta');
assert(respaldo.scope === 'all', 'El respaldo no mira los compartidos');
console.log('ok  : el respaldo busca la pregunta como texto');

console.log('\nRESULTADO: todas las comprobaciones pasaron');
