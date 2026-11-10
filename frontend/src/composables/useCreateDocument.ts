import { ref } from 'vue';
import { useRouter } from 'vue-router';

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

  async function createDocument(templateId?: string): Promise<void> {
    if (creating.value) return;

    creating.value = templateId ?? 'blank';
    try {
      await router.push({
        name: 'document-new',
        query: templateId ? { template: templateId } : {},
      });
    } finally {
      creating.value = null;
    }
  }

  return { creating, createDocument };
}
