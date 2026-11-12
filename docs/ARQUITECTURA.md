# Arquitectura de SirpefOffice

Documento técnico del sistema: decisiones, modelo de datos, flujos, API, renderizado,
seguridad y deuda técnica. Para instalación y uso, consulta el [`README`](../README.md).

---

## 1. Visión general

SirpefOffice es una aplicación **cliente-servidor** con tres procesos en desarrollo:

```text
┌────────────────────────┐        HTTP/JSON (/api)        ┌──────────────────────────┐
│  Web (Vue 3 + TipTap)  │ ─────────────────────────────► │  API (Node + Fastify 5)  │
│  Vite · Pinia · Router │ ◄───────────────────────────── │  Drizzle · jose · Zod    │
└────────────────────────┘   cookies httpOnly + JWT       └────────────┬─────────────┘
                                                                        │ SQL
                                                           ┌────────────▼─────────────┐
                                                           │ PostgreSQL 16            │
                                                           │ Docker 5433 / local 5432 │
                                                           └──────────────────────────┘

API ──► Chrome headless (puppeteer-core) ──► PDF
API ──► docx / static-renderer ───────────► DOCX / HTML
API ──► proveedor de IA (opcional) ───────► JSON de variables
```

Principios:

1. **El documento es un árbol ProseMirror (JSONB)**. No hay HTML como fuente de verdad:
   el HTML se deriva al renderizar/exportar. Así se evita el *markup* inválido y se
   conserva la fidelidad entre editor, vista previa y PDF.
2. **Las plantillas separan forma y datos**: el cuerpo contiene `{{variables}}`, y los
   valores viven en `documents.data` (JSONB). Cambiar un dato no reescribe el cuerpo.
3. **El servidor es la autoridad de renderizado**: la vista previa y las exportaciones
   usan el mismo motor (`backend/src/lib/render.ts`), por lo que lo que se ve es lo que se
   descarga.
4. **Versionado optimista**: cada guardado envía la versión esperada; si otro cliente
   guardó antes, la API responde `409` con la versión actual.
5. **La IA es un asistente de datos, no de formato**: solo rellena variables del esquema.

---

## 2. Decisiones de arquitectura

| # | Decisión | Alternativas descartadas | Motivo |
| --- | --- | --- | --- |
| 1 | TipTap 3 como motor de edición | Slate, Lexical, ProseMirror puro, CKEditor | Modelo JSON estable, ecosistema Vue, extensiones MIT, mismo esquema en cliente y servidor. |
| 2 | PostgreSQL + Drizzle | SQLite, MongoDB, Prisma | JSONB para documentos, transacciones, SQL versionado legible, tipado sin *codegen* pesado. |
| 3 | JWT corto + refresh opaco rotativo | Sesiones en memoria, JWT largo | Revocación real, rotación ante robo, sin estado compartido entre réplicas. |
| 4 | Autoguardado + versión esperada | CRDT / WebSocket colaborativo | Mucho menor complejidad; suficiente para el caso de uso (documentos administrativos). |
| 5 | Render en servidor con Chrome | PDF en cliente (jsPDF), LibreOffice | Fidelidad tipográfica y de paginación; sin dependencias nativas de Office. |
| 6 | `docx` para Word | LibreOffice headless, pandoc | Generación programática determinista y multiplataforma. |
| 7 | Configuración de IA en BD | Solo `.env` | El admin puede cambiarla sin reiniciar y sin exponer claves; `.env` como respaldo. |
| 8 | Sin importación de `.docx` | Conversión con mammoth | Decisión de producto: solo documentos nuevos desde plantillas. |
| 9 | `shared/src` como fuente única + copia automática en cada app | Workspaces npm, paquete local con `node_modules`, duplicar tipos a mano | Una sola definición de `DesignTokens`, `VariableDef` y extensiones TipTap, con `node_modules` independientes y una única copia de TipTap por app. |
| 10 | Vite 6 + `overrides` | Vite 8 (rolldown) | Vite 8 requiere Node ≥ 20.19; el entorno usa 20.12. Se fija una única copia de Vite. |
| 11 | Cabecera/pie como `ChromeConfig` nullable con resolución pura | Guardar una copia plana en cada documento | `null` = heredar; una función compartida (`resolveChrome`) garantiza que editor, PDF, DOCX y HTML coincidan y permite restablecer sin perder el nivel superior. |

---

## 3. Estructura del repositorio

Frontend y backend son aplicaciones independientes, cada una con su propio
`package.json`, `package-lock.json` y `node_modules`. No hay workspaces ni
`node_modules` en la raíz. `shared/src` es la fuente única; `scripts/sync-shared.mjs`
la copia a `frontend/src/shared` y `backend/src/shared` para que cada app resuelva
el alias `@sirpefoffice/shared` contra su propio `node_modules`.

```text
shared/src/
  types.ts               # JSONContent, DesignTokens, VariableDef, ChromeConfig, contratos de API
  defaults.ts            # DEFAULT_DESIGN_TOKENS, PAGE_SIZES_CM, DOC_TYPES, EXPORT_FORMATS
  chrome.ts              # Resolución documento → plantilla → diseño y conversión de tokens
  editor-extensions.ts   # createEditorExtensions(): fuente única cliente/servidor
  realtime.ts            # Contrato de los eventos en tiempo real (WebSocket)

backend/src/
  index.ts               # Arranque del proceso
  app.ts                 # Fastify, CORS, cookies, errores, registro de módulos
  env.ts                 # Lectura y validación de variables de entorno
  db/
    schema.ts            # 14 tablas Drizzle
    index.ts             # Pool pg + drizzle
    template-seeds.ts    # 3 diseños + 8 plantillas
    seed.ts              # Admin, diseños y plantillas
  modules/
    auth/                # register, login, refresh, logout, me, users
    documents/           # CRUD, contenido, versiones, shares, actividad, html
    inbox/               # bandeja, envíos, aprobación y bloqueo
    templates/           # CRUD, clonado, versiones de plantilla
    designs/             # CRUD, clonado
    numbering/           # Series por plantilla y contador
    realtime/            # Canal de eventos en tiempo real (hub, handshake y publicación)
    ai/                  # providers, service, routes
    exports/             # /export/:format
  lib/
    auth-guard.ts        # authenticate(request) → { sub, role }
    jwt.ts               # JWT (jose) + refresh tokens (SHA-256, rotación)
    password.ts          # scrypt
    access.ts            # assertDocument(userId, id, 'viewer'|'editor')
    counter.ts           # Resuelve el número de un documento nuevo
    numbering.ts         # Series por plantilla, contadores y validación del número inicial
    active-design.ts       # Diseño en uso: resuelve el que dibujan las plantillas y el interruptor
    render.ts            # Interpolación + datos de muestra + CSS + HTML + bandas
    errors.ts            # AppError + helpers (notFound, conflict, forbidden…)
    validators.ts        # Esquemas Zod compartidos
  export/
    pdf.ts               # Chrome headless + plantillas de cabecera/pie
    docx.ts              # Header/Footer, imágenes y campos PAGE/NUMPAGES

frontend/src/
  main.ts / router/      # Rutas y guardas de sesión
  api/client.ts          # fetch con refresh automático y descarga de blobs
  stores/auth.ts         # Pinia: usuario, token, login/logout
  views/                 # Login, Home, Documents, DocumentEditor, Templates,
                         # TemplateEditor, Designs, DesignEditor, Settings, NotFound,
                         # Inbox, InboxMessage
  components/
    layout/AppShell.vue
    documents/DocumentCard.vue | DocumentThumbnail.vue
    inbox/SendDocumentDialog.vue
    templates/TemplatePreview.vue | NewTemplateDialog.vue
    editor/EditorToolbar.vue | PageChromeBand.vue | VariablePanel.vue
            VersionHistoryPanel.vue | FindReplacePanel.vue | ShareDialog.vue
    designs/DesignPreview.vue
    ui/                   # BaseModal, BaseDropdown, BaseSpinner, EmptyState, Toasts
  lib/
    labels.ts             # Etiquetas y estilos de estado/tipo
    variable-highlight.ts # Decoraciones {{variable}} en el editor
    diff.ts               # Diff por palabras para el historial
```

---

## 4. Modelo de datos

14 tablas en PostgreSQL (`backend/src/db/schema.ts`):

```text
users ─┬─< refresh_tokens
       ├─< designs ──────────────┐
       ├─< templates ─< template_versions
       │        │                │
       ├─< documents >────────────┘   (design_id, template_id)
       │      ├─< document_versions
       │      ├─< document_shares >── users
       │      ├─< document_messages ─< document_message_recipients >── users
       │      ├─< comments
       │      └─< activities
       └─< app_settings (key/value JSONB, IA)
numbering_series (id, template_id, template_name) → la enumeración y su configuración (la dueña es una plantilla)
document_counters (series_id, year) → secuencia emitida al oficializar
```

| Tabla | Campos relevantes | Notas |
| --- | --- | --- |
| `users` | `email` único, `password_hash`, `name`, `role`, `avatar_url` | `role` ∈ `admin`/`member`. |
| `refresh_tokens` | `token_hash`, `user_id`, `expires_at`, `revoked_at`, `user_agent`, `ip` | Rotación: al refrescar se revoca el anterior y se inserta uno nuevo. |
| `designs` | `tokens` JSONB, `is_shared`, `owner_id`, `is_current` | Los tokens siguen `DesignTokens`. El diseño conserva su formato histórico de encabezado/pie; se adapta a `ChromeConfig` al resolver. `is_current` marca el **diseño en uso** de la cuenta: es el que dibujan todas sus plantillas. Índice único parcial `(owner_id) WHERE is_current`: solo uno por cuenta. Los documentos guardan el diseño concreto y quedan congelados. |
| `templates` | `body` JSONB, `schema` JSONB, `doc_type`, `design_id`, `header`, `footer`, `is_shared`, `numbering_enabled` | `schema: VariableDef[]`. `header`/`footer` son `ChromeConfig` o `null` (heredar del diseño). La numeración se activa por plantilla y su serie la declara la propia serie (`numbering_series.template_id`). De la numeración solo queda aquí el interruptor: el prefijo, el número inicial, los dígitos y el reinicio anual viven en la serie. |
| `template_versions` | `body`, `schema`, `header`, `footer`, `version`, `note` | Historial de plantillas; la instantánea incluye las bandas. |
| `documents` | `content` JSONB, `data` JSONB, `doc_number`, `numbering_series_id`, `numbering_prefix/year/value`, `version`, `status`, `design_id`, `template_id`, `header`, `footer`, `locked_at`, `locked_by` | `version` se incrementa en cada guardado real (un guardado idéntico no escribe). `doc_number` queda `NULL` mientras el documento es borrador y se asigna al oficializarlo. `numbering_*` guarda la identidad de la serie emisora. `header`/`footer` son sobrescrituras o `null` (heredar). `locked_at` sella el memo aprobado y enviado. |
| `document_versions` | `version`, `content`, `data`, `header`, `footer`, `kind`, `created_by`, `note` | `kind` ∈ `auto/manual/ai/export/restore`; la instantánea permite restaurar las bandas. |
| `document_shares` | `document_id`, `user_id`, `permission` | Único por par documento/usuario. |
| `document_messages` | `document_id`, `sender_id`, `subject`, `body`, `status`, `document_version`, `approved_by_id`, `sent_at`, `sender_read_at`, `allow_sender_edit`, `allow_sender_export` | Envío o solicitud de aprobación de la bandeja. `status` ∈ `pending_approval/sent/rejected/cancelled`. `sender_read_at` marca cuándo el remitente vio el resultado; `allow_sender_edit` indica si puede corregir tras un rechazo; `allow_sender_export` si puede exportar tras la aprobación. Índice único parcial: un solo pendiente por documento. |
| `document_message_recipients` | `message_id`, `user_id`, `read_at`, `archived_at` | Destinatarios y estado de lectura. `archived_at` se conserva por compatibilidad y ya no se usa en la bandeja. |
| `comments` | `document_id`, `author_id`, `body`, `anchor`, `resolved_at` | Reservada para la UI de comentarios. |
| `activities` | `actor_id`, `entity_type`, `entity_id`, `action`, `metadata` | Auditoría funcional. |
| `numbering_series` | `id` PK, `template_id` (FK, único), `template_name`, `prefix`, `start_value`, `padding`, `include_year` | **Única fuente de verdad de la enumeración.** Declara a su plantilla con `template_id` (índice único `numbering_series_template_id_unique_idx` → una enumeración por plantilla) y guarda su nombre en `template_name` como etiqueta legible, que se actualiza al renombrar la plantilla. Su contador y su suelo son exclusivos. El prefijo es la etiqueta visible del número, **puede repetirse** entre series y puede estar vacío (serie sin prefijo). Las plantillas sin numeración no ocupan serie. |
| `document_counters` | `series_id` (FK), `year`, `counter` | Último número emitido por serie y año; se incrementa solo al oficializar el documento y se puede recalcular desde `documents.numbering_*`. |
| `app_settings` | `key` único, `value` JSONB, `updated_by` | Configuración de IA (`key = 'ai'`). |

Índices destacados: búsqueda por título (`ILIKE`), filtros por `owner_id`, `status`,
`doc_type`, y `document_versions(document_id, version)` para el historial.

### Flujo de envío, aprobación y numeración

1. El asistente (`member`) crea y edita el memo en estado `draft`. El documento
   **no existe en la base de datos** hasta que se guarda o se envía: el editor
   arranca en modo virtual y el autoguardado vive en `localStorage`.
2. Al pulsar **Enviar**, elige destinatarios, asunto y mensaje. Se crea un
   `document_messages` en `pending_approval`, el memo pasa a `in_review` y se
   comparte como `editor` con los administradores. El asistente lo ve en
   **Enviados** con el chip ámbar «Pendiente de aprobación». El memo aún **no
   tiene número**: se muestra el número previsto, que no reserva el contador.
3. El jefe (`admin`) lo ve en **Bandeja → Recibidos**, dentro del bloque destacado
   «Requiere tu aprobación». Puede abrirlo, corregirlo y, al aprobar, decide si el
   asistente podrá exportar el memo; se guarda una versión de historial con la nota
   «Aprobado y enviado».
4. La aprobación es atómica: el mensaje pasa a `sent`, el memo a `sent`, se
   rellena `locked_at`/`locked_by`, `allow_sender_export` y los destinatarios
   reciben acceso `viewer`. **En la misma transacción se asigna el correlativo**:
   se bloquea la fila del documento (`SELECT … FOR UPDATE`), se resuelve su serie
   y se hace el `INSERT … ON CONFLICT DO UPDATE` sobre `document_counters`. El memo
   aparece en **Enviados** para el remitente y el aprobador (filtro «Aprobados»),
   y en **Recibidos** para los destinatarios. El asistente recibe un aviso: el
   badge del menú sube, la fila se marca como **Nuevo** y ve un toast con el nombre
   del aprobador. Al abrir el mensaje se guarda `sender_read_at` y el aviso se apaga.
5. Un memo con `locked_at` es inmutable: se bloquean edición, borrado,
   restauración de versiones y cambios de compartición. Solo se puede leer o
   consultar en pantalla. La **exportación (PDF/DOCX/HTML)** queda reservada al
   administrador que aprobó/rechazó el envío, a los administradores destinatarios
   y, si se autorizó al aprobar, al asistente remitente. Las vistas previas (la
   miniatura de las tarjetas y la vista previa dentro del editor) siguen
   disponibles para quien tenga acceso: no son una exportación.
6. Si el jefe rechaza, el mensaje queda `rejected` con un motivo. El rechazo
   permite elegir si el asistente puede corregir:
   - **con edición** (por defecto): el memo vuelve a `draft` y puede corregirse y
     reenviarse. Como nunca se emitió, **no consume número**;
   - **sin edición**: el memo queda `rejected` con `locked_at`, cerrado y sin
     posibilidad de edición ni exportación por parte del asistente.
   Aparece en **Enviados** con el filtro «Rechazados» y el remitente recibe el
   aviso (badge, fila **Nuevo** y toast de rechazo).

### Numeración

- **Cada plantilla lleva su propia enumeración.** Lo declara la propia serie:
  `numbering_series.template_id` (FK a `templates.id`, índice único → una
  enumeración por plantilla) y `numbering_series.template_name`, la copia
  legible del nombre de esa plantilla, para leer la tabla sin unir nada. Su
  contador y su suelo son exclusivos: dos plantillas nunca intercalan sus
  números. El vínculo antiguo (`templates.numbering_series_id`) ya no existe:
  queda un solo sitio donde vive, así que no puede desincronizarse.
- **La serie es la única fuente de verdad.** El prefijo, el número inicial,
  los dígitos y el reinicio anual viven en `numbering_series`; en `templates`
  solo queda el interruptor `numbering_enabled`. Por eso el panel de ajustes
  muestra siempre los valores reales de la serie de esa plantilla.
- El prefijo es **opcional** y **puede repetirse** entre plantillas: es solo la
  etiqueta visible del número. El panel de numeración avisa de que otra
  plantilla lo usa y explica que las enumeraciones son independientes. Hay
  dos estados: **prefijo propio** (el usuario escribe la etiqueta, `MEM`) y
  **sin prefijo** (el campo en blanco → la serie numera solo con el
  correlativo, `0008-2026`).
- El formato del número es `PREFIX-CORRELATIVO-AÑO` (`MEM-0008-2026`); sin
  prefijo, `0008-2026`; sin año de reinicio, `MEM-0008`. El prefijo admite de
  1 a 20 letras o números.
- El número se asigna la primera vez que el documento alcanza un estado oficial
  (`sent`, `approved`, `final`, `archived`), nunca al crear el borrador.
- `documents.numbering_series_id` y `documents.numbering_prefix/year/value`
  guardan la identidad de la serie con la que se emitió el documento, de modo
  que `document_counters` se puede recalcular sin parsear `doc_number`.
- El número emitido es único **dentro de su serie**
  (`documents_doc_number_series_idx`, único parcial por
  `(numbering_series_id, doc_number)`): dos series que compartan prefijo
  pueden mostrar el mismo texto, pero sus contadores siguen siendo
  independientes.
- El número previsto se calcula en lectura (`nextNumberValue` + el último emitido)
  y se expone como `numberingPreview` (`{ number, prefix, seriesLabel, seriesId,
  nextValue, includeYear, year }`); no modifica `document_counters`. Se calcula en lote para el
  listado (`numberingPreviewsFor`) y también lo devuelve `GET /api/templates/:id`
  para el modo «documento nuevo».
- La interfaz lo explica en el editor (`MEM-0008-2026 · se asigna al aprobar`), en
  la tarjeta del listado (`· previsto`), en el panel de variables, en el diálogo de
  envío y en la bandeja. Dentro del documento, `{{numero_documento}}` se sustituye
  visualmente por el número (decoración de ProseMirror, sin tocar el contenido); en
  la vista previa y el PDF de un borrador aparece como `MEM-0008-2026 (previsto)`.
- Al aprobar, `POST /api/inbox/:id/approve` y el envío directo devuelven `docNumber`
  para que el cliente confirme el número real (y avise si difiere del previsto).
- Herramientas de mantenimiento: `npm run db:migrate:numbering` (migración de datos
  idempotente), `npm run db:reconcile-counters` (recalcula y corrige) y
  `npm run db:purge-empty-drafts` (elimina borradores vacíos; simulación por
  defecto).

### Versionado

`PUT /api/documents/:id/content`:

```text
UPDATE documents
   SET content = $1, data = $2, title = $3, version = version + 1
 WHERE id = $4 AND version = $expectedVersion
RETURNING *
```

- Si no actualiza filas → `409 CONFLICT` con `{ currentVersion, updatedAt }`.
- Si el contenido, los datos, el título y las bandas son **idénticos** a lo guardado, no
  se escribe nada: se devuelve la versión actual sin incrementarla. Así, abrir un
  documento no ensucia `updated_at` ni el historial.
- Si actualiza → inserta en `document_versions` (`auto` o `manual` si `checkpoint: true`).
- El cliente, ante `409`, muestra un aviso con opción de recargar la versión del servidor.

Las versiones se crean también al exportar (`export`), al restaurar (`restore`) y cuando
la IA modifica datos (`ai`).

### 4.1 Cabecera y pie

La cabecera y el pie se modelan con `ChromeConfig` (`shared/src/types.ts`):

```ts
interface BandImage {
  id: string;
  src: string;       // data URL o URL accesible
  xMm: number;       // posición relativa a la esquina superior izquierda
  yMm: number;
  widthMm: number;
  heightMm: number;
  opacity?: number;
  zIndex?: number;
}

interface ChromeConfig {
  enabled: boolean;
  content: JSONContent; // documento TipTap completo
  heightMm: number;     // alto reservado en la página (5–80 mm)
  widthPercent?: number; // % del ancho de página (20–100)
  images?: BandImage[];
}
```

En `documents` y `templates` las columnas `header`/`footer` son **nullable**. Un valor
`null` no significa “vacío”, sino **heredar**; una banda vacía y desactivada se representa
con `enabled: false` y un documento TipTap vacío.

La resolución es pura y compartida (`shared/src/chrome.ts`), de modo que el
servidor exporta exactamente lo mismo que muestra el editor:

```text
documento.header/footer  (si no es null)
        ↓
plantilla.header/footer  (si no es null; se resuelve en vivo por template_id)
        ↓
diseño                   (chromeFromDesign(tokens))
        ↓
valores por defecto      (DEFAULT_DESIGN_TOKENS)
```

`resolveChrome()` devuelve `ResolvedChrome`: las dos bandas efectivas más
`headerSource`/`footerSource` (`document`, `template` o `design`). El editor usa ese
origen para mostrar **Personalizado** o **Heredado** y para decidir si ofrece
**Usar el heredado**.

El diseño mantiene su formato anterior (`header` JSON con alineación y `footer` de texto
con flags `showPageNumber`/`showTotal`) para no romper datos existentes; además acepta
`heightMm`, `widthPercent` e `images` en ambas bandas. `chromeFromDesign()` lo convierte a
bandas, normaliza las imágenes (`normalizeBandImages`) y aplica los tokens
`{page}`/`{total}`. Los documentos creados desde una plantilla no copian las bandas, por
lo que siguen heredando los cambios del diseño y de la plantilla.

`widthPercent` es el ancho de la banda respecto al ancho de **la página** (20–100). El
valor `100` ocupa la hoja completa y `20` deja la banda centrada con un ancho mínimo. Los
márgenes del cuerpo ya no limitan la cabecera ni el pie: la banda se centra sobre la
página y los márgenes solo se aplican al cuerpo.

La hoja del editor y del HTML se compone en tres zonas de página con
`grid-template-rows: auto 1fr auto`: `.doc-page-top` (membrete + cabecera) se ancla al
borde superior, `.doc-body`/`.doc-body-editor` ocupa el espacio restante con los márgenes
laterales, y `.doc-page-bottom` (pie) se ancla al borde inferior. La cabecera y el pie no
se desplazan con los márgenes; el cuerpo es el único que los usa. En los editores,
`EditorContent` se envuelve en `.doc-body-editor` para que el wrapper y el editor de TipTap
se repartan el espacio restante. El pie queda pegado al borde inferior de la hoja y su
contenido se alinea al fondo de la franja, de modo que aumentar `heightMm` hace crecer la
banda hacia arriba sin separarla del pie. En documentos y plantillas, las bandas
habilitadas se ven también en modo lectura (sin barra de controles); la barra y los
editores TipTap solo se activan al abrir el modo de cabecera/pie.

Las coordenadas de `BandImage` son milímetros relativos a la banda. El editor de diseño
(`DesignEditorView.vue` / `DesignPreview.vue`) usa el mismo sistema que `render.ts` y
`docx.ts`; así la imagen mantiene su posición relativa dentro de la franja en editor, HTML,
PDF y DOCX. Las
imágenes se guardan embebidas como *data URL* (límite de 2 MB en cliente y 3 000 000 de
caracteres en el validador Zod, máximo 20 por banda). Los listados usan
`designTokensForList()` para enviar los tokens sin esas imágenes y evitar JSON
desproporcionados; el detalle del diseño sí las conserva para editarlas.

---

## 5. Autenticación y autorización

### Flujo

```text
POST /api/auth/login
  ├─ verifica scrypt(password, hash)
  ├─ crea access JWT (15 min)  → body { user, accessToken }
  └─ crea refresh opaco (32 B) → cookie httpOnly `sd_refresh` (30 días, hash en BD)

Cliente: guarda accessToken y lo envía como Authorization: Bearer …
Al recibir 401:
  POST /api/auth/refresh (cookie)
    ├─ busca SHA-256 del token, valida expiración/revocación
    ├─ revoca el usado y emite uno nuevo (rotación)
    └─ devuelve nuevo accessToken
  reintenta la petición original una vez

POST /api/auth/logout → revoca refresh + borra cookies
```

Detalles de implementación:

- `jose` firma HS256 con `JWT_ACCESS_SECRET`; el payload incluye `sub`, `role`, `email`.
- El refresh token se guarda **hasheado** (SHA-256) y se compara por índice único.
- `authenticate()` en `lib/auth-guard.ts` valida el header y consulta `users.is_active` y
  `users.role` en cada petición, de modo que una baja o cambio de rol en SVA surte efecto
  sin esperar a que expire el access token.
- Cookies `sd_access` y `sd_refresh`: `httpOnly`, `sameSite=lax`, `secure` si
  `NODE_ENV=production`, `path=/`. El cliente envía además el Bearer en cada petición.
- Contraseñas: `scrypt` con sal de 16 bytes y clave derivada de 64 bytes; formato
  `scrypt$<sal base64>$<hash base64>`, comparación con `timingSafeEqual`.

### Integración con SVA (registro único de usuarios)

SVA es la única fuente de identidad. SirpefOffice **no crea ni edita usuarios** cuando
`AUTH_MODE` es `hybrid` o `sva`: mantiene una proyección automática en `users` porque
`documents.owner_id`, `document_shares.user_id` y el resto de FKs apuntan a ella.

```text
SVA: admin crea usuario + asigna sistema SirpefOffice + rol
        │
        ├─ POST /auth/sync (key_backend) → sync al arrancar y cada 10 min
        │     └─ upsert por sva_uuid, desactiva los que ya no están
        │
        └─ POST /auth/system/session (SVA-TOKEN + api_key) → POST /api/auth/sva
              └─ upsert + sesión local (sd_access + sd_refresh)
```

- `users.sva_uuid` enlaza la identidad; el correo solo se usa para enlazar filas
  heredadas. Una fila local nunca se borra: se desactiva (`is_active=false`).
- `POST /auth/system/session` es el contrato servidor-a-servidor: recibe
  `{ api_key, token }`, valida el sistema por `key_backend`, la sesión del usuario y
  su asignación en `configUsers`, y devuelve `{ system, user }` con el rol del sistema.
  SirpefOffice lo consume desde `POST /api/auth/sva`.
- El rol global sale de `configUsers.is_admin` (`true → admin`, `false → member`),
  no de `users.isAdmin` de SVA.
- `AUTH_MODE`: `local` (solo cuentas locales), `hybrid` (SVA manda y se conserva el
  admin local de emergencia) y `sva` (login local deshabilitado).
- El sync no desactiva a nadie si SVA no responde. Un usuario reasignado conserva
  sus documentos y comparticiones al reactivarse por `sva_uuid`.
- `POST /api/auth/sva/sync` (admin) y `npm run sva:sync` fuerzan la sincronización.

### Permisos

| Nivel | Quién | Puede |
| --- | --- | --- |
| `owner` | `documents.owner_id` | Editar, compartir, borrar, restaurar, exportar. |
| `editor` | fila en `document_shares` | Editar contenido y datos, exportar. |
| `viewer` | fila en `document_shares` | Leer, ver historial y exportar (los memos sellados solo los exporta el admin autorizado o el remitente si se habilitó). |
| `admin` | `users.role` | Gestionar usuarios y configuración de IA; no accede a documentos ajenos por rol. |

`assertDocument(userId, id, minimum)` resuelve el permiso y lanza `404`/`403`. Los listados
filtran por `scope=all|mine|shared`. `canExportDocument(userId, role, doc)` es la autoridad
para las descargas:

| Rol | Documento abierto (borrador) | Memo sellado |
| --- | --- | --- |
| `admin` | sí | sí, si es el aprobador o un destinatario |
| `member` | no | solo con `document_messages.allow_sender_export` |

Es decir: **un asistente nunca exporta un borrador**; para obtener una copia el jefe tiene
que aprobar el envío marcando «el asistente también podrá exportarlo». La misma regla
protege el HTML completo del documento (`GET /api/documents/:id/html` sin `preview=1`),
que antes se entregaba a cualquier lector y permitía llevarse el memo sellado.

La **vista previa dentro de la app** no es una exportación y queda disponible para
cualquier lector: `?embed=1` (miniaturas de las tarjetas) y `?preview=1` (vista previa
del editor, del visor y del historial de versiones).

### Estado del documento

El estado solo lo cambia a mano un **administrador** (`PATCH /api/documents/:id` con
`status`). El servidor responde `403` a cualquier otro rol y la interfaz muestra el
estado como una etiqueta con candado, sin aspecto de control. Los estados que dependen
del flujo de bandeja (`Enviado`, `Aprobado`, `Rechazado`, `Anulado`) los asigna el propio
flujo, no una edición manual.

---

## 6. Motor de renderizado

`backend/src/lib/render.ts` es el corazón de la fidelidad documental.

### 6.1 Interpolación

```ts
interpolateDoc(content, values)
  ├─ recorre el árbol ProseMirror
  ├─ en cada nodo de texto reemplaza {{clave}} por formatValue(valor, tipo)
  ├─ soporta rutas anidadas: {{cliente.nombre}}, {{items.0.descripcion}}
  └─ tablas repetidoras: si una fila contiene {{items.0.campo}},
     se clona por cada elemento de `items` y se reemplaza el índice
```

`formatValue` aplica formato local (`es-PE`): fechas `dd/mm/aaaa`, números con separador
de miles, importes con símbolo, booleanos como “Sí/No”, y `—` para valores vacíos.

Además de las variables de la plantilla, el render inyecta la variable de sistema
`{{numero_documento}}` con el `doc_number` del documento. Está disponible en el cuerpo,
la cabecera y el pie, y se rellena automáticamente al crear el documento; su clave está
reservada en `variableDefSchema`. Para compatibilidad, si la plantilla define `numero`,
el alta del documento precarga ese campo con el correlativo.

Para las vistas previas de plantillas, `sampleValues(schema)` genera valores de muestra
sin persistir nada: usa el valor por defecto si existe o un texto entre comillas angulares
(`«Etiqueta»`), con fechas, importes, opciones y filas de tabla de ejemplo. Así se ve la
plantilla con contenido representativo sin pedir datos al usuario.

### 6.2 HTML de documento (`buildDocumentHtml`)

Genera un documento completo y autocontenido:

- Variables CSS derivadas de `DesignTokens` (`--doc-font`, `--doc-leading`, `--doc-primary`,
  `--page-w`…). `lineHeight` es global por diseño y los títulos conservan `line-height: 1.25`.
- `@font-face` de **Georama** con los WOFF2 de `@fontsource/georama` incrustados en base64;
  el HTML es autocontenido y no consulta Google Fonts.
- Reglas `@page` para impresión y `.doc-page` para pantalla (fondo gris + sombra).
- Membrete (`letterhead`), logotipo (`logo.dataUrl`) y bandas de cabecera/pie ya
  resueltas con `renderChromeHtml()`.
- Variables `{{clave}}` interpoladas en las bandas y en el cuerpo; `{page}`/`{total}` se
  convierten en spans `pageNumber`/`totalPages` (en PDF se delega en las plantillas de
  `headerTemplate`/`footerTemplate` de Puppeteer).
- En modo `screen` la hoja es continua y las bandas se muestran una vez; `{page}`/`{total}`
  se sustituyen por `1`/`1`. La página es una columna flexible con el cuerpo en
  `flex: 1`; el pie queda anclado al borde inferior. El pie de la hoja (`doc-footer-band`)
  alinea su contenido al fondo para que el alto crezca hacia arriba.
- Modos `screen` (vista previa) y `print`/`forPdf` (sin márgenes duplicados ni sombra).
- `embed: true` elimina fondo, padding, margen y sombra de la hoja y fija `.doc-page` al
  alto real de la página; `.doc-body` se recorta con `overflow: hidden` para que la
  cabecera y el pie permanezcan visibles aunque el contenido supere una página. Es un
  recorte exclusivo de miniaturas: el HTML completo, el editor, el PDF y el DOCX conservan
  todo el contenido.

### 6.3 PDF

`backend/src/export/pdf.ts`:

1. Renderiza el HTML con `forPdf: true`.
2. Lanza Chrome (`CHROME_PATH`) con `puppeteer-core` en modo headless.
3. Espera a `document.fonts.ready` para que las fuentes embebidas (Georama) estén
   disponibles antes de paginar.
4. Calcula los márgenes: si hay bandas, reserva su `heightMm` (más el membrete y el
   logotipo) y activa `displayHeaderFooter`.
5. `page.pdf({ format, printBackground: true, margin, displayHeaderFooter })`.
6. Inyecta `buildPdfHeaderTemplate` / `buildPdfFooterTemplate` con la cabecera/pie
   resueltos y los spans de numeración real. `chromeBandStyle()` aplica `widthPercent`
   sobre el ancho de página. Como Chrome inserta un pequeño margen interno en sus
   plantillas, `pdfChromeOffsetStyle()` desplaza directamente `.doc-chrome` para que la
   cabecera y el pie toquen los bordes reales de la hoja.
7. Devuelve un `Buffer` y registra la versión de exportación.

Concurrencia: se reutiliza una única instancia de navegador y se crea una pestaña por
exportación; si Chrome no está disponible, la API responde con un error explicativo.

### 6.4 DOCX

`backend/src/export/docx.ts` traduce el árbol TipTap a `docx`:

| Nodo/marca TipTap | DOCX |
| --- | --- |
| `heading` 1–4 | `HeadingLevel.HEADING_1…4` |
| `paragraph` | `Paragraph` con estilos del diseño |
| `bulletList` / `orderedList` | `bullet` / `numbering` |
| `table` / `tableRow` / `tableCell` | `Table` con bordes y cabecera coloreada |
| `image` | `ImageRun` desde data URL; si flota, `floating` con `wp:anchor`, `wrapSquare` o `behindDoc` y posición en EMU |
| `bold/italic/underline/strike/code/highlight/color` | `TextRun` con propiedades |
| `blockquote` | Párrafo con sangría y borde |
| `horizontalRule` | Párrafo con borde inferior |

Los márgenes, el tamaño de página, la tipografía y el interlineado provienen de
`DesignTokens`. El estilo `Normal` usa `fontFamily` (nombre corto, p. ej. `Georama`) y
`spacing.line = lineHeight × 240`; DOCX no incrusta el archivo de fuente, por lo que Word
o LibreOffice necesitan tenerla instalada. La cabecera y el pie se generan con
`chromeBlocks()`/`inlineRuns()`: el contenido va en
`Header`/`Footer` y `{page}`/`{total}` se traducen a los campos `PAGE`/`NUMPAGES` de Word.
Cuando la banda no ocupa el 100 % del ancho de página, `chromeBlocksWithWidth()` la
envuelve en una tabla de una celda, sin bordes ni márgenes, del ancho efectivo y centrada;
así la banda puede llegar hasta los bordes de la hoja. Las imágenes globales de banda se añaden con
`bandImageParagraphs()` como dibujos flotantes (`wp:anchor`) con posición absoluta en la
página, desplazadas por `(contentWidthMm - bandWidthMm)/2`, de modo que siguen el mismo
centro que la banda y Word las repite con el encabezado/pie. Para evitar solapamientos,
el exportador reserva el alto de banda y el membrete en los márgenes superior/inferior,
de forma equivalente al PDF; con imágenes de pie añade además un pequeño margen de
seguridad para que el texto no invada el cuerpo.

### 6.5 HTML de exportación

Se genera con `renderToHTMLString` de `@tiptap/static-renderer` dentro de
`buildDocumentHtml`, aplicando el mismo CSS del diseño, sin dependencias externas y con
Georama incrustada en base64: útil para archivar, enviar por correo o publicar sin
Google Fonts.

### 6.6 Resolución de cabecera/pie en exportación

`backend/src/modules/exports/routes.ts` carga el documento, su plantilla y su diseño y
llama a `resolveDocumentChrome()`:

```text
document.header/footer
   └─ si null → template.header/footer
        └─ si null → chromeFromDesign(design.tokens)
             └─ DEFAULT_DESIGN_TOKENS
```

El resultado se pasa a los tres exportadores. En el HTML de una versión histórica se usa
la instantánea de las **sobrescrituras del documento** guardada en `document_versions`.
Si esa versión heredaba la banda, se resuelve con la plantilla y el diseño actuales; para
una fidelidad histórica total habría que guardar también el `ResolvedChrome` en la
instantánea (deuda pendiente).

---

## 7. Frontend

### 7.1 Rutas

| Ruta | Vista | Guarda |
| --- | --- | --- |
| `/login` | `LoginView` | Solo invitados. |
| `/` | `HomeView` | Autenticado. |
| `/documents` | `DocumentsView` | Autenticado. |
| `/documents/:id` | `DocumentEditorView` | Autenticado + permiso. |
| `/templates` | `TemplatesView` | Autenticado. |
| `/templates/:id` | `TemplateEditorView` | Autenticado (edición si owner/admin). |
| `/designs` | `DesignsView` | Autenticado. |
| `/designs/:id` | `DesignEditorView` | Autenticado (edición si owner/admin). |
| `/settings` | `SettingsView` | Autenticado (IA solo admin). |

`AppShell` aporta la navegación lateral, el buscador global y el menú de usuario.

### 7.2 Estado

- **Pinia** solo para sesión (`stores/auth.ts`) y notificaciones (`stores/toasts.ts`).
- El estado del editor es local a la vista: `document`, `data`, `schema`, `dirty`,
  `saving`, `version`, `conflict`.
- El editor de Diseño añade estado local para `panelOpen`, `zoom`, `lockAspect` y el
  viewport de la hoja (`canvasViewport`); los tokens siguen siendo la única fuente de
  verdad y se sincronizan con `DesignPreview` mediante `v-model`/eventos.
- Cabecera/pie añade `chromeOpen`, `activeChrome` (`body`/`header`/`footer`),
  `headerConfig`/`footerConfig`, `inheritedChrome` y el flag `syncingChrome`. Los dos
  editores TipTap de banda son independientes del cuerpo y la toolbar trabaja sobre el
  editor activo.
- No hay caché global de documentos: cada vista carga lo que necesita (`api.get`).

### 7.3 Editor TipTap

`createEditorExtensions()` (en `shared`) define el esquema **compartido**:

```ts
StarterKit (heading 1–4, listas, blockquote, codeBlock, horizontalRule, link)
+ ExtendedTable, TableRow, ExtendedTableHeader, ExtendedTableCell
+ ExtendedImage, TextAlign, TextStyleKit, Highlight, Subscript, Superscript
+ Typography, UniqueID, CharacterCount, Placeholder
```

#### Imágenes A+B

`ExtendedImage` extiende el nodo `image` con atributos de presentación:
`width`/`height`, `float` (`none` | `left` | `right` | `behind`), `align`
(`left` | `center` | `right`), `offsetX` y `offsetY`. `imageStyle()` genera un
`style` inline que es la **única fuente de verdad**, de modo que editor, vista
previa, PDF y HTML coinciden sin CSS duplicado.

- **A (maquetación):** tiradores de esquina (`ResizableNodeView` de TipTap),
  tamaños predefinidos y alineación de bloque (izquierda/centro/derecha).
- **B (flotante):** `float:left`/`float:right` con ajuste de texto cuadrado y
  arrastre libre que actualiza `offsetX`/`offsetY`. `behind` se saca del flujo
  (`position:absolute` + `z-index:-1`) para que el texto pase por encima; al
  activarlo se conserva la posición actual de la imagen.
- En DOCX, los modos flotantes se traducen a un ancla (`wp:anchor`) con
  `wrapSquare` (izquierda/derecha) o `behindDoc` (detrás), con posiciones
  convertidas de px a EMU (1 px ≈ 9525 EMU).

La vista de nodo vive en `shared/src/image-node-view.ts` y solo se
instancia en el navegador (`typeof document !== 'undefined'`), por lo que el
renderizador del servidor reutiliza el mismo esquema sin depender del DOM.

#### Tablas

`createEditorExtensions()` sustituye `TableKit` por `ExtendedTable`, `TableRow`,
`ExtendedTableHeader` y `ExtendedTableCell`. Los atributos nuevos son opcionales para no
romper documentos existentes y se comparten entre editor y exportadores:

| Nivel | Atributos |
| --- | --- |
| Tabla | `tableWidth`, `tableAlign`, `borderColor`, `borderWidth`, `borderStyle`, `cellPadding`, `tableBackground` |
| Celda / cabecera | `backgroundColor`, `verticalAlign`, `padding` (además de `colspan`, `rowspan` y `colwidth` de TipTap) |

`ExtendedTable` guarda los atributos como `data-*` y genera variables CSS
(`--sd-table-border`, `--sd-table-padding`, `--sd-table-bg`); el fondo y la alineación de
cada celda se escriben inline. `render.ts` aplica ese mismo HTML al PDF/HTML, por lo que
bordes, padding, fondos y celdas combinadas se ven igual que en el editor.

La barra contextual (`TableToolbar.vue`) es una segunda fila de la toolbar que aparece
cuando la selección está dentro de una tabla. Usa los comandos de TipTap
(`addRowBefore`/`addRowAfter`, `deleteRow`, `addColumnBefore`/`addColumnAfter`,
`deleteColumn`, `toggleHeaderRow`/`toggleHeaderColumn`, `mergeCells`, `splitCell`,
`setCellAttribute`, `updateAttributes('table')`) y añade la distribución uniforme de
columnas. `TableInsertMenu.vue` ofrece una cuadrícula de 1×1 a 8×8 y la opción de cabecera.

En DOCX, `tableFrom()` traduce `colspan`/`rowspan` a `gridSpan`/`vMerge`, conserva anchos,
alineación, bordes, padding y fondos por celda, y marca las filas de cabecera con
`tblHeader` para que se repitan al cruzar páginas. El fondo de tabla se aplica a cada celda
porque `ITableOptions` de `docx` no expone `shading`.

#### Imágenes globales de cabecera/pie

`DesignEditorView.vue` divide el editor en un panel de ajustes de **400 px** y una **hoja de
trabajo** ampliable. La hoja admite zoom del **35 al 250 %**, “Ajustar ancho”, “100 %”,
desplazamiento con scroll y ocultación del panel. `DesignPreview.vue` se monta en modo
`interactive`, dibuja las franjas de cabecera/pie con guías, ancla el pie al pie real de la
hoja y añade ocho tiradores por imagen. Las esquinas conservan la proporción cuando el
candado está activo; los tiradores laterales estiran libremente. El movimiento y el
redimensionado quedan limitados a la franja.

El panel (`DesignBandImages.vue`) activa la banda, ajusta su alto y ancho, sube hasta **20
imágenes** y muestra miniaturas; al seleccionar una miniatura aparecen los campos
X/Y/ancho/alto para ajustes finos. La franja se dibuja con la relación de aspecto real
(ancho efectivo × `heightMm`) y cada imagen se posiciona con `bandImageStyleMm()` en
milímetros, de modo que la hoja y la vista previa coinciden. El ancho efectivo es
`anchoDePágina × widthPercent / 100`, así que con `100 %` las imágenes pueden ocupar toda
la hoja. Al guardar se persisten esos milímetros
(`BandImage.xMm/yMm/widthMm/heightMm`) y `PageChromeBand` los reutiliza. El servidor replica
el mismo cálculo en `render.ts` (HTML/PDF) y `docx.ts` (anclas flotantes). Las bandas
globales se heredan mediante `resolveChrome()`.

Extensiones propias del cliente:

- `VariableHighlight` (`lib/variable-highlight.ts`): plugin de ProseMirror que decora
  `{{clave}}` con la clase `.doc-var`. Son **decoraciones**, no texto: no se guardan ni se
  exportan.
- Barra de herramientas (`EditorToolbar.vue`): como TipTap 3 no re-renderiza en cada
  transacción, un contador `tick` se incrementa con `transaction`/`selectionUpdate` y los
  `computed` lo referencian para refrescar estados activos (negrita, tabla, alineación…).
- `FindReplacePanel.vue`: recorre los nodos de texto, calcula posiciones absolutas y usa
  `setTextSelection` / `insertContentAt`. El foco **no** se mueve al editor mientras se
  escribe (evita que la búsqueda acabe dentro del documento); “Reemplazar todo” itera de
  atrás hacia delante para no invalidar posiciones.
- `VersionHistoryPanel.vue`: lista versiones, compara contra la actual con diff por
  palabras (`lib/diff.ts`), previsualiza el HTML de una versión y restaura.
- `VariablePanel.vue`: formulario generado por tipo, validación de obligatorios, ayudas
  de IA y botón **Rellenar con IA**.

#### Cabecera y pie

`PageChromeBand.vue` es la banda reutilizable (cabecera/pie) que se monta sobre la hoja
siempre que la banda esté habilitada, también en modo lectura. Recibe el editor TipTap de
esa banda, la configuración efectiva y su origen, y emite `toggle` (mostrar/ocultar),
`height` (alto en mm), `width` (ancho respecto a la página) y `reset` (volver a heredar).
La prop `showBar` oculta la barra de controles cuando no se está editando; en ese caso la
banda queda como vista previa, sin foco ni edición. La prop `own` distingue
“Personalizado” de “Heredado” según el nivel que se está editando, porque en una plantilla
una banda propia también proviene de `template`.

- **Documento**: `headerConfig`/`footerConfig` son la configuración propia o, si no
  existe, la heredada. Al escribir se crea una sobrescritura y se activa la banda
  automáticamente. “Usar el heredado” vuelve a `null` y recarga la banda desde
  `inheritedChrome`.
- **Plantilla**: las bandas se resuelven contra el diseño seleccionado. Al cambiar de
  diseño, `syncInheritedChrome()` actualiza las bandas que no tienen sobrescritura sin
  pisar las personalizadas.
- **Modo lectura**: `showHeaderBand`/`showFooterBand` incluyen las bandas habilitadas
  aunque `chromeOpen` esté cerrado. La hoja recibe `has-chrome-bands`, que activa el
  layout flexible y ancla el pie; los editores de banda se marcan como no editables.
  `onChromeUpdate` ignora las actualizaciones que no provienen de la banda activa para
  que cambiar `editable` no cree una sobrescritura ni marque el documento como sucio.
- La toolbar inserta variables `{{clave}}` y, fuera del cuerpo, los tokens
  `{page}`/`{total}`. El editor activo decide el destino; el foco de la banda actualiza
  `activeChrome`.
- Los títulos y ayudas son explícitos: la cabecera/pie de la plantilla se guarda en la
  plantilla; la del documento se guarda en el documento. El diseño sigue aportando sus
  bandas históricas como último nivel de herencia.

### 7.4 Autoguardado

```text
Cambio en título / datos / editor
        │ markDirty()
        ▼
  debounce 1400 ms ──► save()  (PUT /content con expectedVersion)
        │                        ├─ 200 → version = nueva; dirty = false
        │                        └─ 409 → conflict = true (aviso al usuario)
        ▼
  indicador: "Guardando…" → "Guardado ahora mismo"
```

`beforeunload` avisa si hay cambios pendientes. Al salir de la ruta se fuerza un guardado.
El botón **Guardar punto de control** envía `checkpoint: true` y crea una versión `manual`.
El editor de plantillas usa guardado manual (botón **Guardar**), pero incluye las bandas
de cabecera/pie en el mismo `PATCH` y versiona la instantánea completa.

### 7.5 Vista previa

**Documentos.** El botón del ojo guarda si hay cambios y pide
`GET /api/documents/:id/html?preview=1` (vista previa dentro de la app, sin exigir
permiso de exportación); el HTML se muestra en un `<iframe sandbox srcdoc>`. Si el
usuario edita datos con la vista previa abierta, un *debounce* de 900 ms vuelve a guardar
y refrescar el iframe. Esto da una previsualización casi en vivo sin duplicar el motor de
render en el cliente.

Las tarjetas de **Documentos** e **Inicio → Documentos recientes** usan
`DocumentPreview.vue`: piden `GET /api/documents/:id/html?embed=1` con carga diferida
(`IntersectionObserver`), cachean el HTML por `id`/versión/`updatedAt` del documento y
`designUpdatedAt` (para invalidar la caché si cambian las imágenes globales), y muestran
`DocumentThumbnail` como *fallback* si la petición falla. Así el listado enseña el
documento real, no una miniatura genérica, y el número de iframes se limita a las tarjetas
visibles.

**Plantillas.** `TemplatePreview.vue` pide `GET /api/templates/:id/preview` con
`embed=1` y muestra el HTML a escala dentro de la tarjeta de la lista. El endpoint acepta
`designId=<uuid>` para previsualizar un diseño alternativo y `designId=none` para
**Sin diseño**. Los resultados se cachean en memoria por plantilla/diseño/versión y fecha
de actualización del diseño. En el editor de plantilla, el botón del ojo envía el
borrador actual a `POST /api/templates/preview` (sin guardar ni versionar) y muestra el
HTML a pantalla completa.

Al crear una plantilla, `NewTemplateDialog.vue` carga los diseños con `GET /api/designs`
y muestra `DesignPreview` para cada uno. Al confirmar navega a `/templates/new?designId=…`
y `TemplateEditorView` aplica ese diseño antes de mostrar el lienzo. El flujo de creación
de documentos es directo: las tarjetas de Inicio y el botón **Usar** llaman a
`POST /api/documents` con `templateId` y abren el editor.

La vista previa usa una hoja continua: la cabecera y el pie aparecen **una vez** en su
posición natural, el pie queda **anclado al borde inferior** y `{page}`/`{total}` se
muestran como `1`/`1`. La repetición en cada página y la numeración real solo se producen
al exportar PDF/DOCX.

### 7.6 Canal de eventos en tiempo real

La bandeja avisa sin recargar: cuando un envío se crea, se aprueba, se rechaza o se
cancela, el navegador recibe un aviso y actualiza el badge y la lista.

**Servidor** (`backend/src/modules/realtime/`):

- `routes.ts` expone `GET /api/ws`. El handshake se autentica con la cookie httpOnly
  `sd_access` —el navegador no puede mandar cabeceras en un WebSocket— o, como
  alternativa, con `?token=`. El origen se comprueba a mano (CORS no aplica al
  handshake) y el estado de la cuenta, en la base local. Sin sesión se cierra con
  **4401**; con un origen no permitido, con **4403**.
- `hub.ts` mantiene las conexiones agrupadas por usuario, reparte cada evento solo a sus
  destinatarios, manda un *ping* cada 30 s para detectar conexiones muertas y comprueba
  cada 5 min que las cuentas de los conectados sigan activas.
- `events.ts` publica con `pg_notify` en el canal `sirpefoffice_realtime`. Se usa
  PostgreSQL y no un emisor en memoria porque los scripts de la aplicación (demo, humo,
  siembra) escriben en la bandeja conectándose directamente a la base de datos: con un
  emisor en memoria sus cambios no llegarían al navegador. La escucha usa una conexión
  propia, aparte del pool de consultas, y se reintenta sola si la base no está lista.

**Cliente** (`frontend/src/composables/useRealtime.ts`): una única conexión por sesión,
abierta en el componente raíz cuando hay sesión y cerrada al cerrarla (no en `AppShell`,
que se remonta en cada ruta). Se reconecta sola con espera creciente y al volver a la
pestaña. Los suscriptores reciben el evento y piden los datos con la API de siempre: el
evento solo dice *qué* ha cambiado, así que no hay dos versiones de la forma de un
mensaje.

Eventos (`shared/src/realtime.ts`): `connection.ready`, `inbox.message.created`,
`inbox.message.pending`, `inbox.message.approved`, `inbox.result.approved`,
`inbox.result.rejected` e `inbox.message.cancelled`.

**Proxy.** El canal viaja por `/api/`, así que el proxy de producción tiene que reenviar
el *upgrade*: Nginx necesita `proxy_set_header Upgrade` y `proxy_set_header Connection`
(ya está en `deploy/nginx/`), Caddy lo hace solo y el proxy de Vite necesita `ws: true`.

Verificación: `npm run smoke:realtime` (levanta la API y comprueba handshake, aislamiento
por destinatario y el flujo envío → aviso → aprobación → aviso) y
`npm run smoke:realtime:proxy` (el mismo canal a través del proxy de la web).

---

## 8. Asistente de IA

### 8.1 Configuración

- Tabla `app_settings` (`key = 'ai'`): `{ provider, baseUrl, model, temperature, maxTokens, apiKey }`.
- Prioridad: **BD > variables de entorno**. `GET /api/ai/status` devuelve
  `{ configured, provider, model }`; `GET/PUT /api/ai/settings` nunca serializa `apiKey`
  (solo `hasApiKey`).
- `POST /api/ai/test` hace una llamada mínima al proveedor y mide latencia.

### 8.2 Generación

```text
POST /api/documents/:id/ai/generate  { overwrite?: boolean }
  ├─ carga documento + esquema de variables + valores actuales
  ├─ construye un prompt con: tipo de documento, título, variables (key, label, type,
  │  required, description, aiHint) y valores ya presentes
  ├─ exige JSON estricto { "clave": "valor", … }
  ├─ normaliza/coacciona tipos (fechas ISO, números, importes, booleanos, tablas)
  ├─ mezcla solo las claves del esquema (nunca inventa campos)
  ├─ guarda data + nueva versión (`kind = 'ai'`) y devuelve { data, filled, version }
  └─ el cliente actualiza `version` para no provocar un 409
```

El cuerpo y el formato del documento **no se modifican**: la IA solo rellena el
formulario. Si el proveedor no está configurado, la ruta responde `400 AI_NOT_CONFIGURED`
con un mensaje claro y la UI oculta el botón (`aiConfigured === false`).

### 8.3 Proveedores

| Proveedor | Endpoint | Notas |
| --- | --- | --- |
| `openai` | `POST {baseUrl}/chat/completions` | Compatible con Azure, OpenRouter, LM Studio, vLLM… |
| `anthropic` | `POST https://api.anthropic.com/v1/messages` | Cabecera `anthropic-version`. |
| `gemini` | `POST …/v1beta/models/{model}:generateContent` | `responseMimeType: application/json`. |
| `ollama` | `POST {baseUrl}/api/chat` | `format: 'json'`, sin clave. |

Todas las llamadas tienen *timeout* y errores normalizados (`AI_TIMEOUT`, `AI_ERROR`).

---

## 9. API

Base: `/api`. Autenticación: `Authorization: Bearer <accessToken>` salvo en login/refresh.

| Método | Ruta | Descripción |
| --- | --- | --- |
| `GET` | `/health` | Estado del servicio. |
| `GET` | `/ws` | Canal de eventos en tiempo real (WebSocket). Autentica el handshake con la cookie de sesión o `?token=`; ver 7.6. |
| `POST` | `/auth/register` | Registro; el primer usuario del sistema es `admin`, el resto `member`. |
| `POST` | `/auth/login` | Login; devuelve usuario + access token y cookie refresh. |
| `POST` | `/auth/refresh` | Rota el refresh token y emite un access nuevo. |
| `POST` | `/auth/logout` | Revoca la sesión. |
| `GET/PATCH` | `/auth/me` | Perfil; permite cambiar nombre, avatar y contraseña. |
| `GET` | `/auth/users` | Lista de usuarios (para compartir). |
| `GET/POST` | `/documents` | Listado con filtros y creación desde plantilla (`designId` omitido = heredar; `null` = sin diseño). |
| `GET/PATCH/DELETE` | `/documents/:id` | Detalle (incluye `header`/`footer`, `chrome` e `inheritedChrome`), metadatos/estado, borrado. |
| `PUT` | `/documents/:id/content` | Guardado con versión esperada; acepta `header`/`footer` (`null` = heredar). |
| `GET` | `/documents/:id/versions` | Historial. |
| `GET` | `/documents/:id/versions/:version` | Contenido de una versión. |
| `GET` | `/documents/:id/versions/:version/html?embed=1` | HTML de una versión; `embed=1` lo prepara para miniaturas. |
| `POST` | `/documents/:id/restore/:version` | Restaura (crea versión `restore`). |
| `POST/DELETE` | `/documents/:id/shares[/:userId]` | Compartir / revocar. |
| `GET` | `/documents/:id/activity` | Actividad. |
| `GET` | `/documents/:id/html?embed=1` | Documento renderizado con datos; `embed=1` lo prepara para miniaturas (cualquier lector). |
| `GET` | `/documents/:id/html?preview=1` | Vista previa dentro de la app (cualquier lector). |
| `GET` | `/documents/:id/html` | Documento completo: exige permiso de exportación. |
| `GET` | `/documents/:id/export/:format` | `pdf`, `docx`, `html`. Exige permiso de exportación: el administrador según las reglas del envío; el asistente solo con `allow_sender_export`. |
| `GET` | `/inbox?scope=received\|sent\|approved\|rejected&filter=all\|pending\|sent&status=all\|pending_approval\|sent\|rejected\|cancelled` | Bandeja paginada. `sent` incluye los envíos propios y los memos aprobados/rechazados por el usuario. `filter` solo aplica a `received`; `status` solo a `sent`. `pending` requiere administrador. |
| `GET` | `/inbox/unread-count` | Contadores de no leídos, pendientes de aprobación y resultados propios sin ver, con desglose `sections` (Recibidos, Enviados, Aprobados, Rechazados) y el último resultado. |
| `GET` | `/inbox/:id` | Detalle del mensaje, destinatarios y memo adjunto. |
| `POST` | `/inbox` | Crea el envío: `pending_approval` para `member`, envío directo para `admin`. |
| `POST` | `/inbox/:id/approve` | El jefe aprueba, sella el memo y lo envía. |
| `POST` | `/inbox/:id/reject` | Rechaza con motivo. Acepta `allowEdit` (por defecto `true`): con edición el memo vuelve a borrador; sin edición queda cerrado y bloqueado. |
| `POST` | `/inbox/:id/cancel` | El remitente cancela un envío pendiente. |
| `PATCH` | `/inbox/:id` | `read` para el destinatario o `resultRead` para el remitente (aprobado/rechazado visto). |
| `GET/POST` | `/templates` | Listado y creación (acepta `header`/`footer` y `numbering`). |
| `GET/PATCH/DELETE` | `/templates/:id` | Detalle con `chrome`/`inheritedChrome` y edición de bandas y numeración. |
| `GET` | `/numbering` | Series de numeración con su último emitido y próximo número (la serie se identifica por su `id`). |
| `PUT` | `/numbering/:seriesId` | Ajusta el número inicial, los dígitos o el reinicio anual; no permite bajar del último emitido. |
| `GET` | `/templates/:id/preview?designId=<uuid\|none>&embed=1` | Vista previa HTML con datos de muestra y diseño opcional. |
| `POST` | `/templates/preview` | Vista previa HTML de un borrador del editor, sin guardar. |
| `POST` | `/templates/:id/clone` | Duplicar. |
| `GET` | `/templates/:id/versions` | Versiones de plantilla. |
| `GET/POST` | `/designs` | Listado y creación. |
| `GET/PATCH/DELETE` | `/designs/:id` | Detalle y edición. |
| `POST` | `/designs/:id/clone` | Duplicar. |
| `GET` | `/ai/status` | ¿Hay IA configurada? |
| `GET/PUT` | `/ai/settings` | Configuración (admin). |
| `DELETE` | `/ai/key` | Borra la clave. |
| `POST` | `/ai/test` | Prueba de conexión. |
| `POST` | `/documents/:id/ai/generate` | Rellena variables con IA. |

Errores uniformes:

```json
{ "error": "CONFLICT", "message": "El documento se modificó en otra sesión",
  "details": { "currentVersion": 7, "updatedAt": "2026-10-22T15:02:11.000Z" } }
```

El handler global (`backend/src/lib/errors.ts`) traduce cada origen de fallo a
un mensaje que el usuario pueda entender. Nunca se devuelve un «error interno
del servidor» genérico: si el fallo no se puede explicar, se devuelve un 500
con una **referencia corta** (`reference`) que permite rastrearlo en el log
del servidor sin filtrar detalles técnicos.

| Origen | HTTP | Código | Mensaje para el usuario |
| --- | --- | --- | --- |
| Validación (Zod) | 400 | `VALIDATION_ERROR` | Nombra los campos: «Datos inválidos: correo (Correo inválido).» |
| Datos repetidos | 409 | `EMAIL_TAKEN`, `DOC_NUMBER_CONFLICT`, `SEND_ALREADY_PENDING`… | «Ya existe una cuenta con ese correo.» |
| Referencia borrada | 409 | `REFERENCED_RECORD_MISSING` | «La operación apunta a un registro que ya no existe.» |
| Body > 25 MB | 413 | `PAYLOAD_TOO_LARGE` | «El contenido enviado supera el límite de 25 MB.» |
| Content-Type inválido | 415 | `UNSUPPORTED_MEDIA_TYPE` | «La petición debe enviarse con contenido JSON.» |
| Demasiadas peticiones | 429 | `RATE_LIMITED` | «Has hecho demasiadas peticiones seguidas. Espera 60 segundos.» |
| Base de datos caída | 503 | `DATABASE_UNAVAILABLE` | «No se pudo conectar con la base de datos.» |
| Servicio externo caído | 503 | `SERVICE_UNREACHABLE`, `AI_UNREACHABLE`, `CHROME_MISSING` | Explica qué servicio falla y qué hacer. |
| Error inesperado | 500 | `INTERNAL_ERROR` | «Ocurrió un fallo al procesar la solicitud… (ref. `a1b2c3d4`).» |

Los mensajes de validación de Zod se traducen al español mediante un mapa
global (`backend/src/lib/validation.ts`); los que cada esquema define
explícitamente tienen prioridad sobre ese mapa.

---

## 10. Seguridad

| Riesgo | Mitigación |
| --- | --- |
| Robo de refresh token | Hash en BD, rotación en cada uso, revocación en logout, cookie httpOnly. |
| Fuerza bruta | *Rate limit* en login/registro + contraseñas scrypt. |
| XSS en vista previa | Iframe con `sandbox` y HTML generado en servidor (el contenido del editor se serializa como nodos, no como HTML crudo). |
| Inyección SQL | Drizzle con consultas parametrizadas; Zod valida entrada. |
| Escalada de privilegios | `assertDocument` + comprobación de rol en rutas de administración. |
| Fuga de claves de IA | La clave solo se lee en el servidor; nunca se devuelve al cliente. |
| Fuerza bruta de correlativos | `INSERT … ON CONFLICT DO UPDATE` transaccional. |
| CSRF | Cookies `sameSite=lax` + token Bearer en cabecera para escrituras. |

Recomendaciones de producción: HTTPS detrás de proxy, secretos de 32 bytes, backups
diarios de PostgreSQL, rotación de claves, límite de tamaño de subida a nivel de proxy y
`CHROME_PATH` apuntando a un binario controlado.

---

## 11. Pruebas y verificación

| Nivel | Herramienta | Cobertura |
| --- | --- | --- |
| Tipos | `cd backend && npm run typecheck` + `cd frontend && npm run typecheck` | Backend (`tsc`) y frontend (`vue-tsc`). |
| Build | `cd backend && npm run build` + `cd frontend && npm run build` | `tsc` del backend y bundle de Vite del frontend. |
| Humo UI | `cd backend && node scripts/ui-smoke.mjs` | Login, inicio, previews reales de documentos, documentos, plantillas, editor de plantilla, diseños, hoja de Diseño con bandas editables, inserción de tabla y unión de celdas, ajustes, creación de documento, autoguardado, historial, datos, vista previa y buscar/reemplazar. Falla si hay errores de consola. |
| Humo de errores | `cd backend && npm run smoke:errors` + `npm run smoke:errors:db` | Que cada origen de fallo (validación, duplicados, clave foránea, uuid inválido, error desconocido) devuelva el estado y el mensaje correctos, en español y sin filtrar detalles internos. |
| Imágenes A+B | `cd backend && node scripts/image-smoke.mjs` | Inserción, arrastre, redimensionado, flotado, alineación, persistencia y exportación PDF/DOCX con imagen. |
| Cabecera/pie | `cd backend && node scripts/chrome-smoke.mjs` | Pie visible y anclado en modo lectura, herencia documento → plantilla → diseño, edición con imagen y tokens, alto y ancho, persistencia, restablecimiento, cambio de diseño de una plantilla y exportación. |
| Exportación | `pdftotext` / `pdfimages` / `unzip` | Verifica datos interpolados, bandas, numeración real, imágenes embebidas y campos `PAGE`/`NUMPAGES` en DOCX. |
| Tiempo real | `cd backend && npm run smoke:realtime` + `npm run smoke:realtime:proxy` | El handshake acepta la cookie de sesión y rechaza al que no la tiene, un aviso solo llega a su destinatario y el envío y la aprobación de un documento avisan sin recargar. |

Las capturas de las pruebas se guardan en `/tmp/sirpefoffice-shots`, `/tmp/sirpefoffice-shots-images` y
`/tmp/sirpefoffice-shots-chrome` (y una selección en `docs/capturas`).

La prueba de cabecera/pie añade contenido para forzar varias páginas, comprueba que la
numeración del PDF (`Página 1 de N`, `Página 2 de N`…) coincide con el total real y
confirma que el DOCX incluye `header1.xml`/`footer1.xml`, la imagen de cabecera y los
campos de página. Los datos temporales se eliminan al finalizar.

---

## 12. Deuda técnica y hoja de ruta

Prioridad alta:

1. **Comentarios**: la tabla `comments` ya existe; falta la UI de anclaje por marca de
   texto y el panel lateral.
2. **Control de cambios**: marcas `insert`/`delete` con autor y fecha, aceptar/rechazar y
   diff contra la versión base.
3. **Fragmentación fina de bloques largos**: editor, HTML, impresión, PDF y DOCX ya
   comparten el modelo de hojas por bloques (párrafos, tablas e imágenes se mantienen
   completos). Falta partir párrafos/tablas que superan una hoja para que el conteo
   coincida exactamente en esos casos extremos.
4. **Pruebas automatizadas de API**: hoy la verificación es manual + humo de UI.

Prioridad media:

5. Colaboración en tiempo real (Yjs + WebSocket) manteniendo el versionado como respaldo.
6. Historial de cambios por campo (quién cambió qué variable y cuándo).
7. Programación de exportaciones y envío por correo.
8. Firma electrónica (sello de tiempo / PDF firmado).
9. Internacionalización de la UI (hoy en español).
10. Importación `.docx` (fuera de alcance por decisión de producto).
11. **Primera página distinta**: Chrome no permite un encabezado distinto por página en el
    PDF; la alternativa inmediata es DOCX o un PDF post-procesado.
12. **Editor enriquecido de bandas del diseño**: el diseño ya admite alto de banda e
    imágenes globales, pero conserva su formato histórico (cabecera JSON + pie de
    texto/flags). Falta unificar el contenido rico del diseño con `ChromeConfig` para
    editar texto/formatos de banda en el mismo lugar que las imágenes.

---

## 13. Operación

- **Logs**: Fastify con `pino`; en desarrollo `tsx watch` reinicia al guardar.
- **Migraciones**: desde `backend/`, `npm run db:generate` (Drizzle Kit) y
  `npm run db:migrate`; el SQL vive en `backend/drizzle/`. La migración de datos de
  cabecera/pie al ancho de página se ejecuta con `npm run db:migrate:fullwidth`
  (idempotente, guarda una copia en `backend/data/backups/`).
- **Seed**: desde `backend/`, `npm run db:seed` crea admin si no existe, 3 diseños y
  8 plantillas. `npm run admin:reset` alinea las credenciales del administrador con el
  seed después de migrar una base antigua.
- **Backups**: `pg_dump` del contenedor `sirpefoffice-postgres`; los archivos exportados son
  temporales y no necesitan respaldo.
- **Escalado**: la API es *stateless* (JWT + BD), por lo que puede replicarse detrás de un
  balanceador; el límite está en Chrome para PDF (una instancia por réplica o un servicio
  de render aparte).
