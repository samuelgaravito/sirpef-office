import type {
  ChromeConfig,
  ChromeKind,
  ChromeSource,
  DesignTokens,
  DocType,
  DocumentRejection,
  DocumentStatus,
  DocumentSummary,
  InboxMessageDetail,
  InboxMessageStatus,
  InboxMessageSummary,
  InboxRecipient,
  JSONContent,
  NumberingPreview,
  PendingMessageSummary,
  ResolvedChrome,
  VariableDef,
  VariableValues,
  VersionKind,
} from '@sirpefoffice/shared';

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  docType: DocType;
  designId: string | null;
  designName: string | null;
  designTokens: DesignTokens | null;
  /** Fecha de actualización del diseño para invalidar cachés de preview. */
  designUpdatedAt: string | null;
  /** Diseño realmente aplicado (base o variante activada). */
  effectiveDesignId?: string | null;
  /** Nombre del diseño realmente aplicado. */
  effectiveDesignName?: string | null;
  /** Fecha del diseño aplicado; invalida la caché de la vista previa. */
  effectiveDesignUpdatedAt?: string | null;
  schema?: VariableDef[];
  version: number;
  isShared: boolean;
  /** Solo las plantillas activas se pueden usar para crear documentos. */
  isActive: boolean;
  ownerId: string;
  isMine: boolean | number;
  updatedAt: string;
  /** Fecha de borrado lógico; `null` o ausente = activa. */
  deletedAt?: string | null;
}

export interface TemplateRecord {
  id: string;
  ownerId: string;
  designId: string | null;
  name: string;
  description: string;
  docType: DocType;
  schema: VariableDef[];
  body: JSONContent;
  header: ChromeConfig | null;
  footer: ChromeConfig | null;
  aiInstructions: string | null;
  isShared: boolean;
  isActive: boolean;
  /** Si la plantilla asigna número correlativo al crear documentos. */
  numberingEnabled: boolean;
  /** Serie de numeración (prefijo) o null si no lleva número. */
  numberingPrefix: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface DesignRecord {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  tokens: DesignTokens;
  version: number;
  isShared: boolean;
  isActive: boolean;
  isMine?: boolean | number;
  /**
   * Interruptor «en uso»: es el diseño con el que se dibujan las plantillas.
   * Solo puede haber uno por cuenta.
   */
  isCurrent?: boolean;
  createdAt?: string;
  updatedAt: string;
  /** Fecha de borrado lógico; `null` o ausente = activo. */
  deletedAt?: string | null;
}

export interface DesignDetailResponse {
  design: DesignRecord;
}

export interface ShareRecord {
  userId: string;
  permission: 'editor' | 'viewer';
  name: string;
  email: string;
}

export interface DocumentDetailResponse {
  canExport: boolean;
  document: DocumentSummary & {
    content: JSONContent;
    data: VariableValues;
    header: ChromeConfig | null;
    footer: ChromeConfig | null;
    pendingMessage?: PendingMessageSummary | null;
    lastRejection?: DocumentRejection | null;
  };
  design: DesignRecord | null;
  templateSchema: VariableDef[];
  templateName: string | null;
  chrome: ResolvedChrome;
  inheritedChrome: ResolvedChrome;
  shares: ShareRecord[];
}

export interface TemplateDetailResponse {
  template: TemplateRecord;
  /** Diseño que se aplica ahora (el que está en uso). */
  design: DesignRecord | null;
  effectiveDesignId?: string | null;
  effectiveDesignName?: string | null;
  chrome: ResolvedChrome;
  inheritedChrome: ResolvedChrome;
  /** Número que tendría un documento creado con esta plantilla (no reserva). */
  numberingPreview?: NumberingPreview | null;
}

export interface VersionSummary {
  id: string;
  version: number;
  kind: VersionKind;
  note: string;
  title: string;
  createdAt: string;
  createdBy: string | null;
  authorName: string | null;
}

export interface VersionRecord extends VersionSummary {
  content: JSONContent;
  data: VariableValues;
}

export interface TemplateVersionSummary {
  id: string;
  version: number;
  note: string;
  createdAt: string;
  createdBy: string | null;
}

export interface ActivityRecord {
  id: string;
  action: string;
  meta: Record<string, unknown>;
  createdAt: string;
  userName: string | null;
}

export interface UserListItem {
  id: string;
  name: string;
  email?: string;
  role: string;
  avatarUrl: string | null;
}

export interface ListResponse<T> {
  items: T[];
  total?: number;
  page?: number;
  pageSize?: number;
}

export type {
  ChromeConfig,
  ChromeKind,
  ChromeSource,
  DesignTokens,
  DocType,
  DocumentRejection,
  DocumentStatus,
  DocumentSummary,
  InboxMessageDetail,
  InboxMessageStatus,
  InboxMessageSummary,
  InboxRecipient,
  JSONContent,
  PendingMessageSummary,
  ResolvedChrome,
  VariableDef,
  VariableValues,
};
