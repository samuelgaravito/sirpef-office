/**
 * Geometría física de una hoja.
 *
 * El alto de página se calcula a partir de los tokens del diseño (cm) y los
 * márgenes internos se miden en el DOM: la cabecera y el pie pueden crecer
 * al cambiar su alto, el membrete o el logotipo.
 */
export interface PageGeometry {
  pageHeightPx: number;
  topInsetPx: number;
  bottomInsetPx: number;
  /** Alto disponible para el cuerpo del documento. */
  capacityPx: number;
}

/** 1 cm CSS son 96/2.54 píxeles, independientemente del zoom del navegador. */
export function cmToPx(cm: number): number {
  return (cm * 96) / 2.54;
}

/**
 * Mide las zonas de cabecera y pie de una hoja ya renderizada.
 *
 * `sheet` puede ser la hoja continua o la primera tarjeta de página; en ambos
 * casos debe contener `.doc-page-top` y `.doc-page-bottom`.
 */
export function measurePageGeometry(
  sheet: HTMLElement | null,
  pageHeightPx: number,
): PageGeometry {
  const top = sheet?.querySelector<HTMLElement>('.doc-page-top') ?? null;
  const bottom = sheet?.querySelector<HTMLElement>('.doc-page-bottom') ?? null;

  const topInsetPx = top ? top.getBoundingClientRect().height : 0;
  const bottomInsetPx = bottom ? bottom.getBoundingClientRect().height : 0;
  const safePageHeight = Math.max(1, pageHeightPx);

  return {
    pageHeightPx: safePageHeight,
    topInsetPx,
    bottomInsetPx,
    capacityPx: Math.max(48, safePageHeight - topInsetPx - bottomInsetPx),
  };
}
