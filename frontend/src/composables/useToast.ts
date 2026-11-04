import { ref } from 'vue';

export type ToastKind = 'success' | 'error' | 'info';

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
    info: (message: string) => push('info', message),
  };
}
