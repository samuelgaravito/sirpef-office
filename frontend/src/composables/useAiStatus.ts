import { ref } from 'vue';

import type { AiNodeSummary } from '@sirpefoffice/shared';

import { api } from '@/api/client';

export interface AiStatus {
  configured: boolean;
  provider: string;
  model: string;
  /** Quién atiende la IA: el equipo del usuario, el servidor o nadie. */
  mode?: 'node' | 'server' | 'none';
  node?: { id: string; name: string; model: string } | null;
  nodes?: AiNodeSummary[];
}

/**
 * Estado del proveedor de IA compartido por la sesión.
 *
 * La configuración solo cambia desde Ajustes, así que se consulta una vez y
 * se reutiliza entre vistas. `null` significa «todavía no se sabe» o «no se
 * pudo comprobar».
 */
const status = ref<AiStatus | null>(null);
/** Arranca en `true`: hasta que alguien consulte, el estado es desconocido. */
const loading = ref(true);
let pending: Promise<void> | null = null;

async function fetchStatus(): Promise<void> {
  loading.value = true;
  try {
    status.value = await api.get<AiStatus>('/ai/status');
  } catch {
    status.value = null;
  } finally {
    loading.value = false;
  }
}

export function useAiStatus() {
  /** `force` vuelve a preguntar al servidor (p. ej. al volver de Ajustes). */
  function load(force = false): Promise<void> {
    if (!force && status.value !== null) return Promise.resolve();
    if (pending) return pending;
    pending = fetchStatus().finally(() => {
      pending = null;
    });
    return pending;
  }

  return { status, loading, load };
}
