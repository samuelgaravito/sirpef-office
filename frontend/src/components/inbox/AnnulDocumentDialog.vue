<script setup lang="ts">
import { Ban, Loader2 } from 'lucide-vue-next';
import { ref, watch } from 'vue';

import { api } from '@/api/client';
import BaseModal from '@/components/ui/BaseModal.vue';
import { useInboxBadge } from '@/composables/useInboxBadge';
import { useToast } from '@/composables/useToast';

const props = defineProps<{
  open: boolean;
  messageId: string;
  expectedVersion: number;
}>();

const emit = defineEmits<{
  close: [];
  annulled: [];
}>();

const toast = useToast();
const { refresh: refreshInbox } = useInboxBadge();

const reason = ref('');
const annulling = ref(false);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reason.value = '';
  },
);

async function submit(): Promise<void> {
  if (!props.messageId || annulling.value) return;

  annulling.value = true;
  try {
    await api.post(`/inbox/${props.messageId}/annul`, {
      expectedVersion: props.expectedVersion,
      reason: reason.value.trim() || undefined,
    });
    await refreshInbox();
    toast.success('Documento anulado; sus copias llevarán la marca «ANULADO»');
    emit('annulled');
    emit('close');
  } catch (error) {
    toast.failure(error, 'No se pudo anular el documento');
  } finally {
    annulling.value = false;
  }
}
</script>

<template>
  <BaseModal
    :open="open"
    title="Anular documento aprobado"
    description="El memo quedará marcado como «Anulado» y llevará una marca de agua. Conserva su número y sigue bloqueado en solo lectura."
    size="sm"
    @close="emit('close')"
  >
    <p class="text-meta leading-snug">
      Dejará de aparecer en la bandeja de los destinatarios. Solo tú, como aprobador, y
      el remitente conservaréis el registro.
    </p>

    <label class="label mt-3" for="annul-reason">Motivo de la anulación (opcional)</label>
    <textarea
      id="annul-reason"
      v-model="reason"
      class="field min-h-[84px]"
      maxlength="1000"
      placeholder="Explica por qué se deja sin efecto…"
    />

    <template #footer>
      <button type="button" class="btn btn-outline" :disabled="annulling" @click="emit('close')">
        Cancelar
      </button>
      <button type="button" class="btn btn-danger" :disabled="annulling" @click="submit">
        <component :is="annulling ? Loader2 : Ban" :class="['size-4', annulling ? 'animate-spin' : '']" />
        {{ annulling ? 'Anulando…' : 'Anular documento' }}
      </button>
    </template>
  </BaseModal>
</template>
