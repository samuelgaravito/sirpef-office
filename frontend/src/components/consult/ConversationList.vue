<script setup lang="ts">
import {
  Check,
  Loader2,
  MessageSquarePlus,
  Pencil,
  Search,
  Trash2,
  X,
} from 'lucide-vue-next';
import { onMounted, ref, watch } from 'vue';

import { api } from '@/api/client';
import { errorMessage } from '@/lib/error-message';
import { relativeTime } from '@/lib/labels';
import type { AiConversationSummary, AiConversationsPage } from '@sirpefoffice/shared';

const props = withDefaults(
  defineProps<{
    activeId?: string | null;
    refreshKey?: number;
  }>(),
  { activeId: null, refreshKey: 0 },
);

const emit = defineEmits<{
  select: [id: string];
  create: [];
  deleted: [id: string];
}>();

const items = ref<AiConversationSummary[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const query = ref('');
const loading = ref(false);
const error = ref<string | null>(null);

const renamingId = ref<string | null>(null);
const renameText = ref('');
const confirmingId = ref<string | null>(null);

let searchTimer: number | undefined;

async function load(reset = false): Promise<void> {
  if (reset) {
    page.value = 1;
    items.value = [];
  }
  loading.value = true;
  error.value = null;
  try {
    const data = await api.get<AiConversationsPage>('/ai/conversations', {
      q: query.value.trim() || undefined,
      page: page.value,
      pageSize,
    });
    items.value = reset || page.value === 1 ? data.items : [...items.value, ...data.items];
    total.value = data.total;
  } catch (caught) {
    error.value = errorMessage(caught, 'No se pudo cargar el historial');
  } finally {
    loading.value = false;
  }
}

function onSearch(): void {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void load(true), 280);
}

function startRename(item: AiConversationSummary): void {
  renamingId.value = item.id;
  renameText.value = item.title;
  confirmingId.value = null;
}

async function confirmRename(item: AiConversationSummary): Promise<void> {
  const title = renameText.value.trim();
  if (!title || title === item.title) {
    renamingId.value = null;
    return;
  }
  try {
    await api.patch(`/ai/conversations/${item.id}`, { title });
    item.title = title;
    renamingId.value = null;
  } catch (caught) {
    error.value = errorMessage(caught, 'No se pudo renombrar la conversación');
  }
}

async function confirmDelete(item: AiConversationSummary): Promise<void> {
  try {
    await api.del(`/ai/conversations/${item.id}`);
    items.value = items.value.filter((row) => row.id !== item.id);
    total.value = Math.max(0, total.value - 1);
    confirmingId.value = null;
    emit('deleted', item.id);
  } catch (caught) {
    error.value = errorMessage(caught, 'No se pudo borrar la conversación');
  }
}

function loadMore(): void {
  if (items.value.length >= total.value || loading.value) return;
  page.value += 1;
  void load();
}

watch(
  () => props.refreshKey,
  () => void load(true),
);

onMounted(() => void load(true));
</script>

<template>
  <aside class="flex h-full min-h-0 flex-col">
    <div class="flex items-center gap-2 px-1 pb-2 pt-1">
      <p class="flex-1 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/45">
        Conversaciones
      </p>
      <button
        type="button"
        class="grid size-7 place-items-center rounded-full border border-white/12 text-white/65 transition-colors hover:border-white/30 hover:bg-white/10 hover:text-white"
        title="Nueva consulta"
        @click="emit('create')"
      >
        <MessageSquarePlus class="size-3.5" />
      </button>
    </div>

    <label class="relative mb-2 block px-1">
      <Search class="pointer-events-none absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-white/35" />
      <input
        v-model="query"
        type="search"
        placeholder="Buscar conversación…"
        class="h-8 w-full rounded-full border border-white/12 bg-white/[0.05] pl-8 pr-3 text-[12px] text-white placeholder:text-white/35 focus:border-white/30 focus:outline-none"
        @input="onSearch"
      />
    </label>

    <p v-if="error" class="mx-1 mb-2 rounded-lg bg-[#c81e00]/15 px-2 py-1.5 text-[11px] text-[#ffb4ab]">
      {{ error }}
    </p>

    <div class="min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5">
      <p v-if="loading && items.length === 0" class="flex items-center gap-2 px-2 py-4 text-[11.5px] text-white/45">
        <Loader2 class="size-3.5 animate-spin" />
        Cargando…
      </p>

      <p v-else-if="items.length === 0" class="px-2 py-4 text-[11.5px] leading-relaxed text-white/40">
        Todavía no hay conversaciones guardadas.
      </p>

      <div v-for="item in items" :key="item.id" class="group">
        <div
          v-if="renamingId === item.id"
          class="flex items-center gap-1 rounded-lg border border-white/20 bg-white/[0.07] px-2 py-1.5"
        >
          <input
            v-model="renameText"
            class="min-w-0 flex-1 bg-transparent text-[12px] text-white focus:outline-none"
            maxlength="120"
            @keydown.enter.prevent="confirmRename(item)"
            @keydown.esc="renamingId = null"
          />
          <button
            type="button"
            class="text-[#7df3dd] hover:text-white"
            title="Guardar nombre"
            @click="confirmRename(item)"
          >
            <Check class="size-3.5" />
          </button>
          <button type="button" class="text-white/45 hover:text-white" title="Cancelar" @click="renamingId = null">
            <X class="size-3.5" />
          </button>
        </div>

        <div
          v-else
          :class="[
            'flex items-start gap-1.5 rounded-lg px-2 py-1.5 transition-colors',
            props.activeId === item.id ? 'bg-white/[0.12]' : 'hover:bg-white/[0.07]',
          ]"
        >
          <button
            type="button"
            class="min-w-0 flex-1 text-left"
            @click="emit('select', item.id)"
          >
            <span class="block truncate text-[12px] font-medium text-white/85">{{ item.title }}</span>
            <span class="mt-0.5 block truncate text-[10.5px] text-white/40">
              {{ relativeTime(item.updatedAt) }} · {{ item.messageCount }} mensaje{{ item.messageCount === 1 ? '' : 's' }}
            </span>
            <span v-if="item.preview" class="mt-0.5 block truncate text-[10.5px] text-white/35">
              {{ item.preview }}
            </span>
          </button>

          <div class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              class="grid size-6 place-items-center rounded text-white/40 hover:bg-white/10 hover:text-white"
              title="Renombrar"
              @click="startRename(item)"
            >
              <Pencil class="size-3" />
            </button>
            <button
              type="button"
              class="grid size-6 place-items-center rounded text-white/40 hover:bg-white/10 hover:text-[#ffb4ab]"
              title="Borrar"
              @click="confirmingId = item.id"
            >
              <Trash2 class="size-3" />
            </button>
          </div>
        </div>

        <div
          v-if="confirmingId === item.id"
          class="mt-1 flex items-center gap-2 rounded-lg bg-[#c81e00]/12 px-2 py-1.5 text-[11px] text-[#ffb4ab]"
        >
          <span class="flex-1">¿Borrar esta conversación?</span>
          <button type="button" class="font-medium text-white hover:underline" @click="confirmDelete(item)">
            Sí
          </button>
          <button type="button" class="text-white/55 hover:text-white" @click="confirmingId = null">
            No
          </button>
        </div>
      </div>

      <button
        v-if="items.length > 0 && items.length < total"
        type="button"
        class="w-full rounded-lg py-2 text-[11px] text-white/45 hover:bg-white/[0.06] hover:text-white/80"
        :disabled="loading"
        @click="loadMore"
      >
        {{ loading ? 'Cargando…' : 'Ver más conversaciones' }}
      </button>
    </div>
  </aside>
</template>
