import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { api } from '@/api/client';
import { useToast } from '@/composables/useToast';

/**
 * Clave compartida del botón que está creando el documento.
 * `null` = inactivo, `blank` = hoja en blanco, otro valor = id de plantilla.
 */
const creating = ref<string | null>(null);

/** Crea un documento y lo abre, sin pasar por un selector de plantilla. */
export function useCreateDocument() {
  const router = useRouter();
  const toast = useToast();

  async function createDocument(templateId?: string): Promise<void> {
    if (creating.value) return;

    creating.value = templateId ?? 'blank';
    try {
      const data = await api.post<{ document: { id: string; docNumber: string | null } }>(
        '/documents',
        templateId ? { templateId } : {},
      );
      toast.success(
        data.document.docNumber
          ? `Documento ${data.document.docNumber} creado`
          : 'Documento creado',
      );
      await router.push({ name: 'document', params: { id: data.document.id } });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear el documento');
    } finally {
      creating.value = null;
    }
  }

  return { creating, createDocument };
}
