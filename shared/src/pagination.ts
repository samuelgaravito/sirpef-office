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
export function packBlocks(
  blocks: PackBlock[],
  capacityPx: number,
  epsilonPx = DEFAULT_EPSILON_PX,
  forceBreakAtEnd = false,
): PackResult {
  const pageUseds: number[] = [0];
  const breaks: PackedBreak[] = [];
  const capacity = Math.max(1, capacityPx);
  let used = 0;
  let forceBreak = false;

  for (const block of blocks) {
    if (block.forceBreakBefore) forceBreak = true;

    // Un salto al principio del documento no genera una hoja vacía.
    const leadingBreak = forceBreak && used === 0 && pageUseds.length === 1;

    if (
      !leadingBreak &&
      (forceBreak || (used > 0 && used + block.advancePx > capacity + epsilonPx))
    ) {
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
