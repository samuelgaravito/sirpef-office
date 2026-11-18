/**
 * Lógica pura de paginación compartida por el editor y los exportadores.
 *
 * No toca el DOM: recibe el alto que consume cada bloque y devuelve el reparto
 * por páginas. Así el editor y el servidor pueden aplicar exactamente las
 * mismas reglas de corte.
 */
export interface PackBlock {
  /** Posición o índice del bloque (solo se usa para identificar el corte). */
  pos: number;
  /** Alto que consume el bloque, incluido el espacio con el anterior. */
  advancePx: number;
  /** El bloque empieza una página nueva por un salto manual. */
  forceBreakBefore: boolean;
}

export interface PackedBreak {
  pos: number;
  /** Índice de la página nueva (0 = primera página). */
  page: number;
}

export interface PackResult {
  /** Alto usado en cada página; puede superar la capacidad. */
  pageUseds: number[];
  breaks: PackedBreak[];
  /** El documento termina con un salto manual: hay una página en blanco. */
  trailingBlankPage: boolean;
}

export const DEFAULT_EPSILON_PX = 1;

/** Resultado de paginar un documento en el servidor. */
export interface DocumentPageLayout {
  pageHeightPx: number;
  topInsetPx: number;
  bottomInsetPx: number;
  gapPx: number;
  pageHeightsPx: number[];
  pageTopsPx: number[];
  /** Índices de los nodos de nivel superior que van en cada página. */
  pageBlocks: number[][];
  totalHeightPx: number;
}

/**
 * Reparte bloques secuencialmente.
 *
 * Reglas:
 * - nunca se deja una página vacía al principio por un salto manual inicial,
 * - un bloque que no cabe empieza la página siguiente salvo que sea el primero
 *   de la página (en ese caso se deja crecer la hoja),
 * - si el documento acaba en salto manual se añade una página en blanco.
 */
export interface PackOptions {
  /**
   * Posiciones que ya empiezan página. Se conservan mientras el bloque siga
   * rozando el borde (holgura menor que `hysteresisPx`).
   */
  stickyBreaks?: ReadonlySet<number>;
  /** Holgura en píxeles para conservar un salto existente. */
  hysteresisPx?: number;
}

export function packBlocks(
  blocks: PackBlock[],
  capacityPx: number,
  epsilonPx = DEFAULT_EPSILON_PX,
  forceBreakAtEnd = false,
  options: PackOptions = {},
): PackResult {
  const pageUseds: number[] = [0];
  const breaks: PackedBreak[] = [];
  const capacity = Math.max(1, capacityPx);
  const stickyBreaks = options.stickyBreaks;
  const hysteresis = Math.max(0, options.hysteresisPx ?? 0);
  let used = 0;
  let forceBreak = false;

  for (const block of blocks) {
    if (block.forceBreakBefore) forceBreak = true;

    // Un salto al principio del documento no genera una hoja vacía.
    const leadingBreak = forceBreak && used === 0 && pageUseds.length === 1;
    const overflows =
      used > 0 && used + block.advancePx > capacity + epsilonPx;
    // Si el bloque ya empezaba página y ahora cabe por muy poco, mantener el
    // salto evita que el contenido oscile al teclear cerca del borde.
    const sticky =
      hysteresis > 0 &&
      used > 0 &&
      (stickyBreaks?.has(block.pos) ?? false) &&
      capacity - (used + block.advancePx) < hysteresis;

    if (!leadingBreak && (forceBreak || overflows || sticky)) {
      breaks.push({ pos: block.pos, page: pageUseds.length });
      pageUseds.push(0);
      used = 0;
    }

    forceBreak = false;
    used += Math.max(0, block.advancePx);
    pageUseds[pageUseds.length - 1] = used;
  }

  return {
    pageUseds,
    breaks,
    trailingBlankPage: forceBreakAtEnd || forceBreak,
  };
}
