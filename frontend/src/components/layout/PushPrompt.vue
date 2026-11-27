<script setup lang="ts">
import { BellRing, X } from 'lucide-vue-next';
import { computed, ref, watch } from 'vue';

import { usePush } from '@/composables/usePush';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const push = usePush();
const dismissed = ref(false);

const storageKey = computed(() => `sirpefoffice.pushPrompt:${auth.user?.id ?? 'anon'}`);

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(storageKey.value) === '1';
  } catch {
    return false;
  }
}

function dismiss(): void {
  dismissed.value = true;
  try {
    window.localStorage.setItem(storageKey.value, '1');
  } catch {
    // Sin almacenamiento solo se oculta en esta sesión.
  }
}

watch(
  storageKey,
  () => {
    dismissed.value = readDismissed();
  },
  { immediate: true },
);

const visible = computed(
  () =>
    Boolean(auth.user) &&
    push.supported.value &&
    push.permission.value === 'default' &&
    !dismissed.value,
);
</script>

<template>
  <Transition
    enter-active-class="transition duration-250 ease-out"
    enter-from-class="translate-y-3 opacity-0"
    enter-to-class="translate-y-0 opacity-100"
    leave-active-class="transition duration-200 ease-in"
    leave-from-class="translate-y-0 opacity-100"
    leave-to-class="translate-y-3 opacity-0"
  >
    <div
      v-if="visible"
      class="fixed bottom-4 left-4 z-[140] w-[min(92vw,380px)] rounded-2xl border border-hairline bg-surface/95 p-3.5 shadow-pop backdrop-blur-md"
      role="status"
    >
      <div class="flex items-start gap-3">
        <span class="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
          <BellRing class="size-4" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-[13px] font-semibold text-ink">No te pierdas ningún documento</p>
          <p class="mt-0.5 text-[12px] leading-snug text-ink-muted">
            Activa los avisos para enterarte aunque la aplicación esté cerrada.
          </p>
          <div class="mt-2.5 flex items-center gap-2">
            <button type="button" class="btn btn-primary btn-sm" :disabled="push.busy.value" @click="push.enable()">
              Activar
            </button>
            <button type="button" class="btn btn-ghost btn-sm" @click="dismiss">Ahora no</button>
          </div>
        </div>
        <button
          type="button"
          class="rounded p-1 text-ink-subtle transition-colors hover:bg-surface-hover hover:text-ink"
          aria-label="Cerrar"
          @click="dismiss"
        >
          <X class="size-3.5" />
        </button>
      </div>
    </div>
  </Transition>
</template>
