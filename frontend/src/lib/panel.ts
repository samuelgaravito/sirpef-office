import type { InjectionKey } from 'vue';

/**
 * Contexto que aporta el panel modal a las vistas que renderiza.
 *
 * Las vistas siguen envolviéndose en `<AppShell>`, pero al detectar este
 * contexto el shell omite su barra superior y deja que el panel ponga el
 * marco. Así reutilizamos las mismas vistas en página completa (enlaces
 * directos) y dentro de un modal (navegación desde el panel de trabajo).
 */
export const PANEL_MODE: InjectionKey<boolean> = Symbol('sirpefoffice.panel-mode');

/** Cierra el panel activo. `null` cuando se renderiza como página completa. */
export const PANEL_CLOSE: InjectionKey<(() => void) | null> = Symbol(
  'sirpefoffice.panel-close',
);
