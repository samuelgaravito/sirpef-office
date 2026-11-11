<script setup lang="ts">
import { Loader2, Undo2, XCircle } from 'lucide-vue-next';
import { computed, ref, watch } from 'vue';

import { api } from '@/api/client';
import BaseModal from '@/components/ui/BaseModal.vue';
import { useInboxBadge } from '@/composables/useInboxBadge';
import { useToast } from '@/composables/useToast';

const props = defineProps<{
  open: boolean;
  messageId: string;
}>();

const emit = defineEmits<{
  close: [];
  rejected: [payload: { allowEdit: boolean }];
}>();

const toast = useToast();
const { refresh: refreshInbox } = useInboxBadge();

const reason = ref('');
const allowEdit = ref(true);
const rejecting = ref(false);

const description = computed(() =>
  allowEdit.value
    ? 'El asistente podrá corregirlo y reenviarlo.'
    : 'El documento quedará cerrado como solo lectura.',
);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reason.value = '';
    allowEdit.value = true;
  },
);

async function submit(): Promise<void> {
  if (!props.messageId || rejecting.value || !reason.value.trim()) return;

  rejecting.value = true;
  const editable = allowEdit.value;
  try {
    await api.post(`/inbox/${props.messageId}/reject`, {
      reason: reason.value.trim(),
      allowEdit: editable,
    });
    await refreshInbox();
    toast.success(
      editable
        ? 'Documento devuelto para corrección; el asistente puede editarlo'
        : 'Envío rechazado y cerrado; el asistente no podrá editarlo',
    );
    emit('rejected', { allowEdit: editable });
    emit('close');
  } catch (error) {
    toast.failure(error, 'No se pudo rechazar el envío');
  } finally {
    rejecting.value = false;
  }
}
</script>

<template>
  <BaseModal
    :open="open"
    :title="allowEdit ? 'Devolver para corrección' : 'Rechazar envío'"
    :description="description"
    size="sm"
    @close="emit('close')"
  >
    <label class="label" for="reject-reason">Motivo</label>
    <textarea
      id="reject-reason"
      v-model="reason"
      class="field min-h-[84px]"
      maxlength="1000"
      placeholder="Indica qué debe corregirse…"
    />

    <div class="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-surface-muted p-1">
      <button
        type="button"
        :class="[
          'rounded-lg px-2 py-2 text-[12px] font-medium transition-colors',
          allowEdit ? 'bg-surface text-ink shadow-card' : 'text-ink-muted hover:text-ink',
        ]"
        @click="allowEdit = true"
      >
        Devolver
      </button>
      <button
        type="button"
        :class="[
          'rounded-lg px-2 py-2 text-[12px] font-medium transition-colors',
          !allowEdit ? 'bg-surface text-ink shadow-card' : 'text-ink-muted hover:text-ink',
        ]"
        @click="allowEdit = false"
      >
        Rechazar
      </button>
    </div>
    <p class="mt-1.5 text-[11px] leading-snug text-ink-subtle">
      {{ allowEdit ? 'El asistente podrá corregirlo y reenviarlo.' : 'El documento quedará bloqueado como solo lectura.' }}
    </p>

    <template #footer>
      <button type="button" class="btn btn-outline" :disabled="rejecting" @click="emit('close')">
        Cancelar
      </button>
      <button
        type="button"
        :class="['btn', allowEdit ? 'btn-primary' : 'btn-danger']"
        :disabled="rejecting || !reason.trim()"
        @click="submit"
      >
        <component
          :is="rejecting ? Loader2 : allowEdit ? Undo2 : XCircle"
          :class="['size-4', rejecting ? 'animate-spin' : '']"
        />
        {{
          rejecting
            ? 'Procesando…'
            : allowEdit
              ? 'Devolver para corrección'
              : 'Rechazar definitivamente'
        }}
      </button>
    </template>
  </BaseModal>
</template>
