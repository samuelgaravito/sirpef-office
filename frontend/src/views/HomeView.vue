<script setup lang="ts">
import {
  ChartNoAxesColumn,
  FileText,
  Inbox,
  LayoutTemplate,
  Loader2,
  Palette,
  Plus,
  Search,
} from 'lucide-vue-next';
import { computed, onMounted, ref, type Component } from 'vue';
import { useRouter } from 'vue-router';

import NewDocumentDialog from '@/components/documents/NewDocumentDialog.vue';
import AiPromptBar from '@/components/home/AiPromptBar.vue';
import ModuleDock from '@/components/home/ModuleDock.vue';
import AppShell from '@/components/layout/AppShell.vue';
import ModulePanel from '@/components/layout/ModulePanel.vue';
import { useAiStatus } from '@/composables/useAiStatus';
import { useCreateDocument } from '@/composables/useCreateDocument';
import { useInboxBadge } from '@/composables/useInboxBadge';
import { useToast } from '@/composables/useToast';
import { describeError } from '@/lib/error-message';
import { api } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import type { AiTemplateChoice } from '@sirpefoffice/shared';
import type { ListResponse } from '@/types';

const auth = useAuthStore();
const router = useRouter();
const toast = useToast();
const { creating, createDocument } = useCreateDocument();
const { totalCount, pendingCount, refresh: refreshInbox } = useInboxBadge();
const { status: aiStatus, loading: aiLoading, load: loadAiStatus } = useAiStatus();

/** Encargo enviado desde la barra de IA: se está eligiendo plantilla. */
const aiPromptBusy = ref(false);
const aiPromptError = ref('');

const counts = ref({ documents: 0, drafts: 0, templates: 0, designs: 0 });
const shellLoading = ref(true);
/** Selector de modelo: la puerta de entrada para crear un documento. */
const pickerOpen = ref(false);

/** Punto de la ventana desde el que "nace" el panel del módulo. */
const panelOrigin = ref<{ x: number; y: number } | null>(null);

const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
});

const firstName = computed(() => auth.user?.name?.split(/\s+/)[0] ?? '');

/** Titular del panel: la pregunta de arranque, personalizada. */
const heading = computed(() =>
  firstName.value ? `¿Por dónde empezamos, ${firstName.value}?` : '¿Por dónde empezamos?',
);

const canSeeDocuments = computed(() => auth.canSeeMenu('documents'));
const canSeeTemplates = computed(() => auth.canSeeMenu('templates'));
const canSeeDesigns = computed(() => auth.canSeeMenu('designs'));
const canSeeInbox = computed(() => auth.canSeeMenu('inbox'));
const canSeeStats = computed(() => auth.canSeeMenu('stats'));

const summary = computed(() => {
  if (!canSeeDocuments.value) return 'Accede a tus módulos desde aquí.';

  const documents = counts.value.documents;
  const drafts = counts.value.drafts;
  const documentsLabel = `${documents} documento${documents === 1 ? '' : 's'} en tu espacio`;
  return drafts > 0 ? `${documentsLabel} · ${drafts} en borrador` : documentsLabel;
});

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
      caption: counts.value.drafts > 0 ? `${counts.value.drafts} en borrador` : 'Todo al día',
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

  if (canSeeStats.value) {
    list.push({
      key: 'stats',
      label: 'Estadísticas',
      description: 'Actividad, aprobaciones y documentos detrás de cada cifra',
      icon: ChartNoAxesColumn,
      route: 'stats',
      value: String(counts.value.documents),
      caption: 'documentos',
    });
  }

  return list;
});

async function totalOf(path: string, params: Record<string, unknown>): Promise<number> {
  const data = await api.get<ListResponse<unknown>>(path, { ...params, pageSize: 1 });
  return data.total ?? data.items.length;
}

async function load(): Promise<void> {
  shellLoading.value = true;
  try {
    const [documentsTotal, draftsTotal, designsTotal, templatesTotal] = await Promise.all([
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
      templates: templatesTotal,
      designs: designsTotal,
    };

    if (canSeeInbox.value) void refreshInbox();
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
function openPicker(): void {
  pickerOpen.value = true;
}

function onCreate(templateId: string | null): void {
  void createDocument(templateId ?? undefined);
}

/**
 * La IA elige la plantilla que mejor encaja con el encargo y el editor abre el
 * asistente con ese primer mensaje ya enviado. Si falla, el texto se conserva.
 *
 * En modo consulta se abre el chat de `/consulta` con la pregunta ya lanzada:
 * la conversación vive en su propia vista, no en una tarjeta del inicio.
 */
async function onAiPrompt(prompt: string, mode: 'draft' | 'ask' = 'draft'): Promise<void> {
  if (aiPromptBusy.value) return;
  if (!aiStatus.value?.configured) {
    aiPromptError.value = 'La IA no está configurada. Actívala en Ajustes para usar el asistente.';
    return;
  }

  aiPromptError.value = '';

  if (mode === 'ask') {
    await router.push({ name: 'consulta', query: { q: prompt } });
    return;
  }

  aiPromptBusy.value = true;

  try {
    const choice = await api.post<AiTemplateChoice>('/ai/choose-template', { prompt });
    toast.success(`Plantilla elegida: ${choice.templateName}`);
    await createDocument(choice.templateId, { ai: true, prompt });
  } catch (error) {
    aiPromptError.value = describeError(error, 'No se pudo completar la petición').message;
  } finally {
    aiPromptBusy.value = false;
  }
}

/** Recuerda de qué tile sale el panel para anclar la animación. */
function rememberOrigin(event: PointerEvent): void {
  const el = event.currentTarget as HTMLElement | null;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  panelOrigin.value = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

onMounted(() => {
  void load();
  void loadAiStatus();
});
</script>

<template>
  <AppShell>
    <div class="home">
      <span class="home-glow" aria-hidden="true" />

      <div
        class="relative mx-auto flex min-h-[calc(100svh-4rem)] w-full max-w-[1180px] flex-col px-4 sm:px-6 lg:px-8"
      >
        <!-- Arranque: titular, píldora de IA y accesos rápidos -->
        <section class="flex flex-1 flex-col items-center justify-center pb-10 pt-14 text-center sm:pt-20">
          <p class="home-eyebrow">
            SIRPEF
            <span class="text-white/25">·</span>
            Panel de trabajo
          </p>

          <h1 class="home-title">{{ heading }}</h1>

          <p class="home-summary">
            <template v-if="!shellLoading">{{ summary }}</template>
            <template v-else>Preparando tu espacio…</template>
          </p>

          <div v-if="canSeeDocuments" class="mt-8 w-full max-w-[780px] text-left">
            <AiPromptBar
              :configured="aiStatus?.configured === true"
              :checking="aiLoading && aiStatus === null"
              :model="aiStatus?.model ?? null"
              :busy="aiPromptBusy"
              :error="aiPromptError"
              @submit="onAiPrompt"
            />
          </div>

          <div v-if="canSeeDocuments" class="mt-7 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              class="btn bg-white text-navy hover:bg-white/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
              :disabled="creating !== null"
              @click="openPicker()"
            >
              <component
                :is="creating === 'blank' ? Loader2 : Plus"
                :class="['size-4', creating === 'blank' ? 'animate-spin' : '']"
              />
              {{ creating === 'blank' ? 'Creando…' : 'Crear documento' }}
            </button>
            <button
              type="button"
              class="btn border border-white/15 bg-white/[0.06] text-white/85 backdrop-blur-sm hover:border-white/25 hover:bg-white/10 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/70"
              @click="openModule('documents')"
            >
              <Search class="size-4" />
              Buscar
            </button>
          </div>

          <p class="mt-5 text-[12.5px] text-white/50">
            <template v-if="canSeeDocuments">
              {{ greeting }}<template v-if="firstName">, {{ firstName }}</template>
              <span class="mx-1 text-white/25">·</span>
            </template>
            Usa <kbd class="home-kbd">Ctrl</kbd> + <kbd class="home-kbd">K</kbd> para ir a
            cualquier módulo.
          </p>
        </section>

        <!-- Los cuatro módulos, como tarjetas de cristal oscuro -->
        <section v-if="tiles.length > 0" class="pb-6">
          <div class="mb-4 flex items-center gap-3">
            <h2 class="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/50">
              Tus módulos
            </h2>
            <span class="h-px flex-1 bg-white/10" aria-hidden="true" />
          </div>

          <ModuleDock :tiles="tiles" @open="openModule" @origin="rememberOrigin" />
        </section>

        <section v-else-if="!shellLoading" class="pb-16 text-center">
          <FileText class="mx-auto size-8 text-white/35" />
          <h2 class="mt-3 text-[15px] font-semibold text-white">Tu menú está vacío</h2>
          <p class="mx-auto mt-1 max-w-md text-[13.5px] leading-relaxed text-white/55">
            Un administrador todavía no te asignó módulos. Puedes seguir entrando a Ajustes
            desde tu avatar.
          </p>
        </section>
      </div>
    </div>

    <NewDocumentDialog
      :open="pickerOpen"
      @close="pickerOpen = false"
      @create="onCreate"
    />

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
.home {
  position: relative;
  min-height: 100%;
  background:
    radial-gradient(58% 44% at 50% 30%, rgb(58 106 176 / 0.3) 0%, transparent 72%),
    radial-gradient(34% 26% at 74% 16%, rgb(6 227 189 / 0.05) 0%, transparent 70%),
    linear-gradient(180deg, #05080f 0%, #081428 44%, #04070d 100%);
}

/* Halo azul difuso detrás del titular y la píldora, como en un chat vacío. */
.home-glow {
  position: absolute;
  inset-inline: 0;
  top: 8%;
  height: 46%;
  background: radial-gradient(50% 60% at 50% 45%, rgb(64 116 190 / 0.22), transparent 74%);
  filter: blur(8px);
  pointer-events: none;
}

.home-eyebrow {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  color: rgb(255 255 255 / 0.52);
}

.home-title {
  margin-top: 18px;
  max-width: 20ch;
  font-size: clamp(30px, 5vw, 52px);
  font-weight: 500;
  line-height: 1.06;
  letter-spacing: -0.035em;
  color: #fff;
  text-wrap: balance;
}

.home-summary {
  margin-top: 14px;
  max-width: 54ch;
  font-size: 14.5px;
  line-height: 1.6;
  color: rgb(255 255 255 / 0.58);
  text-wrap: balance;
}

.home-kbd {
  display: inline-block;
  border: 1px solid rgb(255 255 255 / 0.18);
  border-radius: 4px;
  background: rgb(255 255 255 / 0.08);
  padding: 0 4px;
  font-size: 10px;
  font-weight: 600;
  line-height: 15px;
  color: rgb(255 255 255 / 0.7);
}

@media (prefers-reduced-motion: reduce) {
  .home-glow {
    filter: none;
  }
}
</style>
