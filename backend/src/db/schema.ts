import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import type {
  ChromeConfig,
  DesignTokens,
  DocType,
  DocumentStatus,
  JSONContent,
  MenuKey,
  VariableDef,
  VariableValues,
  VersionKind,
} from '@sirpefoffice/shared';

/* ─────────────────────────────── Enums ─────────────────────────────── */

export const userRoleEnum = pgEnum('user_role', ['admin', 'member']);
export const documentStatusEnum = pgEnum('document_status', [
  'draft',
  'in_review',
  'final',
  'archived',
  'sent',
  'approved',
  'rejected',
  'cancelled',
]);
export const versionKindEnum = pgEnum('version_kind', ['auto', 'manual', 'ai', 'export', 'restore']);
export const sharePermissionEnum = pgEnum('share_permission', ['owner', 'editor', 'viewer']);
export const documentMessageStatusEnum = pgEnum('document_message_status', [
  'pending_approval',
  'sent',
  'rejected',
  'cancelled',
]);
export const docTypeEnum = pgEnum('doc_type', [
  'memorandum',
  'delivery_note',
  'report',
  'meeting_minutes',
  'evaluation_plan',
  'resume',
  'letter',
  'certificate',
  'blank',
]);

/* ─────────────────────────────── Tablas ────────────────────────────── */

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash'),
    role: userRoleEnum('role').notNull().default('member'),
    avatarUrl: text('avatar_url'),

    /* Proyección de SVA: la identidad se administra en SVA, no aquí. */
    svaUuid: uuid('sva_uuid'),
    cedula: text('cedula'),
    authProvider: text('auth_provider').notNull().default('local'),
    isActive: boolean('is_active').notNull().default(true),
    lastSvaSyncAt: timestamp('last_sva_sync_at', { withTimezone: true }),

    /**
     * Claves de menú visibles para el usuario. La sincronización con SVA no
     * toca esta columna: las asignaciones sobreviven a los cambios de perfil.
     */
    menuKeys: text('menu_keys')
      .array()
      .$type<MenuKey[]>()
      .notNull()
      .default(sql`ARRAY['home','inbox','documents','templates','designs']::text[]`),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('users_email_lower_idx').on(sql`lower(${t.email})`),
    uniqueIndex('users_sva_uuid_idx')
      .on(t.svaUuid)
      .where(sql`${t.svaUuid} is not null`),
    index('users_active_idx').on(t.isActive),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('refresh_tokens_hash_idx').on(t.tokenHash),
    index('refresh_tokens_user_idx').on(t.userId),
  ],
);

export const designs = pgTable(
  'designs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    tokens: jsonb('tokens').$type<DesignTokens>().notNull(),
    version: integer('version').notNull().default(1),
    isShared: boolean('is_shared').notNull().default(false),
    /** Un diseño inactivo se oculta de los selectores de nuevas plantillas. */
    isActive: boolean('is_active').notNull().default(true),
    /**
     * Diseño en uso de la cuenta: es el que dibujan todas las plantillas.
     *
     * Solo puede haber uno por cuenta (índice único parcial): al encender un
     * diseño se apagan los demás. Los documentos no lo siguen: guardan el
     * diseño concreto con el que se crearon.
     */
    isCurrent: boolean('is_current').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('designs_owner_idx').on(t.ownerId),
    // Un único diseño en uso por cuenta.
    uniqueIndex('designs_current_unique_idx').on(t.ownerId).where(sql`${t.isCurrent}`),
  ],
);

export const templates = pgTable(
  'templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    designId: uuid('design_id').references(() => designs.id, { onDelete: 'set null' }),
    /** Si la plantilla asigna número correlativo al crear documentos. */
    numberingEnabled: boolean('numbering_enabled').notNull().default(true),
    name: text('name').notNull(),
    docType: docTypeEnum('doc_type').notNull().default('blank'),
    description: text('description').notNull().default(''),
    /** Definición de las variables que el formulario rellena. */
    schema: jsonb('schema').$type<VariableDef[]>().notNull().default([]),
    /** Documento TipTap base de la plantilla. */
    body: jsonb('body').$type<JSONContent>().notNull(),
    /** Sobrescritura de cabecera; null = hereda del diseño. */
    header: jsonb('header').$type<ChromeConfig | null>(),
    /** Sobrescritura de pie; null = hereda del diseño. */
    footer: jsonb('footer').$type<ChromeConfig | null>(),
    /** Instrucciones para la IA: cómo rellenar esta plantilla. */
    aiInstructions: text('ai_instructions'),
    /** Perfil de estilo para el asistente de redacción. */
    aiStyle: text('ai_style'),
    version: integer('version').notNull().default(1),
    isShared: boolean('is_shared').notNull().default(false),
    /** Solo las plantillas activas se pueden usar para crear documentos. */
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('templates_owner_idx').on(t.ownerId),
    index('templates_design_idx').on(t.designId),
  ],
);

/**
 * Series de numeración correlativa. La clave es su `id`, no el prefijo.
 *
 * Cada serie **pertenece a una plantilla**: la relación vive aquí, en
 * `template_id`, con índice único (1 a 1). La serie declara también el
 * `template_name`, una copia legible del nombre de esa plantilla, para que la
 * tabla se lea de un vistazo sin unir con `templates`.
 *
 * La serie es la **única fuente de verdad** de la enumeración: el prefijo (la
 * etiqueta visible del número), el número inicial, los dígitos y el reinicio
 * anual viven aquí. En `templates` solo queda el interruptor
 * `numbering_enabled`.
 *
 * El prefijo es **opcional** (puede estar vacío si la plantilla numera sin
 * etiqueta) y **puede repetirse** entre series: dos plantillas con el mismo
 * prefijo enumeran por separado, con su propio contador y su propio suelo, así
 * que sus números nunca se intercalan.
 */
export const numberingSeries = pgTable(
  'numbering_series',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Plantilla que posee la serie: es la dueña de su enumeración. */
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    /** Copia legible del nombre de la plantilla (se actualiza al renombrarla). */
    templateName: text('template_name').notNull(),
    /** Etiqueta visible del número. Vacía = serie sin prefijo. */
    prefix: text('prefix').notNull().default(''),
    /** Primer número de la serie y de cada año nuevo. */
    startValue: integer('start_value').notNull().default(1),
    padding: integer('padding').notNull().default(4),
    /** Si el número incluye el año y el contador se reinicia cada año. */
    includeYear: boolean('include_year').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Una enumeración por plantilla.
    uniqueIndex('numbering_series_template_id_unique_idx').on(t.templateId),
    index('numbering_series_prefix_idx').on(t.prefix),
  ],
);

export const templateVersions = pgTable(
  'template_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    snapshot: jsonb('snapshot').$type<{
      name: string;
      description: string;
      docType: DocType;
      schema: VariableDef[];
      body: JSONContent;
      header: ChromeConfig | null;
      footer: ChromeConfig | null;
      aiInstructions: string | null;
      aiStyle: string | null;
      tokens: DesignTokens | null;
    }>().notNull(),
    note: text('note').notNull().default(''),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('template_versions_unique_idx').on(t.templateId, t.version)],
);

/**
 * Acceso por persona a una plantilla.
 *
 * Una plantilla puede compartirse con usuarios concretos como **editor**
 * (pueden mejorarla directamente) o **lector** (solo pueden usarla). El
 * permiso es independiente de `templates.isShared`, que abre la plantilla a
 * todo el mundo pero sin permiso de edición.
 */
export const templateShares = pgTable(
  'template_shares',
  {
    templateId: uuid('template_id')
      .notNull()
      .references(() => templates.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permission: sharePermissionEnum('permission').notNull().default('viewer'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.templateId, t.userId] }), index('template_shares_user_idx').on(t.userId)],
);

export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    templateId: uuid('template_id').references(() => templates.id, { onDelete: 'set null' }),
    designId: uuid('design_id').references(() => designs.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    /** Descripción breve para identificar el documento en los listados. */
    description: text('description').notNull().default(''),
    docType: docTypeEnum('doc_type').notNull().default('blank'),
    status: documentStatusEnum('status').notNull().default('draft'),
    /** Número correlativo del documento, p. ej. MEM-0001-2026. */
    docNumber: text('doc_number'),
    /**
     * Identidad de la serie de numeración con la que se emitió el documento.
     * Se guarda desglosada para poder recalcular `document_counters` sin
     * parsear el texto formateado. `null` mientras el documento es borrador.
     */
    numberingPrefix: text('numbering_prefix'),
    numberingYear: integer('numbering_year'),
    numberingValue: integer('numbering_value'),
    /**
     * Serie que emitió el documento. Es la que fija el suelo del contador:
     * dos series distintas (aunque compartan prefijo) no se pisan.
     */
    numberingSeriesId: uuid('numbering_series_id').references(() => numberingSeries.id, {
      onDelete: 'set null',
    }),
    /** Contenido TipTap actual. */
    content: jsonb('content').$type<JSONContent>().notNull(),
    /** Sobrescritura de cabecera; null = hereda de plantilla/diseño. */
    header: jsonb('header').$type<ChromeConfig | null>(),
    /** Sobrescritura de pie; null = hereda de plantilla/diseño. */
    footer: jsonb('footer').$type<ChromeConfig | null>(),
    /** Valores de las variables del documento. */
    data: jsonb('data').$type<VariableValues>().notNull().default({}),
    /** Número de versión actual; sube en cada escritura aceptada. */
    version: integer('version').notNull().default(1),
    /** Sello de inmutabilidad: al aprobar y enviar el documento deja de editarse. */
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: uuid('locked_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    index('documents_owner_idx').on(t.ownerId),
    index('documents_updated_idx').on(t.updatedAt),
    index('documents_template_idx').on(t.templateId),
    index('documents_design_idx').on(t.designId),
    // Un número solo lo reserva el documento que lo tiene **vivo**, y es
    // único **dentro de su serie**: dos plantillas pueden usar el mismo
    // prefijo y cada una lleva su propia enumeración. Los documentos sin
    // serie (sueltos o heredados) conservan la unicidad global.
    uniqueIndex('documents_doc_number_series_idx')
      .on(t.numberingSeriesId, t.docNumber)
      .where(
        sql`${t.docNumber} is not null and ${t.deletedAt} IS NULL and ${t.numberingSeriesId} is not null`,
      ),
    uniqueIndex('documents_doc_number_idx')
      .on(t.docNumber)
      .where(
        sql`${t.docNumber} is not null and ${t.deletedAt} IS NULL and ${t.numberingSeriesId} is null`,
      ),
    // Búsqueda full-text dentro del contenido del documento
    index('documents_content_gin_idx').using('gin', sql`to_tsvector('simple', ${t.content}::text)`),
  ],
);

export const documentVersions = pgTable(
  'document_versions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    content: jsonb('content').$type<JSONContent>().notNull(),
    header: jsonb('header').$type<ChromeConfig | null>(),
    footer: jsonb('footer').$type<ChromeConfig | null>(),
    data: jsonb('data').$type<VariableValues>().notNull().default({}),
    title: text('title').notNull().default(''),
    kind: versionKindEnum('kind').notNull().default('auto'),
    note: text('note').notNull().default(''),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('document_versions_unique_idx').on(t.documentId, t.version),
    index('document_versions_document_idx').on(t.documentId),
  ],
);

export const documentShares = pgTable(
  'document_shares',
  {
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    permission: sharePermissionEnum('permission').notNull().default('viewer'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.documentId, t.userId] })],
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    authorId: uuid('author_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Ancla del comentario dentro del documento: { from, to, quote }. */
    anchor: jsonb('anchor').$type<{ from: number; to: number; quote: string }>().notNull(),
    body: text('body').notNull(),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('comments_document_idx').on(t.documentId)],
);

export const activities = pgTable(
  'activities',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    action: text('action').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('activities_entity_idx').on(t.entityType, t.entityId)],
);

/**
 * Mensajes de la bandeja interna. Cada fila representa un envío (o una
 * solicitud de aprobación) de un documento a uno o más usuarios.
 */
export const documentMessages = pgTable(
  'document_messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    documentId: uuid('document_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    senderId: uuid('sender_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    body: text('body').notNull().default(''),
    status: documentMessageStatusEnum('status').notNull().default('pending_approval'),
    /** Versión del documento que se está enviando. */
    documentVersion: integer('document_version').notNull(),
    approvedById: uuid('approved_by_id').references(() => users.id, { onDelete: 'set null' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    rejectedReason: text('rejected_reason'),
    /** Si el asistente puede corregir y reenviar tras un rechazo. */
    allowSenderEdit: boolean('allow_sender_edit').notNull().default(true),
    /** Si el asistente puede exportar el memo después de aprobarlo. */
    allowSenderExport: boolean('allow_sender_export').notNull().default(false),
    /** Cuándo vio el remitente el resultado (aprobado o rechazado). */
    senderReadAt: timestamp('sender_read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('document_messages_document_idx').on(t.documentId),
    index('document_messages_sender_idx').on(t.senderId),
    index('document_messages_status_idx').on(t.status),
    // Un documento solo puede tener una solicitud de aprobación activa.
    uniqueIndex('document_messages_pending_unique_idx')
      .on(t.documentId)
      .where(sql`${t.status} = 'pending_approval'`),
  ],
);

/** Destinatarios de un mensaje y su estado de lectura/archivo. */
export const documentMessageRecipients = pgTable(
  'document_message_recipients',
  {
    messageId: uuid('message_id')
      .notNull()
      .references(() => documentMessages.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    readAt: timestamp('read_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.messageId, t.userId] }),
    index('document_message_recipients_user_idx').on(t.userId),
  ],
);

/**
 * Contadores de numeración correlativa por serie y año.
 *
 * La clave es la serie (`series_id`), no el prefijo: así cada plantilla lleva
 * su propio contador aunque otra use el mismo prefijo.
 */
export const documentCounters = pgTable(
  'document_counters',
  {
    /** Serie cuyo contador es este. */
    seriesId: uuid('series_id')
      .notNull()
      .references(() => numberingSeries.id, { onDelete: 'cascade' }),
    year: integer('year').notNull(),
    counter: integer('counter').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.seriesId, t.year] })],
);

/**
 * Ajustes editables en caliente (proveedor de IA, etc.). Se guardan como
 * clave → JSON para no exigir una migración por cada ajuste nuevo.
 */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

/* ────────────────────────────── Relaciones ──────────────────────────── */

export const usersRelations = relations(users, ({ many }) => ({
  documents: many(documents),
  designs: many(designs),
  templates: many(templates),
  templateShares: many(templateShares),
}));

export const documentsRelations = relations(documents, ({ one, many }) => ({
  owner: one(users, { fields: [documents.ownerId], references: [users.id] }),
  template: one(templates, { fields: [documents.templateId], references: [templates.id] }),
  design: one(designs, { fields: [documents.designId], references: [designs.id] }),
  numberingSeries: one(numberingSeries, {
    fields: [documents.numberingSeriesId],
    references: [numberingSeries.id],
  }),
  versions: many(documentVersions),
  shares: many(documentShares),
  comments: many(comments),
  messages: many(documentMessages),
}));

export const documentVersionsRelations = relations(documentVersions, ({ one }) => ({
  document: one(documents, { fields: [documentVersions.documentId], references: [documents.id] }),
  author: one(users, { fields: [documentVersions.createdBy], references: [users.id] }),
}));

export const documentSharesRelations = relations(documentShares, ({ one }) => ({
  document: one(documents, { fields: [documentShares.documentId], references: [documents.id] }),
  user: one(users, { fields: [documentShares.userId], references: [users.id] }),
}));

export const templatesRelations = relations(templates, ({ one, many }) => ({
  owner: one(users, { fields: [templates.ownerId], references: [users.id] }),
  design: one(designs, { fields: [templates.designId], references: [designs.id] }),
  /** Serie de numeración propia: la serie declara a su plantilla. */
  numberingSeries: one(numberingSeries, {
    fields: [templates.id],
    references: [numberingSeries.templateId],
  }),
  versions: many(templateVersions),
  shares: many(templateShares),
}));

export const templateSharesRelations = relations(templateShares, ({ one }) => ({
  template: one(templates, {
    fields: [templateShares.templateId],
    references: [templates.id],
  }),
  user: one(users, { fields: [templateShares.userId], references: [users.id] }),
}));

export const numberingSeriesRelations = relations(numberingSeries, ({ one }) => ({
  /** Plantilla que posee la serie. */
  template: one(templates, {
    fields: [numberingSeries.templateId],
    references: [templates.id],
  }),
}));
export const designsRelations = relations(designs, ({ one, many }) => ({
  owner: one(users, { fields: [designs.ownerId], references: [users.id] }),
  templates: many(templates),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
  document: one(documents, { fields: [comments.documentId], references: [documents.id] }),
  author: one(users, { fields: [comments.authorId], references: [users.id] }),
}));

export const documentMessagesRelations = relations(documentMessages, ({ one, many }) => ({
  document: one(documents, { fields: [documentMessages.documentId], references: [documents.id] }),
  sender: one(users, { fields: [documentMessages.senderId], references: [users.id] }),
  approvedBy: one(users, {
    fields: [documentMessages.approvedById],
    references: [users.id],
  }),
  recipients: many(documentMessageRecipients),
}));

export const documentMessageRecipientsRelations = relations(
  documentMessageRecipients,
  ({ one }) => ({
    message: one(documentMessages, {
      fields: [documentMessageRecipients.messageId],
      references: [documentMessages.id],
    }),
    user: one(users, {
      fields: [documentMessageRecipients.userId],
      references: [users.id],
    }),
  }),
);

/* ─────────────────────────────── Tipos ──────────────────────────────── */

export type UserRow = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type DesignRow = typeof designs.$inferSelect;
export type TemplateRow = typeof templates.$inferSelect;
export type TemplateShareRow = typeof templateShares.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentVersionRow = typeof documentVersions.$inferSelect;
export type CommentRow = typeof comments.$inferSelect;
export type ActivityRow = typeof activities.$inferSelect;
export type DocumentMessageRow = typeof documentMessages.$inferSelect;
export type DocumentMessageRecipientRow = typeof documentMessageRecipients.$inferSelect;
