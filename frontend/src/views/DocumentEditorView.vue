<script setup lang="ts">
import { useEditor } from '@tiptap/vue-3';
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  ChevronDown,
  Cloud,
  CloudOff,
  Download,
  Eye,
  FileCode2,
  FileText,
  GitCompareArrows,
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
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  XCircle,
} from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';

import { api, downloadFile } from '@/api/client';
import DocumentSheet from '@/components/editor/DocumentSheet.vue';
import EditorToolbar from '@/components/editor/EditorToolbar.vue';
import FindReplacePanel from '@/components/editor/FindReplacePanel.vue';
import ShareDialog from '@/components/editor/ShareDialog.vue';
import VariablePanel from '@/components/editor/VariablePanel.vue';
import VersionHistoryPanel from '@/components/editor/VersionHistoryPanel.vue';
import NumberingBadge from '@/components/editor/NumberingBadge.vue';
import RejectDocumentDialog from '@/components/inbox/RejectDocumentDialog.vue';
import SendDocumentDialog from '@/components/inbox/SendDocumentDialog.vue';
import BaseDropdown from '@/components/ui/BaseDropdown.vue';
import BaseSpinner from '@/components/ui/BaseSpinner.vue';
import UserAvatar from '@/components/ui/UserAvatar.vue';
import { useInboxBadge } from '@/composables/useInboxBadge';
import { useToast } from '@/composables/useToast';
import { errorMessage as explainError } from '@/lib/error-message';
import { PaginationExtension } from '@/lib/pagination/extension';
import {
  buildAutoDescription,
  clampChromeWidth,
  createEditorExtensions,
  DOCUMENT_NUMBER_VARIABLE,
  emptyChrome,
  NUMBERING_MESSAGES,
} from '@sirpefoffice/shared';
import type {
  ChromeConfig,
  ChromeKind,
  ChromeSource,
  DesignTokens,
  DocType,
  DocumentStatus,
  JSONContent,
  NumberingPreview,
  ResolvedChrome,
  VariableDef,
  VariableValues,
} from '@sirpefoffice/shared';
import {
  docTypeLabel,
  EXPORT_FORBIDDEN_MESSAGE,
  formatDateTime,
  STATUS_ADMIN_ONLY_MESSAGE,
  STATUS_LABELS,
  STATUS_STYLES,
  relativeTime,
} from '@/lib/labels';
import { normalizeRouteId } from '@/lib/routes';
import { isBlankContent, readEditorContent } from '@/lib/editor-content';
import { setPendingSend, takePendingSend } from '@/lib/editor-intent';
import { VARIABLE_HIGHLIGHT_REFRESH, VariableHighlight } from '@/lib/variable-highlight';
import { useAuthStore } from '@/stores/auth';
import type {
  DocumentDetailResponse,
  DocumentRejection,
  DocumentSummary,
  InboxMessageDetail,
  PendingMessageSummary,
  ShareRecord,
  TemplateDetailResponse,
} from '@/types';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const auth = useAuthStore();
const { refresh: refreshInbox } = useInboxBadge();

const documentId = computed(() => normalizeRouteId(route.params.id));
/**
 * Modo "documento nuevo": la fila todavía no existe en la base de datos. El
 * contenido se guarda en `localStorage` y solo se materializa (POST) cuando el
 * usuario pulsa Guardar, Enviar o Exportar.
 */
const isNew = computed(() => route.name === 'document-new');
const templateId = computed(() => {
  const value = route.query.template;
  return typeof value === 'string' && value.trim() ? value.trim() : null;
});
const originMessageId = computed(() => normalizeRouteId(route.query.message));
const fromInbox = computed(
  () => route.query.from === 'inbox' && Boolean(originMessageId.value),
);
/** Vuelve al mensaje que abrió el documento, no siempre a la lista. */
const backTarget = computed(() =>
  fromInbox.value
    ? { name: 'inbox-message', params: { id: originMessageId.value! } }
    : { name: 'documents' },
);
const backLabel = computed(() =>
  fromInbox.value ? 'Volver al mensaje' : 'Volver a documentos',
);

const BLANK_CONTENT: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: 'Documento sin título' }],
    },
    { type: 'paragraph' },
  ],
};

/** Valores iniciales de las variables, igual que en el backend. */
function defaultData(schemaDef: VariableDef[]): VariableValues {
  const values: VariableValues = {};
  for (const variable of schemaDef) {
    if (variable.defaultValue !== undefined) values[variable.key] = variable.defaultValue;
    else if (variable.type === 'table') values[variable.key] = [];
    else if (variable.type === 'multiselect') values[variable.key] = [];
    else if (variable.type === 'checkbox') values[variable.key] = false;
  }
  return values;
}

/* ─────────────────── Borrador local del documento nuevo ─────────────────── */

interface LocalDraft {
  /**
   * Versión del formato del borrador. Los borradores anteriores a la v2 se
   * guardaban con el cuerpo vacío (el contenido se volcaba antes de que
   * llegara al editor) y sirven para detectar los que hay que reparar.
   */
  version?: number;
  title: string;
  description: string;
  docType: string;
  data: VariableValues;
  content: JSONContent;
  header: ChromeConfig | null;
  footer: ChromeConfig | null;
  savedAt: string;
}

/** Versión actual del borrador local. */
const DRAFT_VERSION = 2;

/** Retardo para agrupar las escrituras del borrador local. */
const DRAFT_SAVE_DELAY = 400;

let draftTimer: number | undefined;
/** Clave con la que se agendó el volcado pendiente del borrador. */
let pendingDraftKey: string | undefined;

function draftStorageKey(): string {
  return `sirpef:doc-draft:${templateId.value ?? 'blank'}`;
}

function readLocalDraft(): LocalDraft | null {
  try {
    const raw = window.localStorage.getItem(draftStorageKey());
    if (!raw) return null;
    return JSON.parse(raw) as LocalDraft;
  } catch {
    return null;
  }
}

/**
 * Escribe el borrador local.
 *
 * Recibe la clave con la que se agendó el volcado: al salir de la vista la
 * ruta puede haber cambiado ya y la clave calculada sería otra.
 */
function persistLocalDraft(key = draftStorageKey()): void {
  try {
    const draft: LocalDraft = {
      version: DRAFT_VERSION,
      title: title.value,
      description: description.value,
      docType: docType.value,
      data: data.value,
      // Se lee el estado real del editor: un `computed` podría devolver el
      // documento anterior al último `setContent` y guardar un borrador vacío.
      content: readEditorContent(editor.value),
      header: chromePayload('header'),
      footer: chromePayload('footer'),
      savedAt: new Date().toISOString(),
    };
    window.localStorage.setItem(key, JSON.stringify(draft));
  } catch {
    // Almacenamiento lleno o deshabilitado: el usuario puede guardar a mano.
  }
}

function clearLocalDraft(): void {
  // Un volcado pendiente podría volver a escribir el borrador ya guardado
  // en la base de datos.
  window.clearTimeout(draftTimer);
  draftTimer = undefined;
  pendingDraftKey = undefined;
  try {
    window.localStorage.removeItem(draftStorageKey());
  } catch {
    // Sin almacenamiento disponible: nada que limpiar.
  }
}

/**
 * Guarda el borrador local.
 *
 * Escribir el documento entero en `localStorage` en cada pulsación es
 * costoso, así que se agrupan las escrituras en un pequeño retardo. El
 * volcado se fuerza al salir de la vista para no perder lo último escrito.
 */
function scheduleLocalDraftPersist(): void {
  if (!isNew.value) return;
  pendingDraftKey = draftStorageKey();
  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => {
    const key = pendingDraftKey;
    draftTimer = undefined;
    pendingDraftKey = undefined;
    if (key) persistLocalDraft(key);
  }, DRAFT_SAVE_DELAY);
}

/** Escribe el borrador pendiente, si lo hay. */
function flushLocalDraft(): void {
  if (draftTimer === undefined) return;
  window.clearTimeout(draftTimer);
  draftTimer = undefined;
  const key = pendingDraftKey;
  pendingDraftKey = undefined;
  if (key) persistLocalDraft(key);
}

// Al navegar entre documentos reutilizando esta vista, hay que recargar el
// detalle para no conservar el esquema ni los datos del documento anterior.
watch([documentId, templateId], ([id]) => {
  if (isNew.value) {
    void hydrateNewDocument();
    return;
  }
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
/** Previsto del borrador (orientativo; no reserva el correlativo). */
const numberingPreview = ref<NumberingPreview | null>(null);
const docType = ref<string>('blank');
const status = ref<DocumentStatus>('draft');
const permission = ref<'owner' | 'editor' | 'viewer'>('viewer');
const version = ref(1);
const locked = ref(false);
const canExport = ref(true);
const pendingMessage = ref<PendingMessageSummary | null>(null);
const lastRejection = ref<DocumentRejection | null>(null);
const reviewMessage = ref<InboxMessageDetail | null>(null);
const reviewLoading = ref(false);
const reviewError = ref(false);
const reviewExpanded = ref(false);
const reviewInitialVersion = ref<number | null>(null);
const rejectOpen = ref(false);
const rejectionPanelOpen = ref(true);
const sendOpen = ref(false);
const sendMode = ref<'send' | 'approve'>('send');
const approveMessageId = ref<string | null>(null);
const sendPrefill = ref<{ subject: string; body: string; recipientIds: string[] }>({
  subject: '',
  body: '',
  recipientIds: [],
});
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

const canReview = computed(() =>
  Boolean(reviewMessage.value?.canApprove && pendingMessage.value && !locked.value),
);
const reviewVersionChanged = computed(() =>
  Boolean(reviewMessage.value && reviewMessage.value.documentVersion !== version.value),
);
const reviewRecipientNames = computed(
  () => reviewMessage.value?.recipients.map((recipient) => recipient.name).join(', ') ?? '',
);
const approveSentVersion = computed(() =>
  sendMode.value === 'approve' ? (reviewMessage.value?.documentVersion ?? null) : null,
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

/**
 * Sustituye `{{numero_documento}}` por el número asignado o, en un borrador,
 * por el previsto. Las decoraciones no modifican el documento guardado.
 */
function resolveNumberVariable(variableKey: string): { text: string; title?: string } | null {
  if (variableKey !== DOCUMENT_NUMBER_VARIABLE) return null;
  if (docNumber.value) {
    return { text: docNumber.value, title: NUMBERING_MESSAGES.variableLabel };
  }
  if (numberingPreview.value) {
    return {
      text: numberingPreview.value.number,
      title: NUMBERING_MESSAGES.variablePendingTitle,
    };
  }
  return null;
}

/**
 * Contenido vivo del editor.
 *
 * No se usa un `computed` sobre `editor.getJSON()`: el envoltorio de Vue 3 de
 * TipTap difiere la invalidación reactiva del estado dos `requestAnimationFrame`,
 * de modo que el `computed` seguía devolviendo el documento anterior al
 * último `setContent`. Un `ref` sincronizado de forma explícita mantiene la
 * vista reactiva sin que el contenido llegue atrasado.
 */
const currentContent = shallowRef<JSONContent>({ type: 'doc', content: [] });

const editor = useEditor({
  extensions: [
    ...createEditorExtensions({
      placeholder: 'Escribe el contenido del documento…',
    }),
    VariableHighlight.configure({ resolve: resolveNumberVariable }),
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
  onUpdate: () => {
    syncEditorContent();
    markDirty();
  },
  onFocus: () => {
    activeChrome.value = 'body';
  },
});

/** Refleja en la vista el contenido real del editor. */
function syncEditorContent(): void {
  currentContent.value = readEditorContent(editor.value);
}

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
      VariableHighlight.configure({ resolve: resolveNumberVariable }),
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

// El valor que sustituye a `{{numero_documento}}` debe refrescarse cuando se
// asigna el número o cambia el previsto.
watch([docNumber, numberingPreview], () => {
  for (const instance of [editor.value, headerEditor.value, footerEditor.value]) {
    const view = instance?.view;
    if (view) view.dispatch(view.state.tr.setMeta(VARIABLE_HIGHLIGHT_REFRESH, true));
  }
});

const activeEditor = computed(() => {
  if (activeChrome.value === 'header') return headerEditor.value ?? null;
  if (activeChrome.value === 'footer') return footerEditor.value ?? null;
  return editor.value ?? null;
});

watch(canEdit, (editable) => {
  // `setEditable` emite un evento `update` en TipTap v3: sin el segundo
  // argumento marcaba el documento como modificado (y guardaba un borrador
  // vacío) sin que el usuario hubiera escrito nada.
  editor.value?.setEditable(editable, false);
  headerEditor.value?.setEditable(editable && chromeOpen.value, false);
  footerEditor.value?.setEditable(editable && chromeOpen.value, false);
});

watch(chromeOpen, (open) => {
  // No tocamos el editor del cuerpo al abrir/cerrar las bandas: cambiar su
  // estado `editable` puede emitir una actualización y marcar el documento
  // como modificado sin que el usuario haya editado nada.
  headerEditor.value?.setEditable(canEdit.value && open, false);
  footerEditor.value?.setEditable(canEdit.value && open, false);
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
  if (isNew.value) {
    return dirty.value
      ? 'Borrador local · pulsa Guardar para crearlo'
      : 'Sin guardar · no se creará hasta que pulses Guardar';
  }
  if (conflict.value) return 'Conflicto de versión';
  if (dirty.value) return 'Cambios sin guardar';
  if (lastSavedAt.value) return `Guardado ${relativeTime(lastSavedAt.value)}`;
  return 'Sin cambios';
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
    numberingPreview.value = response.document.numberingPreview ?? null;
    docType.value = response.document.docType;
    status.value = response.document.status;
    permission.value = response.document.permission;
    version.value = response.document.version;
    locked.value = Boolean(response.document.lockedAt) || response.document.status === 'sent';
    canExport.value = response.canExport;
    pendingMessage.value = response.document.pendingMessage ?? null;
    lastRejection.value = response.document.lastRejection ?? null;
    rejectionPanelOpen.value = true;
    reviewExpanded.value = false;
    data.value = response.document.data ?? {};
    schema.value = response.templateSchema ?? [];
    design.value = response.design?.tokens ?? response.document.designTokens ?? null;
    shares.value = response.shares ?? [];
    ownerName.value = response.document.ownerName;
    lastSavedAt.value = new Date(response.document.updatedAt);

    editor.value?.commands.setContent(response.document.content, { emitUpdate: false });
    editor.value?.commands.setTextSelection(1);
    editor.value?.setEditable(canEdit.value, false);
    syncEditorContent();

    inheritedChrome.value = response.inheritedChrome;
    headerConfig.value = structuredClone(response.chrome.header);
    footerConfig.value = structuredClone(response.chrome.footer);
    headerSource.value = response.chrome.headerSource;
    footerSource.value = response.chrome.footerSource;
    setChromeContent('header', headerConfig.value.content);
    setChromeContent('footer', footerConfig.value.content);
    headerEditor.value?.setEditable(canEdit.value && chromeOpen.value, false);
    footerEditor.value?.setEditable(canEdit.value && chromeOpen.value, false);
    activeChrome.value = 'body';

    dirty.value = false;
    conflict.value = false;
    previewMode.value = false;
    previewHtml.value = '';
    void loadReviewMessage();
    // Si el envío venía pedido desde la vista «nueva», ahora que el documento
    // ya tiene id se abre el diálogo sin que el usuario tenga que repetir el clic.
    consumePendingSend();
  } catch (error) {
    takePendingSend();
    loadError.value = explainError(error, 'No se pudo cargar el documento');
  } finally {
    loading.value = false;
  }
}

/**
 * Carga el mensaje completo del envío pendiente para que el jefe pueda
 * revisarlo y decidir sin salir del editor.
 */
async function loadReviewMessage(): Promise<void> {
  if (!pendingMessage.value || !auth.isAdmin) {
    reviewMessage.value = null;
    reviewError.value = false;
    reviewLoading.value = false;
    return;
  }

  reviewLoading.value = true;
  reviewError.value = false;
  try {
    reviewMessage.value = await api.get<InboxMessageDetail>(
      `/inbox/${pendingMessage.value.id}`,
    );
  } catch {
    reviewMessage.value = null;
    reviewError.value = true;
  } finally {
    reviewLoading.value = false;
  }
}

/**
 * Prepara el editor para un documento que todavía no existe en la base de
 * datos. No crea ninguna fila: hidrata desde la plantilla (o en blanco) y
 * recupera el borrador guardado en este navegador, si lo hay.
 */
async function hydrateNewDocument(): Promise<void> {
  loading.value = true;
  loadError.value = '';
  permission.value = 'owner';
  status.value = 'draft';
  locked.value = false;
  // Todavía no hay documento: solo el administrador puede exportar, el
  // asistente necesita que el jefe autorice la exportación al aprobar.
  canExport.value = auth.isAdmin;
  pendingMessage.value = null;
  lastRejection.value = null;
  shares.value = [];
  ownerName.value = auth.user?.name ?? '';
  docNumber.value = null;
  numberingPreview.value = null;
  conflict.value = false;

  const draft = readLocalDraft();

  try {
    if (templateId.value) {
      const response = await api.get<TemplateDetailResponse>(`/templates/${templateId.value}`);
      const template = response.template;

      title.value = draft?.title ?? template.name;
      description.value = draft?.description ?? (template.description ?? '').slice(0, 500);
      docType.value = template.docType;
      schema.value = template.schema ?? [];
      data.value = { ...defaultData(template.schema ?? []), ...(draft?.data ?? {}) };
      design.value = response.design?.tokens ?? null;
      inheritedChrome.value = response.inheritedChrome;
      numberingPreview.value = response.numberingPreview ?? null;

      const header = draft?.header ?? response.chrome.header;
      headerConfig.value = structuredClone(header);
      headerSource.value = draft?.header ? 'document' : response.chrome.headerSource;
      const footer = draft?.footer ?? response.chrome.footer;
      footerConfig.value = structuredClone(footer);
      footerSource.value = draft?.footer ? 'document' : response.chrome.footerSource;
      setChromeContent('header', headerConfig.value.content);
      setChromeContent('footer', footerConfig.value.content);

      // Un borrador heredado (v1) puede haberse guardado con el cuerpo vacío:
      // en ese caso se conservan el resto de sus datos (título, variables,
      // cabecera) y se restituye el cuerpo original de la plantilla. Un
      // borrador v2 en blanco es intencional y se respeta tal cual.
      const legacyBlankDraft =
        draft !== null &&
        draft.version !== DRAFT_VERSION &&
        isBlankContent(draft.content) &&
        !isBlankContent(template.body);

      const body = legacyBlankDraft ? template.body : (draft?.content ?? template.body);

      editor.value?.commands.setContent(body, { emitUpdate: false });
    } else {
      title.value = draft?.title ?? 'Documento sin título';
      description.value = draft?.description ?? '';
      docType.value = 'blank';
      schema.value = [];
      data.value = draft?.data ?? {};
      design.value = null;
      inheritedChrome.value = null;
      headerConfig.value = emptyChrome('header');
      footerConfig.value = emptyChrome('footer');
      headerSource.value = 'design';
      footerSource.value = 'design';
      setChromeContent('header', headerConfig.value.content);
      setChromeContent('footer', footerConfig.value.content);
      // Un borrador heredado en blanco no debe tapar la hoja inicial.
      const legacyBlankDraft =
        draft !== null &&
        draft.version !== DRAFT_VERSION &&
        isBlankContent(draft.content);
      const blankBody = legacyBlankDraft
        ? BLANK_CONTENT
        : (draft?.content ?? BLANK_CONTENT);
      editor.value?.commands.setContent(blankBody, { emitUpdate: false });
    }

    editor.value?.commands.setTextSelection(1);
    editor.value?.setEditable(canEdit.value, false);
    headerEditor.value?.setEditable(false, false);
    footerEditor.value?.setEditable(false, false);
    syncEditorContent();
    activeChrome.value = 'body';

    dirty.value = Boolean(draft);
    lastSavedAt.value = draft ? new Date(draft.savedAt) : null;
    previewMode.value = false;
    previewHtml.value = '';
    if (draft) {
      toast.success('Se recuperó el borrador guardado en este navegador');
      // Si el borrador era heredado y se reparó con el cuerpo de la
      // plantilla, se reescribe ya con la versión actual para no tener que
      // repararlo en cada visita.
      if (draft.version !== DRAFT_VERSION) persistLocalDraft(draftStorageKey());
    }
  } catch (error) {
    loadError.value = explainError(error, 'No se pudo preparar el documento');
  } finally {
    loading.value = false;
  }
}

/**
 * Crea la fila del documento en la base de datos con el contenido actual.
 * Es la única vía por la que un documento nuevo llega a existir.
 */
async function materialize(navigateToDocument = true): Promise<string | null> {
  if (!isNew.value) return documentId.value;
  if (saving.value) return null;

  saving.value = true;
  try {
    const response = await api.post<{ document: DocumentSummary }>('/documents', {
      templateId: templateId.value ?? undefined,
      title: title.value.trim() || 'Documento sin título',
      description: description.value.trim(),
      docType: docType.value,
      data: data.value,
      content: readEditorContent(editor.value),
      header: chromePayload('header'),
      footer: chromePayload('footer'),
    });

    const created = response.document;
    clearLocalDraft();
    dirty.value = false;
    conflict.value = false;
    version.value = created.version;
    docNumber.value = created.docNumber;
    numberingPreview.value = created.numberingPreview ?? null;
    lastSavedAt.value = new Date(created.updatedAt);

    if (navigateToDocument) {
      await router.replace({ name: 'document', params: { id: created.id } });
    }
    return created.id;
  } catch (error) {
    toast.failure(error, 'No se pudo crear el documento');
    return null;
  } finally {
    saving.value = false;
  }
}

function markDirty(): void {
  if (!canEdit.value) return;
  dirty.value = true;
  // Un documento nuevo nunca se guarda en la base de datos por autoguardado:
  // se conserva en el navegador hasta que el usuario pulsa Guardar/Enviar.
  if (isNew.value) {
    scheduleLocalDraftPersist();
    return;
  }
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void save(), 1400);
}

async function save(checkpoint = false, targetId: string | null = documentId.value): Promise<void> {
  if (isNew.value) {
    if (!dirty.value && !checkpoint) return;
    await materialize();
    return;
  }
  if (!targetId || !canEdit.value || saving.value) return;
  if (!checkpoint && !dirty.value) return;

  window.clearTimeout(saveTimer);
  saving.value = true;

  try {
    const response = await api.put<{ version: number; updatedAt: string }>(
      `/documents/${targetId}/content`,
      {
        content: readEditorContent(editor.value),
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
      toast.warning(apiError.message ?? 'El documento fue aprobado y enviado; ahora es de solo lectura.');
      await load();
      return;
    }
    if (apiError.status === 409) {
      conflict.value = true;
      toast.warning('Otra sesión modificó el documento. Revisa el conflicto.');
    } else {
      toast.failure(error, 'No se pudo guardar el documento');
    }
  } finally {
    saving.value = false;
  }
}

async function saveAndExit(): Promise<void> {
  if (isNew.value) {
    const id = await materialize(false);
    if (!id) return;
    toast.success('Documento guardado');
    await router.replace({ name: 'documents' });
    return;
  }

  const id = documentId.value;
  if (!id || !canEdit.value || saving.value) return;

  window.clearTimeout(saveTimer);
  if (dirty.value) await save(false, id);
  if (dirty.value || conflict.value) return;

  toast.success('Documento guardado');
  await router.replace(backTarget.value);
}

/**
 * Guarda los cambios pendientes antes de abrir el diálogo de envío.
 *
 * Con un documento nuevo, crearlo cambia la ruta y `App.vue` remonta la
 * vista: la intención se anota antes y la recoge la instancia nueva al
 * terminar de cargar (ver `consumePendingSend`).
 */
async function openSendDialog(prefill?: {
  subject?: string;
  body?: string;
  recipientIds?: string[];
}): Promise<void> {
  if (!canEdit.value || pendingMessage.value) return;
  sendMode.value = 'send';
  approveMessageId.value = null;

  if (isNew.value) {
    setPendingSend({
      subject: prefill?.subject ?? '',
      body: prefill?.body ?? '',
      recipientIds: prefill?.recipientIds ?? [],
    });
    const id = await materialize();
    if (!id) takePendingSend();
    return;
  }

  if (dirty.value) await save();
  if (dirty.value || conflict.value) return;
  sendPrefill.value = {
    subject: prefill?.subject ?? '',
    body: prefill?.body ?? '',
    recipientIds: prefill?.recipientIds ?? [],
  };
  sendOpen.value = true;
}

/** Abre el diálogo de envío si venía pedido desde antes del remontaje. */
function consumePendingSend(): void {
  const prefill = takePendingSend();
  if (!prefill) return;
  if (isNew.value || !canEdit.value || pendingMessage.value) return;

  sendMode.value = 'send';
  approveMessageId.value = null;
  sendPrefill.value = {
    subject: prefill.subject ?? '',
    body: prefill.body ?? '',
    recipientIds: prefill.recipientIds ?? [],
  };
  sendOpen.value = true;
}

/** Abre la aprobación del envío pendiente sin salir del editor. */
async function openApproveDialog(): Promise<void> {
  if (!reviewMessage.value) return;
  if (dirty.value) await save();
  if (dirty.value || conflict.value) return;

  sendMode.value = 'approve';
  approveMessageId.value = reviewMessage.value.id;
  sendPrefill.value = {
    subject: reviewMessage.value.subject,
    body: reviewMessage.value.body,
    recipientIds: reviewMessage.value.recipients.map((recipient) => recipient.userId),
  };
  sendOpen.value = true;
}

function openRejectDialog(): void {
  rejectOpen.value = true;
}

async function onRejected(): Promise<void> {
  rejectOpen.value = false;
  await load();
}

function openHistory(initialVersion: number | null = null): void {
  reviewInitialVersion.value = initialVersion;
  historyOpen.value = true;
}

/** Reenvía el documento con los datos del envío rechazado. */
function resendRejected(): void {
  if (!lastRejection.value) return;
  void openSendDialog({
    subject: lastRejection.value.subject,
    body: lastRejection.value.body,
    recipientIds: lastRejection.value.recipientIds,
  });
}

async function onSent(payload?: { id: string; status: 'sent' | 'pending_approval' }): Promise<void> {
  const wasApprove = sendMode.value === 'approve';
  sendOpen.value = false;
  sendMode.value = 'send';
  approveMessageId.value = null;
  await refreshInbox();

  // Al aprobar desde el editor, el documento se sella y se queda a la vista.
  if (wasApprove) {
    await load();
    return;
  }

  // Al corregir y reenviar, lleva de vuelta al mensaje para que el asistente
  // vea de inmediato el estado «Esperando aprobación».
  if ((lastRejection.value || fromInbox.value) && payload?.id) {
    await router.replace({ name: 'inbox-message', params: { id: payload.id } });
    return;
  }

  await load();
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
  } catch (error) {
    toast.failure(error, 'No se pudo resolver el conflicto');
  }
}

async function updateStatus(next: DocumentStatus): Promise<void> {
  let id = documentId.value;
  if (!id) {
    if (!isNew.value || !auth.isAdmin || !canEdit.value) return;
    id = await materialize();
    if (!id) return;
  }
  if (!auth.isAdmin || !canEdit.value) return;
  const previous = status.value;
  status.value = next;
  try {
    await api.patch(`/documents/${id}`, { status: next });
    toast.success(`Estado: ${STATUS_LABELS[next]}`);
    await load();
  } catch (error) {
    status.value = previous;
    toast.failure(error, 'No se pudo cambiar el estado');
  }
}

function useAutoDescription(): void {
  if (!autoDescription.value) return;
  description.value = autoDescription.value;
  markDirty();
}

async function exportAs(format: 'pdf' | 'docx' | 'html'): Promise<void> {
  let id = documentId.value;
  if (!id) {
    if (!isNew.value) return;
    id = await materialize();
    if (!id) return;
  }
  if (!canExport.value) {
    toast.error(EXPORT_FORBIDDEN_MESSAGE);
    return;
  }
  try {
    if (dirty.value) await save(true, id);
    await downloadFile(`/documents/${id}/export/${format}`);
    toast.success(`Archivo ${format.toUpperCase()} generado`);
  } catch (error) {
    toast.failure(error, 'No se pudo exportar');
  }
}

async function printPreview(): Promise<void> {
  let id = documentId.value;
  if (!id) {
    if (!isNew.value) return;
    id = await materialize();
    if (!id) return;
  }
  if (!canExport.value) {
    toast.error(EXPORT_FORBIDDEN_MESSAGE);
    return;
  }
  try {
    if (dirty.value) await save(true, id);
    // Sin `preview=1`: es el documento completo, listo para imprimir o guardar.
    const html = await api.get<string>(`/documents/${id}/html`);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (error) {
    toast.failure(error, 'No se pudo abrir la vista previa');
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
    toast.failure(error, 'No se pudo generar con IA');
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

  let id = documentId.value;
  if (!id) {
    if (!isNew.value) return;
    id = await materialize();
    if (!id) return;
  }
  loadingPreview.value = true;
  try {
    if (dirty.value) await save(true, id);
    // `preview=1`: vista previa dentro de la app (no es una exportación).
    previewHtml.value = await api.get<string>(`/documents/${id}/html`, { preview: '1' });
    previewMode.value = true;
  } catch (error) {
    toast.failure(error, 'No se pudo generar la vista previa');
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
      // `preview=1`: vista previa dentro de la app (no es una exportación).
      previewHtml.value = await api.get<string>(`/documents/${id}/html`, { preview: '1' });
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
      body: readEditorContent(editor.value),
      // La plantilla nueva conserva el marco visible del documento.
      header: chromePayload('header') ?? headerConfig.value,
      footer: chromePayload('footer') ?? footerConfig.value,
      isShared: false,
    });
    toast.success('Plantilla creada');
  } catch (error) {
    toast.failure(error, 'No se pudo crear la plantilla');
  }
}

function onBeforeUnload(event: BeforeUnloadEvent): void {
  // Se vuelca el borrador pendiente antes de cerrar: `localStorage` es
  // síncrono, así que el contenido llega a guardarse.
  flushLocalDraft();
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
  // Un documento nuevo sin guardar no se crea: el borrador local sigue en el
  // navegador y se puede recuperar la próxima vez.
  if (isNew.value) {
    flushLocalDraft();
    return true;
  }
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

  if (isNew.value) {
    await hydrateNewDocument();
  } else if (!documentId.value) {
    await router.replace({ name: 'documents' });
    return;
  } else {
    await load();
  }

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
  // Se vuelca el borrador pendiente: si no, se perdería lo escrito en los
  // últimos milisegundos antes de salir de la vista.
  flushLocalDraft();
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-canvas">
    <!-- Barra superior -->
    <header class="flex h-14 shrink-0 items-center gap-2 border-b border-hairline bg-surface px-3">
      <RouterLink
        :to="backTarget"
        class="rounded-lg p-2 text-ink-muted hover:bg-surface-hover hover:text-ink"
        :aria-label="backLabel"
        :title="backLabel"
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
          <NumberingBadge
            :doc-number="docNumber"
            :numbering="numberingPreview"
            :loading="loading"
            variant="full"
            class="shrink-0"
          />
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
        :class="['hidden items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium sm:inline-flex', STATUS_STYLES[status]]"
        :title="STATUS_ADMIN_ONLY_MESSAGE"
        aria-readonly="true"
      >
        {{ STATUS_LABELS[status] }}
        <Lock class="size-3 opacity-60" />
      </span>

      <RouterLink
        v-if="pendingMessage && auth.canSeeMenu('inbox')"
        :to="{ name: 'inbox-message', params: { id: pendingMessage.id } }"
        class="tool-btn sm:hidden"
        title="Ver mensaje del envío pendiente"
      >
        <Send class="size-4" />
      </RouterLink>

      <button
        v-else-if="canEdit && auth.canSeeMenu('inbox')"
        type="button"
        class="tool-btn sm:hidden"
        :disabled="saving"
        title="Enviar documento"
        @click="openSendDialog()"
      >
        <Send class="size-4" />
      </button>

      <RouterLink
        v-if="pendingMessage && auth.canSeeMenu('inbox')"
        :to="{ name: 'inbox-message', params: { id: pendingMessage.id } }"
        class="btn btn-outline btn-sm hidden sm:inline-flex"
      >
        <Send class="size-3.5" />
        Ver mensaje
      </RouterLink>

      <button
        v-else-if="canEdit && auth.canSeeMenu('inbox')"
        type="button"
        class="btn btn-primary btn-sm hidden sm:inline-flex"
        :disabled="saving"
        @click="openSendDialog()"
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

      <button type="button" class="tool-btn" title="Historial de versiones" @click="openHistory()">
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
          <p v-if="!canExport" class="px-2.5 py-2 text-[11.5px] leading-snug text-ink-subtle">
            {{ EXPORT_FORBIDDEN_MESSAGE }}
          </p>
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
          <button
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

    <!-- Panel de revisión del envío pendiente -->
    <div v-if="pendingMessage && !locked" class="border-b border-warning/20 bg-warning-soft/50">
      <!-- Jefe / aprobador -->
      <div v-if="auth.isAdmin" class="flex flex-wrap items-start gap-3 px-4 py-3 text-[12.5px]">
        <ShieldCheck class="mt-0.5 size-5 shrink-0 text-warning" />
        <div class="min-w-0 flex-1">
          <p class="font-semibold text-ink">Revisión de envío</p>

          <p v-if="reviewLoading" class="mt-0.5 flex items-center gap-1.5 text-ink-muted">
            <Loader2 class="size-3.5 animate-spin" />
            Cargando detalles de la solicitud…
          </p>

          <template v-else-if="reviewMessage">
            <p class="mt-0.5 text-ink-muted">
              Enviado por
              <strong class="font-medium text-ink">{{ reviewMessage.senderName }}</strong>
              · {{ formatDateTime(reviewMessage.createdAt) }}
            </p>
            <p class="mt-1 font-medium text-ink">{{ reviewMessage.subject }}</p>

            <p v-if="reviewVersionChanged" class="mt-1 flex items-center gap-1 font-medium text-danger">
              <TriangleAlert class="size-3.5 shrink-0" />
              El documento cambió desde el envío (v{{ reviewMessage.documentVersion }} → v{{ version }}).
            </p>

            <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
              <button
                type="button"
                class="text-[11.5px] font-medium text-accent hover:underline"
                @click="reviewExpanded = !reviewExpanded"
              >
                {{ reviewExpanded ? 'Ocultar detalles' : 'Ver detalles del mensaje' }}
              </button>
              <RouterLink
                :to="{ name: 'inbox-message', params: { id: reviewMessage.id } }"
                class="text-[11.5px] font-medium text-ink-muted hover:text-ink"
              >
                Ver mensaje completo
              </RouterLink>
              <button
                v-if="reviewVersionChanged"
                type="button"
                class="inline-flex items-center gap-1 text-[11.5px] font-medium text-accent hover:underline"
                @click="openHistory(reviewMessage.documentVersion)"
              >
                <GitCompareArrows class="size-3.5" />
                Ver cambios
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1 text-[11.5px] font-medium text-accent hover:underline"
                @click="togglePreview()"
              >
                <Eye class="size-3.5" />
                {{ previewMode ? 'Volver a editar' : 'Ver resultado final' }}
              </button>
            </div>

            <div v-if="reviewExpanded" class="mt-2 rounded-lg border border-warning/20 bg-surface/80 px-3 py-2 text-[12px]">
              <p v-if="reviewMessage.body" class="whitespace-pre-wrap text-ink-muted">
                {{ reviewMessage.body }}
              </p>
              <p :class="['mt-1 text-ink-subtle', reviewMessage.body ? '' : 'mt-0']">
                <span class="font-medium text-ink-muted">Para:</span>
                {{ reviewRecipientNames || 'Sin destinatarios' }}
              </p>
              <p class="mt-0.5 text-ink-subtle">
                <span class="font-medium text-ink-muted">Versión enviada:</span>
                v{{ reviewMessage.documentVersion }}
              </p>
            </div>
          </template>

          <p v-else class="mt-0.5 text-ink-muted">
            No se pudieron cargar los detalles.
            <RouterLink
              :to="{ name: 'inbox-message', params: { id: pendingMessage.id } }"
              class="font-medium text-accent hover:underline"
            >
              Abrir mensaje
            </RouterLink>
          </p>
        </div>

        <div class="flex flex-wrap gap-2">
          <button
            type="button"
            class="btn btn-outline btn-sm"
            :disabled="!canReview"
            @click="openRejectDialog"
          >
            <XCircle class="size-4" />
            Devolver o rechazar
          </button>
          <button
            type="button"
            class="btn btn-primary btn-sm"
            :disabled="!canReview || saving"
            @click="openApproveDialog()"
          >
            <CheckCircle2 class="size-4" />
            Aprobar y enviar
          </button>
        </div>
      </div>

      <!-- Remitente / otros usuarios -->
      <div v-else class="flex flex-wrap items-center gap-2 px-4 py-2 text-[12.5px] text-ink-muted">
        <Send class="size-4 shrink-0 text-warning" />
        <span class="flex-1">Este documento tiene un envío pendiente de aprobación.</span>
        <RouterLink :to="{ name: 'inbox-message', params: { id: pendingMessage.id } }" class="btn btn-outline btn-sm">
          Ver solicitud
        </RouterLink>
      </div>
    </div>

    <!-- Documento devuelto para corrección (móvil; en escritorio va en el panel lateral) -->
    <div
      v-if="lastRejection"
      :class="[
        'flex flex-wrap items-start gap-3 border-b px-4 py-2.5 text-[12.5px] lg:hidden',
        lastRejection.allowSenderEdit
          ? 'border-danger/20 bg-danger-soft/70 text-danger'
          : 'border-danger/20 bg-danger-soft/50 text-danger',
      ]"
    >
      <TriangleAlert class="mt-0.5 size-4 shrink-0" />
      <div class="min-w-0 flex-1">
        <p class="font-semibold">
          Devuelto para corrección
          <template v-if="lastRejection.rejectedByName"> por {{ lastRejection.rejectedByName }}</template>
          <template v-if="lastRejection.rejectedAt"> el {{ formatDateTime(lastRejection.rejectedAt) }}</template>
        </p>
        <p v-if="lastRejection.reason" class="mt-0.5 whitespace-pre-wrap text-ink-muted">
          <strong class="font-medium text-ink">Motivo:</strong> {{ lastRejection.reason }}
        </p>
        <p v-if="!lastRejection.allowSenderEdit" class="mt-0.5 text-ink-muted">
          El documento quedó cerrado y no se puede editar.
        </p>
        <p v-else class="mt-0.5 text-ink-muted">
          Corrige lo indicado y reenvía el documento a aprobación.
        </p>
      </div>
      <button
        v-if="lastRejection.allowSenderEdit && canEdit"
        type="button"
        class="btn btn-primary btn-sm shrink-0"
        :disabled="saving"
        @click="resendRejected"
      >
        <Send class="size-3.5" />
        Reenviar
      </button>
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
        <!-- Mensaje del revisor mientras se corrige -->
        <div v-if="lastRejection" class="shrink-0 border-b border-danger/20 bg-danger-soft/40">
          <div class="flex items-center gap-2 px-4 py-2.5">
            <TriangleAlert class="size-4 shrink-0 text-danger" />
            <p class="text-[12px] font-semibold text-danger">Mensaje del revisor</p>
            <button
              type="button"
              class="ml-auto rounded p-1 text-danger/70 transition-colors hover:bg-danger/10"
              :aria-label="rejectionPanelOpen ? 'Ocultar mensaje del revisor' : 'Mostrar mensaje del revisor'"
              @click="rejectionPanelOpen = !rejectionPanelOpen"
            >
              <ChevronDown
                :class="['size-3.5 transition-transform', rejectionPanelOpen ? 'rotate-180' : '']"
              />
            </button>
          </div>

          <div v-if="rejectionPanelOpen" class="max-h-[44vh] overflow-y-auto px-4 pb-3 text-[12px]">
            <p class="text-[11.5px] text-ink-muted">
              <template v-if="lastRejection.rejectedByName">
                Devuelto por
                <strong class="font-medium text-ink">{{ lastRejection.rejectedByName }}</strong>
              </template>
              <template v-if="lastRejection.rejectedAt">
                · {{ formatDateTime(lastRejection.rejectedAt) }}
              </template>
            </p>

            <p class="mt-1.5 font-medium text-ink">{{ lastRejection.subject }}</p>
            <p
              v-if="lastRejection.body"
              class="mt-1 whitespace-pre-wrap text-[11.5px] leading-snug text-ink-muted"
            >
              {{ lastRejection.body }}
            </p>

            <div class="mt-2 rounded-lg border border-danger/20 bg-surface px-2.5 py-2">
              <p class="text-[10.5px] font-semibold uppercase tracking-wide text-danger">Motivo</p>
              <p class="mt-0.5 whitespace-pre-wrap text-[12px] text-ink">
                {{ lastRejection.reason || 'Sin motivo indicado' }}
              </p>
            </div>

            <p class="mt-1.5 text-[11px] text-ink-subtle">
              Versión enviada: v{{ lastRejection.documentVersion }} ·
              {{ lastRejection.recipientIds.length }} destinatario{{ lastRejection.recipientIds.length === 1 ? '' : 's' }}
            </p>

            <p v-if="!lastRejection.allowSenderEdit" class="mt-1.5 text-[11.5px] text-ink-muted">
              El documento quedó cerrado y no se puede editar.
            </p>

            <div class="mt-2 flex flex-wrap gap-2">
              <button
                v-if="lastRejection.allowSenderEdit && canEdit"
                type="button"
                class="btn btn-primary btn-sm"
                :disabled="saving"
                @click="resendRejected"
              >
                <Send class="size-3.5" />
                Reenviar
              </button>
              <button type="button" class="btn btn-outline btn-sm" @click="togglePreview()">
                <Eye class="size-3.5" />
                Ver resultado final
              </button>
            </div>

            <p v-if="lastRejection.allowSenderEdit" class="mt-1.5 text-[11px] text-ink-subtle">
              Corrige lo indicado y reenvía el documento a aprobación.
            </p>
          </div>
        </div>

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
            :doc-number="docNumber"
            :numbering="numberingPreview"
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
              :doc-number="docNumber"
              :numbering="numberingPreview"
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
      :initial-version="reviewInitialVersion"
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
      :mode="sendMode"
      :message-id="approveMessageId"
      :sent-version="approveSentVersion"
      :initial-subject="sendPrefill.subject"
      :initial-body="sendPrefill.body"
      :initial-recipient-ids="sendPrefill.recipientIds"
      :doc-number="docNumber"
      :numbering="numberingPreview"
      @close="sendOpen = false"
      @sent="onSent"
    />

    <RejectDocumentDialog
      v-if="reviewMessage"
      :open="rejectOpen"
      :message-id="reviewMessage.id"
      @close="rejectOpen = false"
      @rejected="onRejected"
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
