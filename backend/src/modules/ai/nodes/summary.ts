import type { AiNodeCapabilities, AiNodeSummary } from '@sirpefoffice/shared';

import type { AiNodeRow } from '../../../db/schema.js';
import type { ConnectedNode } from './registry.js';

/**
 * Combina la fila de la base con la conexión viva.
 *
 * Lo guardado sirve cuando el equipo está apagado (así la interfaz puede
 * mostrar el último estado conocido); lo vivo manda cuando está conectado.
 */
export function toNodeSummary(row: AiNodeRow, live?: ConnectedNode): AiNodeSummary {
  const capabilities: AiNodeCapabilities | null =
    live?.capabilities ??
    (row.models.length > 0 || row.ollamaVersion
      ? {
          ollamaVersion: row.ollamaVersion,
          models: row.models,
          gpu: row.gpu,
          vramGb: row.vramGb,
          tokensPerSecond: row.tokensPerSecond,
        }
      : null);

  return {
    id: row.id,
    name: row.name,
    online: Boolean(live),
    busy: live?.busy ?? false,
    capabilities,
    lastSeenAt: (live?.lastSeenAt ?? row.lastSeenAt)?.toISOString() ?? null,
  };
}
