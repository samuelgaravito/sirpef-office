<script setup lang="ts">
import {
  ChevronDown,
  Command,
  Inbox,
  LogOut,
  Search,
  Settings,
  Users,
} from 'lucide-vue-next';
import { computed, inject, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import {
  MENU_CATALOG,
  isInboxRealtimeEvent,
  type RealtimeMessage,
} from '@sirpefoffice/shared';

import BaseDropdown from '@/components/ui/BaseDropdown.vue';
import CommandPalette from '@/components/layout/CommandPalette.vue';
import UserAvatar from '@/components/ui/UserAvatar.vue';
import { useInboxBadge } from '@/composables/useInboxBadge';
import { onRealtimeEvent } from '@/composables/useRealtime';
import { useToast } from '@/composables/useToast';
import { logoutFromSva, redirectToSvaLogin } from '@/lib/sva';
import { PANEL_MODE } from '@/lib/panel';
import type { Point } from '@/lib/motion';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const { totalCount, refresh: refreshInbox } = useInboxBadge();
const toast = useToast();

/** Dentro de un panel modal el marco lo pone `ModulePanel`. */
const embedded = inject(PANEL_MODE, false);

const paletteOpen = ref(false);
const paletteOrigin = ref<Point | null>(null);
const isMac = ref(false);

const canSeeInbox = computed(() => auth.canSeeMenu('inbox'));

const sectionLabel = computed(() => {
  const title = typeof route.meta.title === 'string' ? route.meta.title : 'Inicio';
  const menu = MENU_CATALOG.find((item) => item.key === route.meta.menu);
  if (route.name === 'home') return 'Panel de trabajo';
  return menu?.label ?? title;
});

const initials = computed(() => {
  const source = auth.user?.name?.trim() || auth.user?.email || '?';
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
});

/**
 * Sondeo de seguridad. El canal de eventos mantiene los contadores al día,
 * pero si se cae (proxy, red) el sondeo los vuelve a poner al día aunque sea
 * más tarde.
 */
const FALLBACK_POLL_MS = 5 * 60_000;

let pollTimer: number | undefined;
let unsubscribeRealtime: (() => void) | undefined;

/**
 * Avisa de los cambios de la bandeja que llegan por el canal de eventos.
 *
 * El evento solo dice *qué* ha cambiado; los contadores se vuelven a pedir
 * con la API de siempre para no mantener dos versiones de los datos.
 */
async function handleRealtimeEvent(message: RealtimeMessage): Promise<void> {
  if (!isInboxRealtimeEvent(message.type)) return;

  await refreshInbox();

  const payload = message.payload;
  if (!payload) return;
  if (message.type === 'inbox.result.approved') {
    toast.success(
      `Tu documento «${payload.subject}» fue aprobado por ${payload.actorName}`,
    );
  } else if (message.type === 'inbox.result.rejected') {
    toast.error(`Tu documento «${payload.subject}» fue rechazado`);
  }
}

function onGlobalKeydown(event: KeyboardEvent): void {
  const target = event.target as HTMLElement | null;
  const typing =
    target?.tagName === 'INPUT' ||
    target?.tagName === 'TEXTAREA' ||
    target?.isContentEditable === true;

  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    if (paletteOpen.value) paletteOpen.value = false;
    else openPalette();
    return;
  }

  if (event.key === '/' && !typing && !paletteOpen.value) {
    event.preventDefault();
    openPalette();
  }
}

/** Abre la paleta anclada al botón que la invoca (o centrada con teclado). */
function openPalette(event?: Event): void {
  const el = event?.currentTarget as HTMLElement | null;
  if (el) {
    const rect = el.getBoundingClientRect();
    paletteOrigin.value = { x: rect.left + rect.width / 2, y: rect.bottom - 4 };
  } else {
    paletteOrigin.value = null;
  }
  paletteOpen.value = true;
}

onMounted(() => {
  if (embedded) return;
  isMac.value = /Mac|iPhone|iPad/.test(navigator.platform);
  window.addEventListener('keydown', onGlobalKeydown);

  unsubscribeRealtime = onRealtimeEvent((message) => {
    void handleRealtimeEvent(message);
  });

  if (!canSeeInbox.value) return;
  void refreshInbox();
  // Sondeo ligero como red de seguridad si el canal de eventos se cae.
  pollTimer = window.setInterval(() => void refreshInbox(), FALLBACK_POLL_MS);
});

onUnmounted(() => {
  if (pollTimer !== undefined) window.clearInterval(pollTimer);
  unsubscribeRealtime?.();
  window.removeEventListener('keydown', onGlobalKeydown);
});

watch(
  () => route.fullPath,
  () => {
    paletteOpen.value = false;
    if (canSeeInbox.value) void refreshInbox();
  },
);

async function signOut(): Promise<void> {
  await auth.logout();
  if (auth.authMode !== 'local') {
    await logoutFromSva();
    redirectToSvaLogin();
    return;
  }
  await router.push({ name: 'login' });
}
</script>

<template>
  <!-- Dentro de un panel modal: sin barra superior, solo el contenido. -->
  <div v-if="embedded" class="h-full min-h-0 overflow-y-auto">
    <slot />
  </div>

  <div v-else class="flex h-full min-h-0 flex-col bg-canvas">
    <!-- Barra superior -->
    <header
      class="app-header sticky top-0 z-30 shrink-0 border-b border-hairline bg-surface/85 backdrop-blur-md"
    >
      <div class="mx-auto flex h-16 w-full max-w-[1280px] items-center gap-3 px-4 sm:px-6">
        <!-- Marca -->
        <RouterLink
          :to="{ name: 'home' }"
          class="group flex shrink-0 items-center gap-2.5"
          aria-label="SirpefOffice, ir al panel"
        >
          <span
            class="relative grid size-9 place-items-center rounded-[10px] bg-gradient-to-br from-navy to-navy-soft text-[15px] font-bold text-white shadow-[0_2px_6px_rgb(4_30_66/0.25)] transition-transform group-hover:-translate-y-px"
          >
            S
            <span
              class="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full bg-mint ring-2 ring-surface"
            />
          </span>
          <span class="hidden flex-col leading-none sm:flex">
            <span class="text-[15px] font-semibold tracking-tight text-ink">SirpefOffice</span>
            <span class="mt-1 text-[10px] font-medium uppercase tracking-[0.12em] text-ink-subtle">
              Gestión documental
            </span>
          </span>
        </RouterLink>

        <span class="mx-1 hidden h-6 w-px bg-hairline lg:block" />

        <div class="hidden min-w-0 items-center gap-1.5 text-[12.5px] lg:flex">
          <RouterLink
            :to="{ name: 'home' }"
            class="rounded px-1.5 py-1 font-medium text-ink-subtle transition-colors hover:bg-surface-hover hover:text-ink"
          >
            Inicio
          </RouterLink>
          <span class="text-ink-subtle/60">/</span>
          <span class="truncate rounded bg-surface-muted px-1.5 py-1 font-medium text-ink-muted">
            {{ sectionLabel }}
          </span>
        </div>

        <div class="flex-1" />

        <!-- Buscador / paleta -->
        <button
          type="button"
          class="hidden h-9 items-center gap-2 rounded-field border border-hairline bg-surface-muted/70 pl-2.5 pr-2 text-[12.5px] text-ink-subtle transition-colors hover:border-hairline-strong hover:bg-surface sm:flex sm:w-56 lg:w-64"
          @click="openPalette"
        >
          <Search class="size-3.5 shrink-0" />
          <span class="flex-1 truncate text-left">Buscar o ir a…</span>
          <kbd
            class="flex items-center gap-0.5 rounded border border-hairline bg-surface px-1 py-0.5 text-[10px] font-semibold text-ink-muted"
          >
            <Command v-if="isMac" class="size-2.5" />
            <span v-else>Ctrl</span>
            K
          </kbd>
        </button>

        <button
          type="button"
          class="grid size-9 place-items-center rounded-field border border-hairline bg-surface text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink sm:hidden"
          aria-label="Buscar"
          @click="openPalette"
        >
          <Search class="size-4" />
        </button>

        <!-- Bandeja -->
        <button
          v-if="canSeeInbox"
          type="button"
          class="relative grid size-9 place-items-center rounded-field border border-hairline bg-surface text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
          aria-label="Abrir bandeja"
          @click="router.push({ name: 'inbox' })"
        >
          <Inbox class="size-4" />
          <span
            v-if="totalCount > 0"
            class="absolute -right-1.5 -top-1.5 grid min-w-[18px] place-items-center rounded-full bg-accent px-1 py-0.5 text-[10px] font-bold leading-none text-white ring-2 ring-surface"
          >
            {{ totalCount > 99 ? '99+' : totalCount }}
          </span>
        </button>

        <!-- Usuario -->
        <BaseDropdown align="right" width="w-64">
          <template #trigger>
            <button
              type="button"
              class="flex h-9 items-center gap-2 rounded-field border border-transparent pl-1 pr-1.5 transition-colors hover:border-hairline hover:bg-surface-muted/70"
              aria-label="Menú de usuario"
            >
              <UserAvatar :name="auth.user?.name" :src="auth.user?.avatarUrl" size="sm" />
              <span class="hidden max-w-[120px] truncate text-[12.5px] font-semibold text-ink lg:block">
                {{ auth.user?.name }}
              </span>
              <ChevronDown class="hidden size-3.5 shrink-0 text-ink-subtle lg:block" />
            </button>
          </template>
          <template #content>
            <div class="border-b border-hairline px-2.5 pb-2.5 pt-1">
              <p class="truncate text-[13px] font-semibold text-ink">{{ auth.user?.name }}</p>
              <p class="truncate text-[11.5px] text-ink-subtle">{{ auth.user?.email }}</p>
            </div>
            <RouterLink
              :to="{ name: 'settings' }"
              class="mt-1 flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink"
            >
              <Settings class="size-4" />
              Ajustes
            </RouterLink>
            <RouterLink
              v-if="auth.isAdmin"
              :to="{ name: 'settings-users' }"
              class="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink"
            >
              <Users class="size-4" />
              Usuarios y menús
            </RouterLink>
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink"
              @click="signOut"
            >
              <LogOut class="size-4" />
              Cerrar sesión
            </button>
          </template>
        </BaseDropdown>
      </div>
    </header>

    <!-- Contenido -->
    <main class="min-h-0 flex-1 overflow-y-auto">
      <slot />
    </main>

    <CommandPalette :open="paletteOpen" :origin="paletteOrigin" @close="paletteOpen = false" />
  </div>
</template>
