<script setup lang="ts">
import { ShieldAlert } from 'lucide-vue-next';
import { ref, watch } from 'vue';

import BaseModal from '@/components/ui/BaseModal.vue';

const props = withDefaults(
  defineProps<{
    open: boolean;
    busy?: boolean;
    error?: string;
    documentNumber: string;
  }>(),
  { busy: false, error: '' },
);

const emit = defineEmits<{
  close: [];
  submit: [payload: { reason: string; confirmDocNumber: string; code: string }];
}>();

const reason = ref('');
const confirmDocNumber = ref('');
const code = ref('');

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    reason.value = '';
    confirmDocNumber.value = '';
    code.value = '';
  },
);

function submit(): void {
  if (props.busy) return;
  emit('submit', {
    reason: reason.value.trim(),
    confirmDocNumber: confirmDocNumber.value.trim(),
    code: code.value.replace(/\D/g, '').slice(0, 6),
  });
}
</script>

<template>
  <BaseModal
    :open="open"
    title="Editar de emergencia"
    description="Solo el administrador que aprobó este documento puede reabrirlo."
    size="md"
    @close="emit('close')"
  >
    <div class="space-y-4 px-5 py-4">
      <div class="flex gap-3 rounded-xl border border-danger/20 bg-danger-soft/60 p-3">
        <ShieldAlert class="mt-0.5 size-5 shrink-0 text-danger" />
        <div class="text-[12.5px] leading-relaxed text-danger">
          <p class="font-semibold">Esta acción invalida la firma y el certificado anteriores.</p>
          <p class="mt-1">
            El documento conservará su número, volverá a revisión y deberá aprobarse y firmarse de
            nuevo. Todo quedará registrado para auditoría.
          </p>
        </div>
      </div>

      <label class="block">
        <span class="label">Motivo de la edición</span>
        <textarea
          v-model="reason"
          class="field min-h-24 resize-y"
          maxlength="500"
          placeholder="Explica qué error se va a corregir…"
        />
      </label>

      <label class="block">
        <span class="label">Escribe el número del documento</span>
        <input
          v-model="confirmDocNumber"
          class="field"
          :placeholder="documentNumber"
          autocomplete="off"
        />
        <span class="mt-1 block text-[11.5px] text-ink-subtle">
          Debe coincidir exactamente con {{ documentNumber || 'el número del documento' }}.
        </span>
      </label>

      <label class="block">
        <span class="label">Código de SirpefOffice Token</span>
        <input
          v-model="code"
          class="field font-mono text-lg tracking-[0.3em]"
          inputmode="numeric"
          maxlength="6"
          placeholder="123456"
          autocomplete="one-time-code"
          @input="code = code.replace(/\D/g, '').slice(0, 6)"
        />
        <span class="mt-1 block text-[11.5px] text-ink-subtle">
          Abre SirpefOffice Token en tu teléfono e introduce el código de 6 dígitos.
        </span>
      </label>

      <p v-if="error" class="rounded-lg bg-danger-soft px-3 py-2 text-[12.5px] text-danger">
        {{ error }}
      </p>
    </div>

    <template #footer>
      <button type="button" class="btn btn-outline" :disabled="busy" @click="emit('close')">
        Cancelar
      </button>
      <button
        type="button"
        class="btn btn-primary"
        :disabled="
          busy ||
          reason.trim().length < 10 ||
          !confirmDocNumber.trim() ||
          code.replace(/\D/g, '').length !== 6
        "
        @click="submit"
      >
        {{ busy ? 'Abriendo…' : 'Abrir edición de emergencia' }}
      </button>
    </template>
  </BaseModal>
</template>
