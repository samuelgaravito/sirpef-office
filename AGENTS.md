# AGENTS.md · SirpefOffice

Editor de documentos (memorándums, actas, certificados…) con plantillas, diseños de
página, numeración correlativa, edición de escritorio (autoguardado + historial),
exportación a PDF/DOCX/HTML y flujo de aprobación por bandeja.

Stack: **Fastify 5 + Drizzle + PostgreSQL 16** (backend) · **Vue 3 + Vite 6 + TipTap 3**
(frontend). Todo el código, los mensajes de UI y la documentación están **en español**: los
mensajes de usuario que añadas también.

## Forma del repo (lo que más confunde)

- **No es un workspace npm.** No hay `package.json` en la raíz. Hay **dos apps
  independientes** (`backend/` y `frontend/`), cada una con su `package.json`,
  `package-lock.json` y `node_modules`. Ejecuta `npm` siempre desde una de las dos.
- **`shared/src/` es la fuente única** de tipos, contratos y extensiones TipTap.
  `scripts/sync-shared.mjs` la **copia** a `backend/src/shared/` y `frontend/src/shared/`.
  Esas copias **están en `.gitignore` y se regeneran**: **nunca las edites**, edita
  `shared/src/` y ejecuta `node scripts/sync-shared.mjs`. El sync se dispara solo en
  `postinstall`, `predev`, `prebuild` y `pretypecheck` → cualquier cambio tuyo en una
  copia se pierde en el siguiente arranque.
- Alias de importación: `@sirpefoffice/shared` → `src/shared/index.ts` (en ambas apps);
  `@/` → `src/` **solo en el frontend**. En el backend los imports relativos **llevan
  extensión `.js`** (`../db/index.js`) aunque `tsc` use `moduleResolution: Bundler`.
- `shared/src/editor-extensions.ts` y `image-node-view.ts` los usa **el editor y el
  renderizador del servidor**: un cambio ahí altera a la vez la edición y el PDF/DOCX.

## Comandos

```bash
# Una sola vez, desde backend/
cp .env.example .env      # ajusta DATABASE_URL y secretos
npm install && npm run setup   # db:up + db:migrate + db:seed (idempotente)

# Desarrollo (dos terminales)
cd backend  && npm run dev     # API en :3101  (tsx watch)
cd frontend && npm run dev     # Vite en :5173 (proxy /api → :3101)

# Verificación
cd backend  && npm run typecheck   # tsc --noEmit
cd frontend && npm run typecheck   # vue-tsc --noEmit
cd frontend && npm run build       # vue-tsc + bundle de Vite
```

- **La API no se compila**: corre TypeScript directo con `tsx` (también en producción:
  `npm start`). `npm run build` en el backend **solo hace typecheck**.
- **Postgres de desarrollo en el puerto `5433`** (`backend/docker-compose.yml`), para no
  chocar con un Postgres del sistema en 5432. `DATABASE_URL` vive en `backend/.env`.
- Node local **20.12** → Vite está fijado a 6 con `overrides` (Vite 8 exige Node ≥ 20.19).
  No subas Vite sin revisar ese `override`.
- La API lee `.env` desde `process.cwd()` y, como respaldo, `../.env`; si arrancas desde
  otra carpeta puede cargar el entorno equivocado.

## Migraciones y datos

- `npm run db:generate` (drizzle-kit) genera el SQL en `backend/drizzle/`; `npm run
  db:migrate` lo aplica. **Cambiar el schema = `src/db/schema.ts` → generate → migrate.**
- Scripts de datos (idempotentes, con copia en `backend/data/backups/`):
  `db:migrate:fullwidth`, `db:migrate:numbering`, `db:reconcile-counters` (`--apply`),
  `db:purge-empty-drafts` (`--apply`).
- `npm run db:seed` crea el admin, **4 diseños y 8 plantillas**; no duplica si ya existen.
- `npm run admin:reset` realinea email y contraseña del admin con `SEED_ADMIN_*`.

## Verificación (no hay runner de tests)

No hay vitest/jest. La verificación es **typecheck + scripts de humo**. Antes de dar algo
por terminado: `backend: npm run typecheck` y `frontend: npm run typecheck`.

- `npm run smoke:errors` usa `app.inject()` → **no necesita API ni base de datos**.
  `smoke:errors:db` sí necesita PostgreSQL real.
- `npm run smoke:*` restantes (inbox, numbering, campaign, template-share) necesitan **la API
  levantada** en `SD_API` (por defecto `http://localhost:3101/api`) y **la misma base de
  datos**: importan `src/db/index.js` y firman tokens con `signAccessToken`. Crean
  usuarios/documentos temporales y los limpian al final.
- Los `.mjs` de UI (`ui-smoke`, `image-smoke`, `chrome-smoke`, `pagination-smoke`,
  `pagination-parity-smoke`, `page-break-export-smoke`, `template-share-flow-ui`) necesitan
  además el **dev server**; la URL va como `argv[2]` (por defecto `http://localhost:5173`).
  `npm run smoke:errors:ui` espera el 5199. `npm run smoke:draft` usa `SMOKE_WEB`.
- Los scripts de UI **hacen login sin escribir nada**: el formulario viene precargado con
  `admin@sirpefoffice.local` / `sirpefoffice`. Si el admin sembrado tiene otra contraseña
  (`SEED_ADMIN_PASSWORD`), fallan → `npm run admin:reset`.
- `CHROME_PATH` (por defecto `/usr/bin/google-chrome`) debe existir; el `.env` de la raíz
  apunta a `/usr/bin/chromium`. `npm run dev:token -- <correo>` emite un access token para
  miembros sin contraseña local (usuarios que vienen de SVA).
- Capturas en `/tmp/sirpefoffice-shots*`.

## Convenciones del backend

- TypeScript ESM con `tsx`. `verbatimModuleSyntax` → usa `import type` para los tipos;
  `noUncheckedIndexedAccess` → el acceso a array devuelve `T | undefined`.
- **Errores**: no lances `new Error` en rutas. Usa los helpers de `src/lib/errors.ts`
  (`badRequest`, `notFound`, `forbidden`, `conflict`, `locked`, `internal`, `unavailable`)
  con un **código estable**; el handler global traduce además las violaciones de unicidad
  de Postgres a 409 con código propio. Los mensajes deben ser **en español y nombrar los
  campos que fallan** (lo verifica `smoke:errors`).
- Validación con **Zod v4** en cada ruta; `applySpanishZodMessages()` da los mensajes en
  español.
- **Autorización por recurso**: `assertDocument(userId, id, 'viewer'|'editor'|'owner')` y
  `getTemplateAccess(...)`. Si el usuario **no tiene acceso se responde 404, no 403**, para
  no revelar la existencia del recurso.
- **Versionado optimista**: las escrituras reciben `expectedVersion`; si no coincide →
  **409 CONFLICT**. Mantén ese patrón en cualquier endpoint de escritura nuevo.
- Un documento aprobado y enviado queda **sellado**: `isDocumentLocked` → 409
  `DOCUMENT_LOCKED`. Quién puede exportarlo lo decide `canExportDocument`.

## Convenciones del frontend

- Vue 3 con `<script setup>` y Composition API. Pinia **solo para auth**
  (`stores/auth.ts`); todo el HTTP pasa por `api/client.ts`, que renueva la sesión una
  sola vez tras un 401 y ya traduce los errores de red (no muestres «Failed to fetch»).
- Las **vistas** viven en `views/`, los componentes en `components/<dominio>/`
  (`editor/`, `designs/`, `documents/`, `templates/`, `inbox/`, `layout/`, `ui/`).
- Los módulos (bandeja, documentos, plantillas, diseños, ajustes) se abren como **paneles
  modales sobre el panel de trabajo**, pero las **URLs siguen siendo normales y
  recargables** (`meta.overlay` en el router). `lib/panel.ts` expone `PANEL_MODE` /
  `PANEL_CLOSE` para que `AppShell` omita su cabecera al montarse dentro del panel.

## Invariantes del dominio (no se deducen leyendo el código)

- **Cabecera y pie** (`ChromeConfig`): `null` significa *heredar*. La herencia es
  **documento → plantilla → diseño** y se resuelve con `resolveChrome`
  (`shared/src/chrome.ts`) para que editor, HTML, impresión, PDF y DOCX coincidan.
  Poner `null` es la forma de **restablecer a lo heredado**.
- **Numeración diferida**: un borrador **no consume** número; el correlativo se asigna al
  aprobar/enviar (y el previsto se muestra como «(previsto)»). Cada plantilla tiene
  **su propia enumeración**: lo declara la propia serie (`numbering_series.template_id`,
  único, y `template_name` como etiqueta legible del nombre de la plantilla). Su contador
  y su suelo son exclusivos, así que dos plantillas nunca intercalan sus números. El
  prefijo es **opcional** (la serie puede numerar solo con el correlativo, `0001-2026`) y
  **puede repetirse**; el código corto (`A3F9`) es una opción explícita
  (`numbering.prefixAuto`). Formato y textos en `shared/src/numbering.ts`; contador en
  `backend/src/lib/numbering.ts` + `counter.ts`. Los documentos **en la papelera liberan
  su número**: el suelo del contador lo fijan solo los documentos vivos.
- **Diseño en uso**: una sola plantilla activa por cuenta (índice único
  `designs_current_unique_idx`). Los documentos **conservan** el diseño con el que nacieron.
- El contenido de un documento es **el JSON de TipTap guardado tal cual** en una columna
  JSONB. No lo «normalices» al guardar.
- Una plantilla compartida con todo el mundo (`isShared`) es **usable pero no editable**
  por cualquiera; solo el propietario o un admin la cambian.

## Despliegue

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml build
docker compose --env-file .env.production -f docker-compose.prod.yml --profile tools run --rm migrate
docker compose --env-file .env.production -f docker-compose.prod.yml up -d
```

- Perfiles de Compose: `tools` (migrar — **hay que lanzarlo a mano**, no ocurre en `up`),
  `local-db` (Postgres de pruebas; en producción la BD es **externa** vía `DATABASE_URL`),
  `tls` (Caddy).
- `node scripts/build-release.mjs` genera el paquete de producción en `release/`
  (ignorado por git) para el despliegue sin Docker.
- `sva/` es un sistema independiente: **no debe entrar en este repo**. `video/` es un
  proyecto HyperFrames local no versionado (trae su propio `AGENTS.md`).

## Git y configuración de OpenCode

- Ramas: **`develop`** es la rama de trabajo y `main` la de publicación. Los cambios entran
  por PR de rama de feature a `develop`; luego `develop` → `main`.
- Commits en formato conventional-commit **en español**: `feat(frontend):`, `fix(frontend):`,
  `chore(env):`.
- `.opencode.json` (raíz) define los subagentes: `explore`, `security-auditor`,
  `vue-tiptap-expert`, `backend-architect` (ficheros en `.opencode/agents/`). `bash` pide
  permiso y `webfetch` está **denegado**.

## Referencias y discrepancias conocidas

- `README.md` = uso y operación. `docs/ARQUITECTURA.md` = arquitectura, modelo de datos,
  flujos, API y render (léelo antes de tocar render o numeración). `docs/SVA.md` = integración
  con SVA y sus modos de autenticación (`local` / `hybrid` / `sva`).
- La tabla de variables del README y `docs/ARQUITECTURA.md` están **al día** con el código
  (`ACCESS_TOKEN_TTL=8h`, `REFRESH_TOKEN_TTL_DAYS=90`, **4 diseños** y **16 tablas**), pero
  compruébalo: si vuelve a haber discrepancia, **manda el código ejecutable**.
- Si el README y el código discrepan, **manda el código ejecutable**.
