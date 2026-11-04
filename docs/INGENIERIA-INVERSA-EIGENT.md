# Ingeniería inversa de Eigent

**Informe técnico de la aplicación de escritorio Eigent** (`eigent-ai/eigent`, versión
`1.0.6`, licencia Apache-2.0), realizado a partir de su repositorio público, su
documentación y la estructura de su árbol de código.

> **Alcance y método.** No se ha descompilado ningún binario ni se ha eludido ninguna
> protección: todo lo descrito proviene del **código fuente público**, del `README`, de
> los manifiestos de dependencias y de la estructura de directorios (3 918 rutas
> inspeccionadas). Cada afirmación se marca como **observada** (consta literalmente en el
> repositorio) o **inferida** (deducida del nombre/estructura, sin leer la implementación
> completa). El objetivo es aprender de su arquitectura, no redistribuir su producto.

---

## 0. Ficha técnica

| Dato | Valor |
| --- | --- |
| Nombre | Eigent — “The Open Source Cowork Desktop” |
| Repositorio | `github.com/eigent-ai/eigent` |
| Versión analizada | `1.0.6` (`package.json`) |
| Licencia | Apache-2.0 |
| Tipo | Aplicación de escritorio (Electron) + backend local Python + servidor cloud opcional |
| UI | React 18 + TypeScript + Vite 5 + Tailwind CSS 4 |
| Backend de agentes | Python 3.11 + FastAPI + CAMEL-AI (`camel-ai[eigent]==0.2.91a7`) |
| Servidor | FastAPI + PostgreSQL + Alembic + Celery + Docker |
| Empaquetado | electron-builder 24 (macOS/Windows/Linux, notarización Apple) |
| Tamaño del árbol | 3 918 rutas: `src/` 1 080, `package/` 967, `backend/` 667, `test/` 451, `server/` 333, `resources/` 248 |

Distribución de directorios (observada):

```text
eigent/
├── electron/        # proceso principal y preload (59 rutas)
├── src/             # renderer React (1 080 rutas)
├── backend/         # "brain" local: FastAPI + CAMEL (667 rutas)
├── server/          # servidor cloud/self-hosted (333 rutas)
├── resources/       # skills de ejemplo, instaladores de uv/bun
├── docs/            # design system, terminología, capacidades de modelos
├── scripts/         # 25 scripts de build, validación y CI
├── package/         # artefactos de empaquetado
├── test/            # pruebas E2E/unitarias (451 rutas)
└── build/, config/  # iconos, notarización, firma, perfiles de navegador
```

---

## 1. Qué hace el producto

Eigent se presenta como un **“Cowork” de escritorio**: un espacio donde el usuario
describe un objetivo y un **equipo de agentes de IA** lo ejecuta usando el ordenador
(navegador, terminal, archivos, conectores y servidores MCP). Los conceptos que aparecen
en el código y en la UI son:

| Concepto | Evidencia | Significado |
| --- | --- | --- |
| **Workforce** | `src/components/WorkforceMenu`, `backend/app/utils/workforce.py` | Conjunto de agentes (coordinador + trabajadores) asignados a una tarea. |
| **Worker** | `components/AddWorker`, `utils/single_agent_worker.py` | Agente individual con modelo, tools y prompt propios. |
| **Space** | `components/SpacesHub`, `store/spaceStore.ts`, `spaceApi.ts` | Espacio de trabajo persistente (proyecto) con archivos, historial y configuración. |
| **Session / Run** | `store/sessionExecutionStore.ts`, `service/runsApi.ts`, `backend/app/run_runtime` | Una ejecución concreta de una tarea, con eventos, estado y journal. |
| **Hands** | `backend/app/hands/*` | “Manos”: capacidades de actuación (terminal, navegador, archivos, MCP). |
| **Skills** | `resources/example-skills/*/SKILL.md`, `backend/app/controller/skill_controller.py` | Paquetes de instrucciones + scripts que el agente puede cargar. |
| **Trigger** | `components/Trigger`, `triggerApi.ts`, `triggerStore.ts` | Automatizaciones programadas o por evento. |
| **Workspace Bundle** | `backend/app/workspace_bundle/*` | Paquete instalable de configuración (agentes, skills, MCP). |

La propuesta es, por tanto, **orquestación de agentes con acceso real al sistema**,
empaquetada como aplicación de escritorio *local-first* y con un servidor opcional para
sincronización, cuentas y ejecución remota.

---

## 2. Arquitectura de un vistazo

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│ Electron (proceso principal)                                                │
│  · ventana, menús, actualizaciones, secretos, terminal PTY, webview         │
│  · fileReader/fileRange/localFileSecurity · closeCoordinator                │
│  · brainStreamRelay (puente de streaming con el backend)                    │
└───────────────▲───────────────────────────────────────────┬─────────────────┘
                │ preload (contextBridge)                    │ IPC
┌───────────────┴───────────────────────────────────────────▼─────────────────┐
│ Renderer React (Vite)                                                       │
│  · pages/Workspace · components/{ChatBox,Workflow,Dashboard,Terminal,…}     │
│  · Zustand (≈30 stores) · TanStack Query · react-router 7 · i18next         │
│  · service/* clientes HTTP · host/{desktop,web} · api/brainStreamRelay      │
└───────────────▲───────────────────────────────────────────┬─────────────────┘
                │ HTTP/SSE (localhost:5001)                  │ HTTPS (opcional)
┌───────────────┴───────────────────────────────────────────▼─────────────────┐
│ "Brain" local (Python/FastAPI)            │ Servidor cloud/self-hosted       │
│  · controllers (REST)                     │  · FastAPI + PostgreSQL          │
│  · router_layer / message_router          │  · Alembic, Celery, Docker       │
│  · agent/ (CAMEL) · toolkit · prompt      │  · auth, spaces, historial,      │
│  · run_runtime · run_journal              │    triggers, suscripciones       │
│  · workspace_runtime / workspace_git      │                                  │
│  · hands (terminal, browser, fs, MCP)     │                                  │
│  · memory (local + Qdrant) · telemetry    │                                  │
└───────────────────────────────────────────┴──────────────────────────────────┘
```

**Observación clave:** Eigent no es una app Electron con un backend embebido cualquiera;
es un **sistema de dos lenguajes** (TypeScript para el producto, Python para la
inteligencia) unidos por **HTTP + streaming de eventos** y por el **sistema de archivos**
del espacio de trabajo. Esa separación permite:

- reutilizar el ecosistema de agentes de CAMEL sin reimplementarlo en JS;
- ejecutar el “brain” en local o en un servidor remoto (`EIGENT_DEPLOYMENT_TYPE`);
- mantener la UI reactiva mientras los agentes trabajan en segundo plano.

---

## 3. Capa de escritorio (Electron)

### 3.1 Proceso principal

El directorio `electron/main/` está dividido por responsabilidades (observado):

| Módulo | Responsabilidad inferida |
| --- | --- |
| `index.ts`, `init.ts`, `appShellReadinessGate.ts` | Arranque, orden de inicialización y “gate” para no mostrar la UI hasta que el shell esté listo. |
| `windowState.ts`, `closeCoordinator.ts` | Persistencia de tamaño/posición y coordinación del cierre (esperar procesos hijos). |
| `terminal.ts`, `terminalProcessTree.ts` | PTY y árbol de procesos para poder matar todo lo lanzado por los agentes. |
| `fileReader.ts`, `fileRange.ts`, `localFileUrl.ts`, `localFileSecurity.ts`, `localPathActions.ts` | Lectura segura de archivos locales, rangos (archivos grandes), URLs `file://` controladas y acciones sobre rutas. |
| `workspaceSecrets/`, `localFileSecurity.ts` | Almacenamiento de secretos del espacio de trabajo y validación de rutas (path traversal). |
| `brainStreamRelay.ts` | Retransmisión del stream del backend al renderer. |
| `update.ts`, `githubReleaseCdnProvider.ts` | Auto-actualización desde releases de GitHub/CDN. |
| `webview.ts`, `native/` | Webviews para el navegador del agente e integraciones nativas. |
| `install-deps.ts`, `utils/` | Instalación de dependencias (uv, bun, Python) en el primer arranque. |
| `subscriptionAuth/` | Autenticación de suscripción (modelos en la nube). |
| `reviewChanges.ts` | Revisión de cambios del workspace (posible integración git/diff). |

### 3.2 Preload y contrato IPC

`electron/preload/index.ts` expone una API acotada con `contextBridge`
(`contextIsolation: true`); el renderer nunca accede a Node directamente. Los tipos del
contrato están en `electron/electron.d.ts` y `src/types/electron.d.ts`.

**Patrón destacable:** el *preload* es la **frontera de seguridad** y el renderer es
consciente de la plataforma mediante `src/client/{desktop,web}` y `src/host/createHost.ts`.
El mismo código React puede correr como app de escritorio o como web, inyectando
implementaciones distintas de archivos, ventanas y secretos.

### 3.3 Empaquetado

- `electron-builder.json` + `build/icon.{icns,ico,png}` + `build/installer.nsh`.
- `config/notarize.cjs` y `entitlements.mac.plist`: notarización y *hardened runtime* en macOS.
- Scripts `build:mac`, `build:win`, `build:linux`, `build:all`, con `prebuild:deps`
  (instala Python/uv, compila Babel, corrige rutas de venv y symlinks).
- `scripts/test-signing.js`, `test-notarization.js`: verificaciones de firma antes de publicar.

**Lección:** el coste real de una app de escritorio con Python embebido está en el
*packaging* (venv relocalizable, symlinks, permisos de `node-pty`), no en la UI. Eigent lo
automatiza con una cadena de scripts idempotentes.

---

## 4. Capa de renderer (React)

### 4.1 Stack exacto (observado en `package.json`)

| Dependencia | Versión | Uso |
| --- | --- | --- |
| `react` / `react-dom` | ^18.3.1 | UI. |
| `vite` | ^5.4.11 | Build/dev server. |
| `typescript` | 5.9.3 | Tipado estricto. |
| `zustand` | ^5.0.4 | Estado global (≈30 stores). |
| `@tanstack/react-query` | ^5.90.19 | Estado servidor (caché, reintentos). |
| `react-router-dom` | ^7.6.0 | Rutas. |
| `tailwindcss` | 4.3.3 | Estilos utilitarios. |
| `@radix-ui/react-dialog` | 1.2.0 | Primitivas accesibles (y otros paquetes Radix). |
| `framer-motion` | ^12.17.0 | Animaciones. |
| `monaco-editor` | ^0.52.2 | Editor de código/archivos. |
| `lucide-react` | ^0.548.0 | Iconografía. |
| `react-i18next` | ^15.7.3 | i18n. |
| `tailwind-merge`, `class-variance-authority` | ^3.3.0 / ^0.7.1 | Composición de clases y variantes. |
| `axios` | ^1.9.0 | Cliente HTTP. |
| `vitest`, `@playwright/test`, `storybook` | 2.1.9 / ^1.48.2 / ^10.1.11 | Pruebas y catálogo de componentes. |

### 4.2 Organización

```text
src/
├── api/            # brain.ts, brainStreamRelay.ts, connectors.ts, http.ts
├── client/         # abstracción desktop/web (platform.ts)
├── components/     # ~40 dominios: ChatBox, Workflow, Dashboard, Terminal,
│                   #   Workspace, SpacesHub, Trigger, ModelSelection, ui/…
├── context/        # ConnectionContext
├── hooks/          # ~55 hooks (ejecución, streaming, layout, updater, cuotas…)
├── lib/            # ~75 utilidades (projector, runEvents, remoteControl, skills…)
├── pages/          # Login, SignUp, Workspace, Settings, RemoteControl, NotFound
├── routers/        # rutas + compatibilidad legacy
├── service/        # clientes por dominio (runs, spaces, memory, triggers, git…)
├── store/          # ~30 stores Zustand
├── style/          # tokens, generated, css
├── types/          # contratos TS
├── i18n/           # locales
└── host/           # createHost + tipos
```

**Patrón 1 — separación `service` / `store` / `hooks`.**
`service/*` encapsula endpoints; `store/*` guarda estado de UI y proyecciones de eventos;
`hooks/*` compone ambos. Esto evita que los componentes hablen HTTP directamente.

**Patrón 2 — proyección de eventos.**
`lib/projector`, `lib/runEvents`, `store/projectEventStore.ts`,
`hooks/useProjectEventRuntime.tsx` y `service/projectRunEventStream.ts` sugieren que el
backend emite **eventos de ejecución** (stream) y el frontend los **proyecta** a un estado
consultable (timeline del chat, estado de tareas, uso de tokens). Es el equivalente a un
*event sourcing* ligero en el cliente.

**Patrón 3 — reanudación y reconciliación.**
`runStateReconciliation`, `reconcileLegacyRunState`, `runCloseGuard`,
`humanInteractionReconciliation`, `useInterruptedRunStatus`: la UI está diseñada para
**reconectar** tras un cierre, un corte de red o una ejecución remota, y para no perder
interacciones pendientes (aprobaciones humanas).

**Patrón 4 — interacción humana.**
`humanInteractionApi`, `approvalPresentation`, `useHumanInteractionExpiry`: los agentes
pueden pausar y pedir aprobación (permisos, comandos peligrosos), con caducidad.

**Patrón 5 — host abstracto.**
`createHost()` + `client/desktop`/`client/web` permiten una versión web del mismo producto.
Es una decisión de arquitectura poco común en apps Electron y muy reutilizable.

---

## 5. Capa de agentes (backend Python)

### 5.1 Dependencias (observado en `backend/pyproject.toml`)

- Python `>=3.11,<3.12`; gestión con **uv** (`uv.lock`).
- `camel-ai[eigent]==0.2.91a7` — framework multiagente de CAMEL-AI (fork/extra propio).
- `fastapi>=0.115.12`, `uvicorn[standard]`, `pydantic-i18n`, `fastapi-babel`.
- `httpx[socks]` (proxies), `qdrant-client` (memoria vectorial), `numpy<2`.
- `opentelemetry-*` (trazas), `jsonschema` (validación de bundles), `truststore`.
- `nodejs-wheel` (Node embebido para herramientas JS).
- Calidad: `ruff` (lint/format), `pytest`, `pre-commit`, `bandit`.

### 5.2 Capas internas

```text
backend/app/
├── main.py / router.py        # FastAPI app y agregación de routers
├── controller/                # endpoints REST por dominio
├── service/                   # lógica de aplicación (chat, skills, runs, MCP…)
├── agent/                     # construcción de agentes CAMEL (factory, toolkit, prompt)
├── router_layer/              # enrutado de mensajes y resolución de "hands"
├── run_runtime/               # ciclo de vida de un run (admisión, pasos, timeouts)
├── run_journal/               # registro semántico de eventos + proyecciones
├── run_sync/                  # sincronización local ↔ cloud
├── workspace_runtime/         # preparación/ejecución/merge del workspace por run
├── workspace_git/             # snapshots, mutaciones, retención, publicación
├── workspace_config/          # manifiestos, capacidades, modelos, migraciones
├── workspace_bundle/          # instalación/exportación de paquetes de configuración
├── permission_policy/         # política de permisos por herramienta/acción
├── hands/                     # terminal, navegador, filesystem, MCP (local/remoto/sandbox)
├── memory/ + lightweight_memory/  # memoria a corto/largo plazo, contexto, mantenimiento
├── model/                     # adaptadores de proveedores, esfuerzo, sesión
├── auth/                      # brain_auth, local_control
├── file_access/               # acceso local vs subida
├── hardware/                  # puente hardware (null_bridge por defecto)
├── channels/, component/, exception/, middleware/, utils/
```

### 5.3 Ciclo de vida de una ejecución (inferido de los nombres)

```text
POST /run (controller/run_controller.py)
  │
  ├─ run_runtime/admission.py        → ¿hay cuota/permiso/espacio?
  ├─ workspace_runtime/preparation   → prepara carpeta, git snapshot, configuración
  ├─ agent/factory                   → construye coordinador + workers (CAMEL)
  ├─ run_runtime/coordinator         → bucle de pasos y reparto de tareas
  │    ├─ step_coordinator           → decide siguiente acción
  │    ├─ tool_checkpoint            → puntos de control antes de acciones destructivas
  │    ├─ permission_policy/engine   → ¿permitido? ¿requiere aprobación humana?
  │    └─ hands/*                    → ejecuta terminal/navegador/ficheros/MCP
  ├─ run_journal/recorder            → registra eventos semánticos + uso de modelo
  ├─ run_sync/*                      → replica a la nube si aplica
  └─ workspace_runtime/finalizer     → merge/limpieza, resultado, artefactos
```

Los módulos `active_timeout`, `timeout_config`, `owned_tasks` y `execution_observation`
indican un diseño defensivo: cada run tiene **presupuesto de tiempo**, tareas propias y
observabilidad, y puede cancelarse (`service/run_cancellation.py`).

### 5.4 Separación “brain” local vs servidor

`backend/README.md` documenta el *standalone mode*:

```bash
uv run uvicorn main:api --port 5001
# o
uv run python main.py
```

Variables: `EIGENT_BRAIN_PORT` (5001), `EIGENT_WORKSPACE` (`~/.eigent/workspace`),
`EIGENT_DEPLOYMENT_TYPE` (`local`/`cloud_vm`/`sandbox`/`docker`),
`EIGENT_HANDS_MODE=remote`, `EIGENT_HANDS_CLUSTER_CONFIG_FILE` (TOML),
`EIGENT_HANDS_TERMINAL/BROWSER/FILESYSTEM/MCP`.

El **mismo backend** puede correr en el escritorio o en una VM, y las “hands” deciden
*desde dónde* se actúa. `hands/routed_hands_cluster.py` y `http_hands_cluster.py` sugieren
un clúster de capacidades con enrutado por política.

---

## 6. Multiagente: cómo se organiza el trabajo

Aunque no se ha leído el prompt completo, la estructura permite reconstruir el modelo:

1. **Coordinador** (`agent/listen_chat_agent.py`, `utils/workforce.py`): interpreta el
   objetivo, lo descompone y asigna tareas.
2. **Workers** (`utils/single_agent_worker.py`, `utils/managed_workforce.py`): agentes
   especializados, cada uno con su modelo, herramientas y memoria.
3. **Toolkit** (`agent/toolkit/`, `agent/tools.py`): funciones expuestas al modelo
   (shell, navegador, archivos, MCP, skills).
4. **Mensajería** (`router_layer/message_router.py`): entrega de mensajes entre agentes y
   hacia la UI; `session_store.py` mantiene el estado de la conversación.
5. **Observación** (`run_journal`, `execution_observation`): cada paso se registra para
   auditoría, reanudación y reproducción (`lib/replay.ts` en el frontend).

**Patrón destacable:** el “workforce” es **configurable por espacio** (`spaceModelBinding`,
`workProfiles`, `WorkspaceConfiguration`), es decir, el usuario elige qué modelos y qué
agentes trabajan en cada proyecto. Esto convierte el producto en una plataforma, no en un
chat con herramientas.

---

## 7. “Hands”: la capa de actuación

`backend/app/hands/` define interfaces y varias implementaciones:

| Archivo | Función inferida |
| --- | --- |
| `interface.py`, `capabilities.py` | Contrato y matriz de capacidades. |
| `environment_hands.py` | Actuación sobre el entorno local. |
| `full_hands.py` | Acceso completo (sin restricciones de workspace). |
| `sandbox_hands.py` | Ejecución aislada. |
| `remote_hands.py`, `http_hands_cluster.py`, `routed_hands_cluster.py` | Actuación en un clúster remoto vía HTTP, con enrutado. |
| `cluster_config.py` | Configuración TOML de clústeres. |

La decisión de diseño es notable: **las capacidades no están codificadas en el agente**,
sino inyectadas según el despliegue. El mismo agente puede tener terminal local, un
sandbox o un contenedor remoto sin cambiar su prompt.

Complementos:

- `utils/browser_launcher.py`, `cdp_browser_state.py`, `cookie_manager.py`: navegador real
  vía Chrome DevTools Protocol, con perfiles (`config/browser-profiles.json`).
- `utils/toolchain_preflight.py`: comprueba que las herramientas necesarias existen antes
  de ejecutar.
- `utils/telemetry/`: trazas OTel.
- `workload/`: control de concurrencia/carga.

---

## 8. Skills: el sistema de extensibilidad

Un *skill* es una carpeta con un `SKILL.md` (frontmatter YAML + instrucciones) y,
opcionalmente, scripts y recursos. Ejemplo real (`resources/example-skills/docx/SKILL.md`):

```markdown
---
name: docx
description: "Use this skill whenever the user wants to create, read, edit, or manipulate
Word documents (.docx files). Triggers include: any mention of \"Word doc\"…
license: Proprietary. LICENSE.txt has complete terms
---

# DOCX creation, editing, and analysis

## Quick Reference
| Task | Approach |
|------|----------|
| Read/analyze content | pandoc or unpack for raw XML |
| Create new document | docx-js |
…
```

Skills incluidos (observado): `docx`, `pdf`, `pptx`, `xlsx`, `skill-creator`,
`skill-security-auditor`. Cada uno trae scripts (por ejemplo, conversión con LibreOffice,
unpack/repack de OOXML, validación).

**Cómo se cargan (inferido):** `skill_controller.py` + `skill_service.py` +
`skill_config_service.py` + `store/skillsStore.ts` + `lib/skillToolkit.ts`. El modelo ve
el `name`/`description` y decide cargar el skill; el contenido se inyecta como contexto y
los scripts se ejecutan con las *hands*.

**Lecciones:**

1. El formato es **texto plano versionable** (no plugins binarios): fácil de auditar,
   diffear y generar.
2. La `description` es el mecanismo de *discovery*: incluye “triggers” explícitos.
3. `skill-creator` y `skill-security-auditor` demuestran que el ecosistema se puede
   autoextender y auditar.
4. `workspace_bundle/` convierte un conjunto de skills+agentes+MCP en un **paquete
   instalable**, con `secrets.py` y `mcp_destination.py` para no filtrar credenciales.

---

## 9. Memoria, contexto y journal

| Componente | Evidencia | Función |
| --- | --- | --- |
| Memoria local | `memory/local_store.py`, `memory/service.py`, `memory/paths.py` | Persistencia de recuerdos por espacio. |
| Memoria vectorial | `qdrant-client` en dependencias | Búsqueda semántica. |
| Context builder | `memory/context_builder.py` | Selección de recuerdos para el prompt. |
| Memoria ligera | `lightweight_memory/{maintainer,service,legacy_importer}.py` | Resumen/mantenimiento y migración. |
| Run journal | `run_journal/{recorder,store,transitions,semantic_events,models}.py` | Registro de eventos de ejecución. |
| Proyecciones | `run_journal/{context_projection,managed_context_projection,otel_projection,cloud_projection}.py` | Vistas del journal para contexto, OTel y nube. |
| Presupuesto de contexto | `managed_context_budget.py` | Control de tokens. |
| Política de memoria | `memory_policy.py` | Qué se guarda y qué se descarta. |

**Patrón destacable:** el journal es **la fuente de verdad** de lo ocurrido; las
proyecciones se derivan de él. Eso habilita *replay*, auditoría, métricas y sincronización
sin acoplar la UI al estado interno del agente.

---

## 10. Workspace: git, bundles y configuración

- **`workspace_git/`** (17 módulos): snapshots antes/después de cada run, mutaciones,
  observación de cambios, retención, publicación y políticas de rutas. Es un **git
  interno** para poder revisar y revertir lo que hicieron los agentes
  (`electron/main/reviewChanges.ts` conecta con la UI de revisión).
- **`workspace_runtime/`** (26 módulos): prepara el espacio por ejecución, enruta al
  agente, ejecuta, hace *merge* y finaliza; incluye tokenizadores y métricas.
- **`workspace_config/`**: manifiesto del espacio, descubrimiento de capacidades,
  selección de modelos, recursos globales, admisión y migración legacy.
- **`workspace_bundle/`**: autoría, instalación, secretos, destino MCP, plugins de agente.

**Lección:** tratar el espacio de trabajo como un **repositorio con snapshots** es lo que
hace segura la autonomía. Sin eso, un agente que borra archivos es un incidente; con eso,
es un *commit* reversible.

---

## 11. Servidor cloud / self-hosted

`server/` es un segundo backend, independiente del “brain”:

```text
server/
├── app/{api,core,domains,model,shared}   # arquitectura por dominios
├── alembic/ + alembic.ini                # migraciones PostgreSQL
├── celery/{worker,beat}                  # tareas asíncronas y programadas
├── docker-compose.yml / Dockerfile       # despliegue
├── start.sh / start_server.{sh,bat,ps1}
├── doc/server-refactor-v1.md             # ADR del refactor
└── tests/ (≈20 suites)
```

Dominios inferidos: autenticación, espacios, historial de chat, triggers, proveedores de
modelo, uso/cuotas, compartición, control remoto, migración. Los tests mencionan
`test_database_safety`, `test_remote_control_security`, `test_space_write_lock`,
`test_provider_model_catalog`, `test_self_hosted_migration_scope`.

**Patrón:** el servidor es **opcional**; la app funciona en local y sincroniza cuando hay
cuenta. Eso reduce el coste de infraestructura y permite despliegues *self-hosted*.

---

## 12. Sistema de diseño

`docs/design-system/design.md` es un contrato activo, no documentación decorativa:

- **Cuatro capas + registro de excepciones**: Reference (dimensiones, tipografía, temas) →
  Semantic (intención: Accent, Neutral, Ink, Hairline) → Component recipe (geometría y
  *chrome* de primitivas) → Pattern (composiciones repetidas) → Exception registry.
- **Fuente de verdad ejecutable**: `src/style/tokens/*.json` y `src/components/ui`;
  `src/style/generated` es **salida determinista** que no se edita a mano.
- **Utilidades públicas**: `bg-ds-neutral-subtle-default`,
  `text-ds-ink-muted-default`, `border-ds-hairline-default-default`, `ring-ds-ring-focus`.
- **Reglas de agente**: antes de tocar UI, leer el contrato, la superficie más cercana,
  las primitivas y los tokens; si falta una receta, **no** esconder la decisión en un
  `className` largo: reutilizar, extender o registrar una excepción con dueño y motivo.
- **Guías de movimiento, accesibilidad, zoom 200 %, modo oscuro, reducción de movimiento**.

### Guardas automáticas (observadas en `scripts/`)

| Script | Qué vigila |
| --- | --- |
| `generate-design-tokens.mjs` | Genera tokens desde las fuentes JSON. |
| `check-design-token-usage.mjs` | Prohíbe valores “mágicos” fuera de tokens. |
| `check-design-system-clean-tree.mjs` | El árbol generado está limpio/actualizado. |
| `check-retired-ds-axes.mjs` | No se usan ejes retirados del sistema. |
| `verify-theme-tokens.ts`, `verify-tailwind4.mjs` | Coherencia de temas y Tailwind 4. |
| `check-css-writing-standard.mjs` | Estándar de CSS. |
| `check-changed-format.mjs`, `run-changed-vitest.mjs` | Formato y pruebas solo de lo cambiado. |
| `check-i18n-locale-parity.js`, `check-i18n-source-usage.mjs` | Paridad de locales y uso correcto de i18n. |
| `design-token-usage.allowlist` | Excepciones explícitas y versionadas. |

**Lección directamente aplicable a SirpefOffice:** convertir el diseño en **tokens +
recetas + guardas** evita que la UI derive. En SirpefOffice ya existen tokens CSS
(`--color-*`, `--sheet-*`) y una hoja `.doc-sheet`; el siguiente paso sería un verificador
que impida colores/tamaños literales en componentes.

---

## 13. Build, release y calidad

### Cadena de build (observada)

```text
npm run dev            → limpia caché de Vite y arranca
npm run build          → prebuild:
                          1. preinstall-deps (uv, bun, Python, node-pty)
                          2. compile-babel
                          3. fix-venv-paths
                          4. fix-symlinks → clean-symlinks
                          5. tsc -p tsconfig.build.json && vite build
                       → electron-builder --publish never
npm run build:<os>     → variantes por plataforma
npm run build:publish  → publica releases
```

### Pruebas

- **451 rutas** en `test/` (E2E con Playwright, componentes con Vitest/Storybook).
- `backend/tests` con pytest; `server/tests` con pytest (≈20 suites).
- `scripts/smoke-web-local-brain.sh`: humo del brain local.
- Pre-commit + Husky + Ruff + ESLint.

**Lección:** los *smoke tests* de extremo a extremo (arrancar el brain, abrir la web,
comprobar flujos) son más valiosos que muchos unit tests en un producto con tantas
integraciones.

---

## 14. Seguridad (lo que se puede observar)

| Mecanismo | Evidencia | Comentario |
| --- | --- | --- |
| Aislamiento de renderer | `contextIsolation`, preload acotado | Patrón Electron estándar bien aplicado. |
| Seguridad de archivos locales | `localFileSecurity.ts`, `localPathActions.ts`, `path_policy.py` | Validación de rutas y URLs. |
| Secretos | `workspaceSecrets/`, `workspace_bundle/secrets.py` | Secretos por espacio, no globales. |
| Permisos por herramienta | `permission_policy/{engine,tool_actions,runtime}.py` | Política declarativa + aprobación humana. |
| Sandbox / remoto | `sandbox_hands.py`, `remote_hands.py` | La capacidad se elige por despliegue. |
| Autenticación local | `auth/local_control.py`, `brain_auth.py` | El brain local no queda abierto sin control. |
| Validación de bundles | `jsonschema`, `tool_validation.py` | Los paquetes instalables se validan. |
| Auditoría | `run_journal`, `activities` en servidor | Trazabilidad de acciones. |
| Dependencias | `bandit` configurado, `truststore` | Análisis estático y CA del sistema. |

**Riesgo inherente del producto:** un agente con terminal y navegador tiene un radio de
acción enorme. Eigent lo mitiga con *snapshots* git, permisos por acción, sandbox y
aprobaciones; cualquier reimplementación debe copiar **las cuatro**, no solo una.

---

## 15. Patrones que merece la pena copiar

1. **Separar el “cerebro” del producto.** La UI no sabe cómo razona el agente; habla por
   HTTP/SSE. Permite cambiar de modelo, de runtime o de despliegue sin tocar React.
2. **Eventos + proyecciones.** El journal es la verdad; la UI deriva estado. Facilita
   reanudar, auditar y replicar.
3. **Capacidades inyectadas (“hands”).** El mismo agente opera en local, sandbox o remoto.
4. **Snapshots del workspace.** Autonomía reversible; revisión de cambios tipo git.
5. **Skills como texto.** `SKILL.md` + scripts es simple, auditable y extensible.
6. **Contrato de diseño con guardas.** Los tokens no son sugerencias: el CI lo verifica.
7. **Host abstracto.** Un solo renderer para escritorio y web.
8. **Empaquetado como código.** Scripts idempotentes para venv, symlinks, firmas y
   notarización; el release es reproducible.
9. **Interacción humana de primera clase.** Aprobaciones con caducidad y reconciliación.
10. **Configuración por espacio.** Modelos, agentes y skills se eligen por proyecto.

---

## 16. Comparativa con SirpefOffice

| Dimensión | Eigent | SirpefOffice |
| --- | --- | --- |
| Propósito | Orquestar agentes que actúan sobre el equipo | Crear y gestionar documentos administrativos |
| Superficie | Electron + React + Python | Web (Vue 3) + Node |
| Estado | Zustand + TanStack Query + event projection | Pinia mínimo + estado local + autoguardado |
| IA | Núcleo del producto (multiagente, tools, memoria) | Asistente opcional que rellena variables |
| Persistencia | Workspace + git + Qdrant + run journal + PostgreSQL (cloud) | PostgreSQL (documentos JSONB + versiones) |
| Extensibilidad | Skills, MCP, bundles, hands | Plantillas, diseños y variables tipadas |
| Diseño | Sistema de tokens con guardas CI | Tokens CSS + hoja documental |
| Colaboración | Sesiones/espacios y control remoto | Compartición por documento (sin tiempo real) |
| Complejidad | Muy alta (dos backends, empaquetado nativo) | Media (un backend, sin binarios) |

**Conclusión:** Eigent es una referencia de **arquitectura de agentes y de ingeniería de
producto**, no de edición de documentos. SirpefOffice debe tomar prestadas las ideas de
*event journal*, *snapshots*, *skills como texto* y *guardas de diseño*, pero su núcleo
—el documento y su fidelidad— exige un motor propio (que ya tiene).

---

## 17. Limitaciones de este análisis

- No se ha ejecutado la aplicación ni inspeccionado el binario; no hay análisis dinámico,
  de red ni de rendimiento.
- Los nombres de módulos permiten inferir responsabilidades, pero no garantizan el
  comportamiento exacto (marcado como **inferido**).
- No se han auditado los prompts de los agentes ni la implementación completa de
  `run_runtime`, `hands` o `workspace_git`.
- Algunas carpetas (`package/`, `test/`) contienen artefactos y pruebas cuyo contenido no
  se ha revisado en detalle.
- Las versiones citadas corresponden a la etiqueta `1.0.6`; el proyecto evoluciona rápido.

### Cómo reproducir la inspección

```bash
git clone https://github.com/eigent-ai/eigent.git
cd eigent

# inventario del árbol
git ls-files | awk -F/ '{print $1}' | sort | uniq -c | sort -rn

# stack y scripts
cat package.json | jq '{version, scripts, dependencies, devDependencies}'
cat backend/pyproject.toml
cat server/pyproject.toml

# diseño
sed -n '1,200p' docs/design-system/design.md
ls scripts | grep check-

# skills
find resources/example-skills -name SKILL.md -maxdepth 2
```

---

## 18. Apéndice: evidencias citadas

| Afirmación | Archivo/evidencia |
| --- | --- |
| Versión 1.0.6 | `package.json` |
| Electron 33, React 18, Vite 5, Tailwind 4.3.3 | `package.json` |
| CAMEL `0.2.91a7`, FastAPI, Qdrant, OTel | `backend/pyproject.toml` |
| Puerto 5001 y modo standalone | `backend/README.md` |
| Hands locales/remotas/sandbox | `backend/app/hands/*.py` |
| Journal y proyecciones | `backend/app/run_journal/*.py` |
| Política de permisos | `backend/app/permission_policy/*.py` |
| Snapshots git del workspace | `backend/app/workspace_git/*.py` |
| Skills de ejemplo | `resources/example-skills/*/SKILL.md` |
| Guardas de diseño | `scripts/check-design-*.mjs`, `generate-design-tokens.mjs` |
| 4 capas + excepciones | `docs/design-system/design.md` |
| Servidor con Alembic/Celery | `server/alembic/`, `server/celery/` |
| Empaquetado y notarización | `electron-builder.json`, `config/notarize.cjs`, `build/` |
| Pruebas | `test/` (451 rutas), `backend/tests`, `server/tests` |
