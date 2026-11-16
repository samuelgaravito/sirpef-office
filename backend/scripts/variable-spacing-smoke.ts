/**
 * Regresión de espacios y saltos de línea en variables.
 *
 *   npm run smoke:variables
 *
 * Un valor con saltos de línea o columnas alineadas debe llegar igual a la
 * vista previa, al PDF y al DOCX. En HTML, los `\n` tienen que convertirse en
 * `hardBreak` y las sangrías/espacios múltiples en espacios duros.
 */
import { prepareContent, renderPreparedContentHtml } from '../src/lib/render.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const content = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'OBSERVACIONES: {{observaciones}}' }],
    },
  ],
};

const html = renderPreparedContentHtml(
  prepareContent(content, {
    observaciones: 'linea 1\nlinea 2\n\n  sangria  con  espacios',
  }),
);

assert(html.includes('<br'), 'Los saltos de línea no se convirtieron en hardBreak');
assert(html.includes('\u00A0'), 'Los espacios múltiples o la sangría se colapsaron');
assert(html.includes('linea 1'), 'Se perdió la primera línea');
assert(html.includes('linea 2'), 'Se perdió la segunda línea');
assert(!html.includes('linea 1\nlinea 2'), 'El salto de línea sigue dentro del texto');

const sinSaltos = renderPreparedContentHtml(
  prepareContent(content, { observaciones: 'texto normal con espacios' }),
);
assert(
  !sinSaltos.includes('\u00A0'),
  'Un espacio normal entre palabras no debe convertirse en espacio duro',
);

console.log('ok  : los saltos de línea se convierten en hardBreak');
console.log('ok  : las sangrías y espacios múltiples se conservan');
console.log('ok  : los espacios normales siguen siendo normales');
console.log('\nRESULTADO: todas las comprobaciones pasaron');
