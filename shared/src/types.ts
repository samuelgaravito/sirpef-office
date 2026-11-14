/**
 * Tipos compartidos entre el servidor (Node/Fastify) y la web (Vue).
 *
 * El documento de un documento, plantilla o versión es un árbol JSON con la
 * forma que produce TipTap (JSON de ProseMirror). Se guarda tal cual en una
 * columna JSONB de PostgreSQL.
 */

import type { NumberingPreview } from './numbering.js';

/** Nodo JSON genérico de un documento TipTap / ProseMirror. */
export interface JSONContent {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: JSONContent[];
  marks?: { type: string; attrs?: Record<string, unknown> }[];
  text?: string;
}

export const EMPTY_DOC: JSONContent = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
};

/* ────────────────────────────── Variables ────────────────────────────── */

export type VariableType =
  | 'text'
  | 'longtext'
  | 'date'
  | 'number'
  | 'money'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'table'
  | 'image'
  | 'user';

/** Definición de una variable que una plantilla puede rellenar. */
export interface VariableDef {
  /** Identificador usado dentro del documento como {{identificador}}. */
  key: string;
  /** Etiqueta visible en el formulario. */
  label: string;
  type: VariableType;
  required?: boolean;
  description?: string;
  /** Valor por defecto o valor inicial. */
  defaultValue?: unknown;
  /** Opciones para select / multiselect. */
  options?: { label: string; value: string }[];
  /** Columnas cuando type = 'table'. */
  columns?: { key: string; label: string; type?: 'text' | 'number' | 'money' | 'date' }[];
  /** Texto de ayuda para la IA al rellenar esta variable. */
  aiHint?: string;
  /**
   * Marca el campo como **cuerpo redactable**.
   *
   * Cuando el asistente redacta el documento, el bloque que contiene
   * `{{clave}}` se sustituye por contenido TipTap rico (párrafos, listas,
   * tablas…). El resto de la plantilla se conserva.
   */
  bodySlot?: boolean;
}

/** Valores resueltos de las variables de un documento. */
export type VariableValues = Record<string, unknown>;

/* ─────────────────────────────── Diseños ─────────────────────────────── */

export type PageFormat = 'A4' | 'Letter' | 'Legal' | 'Folio';

export interface PageMargins {
  top: number;
  right: number;
  bottom: number;
  left: number;
  header: number;
  footer: number;
}

/** Cómo se acomoda la imagen dentro de su caja. */
export type BandImageFit = 'contain' | 'fill';

/**
 * Imagen colocada dentro de una banda de cabecera o pie.
 *
 * Las coordenadas y el tamaño se guardan en milímetros relativos a la esquina
 * superior izquierda de la banda. Así el editor, el HTML, el PDF y el DOCX
 * pueden colocar la imagen exactamente en el mismo punto.
 */
export interface BandImage {
  id: string;
  /** Imagen embebida (data URL) o URL accesible. */
  src: string;
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  /** `contain` respeta la proporción; `fill` estira hasta la caja. */
  fit?: BandImageFit;
  /** Dimensiones naturales en píxeles, para conservar la proporción al exportar. */
  naturalWidth?: number;
  naturalHeight?: number;
  opacity?: number;
  zIndex?: number;
}

export interface DesignTokens {
  /** Tipografía base del cuerpo. */
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  /** Color principal de marca (títulos, líneas). */
  primaryColor: string;
  /** Color de texto. */
  textColor: string;
  /** Color de fondo de la página. */
  backgroundColor: string;
  /** Color de los encabezados de tabla. */
  tableHeadColor: string;
  tableBorderColor: string;
  /** Color de acento secundario (acento, %). */
  accentColor: string;
  pageFormat: PageFormat;
  /** Orientación del documento. */
  orientation: 'portrait' | 'landscape';
  margins: PageMargins;
  /** Encabezado: texto o contenido TipTap. */
  header: {
    enabled: boolean;
    content: JSONContent;
    align: 'left' | 'center' | 'right';
    /** Alto de la banda en milímetros. */
    heightMm?: number;
    /** Ancho de la banda respecto al ancho de la página (20–100). */
    widthPercent?: number;
    /** Imágenes globales del diseño para esta banda. */
    images?: BandImage[];
  };
  /** Pie de página: texto con marcadores {page} y {total}. */
  footer: {
    enabled: boolean;
    content: string;
    align: 'left' | 'center' | 'right';
    showPageNumber: boolean;
    showTotal: boolean;
    /** Alto de la banda en milímetros. */
    heightMm?: number;
    /** Ancho de la banda respecto al ancho de la página (20–100). */
    widthPercent?: number;
    /** Imágenes globales del diseño para esta banda. */
    images?: BandImage[];
  };
  /** Logotipo embebido como data URL. */
  logo: { enabled: boolean; dataUrl: string; width: number; align: 'left' | 'center' | 'right' };
  /** Texto de la cabecera institucional (membrete). */
  letterhead: { enabled: boolean; title: string; subtitle: string; align: 'left' | 'center' | 'right' };
  /** Estilo de títulos: 1 → 3. */
  headingScale: number;
}

/* ──────────────────────── Cabecera y pie ─────────────────────────────── */

export type ChromeKind = 'header' | 'footer';

/** Nivel del que procede la cabecera o el pie efectivo. */
export type ChromeSource = 'document' | 'template' | 'design';

/**
 * Cabecera o pie enriquecido. Se guarda en el documento/plantilla solo cuando
 * el usuario lo sobrescribe; `null` significa "heredar del nivel siguiente".
 */
export interface ChromeConfig {
  enabled: boolean;
  content: JSONContent;
  /** Altura reservada para la banda, en milímetros. */
  heightMm: number;
  /** Ancho de la banda respecto al ancho de la página (20–100). */
  widthPercent?: number;
  /** Imágenes posicionadas dentro de la banda. */
  images?: BandImage[];
}

/** Cabecera y pie ya resueltos (documento → plantilla → diseño). */
export interface ResolvedChrome {
  header: ChromeConfig;
  footer: ChromeConfig;
  headerSource: ChromeSource;
  footerSource: ChromeSource;
}

/** Campos de un documento o plantilla que pueden sobrescribir el diseño. */
export interface ChromeHolder {
  header: ChromeConfig | null;
  footer: ChromeConfig | null;
}

/* ────────────────────────────── Plantillas ───────────────────────────── */

export const DOC_TYPES = [
  'memorandum',
  'delivery_note',
  'report',
  'meeting_minutes',
  'evaluation_plan',
  'resume',
  'letter',
  'certificate',
  'blank',
] as const;

export type DocType = (typeof DOC_TYPES)[number];

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  memorandum: 'Memorándum',
  delivery_note: 'Nota de entrega',
  report: 'Informe',
  meeting_minutes: 'Acta de reunión',
  evaluation_plan: 'Plan de evaluación',
  resume: 'Currículum',
  letter: 'Carta / Oficio',
  certificate: 'Certificado',
  blank: 'Documento en blanco',
};

/* ──────────────────────────── Documentos ─────────────────────────────── */

export const DOCUMENT_STATUSES = [
  'draft',
  'in_review',
  'final',
  'archived',
  'sent',
  'approved',
  'rejected',
  'cancelled',
] as const;

export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export type VersionKind = 'auto' | 'manual' | 'ai' | 'export' | 'restore';

export interface DocumentSummary {
  id: string;
  title: string;
  /** Descripción breve para identificar el documento en los listados. */
  description: string;
  /** Descripción calculada con los valores de las variables si no hay manual. */
  autoDescription: string;
  docType: DocType;
  status: DocumentStatus;
  docNumber: string | null;
  /**
   * Número que le tocaría al documento si se oficializara ahora. Solo se
   * calcula para borradores y es orientativo: no reserva el correlativo.
   */
  pendingDocNumber?: string | null;
  /** Igual que `pendingDocNumber`, con los datos de la serie. */
  numberingPreview?: NumberingPreview | null;
  version: number;
  ownerId: string;
  ownerName: string;
  templateId: string | null;
  designId: string | null;
  /** Tokens del diseño para miniaturas en listados (puede ser null). */
  designTokens: DesignTokens | null;
  /** Fecha de actualización del diseño, para invalidar la caché de previews. */
  designUpdatedAt: string | null;
  permission: 'owner' | 'editor' | 'viewer';
  /** Sellado de inmutabilidad: si existe, el documento ya no se puede editar. */
  lockedAt: string | null;
  /** Usuario que aprobó y envió el documento. */
  lockedBy: string | null;
  createdAt: string;
  updatedAt: string;
  /** Fecha de borrado lógico; `null` o ausente = activo. */
  deletedAt?: string | null;
}

/* ─────────────────────────── Estadísticas ────────────────────────────── */

export interface StatsTemplateUsage {
  /** `null` cuando los documentos no tienen plantilla o fue eliminada. */
  id: string | null;
  name: string;
  count: number;
  isShared: boolean;
}

export interface StatsMonthPoint {
  /** Mes en formato `YYYY-MM`. */
  month: string;
  created: number;
  approved: number;
}

/**
 * Resumen estadístico del espacio del usuario: **propios + compartidos**, con
 * el mismo criterio de visibilidad que el listado de documentos.
 *
 * El filtro opcional de fechas limita por **fecha de creación** los documentos,
 * las plantillas y los diseños que cuentan. Sin filtro, el total coincide con
 * el gauge de inicio (`docs` incluye borradores; el segmento «Documentos» del
 * gráfico es `documents - drafts`).
 */
export interface WorkspaceStats {
  generatedAt: string;
  totals: {
    /** Documentos + plantillas + diseños del periodo (o del histórico). */
    elements: number;
    documents: number;
    drafts: number;
    /** Enviados, aprobados, finales y archivados. */
    official: number;
    /** Documentos en la papelera del propio usuario (estado actual). */
    trashed: number;
    templates: number;
    designs: number;
  };
  topTemplates: StatsTemplateUsage[];
  /** Meses del periodo elegido, o los últimos 12 si no hay filtro. */
  monthly: StatsMonthPoint[];
  approvals: {
    /** Pendientes ahora: globales para un admin, propios para un miembro. */
    pending: number;
    /** Resultados de los envíos del propio usuario dentro del periodo. */
    approved: number;
    rejected: number;
    /** `approved / (approved + rejected)`; `null` si no hay resultados. */
    approvalRate: number | null;
    /** Horas medias entre el envío y la aprobación; `null` sin datos. */
    avgHours: number | null;
  };
  health: {
    /** Borradores visibles sin tocar en los últimos 30 días (hoy). */
    staleDrafts: number;
  };
}

/* ─────────────────────── Detalle de estadísticas ─────────────────────── */

export const STATS_DETAIL_KINDS = ['template', 'approved', 'rejected', 'pending'] as const;

export type StatsDetailKind = (typeof STATS_DETAIL_KINDS)[number];

/** Fila de la lista que se abre al pulsar un valor del panel. */
export interface StatsDetailItem {
  documentId: string;
  /** Mensaje de la bandeja asociado; `null` en documentos por plantilla. */
  messageId: string | null;
  title: string;
  docNumber: string | null;
  docType: DocType;
  status: DocumentStatus;
  ownerName: string;
  templateName: string | null;
  /** Fecha del criterio: creación del documento o resolución del envío. */
  date: string;
  /** Asunto del envío, solo en aprobaciones y pendientes. */
  subject: string | null;
  /** Quién aprobó o rechazó el envío; `null` mientras está pendiente. */
  resolvedByName: string | null;
}

export interface StatsDetailPage {
  items: StatsDetailItem[];
  total: number;
  page: number;
  pageSize: number;
}

/* ───────────────────────────── Bandeja ───────────────────────────────── */

export const INBOX_MESSAGE_STATUSES = [
  'pending_approval',
  'sent',
  'rejected',
  'cancelled',
] as const;

export type InboxMessageStatus = (typeof INBOX_MESSAGE_STATUSES)[number];

export interface InboxRecipient {
  userId: string;
  name: string;
  email: string;
  readAt: string | null;
  archivedAt: string | null;
}

export interface InboxMessageSummary {
  id: string;
  documentId: string;
  documentTitle: string;
  documentDocNumber: string | null;
  documentStatus: DocumentStatus;
  documentVersion: number;
  senderId: string;
  senderName: string;
  senderAvatarUrl: string | null;
  subject: string;
  body: string;
  status: InboxMessageStatus;
  recipientCount: number;
  /** `true` si hay algo pendiente de leer: mensaje recibido o resultado propio. */
  unread: boolean;
  createdAt: string;
  sentAt: string | null;
  approvedAt: string | null;
}

export interface PendingMessageSummary {
  id: string;
  status: InboxMessageStatus;
  subject: string;
  senderName: string;
}

/** Último rechazo visible para el remitente: motivo y datos para reenviar. */
export interface DocumentRejection {
  messageId: string;
  reason: string | null;
  rejectedAt: string | null;
  rejectedByName: string | null;
  /** Si el remitente puede corregir y reenviar el documento. */
  allowSenderEdit: boolean;
  /** Datos del envío rechazado para precargar el reenvío. */
  subject: string;
  body: string;
  recipientIds: string[];
  documentVersion: number;
}

export interface InboxMessageDetail extends InboxMessageSummary {
  recipients: InboxRecipient[];
  approvedByName: string | null;
  rejectedReason: string | null;
  /** Si el remitente puede corregir el memo tras un rechazo. */
  allowSenderEdit: boolean;
  /** Si el remitente puede exportar el memo tras la aprobación. */
  allowSenderExport: boolean;
  /** Si el usuario actual puede exportar el documento. */
  canExport: boolean;
  canApprove: boolean;
  isRecipient: boolean;
  isSender: boolean;
  readAt: string | null;
  /** Cuándo vio el remitente la aprobación o el rechazo. */
  senderReadAt: string | null;
  archivedAt: string | null;
  document: DocumentSummary;
  /** Mensaje pendiente actual del documento, si existe. */
  pendingMessage: PendingMessageSummary | null;
}

export interface DocumentDetail extends DocumentSummary {
  content: JSONContent;
  data: VariableValues;
  /** Sobrescritura explícita; `null` = hereda de plantilla/diseño. */
  header: ChromeConfig | null;
  footer: ChromeConfig | null;
  design: DesignTokens | null;
  templateName: string | null;
  /** Cabecera y pie efectivos con su origen. */
  chrome: ResolvedChrome;
  /** Envío pendiente de aprobación, si el documento está en revisión. */
  pendingMessage?: PendingMessageSummary | null;
  /** Rechazo más reciente, visible solo para el remitente. */
  lastRejection?: DocumentRejection | null;
}

/* ──────────────────────────── Autenticación ──────────────────────────── */

export type UserRole = 'admin' | 'member';

export type AuthProvider = 'local' | 'sva';

/* ──────────────────────────────── Menús ──────────────────────────────── */

/**
 * Secciones del menú lateral. El catálogo vive en código porque cada entrada
 * debe corresponder a una ruta real de la SPA; la base de datos solo guarda
 * qué claves puede ver cada usuario.
 */
export const MENU_KEYS = ['home', 'inbox', 'documents', 'templates', 'designs'] as const;

export type MenuKey = (typeof MENU_KEYS)[number];

export interface MenuDefinition {
  key: MenuKey;
  label: string;
  /** Nombre del icono en lucide-vue-next. */
  icon: string;
  sort: number;
}

export const MENU_CATALOG: MenuDefinition[] = [
  { key: 'home', label: 'Inicio', icon: 'House', sort: 1 },
  { key: 'inbox', label: 'Bandeja', icon: 'Inbox', sort: 2 },
  { key: 'documents', label: 'Documentos', icon: 'FileText', sort: 3 },
  { key: 'templates', label: 'Plantillas', icon: 'LayoutTemplate', sort: 4 },
  { key: 'designs', label: 'Diseños', icon: 'Palette', sort: 5 },
];

/** Menús que se asignan por defecto a una cuenta nueva. */
export const DEFAULT_MENU_KEYS: MenuKey[] = [...MENU_KEYS];

export function isMenuKey(value: unknown): value is MenuKey {
  return typeof value === 'string' && (MENU_KEYS as readonly string[]).includes(value);
}

/**
 * Limpia y ordena una selección. «Inicio» siempre forma parte del menú para
 * que una cuenta sin asignaciones no quede atrapada en una pantalla vacía.
 */
export function normalizeMenuKeys(values: unknown): MenuKey[] {
  const selected = new Set<MenuKey>(['home']);
  if (Array.isArray(values)) {
    for (const value of values) {
      if (isMenuKey(value)) selected.add(value);
    }
  }
  return MENU_KEYS.filter((key) => selected.has(key));
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatarUrl: string | null;
  cedula: string | null;
  authProvider: AuthProvider;
  isActive: boolean;
  /** Menús visibles para este usuario; Inicio siempre está incluido. */
  menus: MenuKey[];
  createdAt: string;
}

/** Fila de la pantalla admin «Usuarios y menús». */
export interface UserMenuAssignment {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  avatarUrl: string | null;
  cedula: string | null;
  authProvider: AuthProvider;
  isActive: boolean;
  menus: MenuKey[];
  createdAt: string;
}

export interface AuthResponse {
  user: PublicUser;
  accessToken: string;
}

/* ──────────────────────────── Contrato API ───────────────────────────── */

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  /** Código estable del error (p. ej. `VALIDATION_ERROR`, `CONFLICT`). */
  error: string;
  /** Explicación en lenguaje llano de qué ha pasado. */
  message: string;
  /** Detalle estructurado: campos fallidos, versiones en conflicto, etc. */
  details?: unknown;
  /**
   * Referencia corta para rastrear un fallo del servidor en los logs.
   * Solo la envían los errores 5xx, donde el detalle técnico no se expone.
   */
  reference?: string;
}
