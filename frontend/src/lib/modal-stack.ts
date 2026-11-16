/**
 * Pila de modales abiertos.
 *
 * Permite que un modal se abra encima de otro (el detalle de estadísticas sobre
 * el panel) sin que `Escape` cierre los dos a la vez: solo responde el último
 * registrado. El bloqueo de scroll ya es independiente y lleva su propio
 * contador en `scroll-lock.ts`.
 */

const openModals: symbol[] = [];

export function registerModal(id: symbol): void {
  if (!openModals.includes(id)) openModals.push(id);
}

export function unregisterModal(id: symbol): void {
  const index = openModals.indexOf(id);
  if (index >= 0) openModals.splice(index, 1);
}

/** ¿Este modal es el superior y, por tanto, quien atiende `Escape`? */
export function isTopModal(id: symbol): boolean {
  return openModals[openModals.length - 1] === id;
}
