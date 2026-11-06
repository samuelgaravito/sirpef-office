<script setup lang="ts">
import {
  ArrowRight,
  ArrowUpRight,
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

import AppShell from '@/components/layout/AppShell.vue';
import ModulePanel from '@/components/layout/ModulePanel.vue';
import DocumentCard from '@/components/documents/DocumentCard.vue';
import TemplatePreview from '@/components/templates/TemplatePreview.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseSpinner from '@/components/ui/BaseSpinner.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import { useCreateDocument } from '@/composables/useCreateDocument';
import { useInboxBadge } from '@/composables/useInboxBadge';
import { useToast } from '@/composables/useToast';
import { api } from '@/api/client';
import { docTypeLabel } from '@/lib/labels';
import { useAuthStore } from '@/stores/auth';
import type { DocumentSummary, ListResponse, TemplateSummary } from '@/types';

const auth = useAuthStore();
const router = useRouter();
const toast = useToast();
const { creating, createDocument } = useCreateDocument();
const { totalCount, pendingCount, refresh: refreshInbox } = useInboxBadge();

const templates = ref<TemplateSummary[]>([]);
const documents = ref<DocumentSummary[]>([]);
const loading = ref(true);
const deleting = ref<DocumentSummary | null>(null);
const removing = ref(false);

const counts = ref({ documents: 0, drafts: 0, templates: 0, designs: 0 });

const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
});

const firstName = computed(() => auth.user?.name?.split(/\s+/)[0] ?? '');

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

async function totalOf(path: string, params: Record<string, unknown>): Promise<number> {
  const data = await api.get<ListResponse<unknown>>(path, { ...params, pageSize: 1 });
  return data.total ?? data.items.length;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [templateData, documentData] = await Promise.all([
      canSeeTemplates.value
        ? api.get<ListResponse<TemplateSummary>>('/templates', { pageSize: 12, status: 'active' })
        : Promise.resolve({ items: [] as TemplateSummary[] }),
      canSeeDocuments.value
        ? api.get<ListResponse<DocumentSummary>>('/documents', { pageSize: 8, sort: 'updated' })
        : Promise.resolve({ items: [] as DocumentSummary[] }),
    ]);
    templates.value = templateData.items;
    documents.value = documentData.items;

    const [documentsTotal, draftsTotal, designsData] = await Promise.all([
      canSeeDocuments.value ? totalOf('/documents', {}) : Promise.resolve(0),
      canSeeDocuments.value ? totalOf('/documents', { status: 'draft' }) : Promise.resolve(0),
      canSeeDesigns.value
        ? api
            .get<ListResponse<{ id: string }>>('/designs', {})
            .then((data) => data.total ?? data.items.length)
            .catch(() => 0)
        : Promise.resolve(0),
    ]);

    counts.value = {
      documents: documentsTotal,
      drafts: draftsTotal,
      templates: canSeeTemplates.value ? templateData.items.length : 0,
      designs: designsData,
    };

    if (canSeeInbox.value) void refreshInbox();
  } catch {
    toast.error('No se pudo cargar el panel de inicio');
  } finally {
    loading.value = false;
  }
}

async function confirmDelete(): Promise<void> {
  if (!deleting.value || removing.value) return;
  removing.value = true;
  try {
    await api.del(`/documents/${deleting.value.id}`);
    documents.value = documents.value.filter((doc) => doc.id !== deleting.value?.id);
    counts.value.documents = Math.max(0, counts.value.documents - 1);
    toast.success('Documento eliminado');
    deleting.value = null;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo eliminar');
  } finally {
    removing.value = false;
  }
}

function duplicate(document: DocumentSummary): void {
  void document;
  toast.info('Abre el documento y usa «Guardar como plantilla» para reutilizarlo.');
}

function openDocument(id: string): void {
  void router.push({ name: 'document', params: { id } });
}

function openModule(name: string): void {
  void router.push({ name });
}

onMounted(load);
</script>

<template>
  <AppShell>
    <div class="mx-auto w-full max-w-[1280px] px-4 pb-16 pt-5 sm:px-6 sm:pt-7">
      <!-- Hero -->
      <section
        class="hero relative overflow-hidden rounded-2xl border border-navy/20 px-5 py-7 text-white sm:px-8 sm:py-9"
      >
        <div
          class="pointer-events-none absolute -right-24 -top-28 size-72 rounded-full bg-mint/20 blur-3xl"
        />
        <div
          class="pointer-events-none absolute -bottom-32 right-24 size-64 rounded-full bg-accent/30 blur-3xl"
        />

        <div class="relative flex flex-wrap items-end justify-between gap-6">
          <div class="min-w-0">
            <p class="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/55">
              Panel de trabajo
            </p>
            <h1 class="mt-2 text-[27px] font-semibold leading-tight tracking-tight sm:text-[32px]">
              {{ greeting }}<span v-if="firstName">, {{ firstName }}</span>
            </h1>
            <p class="mt-1.5 max-w-lg text-[13.5px] leading-relaxed text-white/70">
              <template v-if="canSeeDocuments">
                {{ counts.documents }} documento{{ counts.documents === 1 ? '' : 's' }} en tu
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

      <section v-else class="card mt-7 p-8 text-center">
        <FileText class="mx-auto size-8 text-ink-subtle" />
        <h2 class="mt-3 text-[15px] font-semibold">Tu menú está vacío</h2>
        <p class="mt-1 text-[13px] text-ink-muted">
          Un administrador todavía no te asignó módulos. Puedes seguir entrando a Ajustes
          desde tu avatar.
        </p>
      </section>

      <!-- Plantillas -->
      <section v-if="canSeeTemplates" class="mt-9">
        <div class="mb-3 flex items-end justify-between gap-3">
          <div>
            <p class="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
              Empezar
            </p>
            <h2 class="mt-0.5 text-[16px] font-semibold tracking-tight">Plantillas listas para usar</h2>
          </div>
          <RouterLink
            :to="{ name: 'templates' }"
            class="flex shrink-0 items-center gap-1 text-[12.5px] font-semibold text-accent hover:underline"
          >
            Ver todas
            <ArrowRight class="size-3.5" />
          </RouterLink>
        </div>

        <div v-if="loading" class="grid place-items-center py-12">
          <BaseSpinner label="Cargando…" />
        </div>

        <div v-else class="no-scrollbar -mx-1 flex gap-3 overflow-x-auto px-1 pb-2">
          <button
            v-if="canSeeDocuments"
            type="button"
            class="w-[150px] shrink-0 rounded-card border border-hairline bg-surface p-2 text-left transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-card disabled:cursor-wait disabled:opacity-60 disabled:hover:translate-y-0"
            :disabled="creating !== null"
            @click="createDocument()"
          >
            <div
              class="grid h-[150px] place-items-center rounded-md border border-dashed border-hairline-strong bg-surface-muted/60"
            >
              <Loader2 v-if="creating === 'blank'" class="size-6 animate-spin text-accent" />
              <Plus v-else class="size-6 text-ink-subtle" />
            </div>
            <p class="mt-2 truncate text-[12.5px] font-semibold">
              {{ creating === 'blank' ? 'Creando…' : 'En blanco' }}
            </p>
            <p class="truncate text-[11px] text-ink-subtle">Sin plantilla</p>
          </button>

          <button
            v-for="template in templates"
            :key="template.id"
            type="button"
            class="w-[150px] shrink-0 rounded-card border border-hairline bg-surface p-2 text-left transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-card disabled:cursor-wait disabled:opacity-60 disabled:hover:translate-y-0"
            :disabled="creating !== null"
            @click="createDocument(template.id)"
          >
            <div class="relative flex justify-center overflow-hidden rounded-md">
              <TemplatePreview
                :template-id="template.id"
                :design-id="template.designId"
                :design-updated-at="template.designUpdatedAt"
                :version="template.version"
                :tokens="template.designTokens"
                :scale="0.155"
                :title="template.name"
              />
              <div
                v-if="creating === template.id"
                class="absolute inset-0 grid place-items-center rounded-md bg-surface/75"
              >
                <Loader2 class="size-5 animate-spin text-accent" />
              </div>
            </div>
            <p class="mt-2 truncate text-[12.5px] font-semibold">{{ template.name }}</p>
            <p class="truncate text-[11px] text-ink-subtle">
              {{ creating === template.id ? 'Creando…' : docTypeLabel(template.docType) }}
            </p>
          </button>
        </div>
      </section>

      <!-- Recientes -->
      <section v-if="canSeeDocuments" class="mt-9">
        <div class="mb-3 flex items-end justify-between gap-3">
          <div>
            <p class="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-subtle">
              Actividad
            </p>
            <h2 class="mt-0.5 text-[16px] font-semibold tracking-tight">Documentos recientes</h2>
          </div>
          <RouterLink
            :to="{ name: 'documents' }"
            class="flex shrink-0 items-center gap-1 text-[12.5px] font-semibold text-accent hover:underline"
          >
            Ver todos
            <ArrowRight class="size-3.5" />
          </RouterLink>
        </div>

        <div v-if="!loading && documents.length === 0">
          <EmptyState
            :icon="FileText"
            title="Todavía no hay documentos"
            description="Crea el primero a partir de una plantilla y aparecerá aquí."
          >
            <button
              type="button"
              class="btn btn-primary"
              :disabled="creating !== null"
              @click="createDocument()"
            >
              <component
                :is="creating === 'blank' ? Loader2 : Plus"
                :class="['size-4', creating === 'blank' ? 'animate-spin' : '']"
              />
              {{ creating === 'blank' ? 'Creando…' : 'Crear documento' }}
            </button>
          </EmptyState>
        </div>

        <div v-else class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          <DocumentCard
            v-for="document in documents"
            :key="document.id"
            :document="document"
            show-owner
            @open="openDocument"
            @delete="deleting = $event"
            @duplicate="duplicate"
          />
        </div>
      </section>
    </div>

    <BaseModal
      :open="deleting !== null"
      title="Eliminar documento"
      :description="deleting ? `«${deleting.title}» se moverá a la papelera.` : undefined"
      size="sm"
      @close="deleting = null"
    >
      <p class="text-[13px] text-ink-muted">
        El documento dejará de aparecer en tus listados. Esta acción se puede revertir desde
        la base de datos, pero no desde la interfaz.
      </p>
      <template #footer>
        <button type="button" class="btn btn-outline" @click="deleting = null">Cancelar</button>
        <button type="button" class="btn btn-danger" :disabled="removing" @click="confirmDelete">
          {{ removing ? 'Eliminando…' : 'Eliminar' }}
        </button>
      </template>
    </BaseModal>

    <!-- Módulos: se abren como panel modal sobre el panel de trabajo -->
    <RouterView v-slot="{ Component, route: childRoute }">
      <Teleport to="body">
        <Transition
          enter-active-class="transition duration-160 ease-out"
          enter-from-class="opacity-0"
          enter-to-class="opacity-100"
          leave-active-class="transition duration-140 ease-in"
          leave-from-class="opacity-100"
          leave-to-class="opacity-0"
        >
          <ModulePanel
            v-if="Component"
            :label="typeof childRoute.meta.title === 'string' ? childRoute.meta.title : 'Módulo'"
          >
            <component :is="Component" :key="childRoute.fullPath" />
          </ModulePanel>
        </Transition>
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

.tile {
  animation: tile-in 380ms cubic-bezier(0.22, 1, 0.36, 1) both;
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
  .tile {
    animation: none;
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
