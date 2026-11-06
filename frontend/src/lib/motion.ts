import { animate, type AnimationPlaybackControls } from 'motion';

export interface Point {
  x: number;
  y: number;
}

/**
 * Presets de movimiento alineados con la guía de diseño de Apple:
 * por defecto muelles críticos (sin rebote) y rebote solo cuando el gesto
 * aporta impulso (arrastrar/soltar).
 */
export const springSoft = { type: 'spring', bounce: 0, duration: 0.34 } as const;
export const springSnappy = { type: 'spring', bounce: 0, duration: 0.26 } as const;
export const springSheet = { type: 'spring', bounce: 0.16, duration: 0.4 } as const;

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

/**
 * Convierte un punto de la ventana en coordenadas relativas a la caja del
 * elemento, que es lo que espera `transform-origin`.
 */
export function relativeOrigin(el: Element, point: Point | null): Point | null {
  if (!point) return null;
  const rect = el.getBoundingClientRect();
  return {
    x: Math.min(Math.max(point.x - rect.left, 0), rect.width),
    y: Math.min(Math.max(point.y - rect.top, 0), rect.height),
  };
}

/**
 * Proyección de momento de Apple: estima dónde "acabaría" el gesto a partir
 * de la velocidad de arrastre, para decidir el destino antes de soltar.
 */
export function projectMomentum(velocity: number, decelerationRate = 0.998): number {
  return (velocity / 1000) * (decelerationRate / (1 - decelerationRate));
}

/** Goma elástica en los bordes: cuanto más se pasa, menos acompaña. */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

export interface FadeOptions {
  readonly velocity?: number;
}

/** Entrada/salida con muelle; con movimiento reducido hace un cross-fade. */
export function enterSurface(
  el: HTMLElement,
  { scaleFrom = 0.96, duration = 0.34 }: { scaleFrom?: number; duration?: number } = {},
): AnimationPlaybackControls {
  if (prefersReducedMotion()) {
    el.style.transform = 'none';
    el.style.opacity = '0';
    return animate(el, { opacity: 1 }, { duration: 0.18, ease: 'easeOut' });
  }

  el.style.opacity = '0';
  el.style.transform = `scale(${scaleFrom})`;
  return animate(
    el,
    { opacity: 1, scale: 1 },
    { type: 'spring', bounce: 0, duration },
  );
}

export function exitSurface(
  el: HTMLElement,
  { scaleTo = 0.96 }: { scaleTo?: number } = {},
): AnimationPlaybackControls {
  if (prefersReducedMotion()) {
    return animate(el, { opacity: 0 }, { duration: 0.15, ease: 'easeIn' });
  }
  return animate(el, { opacity: 0, scale: scaleTo }, springSnappy);
}
