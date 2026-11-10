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
const loading = ref(false);

/** Diseño en uso: es el con el que se dibujarán las plantillas. */
const activeDesign = computed(() => designs.value.find((design) => design.isCurrent) ?? null);

const previewTokens = computed(() => activeDesign.value?.tokens ?? DEFAULT_DESIGN_TOKENS);

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    designs.value = [];
    loading.value = true;
    try {
      const data = await api.get<ListResponse<DesignRecord>>('/designs');
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
  emit('select', activeDesign.value?.id ?? null);
}
</script>

<template>
  <BaseModal
    :open="open"
    title="Nueva plantilla"
    description="Las plantillas usan siempre el diseño que esté en uso. Podrás cambiarlo en Diseños."
    size="2xl"
    @close="emit('close')"
  >
    <div v-if="loading" class="grid place-items-center py-14">
      <BaseSpinner label="Cargando diseños…" />
    </div>

    <div v-else class="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div class="min-w-0">
        <div class="rounded-xl border border-hairline bg-surface p-4">
          <p class="text-[12.5px] font-medium">Diseño en uso</p>
          <p class="mt-1 text-[12px] leading-snug text-ink-muted">
            <template v-if="activeDesign">
              La plantilla se abrirá con <strong class="text-ink">{{ activeDesign.name }}</strong>. Todas
              tus plantillas se dibujan con este diseño; puedes encender otro en <strong>Diseños</strong>
              cuando quieras cambiar el aspecto.
            </template>
            <template v-else>
              No hay ningún diseño en uso. Enciéndelo en <strong>Diseños</strong> para que tus
              plantillas tengan identidad visual.
            </template>
          </p>
        </div>
      </div>

      <aside class="min-w-0">
        <p class="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
          Vista previa del diseño
        </p>
        <div class="flex max-h-[58vh] items-start justify-center overflow-auto rounded-xl bg-[#eef1f5] p-3">
          <DesignPreview :tokens="previewTokens" :scale="0.34" />
        </div>
        <p class="mt-2 text-[11px] leading-snug text-ink-muted">
          {{ activeDesign?.name ?? 'Sin diseño en uso' }}.
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
