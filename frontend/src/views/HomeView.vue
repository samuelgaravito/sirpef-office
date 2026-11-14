<script setup lang="ts">
import {
  ArrowRight,
  BarChart3,
  Clock,
  FileText,
  Inbox,
  LayoutTemplate,
  Loader2,
  Palette,
  Plus,
  Search,
  Send,
} from 'lucide-vue-next';
import { computed, onMounted, onUnmounted, ref, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import NewDocumentDialog from '@/components/documents/NewDocumentDialog.vue';
import ActivityFocus from '@/components/home/ActivityFocus.vue';
import ModuleDock from '@/components/home/ModuleDock.vue';
import OnboardingCard from '@/components/home/OnboardingCard.vue';
import WorkspaceGauge from '@/components/home/WorkspaceGauge.vue';
import WorkspaceStatsDialog from '@/components/home/WorkspaceStatsDialog.vue';
import AppShell from '@/components/layout/AppShell.vue';
import ModulePanel from '@/components/layout/ModulePanel.vue';
import { useCreateDocument } from '@/composables/useCreateDocument';
import { useInboxBadge } from '@/composables/useInboxBadge';
import { useToast } from '@/composables/useToast';
import { relativeTime } from '@/lib/labels';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import type { DocumentSummary, InboxMessageSummary, ListResponse } from '@/types';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const toast = useToast();
const { creating, createDocument } = useCreateDocument();
const { totalCount, pendingCount, refresh: refreshInbox } = useInboxBadge();

const counts = ref({ documents: 0, drafts: 0, templates: 0, designs: 0 });
const shellLoading = ref(true);
/** Selector de modelo: la puerta de entrada para crear un documento. */
const pickerOpen = ref(false);
/** Panel estadístico que se abre desde el círculo del gauge. */
const statsOpen = ref(false);

/** Punto de la ventana desde el que "nace" el panel del módulo. */
const panelOrigin = ref<{ x: number; y: number } | null>(null);

const pendingItems = ref<InboxMessageSummary[]>([]);
const pendingLoading = ref(false);
const pendingUpdatedAt = ref<Date | null>(null);

/** Últimos documentos en los que trabajó la persona (borradores o enviados). */
const recentDocuments = ref<DocumentSummary[]>([]);
/** Envíos propios esperando la aprobación del jefe. */
const waitingApproval = ref<InboxMessageSummary[]>([]);
/** Borradores que solo viven en este navegador (aún sin fila en el servidor). */
const localDrafts = ref<LocalDraftItem[]>([]);
const activityLoading = ref(false);

interface LocalDraftItem {
  key: string;
  title: string;
  savedAt: string;
  templateId: string | null;
}

const DRAFT_PREFIX = 'sirpef:doc-draft:';

/** Lee los borradores locales para que no queden escondidos en el navegador. */
function readLocalDrafts(): LocalDraftItem[] {
  const found: LocalDraftItem[] = [];
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index);
      if (!key?.startsWith(DRAFT_PREFIX)) continue;
      const raw = window.localStorage.getItem(key);
      if (!raw) continue;
      const draft = JSON.parse(raw) as { title?: string; savedAt?: string };
      const suffix = key.slice(DRAFT_PREFIX.length);
      found.push({
        key,
        title: draft.title?.trim() || 'Documento sin título',
        savedAt: draft.savedAt ?? '',
        templateId: suffix === 'blank' ? null : suffix,
      });
    }
  } catch {
    // Almacenamiento no disponible: no hay borradores locales que mostrar.
  }
  return found
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
    .slice(0, 3);
}

function resumeLocalDraft(draft: LocalDraftItem): void {
  void router.push({
    name: 'document-new',
    query: draft.templateId ? { template: draft.templateId } : {},
  });
}

const displayedDocuments = ref(0);
let countFrame: number | undefined;

const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
});

const firstName = computed(() => auth.user?.name?.split(/\s+/)[0] ?? '');
const overlayOpen = computed(() => route.meta.overlay === true);
const drafts = computed(() => counts.value.drafts);
const canSeeDocuments = computed(() => auth.canSeeMenu('documents'));
const canSeeTemplates = computed(() => auth.canSeeMenu('templates'));
const canSeeDesigns = computed(() => auth.canSeeMenu('designs'));
const canSeeInbox = computed(() => auth.canSeeMenu('inbox'));

interface ModuleTile {
  key: string;
  label: string;
  description: string;
  icon: Component;
  route: string;
  value: string;
  caption: string;
  badge?: number;
}

const tiles = computed<ModuleTile[]>(() => {
  const list: ModuleTile[] = [];

  if (canSeeInbox.value) {
    list.push({
      key: 'inbox',
      label: 'Bandeja',
      description: 'Aprobaciones, avisos y mensajes',
      icon: Inbox,
      route: 'inbox',
      value: totalCount.value > 0 ? String(totalCount.value) : 'Al día',
      caption: totalCount.value > 0 ? `${pendingCount.value} por revisar` : 'Sin pendientes',
      badge: totalCount.value,
    });
  }

  if (canSeeDocuments.value) {
    list.push({
      key: 'documents',
      label: 'Documentos',
      description: 'Crea, edita y comparte documentos',
      icon: FileText,
      route: 'documents',
      value: String(counts.value.documents),
      caption: drafts.value > 0 ? `${drafts.value} en borrador` : 'Todo al día',
    });
  }

  if (canSeeTemplates.value) {
    list.push({
      key: 'templates',
      label: 'Plantillas',
      description: 'Modelos institucionales reutilizables',
      icon: LayoutTemplate,
      route: 'templates',
      value: String(counts.value.templates),
      caption: 'activas',
    });
  }

  if (canSeeDesigns.value) {
    list.push({
      key: 'designs',
      label: 'Diseños',
      description: 'Identidad visual de tus documentos',
      icon: Palette,
      route: 'designs',
      value: String(counts.value.designs),
      caption: 'disponibles',
    });
  }

  return list;
});

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Animación de conteo para el subtítulo del hero. */
function animateDocuments(target: number): void {
  if (countFrame !== undefined) cancelAnimationFrame(countFrame);
  if (prefersReducedMotion()) {
    displayedDocuments.value = target;
    return;
  }

  const from = displayedDocuments.value;
  const start = performance.now();
  const duration = 650;

  const step = (now: number): void => {
    const progress = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - progress, 3);
    displayedDocuments.value = Math.round(from + (target - from) * eased);
    if (progress < 1) countFrame = requestAnimationFrame(step);
  };

  countFrame = requestAnimationFrame(step);
}

async function totalOf(path: string, params: Record<string, unknown>): Promise<number> {
  const data = await api.get<ListResponse<unknown>>(path, { ...params, pageSize: 1 });
  return data.total ?? data.items.length;
}

async function loadPending(): Promise<void> {
  if (!canSeeInbox.value) return;
  pendingLoading.value = true;
  try {
    const data = await api.get<ListResponse<InboxMessageSummary>>('/inbox', {
      scope: 'received',
      pageSize: 3,
    });
    pendingItems.value = data.items;
    pendingUpdatedAt.value = new Date();
  } catch {
    // El foco de actividad es accesorio: si falla no rompe el panel.
  } finally {
    pendingLoading.value = false;
  }
}

/** Últimos documentos y envíos esperando al jefe. */
async function loadActivity(): Promise<void> {
  activityLoading.value = true;
  const tasks: Promise<unknown>[] = [];

  if (canSeeDocuments.value) {
    tasks.push(
      api
        .get<ListResponse<DocumentSummary>>('/documents', {
          scope: 'all',
          sort: 'updated',
          pageSize: 5,
        })
        .then((data) => {
          recentDocuments.value = data.items;
        })
        .catch(() => {
          recentDocuments.value = [];
        }),
    );
  }

  if (canSeeInbox.value) {
    tasks.push(
      api
        .get<ListResponse<InboxMessageSummary>>('/inbox', {
          scope: 'sent',
          status: 'pending_approval',
          pageSize: 3,
        })
        .then((data) => {
          waitingApproval.value = data.items;
        })
        .catch(() => {
          waitingApproval.value = [];
        }),
    );
  }

  await Promise.allSettled(tasks);
  localDrafts.value = readLocalDrafts();
  activityLoading.value = false;
}

/**
 * Los últimos 5 documentos. Los borradores locales ocupan su lugar para que
 * la tarjeta nunca muestre más de cinco filas.
 */
const visibleRecentDocuments = computed(() =>
  recentDocuments.value.slice(0, Math.max(0, 5 - localDrafts.value.length)),
);

async function load(): Promise<void> {
  shellLoading.value = true;
  try {
    const [documentsTotal, draftsTotal, designsData, templatesData] = await Promise.all([
      canSeeDocuments.value ? totalOf('/documents', {}) : Promise.resolve(0),
      canSeeDocuments.value ? totalOf('/documents', { status: 'draft' }) : Promise.resolve(0),
      canSeeDesigns.value
        ? api
            .get<ListResponse<{ id: string }>>('/designs', {})
            .then((data) => data.total ?? data.items.length)
            .catch(() => 0)
        : Promise.resolve(0),
      canSeeTemplates.value
        ? api
            .get<ListResponse<{ id: string }>>('/templates', { status: 'active' })
            .then((data) => data.total ?? data.items.length)
            .catch(() => 0)
        : Promise.resolve(0),
    ]);

    counts.value = {
      documents: documentsTotal,
      drafts: draftsTotal,
      templates: templatesData,
      designs: designsData,
    };
    animateDocuments(documentsTotal);

    if (canSeeInbox.value) {
      void refreshInbox();
      void loadPending();
    }
    void loadActivity();
  } catch (error) {
    toast.failure(error, 'No se pudo cargar el panel de inicio');
  } finally {
    shellLoading.value = false;
  }
}

function openModule(name: string): void {
  void router.push({ name });
}

/** El selector entrega `null` para la hoja en blanco. */
function onCreate(templateId: string | null): void {
  void createDocument(templateId ?? undefined);
}

/** Recuerda de qué tile sale el panel para anclar la animación. */
function rememberOrigin(event: PointerEvent): void {
  const el = event.currentTarget as HTMLElement | null;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  panelOrigin.value = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

function openMessage(id: string): void {
  void router.push({ name: 'inbox-message', params: { id } });
}

function openDocument(id: string): void {
  void router.push({ name: 'document', params: { id } });
}

// Los contadores de la bandeja se refrescan por sondeo en `AppShell`; cuando
// cambian, actualizamos también los chips del hero.
watch(totalCount, () => {
  if (canSeeInbox.value) void loadPending();
});

onMounted(load);

onUnmounted(() => {
  if (countFrame !== undefined) cancelAnimationFrame(countFrame);
});
</script>

<template>
  <AppShell>
    <div class="cockpit pb-16" :class="{ 'cockpit-pushed': overlayOpen }">
      <!-- Hero -->
      <section class="hero relative overflow-hidden text-white">
        <div
          class="hero-chevrons hero-chevrons--left pointer-events-none absolute inset-y-0 left-0 w-[28%]"
          aria-hidden="true"
        />
        <div
          class="hero-chevrons hero-chevrons--right pointer-events-none absolute inset-y-0 right-0 w-[52%]"
          aria-hidden="true"
        />

        <div
          class="relative mx-auto w-full max-w-[1280px] px-4 pb-28 pt-10 sm:px-6 sm:pb-32 sm:pt-14 lg:px-8 lg:pb-36 lg:pt-16"
        >
          <div class="grid items-center gap-10 lg:grid-cols-[minmax(0,1fr)_380px]">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-3">
                <span
                  class="rounded-md border border-white/20 bg-white/10 px-4 py-1.5 text-[12px] font-bold uppercase tracking-[0.18em] text-white"
                >
                  SIRPEF
                </span>
                <span class="text-[12px] font-semibold uppercase tracking-[0.18em] text-white/70">
                  Panel de trabajo
                </span>
              </div>

              <h1
                class="mt-5 max-w-[16ch] text-[34px] font-semibold leading-[1.06] tracking-[-0.03em] text-white sm:text-[42px] lg:text-[48px]"
              >
                {{ greeting }}<span v-if="firstName">, {{ firstName }}</span>
              </h1>

              <p class="mt-4 max-w-lg text-[15px] leading-relaxed text-white/80 sm:text-[16px]">
                <template v-if="canSeeDocuments">
                  {{ displayedDocuments }} documento{{ displayedDocuments === 1 ? '' : 's' }} en tu
                  espacio<template v-if="drafts"> · {{ drafts }} en borrador</template>.
                </template>
                Accede a tus módulos desde aquí.
              </p>

              <div v-if="canSeeDocuments" class="mt-6 flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  class="btn bg-white text-navy hover:bg-white/90"
                  :disabled="creating !== null"
                  @click="pickerOpen = true"
                >
                  <component
                    :is="creating === 'blank' ? Loader2 : Plus"
                    :class="['size-4', creating === 'blank' ? 'animate-spin' : '']"
                  />
                  {{ creating === 'blank' ? 'Creando…' : 'Crear documento' }}
                </button>
                <button
                  type="button"
                  class="btn border border-white/25 bg-white/10 text-white backdrop-blur hover:bg-white/20"
                  @click="openModule('documents')"
                >
                  <Search class="size-4" />
                  Buscar
                </button>
              </div>

              <div
                v-if="canSeeDocuments || canSeeTemplates || canSeeDesigns"
                class="mt-5 flex flex-wrap gap-2 lg:hidden"
              >
                <template v-if="canSeeDocuments">
                  <span class="hero-stat">
                    <strong>{{ displayedDocuments }}</strong> documentos
                  </span>
                  <span v-if="drafts" class="hero-stat">
                    <strong>{{ drafts }}</strong> en borrador
                  </span>
                </template>
                <button
                  type="button"
                  class="hero-stat transition-colors hover:bg-white/15"
                  @click="statsOpen = true"
                >
                  <BarChart3 class="size-3.5" />
                  Ver estadísticas
                </button>
              </div>

              <ActivityFocus
                v-if="canSeeInbox"
                :items="pendingItems"
                :total="totalCount"
                :pending="pendingCount"
                :loading="pendingLoading"
                :updated-at="pendingUpdatedAt"
                class="max-w-[720px]"
                @open="openMessage"
                @open-inbox="openModule('inbox')"
              />
            </div>

            <div
              v-if="canSeeDocuments || canSeeTemplates || canSeeDesigns"
              class="hidden w-full max-w-[400px] lg:block lg:justify-self-end"
            >
              <WorkspaceGauge
                :documents="counts.documents"
                :drafts="counts.drafts"
                :templates="counts.templates"
                :designs="counts.designs"
                :loading="shellLoading"
                @open-stats="statsOpen = true"
              />
            </div>
          </div>
        </div>

        <span :key="totalCount" class="hero-sweep" aria-hidden="true" />
      </section>

      <!-- Accesos a módulos -->
      <section
        v-if="tiles.length > 0"
        class="relative z-10 mx-auto -mt-16 w-full max-w-[1280px] px-4 sm:px-6 lg:-mt-20 lg:px-8"
      >
        <ModuleDock
          :tiles="tiles"
          @open="openModule"
          @origin="rememberOrigin"
        />

        <div
          class="mt-4 flex flex-wrap items-center justify-between gap-2 px-1 text-[12.5px] text-ink-muted"
        >
          <span>Accede a tus módulos desde aquí.</span>
          <span class="hidden sm:block">
            También puedes pulsar <kbd class="kbd">Ctrl</kbd> + <kbd class="kbd">K</kbd>
          </span>
        </div>
      </section>

      <!-- Últimos documentos y avisos -->
      <section
        v-if="canSeeDocuments || canSeeInbox"
        class="mx-auto mt-6 w-full max-w-[1280px] px-4 sm:px-6 lg:px-8"
      >
        <div class="grid gap-4 lg:grid-cols-2">
          <!-- Continuar donde lo dejé -->
          <div v-if="canSeeDocuments" class="card p-4">
            <header class="flex items-start justify-between gap-2">
              <div class="flex items-start gap-2">
                <Clock class="mt-0.5 size-4 shrink-0 text-accent" />
                <div>
                  <h2 class="text-[15px] font-semibold">Continuar donde lo dejé</h2>
                  <p class="text-meta">Últimos 5 documentos</p>
                </div>
              </div>
              <RouterLink
                :to="{ name: 'documents' }"
                class="text-[12.5px] font-medium text-accent hover:underline"
              >
                Ver todos
              </RouterLink>
            </header>

            <div v-if="activityLoading" class="mt-3 flex items-center gap-2 text-[13px] text-ink-muted">
              <Loader2 class="size-3.5 animate-spin" />
              Cargando…
            </div>

            <template v-else>
              <ul
                v-if="visibleRecentDocuments.length > 0 || localDrafts.length > 0"
                class="mt-2 divide-y divide-hairline"
              >
                <li v-for="draft in localDrafts" :key="draft.key">
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 py-2 text-left transition-colors hover:text-accent"
                    @click="resumeLocalDraft(draft)"
                  >
                    <FileText class="size-3.5 shrink-0 text-ink-subtle" />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-[14px] font-medium">{{ draft.title }}</span>
                      <span class="text-meta block">Solo en este navegador · {{ relativeTime(draft.savedAt) }}</span>
                    </span>
                    <ArrowRight class="size-3.5 shrink-0 text-ink-subtle" />
                  </button>
                </li>
                <li v-for="document in visibleRecentDocuments" :key="document.id">
                  <button
                    type="button"
                    class="flex w-full items-center gap-2 py-2 text-left transition-colors hover:text-accent"
                    @click="openDocument(document.id)"
                  >
                    <FileText class="size-3.5 shrink-0 text-ink-subtle" />
                    <span class="min-w-0 flex-1">
                      <span class="block truncate text-[14px] font-medium">{{ document.title }}</span>
                      <span class="text-meta block truncate">
                        {{ document.docNumber ?? document.numberingPreview?.number ?? 'En preparación' }}
                        · {{ relativeTime(document.updatedAt) }}
                        <template v-if="document.ownerId !== auth.user?.id"> · De {{ document.ownerName }}</template>
                      </span>
                    </span>
                    <ArrowRight class="size-3.5 shrink-0 text-ink-subtle" />
                  </button>
                </li>
              </ul>
              <p v-else class="text-description mt-3">
                Todavía no tienes documentos.
                <button type="button" class="font-medium text-accent hover:underline" @click="pickerOpen = true">
                  Crea el primero
                </button>
              </p>
            </template>
          </div>

          <!-- Esperando al jefe -->
          <div v-if="canSeeInbox" class="card p-4">
            <header class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-2">
                <Send class="size-4 text-warning" />
                <h2 class="text-[15px] font-semibold">Esperando al jefe</h2>
              </div>
              <RouterLink
                :to="{ name: 'inbox', query: { tab: 'sent' } }"
                class="text-[12.5px] font-medium text-accent hover:underline"
              >
                Ver envíos
              </RouterLink>
            </header>

            <div v-if="activityLoading" class="mt-3 flex items-center gap-2 text-[13px] text-ink-muted">
              <Loader2 class="size-3.5 animate-spin" />
              Cargando…
            </div>
            <ul v-else-if="waitingApproval.length > 0" class="mt-2 divide-y divide-hairline">
              <li v-for="message in waitingApproval" :key="message.id">
                <button
                  type="button"
                  class="flex w-full items-center gap-2 py-2 text-left transition-colors hover:text-accent"
                  @click="openMessage(message.id)"
                >
                  <Send class="size-3.5 shrink-0 text-ink-subtle" />
                  <span class="min-w-0 flex-1">
                    <span class="block truncate text-[14px] font-medium">{{ message.documentTitle }}</span>
                    <span class="text-meta block truncate">
                      {{ message.subject }} · {{ relativeTime(message.createdAt) }}
                    </span>
                  </span>
                  <ArrowRight class="size-3.5 shrink-0 text-ink-subtle" />
                </button>
              </li>
            </ul>
            <p v-else class="text-description mt-3">
              No hay envíos esperando aprobación.
            </p>
          </div>
        </div>

        <OnboardingCard v-if="canSeeDocuments" class="mt-4" @create="pickerOpen = true" />
      </section>

      <section v-else-if="!shellLoading" class="card mx-auto mt-8 max-w-[1280px] p-8 text-center">
        <FileText class="mx-auto size-8 text-ink-subtle" />
        <h2 class="mt-3 text-[15px] font-semibold">Tu menú está vacío</h2>
        <p class="text-description mt-1">
          Un administrador todavía no te asignó módulos. Puedes seguir entrando a Ajustes
          desde tu avatar.
        </p>
      </section>
    </div>

    <NewDocumentDialog
      :open="pickerOpen"
      @close="pickerOpen = false"
      @create="onCreate"
    />

    <WorkspaceStatsDialog :open="statsOpen" @close="statsOpen = false" />

    <!-- Módulos: se abren como panel modal sobre el panel de trabajo -->
    <RouterView v-slot="{ Component, route: childRoute }">
      <Teleport to="body">
        <ModulePanel
          v-if="Component"
          :label="typeof childRoute.meta.title === 'string' ? childRoute.meta.title : 'Módulo'"
          :origin="panelOrigin"
        >
          <component :is="Component" :key="childRoute.fullPath" />
        </ModulePanel>
      </Teleport>
    </RouterView>
  </AppShell>
</template>

<style scoped>
.hero {
  background:
    radial-gradient(70% 110% at 92% 6%, rgb(78 133 200 / 0.3) 0%, transparent 58%),
    radial-gradient(50% 75% at 0% 100%, rgb(6 227 189 / 0.08) 0%, transparent 62%),
    linear-gradient(135deg, var(--color-navy-deep) 0%, var(--color-navy) 48%, #0a2a55 100%);
}

.hero::after {
  content: '';
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.18), transparent);
}

.hero-chevrons {
  background-image: repeating-linear-gradient(
    118deg,
    transparent 0 16px,
    rgb(255 255 255 / 0.055) 16px 19px
  );
}

.hero-chevrons--left {
  opacity: 0.9;
  mask-image: linear-gradient(to right, #000 0%, transparent 100%);
}

.hero-chevrons--right {
  opacity: 0.8;
  mask-image: radial-gradient(ellipse 80% 72% at 100% 45%, #000 0%, transparent 78%);
}

.hero-stat {
  display: inline-flex;
  align-items: baseline;
  gap: 5px;
  border: 1px solid rgb(255 255 255 / 0.12);
  border-radius: 999px;
  background: rgb(255 255 255 / 0.06);
  padding: 4px 10px;
  font-size: 11.5px;
  color: rgb(255 255 255 / 0.62);
}

.hero-stat strong {
  font-size: 12.5px;
  font-weight: 600;
  color: #fff;
}

/* Barrido que se reinicia cuando cambian los contadores de la bandeja. */
.hero-sweep {
  position: absolute;
  inset-inline: 0;
  bottom: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, #06e3bd, #4e85c8, transparent);
  animation: sweep 700ms ease-out both;
}

@keyframes sweep {
  from {
    transform: translateX(-100%);
    opacity: 0;
  }
  40% {
    opacity: 1;
  }
  to {
    transform: translateX(100%);
    opacity: 0;
  }
}

/* El cockpit se hunde ligeramente cuando hay un panel abierto encima. */
.cockpit {
  transform-origin: top center;
  transition: transform 320ms cubic-bezier(0.22, 1, 0.36, 1);
}

.cockpit-pushed {
  transform: scale(0.994);
}

@media (prefers-reduced-motion: reduce) {
  .hero-sweep {
    display: none;
  }

  .cockpit,
  .cockpit-pushed {
    transition: none;
    transform: none;
  }
}

.kbd {
  border: 1px solid var(--color-hairline);
  border-radius: 4px;
  background: var(--color-surface);
  padding: 0 4px;
  font-size: 10px;
  line-height: 15px;
  font-weight: 600;
  color: var(--color-ink-muted);
}
</style>
