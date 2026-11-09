<script setup lang="ts">
import {
  ArrowUpRight,
  FileText,
  Inbox,
  LayoutTemplate,
  Loader2,
  Palette,
  Plus,
  Search,
} from 'lucide-vue-next';
import { computed, onMounted, onUnmounted, ref, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import ActivityFocus from '@/components/home/ActivityFocus.vue';
import AppShell from '@/components/layout/AppShell.vue';
import ModulePanel from '@/components/layout/ModulePanel.vue';
import { useCreateDocument } from '@/composables/useCreateDocument';
import { useInboxBadge } from '@/composables/useInboxBadge';
import { useToast } from '@/composables/useToast';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import type { InboxMessageSummary, ListResponse } from '@/types';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const toast = useToast();
const { creating, createDocument } = useCreateDocument();
const { totalCount, pendingCount, refresh: refreshInbox } = useInboxBadge();

const counts = ref({ documents: 0, drafts: 0, templates: 0, designs: 0 });
const shellLoading = ref(true);

/** Punto de la ventana desde el que "nace" el panel del módulo. */
const panelOrigin = ref<{ x: number; y: number } | null>(null);

const pendingItems = ref<InboxMessageSummary[]>([]);
const pendingLoading = ref(false);
const pendingUpdatedAt = ref<Date | null>(null);

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
  } catch {
    toast.error('No se pudo cargar el panel de inicio');
  } finally {
    shellLoading.value = false;
  }
}

function openModule(name: string): void {
  void router.push({ name });
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
    <div
      class="cockpit mx-auto w-full max-w-[1280px] px-4 pb-16 pt-5 sm:px-6 sm:pt-7"
      :class="{ 'cockpit-pushed': overlayOpen }"
    >
      <!-- Hero -->
      <section
        class="hero relative overflow-hidden rounded-2xl border border-navy/20 px-5 py-7 text-white sm:px-8 sm:py-9"
      >
        <div class="orb orb-a pointer-events-none absolute -right-24 -top-28 size-72 rounded-full bg-mint/20 blur-3xl" />
        <div class="orb orb-b pointer-events-none absolute -bottom-32 right-24 size-64 rounded-full bg-accent/30 blur-3xl" />

        <div class="relative">
          <div class="flex flex-wrap items-start justify-between gap-5">
            <div class="min-w-0">
              <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
                Panel de trabajo
              </p>
              <h1 class="mt-2 text-[27px] font-semibold leading-tight tracking-tight sm:text-[32px]">
                {{ greeting }}<span v-if="firstName">, {{ firstName }}</span>
              </h1>
              <p class="mt-1.5 max-w-lg text-[13.5px] leading-relaxed text-white/70">
                <template v-if="canSeeDocuments">
                  {{ displayedDocuments }} documento{{ displayedDocuments === 1 ? '' : 's' }} en tu
                  espacio<template v-if="drafts"> · {{ drafts }} en borrador</template>.
                </template>
                Accede a tus módulos desde aquí.
              </p>
            </div>

            <div v-if="canSeeDocuments" class="flex flex-wrap items-center gap-2">
              <button
                type="button"
                class="btn bg-white text-navy hover:bg-white/90"
                :disabled="creating !== null"
                @click="createDocument()"
              >
                <component
                  :is="creating === 'blank' ? Loader2 : Plus"
                  :class="['size-4', creating === 'blank' ? 'animate-spin' : '']"
                />
                {{ creating === 'blank' ? 'Creando…' : 'Nuevo documento' }}
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
          </div>

          <ActivityFocus
            v-if="canSeeInbox"
            :items="pendingItems"
            :total="totalCount"
            :pending="pendingCount"
            :loading="pendingLoading"
            :updated-at="pendingUpdatedAt"
            @open="openMessage"
            @open-inbox="openModule('inbox')"
          />
        </div>

        <span :key="totalCount" class="hero-sweep" aria-hidden="true" />
      </section>

      <!-- Accesos a módulos -->
      <section v-if="tiles.length > 0" class="mt-7">
        <div class="mb-3 flex items-end justify-between gap-3">
          <div>
            <p class="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
              Módulos
            </p>
            <h2 class="mt-0.5 text-[16px] font-semibold tracking-tight">¿A dónde quieres ir?</h2>
          </div>
          <span class="hidden text-[11.5px] text-ink-subtle sm:block">
            También puedes pulsar <kbd class="kbd">Ctrl</kbd> + <kbd class="kbd">K</kbd>
          </span>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <button
            v-for="(tile, index) in tiles"
            :key="tile.key"
            type="button"
            class="tile group relative overflow-hidden rounded-card border border-hairline bg-surface p-4 text-left transition-all duration-200 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-pop"
            :style="{ animationDelay: `${index * 45}ms` }"
            @pointerdown="rememberOrigin"
            @click="openModule(tile.route)"
          >
            <span
              class="pointer-events-none absolute inset-x-0 top-0 h-0.5 origin-left scale-x-0 bg-gradient-to-r from-accent to-mint transition-transform duration-300 group-hover:scale-x-100"
            />
            <div class="flex items-start justify-between gap-2">
              <span
                class="grid size-10 place-items-center rounded-lg bg-accent-soft text-accent transition-colors group-hover:bg-accent group-hover:text-white"
              >
                <component :is="tile.icon" class="size-5" />
              </span>
              <span
                class="grid size-7 place-items-center rounded-full border border-hairline text-ink-subtle transition-colors group-hover:border-accent/40 group-hover:text-accent"
              >
                <ArrowUpRight class="size-3.5" />
              </span>
            </div>

            <p class="mt-3.5 text-[13.5px] font-semibold text-ink">{{ tile.label }}</p>
            <p class="mt-0.5 line-clamp-2 min-h-[32px] text-[11.5px] leading-snug text-ink-muted">
              {{ tile.description }}
            </p>

            <div class="mt-3 flex items-baseline gap-1.5 border-t border-hairline pt-2.5">
              <span class="text-[19px] font-semibold leading-none tracking-tight text-ink">
                {{ tile.value }}
              </span>
              <span class="truncate text-[11px] text-ink-subtle">{{ tile.caption }}</span>
              <span
                v-if="tile.badge"
                class="ml-auto grid min-w-[18px] place-items-center rounded-full bg-accent px-1 py-0.5 text-[9.5px] font-bold leading-none text-white"
              >
                {{ tile.badge > 99 ? '99+' : tile.badge }}
              </span>
            </div>
          </button>
        </div>
      </section>

      <section v-else-if="!shellLoading" class="card mt-7 p-8 text-center">
        <FileText class="mx-auto size-8 text-ink-subtle" />
        <h2 class="mt-3 text-[15px] font-semibold">Tu menú está vacío</h2>
        <p class="mt-1 text-[13px] text-ink-muted">
          Un administrador todavía no te asignó módulos. Puedes seguir entrando a Ajustes
          desde tu avatar.
        </p>
      </section>
    </div>

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
    radial-gradient(120% 160% at 100% 0%, rgb(78 133 200 / 0.42) 0%, transparent 55%),
    linear-gradient(135deg, #041e42 0%, #0a2a55 55%, #1b3a66 100%);
}

.orb {
  animation: drift 18s ease-in-out infinite alternate;
}

.orb-b {
  animation-duration: 24s;
  animation-delay: -6s;
}

@keyframes drift {
  from {
    transform: translate3d(0, 0, 0) scale(1);
  }
  to {
    transform: translate3d(-14px, 12px, 0) scale(1.08);
  }
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

.tile {
  animation: tile-in 380ms cubic-bezier(0.22, 1, 0.36, 1) both;
  transition:
    transform 180ms cubic-bezier(0.22, 1, 0.36, 1),
    border-color 180ms ease,
    box-shadow 180ms ease;
}

.tile:active {
  transform: scale(0.985);
}

/* El cockpit se hunde ligeramente cuando hay un panel abierto encima. */
.cockpit {
  transform-origin: top center;
  transition: transform 320ms cubic-bezier(0.22, 1, 0.36, 1);
}

.cockpit-pushed {
  transform: scale(0.994);
}

@keyframes tile-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .orb,
  .tile {
    animation: none;
  }

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
