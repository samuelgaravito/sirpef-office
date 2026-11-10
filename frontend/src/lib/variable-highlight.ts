import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const key = new PluginKey('variableHighlight');
const PATTERN_SOURCE = '\\{\\{([^{}\\n]+)\\}\\}';

/** Meta que fuerza a refrescar las decoraciones (el número cambió). */
export const VARIABLE_HIGHLIGHT_REFRESH = 'variableHighlight:refresh';

/** Valor que sustituye visualmente a un token. */
export interface ResolvedVariable {
  text: string;
  title?: string;
}

export interface VariableHighlightOptions {
  /**
   * Devuelve el valor con el que se sustituye un token, o `null` para
   * dejarlo resaltado como una variable sin resolver.
   */
  resolve?: (variableKey: string) => ResolvedVariable | null;
}

function build(doc: PMNode, options: VariableHighlightOptions): DecorationSet {
  const decorations: Decoration[] = [];

  doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return;

    const pattern = new RegExp(PATTERN_SOURCE, 'g');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(node.text))) {
      const from = pos + match.index;
      const to = from + match[0].length;
      const variableKey = (match[1] ?? '').trim();
      if (!variableKey) continue;
      const resolved = options.resolve?.(variableKey) ?? null;

      if (resolved) {
        // El token sigue en el documento (se guarda igual), pero visualmente
        // se sustituye por su valor para que el usuario sepa qué número verá.
        decorations.push(
          Decoration.inline(from, to, { class: 'doc-var-source', style: 'display: none' }),
        );
        decorations.push(
          Decoration.widget(
            from,
            () => {
              const span = document.createElement('span');
              span.className = 'doc-var doc-var--resolved';
              span.textContent = resolved.text;
              if (resolved.title) span.title = resolved.title;
              span.setAttribute('contenteditable', 'false');
              return span;
            },
            { side: -1, key: `resolved-${from}-${resolved.text}` },
          ),
        );
      } else {
        decorations.push(
          Decoration.inline(from, to, { class: 'doc-var' }, { key: `var-${from}` }),
        );
      }
    }
  });

  return DecorationSet.create(doc, decorations);
}

/**
 * Resalta las variables `{{clave}}` dentro del editor sin modificar el
 * documento: son decoraciones, no texto, así que no afectan al guardado ni
 * a la exportación.
 *
 * Con `resolve` se puede mostrar el valor de una variable de sistema (por
 * ejemplo `numero_documento`) en lugar del token.
 */
export const VariableHighlight = Extension.create<VariableHighlightOptions>({
  name: 'variableHighlight',

  addOptions() {
    return { resolve: undefined };
  },

  addProseMirrorPlugins() {
    const options = this.options;

    return [
      new Plugin({
        key,
        state: {
          init: (_config, state) => build(state.doc, options),
          apply: (tr, previous, _oldState, newState) => {
            if (tr.docChanged || tr.getMeta(VARIABLE_HIGHLIGHT_REFRESH)) {
              return build(newState.doc, options);
            }
            return previous.map(tr.mapping, tr.doc);
          },
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
