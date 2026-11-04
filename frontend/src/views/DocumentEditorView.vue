<script setup lang="ts">
import { useEditor } from '@tiptap/vue-3';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Cloud,
  CloudOff,
  Download,
  Eye,
  FileCode2,
  FileText,
  History,
  Loader2,
  Lock,
  MoreHorizontal,
  PanelTop,
  Pencil,
  Printer,
  Save,
  Search,
  Send,
  Share2,
  Sparkles,
  TriangleAlert,
} from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';

import { api, downloadFile } from '@/api/client';
import DocumentSheet from '@/components/editor/DocumentSheet.vue';
import EditorToolbar from '@/components/editor/EditorToolbar.vue';
import FindReplacePanel from '@/components/editor/FindReplacePanel.vue';
import ShareDialog from '@/components/editor/ShareDialog.vue';
import VariablePanel from '@/components/editor/VariablePanel.vue';
import VersionHistoryPanel from '@/components/editor/VersionHistoryPanel.vue';
import SendDocumentDialog from '@/components/inbox/SendDocumentDialog.vue';
import BaseDropdown from '@/components/ui/BaseDropdown.vue';
import BaseSpinner from '@/components/ui/BaseSpinner.vue';
import UserAvatar from '@/components/ui/UserAvatar.vue';
import { useInboxBadge } from '@/composables/useInboxBadge';
import { useToast } from '@/composables/useToast';
import { PaginationExtension } from '@/lib/pagination/extension';
import {
  buildAutoDescription,
  clampChromeWidth,
  createEditorExtensions,
  emptyChrome,
} from '@sirpefoffice/shared';
import type {
  ChromeConfig,
  ChromeKind,
  ChromeSource,
  DesignTokens,
  DocType,
  DocumentStatus,
  JSONContent,
  ResolvedChrome,
  VariableValues,
} from '@sirpefoffice/shared';
import { docTypeLabel, STATUS_LABELS, STATUS_STYLES, relativeTime } from '@/lib/labels';
import { normalizeRouteId } from '@/lib/routes';
import { VariableHighlight } from '@/lib/variable-highlight';
import { useAuthStore } from '@/stores/auth';
import type { DocumentDetailResponse, PendingMessageSummary, ShareRecord } from '@/types';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const auth = useAuthStore();
const { refresh: refreshInbox } = useInboxBadge();

const documentId = computed(() => normalizeRouteId(route.params.id));

// Al navegar entre documentos reutilizando esta vista, hay que recargar el
// detalle para no conservar el esquema ni los datos del documento anterior.
watch(documentId, (id) => {
  if (!id) {
    void router.replace({ name: 'documents' });
    return;
  }
  void load();
});

const loading = ref(true);
const loadError = ref('');
const title = ref('');
const description = ref('');
const docNumber = ref<string | null>(null);
const docType = ref<string>('blank');
const status = ref<DocumentStatus>('draft');
const permission = ref<'owner' | 'editor' | 'viewer'>('viewer');
const version = ref(1);
const locked = ref(false);
const canExport = ref(true);
const pendingMessage = ref<PendingMessageSummary | null>(null);
const sendOpen = ref(false);
const data = ref<VariableValues>({});
const schema = ref<DocumentDetailResponse['templateSchema']>([]);
const design = ref<DesignTokens | null>(null);
const shares = ref<ShareRecord[]>([]);
const ownerName = ref('');

const saving = ref(false);
const dirty = ref(false);
const lastSavedAt = ref<Date | null>(null);
const conflict = ref(false);
const aiConfigured = ref(false);
const generating = ref(false);

const historyOpen = ref(false);
const shareOpen = ref(false);
const mobileDataOpen = ref(false);
const previewMode = ref(false);
const previewHtml = ref('');
const loadingPreview = ref(false);
const findOpen = ref(false);

let saveTimer: number | undefined;
let previewTimer: number | undefined;

const canEdit = computed(
  () => (permission.value === 'owner' || permission.value === 'editor') && !locked.value,
);

/** Los estados finales solo los asigna el flujo de bandeja. */
const manualStatusOptions = (
  Object.entries(STATUS_LABELS) as [DocumentStatus, string][]
).filter(([value]) => value !== 'sent' && value !== 'approved' && value !== 'cancelled');

const autoDescription = computed(() =>
  buildAutoDescription({
    docType: docType.value as DocType,
    schema: schema.value,
    data: data.value,
  }),
);

const chromeOpen = ref(false);
const activeChrome = ref<'body' | 'header' | 'footer'>('body');
const headerConfig = ref<ChromeConfig>(emptyChrome('header'));
const footerConfig = ref<ChromeConfig>(emptyChrome('footer'));
const headerSource = ref<ChromeSource>('design');
const footerSource = ref<ChromeSource>('design');
const inheritedChrome = ref<ResolvedChrome | null>(null);
/** Evita que cargar contenido programáticamente cree una sobrescritura. */
let syncingChrome = false;

const editor = useEditor({
  extensions: [
    ...createEditorExtensions({
      placeholder: 'Escribe el contenido del documento…',
    }),
    VariableHighlight,
    PaginationExtension,
  ],
  content: null,
  editable: false,
  editorProps: {
    attributes: {
      class: 'tiptap',
      spellcheck: 'true',
    },
  },
  onUpdate: () => markDirty(),
  onFocus: () => {
    activeChrome.value = 'body';
  },
});

/* ─────────────────── Cabecera y pie editables ─────────────────── */

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
    editorProps: {
      attributes: {
        class: 'tiptap',
        spellcheck: 'true',
      },
    },
    onUpdate: () => onChromeUpdate(kind),
    onFocus: () => {
      activeChrome.value = kind;
    },
  };
}

const headerEditor = useEditor(chromeEditorOptions('header'));
const footerEditor = useEditor(chromeEditorOptions('footer'));

const activeEditor = computed(() => {
  if (activeChrome.value === 'header') return headerEditor.value ?? null;
  if (activeChrome.value === 'footer') return footerEditor.value ?? null;
  return editor.value ?? null;
});

watch(canEdit, (editable) => {
  editor.value?.setEditable(editable);
  headerEditor.value?.setEditable(editable && chromeOpen.value);
  footerEditor.value?.setEditable(editable && chromeOpen.value);
});

watch(chromeOpen, (open) => {
  // No tocamos el editor del cuerpo al abrir/cerrar las bandas: cambiar su
  // estado `editable` puede emitir una actualización y marcar el documento
  // como modificado sin que el usuario haya editado nada.
  headerEditor.value?.setEditable(canEdit.value && open);
  footerEditor.value?.setEditable(canEdit.value && open);
});

function chromeConfigFor(kind: ChromeKind): ChromeConfig {
  return kind === 'header' ? headerConfig.value : footerConfig.value;
}

function chromeEditorFor(kind: ChromeKind) {
  return kind === 'header' ? headerEditor.value : footerEditor.value;
}

function setChromeContent(kind: ChromeKind, content: JSONContent): void {
  syncingChrome = true;
  chromeEditorFor(kind)?.commands.setContent(content, { emitUpdate: false });
  queueMicrotask(() => {
    syncingChrome = false;
  });
}

function applyChromeConfig(
  kind: ChromeKind,
  config: ChromeConfig,
  source: ChromeSource,
  syncContent = false,
): void {
  if (kind === 'header') {
    headerConfig.value = config;
    headerSource.value = source;
  } else {
    footerConfig.value = config;
    footerSource.value = source;
  }
  // Solo se reinyecta contenido cuando la banda cambia por carga o reset;
  // hacerlo en cada pulsación rompería la selección y el historial de TipTap.
  if (syncContent) setChromeContent(kind, config.content);
}

/** Cualquier edición dentro de la banda crea una sobrescritura del documento. */
function onChromeUpdate(kind: ChromeKind): void {
  // TipTap puede emitir una actualización al cambiar `editable`; solo
  // consideramos edición real cuando la banda está activa en modo chrome.
  if (syncingChrome || !canEdit.value || !chromeOpen.value || activeChrome.value !== kind) return;
  const current = chromeConfigFor(kind);
  const content = chromeEditorFor(kind)?.getJSON() ?? current.content;
  // Si el usuario escribe en una banda oculta, se muestra automáticamente.
  applyChromeConfig(kind, { ...current, enabled: true, content }, 'document');
  markDirty();
}

function toggleChrome(kind: ChromeKind, enabled: boolean): void {
  if (!canEdit.value) return;
  const current = chromeConfigFor(kind);
  applyChromeConfig(kind, { ...current, enabled }, 'document');
  markDirty();
}

function setChromeHeight(kind: ChromeKind, heightMm: number): void {
  if (!canEdit.value) return;
  const current = chromeConfigFor(kind);
  const clamped = Math.min(80, Math.max(5, Math.round(heightMm * 10) / 10));
  applyChromeConfig(kind, { ...current, heightMm: clamped }, 'document');
  markDirty();
}

function setChromeWidth(kind: ChromeKind, widthPercent: number): void {
  if (!canEdit.value) return;
  const current = chromeConfigFor(kind);
  applyChromeConfig(
    kind,
    { ...current, widthPercent: clampChromeWidth(widthPercent) },
    'document',
  );
  markDirty();
}

/** Quita la sobrescritura y vuelve a lo heredado de plantilla/diseño. */
function resetChrome(kind: ChromeKind): void {
  if (!canEdit.value || !inheritedChrome.value) return;
  const inherited = kind === 'header' ? inheritedChrome.value.header : inheritedChrome.value.footer;
  const source = kind === 'header' ? inheritedChrome.value.headerSource : inheritedChrome.value.footerSource;
  // `inheritedChrome` es reactivo; se copia como JSON para quitar los proxies.
  applyChromeConfig(kind, JSON.parse(JSON.stringify(inherited)) as ChromeConfig, source, true);
  markDirty();
}

function toggleChromeMode(): void {
  if (!canEdit.value) return;
  chromeOpen.value = !chromeOpen.value;
  if (!chromeOpen.value) {
    activeChrome.value = 'body';
    editor.value?.commands.focus();
  }
}

/** Configuración que se envía al guardar; null conserva la herencia. */
function chromePayload(kind: ChromeKind): ChromeConfig | null {
  const source = kind === 'header' ? headerSource.value : footerSource.value;
  if (source !== 'document') return null;
  const current = chromeConfigFor(kind);
  const content = chromeEditorFor(kind)?.getJSON() ?? current.content;
  return { ...current, content };
}

const saveLabel = computed(() => {
  if (saving.value) return 'Guardando…';
  if (conflict.value) return 'Conflicto de versión';
  if (dirty.value) return 'Cambios sin guardar';
  if (lastSavedAt.value) return `Guardado ${relativeTime(lastSavedAt.value)}`;
  return 'Sin cambios';
});

const currentContent = computed<JSONContent>(() => {
  const json = editor.value?.getJSON();
  return (json ?? { type: 'doc', content: [] }) as JSONContent;
});

async function load(): Promise<void> {
  const id = documentId.value;
  if (!id) {
    loading.value = false;
    void router.replace({ name: 'documents' });
    return;
  }

  loading.value = true;
  loadError.value = '';
  try {
    const response = await api.get<DocumentDetailResponse>(`/documents/${id}`);
    title.value = response.document.title;
    description.value = response.document.description ?? '';
    docNumber.value = response.document.docNumber;
    docType.value = response.document.docType;
    status.value = response.document.status;
    permission.value = response.document.permission;
    version.value = response.document.version;
    locked.value = Boolean(response.document.lockedAt) || response.document.status === 'sent';
    canExport.value = response.canExport;
    pendingMessage.value = response.document.pendingMessage ?? null;
    data.value = response.document.data ?? {};
    schema.value = response.templateSchema ?? [];
    design.value = response.design?.tokens ?? response.document.designTokens ?? null;
    shares.value = response.shares ?? [];
    ownerName.value = response.document.ownerName;
    lastSavedAt.value = new Date(response.document.updatedAt);

    editor.value?.commands.setContent(response.document.content, { emitUpdate: false });
    editor.value?.commands.setTextSelection(1);
    editor.value?.setEditable(canEdit.value);

    inheritedChrome.value = response.inheritedChrome;
    headerConfig.value = structuredClone(response.chrome.header);
    footerConfig.value = structuredClone(response.chrome.footer);
    headerSource.value = response.chrome.headerSource;
    footerSource.value = response.chrome.footerSource;
    setChromeContent('header', headerConfig.value.content);
    setChromeContent('footer', footerConfig.value.content);
    headerEditor.value?.setEditable(canEdit.value && chromeOpen.value);
    footerEditor.value?.setEditable(canEdit.value && chromeOpen.value);
    activeChrome.value = 'body';

    dirty.value = false;
    conflict.value = false;
    previewMode.value = false;
    previewHtml.value = '';
  } catch (error) {
    loadError.value = error instanceof Error ? error.message : 'No se pudo cargar el documento';
  } finally {
    loading.value = false;
  }
}

function markDirty(): void {
  if (!canEdit.value) return;
  dirty.value = true;
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void save(), 1400);
}

async function save(checkpoint = false, targetId: string | null = documentId.value): Promise<void> {
  if (!targetId || !canEdit.value || saving.value) return;
  if (!checkpoint && !dirty.value) return;

  window.clearTimeout(saveTimer);
  saving.value = true;

  try {
    const response = await api.put<{ version: number; updatedAt: string }>(
      `/documents/${targetId}/content`,
      {
        content: currentContent.value,
        header: chromePayload('header'),
        footer: chromePayload('footer'),
        data: data.value,
        title: title.value.trim() || 'Sin título',
        description: description.value.trim(),
        expectedVersion: version.value,
        checkpoint,
      },
    );

    version.value = response.version;
    lastSavedAt.value = new Date(response.updatedAt);
    dirty.value = false;
    conflict.value = false;

    if (checkpoint) toast.success('Punto de control guardado');
  } catch (error) {
    const apiError = error as { status?: number; code?: string; message?: string };
    if (apiError.code === 'DOCUMENT_LOCKED') {
      dirty.value = false;
      toast.error(apiError.message ?? 'El documento fue aprobado y enviado; ahora es de solo lectura.');
      await load();
      return;
    }
    if (apiError.status === 409) {
      conflict.value = true;
      toast.error('Otra sesión modificó el documento. Revisa el conflicto.');
    } else {
      toast.error(apiError.message ?? 'No se pudo guardar el documento');
    }
  } finally {
    saving.value = false;
  }
}

async function saveAndExit(): Promise<void> {
  const id = documentId.value;
  if (!id || !canEdit.value || saving.value) return;

  window.clearTimeout(saveTimer);
  if (dirty.value) await save(false, id);
  if (dirty.value || conflict.value) return;

  toast.success('Documento guardado');
  await router.replace({ name: 'documents' });
}

/** Guarda los cambios pendientes antes de abrir el diálogo de envío. */
async function openSendDialog(): Promise<void> {
  if (!canEdit.value || pendingMessage.value) return;
  if (dirty.value) await save();
  if (dirty.value || conflict.value) return;
  sendOpen.value = true;
}

async function onSent(): Promise<void> {
  sendOpen.value = false;
  await load();
  await refreshInbox();
}

async function overwriteConflict(): Promise<void> {
  const id = documentId.value;
  if (!id) return;
  try {
    const fresh = await api.get<DocumentDetailResponse>(`/documents/${id}`);
    version.value = fresh.document.version;
    conflict.value = false;
    dirty.value = true;
    await save();
  } catch {
    toast.error('No se pudo resolver el conflicto');
  }
}

async function updateStatus(next: DocumentStatus): Promise<void> {
  const id = documentId.value;
  if (!id || !auth.isAdmin || !canEdit.value) return;
  const previous = status.value;
  status.value = next;
  try {
    await api.patch(`/documents/${id}`, { status: next });
    toast.success(`Estado: ${STATUS_LABELS[next]}`);
  } catch (error) {
    status.value = previous;
    toast.error(error instanceof Error ? error.message : 'No se pudo cambiar el estado');
  }
}

function useAutoDescription(): void {
  if (!autoDescription.value) return;
  description.value = autoDescription.value;
  markDirty();
}

async function exportAs(format: 'pdf' | 'docx' | 'html'): Promise<void> {
  const id = documentId.value;
  if (!id) return;
  if (!canExport.value) {
    toast.error('No tienes permiso para exportar este memo sellado');
    return;
  }
  try {
    if (dirty.value) await save(true, id);
    await downloadFile(`/documents/${id}/export/${format}`);
    toast.success(`Archivo ${format.toUpperCase()} generado`);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo exportar');
  }
}

async function printPreview(): Promise<void> {
  const id = documentId.value;
  if (!id) return;
  if (!canExport.value) {
    toast.error('No tienes permiso para exportar este memo sellado');
    return;
  }
  try {
    if (dirty.value) await save(true, id);
    const html = await api.get<string>(`/documents/${id}/html`);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo abrir la vista previa');
  }
}

async function generateWithAI(): Promise<void> {
  const id = documentId.value;
  if (!id || generating.value) return;
  generating.value = true;
  try {
    const response = await api.post<{
      data?: VariableValues;
      filled?: string[];
      version?: number;
    }>(`/documents/${id}/ai/generate`, { overwrite: false });

    if (response.data) data.value = response.data;
    if (typeof response.version === 'number') version.value = response.version;
    dirty.value = false;
    previewHtml.value = '';

    const count = response.filled?.length ?? 0;
    toast.success(
      count > 0 ? `La IA rellenó ${count} campo${count === 1 ? '' : 's'}. Revísalos antes de exportar.` : 'No había campos por rellenar',
    );
  } catch (error) {
    const apiError = error as { status?: number; message?: string };
    toast.error(apiError.message ?? 'No se pudo generar con IA');
  } finally {
    generating.value = false;
  }
}

/** Alterna entre el editor y la vista renderizada con los datos aplicados. */
async function togglePreview(): Promise<void> {
  if (previewMode.value) {
    previewMode.value = false;
    return;
  }

  const id = documentId.value;
  if (!id) return;
  loadingPreview.value = true;
  try {
    if (dirty.value) await save(true, id);
    previewHtml.value = await api.get<string>(`/documents/${id}/html`);
    previewMode.value = true;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo generar la vista previa');
  } finally {
    loadingPreview.value = false;
  }
}

function onDataChange(value: VariableValues): void {
  data.value = value;
  markDirty();
  schedulePreview();
}

/**
 * Si el panel de vista previa está abierto, vuelve a renderizar el documento
 * con los datos recién escritos (con un pequeño retardo para no saturar).
 */
function schedulePreview(): void {
  if (!previewMode.value) return;
  window.clearTimeout(previewTimer);
  previewTimer = window.setTimeout(async () => {
    if (!previewMode.value) return;
    await save();
    const id = documentId.value;
    if (!id) return;
    try {
      previewHtml.value = await api.get<string>(`/documents/${id}/html`);
    } catch {
      /* la vista previa se reintentará en el siguiente cambio */
    }
  }, 900);
}

async function saveAsTemplate(): Promise<void> {
  const name = window.prompt('Nombre de la nueva plantilla', title.value);
  if (!name?.trim()) return;
  try {
    await api.post('/templates', {
      name: name.trim(),
      description: `Creada desde «${title.value}»`,
      docType: docType.value,
      designId: null,
      schema: schema.value,
      body: currentContent.value,
      // La plantilla nueva conserva el marco visible del documento.
      header: chromePayload('header') ?? headerConfig.value,
      footer: chromePayload('footer') ?? footerConfig.value,
      isShared: false,
    });
    toast.success('Plantilla creada');
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo crear la plantilla');
  }
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  if (dirty.value) {
    event.preventDefault();
    event.returnValue = '';
  }
}

function onKeydown(event: KeyboardEvent): void {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    if (!canEdit.value) return;
    event.preventDefault();
    findOpen.value = true;
  } else if (event.key === 'Escape' && findOpen.value) {
    findOpen.value = false;
  }
}

onBeforeRouteLeave(async () => {
  if (!dirty.value || !canEdit.value) return true;

  const id = documentId.value;
  if (!id) return true;

  // El guardado no debe dejar la navegación colgada si la API no responde.
  await new Promise<void>((resolve) => {
    const timer = window.setTimeout(resolve, 4000);
    void save(false, id).finally(() => {
      window.clearTimeout(timer);
      resolve();
    });
  });

  return true;
});

onMounted(async () => {
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('keydown', onKeydown);

  if (!documentId.value) {
    await router.replace({ name: 'documents' });
    return;
  }

  await load();
  try {
    const settings = await api.get<{ configured: boolean }>('/ai/status');
    aiConfigured.value = settings.configured;
  } catch {
    aiConfigured.value = false;
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', onBeforeUnload);
  window.removeEventListener('keydown', onKeydown);
  window.clearTimeout(saveTimer);
  window.clearTimeout(previewTimer);
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-canvas">
    <!-- Barra superior -->
    <header class="flex h-14 shrink-0 items-center gap-2 border-b border-hairline bg-surface px-3">
      <RouterLink
        :to="{ name: 'documents' }"
        class="rounded-lg p-2 text-ink-muted hover:bg-surface-hover hover:text-ink"
        aria-label="Volver a documentos"
      >
        <ArrowLeft class="size-4.5" />
      </RouterLink>

      <span class="hidden h-8 w-px bg-hairline sm:block" />

      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <input
            v-model="title"
            class="min-w-0 max-w-[520px] flex-1 truncate rounded-md border border-transparent bg-transparent px-1.5 py-0.5 text-[14px] font-semibold text-ink hover:border-hairline focus:border-accent focus:outline-none"
            :readonly="!canEdit"
            aria-label="Título del documento"
            @input="markDirty"
          />
          <span
            v-if="docNumber"
            class="chip !bg-accent-soft !text-accent"
            title="También disponible en el documento como {{numero_documento}}"
          >{{ docNumber }}</span>
        </div>
        <p class="mt-0.5 flex items-center gap-1.5 px-1.5 text-[11px] text-ink-subtle">
          <component
            :is="saving ? Loader2 : conflict ? CloudOff : Cloud"
            :class="['size-3', saving ? 'animate-spin' : '', conflict ? 'text-danger' : '']"
          />
          {{ saveLabel }}
          <span aria-hidden="true">·</span>
          {{ docTypeLabel(docType) }}
        </p>
      </div>

      <select
        v-if="auth.isAdmin && canEdit"
        :value="status"
        :class="['hidden rounded-full border-0 px-2.5 py-1 text-[11px] font-medium sm:block', STATUS_STYLES[status]]"
        aria-label="Estado del documento"
        @change="updateStatus(($event.target as HTMLSelectElement).value as DocumentStatus)"
      >
        <option v-for="[value, label] in manualStatusOptions" :key="value" :value="value">{{ label }}</option>
      </select>
      <span
        v-else
        :class="['hidden rounded-full px-2.5 py-1 text-[11px] font-medium sm:inline-flex', STATUS_STYLES[status]]"
      >
        {{ STATUS_LABELS[status] }}
      </span>

      <RouterLink
        v-if="pendingMessage && auth.canSeeMenu('inbox')"
        :to="{ name: 'inbox-message', params: { id: pendingMessage.id } }"
        class="tool-btn sm:hidden"
        title="Envío pendiente de aprobación"
      >
        <Send class="size-4" />
      </RouterLink>

      <button
        v-else-if="canEdit && auth.canSeeMenu('inbox')"
        type="button"
        class="tool-btn sm:hidden"
        :disabled="saving"
        title="Enviar documento"
        @click="openSendDialog"
      >
        <Send class="size-4" />
      </button>

      <RouterLink
        v-if="pendingMessage && auth.canSeeMenu('inbox')"
        :to="{ name: 'inbox-message', params: { id: pendingMessage.id } }"
        class="btn btn-outline btn-sm hidden sm:inline-flex"
      >
        <Send class="size-3.5" />
        Pendiente
      </RouterLink>

      <button
        v-else-if="canEdit && auth.canSeeMenu('inbox')"
        type="button"
        class="btn btn-primary btn-sm hidden sm:inline-flex"
        :disabled="saving"
        @click="openSendDialog"
      >
        <Send class="size-3.5" />
        Enviar
      </button>

      <button
        v-if="canEdit"
        type="button"
        class="btn btn-ghost btn-sm hidden sm:inline-flex"
        :disabled="saving"
        @click="saveAndExit"
      >
        <Save class="size-3.5" />
        Guardar
      </button>

      <button
        v-if="!locked"
        type="button"
        :class="['tool-btn', chromeOpen ? 'is-active' : '']"
        title="Editar cabecera y pie de página"
        @click="toggleChromeMode"
      >
        <PanelTop class="size-4" />
      </button>

      <button type="button" class="tool-btn" title="Historial de versiones" @click="historyOpen = true">
        <History class="size-4" />
      </button>

      <button
        type="button"
        :class="['tool-btn', previewMode ? 'is-active' : '']"
        :title="previewMode ? 'Volver a editar' : 'Vista previa con los datos aplicados'"
        @click="togglePreview"
      >
        <component
          :is="loadingPreview ? Loader2 : previewMode ? Pencil : Eye"
          :class="['size-4', loadingPreview ? 'animate-spin' : '']"
        />
      </button>

      <button
        v-if="permission === 'owner' && !locked"
        type="button"
        class="tool-btn"
        title="Compartir"
        @click="shareOpen = true"
      >
        <Share2 class="size-4" />
      </button>

      <BaseDropdown align="right" width="w-52">
        <template #trigger>
          <button type="button" class="btn btn-outline btn-sm">
            <Download class="size-3.5" />
            <span class="hidden sm:inline">Exportar</span>
            <ChevronDown class="size-3" />
          </button>
        </template>
        <template #content>
          <template v-if="!locked || canExport">
            <button type="button" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink" @click="exportAs('pdf')">
              <FileText class="size-4" />
              PDF
            </button>
            <button type="button" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink" @click="exportAs('docx')">
              <FileText class="size-4" />
              Word (.docx)
            </button>
            <button type="button" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink" @click="exportAs('html')">
              <FileCode2 class="size-4" />
              HTML
            </button>
          </template>
          <p v-else class="px-2.5 py-2 text-[11.5px] leading-snug text-ink-subtle">
            Solo el administrador puede exportar este memo sellado.
          </p>
          <button
            v-if="!locked || canExport"
            type="button"
            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink"
            @click="printPreview"
          >
            <Printer class="size-4" />
            Vista de impresión
          </button>
        </template>
      </BaseDropdown>

      <BaseDropdown align="right" width="w-56">
        <template #trigger>
          <button type="button" class="tool-btn" aria-label="Más acciones">
            <MoreHorizontal class="size-4" />
          </button>
        </template>
        <template #content>
          <button v-if="canEdit" type="button" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink" @click="save(true)">
            <Save class="size-4" />
            Guardar punto de control
          </button>
          <button v-if="canEdit" type="button" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink" @click="findOpen = true">
            <Search class="size-4" />
            Buscar y reemplazar
          </button>
          <button type="button" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink" @click="saveAsTemplate">
            <FileText class="size-4" />
            Guardar como plantilla
          </button>
        </template>
      </BaseDropdown>

      <UserAvatar :name="auth.user?.name" :src="auth.user?.avatarUrl" size="sm" class="ml-1 hidden sm:inline-flex" />
    </header>

    <!-- Aviso de conflicto -->
    <div v-if="conflict" class="flex flex-wrap items-center gap-3 border-b border-danger/20 bg-danger-soft px-4 py-2 text-[12.5px] text-danger">
      <TriangleAlert class="size-4 shrink-0" />
      <span class="flex-1">Otra sesión guardó cambios en este documento.</span>
      <button type="button" class="btn btn-outline btn-sm" @click="load">Descartar y recargar</button>
      <button type="button" class="btn btn-danger btn-sm" @click="overwriteConflict">Conservar mis cambios</button>
    </div>

    <!-- Solicitud pendiente de aprobación -->
    <div v-if="pendingMessage && !locked" class="flex flex-wrap items-center gap-2 border-b border-warning/20 bg-warning-soft/60 px-4 py-2 text-[12.5px] text-ink-muted">
      <Send class="size-4 shrink-0 text-warning" />
      <span class="flex-1">Este documento tiene un envío pendiente de aprobación.</span>
      <RouterLink :to="{ name: 'inbox-message', params: { id: pendingMessage.id } }" class="btn btn-outline btn-sm">
        Ver solicitud
      </RouterLink>
    </div>

    <!-- Documento sellado -->
    <div v-if="locked" class="flex flex-wrap items-center gap-2 border-b border-hairline bg-surface-hover px-4 py-2 text-[12.5px] text-ink-muted">
      <Lock class="size-4 shrink-0" />
      <span class="flex-1">
        {{
          status === 'rejected'
            ? 'Documento rechazado. Es de solo lectura: ya no se puede editar.'
            : 'Documento aprobado y enviado. Es de solo lectura: ya no se puede editar, borrar ni restaurar.'
        }}
        <template v-if="!canExport"> La exportación está reservada al administrador.</template>
        <template v-else> Puedes exportarlo en PDF, Word o HTML.</template>
      </span>
      <span class="chip">Solo lectura</span>
    </div>

    <!-- Barra de herramientas -->
    <EditorToolbar
      v-if="activeEditor && !previewMode && !locked"
      :editor="activeEditor"
      :page-tokens="activeChrome !== 'body'"
      @image="toast.error('La imagen supera el máximo de 8 MB')"
    />

    <div class="relative">
      <FindReplacePanel :editor="activeEditor ?? null" :open="findOpen" @close="findOpen = false" />
    </div>

    <!-- Cuerpo -->
    <div v-if="loading" class="grid flex-1 place-items-center">
      <BaseSpinner label="Abriendo documento…" />
    </div>

    <div v-else-if="loadError" class="grid flex-1 place-items-center px-6">
      <div class="text-center">
        <p class="text-[15px] font-medium">{{ loadError }}</p>
        <RouterLink :to="{ name: 'documents' }" class="btn btn-outline mt-4">Volver a documentos</RouterLink>
      </div>
    </div>

    <div v-else class="flex min-h-0 flex-1">
      <!-- Vista previa con los datos aplicados -->
      <main v-if="previewMode" class="min-h-0 flex-1 bg-[#e9edf2]">
        <iframe
          v-if="previewHtml"
          :srcdoc="previewHtml"
          class="size-full border-0"
          sandbox=""
          title="Vista previa del documento"
        />
        <div v-else class="grid h-full place-items-center">
          <BaseSpinner label="Generando vista previa…" />
        </div>
      </main>

      <main v-else class="relative flex-1 overflow-auto bg-[#eef1f5] px-4 py-6 sm:px-8">
        <div class="mx-auto w-fit pb-16">
          <DocumentSheet
            :editor="editor ?? null"
            :design="design"
            :header="{
              editor: headerEditor ?? null,
              config: headerConfig,
              source: headerSource,
              own: headerSource === 'document',
            }"
            :footer="{
              editor: footerEditor ?? null,
              config: footerConfig,
              source: footerSource,
              own: footerSource === 'document',
            }"
            :chrome-open="chromeOpen"
            :editable="canEdit"
            :active-chrome="activeChrome"
            @toggle="toggleChrome"
            @height="setChromeHeight"
            @width="setChromeWidth"
            @reset="resetChrome"
          >
            <template #meta>
              {{ design?.pageFormat ?? 'A4' }} · {{ docTypeLabel(docType) }}
              <template v-if="ownerName"> · {{ ownerName }}</template>
              <template v-if="chromeOpen"> · Cabecera y pie editables</template>
            </template>
          </DocumentSheet>
        </div>

        <button
          type="button"
          class="fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full bg-surface px-4 py-2.5 text-[12.5px] font-medium shadow-pop lg:hidden"
          @click="mobileDataOpen = true"
        >
          <Sparkles class="size-4 text-accent" />
          Datos del documento
        </button>
      </main>

      <!-- Panel de datos -->
      <aside class="hidden w-[336px] shrink-0 border-l border-hairline bg-surface lg:flex lg:flex-col">
        <div class="shrink-0 border-b border-hairline px-4 py-3">
          <label class="label" for="document-description">Descripción</label>
          <textarea
            id="document-description"
            v-model="description"
            class="field min-h-[70px]"
            maxlength="500"
            :readonly="!canEdit"
            :placeholder="autoDescription || 'Para qué trata este documento'"
            @input="markDirty"
          />
          <p v-if="autoDescription" class="mt-1.5 text-[11px] leading-snug text-ink-subtle">
            Sugerencia automática: «{{ autoDescription }}»
            <button
              v-if="canEdit && description.trim() !== autoDescription"
              type="button"
              class="ml-1 font-medium text-accent hover:underline"
              @click="useAutoDescription"
            >
              Usar
            </button>
          </p>
        </div>
        <div class="min-h-0 flex-1">
          <VariablePanel
            :schema="schema"
            :model-value="data"
            :disabled="!canEdit"
            :ai-enabled="aiConfigured && canEdit"
            :generating="generating"
            @update:model-value="onDataChange"
            @generate="generateWithAI"
          />
        </div>
      </aside>
    </div>

    <!-- Panel de datos móvil -->
    <Teleport to="body">
      <Transition
        enter-active-class="transition duration-150"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition duration-120"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <div v-if="mobileDataOpen" class="fixed inset-0 z-[80] bg-[#0b1220]/35 lg:hidden" @mousedown.self="mobileDataOpen = false" />
      </Transition>
      <Transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="translate-y-full"
        enter-to-class="translate-y-0"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="translate-y-0"
        leave-to-class="translate-y-full"
      >
        <div v-if="mobileDataOpen" class="fixed inset-x-0 bottom-0 z-[85] flex h-[72vh] flex-col rounded-t-2xl bg-surface shadow-pop lg:hidden">
          <div class="flex items-center justify-between border-b border-hairline px-4 py-2">
            <span class="text-[13px] font-semibold">Datos del documento</span>
            <button type="button" class="btn btn-ghost btn-sm" @click="mobileDataOpen = false">Cerrar</button>
          </div>
          <div class="shrink-0 border-b border-hairline px-4 py-3">
            <label class="label" for="document-description-mobile">Descripción</label>
            <textarea
              id="document-description-mobile"
              v-model="description"
              class="field min-h-[70px]"
              maxlength="500"
              :readonly="!canEdit"
              :placeholder="autoDescription || 'Para qué trata este documento'"
              @input="markDirty"
            />
            <p v-if="autoDescription" class="mt-1.5 text-[11px] leading-snug text-ink-subtle">
              Sugerencia automática: «{{ autoDescription }}»
              <button
                v-if="canEdit && description.trim() !== autoDescription"
                type="button"
                class="ml-1 font-medium text-accent hover:underline"
                @click="useAutoDescription"
              >
                Usar
              </button>
            </p>
          </div>
          <div class="min-h-0 flex-1 overflow-hidden">
            <VariablePanel
              :schema="schema"
              :model-value="data"
              :disabled="!canEdit"
              :ai-enabled="aiConfigured && canEdit"
              :generating="generating"
              @update:model-value="onDataChange"
              @generate="generateWithAI"
            />
          </div>
        </div>
      </Transition>
    </Teleport>

    <VersionHistoryPanel
      :open="historyOpen"
      :document-id="documentId ?? ''"
      :current-content="currentContent"
      :current-version="version"
      :can-restore="canEdit"
      @close="historyOpen = false"
      @restored="load"
    />

    <ShareDialog
      :open="shareOpen"
      :document-id="documentId ?? ''"
      :shares="shares"
      @close="shareOpen = false"
      @changed="load"
    />

    <SendDocumentDialog
      :open="sendOpen"
      :document-id="documentId ?? ''"
      :document-title="title"
      :expected-version="version"
      @close="sendOpen = false"
      @sent="onSent"
    />

    <div v-if="!canEdit" class="pointer-events-none fixed bottom-4 left-1/2 z-40 -translate-x-1/2">
      <span class="rounded-full bg-ink/85 px-3 py-1.5 text-[11.5px] font-medium text-white">
        {{
          locked
            ? status === 'rejected'
              ? 'Solo lectura · documento rechazado'
              : 'Solo lectura · documento aprobado y enviado'
            : 'Solo lectura · no tienes permiso de edición'
        }}
      </span>
    </div>

    <div v-if="saving" class="fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-[11.5px] text-ink-muted shadow-card">
      <Loader2 class="size-3 animate-spin" />
      Guardando cambios…
    </div>

    <div v-else-if="!dirty && lastSavedAt" class="pointer-events-none fixed bottom-4 right-4 z-40 flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-[11.5px] text-ink-subtle opacity-0 transition-opacity duration-300">
      <Check class="size-3" />
      Guardado
    </div>
  </div>
</template>
