<script setup lang="ts">
import {
  ArrowLeft,
  ImagePlus,
  Loader2,
  Lock,
  PanelLeftClose,
  PanelLeftOpen,
  Save,
  Scan,
  Trash2,
  Unlock,
  ZoomIn,
  ZoomOut,
} from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import DesignBandImages from '@/components/designs/DesignBandImages.vue';
import DesignPreview from '@/components/designs/DesignPreview.vue';
import BaseSpinner from '@/components/ui/BaseSpinner.vue';
import BaseSwitch from '@/components/ui/BaseSwitch.vue';
import { api } from '@/api/client';
import { useToast } from '@/composables/useToast';
import { useAuthStore } from '@/stores/auth';
import {
  clampChromeWidth,
  clampLineHeight,
  DEFAULT_DESIGN_TOKENS,
  DESIGN_FONT_OPTIONS,
  LINE_HEIGHT_PRESETS,
  PAGE_SIZES_CM,
} from '@sirpefoffice/shared';
import type { DesignTokens } from '@sirpefoffice/shared';
import type { DesignDetailResponse, DesignRecord } from '@/types';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const auth = useAuthStore();

const designId = computed(() => (route.params.id === 'new' ? null : String(route.params.id)));
const isNew = computed(() => designId.value === null);

const loading = ref(true);
const saving = ref(false);
const name = ref('Nuevo diseño');
const description = ref('');
const isShared = ref(false);
const ownerId = ref<string | null>(null);
const version = ref(1);
/** Interruptor «en uso»: solo uno por cuenta. */
const isCurrent = ref(false);
const canChangeStatus = computed(
  () => !isNew.value && ownerId.value !== null && ownerId.value === auth.user?.id,
);
/** Solo el propietario puede encender o apagar el diseño en uso. */
const canChangeCampaign = computed(() => canChangeStatus.value);
const tokens = reactive<DesignTokens>(structuredClone(DEFAULT_DESIGN_TOKENS));

const panelOpen = ref(true);
const zoom = ref(0.9);
const lockAspect = ref(true);
const canvasViewport = ref<HTMLElement | null>(null);
const viewportWidth = ref(0);
let viewportObserver: ResizeObserver | null = null;

const PAGE_PX_PER_CM = 37.795;
const MIN_ZOOM = 0.35;
const MAX_ZOOM = 2.5;

const pageSizeCm = computed(() => {
  const size = PAGE_SIZES_CM[tokens.pageFormat] ?? PAGE_SIZES_CM.A4!;
  return tokens.orientation === 'landscape'
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
});

const sheetWidthPx = computed(() => pageSizeCm.value.width * PAGE_PX_PER_CM);
const fitScale = computed(() => {
  if (viewportWidth.value <= 0) return 0.9;
  return clampZoom((viewportWidth.value - 64) / sheetWidthPx.value);
});
const zoomPercent = computed(() => `${Math.round(zoom.value * 100)}%`);

const fonts = computed(() => {
  const options = DESIGN_FONT_OPTIONS.map(({ label, value }) => ({ label, value }));
  if (!options.some((font) => font.value === tokens.fontFamily)) {
    const label = tokens.fontFamily.split(',')[0]?.replace(/['"]/g, '').trim();
    options.push({ label: label || 'Personalizada', value: tokens.fontFamily });
  }
  return options;
});

const lineHeightValue = computed(() => clampLineHeight(tokens.lineHeight));
const lineHeightLabel = computed(() => lineHeightValue.value.toFixed(2).replace('.', ','));

function normalizeLineHeight(): void {
  tokens.lineHeight = clampLineHeight(tokens.lineHeight);
}

function isLineHeightPreset(value: number): boolean {
  return Math.abs(lineHeightValue.value - value) < 0.001;
}

const colorFields = [
  { key: 'primaryColor', label: 'Primario' },
  { key: 'accentColor', label: 'Acento' },
  { key: 'textColor', label: 'Texto' },
  { key: 'backgroundColor', label: 'Fondo' },
  { key: 'tableHeadColor', label: 'Cabecera de tabla' },
  { key: 'tableBorderColor', label: 'Borde de tabla' },
] as const;

const pageWidthMm = computed(() => {
  const size = PAGE_SIZES_CM[tokens.pageFormat] ?? PAGE_SIZES_CM.A4!;
  return (tokens.orientation === 'landscape' ? size.height : size.width) * 10;
});

const headerWidthPercent = computed({
  get: () => clampChromeWidth(tokens.header.widthPercent),
  set: (value: number) => {
    tokens.header.widthPercent = clampChromeWidth(value);
  },
});
const footerWidthPercent = computed({
  get: () => clampChromeWidth(tokens.footer.widthPercent),
  set: (value: number) => {
    tokens.footer.widthPercent = clampChromeWidth(value);
  },
});

const headerBandWidthMm = computed(
  () => (pageWidthMm.value * headerWidthPercent.value) / 100,
);
const footerBandWidthMm = computed(
  () => (pageWidthMm.value * footerWidthPercent.value) / 100,
);

const headerBandHeightMm = computed(() =>
  Math.max(5, Math.min(80, Number(tokens.header.heightMm) || 18)),
);
const footerBandHeightMm = computed(() =>
  Math.max(5, Math.min(80, Number(tokens.footer.heightMm) || 16)),
);

function ensureBandDefaults(): void {
  tokens.header.images ??= [];
  tokens.header.heightMm ??= 18;
  tokens.header.widthPercent = clampChromeWidth(tokens.header.widthPercent);
  tokens.footer.images ??= [];
  tokens.footer.heightMm ??= 16;
  tokens.footer.widthPercent = clampChromeWidth(tokens.footer.widthPercent);
}

function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 0.9;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

function zoomIn(): void {
  zoom.value = clampZoom(zoom.value + 0.1);
}

function zoomOut(): void {
  zoom.value = clampZoom(zoom.value - 0.1);
}

function fitWidth(): void {
  zoom.value = fitScale.value;
}

function resetZoom(): void {
  zoom.value = 1;
}

function togglePanel(): void {
  panelOpen.value = !panelOpen.value;
  void nextTick(() => observeCanvas());
}

function onCanvasWheel(event: WheelEvent): void {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  zoom.value = clampZoom(zoom.value - event.deltaY * 0.0015);
}

function observeCanvas(): void {
  viewportObserver?.disconnect();
  viewportObserver = null;
  const element = canvasViewport.value;
  if (!element) return;

  viewportWidth.value = element.clientWidth;
  viewportObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (!entry) return;
    viewportWidth.value = entry.contentRect.width;
  });
  viewportObserver.observe(element);
}

watch(loading, async (value) => {
  if (value) return;
  await nextTick();
  observeCanvas();
  fitWidth();
});

async function load(): Promise<void> {
  loading.value = true;
  try {
    if (!isNew.value) {
      const data = await api.get<DesignDetailResponse>(`/designs/${designId.value}`);
      name.value = data.design.name;
      description.value = data.design.description;
      isShared.value = data.design.isShared;
      ownerId.value = data.design.ownerId;
      version.value = data.design.version;
      isCurrent.value = Boolean(data.design.isCurrent);
      Object.assign(tokens, structuredClone(data.design.tokens));
    }
    ensureBandDefaults();
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo cargar el diseño');
  } finally {
    loading.value = false;
  }
}

function readLogo(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;

  if (file.size > 1_500_000) {
    toast.error('El logotipo debe pesar menos de 1,5 MB');
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    tokens.logo.dataUrl = String(reader.result ?? '');
    tokens.logo.enabled = true;
  };
  reader.readAsDataURL(file);
}

/** Interruptor «en uso»: al encenderlo se apaga el que lo estuviera. */
async function setCampaign(next: boolean): Promise<void> {
  if (!designId.value || !canChangeCampaign.value) return;
  const previous = isCurrent.value;
  isCurrent.value = next;
  try {
    await api.post<{ design: { isCurrent: boolean } }>(`/designs/${designId.value}/activate`, {
      isCurrent: next,
    });
    toast.success(
      next
        ? `«${name.value}» está en uso: todas las plantillas se dibujan con él`
        : `«${name.value}» ya no está en uso`,
    );
  } catch (error) {
    isCurrent.value = previous;
    toast.error(error instanceof Error ? error.message : 'No se pudo cambiar el diseño en uso');
  }
}

async function save(): Promise<void> {
  if (saving.value) return;
  if (!name.value.trim()) {
    toast.error('El diseño necesita un nombre');
    return;
  }

  saving.value = true;
  try {
    tokens.header.heightMm = Math.min(80, Math.max(5, Number(tokens.header.heightMm) || 18));
    tokens.footer.heightMm = Math.min(80, Math.max(5, Number(tokens.footer.heightMm) || 16));
    tokens.header.widthPercent = clampChromeWidth(tokens.header.widthPercent);
    tokens.footer.widthPercent = clampChromeWidth(tokens.footer.widthPercent);
    normalizeLineHeight();
    const payload = {
      name: name.value.trim(),
      description: description.value,
      tokens: { ...tokens },
      isShared: isShared.value,
    };

    if (isNew.value) {
      await api.post('/designs', payload);
      toast.success('Diseño creado');
    } else {
      const data = await api.patch<{ design: { version: number } }>(`/designs/${designId.value}`, {
        ...payload,
        expectedVersion: version.value,
      });
      version.value = data.design.version;
      toast.success('Diseño guardado');
    }

    await router.replace({ name: 'designs' });
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo guardar el diseño');
  } finally {
    saving.value = false;
  }
}

onMounted(load);
onBeforeUnmount(() => {
  viewportObserver?.disconnect();
  viewportObserver = null;
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-canvas">
    <header class="flex h-14 shrink-0 items-center gap-2 border-b border-hairline bg-surface px-3">
      <RouterLink :to="{ name: 'designs' }" class="rounded-lg p-2 text-ink-muted hover:bg-surface-hover hover:text-ink">
        <ArrowLeft class="size-4.5" />
      </RouterLink>
      <span class="hidden h-8 w-px bg-hairline sm:block" />
      <div class="min-w-0 flex-1">
        <input
          v-model="name"
          class="w-full max-w-[380px] truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[14px] font-semibold hover:border-hairline focus:border-accent focus:outline-none"
        />
        <p class="px-1.5 text-[11px] text-ink-subtle">
          {{ isNew ? 'Nuevo diseño' : `Versión ${version}` }}
        </p>
      </div>
      <button type="button" class="btn btn-primary btn-sm" :disabled="saving" @click="save">
        <component :is="saving ? Loader2 : Save" :class="['size-3.5', saving ? 'animate-spin' : '']" />
        {{ saving ? 'Guardando…' : 'Guardar' }}
      </button>
    </header>

    <div v-if="loading" class="grid flex-1 place-items-center">
      <BaseSpinner label="Cargando diseño…" />
    </div>

    <div v-else class="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
      <!-- Panel de ajustes -->
      <aside
        v-if="panelOpen"
        class="min-h-0 w-full shrink-0 overflow-y-auto border-b border-hairline bg-surface px-5 py-6 sm:px-7 lg:w-[400px] lg:border-b-0 lg:border-r"
      >
        <div class="mx-auto max-w-[560px] space-y-6 pb-12">
          <section
            class="rounded-xl border p-3.5"
            :class="isCurrent ? 'border-accent bg-accent-soft/40' : 'border-hairline bg-surface-muted/60'"
          >
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-[13px] font-semibold text-ink">Diseño en uso</p>
                <p class="mt-1 text-[11.5px] leading-snug text-ink-muted">
                  {{
                    isCurrent
                      ? 'Es el diseño con el que se dibujan todas tus plantillas. Los documentos ya creados conservan el diseño con el que se hicieron.'
                      : 'Enciéndelo para que todas tus plantillas se dibujen con este diseño (solo uno puede estar en uso).'
                  }}
                </p>
              </div>
              <BaseSwitch
                v-if="canChangeCampaign"
                :model-value="isCurrent"
                :disabled="saving"
                label="Poner el diseño en uso"
                @update:model-value="setCampaign"
              />
            </div>
          </section>

          <section>
            <h2 class="mb-3 text-[13px] font-semibold text-ink">Identidad</h2>
            <div class="grid gap-3 sm:grid-cols-2">
              <div class="sm:col-span-2">
                <label class="label">Descripción</label>
                <input v-model="description" class="field" placeholder="Para qué se usa este diseño" />
              </div>
              <div>
                <label class="label">Tipografía</label>
                <select v-model="tokens.fontFamily" class="field">
                  <option v-for="font in fonts" :key="font.value" :value="font.value">{{ font.label }}</option>
                </select>
              </div>
              <div>
                <label class="label">Tamaño (pt)</label>
                <input v-model.number="tokens.fontSize" type="number" step="0.5" min="6" max="36" class="field" />
              </div>
            </div>

            <div class="mt-3 rounded-lg border border-hairline bg-surface-muted/60 p-3">
              <div class="flex items-center justify-between gap-2">
                <label class="label mb-0" for="design-line-height">Interlineado del cuerpo</label>
                <span class="text-[11px] tabular-nums text-ink-subtle">{{ lineHeightLabel }}×</span>
              </div>
              <div class="mt-2 flex flex-wrap gap-1.5">
                <button
                  v-for="preset in LINE_HEIGHT_PRESETS"
                  :key="preset.value"
                  type="button"
                  :class="[
                    'rounded-md border px-2 py-1 text-[11px] transition-colors',
                    isLineHeightPreset(preset.value)
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-hairline bg-surface text-ink-muted hover:bg-surface-hover',
                  ]"
                  :title="`Interlineado ${preset.hint}`"
                  @click="tokens.lineHeight = preset.value"
                >
                  {{ preset.label }}
                  <span class="ml-1 tabular-nums opacity-70">{{ preset.hint }}</span>
                </button>
              </div>
              <div class="mt-2 flex flex-wrap items-center gap-2">
                <span class="text-[11px] text-ink-subtle">Personalizado</span>
                <input
                  id="design-line-height"
                  v-model.number="tokens.lineHeight"
                  type="number"
                  step="0.05"
                  min="0.8"
                  max="3"
                  class="field w-24"
                  @blur="normalizeLineHeight"
                  @change="normalizeLineHeight"
                />
                <span class="text-[11px] text-ink-subtle">de 0,80 a 3,00</span>
              </div>
              <div
                class="mt-2 rounded-md border border-hairline bg-surface px-2.5 py-2 text-[11.5px] text-ink-muted"
                :style="{ fontFamily: tokens.fontFamily, lineHeight: lineHeightValue }"
              >
                <p style="margin: 0 0 0.35em">El cuerpo del documento respira con este interlineado.</p>
                <p style="margin: 0">Los títulos conservan un interlineado compacto.</p>
              </div>
            </div>

            <div class="mt-3">
              <label class="label">Escala de títulos ({{ tokens.headingScale.toFixed(2) }}×)</label>
              <input v-model.number="tokens.headingScale" type="range" min="0.6" max="1.8" step="0.05" class="w-full accent-[var(--color-accent)]" />
            </div>
          </section>

          <section>
            <h2 class="mb-3 text-[13px] font-semibold text-ink">Página</h2>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <label class="label">Formato</label>
                <select v-model="tokens.pageFormat" class="field">
                  <option value="A4">A4 (21 × 29,7 cm)</option>
                  <option value="Letter">Carta (21,59 × 27,94 cm)</option>
                  <option value="Legal">Legal (21,59 × 35,56 cm)</option>
                  <option value="Folio">Folio (21,59 × 33 cm)</option>
                </select>
              </div>
              <div>
                <label class="label">Orientación</label>
                <select v-model="tokens.orientation" class="field">
                  <option value="portrait">Vertical</option>
                  <option value="landscape">Horizontal</option>
                </select>
              </div>
            </div>

            <div class="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div v-for="side in (['top', 'right', 'bottom', 'left'] as const)" :key="side">
                <label class="label capitalize">{{ side === 'top' ? 'Superior' : side === 'bottom' ? 'Inferior' : side === 'left' ? 'Izquierdo' : 'Derecho' }}</label>
                <input v-model.number="tokens.margins[side]" type="number" step="0.1" min="0" max="10" class="field" />
              </div>
            </div>
          </section>

          <section>
            <h2 class="mb-3 text-[13px] font-semibold text-ink">Colores</h2>
            <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
              <div v-for="field in colorFields" :key="field.key">
                <label class="label">{{ field.label }}</label>
                <div class="flex items-center gap-2">
                  <input v-model="tokens[field.key]" type="color" class="size-8 shrink-0 cursor-pointer rounded border border-hairline bg-surface p-0.5" />
                  <input v-model="tokens[field.key]" class="field font-mono !text-[11.5px]" />
                </div>
              </div>
            </div>
          </section>

          <section>
            <h2 class="mb-3 text-[13px] font-semibold text-ink">Cabecera</h2>
            <div class="mb-3 flex flex-wrap items-center gap-4">
              <label class="flex cursor-pointer items-center gap-2 text-[12.5px]">
                <input v-model="tokens.header.enabled" type="checkbox" class="accent-[var(--color-accent)]" />
                Mostrar cabecera en cada página
              </label>
              <label class="flex items-center gap-1.5 text-[12px] text-ink-muted">
                Alto
                <input v-model.number="tokens.header.heightMm" type="number" min="5" max="80" step="1" class="field w-20 !py-1.5 !text-[12px]" />
                mm
              </label>
              <label
                class="flex items-center gap-1.5 text-[12px] text-ink-muted"
                title="Ancho de la banda respecto al ancho de la página (100 % = toda la hoja)"
              >
                Ancho
                <input
                  v-model.number="headerWidthPercent"
                  type="range"
                  min="20"
                  max="100"
                  step="1"
                  class="w-24 accent-[var(--color-accent)]"
                />
                <span class="w-9 text-right tabular-nums">{{ headerWidthPercent }}%</span>
              </label>
            </div>
            <DesignBandImages
              :model-value="tokens.header.images ?? []"
              :width-mm="headerBandWidthMm"
              :height-mm="headerBandHeightMm"
              label="Cabecera"
              :enabled="tokens.header.enabled"
              :show-canvas="false"
              @update:model-value="tokens.header.images = $event"
              @added="tokens.header.enabled = true"
            />
          </section>

          <section>
            <h2 class="mb-3 text-[13px] font-semibold text-ink">Membrete</h2>
            <label class="mb-3 flex cursor-pointer items-center gap-2 text-[12.5px]">
              <input v-model="tokens.letterhead.enabled" type="checkbox" class="accent-[var(--color-accent)]" />
              Mostrar membrete en cada página
            </label>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <label class="label">Título</label>
                <input v-model="tokens.letterhead.title" class="field" placeholder="INSTITUCIÓN" />
              </div>
              <div>
                <label class="label">Subtítulo</label>
                <input v-model="tokens.letterhead.subtitle" class="field" placeholder="Área / Departamento" />
              </div>
              <div>
                <label class="label">Alineación</label>
                <select v-model="tokens.letterhead.align" class="field">
                  <option value="left">Izquierda</option>
                  <option value="center">Centro</option>
                  <option value="right">Derecha</option>
                </select>
              </div>
            </div>

            <div class="mt-3 rounded-lg border border-hairline p-3">
              <div class="flex items-center justify-between">
                <span class="text-[12.5px] font-medium">Logotipo</span>
                <label class="btn btn-outline btn-sm cursor-pointer">
                  <ImagePlus class="size-3.5" />
                  Subir
                  <input type="file" accept="image/*" class="hidden" @change="readLogo" />
                </label>
              </div>
              <div v-if="tokens.logo.dataUrl" class="mt-2 flex items-center gap-3">
                <img :src="tokens.logo.dataUrl" alt="Logotipo" class="h-10 w-10 rounded border border-hairline object-contain" />
                <input v-model.number="tokens.logo.width" type="range" min="40" max="320" class="flex-1 accent-[var(--color-accent)]" />
                <button type="button" class="tool-btn text-danger" @click="tokens.logo.dataUrl = ''">
                  <Trash2 class="size-3.5" />
                </button>
              </div>
              <p v-else class="mt-1 text-[11px] text-ink-subtle">PNG o SVG con fondo transparente, menos de 1,5 MB.</p>
            </div>
          </section>

          <section>
            <h2 class="mb-3 text-[13px] font-semibold text-ink">Pie de página</h2>
            <div class="mb-3 flex flex-wrap items-center gap-4">
              <label class="flex cursor-pointer items-center gap-2 text-[12.5px]">
                <input v-model="tokens.footer.enabled" type="checkbox" class="accent-[var(--color-accent)]" />
                Mostrar pie de página
              </label>
              <label class="flex items-center gap-1.5 text-[12px] text-ink-muted">
                Alto
                <input v-model.number="tokens.footer.heightMm" type="number" min="5" max="80" step="1" class="field w-20 !py-1.5 !text-[12px]" />
                mm
              </label>
              <label
                class="flex items-center gap-1.5 text-[12px] text-ink-muted"
                title="Ancho de la banda respecto al ancho de la página (100 % = toda la hoja)"
              >
                Ancho
                <input
                  v-model.number="footerWidthPercent"
                  type="range"
                  min="20"
                  max="100"
                  step="1"
                  class="w-24 accent-[var(--color-accent)]"
                />
                <span class="w-9 text-right tabular-nums">{{ footerWidthPercent }}%</span>
              </label>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <label class="label">Texto (usa {page} y {total})</label>
                <input v-model="tokens.footer.content" class="field font-mono !text-[11.5px]" placeholder="Página {page} de {total}" />
              </div>
              <div>
                <label class="label">Alineación</label>
                <select v-model="tokens.footer.align" class="field">
                  <option value="left">Izquierda</option>
                  <option value="center">Centro</option>
                  <option value="right">Derecha</option>
                </select>
              </div>
            </div>
            <div class="mt-2 flex flex-wrap gap-4">
              <label class="flex items-center gap-1.5 text-[12px]">
                <input v-model="tokens.footer.showPageNumber" type="checkbox" class="accent-[var(--color-accent)]" />
                Número de página
              </label>
              <label class="flex items-center gap-1.5 text-[12px]">
                <input v-model="tokens.footer.showTotal" type="checkbox" class="accent-[var(--color-accent)]" />
                Total de páginas
              </label>
            </div>
            <div class="mt-3">
              <DesignBandImages
                :model-value="tokens.footer.images ?? []"
                :width-mm="footerBandWidthMm"
                :height-mm="footerBandHeightMm"
                label="Pie de página"
                :enabled="tokens.footer.enabled"
                :show-canvas="false"
                @update:model-value="tokens.footer.images = $event"
                @added="tokens.footer.enabled = true"
              />
            </div>
          </section>

          <label class="flex cursor-pointer items-start gap-2 rounded-lg border border-hairline p-3">
            <input v-model="isShared" type="checkbox" class="mt-0.5 accent-[var(--color-accent)]" />
            <span>
              <span class="block text-[12.5px] font-medium">Compartir con el equipo</span>
              <span class="block text-[11px] text-ink-subtle">Cualquier usuario podrá duplicar este diseño para usarlo en sus plantillas.</span>
            </span>
          </label>
        </div>
      </aside>

      <!-- Hoja de trabajo -->
      <section class="flex min-h-[55vh] min-w-0 flex-1 flex-col bg-[#e9edf2] lg:min-h-0">
        <div class="flex flex-wrap items-center gap-1.5 border-b border-hairline bg-surface px-3 py-2">
          <button
            type="button"
            class="tool-btn"
            :title="panelOpen ? 'Ocultar panel de ajustes' : 'Mostrar panel de ajustes'"
            @click="togglePanel"
          >
            <component :is="panelOpen ? PanelLeftClose : PanelLeftOpen" class="size-4" />
          </button>
          <span class="tool-sep" />
          <span class="mr-1 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">Hoja de trabajo</span>
          <button type="button" class="tool-btn" title="Alejar" :disabled="zoom <= MIN_ZOOM" @click="zoomOut">
            <ZoomOut class="size-4" />
          </button>
          <span class="min-w-12 text-center text-[11.5px] font-medium tabular-nums text-ink-muted">{{ zoomPercent }}</span>
          <button type="button" class="tool-btn" title="Acercar" :disabled="zoom >= MAX_ZOOM" @click="zoomIn">
            <ZoomIn class="size-4" />
          </button>
          <button type="button" class="tool-btn w-auto px-2 text-[11px] font-medium" title="Ajustar la hoja al ancho disponible" @click="fitWidth">
            <Scan class="size-3.5" />
            Ajustar ancho
          </button>
          <button type="button" class="tool-btn w-auto px-2 text-[11px] font-medium" title="Ver la hoja al 100 %" @click="resetZoom">
            100 %
          </button>
          <span class="tool-sep" />
          <button
            type="button"
            :class="['tool-btn', { 'is-active': lockAspect }]"
            :title="lockAspect ? 'Esquinas con proporción bloqueada; los lados estiran libremente' : 'Esquinas con proporción libre'"
            @click="lockAspect = !lockAspect"
          >
            <component :is="lockAspect ? Lock : Unlock" class="size-4" />
          </button>
          <span class="hidden text-[11px] text-ink-subtle xl:inline">
            Arrastra las imágenes de cabecera y pie directamente sobre la hoja.
          </span>
        </div>

        <div
          ref="canvasViewport"
          class="relative min-h-0 flex-1 overflow-auto"
          @wheel="onCanvasWheel"
        >
          <div class="min-h-full p-6">
            <div class="mx-auto" :style="{ width: `${sheetWidthPx * zoom}px` }">
              <DesignPreview
                :tokens="tokens"
                :scale="zoom"
                interactive
                show-guides
                fixed-height
                :lock-aspect="lockAspect"
                @update:header-images="tokens.header.images = $event"
                @update:footer-images="tokens.footer.images = $event"
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>
