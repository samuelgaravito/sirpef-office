import { ref } from 'vue';

import { useAuthStore } from '@/stores/auth';

/**
 * Preferencia de interfaz por usuario.
 *
 * «Solo lo esencial» oculta las acciones avanzadas del editor (historial,
 * cabecera y pie, compartir, formatos técnicos) sin cambiar permisos: quien
 * las necesite puede desactivar el modo desde Ajustes.
 */
const essential = ref(false);
let loadedFor: string | null = null;

function storageKey(userId: string | null): string {
  return `sirpefoffice:essential:${userId ?? 'anon'}`;
}

export function useUiMode() {
  const auth = useAuthStore();
  const userId = auth.user?.id ?? null;

  if (loadedFor !== userId) {
    loadedFor = userId;
    try {
      essential.value = window.localStorage.getItem(storageKey(userId)) === '1';
    } catch {
      essential.value = false;
    }
  }

  function setEssential(value: boolean): void {
    essential.value = value;
    try {
      window.localStorage.setItem(storageKey(userId), value ? '1' : '0');
    } catch {
      // Sin almacenamiento: la preferencia dura lo que la sesión.
    }
  }

  return { essential, setEssential };
}
