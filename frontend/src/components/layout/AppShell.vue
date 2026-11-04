<script setup lang="ts">
import {
  ChevronDown,
  FileText,
  House,
  Inbox,
  LayoutTemplate,
  Loader2,
  LogOut,
  Menu,
  Palette,
  Plus,
  Settings,
  X,
} from 'lucide-vue-next';
import { computed, onMounted, onUnmounted, ref, watch, type Component } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { MENU_CATALOG, type MenuKey } from '@sirpefoffice/shared';

import BaseDropdown from '@/components/ui/BaseDropdown.vue';
import UserAvatar from '@/components/ui/UserAvatar.vue';
import { useCreateDocument } from '@/composables/useCreateDocument';
import { useInboxBadge } from '@/composables/useInboxBadge';
import { useToast } from '@/composables/useToast';
import { logoutFromSva, redirectToSvaLogin } from '@/lib/sva';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const router = useRouter();
const route = useRoute();
const mobileOpen = ref(false);
const { creating, createDocument } = useCreateDocument();
const { totalCount, resultCount, latestResult, refresh: refreshInbox } = useInboxBadge();
const toast = useToast();

const menuIcons: Record<MenuKey, Component> = {
  home: House,
  inbox: Inbox,
  documents: FileText,
  templates: LayoutTemplate,
  designs: Palette,
};

const nav = computed(() =>
  MENU_CATALOG.filter((item) => auth.canSeeMenu(item.key)).map((item) => ({
    name: item.key,
    label: item.label,
    icon: menuIcons[item.key],
  })),
);

const canCreateDocuments = computed(() => auth.canSeeMenu('documents'));

let pollTimer: number | undefined;
let lastResultCount: number | null = null;

function notifyLatestResult(): void {
  const result = latestResult.value;
  if (!result) return;
  if (result.status === 'sent') {
    toast.success(
      `Tu memorándum «${result.subject}» fue aprobado por ${result.approverName}`,
    );
  } else {
    toast.error(`Tu memorándum «${result.subject}» fue rechazado`);
  }
}

async function pollInbox(): Promise<void> {
  const previous = resultCount.value;
  await refreshInbox();
  if (lastResultCount !== null && resultCount.value > previous && latestResult.value) {
    notifyLatestResult();
  }
  lastResultCount = resultCount.value;
}

onMounted(() => {
  if (!auth.canSeeMenu('inbox')) return;
  void refreshInbox().then(() => {
    lastResultCount = resultCount.value;
  });
  // Sondeo ligero para avisar de aprobaciones/rechazos sin recargar.
  pollTimer = window.setInterval(() => void pollInbox(), 60_000);
});

onUnmounted(() => {
  if (pollTimer !== undefined) window.clearInterval(pollTimer);
});

watch(
  () => route.fullPath,
  () => {
    if (auth.canSeeMenu('inbox')) void refreshInbox();
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
  <div class="flex h-full min-h-0">
    <!-- Sidebar de escritorio -->
    <aside class="hidden w-[232px] shrink-0 flex-col border-r border-hairline bg-surface md:flex">
      <div class="flex h-14 items-center gap-2.5 px-5">
        <span class="grid size-7 place-items-center rounded-lg bg-accent text-[13px] font-black text-accent-ink">
          W
        </span>
        <span class="text-[15px] font-semibold tracking-tight">SirpefOffice</span>
      </div>

      <nav class="flex-1 space-y-0.5 px-3 py-3">
        <RouterLink
          v-for="item in nav"
          :key="item.name"
          :to="{ name: item.name }"
          class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-ink-muted transition-colors hover:bg-surface-hover hover:text-ink"
          active-class="!bg-accent-soft !text-accent"
        >
          <component :is="item.icon" class="size-4 shrink-0" />
          <span class="flex-1">{{ item.label }}</span>
          <span
            v-if="item.name === 'inbox' && totalCount > 0"
            class="grid min-w-5 place-items-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent-ink"
          >
            {{ totalCount > 99 ? '99+' : totalCount }}
          </span>
        </RouterLink>
      </nav>

      <div class="border-t border-hairline p-3">
        <button
          v-if="canCreateDocuments"
          type="button"
          class="btn btn-primary w-full"
          :disabled="creating !== null"
          @click="createDocument()"
        >
          <component :is="creating === 'blank' ? Loader2 : Plus" :class="['size-4', creating === 'blank' ? 'animate-spin' : '']" />
          {{ creating === 'blank' ? 'Creando…' : 'Nuevo documento' }}
        </button>

        <BaseDropdown side="top" align="left" width="w-full">
          <template #trigger>
            <button
              type="button"
              class="mt-2 flex w-full items-center gap-2.5 rounded-lg p-2 text-left transition-colors hover:bg-surface-hover"
            >
              <UserAvatar :name="auth.user?.name" :src="auth.user?.avatarUrl" size="sm" />
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[12.5px] font-medium">{{ auth.user?.name }}</span>
                <span class="block truncate text-[11px] text-ink-subtle">{{ auth.user?.email }}</span>
              </span>
              <ChevronDown class="size-3.5 shrink-0 text-ink-subtle" />
            </button>
          </template>
          <template #content>
            <RouterLink
              :to="{ name: 'settings' }"
              class="flex items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink"
            >
              <Settings class="size-4" />
              Ajustes
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
    </aside>

    <!-- Drawer móvil -->
    <Transition
      enter-active-class="transition duration-150"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition duration-120"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="mobileOpen"
        class="fixed inset-0 z-40 bg-[#0b1220]/40 md:hidden"
        @click="mobileOpen = false"
      />
    </Transition>
    <aside
      :class="[
        'fixed inset-y-0 left-0 z-50 flex w-[248px] flex-col border-r border-hairline bg-surface transition-transform duration-200 md:hidden',
        mobileOpen ? 'translate-x-0' : '-translate-x-full',
      ]"
    >
      <div class="flex h-14 items-center justify-between px-4">
        <span class="flex items-center gap-2.5">
          <span class="grid size-7 place-items-center rounded-lg bg-accent text-[13px] font-black text-accent-ink">W</span>
          <span class="text-[15px] font-semibold">SirpefOffice</span>
        </span>
        <button type="button" class="rounded-lg p-1.5 hover:bg-surface-hover" @click="mobileOpen = false">
          <X class="size-4" />
        </button>
      </div>
      <nav class="flex-1 space-y-0.5 px-3 py-2">
        <RouterLink
          v-for="item in nav"
          :key="item.name"
          :to="{ name: item.name }"
          class="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium text-ink-muted hover:bg-surface-hover"
          active-class="!bg-accent-soft !text-accent"
          @click="mobileOpen = false"
        >
          <component :is="item.icon" class="size-4 shrink-0" />
          <span class="flex-1">{{ item.label }}</span>
          <span
            v-if="item.name === 'inbox' && totalCount > 0"
            class="grid min-w-5 place-items-center rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold leading-none text-accent-ink"
          >
            {{ totalCount > 99 ? '99+' : totalCount }}
          </span>
        </RouterLink>
      </nav>
      <div class="space-y-2 border-t border-hairline p-3">
        <button
          v-if="canCreateDocuments"
          type="button"
          class="btn btn-primary w-full"
          :disabled="creating !== null"
          @click="mobileOpen = false; createDocument()"
        >
          <component :is="creating === 'blank' ? Loader2 : Plus" :class="['size-4', creating === 'blank' ? 'animate-spin' : '']" />
          {{ creating === 'blank' ? 'Creando…' : 'Nuevo documento' }}
        </button>
        <button type="button" class="btn btn-ghost w-full justify-start" @click="signOut">
          <LogOut class="size-4" />
          Cerrar sesión
        </button>
      </div>
    </aside>

    <!-- Contenido -->
    <div class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-14 shrink-0 items-center gap-3 border-b border-hairline bg-surface/80 px-4 backdrop-blur md:hidden">
        <button type="button" class="rounded-lg p-1.5 hover:bg-surface-hover" @click="mobileOpen = true">
          <Menu class="size-5" />
        </button>
        <span class="text-sm font-semibold">SirpefOffice</span>
      </header>

      <main class="min-h-0 flex-1 overflow-y-auto">
        <slot />
      </main>
    </div>
  </div>
</template>
