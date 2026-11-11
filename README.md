# SirpefOffice

Sistema de documentos tipo Word / Google Docs construido con **Node.js + Vue 3 + TipTap**.
Permite crear memorándums, notas de entrega, informes, actas, certificados y otros
documentos a partir de **plantillas reutilizables** con **diseños editables**,
rellenar variables, generar una **vista previa fiel**, exportar a **PDF / DOCX / HTML**
y conservar el **historial de versiones** de cada documento.

> Demo local: `http://localhost:5173` · API en `http://localhost:3101/api`
> Usuario inicial: `admin@sirpefoffice.local` / `sirpefoffice`

![Pantalla de acceso](docs/capturas/01-acceso.png)

## Contenido

- [Características](#características)
- [Stack técnico](#stack-técnico)
- [Puesta en marcha](#puesta-en-marcha)
- [Uso rápido](#uso-rápido)
- [Variables y numeración automática](#variables-y-numeración-automática)
- [Tipografía e interlineado](#tipografía-e-interlineado)
- [Cabecera y pie](#cabecera-y-pie)
- [Tablas](#tablas)
- [Vista previa de documentos](#vista-previa-de-documentos)
- [Vista previa de plantillas](#vista-previa-de-plantillas)
- [Asistente de IA](#asistente-de-ia)
- [Exportación](#exportación)
- [Scripts disponibles](#scripts-disponibles)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Seguridad](#seguridad)
- [Limitaciones conocidas](#limitaciones-conocidas)
- [Documentación](#documentación)

## Características

| Área | Qué incluye |
| --- | --- |
| Plantillas | 8 plantillas iniciales (memorándum, nota de entrega, informe, acta, plan de evaluación, currículum, carta/oficio y certificado), clonado, versiones de plantilla y variables tipadas. La lista muestra una **vista previa real** renderizada en servidor con datos de ejemplo. Las plantillas se **comparten por personas** (`editor`/`viewer`): el propietario invita a quien quiera y un **editor puede mejorar la plantilla directamente** (los cambios se aplican a la original y quedan en el historial con su nombre). Las plantillas marcadas como compartidas con todo el mundo se pueden usar y duplicar por cualquiera. |
| Crear desde plantilla | Al pulsar una tarjeta de **Inicio** o **Usar** en **Plantillas**, el documento se crea directamente con el diseño de la plantilla y se abre el editor. Sin modal intermedio. |
| Nueva plantilla | Al crear una plantilla se abre una modal para elegir el diseño inicial, con vista previa y opción **Sin diseño**. Después se abre el editor con ese diseño cargado. |
| Diseños | 3 diseños iniciales + editor visual con **hoja de trabajo ampliable**: tipografía (incluida **Georama** autoalojada), tamaño, **interlineado global con presets y valor personalizado**, colores, formato de página (A4/Letter/Legal/Folio), orientación, márgenes, membrete, logotipo, encabezado y pie con `{page}` / `{total}`. La cabecera y el pie admiten **alto y ancho configurables** (hasta el 100 % del ancho de página) e **imágenes globales** colocadas en milímetros, con arrastre, redimensionado, modos **Ajustar/Estirar** y anclaje a los bordes superior e inferior, directamente sobre la hoja, con zoom, desplazamiento y panel ocultable. |
| Diseño en uso | Cada cuenta tiene **un único diseño en uso** (un interruptor en la tarjeta de **Diseños**): es el con el que se dibujan **todas las plantillas**. Al encender otro se apaga el anterior, así que cambiar de aspecto (Navidad → año nuevo) es un clic y **no obliga a rehacer ninguna plantilla**. Los documentos ya creados **conservan el diseño con el que nacieron**. |
| Editor | TipTap 3 con barra de herramientas tipo cinta: estilos de párrafo, negrita/cursiva/subrayado/tachado, colores, resaltado, alineación, listas, tablas, imágenes, enlaces, regla horizontal, deshacer/rehacer y selector de tipografía con Georama. |
| Tablas | Inserción visual de 1×1 a 8×8 con cabecera opcional, barra contextual para añadir/eliminar filas y columnas, unir y dividir celdas, alternar cabeceras, fondo de tabla/celda, alineación, padding, bordes, anchos y distribución. La estructura se conserva en editor, HTML, PDF y DOCX, incluidas las celdas combinadas. |
| Imágenes | Redimensionado con tiradores, tamaños predefinidos (automático/pequeña/mediana/grande/ancho total), alineación de bloque y modos flotantes: izquierda/derecha con ajuste de texto y detrás del texto (marca de agua). Arrastre libre en los modos flotantes. Mismo resultado en editor, vista previa, PDF, DOCX y HTML. |
| Cabecera y pie | Bandas enriquecidas editables por documento y por plantilla, con imágenes, variables `{{clave}}`, tokens de numeración `{page}`/`{total}` y **alto y ancho configurables** hasta el ancho completo de la página. Las bandas habilitadas se ven siempre sobre la hoja; la cabecera y el pie quedan anclados a los bordes superior e inferior, y los márgenes solo afectan al cuerpo. El diseño aporta **imágenes globales** que se heredan. Herencia **documento → plantilla → diseño** con restablecimiento a lo heredado. Las bandas y sus imágenes se repiten en cada página del PDF/DOCX. |
| Variables | Panel lateral con formulario generado desde el esquema (`text`, `date`, `number`, `money`, `select`, `checkbox`, `table`, `image`…), validación de obligatorios y contador de campos pendientes. |
| Vista previa | Documentos: renderiza el documento real en un iframe aislado con los datos aplicados, también en las tarjetas de **Inicio → Documentos recientes** y **Documentos**; se refresca al cambiar los valores. Plantillas: preview real en la lista y en el editor con datos de ejemplo; la modal de nueva plantilla muestra la vista previa del diseño seleccionado. |
| Historial | Versiones automáticas/manuales/IA/exportación, punto de control manual, restauración y **diff palabra a palabra** contra la versión actual. Las **plantillas** tienen su propio historial: cada mejora queda firmada con el nombre de quien la hizo y el propietario puede restaurar cualquier versión anterior. |
| Autoguardado | Guardado con *debounce*, indicador de estado (“Guardando…”, “Guardado ahora mismo”) y **versionado optimista** con detección de conflictos (HTTP 409). |
| Búsqueda | Buscar y reemplazar en el documento (`Ctrl/Cmd + F`), con distinción de mayúsculas, contador de coincidencias y “reemplazar todo”. |
| Exportación | PDF (Chrome headless), DOCX (`docx`) y HTML autocontenido, con los datos interpolados y el diseño aplicado. |
| IA | OpenAI-compatible, Anthropic, Gemini y Ollama; rellena **solo las variables** del formulario (nunca sobrescribe el formato del cuerpo). Modo manual sin IA. |
| Multiusuario | JWT de acceso + refresh token rotativo en cookie httpOnly, roles `admin`/`member`, compartición por documento (`editor`/`viewer`) y por plantilla (`editor`/`viewer`), registro de actividad. |
| Bandeja y aprobación | Bandeja interna con dos pestañas: **Recibidos** y **Enviados**. En Recibidos, las solicitudes pendientes del jefe aparecen destacadas en un bloque superior con contador y acción **Devolver / rechazar**. **Enviados** reúne los envíos propios y los memos que el jefe aprobó o rechazó, con un selector de estado (todos, pendientes, aprobados, rechazados, anulados). El asistente prepara destinatarios, asunto y mensaje; el jefe revisa, corrige, aprueba y envía. Al aprobar o rechazar, el asistente recibe un aviso en la bandeja (badge, marca **Nuevo** y toast). Al rechazar se elige si el asistente puede corregir y reenviar o si el memo queda cerrado; al aprobar se elige si el asistente puede exportar el memo o si solo lo hará el administrador. El memo enviado queda **sellado como solo lectura** (sin edición, borrado, restauración ni cambios de acceso); su exportación queda reservada al administrador que aprobó, a los administradores destinatarios y, si se autorizó, al asistente remitente. |
| Numeración | Correlativos por plantilla (`MEM-0001-2026`, `CRT-0001-2026`…): prefijo de 1 a 20 caracteres, número inicial, relleno y reinicio anual. Cada plantilla lleva su propia serie: el prefijo es único entre las plantillas vivas y, si se deja vacío, se asigna un código corto único. Sus números nunca se intercalan con los de otra plantilla. Incluye campos automáticos (fecha, firmante, cargo). |

### Capturas

| Inicio | Plantillas |
| --- | --- |
| ![Inicio](docs/capturas/02-inicio.png) | ![Plantillas](docs/capturas/03-plantillas.png) |

| Nueva plantilla: elegir diseño | Editor de plantilla |
| --- | --- |
| ![Nueva plantilla](docs/capturas/08-nueva-plantilla.png) | ![Editor de plantilla](docs/capturas/09-editor-plantilla.png) |

| Editor de documento | Editor de diseño |
| --- | --- |
| ![Editor](docs/capturas/05-editor-documento.png) | ![Diseños](docs/capturas/04-editor-diseno.png) |

| Vista previa con datos | Buscar y reemplazar |
| --- | --- |
| ![Vista previa](docs/capturas/06-vista-previa.png) | ![Buscar](docs/capturas/07-buscar-reemplazar.png) |

## Stack técnico

| Capa | Tecnología |
| --- | --- |
| Frontend | Vue 3.5 (Composition API + `<script setup>`), Vite 6, TypeScript 5.9, Pinia, Vue Router, Tailwind CSS 4, `lucide-vue-next`, `@fontsource/georama`. |
| Editor | TipTap 3.32 (StarterKit, tablas, imágenes, text-style, alineación, tipografía, sub/superíndice, contador de caracteres, `UniqueID`). Extensiones propias: resaltado de variables, vista previa, diff. |
| Backend | Node 20 + Fastify 5, TypeScript, Zod, Drizzle ORM, JWT (`jose`), `node:crypto` (scrypt) para contraseñas. |
| Base de datos | PostgreSQL 16 (Docker en el puerto **5433** o PostgreSQL local en **5432**). |
| Exportación | `puppeteer-core` + Chrome para PDF, `docx` para Word, `@tiptap/static-renderer` para HTML. |
| IA | API HTTP compatible con OpenAI, Anthropic Messages, Gemini `generateContent` y Ollama `/api/chat`. |
| Pruebas | Typecheck (`tsc` / `vue-tsc`), build de producción y pruebas de humo con Puppeteer: UI, imágenes A+B y cabecera/pie (`backend/scripts/ui-smoke.mjs`, `backend/scripts/image-smoke.mjs`, `backend/scripts/chrome-smoke.mjs`). |

## Puesta en marcha

### Requisitos

- Node.js **20.11+** (probado con 20.12) y npm 10.
- Docker + Docker Compose (PostgreSQL).
- Google Chrome en `/usr/bin/google-chrome` (o define `CHROME_PATH`) para exportar PDF.

### Instalación

Frontend y backend son dos aplicaciones independientes: cada una tiene su propio
`package.json`, `package-lock.json` y `node_modules`.

```bash
git clone <repositorio> sirpefoffice
cd sirpefoffice

# Backend
cd backend
cp .env.example .env       # ajusta secretos y DATABASE_URL
npm install
npm run setup              # levanta Postgres, migra y siembra datos iniciales

# Frontend
cd ../frontend
cp .env.example .env       # VITE_API_URL=/api para desarrollo con proxy
npm install
```

Arranque en dos terminales:

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd frontend && npm run dev
```

- Web: <http://localhost:5173>
- API: <http://localhost:3101/api> (`/api/health`)
- PostgreSQL: `localhost:5433` con Docker o `localhost:5432` con PostgreSQL local
  (usuario/contraseña/base: `sirpefoffice`)

`shared/src` es la fuente única de tipos, contratos y extensiones TipTap. El script
`scripts/sync-shared.mjs` la copia a `frontend/src/shared` y `backend/src/shared` en
`postinstall`, `predev`, `prebuild` y `pretypecheck`. Así cada app mantiene su propio
`node_modules` y una sola copia de TipTap.

`npm run setup` (dentro de `backend`) es idempotente: crea el contenedor
`sirpefoffice-postgres`, aplica las migraciones de Drizzle y ejecuta el seed (usuario
administrador, diseños y plantillas de ejemplo). Si ya existe un administrador, el seed
no lo duplica. Si usas un PostgreSQL local en el puerto 5432, ajusta `DATABASE_URL` en
`backend/.env`.

### Alternativa: todo con Docker

Con Docker no hace falta instalar Node, PostgreSQL ni Chrome en el host.

El stack usa una base **externa** por defecto. Configura `DATABASE_URL` en
`.env.production` apuntando al PostgreSQL existente:

```bash
cp .env.production.example .env.production
# Edita DATABASE_URL, secretos, dominio, SVA y puertos.

docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml \
  --profile tools run --rm migrate
docker compose --env-file .env.production -f docker-compose.prod.yml up -d

# Solo si la base está vacía:
docker compose --env-file .env.production -f docker-compose.prod.yml \
  run --rm api npm run db:seed
```

Para usar la base local incluida (solo pruebas):

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml \
  --profile local-db up -d db
# y DATABASE_URL=postgres://...@db:5432/sirpefoffice
```

Abre <http://localhost:8080> (o el `WEB_PORT` configurado). Para HTTPS en
producción añade `--profile tls` y define `SIRPEF_DOMAIN`.

### Credenciales iniciales

| Correo | Contraseña | Rol |
| --- | --- | --- |
| `admin@sirpefoffice.local` | `sirpefoffice` | `admin` |

> Cambia la contraseña en **Ajustes → Perfil** y define secretos nuevos
> (`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`) antes de exponer la aplicación.

### Variables de entorno principales

| Variable | Por defecto | Descripción |
| --- | --- | --- |
| `PORT` | `3101` | Puerto de la API. |
| `DATABASE_URL` | `postgres://sirpefoffice:sirpefoffice@localhost:5433/sirpefoffice` | Conexión a PostgreSQL. |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | — | Secretos de firma (obligatorios en producción). |
| `ACCESS_TOKEN_TTL` | `15m` | Vida del token de acceso. |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | Vida del refresh token local. |
| `AUTH_MODE` | `local` | `local`, `hybrid` (SVA + admin de emergencia) o `sva` (solo SVA). |
| `SVA_SERVER_URL` | — | URL del portal/API de SVA. Obligatoria si `AUTH_MODE` no es `local`. |
| `SVA_API_KEY` | — | `key_backend` del sistema SirpefOffice creado en SVA. |
| `SVA_SYNC_INTERVAL_MS` | `600000` | Frecuencia del sync de usuarios (10 min). |
| `CHROME_PATH` | `/usr/bin/google-chrome` | Navegador usado para generar PDF. |
| `EXPORT_DIR` | `./data/exports` | Directorio temporal de exportaciones. |
| `AI_PROVIDER` | `none` | `openai` \| `anthropic` \| `gemini` \| `ollama` \| `none`. Se puede sobrescribir desde **Ajustes → Asistente de IA**. |

El resto de variables (claves de IA, correo del admin del seed, Google Docs) está
documentado en `backend/.env.example`. La URL de la API del frontend se configura en
`frontend/.env` con `VITE_API_URL`; la del portal SVA, con `VITE_SVA_URL`, y la de su
API (para cerrar sesión), con `VITE_SVA_API_URL`.

> Con `AUTH_MODE=hybrid` o `sva`, los usuarios se crean **solo en SVA**. SirpefOffice
> materializa automáticamente la cuenta al sincronizar o al primer acceso. El perfil
> de esos usuarios no se edita en SirpefOffice.

### Activar SVA paso a paso

1. En SVA, crea el sistema **SirpefOffice** (o edita el existente) y copia su
   `key_backend`.
2. En `backend/.env`, define `AUTH_MODE=sva` (o `hybrid` si quieres conservar el
   admin local de emergencia), `SVA_SERVER_URL` y `SVA_API_KEY` con esa clave. En
   `frontend/.env`, define `VITE_SVA_URL` y `VITE_SVA_API_URL`. Añade el origen de
   SirpefOffice a `HOSTS_PERMITED` en SVA y, en producción, configura
   `SVA_COOKIE_DOMAIN` (por ejemplo `.mppef.gob.ve`) para compartir la cookie.
3. Aplica la migración: `cd backend && npm run db:migrate`.
4. En SVA, asigna el sistema SirpefOffice y el rol a cada usuario. El rol global de
   SirpefOffice sale de `configUsers.is_admin`.
5. Sincroniza sin esperar: `npm run sva:sync` (o **Ajustes → Usuarios de SVA →
   Sincronizar ahora**). El backend también sincroniza al arrancar y cada 10 minutos.
6. Entra desde el portal SVA. SirpefOffice valida la cookie `SVA-TOKEN` y emite su
   propia sesión local.

SirpefOffice llama a `POST {SVA_SERVER_URL}/auth/system/session` con
`{ api_key, token }`. SVA valida la clave del sistema, la sesión del usuario y que
tenga asignado SirpefOffice; devuelve la identidad y el rol. El frontend nunca ve la
`api_key`.

El correo del administrador local (`SEED_ADMIN_EMAIL`) queda reservado para el acceso
de emergencia: no puede reclamarse desde una identidad de SVA. SirpefOffice nunca borra
usuarios; los que SVA deja de anunciar se desactivan y conservan documentos y
comparticiones.

## Uso rápido

1. **Inicia sesión** con el usuario administrador.
2. En **Inicio**, pulsa una tarjeta de **Empezar un documento nuevo**, o en **Plantillas**
   pulsa **Usar**. El documento se crea directamente con el diseño de la plantilla y se
   abre el editor, sin modal intermedio.
3. Rellena los campos del panel **Datos del documento**. Los `{{campos}}` del cuerpo se
   resaltan como chips; el documento se autoguarda.
4. Pulsa el icono del **ojo** para ver el documento final con los datos aplicados.
5. Pulsa el icono de **cabecera/pie** en la barra superior para editar las bandas. Si no
   las personalizas, se heredan de la plantilla y del diseño, incluidas las imágenes
   globales configuradas en **Diseños**.
6. Usa **Exportar** para descargar PDF, DOCX o HTML.
7. En **Historial de versiones** guarda puntos de control, compara cambios y restaura.
8. En **Plantillas** y **Diseños** crea tus propias variantes. Al pulsar **Nueva plantilla**
   se abre una modal para elegir el diseño inicial; después se entra al editor, que permite
   insertar variables, tablas, cabecera/pie y contenido. Al entrar en una tabla aparece su
   barra contextual para unir o dividir celdas, cambiar bordes, fondos y anchos. El editor
   de diseños ajusta la identidad visual (tipografía, colores, membrete, márgenes…) sobre
   una hoja ampliable con zoom y desplazamiento. El botón del ojo del editor de plantilla
   genera una vista previa completa con el borrador actual, sin guardar ni crear una versión.

## Diseño en uso

Las plantillas guardan su **estructura** (cuerpo TipTap), sus **variables** (esquema) y el
diseño que tenían. El aspecto, en cambio, es de la **cuenta**: hay **un único diseño en
uso** y todas las plantillas se dibujan con él.

```
Diseños                        Plantillas                   Documentos
─────────                      ───────────                  ──────────
[✓] Navidad 2026  En uso ──┐   todas cargan el             cada uno guarda
[  ] Año nuevo 2027        ├──▶ diseño en uso             el diseño con el
[  ] Genérico              ┘                             que se creó (fijo)
```

- En **Diseños**, cada tarjeta tiene un interruptor **«En uso»**. Al encender uno se apaga
  el que lo estuviera: solo puede haber uno por cuenta (lo garantiza un índice único en la
  base de datos).
- Las **plantillas** se dibujan siempre con el diseño en uso, en la vista previa, el PDF y
  el DOCX. No hay que recrearlas ni tocar sus variables para cambiar de aspecto.
- Los **documentos** guardan el diseño concreto con el que nacieron y **no cambian nunca**:
  el documento de diciembre se sigue exportando con el diseño de Navidad aunque en enero
  se encienda «Año nuevo 2027».
- Editar los **tokens** de un diseño sí se refleja en sus documentos (así se corrigen
  erratas).
- Si apagas el diseño en uso, las plantillas vuelven al diseño que tenían guardado.
- El diseño en uso es **por cuenta**: un diseño compartido no arrastra el diseño en uso de
  otro usuario.
- El interruptor se mueve con animación y **no recarga la lista**: el cambio se aplica al
  instante y, si el servidor fallara, se revierte. Encender un diseño **no reordena** la
  lista (no cambia su fecha de actualización).

### Cambiar de aspecto por temporada

1. Crea el diseño nuevo (**Nuevo diseño**) y dale el aspecto que quieras.
2. En su tarjeta, enciende el interruptor **«En uso»**: el anterior se apaga solo.
3. Todas las plantillas pasan al diseño nuevo al instante.
4. Los documentos ya emitidos siguen con el diseño que tenían.

## Variables y numeración automática

Las plantillas usan la sintaxis `{{clave}}`. Cada variable se define en el esquema de la
plantilla con tipo, etiqueta, obligatoriedad, valor por defecto, opciones y ayuda para la IA:

```json
{
  "key": "evento",
  "label": "Nombre del evento",
  "type": "text",
  "required": true,
  "aiHint": "Nombre oficial del curso o evento"
}
```

- Las tablas repetidoras usan un patrón de fila con `{{items.0.campo}}`; el renderizador
  clona la fila por cada elemento del arreglo `items`.
- Los valores se interpolan en el **servidor** (exportación y vista previa) y en el
  cliente solo se muestran resaltados, para no alterar el documento original.
- El correlativo de la **serie de su plantilla** se asigna cuando el documento se
  **oficializa** (al aprobarlo y enviarlo, o al pasar a `final`/`archived`), no al crearlo.
  Un borrador nunca consume la secuencia: la fila nace con `doc_number = NULL` y la UI
  muestra un **número previsto** orientativo que no reserva nada. La serie se identifica
  por el prefijo (`MEM`, `OFI`…), de modo que varias plantillas que lo compartan suman la
  misma secuencia. La configuración vive en `numbering_series` y el contador en
  `document_counters` (sin carreras: `INSERT … ON CONFLICT DO UPDATE` dentro de la misma
  transacción que sella el documento). Cada documento emitido guarda además su identidad
  de serie en `documents.numbering_prefix/year/value`, lo que permite recalcular los
  contadores sin parsear el texto.
- **La papelera no bloquea la numeración.** El número de un documento solo lo reserva
  mientras el documento está vivo: `documents.doc_number` es único **entre documentos no
  eliminados** (índice parcial `WHERE deleted_at IS NULL`). Un documento en la papelera
  conserva su número para la auditoría, pero ya no impide que otro documento lo reciba.
  La reserva comprueba además el suelo real que ocupan los documentos vivos, de modo que
  un contador desfasado (por ejemplo tras una reconciliación) nunca emite un correlativo
  que ya está en uso. Al **restaurar** un documento de la papelera, si su número lo ocupa
  otro documento vivo, se le libera: vuelve a ser un borrador y recibe un número nuevo la
  próxima vez que se oficialice. La restauración nunca falla por un número.
- **Crear un documento no escribe en la base de datos.** El editor se abre en modo
  virtual (`/documents/new`) y el autoguardado vive en `localStorage`. La fila se crea
  solo al pulsar **Guardar**, **Enviar** o **Exportar**. Abrir un documento existente
  tampoco escribe: si el contenido no cambió, el `PUT` no incrementa la versión.
- El **número previsto** se explica en toda la interfaz, no solo en un tooltip: el editor
  muestra `MEM-0008-2026` con la leyenda `se asigna al aprobar` y `Serie MEM · puede
  cambiar si otro documento de esta plantilla se aprueba antes`; la tarjeta del listado
  añade `· previsto`; el panel de **Datos del documento** incluye una fila fija «Número de
  documento»; y el diálogo de envío avisa *«Al aprobarse, este documento quedará numerado
  como MEM-0008-2026»*. El número previsto se calcula con una lectura (`numberingPreview`)
  y se expone también en `GET /api/templates/:id` para el modo «documento nuevo».
- Dentro del documento, `{{numero_documento}}` se **sustituye visualmente** por el número
  asignado o el previsto (subrayado punteado y tooltip «se confirmará al aprobar»); el
  texto guardado sigue siendo el token. En la vista previa y el PDF de un borrador el
  número aparece como `MEM-0008-2026 (previsto)`.
- Desde **Ajustes de la plantilla** se activa o desactiva la numeración y se define el
  prefijo, el número inicial, los dígitos y el reinicio anual. El formato del número es
  `PREFIX-CORRELATIVO-AÑO` (`MEM-0008-2026`) y el prefijo admite de 1 a 20 letras o
  números. **Cada plantilla lleva su propia numeración**: el prefijo es único entre las
  plantillas vivas, así que dos plantillas nunca comparten contador ni intercalan sus
  números. Si el prefijo queda vacío, el servidor asigna un código corto único derivado
  del identificador de la plantilla (`A3F9`); si el prefijo ya lo usa otra plantilla, el
  guardado se rechaza indicando a quién pertenece. El número inicial no puede bajar por
  debajo de lo ya emitido; si se sube, el próximo documento usa ese valor. Las series se
  consultan y ajustan con `GET /api/numbering` y `PUT /api/numbering/:prefix`.
- El número está disponible como **variable de sistema** `{{numero_documento}}` en el
  cuerpo, la cabecera y el pie. Se inserta desde **Ajustes → Numeración** o desde la
  pestaña **Variables**, y se rellena al oficializar el documento. La clave
  `numero_documento` está reservada y no puede definirse como variable normal.
- Las plantillas antiguas que usan `{{numero}}` como campo manual reciben el correlativo
  cuando el documento se oficializa, aunque el usuario puede editarlo después.
- Los campos automáticos (`fecha`, `firmante`, `cargo`) se inicializan con el usuario y
  la fecha actual, y quedan editables.

## Tipografía e interlineado

El catálogo de tipografías es compartido por el editor de diseños y por el selector de
texto de documentos y plantillas (`shared/src/fonts.ts`). Incluye Arial (predeterminada),
Inter, Georama, Georgia, Calibri, Times New Roman, Trebuchet MS y una monoespaciada.
Los diseños existentes conservan su `fontFamily` y Arial sigue siendo el valor inicial.

Georama se sirve **autoalojada** con `@fontsource/georama`: el frontend carga los
subconjuntos latin 400/500/600/700 y las itálicas 400/700, y el backend lee los WOFF2 y
los incrusta en **base64** en el HTML y en las plantillas de cabecera/pie de Chrome. Ni
la vista previa ni el PDF/HTML dependen de Google Fonts. El PDF espera a que
`document.fonts.ready` se resuelva antes de imprimir para que Chrome no pagine con la
fuente de respaldo.

El **interlineado es global por diseño**: se aplica al texto corrido (cuerpo y bandas) y
los títulos conservan un interlineado compacto (1,25) para mantener la jerarquía. En
**Diseños → Identidad** hay presets —Sencillo 1,00 · Compacto 1,15 · Normal 1,50 ·
Amplio 1,75 · Doble 2,00—, un valor personalizado de 0,80 a 3,00 y una muestra en vivo.
No existe interlineado por párrafo. El valor se guarda en `DesignTokens.lineHeight` y se
usa en editor, HTML, PDF y DOCX (como espaciado de párrafo).

En DOCX se guarda el **nombre** de la fuente (`Georama`); Word o LibreOffice deben tenerla
instalada para mostrarla. PDF y HTML llevan la fuente incrustada y son autocontenidos.

## Cabecera y pie

Cada documento y cada plantilla pueden definir su propia cabecera y pie. Las bandas
habilitadas se muestran siempre sobre la hoja, incluso en modo lectura; el botón de
cabecera/pie de la barra superior activa la barra de controles para editarlas:

- **Herencia documento → plantilla → diseño**: si el documento no tiene banda propia se
  usa la de la plantilla; si la plantilla tampoco la define, la del diseño (y los valores
  por defecto).
- **Personalizado / Heredado**: la etiqueta indica el origen. **Usar el heredado** elimina
  la sobrescritura y vuelve a enlazar con el nivel superior.
- Las bandas aceptan contenido enriquecido: texto con formato, imágenes, tablas, enlaces
  y variables `{{clave}}`.
- `{page}` y `{total}` se sustituyen por la página actual y el total al exportar. En el
  editor y la vista previa se muestran como `1`/`1` porque la hoja es continua.
- **Alto** reserva los milímetros que ocupa la banda; el PDF ajusta los márgenes para que
  el cuerpo no se solape.
- **Ancho** se expresa como porcentaje del **ancho de página** (20–100 %). Las bandas se
  centran horizontalmente y las imágenes se posicionan respecto a ese ancho efectivo,
  tanto en el editor como en HTML, PDF y DOCX. Con `100 %` la banda ocupa la hoja completa;
  los márgenes laterales solo afectan al cuerpo.
- El **pie** se ancla al borde inferior de la hoja: el cuerpo ocupa el espacio disponible
  y empuja la banda hacia abajo. Su contenido se alinea al fondo, de modo que al aumentar
  el alto la banda crece hacia arriba sin despegarse del pie de la página.
- En documentos y plantillas, las bandas heredadas o personalizadas se ven sin la barra
  de edición; al pulsar el botón de cabecera/pie aparecen los controles y los editores se
  vuelven editables.
- En **Diseños → Cabecera/Pie** se pueden subir hasta **20 imágenes por banda**. El panel
  activa la banda, ajusta su alto y ancho y gestiona las miniaturas; la **hoja de trabajo** permite
  arrastrar, redimensionar y estirar cada imagen dentro de la franja. Las esquinas
  conservan la proporción con el candado activo y los tiradores laterales estiran
  libremente. Al seleccionar una miniatura se pueden afinar X/Y/ancho/alto en milímetros.
  El editor impide que la imagen se salga de la franja.
- La hoja de trabajo se puede ampliar del **35 al 250 %**, ajustar al ancho, desplazar y
  ocultar el panel de ajustes. Las bandas muestran guías y el pie queda anclado al pie real
  de la hoja.
- Las imágenes del diseño son **globales**: se heredan en plantillas y documentos. Si una
  plantilla o un documento sobrescribe la banda, su contenido (incluidas las imágenes)
  sustituye al del diseño; **Usar el heredado** recupera también las imágenes globales.
- Las imágenes se guardan embebidas como *data URL* (PNG, JPG, WebP o GIF). El límite de
  subida es **2 MB** por archivo; el servidor valida el tamaño y el máximo de imágenes.
  Los listados de documentos/plantillas omiten estas imágenes para no inflar el JSON.
- En **PDF** la banda se repite en todas las páginas mediante las plantillas de Chrome.
  En **DOCX** se usan `Header`/`Footer` con campos `PAGE` y `NUMPAGES`; las imágenes de
  banda se exportan como dibujos flotantes anclados a la página, por lo que Word o
  LibreOffice pueden variar algún milímetro en su posición vertical.
- En **HTML** y en el editor la hoja es continua: la banda se muestra una sola vez, igual
  que la hoja, y el pie se mantiene anclado al final de la página. Solo **PDF** y **DOCX**
  la repiten en cada página.

La “primera página distinta” se pospuso: Chrome no permite un encabezado distinto por
página en el PDF. Para ese caso se puede usar la exportación DOCX.

## Tablas

El botón de tabla de la barra inserta una cuadrícula de **1×1 a 8×8** y permite marcar la
primera fila como cabecera. Al colocar el cursor dentro de una tabla aparece una segunda
fila contextual con acciones sobre la tabla, la fila, la columna o la celda:

- **Filas y columnas**: añadir antes/después, eliminar, alternar cabecera de fila o de
  columna y distribuir los anchos por igual.
- **Celdas**: unir la selección y dividir celdas combinadas; cambiar el fondo, la alineación
  horizontal y vertical, el padding y alternar una celda de cabecera.
- **Tabla**: ancho al 100 % o automático, alineación, fondo, color/grosor/estilo de borde,
  padding común y eliminación de la tabla.

Para unir celdas se seleccionan varias con el ratón o con **Shift + clic** y se pulsa
**Unir**. Las celdas combinadas se guardan como `colspan`/`rowspan` en el documento, se
renderizan igual en HTML/PDF y se traducen a `gridSpan`/`vMerge` en DOCX. La barra
contextual también funciona en las bandas de cabecera y pie.

## Vista previa de documentos

Las tarjetas de **Documentos** y de **Inicio → Documentos recientes** no usan una
miniatura genérica: cargan el documento real desde
`GET /api/documents/:id/html?embed=1` y lo muestran en un iframe aislado con
`sandbox`. El iframe se carga de forma diferida al acercarse al viewport, se cachea en
memoria por `id`, versión, fecha del documento y fecha del diseño (para invalidar la
caché cuando cambian las imágenes globales), y cae a una miniatura neutra si la petición
falla o el usuario no tiene acceso.

`embed=1` devuelve el HTML sin fondo gris, sombra ni márgenes exteriores, pensado para
tarjetas y miniaturas. En ese modo la hoja se fija al alto real de la página y el cuerpo se
recorta; así la cabecera y el pie permanecen visibles aunque el contenido supere una
página. Es un recorte **solo de la miniatura**: el editor, el HTML completo, el PDF y el
DOCX no pierden contenido. La misma opción está disponible para las versiones:
`GET /api/documents/:id/versions/:version/html?embed=1`.

## Compartir y mejorar plantillas

Una plantilla se puede compartir **por personas**, igual que los documentos. El propietario
invita a quien quiera desde el botón **Compartir** del editor de plantilla (o desde el menú de
la tarjeta en **Plantillas**) y le concede uno de dos permisos:

| Permiso | Qué puede hacer |
| --- | --- |
| **Editor** | Usar la plantilla **y mejorarla**: cambiar el nombre, la descripción, las variables, el cuerpo, la cabecera, el pie y las instrucciones para la IA. |
| **Lector** | Usarla para crear documentos. No puede modificarla. |

Las mejoras del editor se aplican **sobre la plantilla original**, no sobre una copia: el
dueño y el resto de usuarios ven el cambio al instante. Cada cambio genera una versión en el
historial **firmada con el nombre de quien lo hizo**, de modo que siempre se sabe qué mejoró
quién. El propietario puede **restaurar** cualquier versión anterior desde el panel de
historial (el botón del reloj en la cabecera del editor).

Hay dos capas de compartición, y no se confunden:

- **Por personas** (`template_shares`): da acceso a personas concretas, con permiso de
  editor o lector. Es lo que permite que otros **mejoren** la plantilla.
- **Con todo el mundo** (`templates.is_shared`): la plantilla se puede **usar** por
  cualquiera, pero eso **no** concede edición.

Los **ajustes de propiedad** siguen siendo del propietario: la visibilidad, el estado
(activa/inactiva), el tipo de documento y la numeración. Un editor que intenta cambiarlos
recibe un `403` explícito, y sus mejoras no tocan la serie de correlativos del
propietario. El administrador conserva los mismos poderes que tenía antes sobre las
plantillas compartidas.

La plantilla se sigue dibujando con el **diseño en uso de su propietario**, también cuando
la mejora otra persona: el diseño no viaja con la plantilla.

El editor de plantilla es el único punto donde se edita el cuerpo. La concurrencia se
resuelve con `expectedVersion`: si otra sesión guardó antes, el segundo guardado recibe un
`409` («la plantilla cambió en otra sesión») en lugar de pisar el trabajo ajeno.

### API de compartición de plantillas

| Endpoint | Qué hace |
| --- | --- |
| `GET /api/templates/:id/shares` | Lista los accesos explícitos (propietario o administrador). |
| `POST /api/templates/:id/shares` | `{ "userId": "…", "permission": "editor" \| "viewer" }` → concede acceso. Solo el propietario. |
| `DELETE /api/templates/:id/shares/:userId` | Retira el acceso. Solo el propietario. |
| `GET /api/templates/:id/versions` | Historial de versiones, con el autor de cada cambio. |
| `POST /api/templates/:id/versions/:version/restore` | Restaura una versión anterior como versión nueva. |

## Vista previa de plantillas

Las plantillas usan el mismo motor de renderizado que los documentos, con **datos de
ejemplo** generados a partir de su esquema de variables. La vista previa se muestra:

- en la tarjeta de cada plantilla en **Inicio** y **Plantillas**;
- en la modal de **Nueva plantilla**, como vista previa del diseño seleccionado;
- a pantalla completa desde el botón del ojo del **editor de plantilla**.

El editor envía su borrador actual a `POST /api/templates/preview` para previsualizarlo
sin guardar ni crear una versión. La lista usa
`GET /api/templates/:id/preview?designId=…`, que también acepta un diseño alternativo o
`designId=none` como **Sin diseño**. Las respuestas se renderizan en servidor y se
muestran en un iframe aislado, igual que la vista previa de un documento.

Cuando el diseño de la plantilla tiene una **variante activada**, la vista previa usa los
tokens de la variante (igual que el editor y la exportación). La caché de miniaturas se
invalida con `effectiveDesignUpdatedAt`, que cambia al encender o apagar una campaña.

### API del diseño en uso

| Endpoint | Qué hace |
| --- | --- |
| `GET /api/designs` | Devuelve `isCurrent`: si ese diseño es el que está en uso. |
| `POST /api/designs/:id/activate` | `{ "isCurrent": true \| false }` → el interruptor: al encenderlo se apaga el que lo estuviera. Solo el propietario. |

## Asistente de IA

La IA es **opcional**: con `AI_PROVIDER=none` la aplicación funciona al 100 % en modo manual.

Configuración (solo administradores) en **Ajustes → Asistente de IA**:

| Proveedor | Campos |
| --- | --- |
| OpenAI-compatible | `baseUrl`, `apiKey`, `model` (funciona con Azure OpenAI, OpenRouter, LM Studio, vLLM…) |
| Anthropic | `apiKey`, `model` (`claude-sonnet-4-5` por defecto) |
| Gemini | `apiKey`, `model` (`gemini-2.0-flash` por defecto) |
| Ollama | `baseUrl` (`http://localhost:11434`), `model` (`llama3.1` por defecto) |

La configuración se guarda en la tabla `app_settings` (clave `ai`), tiene prioridad sobre
las variables de entorno y **nunca devuelve la API key al navegador**. El botón
**Rellenar con IA** del panel de datos envía el esquema, los valores actuales y las
instrucciones de cada variable, y mezcla el JSON resultante **solo en los campos del
formulario**; el cuerpo y el formato del documento no se tocan. Antes de generar se puede
probar la conexión con **Probar conexión**.

## Exportación

| Formato | Motor | Notas |
| --- | --- | --- |
| PDF | `puppeteer-core` + Chrome headless | A4/Letter real, membrete, cabecera/pie en cada página con numeración real (`{page}`/`{total}`), tablas con celdas combinadas e imágenes. Las imágenes globales de banda se repiten y conservan su posición en milímetros. Georama se incrusta como WOFF2 y se espera a `document.fonts.ready` antes de imprimir. |
| DOCX | `docx` | Convierte el árbol TipTap a párrafos, listas, tablas, imágenes y estilos del diseño. Las tablas conservan anchos, alineación, bordes, padding, fondos y celdas combinadas (`gridSpan`/`vMerge`), con cabeceras repetidas. La cabecera/pie usa `Header`/`Footer` y campos `PAGE`/`NUMPAGES`; las imágenes de banda se anclan a la página con posición en EMU. Guarda el nombre de la fuente (`Georama`), pero no la incrusta. |
| HTML | `@tiptap/static-renderer` | Documento autocontenido con CSS del diseño y las fuentes Georama en base64; sirve para archivar o publicar. Las bandas se muestran en el flujo con la numeración de la primera página. |

Cada exportación queda registrada en la actividad del documento (usuario, formato y
versión exportada).

En un documento **sellado como solo lectura** la exportación se restringe: puede
exportarlo el administrador que aprobó (o rechazó) el envío, los administradores que
figuran como destinatarios y, únicamente si el jefe lo autorizó al aprobar, el asistente
remitente. El formato se elige en el menú **Exportar**: PDF, Word (`.docx`) o HTML.

### Quién puede exportar

| Usuario | Documento abierto (borrador) | Memo sellado |
| --- | --- | --- |
| Administrador | sí | sí, si aprobó el envío o es destinatario |
| Asistente (`member`) | **no** | solo si el jefe autorizó la exportación al aprobar |

Un borrador **nunca** está autorizado: para obtener una copia, el jefe tiene que aprobar
el envío y marcar «el asistente también podrá exportarlo». El botón **Exportar** sigue
visible para todos, pero al pulsarlo sin autorización explica qué falta; el HTML
completo del documento (el que se descarga o se imprime) sigue la misma regla. La
**vista previa dentro de la app** (miniaturas de las tarjetas, vista previa del editor e
historial de versiones) queda disponible para cualquiera con acceso: no es una
exportación.

### Quién puede cambiar el estado

Solo los **administradores** cambian el estado a mano (Borrador, Final, Archivado). Un
asistente ve el estado como una etiqueta informative con candado, y el servidor rechaza
el cambio con `403` aunque se manipule la petición. Los estados que dependen del flujo
de bandeja (`Enviado`, `Aprobado`, `Rechazado`, `Anulado`) solo los asigna el propio
flujo.

## Scripts disponibles

### Backend

```bash
cd backend
```

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | API con `tsx watch`. |
| `npm run start` | API en modo producción (`tsx`, sin watch). |
| `npm run build` | Verifica el servidor con `tsc --noEmit`. |
| `npm run typecheck` | Typecheck del backend. |
| `npm run setup` | `db:up` + `db:migrate` + `db:seed`. |
| `npm run db:up` / `db:down` / `db:reset` | Controla el contenedor de PostgreSQL. |
| `npm run db:migrate` / `db:generate` / `db:seed` | Migraciones, generación de migraciones y seed. |
| `npm run db:migrate:fullwidth` | Migra cabeceras y pies existentes al ancho de página (idempotente, con copia de seguridad). |
| `npm run db:migrate:numbering` | Libera el número de los borradores, rellena `documents.numbering_*` y recalcula los contadores (idempotente, con copia de seguridad). |
| `npm run db:reconcile-counters` | Compara `document_counters` con los documentos **vivos** e informa/corrige desviaciones (`--apply`). Los documentos en la papelera no fijan el suelo: su número queda liberado. |
| `npm run db:purge-empty-drafts` | Elimina definitivamente los borradores nunca usados (simulación por defecto; `--apply` ejecuta y deja bitácora). |
| `npm run smoke:numbering` | Con la API levantada, verifica la numeración diferida: el borrador no consume número, el previsto no reserva, la oficialización asigna, las aprobaciones simultáneas no repiten y la papelera no bloquea la oficialización de otro documento. |
| `npm run smoke:errors` | Comprueba que cada tipo de fallo (validación, ruta inexistente, sin sesión, content-type inválido) devuelva el estado y el mensaje correctos, en español y nombrando los campos que fallan. |
| `npm run smoke:errors:db` | Comprueba los fallos que solo existen con PostgreSQL real: correo duplicado, clave foránea rota, uuid inválido y error inesperado (que no debe filtrar detalles internos). |
| `npm run smoke:errors:ui` | Con la web de desarrollo levantada, comprueba en un navegador real que un 4xx sale como aviso ámbar, un 5xx como error rojo con su referencia y una caída de red con un mensaje en español (no «Failed to fetch»). |
| `npm run smoke:campaign` | Con la API levantada, verifica el diseño en uso: encender uno apaga el anterior, las plantillas cargan el que está en uso sin tocar estructura ni variables, el documento creado guarda ese diseño y lo conserva tras cambiar el diseño en uso (limpia los datos de prueba). |
| `npm run smoke:template-share` | Con la API levantada, verifica la compartición de plantillas: el editor mejora la original, la mejora queda firmada en el historial, el editor no puede tocar los ajustes de propiedad, el lector no puede editar y el propietario puede restaurar una versión (limpia los datos de prueba). |
| `node scripts/template-share-flow-ui.mjs` | Verificación visual del flujo de compartición con Chrome headless: el administrador comparte una plantilla, el miembro la ve con la insignia **Editable**, la mejora y el historial la firma con su nombre (capturas en `/tmp/sirpefoffice-shots-share-flow`). Necesita `SD_MEMBER_TOKEN` (ver `dev-token.ts`). |
| `npm run dev:token -- <correo>` | Emite un access token para un usuario. Los miembros vienen de SVA y no tienen contraseña local: es la forma de abrir su sesión en las pruebas de interfaz. |
| `npm run admin:reset` | Alinea el email y la contraseña del administrador con los valores del seed. |
| `npm run smoke:inbox` | Con la API levantada, prueba el flujo de bandeja: solicitud de envío, aprobación, autorización de exportación, sellado, lectura, rechazo y bloqueo de edición/borrado/exportación (crea usuarios y documentos temporales y los elimina). |
| `node scripts/ui-smoke.mjs` | Prueba de humo de la UI con Chrome headless: previews reales de documentos y plantillas, hoja de Diseño con bandas editables y ancho de página completo, inserción de tablas y unión de celdas, creación directa de documentos, modal de diseño al crear plantilla y flujo completo (capturas en `/tmp/sirpefoffice-shots`). |
| `node scripts/image-smoke.mjs` | Prueba funcional de imágenes A+B: insertar, arrastrar, redimensionar, flotar, alinear y exportar PDF/DOCX (capturas en `/tmp/sirpefoffice-shots-images`). |
| `node scripts/chrome-smoke.mjs` | Prueba funcional de cabecera/pie: pie visible y anclado en modo lectura, herencia, edición con imagen y tokens, alto y ancho, persistencia, restablecimiento, cambio de diseño en plantilla y exportación PDF/DOCX (capturas en `/tmp/sirpefoffice-shots-chrome`). |
| `node scripts/page-break-export-smoke.mjs` | Comprueba el salto de página manual de extremo a extremo: HTML con `data-page-break`, PDF de 2 páginas y DOCX con salto real. |
| `npm run smoke:pdf-bands` | Regresión de imágenes globales de cabecera/pie: el PDF tiene las mismas páginas que el layout, las imágenes conservan su posición en mm y ninguna hoja desborda (no requiere API ni base de datos). |
| `npm run smoke:draft` | Regresión del borrador local del documento nuevo: al abrir una plantilla y volver a entrar el cuerpo no aparece en blanco, el borrador conserva lo escrito y los borradores heredados se reparan (necesita la API y la web de desarrollo levantadas). |
| `node scripts/pagination-smoke.mjs` | Prueba de paginación visual: hojas del tamaño del diseño, separación entre hojas, contenido sin invadir huecos, toggle a hoja continua, salto manual y limpieza del documento temporal. |
| `node scripts/pagination-parity-smoke.mjs` | Paridad entre editor, HTML, impresión, PDF y DOCX: mismo número de hojas, numeración por página, saltos explícitos y, si está disponible, conversión del DOCX con LibreOffice. |

### Frontend

```bash
cd frontend
```

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo Vite. |
| `npm run build` | Typecheck con `vue-tsc` y bundle de producción. |
| `npm run preview` | Sirve el bundle de producción. |
| `npm run typecheck` | Typecheck de la SPA. |

### Raíz

| Comando | Qué hace |
| --- | --- |
| `node scripts/sync-shared.mjs` | Copia `shared/src` a las dos apps. |
| `node scripts/publish-to-google-docs.mjs` | Publica el informe de ingeniería inversa como Google Doc. |

## Estructura del repositorio

```text
sirpefoffice/
├── frontend/                  # SPA Vue 3 + TipTap
│   ├── node_modules/          # instalación independiente
│   ├── Dockerfile             # build + Nginx para el stack Docker
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── shared/            # copia generada de shared/src
│       ├── views/             # Login, Inicio, Documentos, Editor, Plantillas, Diseños…
│       ├── components/        # AppShell, editor/, designs/, documents/, ui/…
│       ├── stores/            # Pinia (auth)
│       ├── api/               # Cliente HTTP con URL configurable
│       └── lib/               # Etiquetas, diff, resaltado, estilos de banda…
├── backend/                   # API Fastify + Drizzle + exportadores
│   ├── node_modules/          # instalación independiente
│   ├── Dockerfile             # Node 22 + Chromium para PDF
│   ├── package.json
│   ├── docker-compose.yml     # PostgreSQL 16 para desarrollo
│   ├── drizzle/               # SQL versionado
│   ├── scripts/               # smoke tests y utilidades
│   └── src/
│       ├── shared/            # copia generada de shared/src
│       ├── db/                # Esquema, migraciones y seeds
│       ├── modules/           # auth, documents, templates, designs, ai, exports
│       ├── lib/               # render, docx, auth, acceso…
│       └── index.ts           # Arranque y registro de rutas
├── shared/                    # fuente única, sin node_modules
│   └── src/{index,types,defaults,chrome,editor-extensions,image-node-view}.ts
├── scripts/                   # sync-shared y publicación en Google Docs
├── deploy/                    # Nginx, Caddy, systemd y variables de producción
├── docker-compose.prod.yml    # stack Docker: db + api + web (+ caddy)
├── .env.production.example    # plantilla del entorno Docker
├── docs/                      # Arquitectura, informe Eigent y capturas
├── README.md
└── LICENSE
```

## Despliegue rápido

La vía recomendada es el stack Docker descrito en
[`README-PRODUCCION.md`](README-PRODUCCION.md#despliegue-con-docker-compose-recomendado):
`docker compose --env-file .env.production -f docker-compose.prod.yml up -d`.

La API es *stateless* y se ejecuta con `tsx` (TypeScript directo, sin paso de compilación):

```bash
# API (detrás de un proxy que exponga /api)
cd backend
NODE_ENV=production npm run start

# Web: build estático y sirve frontend/dist con Nginx, Caddy o cualquier CDN
cd ../frontend
npm run build
```

Configura el proxy para que `https://tu-dominio/api/*` apunte a `http://127.0.0.1:3101/api/*`
y sirve el resto desde `frontend/dist`. Si el frontend y la API están en dominios distintos,
configura `VITE_API_URL` con la URL completa y revisa CORS y las cookies del refresh token.
Recuerda definir secretos nuevos, HTTPS y una política de backups de PostgreSQL.

## Seguridad

- Contraseñas con `scrypt` (`node:crypto`), sal aleatoria por usuario y comparación en
  tiempo constante.
- Token de acceso JWT de 15 minutos; refresh token **opaco** (32 bytes) guardado como
  SHA-256 en base de datos, rotado en cada refresco y revocable (`/api/auth/logout`).
- Cookies `httpOnly`, `sameSite=lax` y `secure` en producción; el token de acceso se
  mantiene en memoria/localStorage solo para el cliente de la API.
- Autorización por recurso: propietario, editor o lector; los endpoints de escritura
  comprueban permiso y versión esperada.
- Validación de entrada con Zod en todas las rutas y límites de tamaño para imágenes
  (8 MB en el editor; 2 MB por imagen de banda y 3 000 000 caracteres de *data URL* en el
  servidor) y cuerpos JSON.
- CORS restringido a los orígenes configurados y *rate limit* básico en autenticación.
- La API key de IA nunca se serializa hacia el cliente (`hasApiKey: true|false`).

## Limitaciones conocidas

- **Bandeja interna, sin correo real**: los envíos llegan a usuarios del sistema; no hay
  integración SMTP ni destinatarios externos. El flujo de aprobación usa los roles
  existentes: los asistentes deben ser `member` y los jefes `admin`.
- **Sin colaboración en tiempo real**: el modelo es autoguardado + versionado optimista
  (dos editores simultáneos reciben 409 y pueden recargar).
- **Paginación por bloques**: el editor, HTML, vista de impresión, PDF y DOCX cortan
  entre bloques de nivel superior. Un párrafo, tabla o imagen más alto que una hoja hace
  crecer la hoja en el editor; PDF/Word pueden fragmentarlo y el número de páginas puede
  diferir en ese caso extremo.
- **Control de cambios y comentarios**: el esquema de base de datos incluye `comments`,
  pero la UI de comentarios y el *tracked changes* completo quedan como siguiente paso.
- **No importa `.docx` existentes** (decisión de alcance): solo se crean documentos nuevos
  desde plantillas.
- La exportación DOCX cubre el subconjunto de nodos que produce el editor (párrafos,
  títulos, listas, tablas, imágenes, marcas de texto). Las imágenes globales de banda sí
  se exportan como dibujos flotantes anclados a la página; el resultado exacto depende
  del motor de Word/LibreOffice y puede diferir unos milímetros del editor.
- **Paridad de exportaciones**: el editor, HTML, vista de impresión, PDF y DOCX comparten
  el modelo de páginas; HTML y PDF repiten cabecera/pie en cada hoja y el DOCX inserta
  saltos explícitos. Las miniaturas `embed=1` muestran solo la primera hoja para no
  desplazar la cabecera ni el pie. La medición del servidor usa Chrome y se cachea; la
  primera exportación o vista previa completa puede tardar un poco más.
- **Fuente en DOCX**: el DOCX guarda el nombre de la tipografía, pero no incrusta el
  archivo. Para ver Georama en Word o LibreOffice hay que tenerla instalada; PDF y HTML sí
  la incluyen y son autocontenidos. Si el visor sustituye la fuente, algún bloque puede
  reflowar y el número de páginas podría variar.
- **Cabecera/pie distinta en la primera página**: pospuesta. El PDF repite la misma banda
  en todas las páginas; para una portada con otro encabezado se puede usar DOCX.
- El PDF requiere Chrome instalado en el servidor.

## Documentación

- [`docs/SVA.md`](docs/SVA.md): sesión orquestada por SVA, cookie compartida,
  modo HTTP y resolución de problemas.
- [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md): decisiones, modelo de datos, flujos,
  API, renderizado, seguridad y hoja de ruta.
- [`docs/INGENIERIA-INVERSA-EIGENT.md`](docs/INGENIERIA-INVERSA-EIGENT.md): informe de
  ingeniería inversa de Eigent (arquitectura, stack, agentes, skills, diseño y build).
- [`scripts/publish-to-google-docs.mjs`](scripts/publish-to-google-docs.mjs): publica ese
  informe como Google Doc usando la API de Drive/Docs.

## Licencia

MIT. Consulta [`LICENSE`](LICENSE).
