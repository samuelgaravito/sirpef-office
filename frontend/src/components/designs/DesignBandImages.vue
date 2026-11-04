<script setup lang="ts">
import { ImagePlus, Maximize2, Move, Trash2 } from 'lucide-vue-next';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

import { useToast } from '@/composables/useToast';
import { bandImageFit, bandImageStylePercent } from '@/lib/band-images';
import type { BandImage } from '@sirpefoffice/shared';

const props = withDefaults(
  defineProps<{
    modelValue: BandImage[];
    widthMm: number;
    heightMm: number;
    label: string;
    enabled: boolean;
    /** En el editor de Diseño la manipulación se hace sobre la hoja grande. */
    showCanvas?: boolean;
  }>(),
  { showCanvas: true },
);

const emit = defineEmits<{
  'update:modelValue': [images: BandImage[]];
  added: [];
}>();

const toast = useToast();
const band = ref<HTMLElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const selectedId = ref<string | null>(null);

const images = computed(() => props.modelValue ?? []);
const selected = computed(() => images.value.find((image) => image.id === selectedId.value) ?? null);

watch(
  () => images.value.length,
  (length) => {
    if (selectedId.value && !images.value.some((image) => image.id === selectedId.value)) {
      selectedId.value = null;
    }
    if (length === 0) selectedId.value = null;
  },
);

// Si el usuario reduce el alto/ancho de la franja, las imágenes existentes se
// reescalan y se recolocan para que sigan dentro de ella.
watch([() => props.widthMm, () => props.heightMm], () => {
  if (!images.value.length) return;
  const next = images.value.map((image) => {
    const ratio = image.widthMm / Math.max(1, image.heightMm);
    let widthMm = image.widthMm;
    let heightMm = image.heightMm;
    if (widthMm > props.widthMm) {
      widthMm = props.widthMm;
      heightMm = widthMm / ratio;
    }
    if (heightMm > props.heightMm) {
      heightMm = props.heightMm;
      widthMm = heightMm * ratio;
    }
    return {
      ...image,
      widthMm: round(widthMm),
      heightMm: round(heightMm),
      xMm: round(clamp(image.xMm, 0, Math.max(0, props.widthMm - widthMm))),
      yMm: round(clamp(image.yMm, 0, Math.max(0, props.heightMm - heightMm))),
    };
  });
  const changed = next.some((image, index) => {
    const previous = images.value[index];
    return (
      !previous ||
      image.xMm !== previous.xMm ||
      image.yMm !== previous.yMm ||
      image.widthMm !== previous.widthMm ||
      image.heightMm !== previous.heightMm
    );
  });
  if (changed) emit('update:modelValue', next);
});

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function nextId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `band-image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function updateImage(id: string, patch: Partial<BandImage>): void {
  emit(
    'update:modelValue',
    images.value.map((image) => (image.id === id ? { ...image, ...patch } : image)),
  );
}

function removeImage(id: string): void {
  emit('update:modelValue', images.value.filter((image) => image.id !== id));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function imageRatio(image: BandImage): number {
  if (Number(image.naturalWidth) > 0 && Number(image.naturalHeight) > 0) {
    return Number(image.naturalWidth) / Number(image.naturalHeight);
  }
  return image.widthMm / Math.max(1, image.heightMm);
}

function setFit(fit: 'contain' | 'fill'): void {
  if (!selected.value) return;
  updateImage(selected.value.id, { fit });
}

/** Escala la imagen al máximo que cabe en la franja y la centra. */
function fitToBand(): void {
  const image = selected.value;
  if (!image) return;
  const ratio = imageRatio(image);
  let widthMm = props.widthMm;
  let heightMm = widthMm / ratio;
  if (heightMm > props.heightMm) {
    heightMm = props.heightMm;
    widthMm = heightMm * ratio;
  }
  updateImage(image.id, {
    xMm: round(Math.max(0, (props.widthMm - widthMm) / 2)),
    yMm: round(Math.max(0, (props.heightMm - heightMm) / 2)),
    widthMm: round(Math.max(1, widthMm)),
    heightMm: round(Math.max(1, heightMm)),
    fit: 'contain',
  });
}

/** Coloca la imagen sobre toda la franja y la estira. */
function fillBand(): void {
  const image = selected.value;
  if (!image) return;
  updateImage(image.id, {
    xMm: 0,
    yMm: 0,
    widthMm: round(props.widthMm),
    heightMm: round(props.heightMm),
    fit: 'fill',
  });
}

function pickFile(): void {
  fileInput.value?.click();
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('No se pudo leer la imagen'));
    reader.readAsDataURL(file);
  });
}

function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error('La imagen no es válida'));
    image.src = src;
  });
}

async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  if (file.size > 2_000_000) {
    toast.error('La imagen debe pesar menos de 2 MB');
    return;
  }
  if (images.value.length >= 20) {
    toast.error('Cada banda admite como máximo 20 imágenes');
    return;
  }

  try {
    const src = await readDataUrl(file);
    const size = await imageSize(src);
    if (!size.width || !size.height) throw new Error('La imagen no es válida');

    const ratio = size.width / size.height;
    let heightMm = Math.min(props.heightMm * 0.78, 30);
    let widthMm = heightMm * ratio;
    const maxWidth = Math.max(4, props.widthMm * 0.9);
    if (widthMm > maxWidth) {
      widthMm = maxWidth;
      heightMm = widthMm / ratio;
    }
    if (heightMm > props.heightMm * 0.9) {
      heightMm = props.heightMm * 0.9;
      widthMm = heightMm * ratio;
    }

    const image: BandImage = {
      id: nextId(),
      src,
      xMm: Math.max(0, (props.widthMm - widthMm) / 2),
      yMm: Math.max(0, (props.heightMm - heightMm) / 2),
      widthMm: round(widthMm),
      heightMm: round(heightMm),
      fit: 'contain',
      naturalWidth: size.width,
      naturalHeight: size.height,
      opacity: 1,
      zIndex: 1,
    };

    emit('update:modelValue', [...images.value, image]);
    emit('added');
    selectedId.value = image.id;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo añadir la imagen');
  }
}

interface DragState {
  id: string;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
  startWidth: number;
  startHeight: number;
  ratio: number;
}

let drag: DragState | null = null;

function beginDrag(event: PointerEvent, image: BandImage, mode: 'move' | 'resize'): void {
  if (event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();
  selectedId.value = image.id;
  drag = {
    id: image.id,
    mode,
    startX: event.clientX,
    startY: event.clientY,
    startLeft: image.xMm,
    startTop: image.yMm,
    startWidth: image.widthMm,
    startHeight: image.heightMm,
    ratio: image.widthMm / Math.max(1, image.heightMm),
  };
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', endDrag, { once: true });
}

function onPointerMove(event: PointerEvent): void {
  if (!drag || !band.value) return;
  const rect = band.value.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const dx = ((event.clientX - drag.startX) / rect.width) * props.widthMm;
  const dy = ((event.clientY - drag.startY) / rect.height) * props.heightMm;

  if (drag.mode === 'move') {
    const image = images.value.find((item) => item.id === drag?.id);
    if (!image) return;
    updateImage(image.id, {
      xMm: round(clamp(drag.startLeft + dx, 0, Math.max(0, props.widthMm - image.widthMm))),
      yMm: round(clamp(drag.startTop + dy, 0, Math.max(0, props.heightMm - image.heightMm))),
    });
    return;
  }

  const available = Math.min(
    props.widthMm - drag.startLeft,
    (props.heightMm - drag.startTop) * drag.ratio,
  );
  const maxWidth = Math.max(0.5, available);
  const delta = (dx + dy * drag.ratio) / 2;
  const width = clamp(drag.startWidth + delta, Math.min(4, maxWidth), maxWidth);
  updateImage(drag.id, {
    widthMm: round(width),
    heightMm: round(width / drag.ratio),
  });
}

function endDrag(): void {
  drag = null;
  window.removeEventListener('pointermove', onPointerMove);
}

function setNumber(field: 'xMm' | 'yMm' | 'widthMm' | 'heightMm', event: Event): void {
  if (!selected.value) return;
  const raw = Number((event.target as HTMLInputElement).value);
  if (!Number.isFinite(raw)) return;
  const image = selected.value;

  if (field === 'xMm') {
    updateImage(image.id, { xMm: round(clamp(raw, 0, Math.max(0, props.widthMm - image.widthMm))) });
  } else if (field === 'yMm') {
    updateImage(image.id, { yMm: round(clamp(raw, 0, Math.max(0, props.heightMm - image.heightMm))) });
  } else if (field === 'widthMm') {
    const maxWidth = Math.max(0.5, props.widthMm - image.xMm);
    const width = clamp(raw, Math.min(4, maxWidth), maxWidth);
    updateImage(image.id, { widthMm: round(width), fit: 'fill' });
  } else {
    const maxHeight = Math.max(0.5, props.heightMm - image.yMm);
    const height = clamp(raw, Math.min(4, maxHeight), maxHeight);
    updateImage(image.id, { heightMm: round(height), fit: 'fill' });
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', endDrag);
});
</script>

<template>
  <div class="rounded-xl border border-hairline bg-surface-muted/35 p-3">
    <div class="mb-2 flex flex-wrap items-center justify-between gap-2">
      <div>
        <p class="text-[12.5px] font-medium text-ink">Imágenes de {{ label.toLowerCase() }}</p>
        <p class="text-[11px] text-ink-subtle">Se repiten en cada página del PDF/DOCX y solo se mueven dentro de la franja.</p>
      </div>
      <button type="button" class="btn btn-outline btn-sm" @click="pickFile">
        <ImagePlus class="size-3.5" />
        Subir imagen
      </button>
      <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="hidden" @change="onFile" />
    </div>

    <div
      v-if="showCanvas"
      ref="band"
      class="relative w-full overflow-hidden rounded-lg border border-dashed border-hairline-strong bg-white shadow-inner"
      :class="enabled ? '' : 'opacity-60'"
      :style="{ aspectRatio: `${Math.max(1, widthMm)} / ${Math.max(1, heightMm)}` }"
      @pointerdown="selectedId = null"
    >
      <div
        class="pointer-events-none absolute inset-0 opacity-40"
        style="background-image: linear-gradient(to right, rgba(100,116,139,.12) 1px, transparent 1px), linear-gradient(to bottom, rgba(100,116,139,.12) 1px, transparent 1px); background-size: 10mm 10mm;"
      />
      <span class="pointer-events-none absolute left-2 top-1.5 text-[10px] font-medium uppercase tracking-wide text-ink-subtle/70">
        {{ label }} · {{ widthMm.toFixed(0) }} × {{ heightMm.toFixed(0) }} mm
      </span>

      <div
        v-for="image in images"
        :key="image.id"
        class="absolute cursor-move touch-none select-none"
        :class="selectedId === image.id ? 'outline outline-2 outline-offset-1 outline-accent' : ''"
        :style="bandImageStylePercent(image, widthMm, heightMm)"
        @pointerdown="beginDrag($event, image, 'move')"
      >
        <img :src="image.src" alt="" class="pointer-events-none size-full" :style="{ objectFit: bandImageFit(image) }" draggable="false" />
        <button
          v-if="selectedId === image.id"
          type="button"
          class="absolute right-0 top-0 grid size-5 place-items-center rounded-full bg-danger text-white shadow"
          title="Eliminar imagen"
          @pointerdown.stop
          @click.stop="removeImage(image.id)"
        >
          <Trash2 class="size-3" />
        </button>
        <button
          v-if="selectedId === image.id"
          type="button"
          class="absolute bottom-0 right-0 grid size-5 cursor-nwse-resize place-items-center rounded-full bg-accent text-white shadow"
          title="Redimensionar"
          @pointerdown="beginDrag($event, image, 'resize')"
        >
          <Maximize2 class="size-3" />
        </button>
      </div>

      <p v-if="images.length === 0" class="pointer-events-none absolute inset-0 grid place-items-center px-4 text-center text-[12px] text-ink-subtle">
        <span>
          <Move class="mx-auto mb-1 size-4 opacity-60" />
          Sube una imagen y arrástrala dentro de esta franja.
        </span>
      </p>
    </div>

    <div v-if="!showCanvas && images.length > 0" class="mt-2 grid grid-cols-3 gap-2">
      <div
        v-for="image in images"
        :key="image.id"
        class="group relative cursor-pointer overflow-hidden rounded-lg border bg-white transition-shadow"
        :class="selectedId === image.id ? 'border-accent ring-2 ring-accent/30' : 'border-hairline hover:border-hairline-strong'"
        title="Seleccionar para ajustar sus medidas"
        @click="selectedId = selectedId === image.id ? null : image.id"
      >
        <img :src="image.src" alt="" class="h-14 w-full object-contain p-1" />
        <button
          type="button"
          class="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-danger text-white opacity-0 shadow transition-opacity group-hover:opacity-100"
          title="Eliminar imagen"
          @click.stop="removeImage(image.id)"
        >
          <Trash2 class="size-3" />
        </button>
      </div>
    </div>

    <div v-if="selected" class="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <label class="block">
        <span class="mb-1 block text-[10.5px] font-medium uppercase tracking-wide text-ink-subtle">X (mm)</span>
        <input type="number" step="0.5" class="field !py-1.5 !text-[12px]" :value="round(selected.xMm)" @change="setNumber('xMm', $event)" />
      </label>
      <label class="block">
        <span class="mb-1 block text-[10.5px] font-medium uppercase tracking-wide text-ink-subtle">Y (mm)</span>
        <input type="number" step="0.5" class="field !py-1.5 !text-[12px]" :value="round(selected.yMm)" @change="setNumber('yMm', $event)" />
      </label>
      <label class="block">
        <span class="mb-1 block text-[10.5px] font-medium uppercase tracking-wide text-ink-subtle">Ancho (mm)</span>
        <input type="number" step="0.5" min="4" class="field !py-1.5 !text-[12px]" :value="round(selected.widthMm)" @change="setNumber('widthMm', $event)" />
      </label>
      <label class="block">
        <span class="mb-1 block text-[10.5px] font-medium uppercase tracking-wide text-ink-subtle">Alto (mm)</span>
        <input type="number" step="0.5" min="4" class="field !py-1.5 !text-[12px]" :value="round(selected.heightMm)" @change="setNumber('heightMm', $event)" />
      </label>
    </div>

    <div v-if="selected" class="mt-2 flex flex-wrap items-center gap-1.5">
      <span class="text-[10.5px] font-medium uppercase tracking-wide text-ink-subtle">Ajuste</span>
      <button
        type="button"
        class="btn btn-outline btn-sm"
        :class="bandImageFit(selected) === 'contain' ? 'border-accent text-accent' : ''"
        title="La imagen cabe en su caja sin deformarse"
        @click="setFit('contain')"
      >
        Ajustar
      </button>
      <button
        type="button"
        class="btn btn-outline btn-sm"
        :class="bandImageFit(selected) === 'fill' ? 'border-accent text-accent' : ''"
        title="La imagen se estira hasta ocupar su caja"
        @click="setFit('fill')"
      >
        Estirar
      </button>
      <span class="mx-1 h-4 w-px bg-hairline" />
      <button type="button" class="btn btn-outline btn-sm" title="Escala la imagen al máximo que cabe en la franja y la centra" @click="fitToBand">
        Ajustar a la franja
      </button>
      <button type="button" class="btn btn-outline btn-sm" title="Coloca la imagen sobre toda la franja y la estira" @click="fillBand">
        Ocupar la franja
      </button>
    </div>

    <p v-if="images.length > 0" class="mt-2 text-[11px] text-ink-subtle">
      {{ images.length }} imagen{{ images.length === 1 ? '' : 'es' }} ·
      {{ showCanvas ? 'Arrastra para mover, usa la esquina azul para redimensionar.' : 'Muévelas sobre la hoja; selecciona una miniatura para ajustar sus medidas.' }}
    </p>
  </div>
</template>
