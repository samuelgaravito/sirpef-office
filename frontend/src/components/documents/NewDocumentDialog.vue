<script setup lang="ts">
import { FilePlus2, FileText, Loader2, Search, TriangleAlert } from 'lucide-vue-next';
import { computed, ref, watch } from 'vue';

import { api } from '@/api/client';
import TemplatePreview from '@/components/templates/TemplatePreview.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseSpinner from '@/components/ui/BaseSpinner.vue';
import { useToast } from '@/composables/useToast';
import { docTypeLabel } from '@/lib/labels';
import type { ListResponse, TemplateSummary } from '@/types';

/**
 * Selector de modelo para crear un documento.
 *
 * Es el único camino de entrada: la secretaria elige «qué va a redactar» y el
 * documento nace ya con su plantilla, sus datos y su numeración. La hoja en
 * blanco queda al final y avisa de que no tendrá número correlativo.
 */
const props = defineProps<{ open: boolean }>();

const emit = defineEmits<{
  close: [];
  create: [templateId: string | null];
}>();

const toast = useToast();
const templates = ref<TemplateSummary[]>([]);
const loading = ref(false);
const search = ref('');

const filtered = computed(() => {
  const term = search.value.trim().toLowerCase();
  if (!term) return templates.value;
  return templates.value.filter((template) =>
    `${template.name} ${template.description}`.toLowerCase().includes(term),
  );
});

/** Los modelos se ordenan por nombre para que sean fáciles de encontrar. */
function byName(a: TemplateSummary, b: TemplateSummary): number {
  return a.name.localeCompare(b.name, 'es', { sensitivity: 'base' });
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await api.get<ListResponse<TemplateSummary>>('/templates', {
      status: 'active',
      scope: 'all',
      pageSize: 100,
    });
    templates.value = [...data.items].sort(byName);
  } catch (error) {
    toast.failure(error, 'No se pudieron cargar los modelos');
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    search.value = '';
    void load();
  },
);

function choose(templateId: string | null): void {
  emit('create', templateId);
  emit('close');
}
</script>

<template>
  <BaseModal
    :open="open"
    title="Crear documento"
    description="Elige el modelo. El documento se abrirá listo para rellenar y se numerará al aprobarlo."
    size="2xl"
    @close="emit('close')"
  >
    <div v-if="loading" class="grid place-items-center py-16">
      <BaseSpinner label="Cargando modelos…" />
    </div>

    <div v-else class="space-y-4">
      <div v-if="templates.length > 6" class="relative">
        <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
        <input
          v-model="search"
          class="field pl-9"
          placeholder="Buscar un modelo por nombre…"
          autofocus
        />
      </div>

      <button
        type="button"
        class="flex w-full items-center gap-3 rounded-xl border border-dashed border-hairline bg-surface px-4 py-3 text-left transition-colors hover:border-accent/50 hover:bg-accent-soft"
        @click="choose(null)"
      >
        <span class="grid size-10 shrink-0 place-items-center rounded-lg bg-surface-muted text-ink-muted">
          <FilePlus2 class="size-5" />
        </span>
        <span class="min-w-0 flex-1">
          <span class="block text-[15px] font-medium text-ink">Hoja en blanco</span>
          <span class="mt-0.5 flex items-center gap-1 text-[13px] text-warning">
            <TriangleAlert class="size-3.5 shrink-0" />
            Sin modelo ni número correlativo
          </span>
        </span>
      </button>

      <div v-if="filtered.length > 0" class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <button
          v-for="template in filtered"
          :key="template.id"
          type="button"
          class="card group flex flex-col overflow-hidden text-left transition-shadow hover:shadow-pop focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          @click="choose(template.id)"
        >
          <span class="flex justify-center overflow-hidden bg-surface-muted/40 px-2.5 pt-2.5">
            <TemplatePreview
              :template-id="template.id"
              :design-id="template.designId"
              :design-updated-at="template.designUpdatedAt"
              :effective-design-id="template.effectiveDesignId"
              :effective-design-updated-at="template.effectiveDesignUpdatedAt"
              :version="template.version"
              :tokens="template.designTokens"
              :scale="0.16"
              :title="template.name"
            />
          </span>
          <span class="flex flex-1 flex-col px-3 pb-3 pt-2.5">
            <span class="truncate text-[15px] font-semibold text-ink">{{ template.name }}</span>
            <span v-if="docTypeLabel(template.docType) !== template.name" class="text-meta mt-0.5">{{ docTypeLabel(template.docType) }}</span>
            <span v-if="template.description" class="text-description mt-1 line-clamp-2">
              {{ template.description }}
            </span>
          </span>
        </button>
      </div>

      <div v-else class="rounded-xl border border-hairline bg-surface-muted/40 px-4 py-6 text-center">
        <FileText class="mx-auto size-6 text-ink-subtle" />
        <p class="mt-2 text-[15px] font-semibold">
          {{ search ? 'Ningún modelo coincide' : 'Todavía no hay modelos disponibles' }}
        </p>
        <p class="text-description mt-1">
          {{
            search
              ? 'Prueba con otro nombre o crea una hoja en blanco.'
              : 'Puedes empezar con una hoja en blanco, pero no tendrá numeración.'
          }}
        </p>
      </div>
    </div>

    <template #footer>
      <button type="button" class="btn btn-outline" @click="emit('close')">Cancelar</button>
    </template>
  </BaseModal>
</template>
