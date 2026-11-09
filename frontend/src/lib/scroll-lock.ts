/**
 * Bloqueo de scroll compartido por las capas superpuestas (panel de módulos,
 * modales, etc.). Un contador evita que cerrar una capa reactive el scroll
 * mientras otra sigue abierta.
 */
let locks = 0;
let previousOverflow = '';

export function lockScroll(): void {
  if (locks === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  locks += 1;
}

export function unlockScroll(): void {
  if (locks === 0) return;
  locks -= 1;
  if (locks === 0) document.body.style.overflow = previousOverflow;
}
