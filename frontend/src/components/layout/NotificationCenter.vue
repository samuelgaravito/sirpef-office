<script setup lang="ts">
import { Bell, CheckCheck, FileText, Inbox, Trash2 } from 'lucide-vue-next';
import { ref } from 'vue';
import { useRouter } from 'vue-router';

import BaseDropdown from '@/components/ui/BaseDropdown.vue';
import {
  useNotificationCenter,
  type AppNotification,
} from '@/composables/useNotificationCenter';

const router = useRouter();
const { items, unread, markRead, markAllRead, clear } = useNotificationCenter();
const dropdown = ref<{ close: () => void } | null>(null);

const relative = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

/** Hora relativa breve: ahora, hace 5 min, ayer… */
function relativeTime(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  const minutes = Math.round(diff / 60_000);
  if (Math.abs(minutes) < 1) return 'ahora';
  if (Math.abs(minutes) < 60) return relative.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(hours, 'hour');
  const days = Math.round(hours / 24);
  return relative.format(days, 'day');
}

function open(item: AppNotification): void {
  markRead(item.id);
  dropdown.value?.close();
  if (item.messageId) {
    void router.push({ name: 'inbox-message', params: { id: item.messageId } });
    return;
  }
  if (item.documentId) {
    void router.push({ name: 'document', params: { id: item.documentId } });
  }
}
</script>

<template>
  <BaseDropdown ref="dropdown" align="right" width="w-[min(92vw,380px)]" :close-on-click="false">
    <template #trigger>
      <button
        type="button"
        class="relative grid size-9 place-items-center rounded-field border border-white/15 bg-white/[0.07] text-white/75 transition-colors hover:bg-white/10 hover:text-white"
        :aria-label="`Notificaciones${unread ? `, ${unread} sin leer` : ''}`"
      >
        <Bell class="size-4" />
        <span
          v-if="unread > 0"
          class="absolute -right-1.5 -top-1.5 grid min-w-[18px] place-items-center rounded-full bg-mint px-1 py-0.5 text-[10px] font-bold leading-none text-navy ring-2 ring-navy"
        >
          {{ unread > 99 ? '99+' : unread }}
        </span>
      </button>
    </template>

    <template #content>
      <div class="flex items-center justify-between px-2.5 pb-2 pt-1">
        <div>
          <p class="text-[13px] font-semibold text-ink">Notificaciones</p>
          <p class="text-[11.5px] text-ink-subtle">
            {{ unread > 0 ? `${unread} sin leer` : 'Todo al día' }}
          </p>
        </div>
        <div class="flex items-center gap-1">
          <button
            type="button"
            class="rounded p-1.5 text-ink-subtle transition-colors hover:bg-surface-hover hover:text-ink disabled:opacity-40"
            :disabled="unread === 0"
            title="Marcar todo como leído"
            aria-label="Marcar todo como leído"
            @click.stop="markAllRead"
          >
            <CheckCheck class="size-3.5" />
          </button>
          <button
            type="button"
            class="rounded p-1.5 text-ink-subtle transition-colors hover:bg-surface-hover hover:text-danger disabled:opacity-40"
            :disabled="items.length === 0"
            title="Borrar historial"
            aria-label="Borrar historial de notificaciones"
            @click.stop="clear"
          >
            <Trash2 class="size-3.5" />
          </button>
        </div>
      </div>

      <div class="max-h-[min(70vh,440px)] overflow-y-auto">
        <div v-if="items.length === 0" class="px-3 py-10 text-center">
          <Bell class="mx-auto size-6 text-ink-subtle" />
          <p class="mt-2 text-[12.5px] font-medium text-ink-muted">Sin notificaciones</p>
          <p class="mt-0.5 text-[11.5px] text-ink-subtle">
            Los avisos de documentos y de la bandeja aparecerán aquí.
          </p>
        </div>

        <button
          v-for="item in items"
          :key="item.id"
          type="button"
          class="flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-hover"
          @click="open(item)"
        >
          <span
            :class="[
              'mt-0.5 grid size-8 shrink-0 place-items-center rounded-full',
              item.read ? 'bg-surface-muted text-ink-subtle' : 'bg-accent-soft text-accent',
            ]"
          >
            <component :is="item.messageId ? Inbox : FileText" class="size-3.5" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="flex items-start gap-2">
              <span
                :class="[
                  'min-w-0 flex-1 truncate text-[12.5px]',
                  item.read ? 'font-medium text-ink-muted' : 'font-semibold text-ink',
                ]"
              >
                {{ item.title }}
              </span>
              <span class="shrink-0 text-[10.5px] text-ink-subtle">{{ relativeTime(item.at) }}</span>
            </span>
            <span class="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-ink-muted">
              {{ item.detail }}
            </span>
          </span>
          <span
            v-if="!item.read"
            class="mt-2 size-1.5 shrink-0 rounded-full bg-accent"
            aria-hidden="true"
          />
        </button>
      </div>
    </template>
  </BaseDropdown>
</template>
