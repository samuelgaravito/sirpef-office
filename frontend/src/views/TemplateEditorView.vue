<script setup lang="ts">
import { useEditor } from '@tiptap/vue-3';
import {
  ArrowLeft,
  Braces,
  Check,
  ChevronDown,
  Copy,
  Eye,
  Hash,
  Loader2,
  PanelTop,
  Plus,
  Save,
  Settings2,
  Sparkles,
  Trash2,
  Wand2,
} from 'lucide-vue-next';
import { computed, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';

import DocumentSheet from '@/components/editor/DocumentSheet.vue';
import EditorToolbar from '@/components/editor/EditorToolbar.vue';
import BaseSpinner from '@/components/ui/BaseSpinner.vue';
import { api } from '@/api/client';
import { useToast } from '@/composables/useToast';
import { useAuthStore } from '@/stores/auth';
import {
  clampChromeWidth,
  createEditorExtensions,
  resolveChrome,
  DOC_TYPE_PREFIX,
  DOC_TYPES_WITHOUT_NUMBER,
  DOCUMENT_NUMBER_VARIABLE,
  formatDocumentNumber,
  minimumStartValue,
  nextNumberValue,
  normalizeNumberingPrefix,
  SYSTEM_VARIABLES,
} from '@sirpefoffice/shared';
import type {
  ChromeConfig,
  ChromeKind,
  ChromeSource,
  DocType,
  JSONContent,
  NumberingSeriesState,
  ResolvedChrome,
  VariableDef,
  VariableType,
} from '@sirpefoffice/shared';
import { DOC_TYPE_LABELS } from '@/lib/labels';
import { PaginationExtension } from '@/lib/pagination/extension';
import { normalizeRouteId } from '@/lib/routes';
import { VariableHighlight } from '@/lib/variable-highlight';
import type { DesignRecord, ListResponse, TemplateDetailResponse } from '@/types';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const auth = useAuthStore();

const templateId = computed(() => normalizeRouteId(route.params.id));
const isNew = computed(() => route.name === 'template-new');

const loading = ref(true);
const saving = ref(false);
const dirty = ref(false);
const name = ref('Nueva plantilla');
const description = ref('');
const docType = ref<DocType>('blank');
const numberingEnabled = ref(false);
const numberingPrefix = ref(DOC_TYPE_PREFIX.blank);
const numberingStart = ref(1);
const numberingPadding = ref(4);
const numberingIncludeYear = ref(true);
const numberingSeries = ref<NumberingSeriesState[]>([]);
const designId = ref<string | null>(null);
const isShared = ref(false);
const isActive = ref(true);
const aiInstructions = ref('');
const schema = ref<VariableDef[]>([]);
const designs = ref<DesignRecord[]>([]);
const templateVersion = ref(1);
const tab = ref<'variables' | 'settings' | 'ai'>('variables');
/** Dueño real de la plantilla; null en una plantilla nueva. */
const templateOwnerId = ref<string | null>(null);
const canEdit = computed(
  () =>
    isNew.value ||
    templateOwnerId.value === null ||
    templateOwnerId.value === auth.user?.id ||
    auth.isAdmin,
);

// Se guardan en variables para no romper el parser de plantillas de Vue.
const syntaxSample = '{{clave}}';
const openToken = '{{';
const closeToken = '}}';

const chromeOpen = ref(false);
const activeChrome = ref<'body' | 'header' | 'footer'>('body');
/** Sobrescrituras de la plantilla; null = heredar del diseño. */
const templateHeader = ref<ChromeConfig | null>(null);
const templateFooter = ref<ChromeConfig | null>(null);
/** Evita que cargar contenido programáticamente cree una sobrescritura. */
let syncingChrome = false;

const previewMode = ref(false);
const previewLoading = ref(false);
const previewHtml = ref('');

const editor = useEditor({
  extensions: [
    ...createEditorExtensions({ placeholder: 'Diseña aquí el cuerpo de la plantilla. Usa {{variable}} para insertar datos.' }),
    VariableHighlight,
    PaginationExtension,
  ],
  content: { type: 'doc', content: [{ type: 'paragraph' }] },
  editorProps: { attributes: { class: 'tiptap' } },
  onUpdate: () => {
    dirty.value = true;
  },
  onFocus: () => {
    activeChrome.value = 'body';
  },
});

function chromeEditorOptions(kind: ChromeKind) {
  return {
    extensions: [
      ...createEditorExtensions({
        placeholder:
          kind === 'header'
            ? 'Cabecera: texto, logo o cintillo institucional…'
            : 'Pie: texto, {page} y {total} para la numeración…',
        pageBreak: false,
      }),
      VariableHighlight,
    ],
    content: null,
    editable: false,
    editorProps: { attributes: { class: 'tiptap' } },
    onUpdate: () => onChromeUpdate(kind),
    onFocus: () => {
      activeChrome.value = kind;
    },
  };
}

const headerEditor = useEditor(chromeEditorOptions('header'));
const footerEditor = useEditor(chromeEditorOptions('footer'));

watch([chromeOpen, canEdit], ([open, editable]) => {
  headerEditor.value?.setEditable(editable && open);
  footerEditor.value?.setEditable(editable && open);
});

watch(
  canEdit,
  (editable) => {
    editor.value?.setEditable(editable);
  },
  { immediate: true },
);

const design = computed(() => designs.value.find((item) => item.id === designId.value) ?? null);

/**
 * Diseño con el que se dibuja la plantilla: el que está en uso. Si la
 * cuenta no tiene ninguno en uso, se usa el que la plantilla tenía guardado.
 */
const activeDesign = computed(
  () => designs.value.find((item) => item.isCurrent) ?? null,
);

const effectiveDesign = computed(() => activeDesign.value ?? design.value);
const designTokens = computed(() => effectiveDesign.value?.tokens ?? null);

/* ───────────────────────────── Numeración ───────────────────────────── */

const normalizedNumberingPrefix = computed(() => normalizeNumberingPrefix(numberingPrefix.value));

const selectedNumberingSeries = computed(
  () =>
    numberingSeries.value.find((item) => item.prefix === normalizedNumberingPrefix.value) ?? null,
);

const numberingStartChanged = computed(
  () =>
    !selectedNumberingSeries.value ||
    numberingStart.value !== selectedNumberingSeries.value.startValue,
);

const numberingPrefixError = computed(() => {
  if (!numberingEnabled.value) return '';
  const prefix = normalizedNumberingPrefix.value;
  if (prefix && !/^[A-Z0-9]{2,10}$/.test(prefix)) {
    return 'Usa entre 2 y 10 letras o números';
  }
  return '';
});

const numberingStartError = computed(() => {
  const series = selectedNumberingSeries.value;
  if (!numberingEnabled.value || !series || !numberingStartChanged.value) return '';
  const minimum = minimumStartValue(series.lastIssued);
  if (numberingStart.value < minimum) {
    return `Mínimo ${minimum} (último emitido: ${series.lastIssued})`;
  }
  return '';
});

const numberingPreview = computed(() => {
  const series = selectedNumberingSeries.value;
  const prefix = normalizedNumberingPrefix.value;
  let value = Math.max(1, numberingStart.value || 1);

  if (series) {
    const minimum = minimumStartValue(series.lastIssued);
    if (!numberingStartChanged.value) {
      value = nextNumberValue(series, series.lastIssued);
    } else if (numberingStart.value < minimum) {
      value = minimum;
    }
  }

  return formatDocumentNumber({
    prefix,
    value,
    year: new Date().getFullYear(),
    padding: Math.min(8, Math.max(1, numberingPadding.value || 1)),
    includeYear: numberingIncludeYear.value,
  });
});

/** Al elegir un prefijo existente, carga la configuración de su serie. */
function syncNumberingFromSeries(): void {
  const series = selectedNumberingSeries.value;
  if (!series) return;
  numberingStart.value = series.startValue;
  numberingPadding.value = series.padding;
  numberingIncludeYear.value = series.includeYear;
}

function onNumberingPrefixChange(): void {
  dirty.value = true;
  syncNumberingFromSeries();
}

function onDocTypeChange(): void {
  dirty.value = true;
  if (!isNew.value) return;
  const suggested = DOC_TYPE_PREFIX[docType.value];
  numberingEnabled.value = !DOC_TYPES_WITHOUT_NUMBER.includes(docType.value);
  numberingPrefix.value = suggested;
  syncNumberingFromSeries();
}

const inheritedChrome = computed<ResolvedChrome>(() =>
  resolveChrome({ template: null, design: effectiveDesign.value?.tokens ?? null }),
);

const effectiveChrome = computed<ResolvedChrome>(() =>
  resolveChrome({
    template: { header: templateHeader.value, footer: templateFooter.value },
    design: effectiveDesign.value?.tokens ?? null,
  }),
);

const headerConfig = computed(() => effectiveChrome.value.header);
const footerConfig = computed(() => effectiveChrome.value.footer);
const headerSource = computed<ChromeSource>(() => (templateHeader.value ? 'template' : 'design'));
const footerSource = computed<ChromeSource>(() => (templateFooter.value ? 'template' : 'design'));

const activeEditor = computed(() => {
  if (activeChrome.value === 'header') return headerEditor.value ?? null;
  if (activeChrome.value === 'footer') return footerEditor.value ?? null;
  return editor.value ?? null;
});

function chromeEditorFor(kind: ChromeKind) {
  return kind === 'header' ? headerEditor.value : footerEditor.value;
}

function chromeConfigFor(kind: ChromeKind): ChromeConfig {
  return kind === 'header' ? headerConfig.value : footerConfig.value;
}

function setTemplateChrome(kind: ChromeKind, config: ChromeConfig | null): void {
  if (kind === 'header') templateHeader.value = config;
  else templateFooter.value = config;
}

function setChromeContent(kind: ChromeKind, content: JSONContent): void {
  syncingChrome = true;
  chromeEditorFor(kind)?.commands.setContent(content, { emitUpdate: false });
  queueMicrotask(() => {
    syncingChrome = false;
  });
}

/** Editar una banda crea una sobrescritura de la plantilla. */
function onChromeUpdate(kind: ChromeKind): void {
  // TipTap puede emitir una actualización al cambiar `editable`; solo
  // consideramos edición real cuando la banda está activa en modo chrome.
  if (syncingChrome || !chromeOpen.value || activeChrome.value !== kind) return;
  const current = chromeConfigFor(kind);
  const content = chromeEditorFor(kind)?.getJSON() ?? current.content;
  // Si el usuario escribe en una banda oculta, se muestra automáticamente.
  setTemplateChrome(kind, { ...current, enabled: true, content });
  dirty.value = true;
}

function toggleChrome(kind: ChromeKind, enabled: boolean): void {
  setTemplateChrome(kind, { ...chromeConfigFor(kind), enabled });
  dirty.value = true;
}

function setChromeHeight(kind: ChromeKind, heightMm: number): void {
  const clamped = Math.min(80, Math.max(5, Math.round(heightMm * 10) / 10));
  setTemplateChrome(kind, { ...chromeConfigFor(kind), heightMm: clamped });
  dirty.value = true;
}

function setChromeWidth(kind: ChromeKind, widthPercent: number): void {
  setTemplateChrome(kind, {
    ...chromeConfigFor(kind),
    widthPercent: clampChromeWidth(widthPercent),
  });
  dirty.value = true;
}

function resetChrome(kind: ChromeKind): void {
  const inherited = kind === 'header' ? inheritedChrome.value.header : inheritedChrome.value.footer;
  setTemplateChrome(kind, null);
  setChromeContent(kind, inherited.content);
  dirty.value = true;
}

/** Si el diseño cambia, actualiza las bandas que aún se heredan. */
function syncInheritedChrome(): void {
  if (!templateHeader.value) {
    setChromeContent('header', inheritedChrome.value.header.content);
  }
  if (!templateFooter.value) {
    setChromeContent('footer', inheritedChrome.value.footer.content);
  }
}

function toggleChromeMode(): void {
  chromeOpen.value = !chromeOpen.value;
  if (!chromeOpen.value) {
    activeChrome.value = 'body';
    editor.value?.commands.focus();
  }
}

const variableTypes: { value: VariableType; label: string }[] = [
  { value: 'text', label: 'Texto' },
  { value: 'longtext', label: 'Texto largo' },
  { value: 'date', label: 'Fecha' },
  { value: 'number', label: 'Número' },
  { value: 'money', label: 'Monto' },
  { value: 'select', label: 'Selección' },
  { value: 'checkbox', label: 'Casilla' },
  { value: 'table', label: 'Tabla' },
  { value: 'image', label: 'Imagen' },
];

async function load(): Promise<void> {
  if (!isNew.value && !templateId.value) {
    loading.value = false;
    void router.replace({ name: 'templates' });
    return;
  }

  loading.value = true;
  try {
    const [designData, numberingData] = await Promise.all([
      api.get<ListResponse<DesignRecord>>('/designs', { pageSize: 100 }),
      api
        .get<{ items: NumberingSeriesState[] }>('/numbering')
        .catch(() => ({ items: [] as NumberingSeriesState[] })),
    ]);
    designs.value = designData.items;
    numberingSeries.value = numberingData.items;

    if (isNew.value) {
      const requestedDesign = typeof route.query.designId === 'string' ? route.query.designId : null;
      if (requestedDesign && designs.value.some((item) => item.id === requestedDesign)) {
        designId.value = requestedDesign;
      }
    } else {
      const response = await api.get<TemplateDetailResponse>(`/templates/${templateId.value}`);
      const template = response.template;
      name.value = template.name;
      description.value = template.description;
      docType.value = template.docType;
      designId.value = template.designId;
      isShared.value = template.isShared;
      isActive.value = template.isActive;
      aiInstructions.value = template.aiInstructions ?? '';
      schema.value = template.schema ?? [];
      templateVersion.value = template.version;
      templateOwnerId.value = template.ownerId;
      templateHeader.value = template.header ?? null;
      templateFooter.value = template.footer ?? null;
      numberingEnabled.value = template.numberingEnabled;
      numberingPrefix.value = template.numberingPrefix ?? DOC_TYPE_PREFIX[template.docType];
      editor.value?.commands.setContent(template.body, { emitUpdate: false });
      editor.value?.commands.setTextSelection(1);
      editor.value?.setEditable(canEdit.value);
    }

    // Si la plantilla usa una serie existente, carga su configuración.
    syncNumberingFromSeries();

    // Inicializa las bandas con lo heredado del diseño (o sin diseño).
    const initialChrome = resolveChrome({
      template: { header: templateHeader.value, footer: templateFooter.value },
      design: effectiveDesign.value?.tokens ?? null,
    });
    setChromeContent('header', initialChrome.header.content);
    setChromeContent('footer', initialChrome.footer.content);

    // La plantilla abre en vista paginada; las bandas se editan al pulsar
    // “Cabecera y pie”, que cambia a hoja continua.
    chromeOpen.value = false;
    activeChrome.value = 'body';

    dirty.value = false;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo cargar la plantilla');
  } finally {
    loading.value = false;
  }
}

function addVariable(): void {
  const index = schema.value.length + 1;
  schema.value.push({
    key: `campo_${index}`,
    label: `Campo ${index}`,
    type: 'text',
    required: false,
  });
  dirty.value = true;
}

function removeVariable(index: number): void {
  schema.value.splice(index, 1);
  dirty.value = true;
}

function setColumns(variable: VariableDef, raw: string): void {
  variable.columns = raw
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [key, label] = part.split(':');
      return {
        key: (key ?? '').trim().replace(/[^a-zA-Z0-9_]/g, ''),
        label: (label ?? key ?? '').trim(),
        type: 'text' as const,
      };
    })
    .filter((column) => column.key.length > 0);
  dirty.value = true;
}

function columnsText(variable: VariableDef): string {
  return (variable.columns ?? []).map((column) => `${column.key}:${column.label}`).join(', ');
}

function insertVariable(key: string): void {
  activeEditor.value?.chain().focus().insertContent(`{{${key}}}`).run();
}

async function save(): Promise<void> {
  if (saving.value) return;
  if (!canEdit.value) {
    toast.error('No tienes permiso para editar esta plantilla');
    return;
  }
  if (!name.value.trim()) {
    toast.error('La plantilla necesita un nombre');
    return;
  }
  if (schema.value.some((variable) => variable.key === DOCUMENT_NUMBER_VARIABLE)) {
    toast.error(`La clave "${DOCUMENT_NUMBER_VARIABLE}" está reservada para el sistema`);
    tab.value = 'variables';
    return;
  }
  if (numberingEnabled.value && numberingPrefixError.value) {
    toast.error(numberingPrefixError.value);
    return;
  }
  if (numberingEnabled.value && numberingStartError.value) {
    toast.error(numberingStartError.value);
    return;
  }

  const id = templateId.value;
  if (!isNew.value && !id) {
    void router.replace({ name: 'templates' });
    return;
  }

  saving.value = true;
  try {
    const body = (editor.value?.getJSON() ?? { type: 'doc', content: [] }) as JSONContent;
    const numberingPrefixValue = normalizedNumberingPrefix.value;
    const payload = {
      name: name.value.trim(),
      description: description.value,
      docType: docType.value,
      designId: designId.value,
      schema: schema.value,
      body,
      header: templateHeader.value,
      footer: templateFooter.value,
      aiInstructions: aiInstructions.value || null,
      isShared: isShared.value,
      numbering: {
        enabled: numberingEnabled.value,
        prefix: numberingPrefixValue,
        startValue: numberingStart.value,
        padding: numberingPadding.value,
        includeYear: numberingIncludeYear.value,
      },
    };

    if (isNew.value) {
      await api.post('/templates', payload);
      dirty.value = false;
      toast.success('Plantilla creada');
    } else {
      const response = await api.patch<{ template: { version: number } }>(
        `/templates/${id}`,
        { ...payload, expectedVersion: templateVersion.value },
      );
      templateVersion.value = response.template.version;
      dirty.value = false;
      toast.success('Plantilla guardada');
    }

    await router.replace({ name: 'templates' });
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo guardar la plantilla');
  } finally {
    saving.value = false;
  }
}

async function setActive(next: boolean): Promise<void> {
  if (isNew.value || !templateId.value || !canEdit.value) return;
  try {
    const data = await api.patch<{ template: { isActive: boolean } }>(
      `/templates/${templateId.value}/status`,
      { isActive: next },
    );
    isActive.value = data.template.isActive;
    toast.success(data.template.isActive ? 'Plantilla activada' : 'Plantilla desactivada');
  } catch (error) {
    isActive.value = !next;
    toast.error(error instanceof Error ? error.message : 'No se pudo cambiar el estado');
  }
}

async function togglePreview(): Promise<void> {
  if (previewMode.value) {
    previewMode.value = false;
    return;
  }

  previewLoading.value = true;
  try {
    previewHtml.value = await api.post<string>('/templates/preview', {
      name: name.value.trim() || 'Vista previa de plantilla',
      body: (editor.value?.getJSON() ?? { type: 'doc', content: [] }) as JSONContent,
      schema: schema.value,
      // Sin diseño: el servidor aplica el que está en uso.
      designId: null,
      header: templateHeader.value,
      footer: templateFooter.value,
      numbering: {
        enabled: numberingEnabled.value,
        prefix: normalizedNumberingPrefix.value,
        startValue: numberingStart.value,
        padding: numberingPadding.value,
        includeYear: numberingIncludeYear.value,
      },
      embed: false,
    });
    previewMode.value = true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo generar la vista previa');
  } finally {
    previewLoading.value = false;
  }
}

async function createDocument(): Promise<void> {
  if (!templateId.value) return;
  if (!isActive.value) {
    toast.error('Activa la plantilla para crear documentos');
    return;
  }
  if (dirty.value) await save();
  // Abre el editor en modo «documento nuevo»: no se crea la fila hasta que el
  // usuario guarde o envíe.
  await router.push({ name: 'document-new', query: { template: templateId.value } });
}

function clone(): void {
  if (!templateId.value) return;
  void api
    .post<{ template: { id: string } }>(`/templates/${templateId.value}/clone`)
    .then((data) => router.push({ name: 'template', params: { id: data.template.id } }))
    .catch(() => toast.error('No se pudo duplicar la plantilla'));
}

onBeforeRouteLeave(() => {
  if (dirty.value) {
    return window.confirm('Hay cambios sin guardar. ¿Salir de todos modos?');
  }
  return true;
});

onMounted(() => {
  if (!isNew.value && !templateId.value) {
    void router.replace({ name: 'templates' });
    return;
  }
  void load();
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-canvas">
    <header class="flex h-14 shrink-0 items-center gap-2 border-b border-hairline bg-surface px-3">
      <RouterLink :to="{ name: 'templates' }" class="rounded-lg p-2 text-ink-muted hover:bg-surface-hover hover:text-ink">
        <ArrowLeft class="size-4.5" />
      </RouterLink>
      <span class="hidden h-8 w-px bg-hairline sm:block" />
      <div class="min-w-0 flex-1">
        <input
          v-model="name"
          class="w-full max-w-[420px] truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[14px] font-semibold hover:border-hairline focus:border-accent focus:outline-none"
          :disabled="!canEdit"
          @input="dirty = true"
        />
        <p class="px-1.5 text-[11px] text-ink-subtle">
          {{ isNew ? 'Nueva plantilla' : `Versión ${templateVersion}` }}
          <span v-if="dirty" class="text-warning">· cambios sin guardar</span>
        </p>
      </div>

      <button
        type="button"
        :class="['tool-btn', chromeOpen ? 'is-active' : '']"
        title="Editar cabecera y pie de la plantilla"
        @click="toggleChromeMode"
      >
        <PanelTop class="size-4" />
      </button>

      <button
        type="button"
        :class="['tool-btn', previewMode ? 'is-active' : '']"
        title="Vista previa de la plantilla con el diseño y datos de ejemplo"
        :disabled="previewLoading"
        @click="togglePreview"
      >
        <component :is="previewLoading ? Loader2 : Eye" :class="['size-4', previewLoading ? 'animate-spin' : '']" />
      </button>

      <button type="button" class="btn btn-outline btn-sm" @click="clone">
        <Copy class="size-3.5" />
        <span class="hidden sm:inline">Duplicar</span>
      </button>
      <button
        type="button"
        class="btn btn-outline btn-sm"
        :disabled="isNew || !isActive"
        :title="isActive ? undefined : 'Activa la plantilla para crear documentos'"
        @click="createDocument"
      >
        <Wand2 class="size-3.5" />
        <span class="hidden sm:inline">Crear documento</span>
      </button>
      <button type="button" class="btn btn-primary btn-sm" :disabled="saving || !canEdit" @click="save">
        <component :is="saving ? Loader2 : Save" :class="['size-3.5', saving ? 'animate-spin' : '']" />
        {{ saving ? 'Guardando…' : 'Guardar' }}
      </button>
    </header>

    <div
      v-if="!loading && !canEdit"
      class="border-b border-hairline bg-warning-soft px-4 py-2 text-[12px] text-warning"
    >
      Esta plantilla pertenece a otro usuario. Puedes crear documentos y duplicarla; solo el
      propietario o un administrador pueden editarla.
    </div>

    <div v-if="loading" class="grid flex-1 place-items-center">
      <BaseSpinner label="Cargando plantilla…" />
    </div>

    <main v-if="previewMode" class="min-h-0 flex-1 bg-[#e9edf2]">
      <iframe
        v-if="previewHtml"
        :srcdoc="previewHtml"
        class="size-full border-0"
        sandbox=""
        title="Vista previa de la plantilla"
      />
      <div v-else class="grid h-full place-items-center">
        <BaseSpinner label="Generando vista previa…" />
      </div>
    </main>

    <div v-else class="flex min-h-0 flex-1 flex-col xl:flex-row">
      <div class="flex min-h-0 min-w-0 flex-1 flex-col">
        <EditorToolbar
          v-if="activeEditor && canEdit"
          :editor="activeEditor"
          :page-tokens="activeChrome !== 'body'"
          @image="toast.error('La imagen supera el máximo de 8 MB')"
        />
        <main class="flex-1 overflow-auto bg-[#eef1f5] px-4 py-6 sm:px-8">
          <div class="mx-auto w-fit pb-10">
            <DocumentSheet
              :editor="editor ?? null"
              :design="designTokens"
              :header="{
                editor: headerEditor ?? null,
                config: headerConfig,
                source: headerSource,
                own: templateHeader !== null,
              }"
              :footer="{
                editor: footerEditor ?? null,
                config: footerConfig,
                source: footerSource,
                own: templateFooter !== null,
              }"
              :chrome-open="chromeOpen"
              :editable="true"
              :active-chrome="activeChrome"
              @toggle="toggleChrome"
              @height="setChromeHeight"
              @width="setChromeWidth"
              @reset="resetChrome"
            >
              <template #meta>
                {{ design?.name ?? 'sin diseño' }}
                <template v-if="chromeOpen"> · Cabecera y pie editables</template>
              </template>
            </DocumentSheet>
          </div>
        </main>
      </div>

      <aside class="flex w-full shrink-0 flex-col border-t border-hairline bg-surface xl:w-[368px] xl:border-l xl:border-t-0">
        <div class="flex border-b border-hairline">
          <button
            v-for="item in [
              { value: 'variables', label: 'Variables', icon: Braces },
              { value: 'settings', label: 'Ajustes', icon: Settings2 },
              { value: 'ai', label: 'IA', icon: Sparkles },
            ]"
            :key="item.value"
            type="button"
            :class="[
              'flex flex-1 items-center justify-center gap-1.5 border-b-2 px-3 py-2.5 text-[12px] font-medium transition-colors',
              tab === item.value ? 'border-accent text-accent' : 'border-transparent text-ink-muted hover:text-ink',
            ]"
            @click="tab = item.value as typeof tab"
          >
            <component :is="item.icon" class="size-3.5" />
            {{ item.label }}
          </button>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <!-- Variables -->
          <template v-if="tab === 'variables'">
            <fieldset :disabled="!canEdit" class="min-w-0">
            <div class="mb-3 rounded-lg border border-dashed border-accent/40 bg-accent-soft/40 p-2.5">
              <p class="text-[10.5px] font-medium uppercase tracking-wide text-ink-subtle">
                Variables del sistema
              </p>
              <div
                v-for="variable in SYSTEM_VARIABLES"
                :key="variable.key"
                class="mt-1.5 flex items-center justify-between gap-2"
              >
                <div class="min-w-0">
                  <code class="font-mono text-[11px] text-accent">
                    {{ openToken }}{{ variable.key }}{{ closeToken }}
                  </code>
                  <p class="truncate text-[10.5px] text-ink-subtle">
                    {{ variable.label }} · {{ numberingEnabled ? 'automática' : 'sin número' }}
                  </p>
                </div>
                <button
                  type="button"
                  class="tool-btn shrink-0"
                  title="Insertar en el documento"
                  @click="insertVariable(variable.key)"
                >
                  <Braces class="size-3.5" />
                </button>
              </div>
            </div>

            <div class="mb-3 flex items-center justify-between">
              <p class="text-[12px] text-ink-muted">{{ schema.length }} variable{{ schema.length === 1 ? '' : 's' }}</p>
              <button type="button" class="btn btn-outline btn-sm" @click="addVariable">
                <Plus class="size-3.5" />
                Añadir
              </button>
            </div>

            <p v-if="schema.length === 0" class="rounded-lg border border-dashed border-hairline px-3 py-6 text-center text-[12px] text-ink-muted">
              Añade variables y insértalas en el texto como <code class="font-mono">{{ syntaxSample }}</code>.
            </p>

            <div class="space-y-2.5">
              <div v-for="(variable, index) in schema" :key="index" class="rounded-lg border border-hairline p-2.5">
                <div class="flex items-center gap-1.5">
                  <input
                    v-model="variable.key"
                    class="field h-8 min-w-0 flex-1 font-mono !text-[11.5px]"
                    placeholder="clave"
                    @input="dirty = true"
                  />
                  <button
                    type="button"
                    class="tool-btn"
                    title="Insertar en el documento"
                    @click="insertVariable(variable.key)"
                  >
                    <Braces class="size-3.5" />
                  </button>
                  <button
                    type="button"
                    class="tool-btn text-danger"
                    title="Eliminar variable"
                    @click="removeVariable(index)"
                  >
                    <Trash2 class="size-3.5" />
                  </button>
                </div>

                <input
                  v-model="variable.label"
                  class="field mt-1.5 h-8 !text-[12px]"
                  placeholder="Etiqueta visible"
                  @input="dirty = true"
                />

                <div class="mt-1.5 flex items-center gap-1.5">
                  <select v-model="variable.type" class="field h-8 flex-1 !text-[12px]" @change="dirty = true">
                    <option v-for="type in variableTypes" :key="type.value" :value="type.value">{{ type.label }}</option>
                  </select>
                  <label class="flex shrink-0 items-center gap-1 text-[11px] text-ink-muted">
                    <input v-model="variable.required" type="checkbox" class="accent-[var(--color-accent)]" @change="dirty = true" />
                    Oblig.
                  </label>
                </div>

                <input
                  v-if="variable.type === 'table'"
                  class="field mt-1.5 h-8 font-mono !text-[11px]"
                  placeholder="col1:Columna 1, col2:Columna 2"
                  :value="columnsText(variable)"
                  @change="setColumns(variable, ($event.target as HTMLInputElement).value)"
                />

                <input
                  v-model="variable.aiHint"
                  class="field mt-1.5 h-8 !text-[11.5px]"
                  placeholder="Indicación para la IA (opcional)"
                  @input="dirty = true"
                />
              </div>
            </div>
            </fieldset>
          </template>

          <!-- Ajustes -->
          <template v-else-if="tab === 'settings'">
            <fieldset :disabled="!canEdit" class="space-y-3.5">
              <div>
                <label class="label">Descripción</label>
                <textarea v-model="description" class="field min-h-[70px]" @input="dirty = true" />
              </div>

              <div>
                <label class="label">Tipo de documento</label>
                <select v-model="docType" class="field" @change="onDocTypeChange">
                  <option v-for="(label, value) in DOC_TYPE_LABELS" :key="value" :value="value">{{ label }}</option>
                </select>
                <p class="mt-1 text-[11px] text-ink-subtle">Sugiere el prefijo del correlativo (MEM, NDE, INF…).</p>
              </div>

              <div class="rounded-lg border border-hairline p-3">
                <label class="flex cursor-pointer items-start gap-2">
                  <input
                    v-model="numberingEnabled"
                    type="checkbox"
                    class="mt-0.5 accent-[var(--color-accent)]"
                    @change="dirty = true"
                  />
                  <span>
                    <span class="block text-[12.5px] font-medium">Numeración automática</span>
                    <span class="block text-[11px] text-ink-subtle">
                      Asigna un número correlativo único al crear documentos con esta plantilla.
                    </span>
                  </span>
                </label>

                <template v-if="numberingEnabled">
                  <div class="mt-3 grid grid-cols-[minmax(0,1fr)_120px] gap-2">
                    <div>
                      <label class="label">Prefijo (opcional)</label>
                      <input
                        v-model="numberingPrefix"
                        class="field h-8 font-mono uppercase"
                        maxlength="10"
                        placeholder="Sin prefijo"
                        @input="onNumberingPrefixChange"
                      />
                      <p v-if="numberingPrefixError" class="mt-1 text-[11px] text-danger">
                        {{ numberingPrefixError }}
                      </p>
                      <p v-else class="mt-1 text-[10.5px] text-ink-subtle">
                        Déjalo vacío para numerar sin prefijo.
                      </p>
                    </div>
                    <div>
                      <label class="label">Número inicial</label>
                      <input
                        v-model.number="numberingStart"
                        type="number"
                        min="1"
                        max="999999"
                        :class="['field h-8', numberingStartError ? 'border-danger' : '']"
                        @input="dirty = true"
                      />
                    </div>
                  </div>

                  <div class="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] items-end gap-2">
                    <div>
                      <label class="label">Dígitos</label>
                      <input
                        v-model.number="numberingPadding"
                        type="number"
                        min="1"
                        max="8"
                        class="field h-8"
                        @input="dirty = true"
                      />
                    </div>
                    <label
                      class="flex items-center gap-1.5 pb-1.5 text-[11.5px] text-ink-muted"
                      :class="selectedNumberingSeries?.lastIssued ? 'opacity-60' : ''"
                      :title="selectedNumberingSeries?.lastIssued
                        ? 'La serie ya tiene documentos emitidos; no se puede cambiar el uso del año'
                        : undefined"
                    >
                      <input
                        v-model="numberingIncludeYear"
                        type="checkbox"
                        class="accent-[var(--color-accent)]"
                        :disabled="Boolean(selectedNumberingSeries?.lastIssued)"
                        @change="dirty = true"
                      />
                      Incluir año y reiniciar
                    </label>
                  </div>

                  <p v-if="numberingStartError" class="mt-2 text-[11px] text-danger">
                    {{ numberingStartError }}
                  </p>

                  <div class="mt-2 flex items-center justify-between gap-2 rounded-md bg-surface-muted px-2.5 py-2 text-[11.5px]">
                    <span class="flex items-center gap-1.5 text-ink-muted">
                      <Hash class="size-3.5" />
                      Próximo número
                    </span>
                    <code class="truncate font-mono font-medium text-accent">{{ numberingPreview }}</code>
                  </div>

                  <p class="mt-1.5 text-[10.5px] leading-snug text-ink-subtle">
                    El prefijo identifica la serie: las plantillas que lo compartan suman la misma
                    numeración.
                    <template v-if="selectedNumberingSeries">
                      Usado por {{ selectedNumberingSeries.templateCount }}
                      plantilla{{ selectedNumberingSeries.templateCount === 1 ? '' : 's' }}.
                    </template>
                  </p>

                  <div class="mt-2 flex items-center justify-between gap-2 rounded-md border border-dashed border-hairline px-2.5 py-2">
                    <div class="min-w-0">
                      <p class="text-[11px] text-ink-muted">Variable del documento</p>
                      <code class="font-mono text-[11px] text-accent">
                        {{ openToken }}{{ DOCUMENT_NUMBER_VARIABLE }}{{ closeToken }}
                      </code>
                    </div>
                    <button
                      type="button"
                      class="btn btn-outline btn-sm shrink-0"
                      @click="insertVariable(DOCUMENT_NUMBER_VARIABLE)"
                    >
                      <Braces class="size-3.5" />
                      Insertar
                    </button>
                  </div>
                  <p class="mt-1 text-[10.5px] leading-snug text-ink-subtle">
                    Se rellena automáticamente al crear el documento. Puedes insertarla en el
                    cuerpo, la cabecera o el pie.
                  </p>
                </template>
              </div>

              <div>
                <label class="label">Diseño</label>
                <p
                  class="rounded-lg border border-hairline bg-surface-muted/60 px-3 py-2 text-[12.5px] text-ink-muted"
                >
                  <template v-if="activeDesign">
                    Esta plantilla se dibuja con <strong class="text-ink">{{ activeDesign.name }}</strong>,
                    el diseño que está en uso.
                  </template>
                  <template v-else>
                    No hay ningún diseño en uso: se usará el que tenía guardado la plantilla.
                  </template>
                </p>
                <p class="mt-1 text-[11px] text-ink-subtle">
                  Las plantillas siempre usan el diseño en uso. Puedes cambiarlo en
                  <strong>Diseños</strong>, sin tocar estas plantillas.
                </p>
              </div>

              <label class="flex cursor-pointer items-start gap-2 rounded-lg border border-hairline p-3">
                <input v-model="isShared" type="checkbox" class="mt-0.5 accent-[var(--color-accent)]" @change="dirty = true" />
                <span>
                  <span class="block text-[12.5px] font-medium">Compartir con el equipo</span>
                  <span class="block text-[11px] text-ink-subtle">Todos los usuarios podrán usar esta plantilla.</span>
                </span>
              </label>

              <label class="flex cursor-pointer items-start gap-2 rounded-lg border border-hairline p-3">
                <input
                  v-model="isActive"
                  type="checkbox"
                  class="mt-0.5 accent-[var(--color-accent)]"
                  :disabled="isNew"
                  @change="setActive(isActive)"
                />
                <span>
                  <span class="block text-[12.5px] font-medium">Plantilla activa</span>
                  <span class="block text-[11px] text-ink-subtle">
                    {{ isNew
                      ? 'La plantilla se creará activa.'
                      : 'Solo las plantillas activas se pueden usar para crear documentos.' }}
                  </span>
                </span>
              </label>

              <div class="rounded-lg bg-surface-muted p-3 text-[11.5px] text-ink-muted">
                <p class="flex items-center gap-1.5 font-medium text-ink">
                  <Check class="size-3.5 text-success" />
                  Variables disponibles
                </p>
                <div class="mt-1.5 flex flex-wrap gap-1">
                  <code v-for="variable in schema" :key="variable.key" class="rounded bg-surface px-1.5 py-0.5 font-mono text-[10.5px]">
                    {{ openToken }}{{ variable.key }}{{ closeToken }}
                  </code>
                  <code
                    v-for="variable in SYSTEM_VARIABLES"
                    :key="variable.key"
                    class="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-[10.5px] text-accent"
                    title="Variable del sistema"
                  >
                    {{ openToken }}{{ variable.key }}{{ closeToken }}
                  </code>
                </div>
              </div>
            </fieldset>
          </template>

          <!-- IA -->
          <template v-else>
            <label class="label">Instrucciones para la IA</label>
            <textarea
              v-model="aiInstructions"
              class="field min-h-[160px]"
              placeholder="Ej.: Redacta un memorándum formal en español, tono institucional, con exposición, detalle y solicitud."
              :disabled="!canEdit"
              @input="dirty = true"
            />
            <p class="mt-2 text-[11.5px] text-ink-muted">
              Estas instrucciones se envían junto con los datos del formulario cuando generas el
              documento con IA. Configura el proveedor en
              <RouterLink :to="{ name: 'settings' }" class="text-accent hover:underline">Ajustes</RouterLink>.
            </p>

            <div class="mt-4 rounded-lg border border-hairline p-3">
              <p class="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">Campos con indicación</p>
              <ul class="mt-2 space-y-1.5">
                <li v-for="variable in schema.filter((v) => v.aiHint)" :key="variable.key" class="text-[11.5px]">
                  <code class="font-mono text-accent">{{ variable.key }}</code>
                  <span class="text-ink-muted"> — {{ variable.aiHint }}</span>
                </li>
              </ul>
              <p v-if="schema.filter((v) => v.aiHint).length === 0" class="mt-1 text-[11.5px] text-ink-subtle">
                Añade indicaciones en la pestaña Variables.
              </p>
            </div>
          </template>
        </div>
      </aside>
    </div>
  </div>
</template>
