<script setup lang="ts">
import { ArrowRight, FileText, Loader2, Plus, Search } from 'lucide-vue-next';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';

import AppShell from '@/components/layout/AppShell.vue';
import DocumentCard from '@/components/documents/DocumentCard.vue';
import TemplatePreview from '@/components/templates/TemplatePreview.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseSpinner from '@/components/ui/BaseSpinner.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import { useCreateDocument } from '@/composables/useCreateDocument';
import { useToast } from '@/composables/useToast';
import { api } from '@/api/client';
import { docTypeLabel } from '@/lib/labels';
import { useAuthStore } from '@/stores/auth';
import type { DocumentSummary, ListResponse, TemplateSummary } from '@/types';

const auth = useAuthStore();
const router = useRouter();
const toast = useToast();
const { creating, createDocument } = useCreateDocument();

const templates = ref<TemplateSummary[]>([]);
const documents = ref<DocumentSummary[]>([]);
const loading = ref(true);
const deleting = ref<DocumentSummary | null>(null);
const removing = ref(false);

const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Buenos días';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
});

const firstName = computed(() => auth.user?.name?.split(/\s+/)[0] ?? '');

const drafts = computed(() => documents.value.filter((doc) => doc.status === 'draft').length);
const canSeeDocuments = computed(() => auth.canSeeMenu('documents'));
const canSeeTemplates = computed(() => auth.canSeeMenu('templates'));

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
    toast.success('Documento eliminado');
    deleting.value = null;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo eliminar');
  } finally {
    removing.value = false;
  }
}

async function duplicate(document: DocumentSummary): Promise<void> {
  void document;
  toast.info('Abre el documento y usa «Guardar como plantilla» para reutilizarlo.');
}

function openDocument(id: string): void {
  void router.push({ name: 'document', params: { id } });
}

onMounted(load);
</script>

<template>
  <AppShell>
    <div class="mx-auto max-w-[1160px] px-5 pb-14 pt-8 sm:px-8">
      <!-- Encabezado -->
      <header class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p class="text-[12.5px] font-medium uppercase tracking-wider text-ink-subtle">Panel de trabajo</p>
          <h1 class="mt-1 text-[26px] font-semibold tracking-tight">
            {{ greeting }}<span v-if="firstName">, {{ firstName }}</span>
          </h1>
          <p v-if="canSeeDocuments" class="mt-1.5 text-[13.5px] text-ink-muted">
            {{ documents.length }} documento{{ documents.length === 1 ? '' : 's' }} reciente{{ documents.length === 1 ? '' : 's' }}
            <template v-if="drafts"> · {{ drafts }} en borrador</template>
          </p>
        </div>

        <div v-if="canSeeDocuments" class="flex items-center gap-2">
          <RouterLink :to="{ name: 'documents' }" class="btn btn-outline">
            <Search class="size-4" />
            Buscar
          </RouterLink>
          <button type="button" class="btn btn-primary" :disabled="creating !== null" @click="createDocument()">
            <component :is="creating === 'blank' ? Loader2 : Plus" :class="['size-4', creating === 'blank' ? 'animate-spin' : '']" />
            {{ creating === 'blank' ? 'Creando…' : 'Nuevo documento' }}
          </button>
        </div>
      </header>

      <section
        v-if="!canSeeDocuments && !canSeeTemplates"
        class="card mt-8 p-8 text-center"
      >
        <FileText class="mx-auto size-8 text-ink-subtle" />
        <h2 class="mt-3 text-[15px] font-semibold">Tu menú está vacío</h2>
        <p class="mt-1 text-[13px] text-ink-muted">
          Un administrador todavía no te asignó secciones. Puedes seguir entrando a
          Ajustes desde tu avatar.
        </p>
      </section>

      <!-- Plantillas -->
      <section v-if="canSeeTemplates" class="mt-9">
        <div class="mb-3 flex items-end justify-between">
          <div>
            <h2 class="text-[15px] font-semibold">Empezar un documento nuevo</h2>
            <p class="mt-0.5 text-[12.5px] text-ink-muted">Plantillas listas para usar con tu diseño institucional.</p>
          </div>
          <RouterLink
            :to="{ name: 'templates' }"
            class="flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline"
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
            type="button"
            class="w-[150px] shrink-0 rounded-xl border border-hairline bg-surface p-2 text-left transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-card disabled:cursor-wait disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
            :disabled="creating !== null"
            @click="createDocument()"
          >
            <div class="grid h-[150px] place-items-center rounded-md border border-dashed border-hairline-strong bg-surface-muted/60">
              <Loader2 v-if="creating === 'blank'" class="size-6 animate-spin text-accent" />
              <Plus v-else class="size-6 text-ink-subtle" />
            </div>
            <p class="mt-2 truncate text-[12.5px] font-medium">
              {{ creating === 'blank' ? 'Creando…' : 'En blanco' }}
            </p>
            <p class="truncate text-[11px] text-ink-subtle">Sin plantilla</p>
          </button>

          <button
            v-for="template in templates"
            :key="template.id"
            type="button"
            class="w-[150px] shrink-0 rounded-xl border border-hairline bg-surface p-2 text-left transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-card disabled:cursor-wait disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
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
            <p class="mt-2 truncate text-[12.5px] font-medium">{{ template.name }}</p>
            <p class="truncate text-[11px] text-ink-subtle">
              {{ creating === template.id ? 'Creando…' : docTypeLabel(template.docType) }}
            </p>
          </button>
        </div>
      </section>

      <!-- Recientes -->
      <section v-if="canSeeDocuments" class="mt-10">
        <div class="mb-3 flex items-end justify-between">
          <h2 class="text-[15px] font-semibold">Documentos recientes</h2>
          <RouterLink
            :to="{ name: 'documents' }"
            class="flex items-center gap-1 text-[12.5px] font-medium text-accent hover:underline"
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
            <button type="button" class="btn btn-primary" :disabled="creating !== null" @click="createDocument()">
              <component :is="creating === 'blank' ? Loader2 : Plus" :class="['size-4', creating === 'blank' ? 'animate-spin' : '']" />
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
  </AppShell>
</template>
