<script setup lang="ts">
import { ClipboardCopy, Loader2, RefreshCw, Smartphone, Trash2 } from 'lucide-vue-next';
import { computed, onMounted, onUnmounted, ref } from 'vue';

import { api } from '@/api/client';
import { useToast } from '@/composables/useToast';

interface SigningDevice {
  id: string;
  deviceId: string;
  model: string;
  platform: string;
  appVersion: string;
  status: string;
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

interface DevicesResponse {
  items: SigningDevice[];
}

interface PairingResponse {
  code: string;
  expiresAt: string;
  user: { name: string; email: string; cedula: string };
}

const toast = useToast();

const devices = ref<SigningDevice[]>([]);
const loading = ref(true);
const creating = ref(false);
const revoking = ref<string | null>(null);
const code = ref<string | null>(null);
const expiresAt = ref<string | null>(null);
const now = ref(Date.now());
let clock: number | undefined;

const remaining = computed(() => {
  if (!expiresAt.value) return 0;
  return Math.max(0, Math.floor((new Date(expiresAt.value).getTime() - now.value) / 1000));
});

const countdown = computed(() => {
  const minutes = Math.floor(remaining.value / 60);
  const seconds = remaining.value % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
});

const activeCount = computed(
  () => devices.value.filter((device) => device.status === 'active').length,
);

function formatDate(value: string | null): string {
  if (!value) return 'nunca';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-VE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const response = await api.get<DevicesResponse>('/mobile/devices');
    devices.value = response.items;
  } catch (error) {
    toast.failure(error, 'No se pudieron cargar los teléfonos vinculados');
  } finally {
    loading.value = false;
  }
}

async function createCode(): Promise<void> {
  if (creating.value) return;
  creating.value = true;
  try {
    const response = await api.post<PairingResponse>('/auth/mobile/pairing');
    code.value = response.code;
    expiresAt.value = response.expiresAt;
    now.value = Date.now();
    toast.success('Código de vinculación generado');
  } catch (error) {
    toast.failure(error, 'No se pudo generar el código de vinculación');
  } finally {
    creating.value = false;
  }
}

async function copyCode(): Promise<void> {
  if (!code.value) return;
  try {
    await navigator.clipboard.writeText(code.value);
    toast.success('Código copiado');
  } catch {
    toast.error('No se pudo copiar el código. Escríbelo a mano.');
  }
}

async function revoke(device: SigningDevice): Promise<void> {
  const label = device.model || 'este teléfono';
  if (
    !window.confirm(
      `¿Revocar ${label}? La sesión se cerrará inmediatamente y el teléfono tendrá que vincularse de nuevo.`,
    )
  ) {
    return;
  }
  revoking.value = device.id;
  try {
    await api.del(`/mobile/devices/${device.id}`);
    toast.success('Teléfono revocado');
    await load();
  } catch (error) {
    toast.failure(error, 'No se pudo revocar el teléfono');
  } finally {
    revoking.value = null;
  }
}

onMounted(() => {
  void load();
  clock = window.setInterval(() => {
    now.value = Date.now();
  }, 1000);
});

onUnmounted(() => {
  if (clock !== undefined) window.clearInterval(clock);
});
</script>

<template>
  <section class="card p-5">
    <header class="mb-4 flex items-center gap-2">
      <Smartphone class="size-4 text-ink-muted" />
      <h2 class="text-[14px] font-semibold">Dispositivos de firma</h2>
      <span v-if="activeCount > 0" class="chip ml-auto !bg-success-soft !text-success">
        {{ activeCount }} activo{{ activeCount === 1 ? '' : 's' }}
      </span>
    </header>

    <p class="text-[12.5px] leading-relaxed text-ink-muted">
      Vincula el teléfono desde el que se aprueban y firman los memorándums.
      La app pedirá este código una sola vez y después entrará con huella y el
      código de SirpefOffice Token.
    </p>

    <div v-if="code" class="mt-4 rounded-xl border border-hairline bg-surface-muted p-4">
      <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
        Código de vinculación
      </p>
      <div class="mt-2 flex flex-wrap items-center gap-3">
        <span class="font-mono text-2xl font-bold tracking-[0.22em] text-ink">{{ code }}</span>
        <button type="button" class="btn btn-outline" @click="copyCode">
          <ClipboardCopy class="size-4" />
          Copiar
        </button>
      </div>
      <p class="mt-2 text-[12px] text-ink-muted">
        <template v-if="remaining > 0">
          Caduca en <span class="font-semibold text-ink">{{ countdown }}</span>.
          Escríbelo en la app Firma antes de que expire.
        </template>
        <template v-else>
          El código caducó. Genera uno nuevo para continuar.
        </template>
      </p>
      <button
        v-if="remaining === 0"
        type="button"
        class="btn btn-primary mt-3"
        :disabled="creating"
        @click="createCode"
      >
        <component :is="creating ? Loader2 : RefreshCw" :class="['size-4', creating ? 'animate-spin' : '']" />
        {{ creating ? 'Generando…' : 'Generar otro código' }}
      </button>
    </div>

    <div v-else class="mt-4 flex flex-wrap items-center gap-3">
      <button type="button" class="btn btn-primary" :disabled="creating" @click="createCode">
        <component :is="creating ? Loader2 : Smartphone" :class="['size-4', creating ? 'animate-spin' : '']" />
        {{ creating ? 'Generando…' : 'Vincular teléfono' }}
      </button>
      <span class="text-[12px] text-ink-muted">El código se muestra una sola vez.</span>
    </div>

    <div class="mt-6">
      <div class="mb-2 flex items-center justify-between">
        <p class="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
          Teléfonos
        </p>
        <button
          type="button"
          class="inline-flex items-center gap-1.5 text-[12px] text-ink-muted hover:text-ink disabled:opacity-50"
          :disabled="loading"
          @click="load"
        >
          <RefreshCw :class="['size-3.5', loading ? 'animate-spin' : '']" />
          Actualizar
        </button>
      </div>

      <p v-if="loading" class="py-3 text-[12.5px] text-ink-muted">Cargando teléfonos…</p>
      <p v-else-if="devices.length === 0" class="py-3 text-[12.5px] text-ink-muted">
        Todavía no hay teléfonos vinculados.
      </p>
      <ul v-else class="divide-y divide-hairline">
        <li
          v-for="device in devices"
          :key="device.id"
          class="flex items-center gap-3 py-3"
        >
          <div class="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-ink">
            <Smartphone class="size-5" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-[13px] font-medium">
              {{ device.model || 'Teléfono Android' }}
            </p>
            <p class="text-[11.5px] text-ink-muted">
              <span :class="device.status === 'active' ? 'text-success' : 'text-ink-muted'">
                {{ device.status === 'active' ? 'Activo' : 'Revocado' }}
              </span>
              · Último uso: {{ formatDate(device.lastSeenAt) }}
            </p>
          </div>
          <button
            v-if="device.status === 'active'"
            type="button"
            class="btn btn-outline !px-3 !py-1.5 text-[12px]"
            :disabled="revoking === device.id"
            @click="revoke(device)"
          >
            <component :is="revoking === device.id ? Loader2 : Trash2" :class="['size-3.5', revoking === device.id ? 'animate-spin' : '']" />
            Revocar
          </button>
        </li>
      </ul>
    </div>
  </section>
</template>
