import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import type { PageBreakLayout } from './layout';

interface PaginationMeta {
  breaks: readonly PageBreakLayout[];
}

export const paginationPluginKey = new PluginKey<DecorationSet>('sirpefofficePagination');

interface ValidBreak extends PageBreakLayout {
  height: number;
}

/** Saltos que realmente se pueden dibujar en el documento actual. */
function validBreaks(
  doc: Parameters<typeof DecorationSet.create>[0],
  breaks: readonly PageBreakLayout[],
): ValidBreak[] {
  const valid: ValidBreak[] = [];
  for (const pageBreak of breaks) {
    if (pageBreak.pos < 0 || pageBreak.pos > doc.content.size) continue;
    const height = Math.max(0, Math.round(pageBreak.height * 100) / 100);
    if (height < 0.5) continue;
    valid.push({ ...pageBreak, height });
  }
  return valid;
}

function buildDecorations(
  doc: Parameters<typeof DecorationSet.create>[0],
  breaks: readonly PageBreakLayout[],
): DecorationSet {
  const decorations: Decoration[] = [];

  for (const pageBreak of validBreaks(doc, breaks)) {
    decorations.push(
      Decoration.widget(
        pageBreak.pos,
        () => {
          const spacer = document.createElement('div');
          spacer.className = 'sd-page-spacer';
          spacer.style.height = `${pageBreak.height}px`;
          spacer.setAttribute('contenteditable', 'false');
          spacer.setAttribute('aria-hidden', 'true');
          spacer.dataset.paginationSpacer = 'true';
          return spacer;
        },
        {
          side: -1,
          // La clave no incluye la altura: si el salto se queda en la misma
          // posición, ProseMirror reutiliza el nodo y solo cambiamos su alto.
          // Así el DOM no se reemplaza justo debajo del cursor.
          key: `page-break-${pageBreak.pos}`,
        },
      ),
    );
  }

  return DecorationSet.create(doc, decorations);
}

/**
 * Extensión sin esquema: mantiene un conjunto de decoraciones que dibujan los
 * huecos entre páginas. Al no modificar el documento, no ensucia el historial
 * de undo ni dispara el autoguardado.
 */
export const PaginationExtension = Extension.create({
  name: 'sirpefofficePagination',

  addProseMirrorPlugins() {
    return [
      new Plugin<DecorationSet>({
        key: paginationPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, current) {
            const meta = tr.getMeta(paginationPluginKey) as PaginationMeta | undefined;
            if (meta) return buildDecorations(tr.doc, meta.breaks);
            return current.map(tr.mapping, tr.doc);
          },
        },
        props: {
          decorations(state) {
            return paginationPluginKey.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});

/** Aplica una nueva distribución de páginas al editor. */
export function setPaginationDecorations(
  editor: Editor,
  breaks: readonly PageBreakLayout[],
): void {
  if (editor.isDestroyed) return;
  const tr = editor.state.tr
    .setMeta(paginationPluginKey, { breaks } satisfies PaginationMeta)
    .setMeta('addToHistory', false);
  editor.view.dispatch(tr);

  // Los widgets cuya posición no cambió se reutilizan: ajustamos su altura.
  const spacers = editor.view.dom.querySelectorAll<HTMLElement>('.sd-page-spacer');
  const valid = validBreaks(editor.state.doc, breaks);
  valid.forEach((pageBreak, index) => {
    const spacer = spacers[index];
    if (spacer) spacer.style.height = `${pageBreak.height}px`;
  });
}

/** Quita todos los espaciadores (al salir del modo paginado). */
export function clearPaginationDecorations(editor: Editor): void {
  setPaginationDecorations(editor, []);
}
