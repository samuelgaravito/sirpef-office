import { ref } from 'vue';

import { describeError } from '@/lib/error-message';

export type ToastKind = 'success' | 'error' | 'warning' | 'info';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

const items = ref<ToastItem[]>([]);
let seed = 0;

function dismiss(id: number): void {
  items.value = items.value.filter((toast) => toast.id !== id);
}

function push(kind: ToastKind, message: string, duration = 4200): number {
  const id = ++seed;
  items.value = [...items.value, { id, kind, message }];
  if (duration > 0) {
    window.setTimeout(() => dismiss(id), duration);
  }
  return id;
}

/** Notificaciones efímeras compartidas por toda la aplicación. */
export function useToast() {
  return {
    items,
    push,
    dismiss,
    success: (message: string) => push('success', message),
    error: (message: string) => push('error', message, 6500),
    warning: (message: string) => push('warning', message, 6500),
    info: (message: string) => push('info', message),

    /**
     * Muestra el error que se capturó en un `catch`.
     *
     * Elige solo el tono: los fallos que el usuario puede corregir (validación,
     * conflictos, permisos) salen como aviso y los del servidor como error. Si
     * el servidor envió una referencia de rastreo, se añade al mensaje.
     */
    failure: (error: unknown, fallback: string) => {
      const notice = describeError(error, fallback);
      const message = notice.reference
        ? `${notice.message} (ref. ${notice.reference})`
        : notice.message;
      return push(notice.tone, message, 6500);
    },
  };
}
