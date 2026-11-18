import type { Editor } from '@tiptap/core';
import { renderToHTMLString } from '@tiptap/static-renderer';
import { computed, ref, watchEffect } from 'vue';
import type { ComputedRef, Ref } from 'vue';

import { api } from '@/api/client';
import { errorMessage } from '@/lib/error-message';
import { editorExtensions } from '@sirpefoffice/shared';
import type {
  AiInlineRequest,
  AiInlineResult,
  DocType,
} from '@sirpefoffice/shared';

export interface InlineSelection {
  from: number;
  to: number;
  text: string;
}

export interface InlineMode {
  instruction: string;
  mode: 'insert' | 'replace';
}

export interface UseInlineAiOptions {
  editor: Ref<Editor | null | undefined>;
  documentId: Ref<string | null | undefined>;
  templateId: Ref<string | null | undefined>;
  docType: Ref<DocType | null | undefined>;
  title: Ref<string | null | undefined>;
  templateName: Ref<string | null | undefined>;
  canEdit: Ref<boolean> | ComputedRef<boolean>;
  /** Se llama cuando el fragmento ya se ha insertado o reemplazado. */
  onApplied: () => void;
}

const CONTEXT_WINDOW = 2_000;

/**
 * Generación inline de la barra inferior.
 *
 * No guarda nada: pide un fragmento, lo previsualiza y el usuario decide si
 * insertarlo o reemplazar la selección. El autoguardado del editor sigue su
 * curso normal.
 */
export function useInlineAi(options: UseInlineAiOptions) {
  const selection = ref<InlineSelection>({ from: 0, to: 0, text: '' });
  const busy = ref(false);
  const error = ref('');
  const result = ref<AiInlineResult | null>(null);
  const previewHtml = ref('');
  const lastRange = ref<{ from: number; to: number } | null>(null);
  const lastRequest = ref<AiInlineRequest | null>(null);

  const hasSelection = computed(() => selection.value.text.trim().length > 0);
  const selectionText = computed(() => selection.value.text);

  function syncSelection(): void {
    const editor = options.editor.value;
    if (!editor || editor.isDestroyed) return;
    const { from, to } = editor.state.selection;
    selection.value = {
      from,
      to,
      text: editor.state.doc.textBetween(from, to, '\n', '\n'),
    };
  }

  watchEffect((onCleanup) => {
    const editor = options.editor.value;
    if (!editor || editor.isDestroyed) return;
    const sync = (): void => syncSelection();
    editor.on('transaction', sync);
    editor.on('selectionUpdate', sync);
    sync();
    onCleanup(() => {
      editor.off('transaction', sync);
      editor.off('selectionUpdate', sync);
    });
  });

  function buildRequest(payload: InlineMode): AiInlineRequest | null {
    const editor = options.editor.value;
    if (!editor || editor.isDestroyed || !options.canEdit.value) return null;

    const { from, to } = editor.state.selection;
    const doc = editor.state.doc;
    const before = doc.textBetween(Math.max(0, from - CONTEXT_WINDOW), from, '\n', '\n');
    const after = doc.textBetween(
      to,
      Math.min(doc.content.size, to + CONTEXT_WINDOW),
      '\n',
      '\n',
    );
    const selected = doc.textBetween(from, to, '\n', '\n');

    return {
      documentId: options.documentId.value ?? undefined,
      templateId: options.templateId.value ?? undefined,
      instruction: payload.instruction,
      mode: payload.mode,
      context: {
        selection: selected || undefined,
        before: before || undefined,
        after: after || undefined,
        docType: options.docType.value ?? undefined,
        title: options.title.value ?? undefined,
        templateName: options.templateName.value ?? undefined,
      },
    };
  }

  async function run(request: AiInlineRequest, range: { from: number; to: number }): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    result.value = null;
    previewHtml.value = '';
    lastRequest.value = request;
    lastRange.value = range;

    try {
      const response = await api.post<AiInlineResult>('/ai/inline', request);
      result.value = response;
      try {
        previewHtml.value = renderToHTMLString({
          content: response.content,
          extensions: editorExtensions,
        });
      } catch {
        previewHtml.value = '';
      }
    } catch (caught) {
      error.value = errorMessage(caught, 'No se pudo redactar con IA');
    } finally {
      busy.value = false;
    }
  }

  async function submit(payload: InlineMode): Promise<void> {
    const instruction = payload.instruction.trim();
    if (!instruction || busy.value) return;
    const request = buildRequest({ ...payload, instruction });
    if (!request) return;
    const range = {
      from: selection.value.from,
      to: selection.value.to,
    };
    await run(request, range);
  }

  async function retry(): Promise<void> {
    if (!lastRequest.value || !lastRange.value) return;
    await run(lastRequest.value, lastRange.value);
  }

  function apply(action: 'insert' | 'replace'): void {
    const editor = options.editor.value;
    const proposal = result.value;
    const range = lastRange.value;
    if (!editor || editor.isDestroyed || !proposal || !range) return;

    try {
      if (action === 'replace') {
        editor
          .chain()
          .focus()
          .insertContentAt({ from: range.from, to: range.to }, proposal.content)
          .run();
      } else {
        editor.chain().focus().insertContentAt(range.to, proposal.content).run();
      }
      options.onApplied();
      discard();
    } catch {
      error.value = 'El documento cambió mientras se generaba la propuesta. Inténtalo de nuevo.';
      discard();
    }
  }

  function discard(): void {
    result.value = null;
    previewHtml.value = '';
    error.value = '';
  }

  return {
    selection,
    selectionText,
    hasSelection,
    busy,
    error,
    result,
    previewHtml,
    submit,
    retry,
    apply,
    discard,
  };
}
