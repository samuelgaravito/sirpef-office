import { Node } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      /** Inserta un salto de página manual en el cuerpo del documento. */
      insertPageBreak: () => ReturnType;
    };
  }
}

/**
 * Salto de página manual.
 *
 * Es un nodo atómico de bloque para que el documento guardado conserve la
 * intención del usuario. Los exportadores (PDF/DOCX) lo traducen a un salto
 * real y el motor de paginación del editor lo trata como un corte forzado.
 */
export const PageBreak = Node.create({
  name: 'pageBreak',

  group: 'block',

  atom: true,

  selectable: true,

  draggable: false,

  parseHTML() {
    return [
      { tag: 'div[data-page-break]' },
      { tag: 'div.page-break' },
    ];
  },

  renderHTML() {
    return ['div', { 'data-page-break': 'true', class: 'page-break' }];
  },

  addCommands() {
    return {
      insertPageBreak:
        () =>
        ({ commands }) =>
          commands.insertContent({ type: this.name }),
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Enter': () => this.editor.commands.insertPageBreak(),
    };
  },
});
