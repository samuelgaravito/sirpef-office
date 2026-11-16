import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { stashAiPrompt } from '@/lib/ai-prompt';

/**
 * Clave compartida del botón que está abriendo el editor.
 * `null` = inactivo, `blank` = hoja en blanco, otro valor = id de plantilla.
 */
const creating = ref<string | null>(null);

/**
 * Abre el editor en modo «documento nuevo». No crea nada en la base de datos:
 * la fila se materializa cuando el usuario pulsa Guardar, Enviar o Exportar.
 */
export function useCreateDocument() {
  const router = useRouter();

  async function createDocument(
    templateId?: string,
    options: { ai?: boolean; prompt?: string } = {},
  ): Promise<void> {
    if (creating.value) return;

    creating.value = templateId ?? 'blank';
    try {
      // Cada entrada al asistente estrena conversación: el identificador evita
      // recuperar el chat de un documento anterior de la misma plantilla.
      const chatId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

      // El encargo no viaja en la URL: el editor lo consume y lo envía una vez.
      if (options.ai && options.prompt) stashAiPrompt(chatId, options.prompt);

      await router.push({
        name: 'document-new',
        query: {
          ...(templateId ? { template: templateId } : {}),
          ...(options.ai ? { ai: '1', chat: chatId } : {}),
        },
      });
    } finally {
      creating.value = null;
    }
  }

  return { creating, createDocument };
}
