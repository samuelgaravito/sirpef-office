<script setup lang="ts">
import {
  ArrowRight,
  CornerDownLeft,
  FileText,
  House,
  Inbox,
  LayoutTemplate,
  Palette,
  Plus,
  Search,
  Settings,
  Users,
} from 'lucide-vue-next';
import { computed, nextTick, onBeforeUnmount, ref, watch, type Component } from 'vue';
import { useRouter } from 'vue-router';

import { MENU_CATALOG, type MenuKey } from '@sirpefoffice/shared';

import { useCreateDocument } from '@/composables/useCreateDocument';
import { useAuthStore } from '@/stores/auth';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

const router = useRouter();
const auth = useAuthStore();
const { creating, createDocument } = useCreateDocument();

const query = ref('');
const active = ref(0);
const input = ref<HTMLInputElement | null>(null);

const menuIcons: Record<MenuKey, Component> = {
  home: House,
  inbox: Inbox,
  documents: FileText,
  templates: LayoutTemplate,
  designs: Palette,
};

interface PaletteItem {
  id: string;
  label: string;
  hint: string;
  icon: Component;
  group: 'Módulos' | 'Acciones';
  run: () => void | Promise<void>;
}

const items = computed<PaletteItem[]>(() => {
  const modules: PaletteItem[] = MENU_CATALOG.filter((item) =>
    auth.canSeeMenu(item.key),
  ).map((item) => ({
    id: `module-${item.key}`,
    label: item.label,
    hint: item.key === 'home' ? 'Panel de trabajo' : 'Abrir módulo',
    icon: menuIcons[item.key],
    group: 'Módulos' as const,
    run: () => void router.push({ name: item.key }),
  }));

  const actions: PaletteItem[] = [];

  if (auth.canSeeMenu('documents')) {
    actions.push({
      id: 'action-new-document',
      label: creating.value ? 'Creando documento…' : 'Nuevo documento',
      hint: 'Empieza desde una plantilla o en blanco',
      icon: Plus,
      group: 'Acciones',
      run: async () => {
        await createDocument();
      },
    });
  }

  actions.push({
    id: 'action-settings',
    label: 'Ajustes',
    hint: 'Preferencias de la cuenta',
    icon: Settings,
    group: 'Acciones',
    run: () => void router.push({ name: 'settings' }),
  });

  if (auth.isAdmin) {
    actions.push({
      id: 'action-users',
      label: 'Usuarios y menús',
      hint: 'Administración de accesos',
      icon: Users,
      group: 'Acciones',
      run: () => void router.push({ name: 'settings-users' }),
    });
  }

  const all = [...modules, ...actions];
  const term = query.value.trim().toLowerCase();
  if (!term) return all;
  return all.filter(
    (item) =>
      item.label.toLowerCase().includes(term) || item.hint.toLowerCase().includes(term),
  );
});

const groups = computed(() => {
  const map = new Map<string, PaletteItem[]>();
  for (const item of items.value) {
    const list = map.get(item.group) ?? [];
    list.push(item);
    map.set(item.group, list);
  }
  return [...map.entries()];
});

/** Índice plano para navegar con teclado respetando el orden de los grupos. */
const flat = computed(() => groups.value.flatMap(([, list]) => list));

watch(
  () => props.open,
  async (open) => {
    if (!open) return;
    query.value = '';
    active.value = 0;
    await nextTick();
    input.value?.focus();
  },
);

watch(query, () => {
  active.value = 0;
});

function move(delta: number): void {
  const total = flat.value.length;
  if (total === 0) return;
  active.value = (active.value + delta + total) % total;
}

function choose(index: number): void {
  const item = flat.value[index];
  if (!item) return;
  emit('close');
  void item.run();
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    emit('close');
    return;
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    move(1);
    return;
  }
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    move(-1);
    return;
  }
  if (event.key === 'Enter') {
    event.preventDefault();
    choose(active.value);
  }
}

function indexOf(item: PaletteItem): number {
  return flat.value.indexOf(item);
}

onBeforeUnmount(() => {
  query.value = '';
});
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-120 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="open"
        class="fixed inset-0 z-[140] flex items-start justify-center bg-[#041e42]/45 p-4 pt-[12vh] backdrop-blur-[2px] sm:pt-[16vh]"
        @mousedown.self="emit('close')"
      >
        <div
          class="w-full max-w-xl overflow-hidden rounded-xl border border-hairline bg-surface shadow-[0_24px_70px_rgb(4_30_66/0.28)]"
          role="dialog"
          aria-modal="true"
          aria-label="Buscar y navegar"
          @keydown="onKeydown"
        >
          <div class="flex items-center gap-2.5 border-b border-hairline px-4">
            <Search class="size-4 shrink-0 text-ink-subtle" />
            <input
              ref="input"
              v-model="query"
              type="text"
              class="h-12 min-w-0 flex-1 border-0 bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-subtle"
              placeholder="Buscar módulos y acciones…"
              autocomplete="off"
            />
            <kbd
              class="hidden rounded border border-hairline bg-surface-muted px-1.5 py-0.5 text-[10px] font-semibold text-ink-subtle sm:block"
            >
              ESC
            </kbd>
          </div>

          <div class="max-h-[52vh] overflow-y-auto p-2">
            <p
              v-if="flat.length === 0"
              class="px-3 py-8 text-center text-[13px] text-ink-muted"
            >
              Sin resultados para «{{ query }}».
            </p>

            <div v-for="[group, list] in groups" :key="group" class="mb-1">
              <p
                class="px-2.5 pb-1 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-ink-subtle"
              >
                {{ group }}
              </p>
              <button
                v-for="item in list"
                :key="item.id"
                type="button"
                :class="[
                  'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors',
                  indexOf(item) === active
                    ? 'bg-accent-soft text-ink'
                    : 'text-ink-muted hover:bg-surface-hover hover:text-ink',
                ]"
                @mouseenter="active = indexOf(item)"
                @click="choose(indexOf(item))"
              >
                <span
                  class="grid size-7 shrink-0 place-items-center rounded-md border border-hairline bg-surface"
                >
                  <component :is="item.icon" class="size-3.5" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[13px] font-medium">{{ item.label }}</span>
                  <span class="block truncate text-[11.5px] text-ink-subtle">{{ item.hint }}</span>
                </span>
                <CornerDownLeft
                  v-if="indexOf(item) === active"
                  class="size-3.5 shrink-0 text-accent"
                />
                <ArrowRight v-else class="size-3.5 shrink-0 text-ink-subtle/70" />
              </button>
            </div>
          </div>

          <div
            class="flex items-center justify-between border-t border-hairline bg-surface-muted/60 px-4 py-2 text-[10.5px] text-ink-subtle"
          >
            <span class="flex items-center gap-3">
              <span class="flex items-center gap-1"><kbd class="kbd">↑</kbd><kbd class="kbd">↓</kbd> mover</span>
              <span class="flex items-center gap-1"><kbd class="kbd">↵</kbd> abrir</span>
            </span>
            <span>SirpefOffice</span>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.kbd {
  border: 1px solid var(--color-hairline);
  border-radius: 4px;
  background: var(--color-surface);
  padding: 0 4px;
  font-size: 10px;
  line-height: 15px;
  font-weight: 600;
  color: var(--color-ink-muted);
}
</style>
