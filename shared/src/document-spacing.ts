/**
 * Espaciado del documento: la fuente única que comparten el editor y los
 * exportadores.
 *
 * El editor (ProseMirror) dibuja un párrafo vacío con un `<br>` de relleno
 * (`ProseMirror-trailingBreak`) para que reserve una línea completa. El
 * renderizador estático de TipTap, en cambio, devuelve `<p></p>`, que en el
 * navegador no tiene altura: el bloque desaparece y el documento exportado
 * queda más corto que el que se ve en pantalla.
 *
 * Para que el PDF y la vista previa respeten los espacios tal y como están en
 * el editor, el HTML estático se corrige antes de entregarse: todo párrafo sin
 * contenido recibe el mismo `<br>` que usa el editor.
 */

/**
 * Etiqueta y atributos de un bloque de texto vacío en el HTML del editor.
 *
 * Se cubren los párrafos y los títulos: en el editor ambos reservan una
 * línea, pero el renderizador estático los devuelve sin contenido.
 */
const EMPTY_BLOCK = /<(p|h[1-6])(\s[^>]*)?><\/\1>/g;

/**
 * Devuelve el HTML con los bloques vacíos dotados de `<br>`, igual que hace
 * el editor, para que midan una línea completa.
 */
export function withEmptyParagraphHeights(html: string): string {
  return html.replace(EMPTY_BLOCK, '<$1$2><br></$1>');
}
