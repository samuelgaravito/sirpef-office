<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { DEFAULT_DESIGN_TOKENS } from '@sirpefoffice/shared';
import DesignPreview from '@/components/designs/DesignPreview.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseSpinner from '@/components/ui/BaseSpinner.vue';
import { useToast } from '@/composables/useToast';
import { api } from '@/api/client';
import type { DesignRecord, ListResponse } from '@/types';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  close: [];
  select: [designId: string | null];
}>();

const toast = useToast();
const designs = ref<DesignRecord[]>([]);
const selectedDesignId = ref<string | null>(null);
const loading = ref(false);

const selectedDesign = computed(
  () => designs.value.find((design) => design.id === selectedDesignId.value) ?? null,
);

const previewTokens = computed(() => selectedDesign.value?.tokens ?? DEFAULT_DESIGN_TOKENS);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    selectedDesignId.value = null;
    designs.value = [];
    loading.value = true;
    try {
      const data = await api.get<ListResponse<DesignRecord>>('/designs', {
        pageSize: 100,
        status: 'active',
      });
      designs.value = data.items;
    } catch {
      toast.error('No se pudieron cargar los diseños');
    } finally {
      loading.value = false;
    }
  },
  { immediate: true },
);

function confirm(): void {
  emit('select', selectedDesignId.value);
}
</script>

<template>
  <BaseModal
    :open="open"
    title="Nueva plantilla"
    description="Elige el diseño con el que empezarás a trabajar. Podrás cambiarlo después desde el editor."
    size="2xl"
    @close="emit('close')"
  >
    <div v-if="loading" class="grid place-items-center py-14">
      <BaseSpinner label="Cargando diseños…" />
    </div>

    <div v-else class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div class="min-w-0">
        <div class="grid max-h-[58vh] grid-cols-2 gap-3 overflow-y-auto pr-1">
          <button
            type="button"
            :class="[
              'relative flex flex-col rounded-xl border bg-surface p-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-card',
              selectedDesignId === null
                ? 'border-accent ring-2 ring-accent/15'
                : 'border-hairline hover:border-accent/40',
            ]"
            @click="selectedDesignId = null"
          >
            <div class="flex justify-center overflow-hidden rounded-md bg-[#eef1f5] p-1.5">
              <DesignPreview :tokens="DEFAULT_DESIGN_TOKENS" :scale="0.2" />
            </div>
            <p class="mt-2 truncate text-[12.5px] font-medium">Sin diseño</p>
            <p class="truncate text-[11px] text-ink-subtle">Hoja con valores predeterminados</p>
            <span
              v-if="selectedDesignId === null"
              class="absolute right-2 top-2 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent"
            >
              Seleccionado
            </span>
          </button>

          <button
            v-for="design in designs"
            :key="design.id"
            type="button"
            :class="[
              'relative flex flex-col rounded-xl border bg-surface p-2 text-left transition-all hover:-translate-y-0.5 hover:shadow-card',
              selectedDesignId === design.id
                ? 'border-accent ring-2 ring-accent/15'
                : 'border-hairline hover:border-accent/40',
            ]"
            @click="selectedDesignId = design.id"
          >
            <div class="flex justify-center overflow-hidden rounded-md bg-[#eef1f5] p-1.5">
              <DesignPreview :tokens="design.tokens" :scale="0.2" />
            </div>
            <p class="mt-2 truncate text-[12.5px] font-medium">{{ design.name }}</p>
            <p class="truncate text-[11px] text-ink-subtle">
              {{ design.tokens.pageFormat }} · {{ design.tokens.fontFamily.split(',')[0] }}
            </p>
            <span
              v-if="selectedDesignId === design.id"
              class="absolute right-2 top-2 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-accent"
            >
              Seleccionado
            </span>
          </button>
        </div>

        <p v-if="designs.length === 0" class="mt-3 text-[12px] text-ink-muted">
          No hay diseños guardados. Puedes crear la plantilla sin diseño y elegir uno más tarde.
        </p>
      </div>

      <aside class="min-w-0">
        <p class="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
          Vista previa del diseño
        </p>
        <div class="flex max-h-[58vh] items-start justify-center overflow-auto rounded-xl bg-[#eef1f5] p-3">
          <DesignPreview :tokens="previewTokens" :scale="0.34" />
        </div>
        <p class="mt-2 text-[11px] leading-snug text-ink-muted">
          {{ selectedDesign?.name ?? 'Sin diseño' }}. La plantilla se abrirá con este diseño cargado.
        </p>
      </aside>
    </div>

    <template #footer>
      <button type="button" class="btn btn-outline" @click="emit('close')">Cancelar</button>
      <button type="button" class="btn btn-primary" :disabled="loading" @click="confirm">
        Crear plantilla
      </button>
    </template>
  </BaseModal>
</template>
