/**
 * Intenciones del editor que tienen que sobrevivir al remontaje de la vista.
 *
 * `App.vue` monta las rutas con la ruta como clave, y el editor es una ruta de
 * primer nivel: al pasar de `/documents/new` a `/documents/:id` la vista se
 * desmonta y se vuelve a montar. Cualquier estado que se fije **después** de
 * `materialize()` (crear el documento) se perdería con el remontaje. Este
 * módulo guarda la intención para que la instancia nueva la recoja en cuanto
 * termine de cargar.
 */

export interface SendPrefill {
  subject?: string;
  body?: string;
  recipientIds?: string[];
}

let pendingSend: SendPrefill | null = null;

/** Deja anotado que hay que abrir el diálogo de envío tras cargar. */
export function setPendingSend(prefill: SendPrefill): void {
  pendingSend = prefill;
}

/** Recoge (y limpia) la intención pendiente, si la hay. */
export function takePendingSend(): SendPrefill | null {
  const prefill = pendingSend;
  pendingSend = null;
  return prefill;
}
