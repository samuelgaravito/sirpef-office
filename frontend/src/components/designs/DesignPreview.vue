<script setup lang="ts">
import { Trash2 } from 'lucide-vue-next';
import { computed, onBeforeUnmount, ref } from 'vue';

import { bandImageFit, bandImageStyleMm } from '@/lib/band-images';
import { clampChromeWidth, PAGE_SIZES_CM } from '@sirpefoffice/shared';
import type { BandImage, DesignTokens } from '@sirpefoffice/shared';

const props = withDefaults(
  defineProps<{
    tokens: DesignTokens;
    scale?: number;
    /** Permite mover y redimensionar las imágenes directamente sobre la hoja. */
    interactive?: boolean;
    /** Muestra las franjas de cabecera/pie y sus medidas. */
    showGuides?: boolean;
    /** Fija la altura de la hoja (editor) en lugar de dejar que crezca. */
    fixedHeight?: boolean;
    /** Las esquinas mantienen la proporción; los lados estiran libremente. */
    lockAspect?: boolean;
  }>(),
  {
    scale: 0.44,
    interactive: false,
    showGuides: false,
    fixedHeight: false,
    lockAspect: true,
  },
);

const emit = defineEmits<{
  'update:headerImages': [images: BandImage[]];
  'update:footerImages': [images: BandImage[]];
  select: [kind: 'header' | 'footer' | null];
}>();

/** Factor de conversión de centímetros a píxeles CSS (96 dpi). */
const PAGE_PX_PER_CM = 37.795;

const page = computed(() => {
  const size = PAGE_SIZES_CM[props.tokens.pageFormat] ?? PAGE_SIZES_CM.A4!;
  const landscape = props.tokens.orientation === 'landscape';
  return {
    width: landscape ? size.height : size.width,
    height: landscape ? size.width : size.height,
  };
});

const pageStyle = computed(() => ({
  width: `${page.value.width}cm`,
  minHeight: `${page.value.height}cm`,
  ...(props.fixedHeight ? { height: `${page.value.height}cm` } : {}),
  fontFamily: props.tokens.fontFamily,
  fontSize: `${props.tokens.fontSize}pt`,
  lineHeight: String(props.tokens.lineHeight),
  color: props.tokens.textColor,
  background: props.tokens.backgroundColor,
  position: 'relative' as const,
  display: 'grid' as const,
  gridTemplateRows: 'auto 1fr auto',
  overflow: 'hidden' as const,
}));

/** La cabecera se ancla arriba; su altura mínima es el margen superior. */
const topZoneStyle = computed(() => ({
  minHeight: `${props.tokens.margins.top}cm`,
  paddingBottom: '4mm',
  display: 'flex' as const,
  flexDirection: 'column' as const,
}));

/** El cuerpo conserva los márgenes laterales, pero no los verticales. */
const bodyStyle = computed(() => ({
  padding: `0 ${props.tokens.margins.right}cm 0 ${props.tokens.margins.left}cm`,
  minHeight: '0',
  overflow: 'hidden' as const,
}));

/** El pie se ancla abajo; su altura mínima es el margen inferior. */
const bottomZoneStyle = computed(() => ({
  minHeight: `${props.tokens.margins.bottom}cm`,
  paddingTop: '4mm',
  display: 'flex' as const,
  flexDirection: 'column' as const,
  justifyContent: 'flex-end' as const,
}));

const wrapperStyle = computed(() => ({
  width: `${page.value.width * PAGE_PX_PER_CM * props.scale}px`,
  height: `${page.value.height * PAGE_PX_PER_CM * props.scale}px`,
}));

const innerStyle = computed(() => ({
  transform: `scale(${props.scale})`,
  transformOrigin: 'top left',
}));

const headerImages = computed(() => props.tokens.header?.images ?? []);
const footerImages = computed(() => props.tokens.footer?.images ?? []);
const headerHeightMm = computed(() =>
  Math.max(5, Math.min(80, Number(props.tokens.header?.heightMm) || 18)),
);
const footerHeightMm = computed(() =>
  Math.max(5, Math.min(80, Number(props.tokens.footer?.heightMm) || 16)),
);

function widthPercentFor(kind: 'header' | 'footer'): number {
  const config = kind === 'header' ? props.tokens.header : props.tokens.footer;
  return clampChromeWidth(config?.widthPercent);
}

const headerWidthPercent = computed(() => widthPercentFor('header'));
const footerWidthPercent = computed(() => widthPercentFor('footer'));

const guideStyle = computed(() =>
  props.showGuides
    ? {
        outline: '1px dashed rgba(37, 99, 235, .42)',
        outlineOffset: '-1px',
        background: 'rgba(37, 99, 235, .035)',
      }
    : {},
);

const selected = ref<{ kind: 'header' | 'footer'; id: string } | null>(null);

function clearSelection(): void {
  selected.value = null;
  emit('select', null);
}

function selectImage(kind: 'header' | 'footer', id: string): void {
  selected.value = { kind, id };
  emit('select', kind);
}

function imagesFor(kind: 'header' | 'footer'): BandImage[] {
  return kind === 'header' ? headerImages.value : footerImages.value;
}

function updateImage(kind: 'header' | 'footer', id: string, patch: Partial<BandImage>): void {
  const next = imagesFor(kind).map((image) => (image.id === id ? { ...image, ...patch } : image));
  if (kind === 'header') emit('update:headerImages', next);
  else emit('update:footerImages', next);
}

function removeImage(kind: 'header' | 'footer', id: string): void {
  const next = imagesFor(kind).filter((image) => image.id !== id);
  if (kind === 'header') emit('update:headerImages', next);
  else emit('update:footerImages', next);
  if (selected.value?.id === id) clearSelection();
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type HandleMode = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

interface DragState {
  kind: 'header' | 'footer';
  id: string;
  mode: HandleMode;
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  startWidth: number;
  startHeight: number;
  bandRect: DOMRect;
  bandWidthMm: number;
  bandHeightMm: number;
}

let drag: DragState | null = null;

function beginDrag(
  event: PointerEvent,
  image: BandImage,
  kind: 'header' | 'footer',
  mode: HandleMode,
): void {
  if (!props.interactive || event.button !== 0) return;
  const bandEl = (event.currentTarget as HTMLElement | null)?.closest(
    '[data-design-band]',
  ) as HTMLElement | null;
  if (!bandEl) return;

  event.preventDefault();
  event.stopPropagation();
  selectImage(kind, image.id);

  drag = {
    kind,
    id: image.id,
    mode,
    startX: event.clientX,
    startY: event.clientY,
    startLeft: image.xMm,
    startTop: image.yMm,
    startWidth: image.widthMm,
    startHeight: image.heightMm,
    bandRect: bandEl.getBoundingClientRect(),
    bandWidthMm: bandWidthMm(kind),
    bandHeightMm: kind === 'header' ? headerHeightMm.value : footerHeightMm.value,
  };

  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', endDrag, { once: true });
}

function bandWidthMm(kind: 'header' | 'footer'): number {
  return (page.value.width * 10 * widthPercentFor(kind)) / 100;
}

function onPointerMove(event: PointerEvent): void {
  if (!drag) return;
  const { bandRect, bandWidthMm: widthMm, bandHeightMm: heightMm } = drag;
  if (!bandRect.width || !bandRect.height) return;

  const dx = ((event.clientX - drag.startX) / bandRect.width) * widthMm;
  const dy = ((event.clientY - drag.startY) / bandRect.height) * heightMm;

  if (drag.mode === 'move') {
    updateImage(drag.kind, drag.id, {
      xMm: round(clamp(drag.startLeft + dx, 0, Math.max(0, widthMm - drag.startWidth))),
      yMm: round(clamp(drag.startTop + dy, 0, Math.max(0, heightMm - drag.startHeight))),
    });
    return;
  }

  const minSize = 4;
  const corner = drag.mode.length === 2;

  if (corner) {
    const east = drag.mode.includes('e');
    const south = drag.mode.includes('s');
    const anchorX = east ? drag.startLeft : drag.startLeft + drag.startWidth;
    const anchorY = south ? drag.startTop : drag.startTop + drag.startHeight;
    const maxWidth = east ? widthMm - anchorX : anchorX;
    const maxHeight = south ? heightMm - anchorY : anchorY;

    let width = east ? drag.startWidth + dx : drag.startWidth - dx;
    let height = south ? drag.startHeight + dy : drag.startHeight - dy;
    width = clamp(width, Math.min(minSize, maxWidth), maxWidth);
    height = clamp(height, Math.min(minSize, maxHeight), maxHeight);

    if (props.lockAspect) {
      const ratio = drag.startWidth / Math.max(1, drag.startHeight);
      const changeX = Math.abs(width / Math.max(1, drag.startWidth) - 1);
      const changeY = Math.abs(height / Math.max(1, drag.startHeight) - 1);

      if (changeX >= changeY) {
        height = width / ratio;
        if (height > maxHeight) {
          height = maxHeight;
          width = height * ratio;
        }
        if (height < minSize) {
          height = minSize;
          width = height * ratio;
        }
      } else {
        width = height * ratio;
        if (width > maxWidth) {
          width = maxWidth;
          height = width / ratio;
        }
        if (width < minSize) {
          width = minSize;
          height = width * ratio;
        }
      }
    }

    updateImage(drag.kind, drag.id, {
      xMm: round(east ? anchorX : anchorX - width),
      yMm: round(south ? anchorY : anchorY - height),
      widthMm: round(width),
      heightMm: round(height),
    });
    return;
  }

  let left = drag.startLeft;
  let top = drag.startTop;
  let width = drag.startWidth;
  let height = drag.startHeight;

  if (drag.mode === 'e') {
    width = clamp(drag.startWidth + dx, minSize, widthMm - drag.startLeft);
  } else if (drag.mode === 'w') {
    const right = drag.startLeft + drag.startWidth;
    width = clamp(drag.startWidth - dx, minSize, right);
    left = right - width;
  } else if (drag.mode === 's') {
    height = clamp(drag.startHeight + dy, minSize, heightMm - drag.startTop);
  } else if (drag.mode === 'n') {
    const bottom = drag.startTop + drag.startHeight;
    height = clamp(drag.startHeight - dy, minSize, bottom);
    top = bottom - height;
  }

  updateImage(drag.kind, drag.id, {
    xMm: round(left),
    yMm: round(top),
    widthMm: round(width),
    heightMm: round(height),
    // Los tiradores laterales son "estirar libre": la imagen debe llenar la caja.
    fit: 'fill',
  });
}

function endDrag(): void {
  drag = null;
  window.removeEventListener('pointermove', onPointerMove);
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', endDrag);
});

const handles: { mode: HandleMode; class: string }[] = [
  { mode: 'nw', class: '-left-1 -top-1 cursor-nwse-resize' },
  { mode: 'n', class: 'left-1/2 -top-1 -translate-x-1/2 cursor-ns-resize' },
  { mode: 'ne', class: '-right-1 -top-1 cursor-nesw-resize' },
  { mode: 'e', class: '-right-1 top-1/2 -translate-y-1/2 cursor-ew-resize' },
  { mode: 'se', class: '-bottom-1 -right-1 cursor-nwse-resize' },
  { mode: 's', class: 'bottom-[-4px] left-1/2 -translate-x-1/2 cursor-ns-resize' },
  { mode: 'sw', class: '-bottom-1 -left-1 cursor-nesw-resize' },
  { mode: 'w', class: '-left-1 top-1/2 -translate-y-1/2 cursor-ew-resize' },
];
</script>

<template>
  <div class="overflow-hidden" :style="wrapperStyle">
    <div class="bg-white shadow-sm" :style="[pageStyle, innerStyle]">
      <!-- Zona superior: logo, membrete y cabecera, anclados al borde -->
      <div :style="topZoneStyle">
        <!-- Logotipo -->
        <div
          v-if="tokens.logo.enabled && tokens.logo.dataUrl"
        class="mb-3 shrink-0"
        :style="{ textAlign: tokens.logo.align }"
      >
        <img :src="tokens.logo.dataUrl" alt="" :style="{ width: `${tokens.logo.width}px`, display: 'inline-block' }" />
      </div>

      <!-- Membrete -->
      <div v-if="tokens.letterhead.enabled" class="mb-4 shrink-0" :style="{ textAlign: tokens.letterhead.align }">
        <div
          v-if="tokens.letterhead.title"
          :style="{ color: tokens.primaryColor, fontWeight: 700, fontSize: '1.4em', letterSpacing: '.04em' }"
        >
          {{ tokens.letterhead.title }}
        </div>
        <div v-if="tokens.letterhead.subtitle" :style="{ opacity: 0.75, fontSize: '.9em' }">
          {{ tokens.letterhead.subtitle }}
        </div>
        <div :style="{ borderTop: `2px solid ${tokens.primaryColor}`, marginTop: '.5em' }" />
      </div>

      <!-- Imágenes globales de cabecera -->
      <div
        v-if="tokens.header.enabled || interactive"
        data-design-band="header"
        class="shrink-0"
        :class="interactive ? 'select-none' : ''"
        :style="{
          position: 'relative',
          width: `${headerWidthPercent}%`,
          marginLeft: 'auto',
          marginRight: 'auto',
          height: `${headerHeightMm / 10}cm`,
          marginBottom: '.6em',
          ...guideStyle,
        }"
        @pointerdown.self="clearSelection"
      >
        <span
          v-if="showGuides"
          class="pointer-events-none absolute left-1 top-1 z-10 rounded bg-accent/85 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wide text-white"
        >
          Cabecera · {{ headerHeightMm.toFixed(0) }} mm · {{ headerWidthPercent }}%
        </span>

        <template v-if="interactive">
          <div
            v-for="image in headerImages"
            :key="image.id"
            class="absolute touch-none"
            :class="
              selected?.kind === 'header' && selected.id === image.id
                ? 'cursor-move outline outline-2 outline-offset-1 outline-accent'
                : 'cursor-move'
            "
            :style="bandImageStyleMm(image)"
            @pointerdown="beginDrag($event, image, 'header', 'move')"
          >
            <img :src="image.src" alt="" class="pointer-events-none size-full" :style="{ objectFit: bandImageFit(image) }" draggable="false" />
            <template v-if="selected?.kind === 'header' && selected.id === image.id">
              <button
                type="button"
                class="absolute -right-2 -top-2 z-20 grid size-5 place-items-center rounded-full bg-danger text-white shadow"
                title="Eliminar imagen"
                @pointerdown.stop
                @click.stop="removeImage('header', image.id)"
              >
                <Trash2 class="size-3" />
              </button>
              <span
                v-for="handle in handles"
                :key="handle.mode"
                class="absolute z-20 size-2 rounded-sm border border-white bg-accent shadow"
                :class="handle.class"
                @pointerdown.stop.prevent="beginDrag($event, image, 'header', handle.mode)"
              />
            </template>
          </div>
        </template>
        <template v-else>
          <img
            v-for="image in headerImages"
            :key="image.id"
            :src="image.src"
            alt=""
            :style="bandImageStyleMm(image)"
          />
        </template>

        <span
          v-if="interactive && headerImages.length === 0"
          class="pointer-events-none absolute inset-0 grid place-items-center text-[9px] text-ink-subtle/70"
        >
          Sube imágenes y arrástralas aquí
        </span>
      </div>
      </div>

      <!-- Cuerpo: conserva los márgenes laterales -->
      <div :style="bodyStyle">
        <!-- Contenido de muestra -->
        <div class="shrink-0">
        <h1 :style="{ color: tokens.primaryColor, fontSize: `${1.75 * tokens.headingScale}em`, fontWeight: 700, marginBottom: '.4em' }">
          MEMORÁNDUM
        </h1>
        <p :style="{ marginBottom: '.7em' }"><strong>N° </strong>MEM-2026-0001</p>
        <hr :style="{ border: 0, borderTop: `1px solid ${tokens.tableBorderColor}`, margin: '.8em 0' }" />

        <table :style="{ width: '100%', borderCollapse: 'collapse', marginBottom: '1em' }">
          <tbody>
            <tr>
              <td :style="{ padding: '.3em .4em', verticalAlign: 'top' }"><strong>PARA:</strong></td>
              <td :style="{ padding: '.3em .4em' }">María Quispe — Jefa de Almacén</td>
            </tr>
            <tr>
              <td :style="{ padding: '.3em .4em' }"><strong>DE:</strong></td>
              <td :style="{ padding: '.3em .4em' }">Samuel Marcos — Logística</td>
            </tr>
            <tr>
              <td :style="{ padding: '.3em .4em' }"><strong>ASUNTO:</strong></td>
              <td :style="{ padding: '.3em .4em' }">Entrega de equipos</td>
            </tr>
          </tbody>
        </table>

        <p :style="{ marginBottom: '.7em' }">
          Por medio del presente se comunica la entrega de los bienes detallados a continuación,
          conforme al inventario institucional.
        </p>

        <table
          :style="{
            width: '100%',
            borderCollapse: 'collapse',
            marginBottom: '1em',
            fontSize: '.95em',
          }"
        >
          <thead>
            <tr>
              <th :style="{ background: tokens.tableHeadColor, border: `1px solid ${tokens.tableBorderColor}`, padding: '.35em .45em', textAlign: 'left' }">Cantidad</th>
              <th :style="{ background: tokens.tableHeadColor, border: `1px solid ${tokens.tableBorderColor}`, padding: '.35em .45em', textAlign: 'left' }">Descripción</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td :style="{ border: `1px solid ${tokens.tableBorderColor}`, padding: '.35em .45em' }">4</td>
              <td :style="{ border: `1px solid ${tokens.tableBorderColor}`, padding: '.35em .45em' }">Laptops Lenovo ThinkPad</td>
            </tr>
            <tr>
              <td :style="{ border: `1px solid ${tokens.tableBorderColor}`, padding: '.35em .45em' }">10</td>
              <td :style="{ border: `1px solid ${tokens.tableBorderColor}`, padding: '.35em .45em' }">Cables HDMI</td>
            </tr>
          </tbody>
        </table>

        <p :style="{ marginTop: '1.4em' }">Atentamente,</p>
          <p :style="{ marginTop: '2.2em' }"><strong>Samuel Marcos</strong><br />Jefe de Logística</p>
        </div>
      </div>

      <!-- Zona inferior: pie anclado al borde -->
      <div :style="bottomZoneStyle">
        <!-- Pie -->
        <div
          v-if="tokens.footer.enabled || interactive"
        data-design-band="footer"
        class="shrink-0"
        :class="interactive ? 'select-none' : ''"
        :style="{
          position: 'relative',
          width: `${footerWidthPercent}%`,
          marginLeft: 'auto',
          marginRight: 'auto',
          minHeight: `${footerHeightMm / 10}cm`,
          marginTop: 'auto',
          paddingTop: '.4em',
          display: 'flex',
          flexDirection: 'column' as const,
          justifyContent: 'flex-end',
          borderTop: `1px solid ${tokens.tableBorderColor}`,
          fontSize: '.8em',
          textAlign: tokens.footer.align,
          opacity: 0.8,
          ...guideStyle,
        }"
        @pointerdown.self="clearSelection"
      >
        <span
          v-if="showGuides"
          class="pointer-events-none absolute left-1 top-1 z-10 rounded bg-accent/85 px-1.5 py-0.5 text-[8px] font-medium uppercase tracking-wide text-white"
        >
          Pie · {{ footerHeightMm.toFixed(0) }} mm · {{ footerWidthPercent }}%
        </span>

        <span>{{ tokens.footer.content.replace('{page}', '1').replace('{total}', '1') }}</span>

        <template v-if="interactive">
          <div
            v-for="image in footerImages"
            :key="image.id"
            class="absolute touch-none"
            :class="
              selected?.kind === 'footer' && selected.id === image.id
                ? 'cursor-move outline outline-2 outline-offset-1 outline-accent'
                : 'cursor-move'
            "
            :style="bandImageStyleMm(image)"
            @pointerdown="beginDrag($event, image, 'footer', 'move')"
          >
            <img :src="image.src" alt="" class="pointer-events-none size-full" :style="{ objectFit: bandImageFit(image) }" draggable="false" />
            <template v-if="selected?.kind === 'footer' && selected.id === image.id">
              <button
                type="button"
                class="absolute -right-2 -top-2 z-20 grid size-5 place-items-center rounded-full bg-danger text-white shadow"
                title="Eliminar imagen"
                @pointerdown.stop
                @click.stop="removeImage('footer', image.id)"
              >
                <Trash2 class="size-3" />
              </button>
              <span
                v-for="handle in handles"
                :key="handle.mode"
                class="absolute z-20 size-2 rounded-sm border border-white bg-accent shadow"
                :class="handle.class"
                @pointerdown.stop.prevent="beginDrag($event, image, 'footer', handle.mode)"
              />
            </template>
          </div>
        </template>
        <template v-else>
          <img
            v-for="image in footerImages"
            :key="image.id"
            :src="image.src"
            alt=""
            :style="bandImageStyleMm(image)"
          />
        </template>

          <span
            v-if="interactive && footerImages.length === 0"
            class="pointer-events-none absolute inset-0 grid place-items-center text-[9px] text-ink-subtle/70"
          >
            Sube imágenes y arrástralas aquí
          </span>
        </div>
      </div>
    </div>
  </div>
</template>
