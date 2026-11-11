import type { Editor } from '@tiptap/vue-3';
import type { JSONContent } from '@sirpefoffice/shared';

/**
 * Lectura del contenido del editor y detección de cuerpos vacíos.
 *
 * El envoltorio de Vue 3 de TipTap difiere la invalidación reactiva del
 * estado del editor dos `requestAnimationFrame` (`useDebouncedRef`). Por eso un
 * `computed` sobre `editor.getJSON()` puede devolver el documento anterior al
 * último `setContent`. Para serializar (guardar, exportar, persistir el
 * borrador) hay que leer el estado real del editor directamente.
 */

/** Documento vacío usado cuando el editor todavía no existe. */
export const EMPTY_EDITOR_DOC: JSONContent = { type: 'doc', content: [] };

/**
 * Devuelve el contenido **actual** del editor.
 *
 * `getJSON()` lee el estado real de ProseMirror, así que siempre refleja la
 * última transacción aplicada, sin depender del debounce reactivo.
 */
export function readEditorContent(editor: Editor | null | undefined): JSONContent {
  if (!editor || editor.isDestroyed) return EMPTY_EDITOR_DOC;
  return editor.getJSON() as JSONContent;
}

/**
 * Indica si un documento no tiene contenido aprovechable.
 *
 * Se considera en blanco cuando no hay texto con contenido ni nodos que
 * aportan información por sí mismos (imágenes, tablas, separadores). Un
 * párrafo vacío o un texto solo con espacios no cuentan.
 */
export function isBlankContent(content: JSONContent | null | undefined): boolean {
  if (!content) return true;

  /** Busca en profundidad un nodo que aporte contenido. */
  function hasContent(node: JSONContent): boolean {
    if (node.type === 'text') return (node.text ?? '').trim().length > 0;
    // Nodos que aportan contenido aunque no tengan texto.
    if (node.type === 'image' || node.type === 'table' || node.type === 'horizontalRule') {
      return true;
    }
    return (node.content ?? []).some((child) => hasContent(child));
  }

  return !(content.content ?? []).some((child) => hasContent(child));
}
