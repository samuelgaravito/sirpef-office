import type { CSSProperties } from 'vue';

import type { BandImage } from '@sirpefoffice/shared';

/**
 * Estilo de una imagen de banda en la hoja de tamaño real.
 *
 * La hoja del editor y el HTML de preview usan centímetros/milímetros CSS, por
 * lo que `mm` conserva la misma posición que en PDF y DOCX.
 */
export function bandImageStyleMm(image: BandImage): CSSProperties {
  return {
    position: 'absolute',
    left: `${image.xMm}mm`,
    top: `${image.yMm}mm`,
    width: `${image.widthMm}mm`,
    height: `${image.heightMm}mm`,
    objectFit: image.fit === 'fill' ? 'fill' : 'contain',
    opacity: String(image.opacity ?? 1),
    zIndex: image.zIndex ?? 1,
  };
}

/** `object-fit` que debe aplicar la etiqueta `<img>` de la imagen. */
export function bandImageFit(image: BandImage): 'contain' | 'fill' {
  return image.fit === 'fill' ? 'fill' : 'contain';
}

/**
 * Estilo porcentual para el editor de bandas, donde la franja se adapta al
 * ancho disponible sin mantener una escala fija.
 */
export function bandImageStylePercent(
  image: BandImage,
  bandWidthMm: number,
  bandHeightMm: number,
): CSSProperties {
  const width = Math.max(1, bandWidthMm);
  const height = Math.max(1, bandHeightMm);
  return {
    position: 'absolute',
    left: `${(image.xMm / width) * 100}%`,
    top: `${(image.yMm / height) * 100}%`,
    width: `${(image.widthMm / width) * 100}%`,
    height: `${(image.heightMm / height) * 100}%`,
    objectFit: image.fit === 'fill' ? 'fill' : 'contain',
    opacity: String(image.opacity ?? 1),
    zIndex: image.zIndex ?? 1,
  };
}
