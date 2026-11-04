import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const key = new PluginKey('variableHighlight');
const PATTERN = /\{\{[^{}\n]+\}\}/g;

function build(doc: PMNode): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;
    PATTERN.lastIndex = 0;

    let match: RegExpExecArray | null = PATTERN.exec(node.text);
    while (match) {
      const from = pos + match.index;
      decorations.push(
        Decoration.inline(from, from + match[0].length, { class: 'doc-var' }, { key: `var-${from}` }),
      );
      match = PATTERN.exec(node.text);
    }
  });

  return DecorationSet.create(doc, decorations);
}

/**
 * Resalta las variables `{{clave}}` dentro del editor sin modificar el
 * documento: son decoraciones, no texto, así que no afectan al guardado ni
 * a la exportación.
 */
export const VariableHighlight = Extension.create({
  name: 'variableHighlight',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key,
        state: {
          init: (_config, { doc }) => build(doc),
          apply: (tr, previous) => (tr.docChanged ? build(tr.doc) : previous),
        },
        props: {
          decorations(state) {
            return key.getState(state) ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
