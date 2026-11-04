<script setup lang="ts">
import { Loader2, Save, Search, Users } from 'lucide-vue-next';
import { computed, onMounted, reactive, ref } from 'vue';

import {
  MENU_CATALOG,
  type MenuKey,
  type PublicUser,
  type UserMenuAssignment,
} from '@sirpefoffice/shared';

import { api } from '@/api/client';
import AppShell from '@/components/layout/AppShell.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import UserAvatar from '@/components/ui/UserAvatar.vue';
import { useToast } from '@/composables/useToast';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const toast = useToast();

const assignments = ref<UserMenuAssignment[]>([]);
const drafts = reactive<Record<string, MenuKey[]>>({});
const saving = reactive<Record<string, boolean>>({});
const loading = ref(true);
const query = ref('');

const filtered = computed(() => {
  const term = query.value.trim().toLowerCase();
  if (!term) return assignments.value;
  return assignments.value.filter(
    (user) =>
      user.name.toLowerCase().includes(term) || user.email.toLowerCase().includes(term),
  );
});

function isChecked(user: UserMenuAssignment, key: MenuKey): boolean {
  return drafts[user.id]?.includes(key) ?? false;
}

function toggle(user: UserMenuAssignment, key: MenuKey): void {
  if (key === 'home') return; // Inicio siempre está disponible.
  const current = drafts[user.id] ?? ['home'];
  drafts[user.id] = current.includes(key)
    ? current.filter((item) => item !== key)
    : [...current, key];
}

function selectAll(user: UserMenuAssignment): void {
  drafts[user.id] = MENU_CATALOG.map((item) => item.key);
}

function selectNone(user: UserMenuAssignment): void {
  drafts[user.id] = ['home'];
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await api.get<{ items: UserMenuAssignment[] }>('/menus/users');
    assignments.value = data.items;
    for (const user of data.items) drafts[user.id] = [...user.menus];
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudieron cargar los usuarios');
  } finally {
    loading.value = false;
  }
}

async function save(user: UserMenuAssignment): Promise<void> {
  if (saving[user.id]) return;
  saving[user.id] = true;
  try {
    const data = await api.put<{ user: PublicUser }>(`/menus/users/${user.id}`, {
      menus: drafts[user.id] ?? user.menus,
    });

    user.menus = [...data.user.menus];
    drafts[user.id] = [...data.user.menus];

    // Si el administrador se cambia sus propios menús, el sidebar debe
    // actualizarse sin esperar a recargar la página.
    if (auth.user?.id === data.user.id) auth.user = data.user;

    toast.success(`Menús actualizados para ${user.name}`);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudieron guardar los menús');
  } finally {
    saving[user.id] = false;
  }
}

onMounted(load);
</script>

<template>
  <AppShell>
    <PageHeader
      title="Usuarios y menús"
      subtitle="Elige qué secciones ve cada usuario. Los menús son independientes del rol."
    />

    <div class="mx-auto max-w-[1000px] px-5 pb-14 pt-2 sm:px-8">
      <section class="card p-5">
        <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div class="flex items-center gap-2">
            <Users class="size-4 text-ink-muted" />
            <h2 class="text-[14px] font-semibold">Asignación por usuario</h2>
          </div>
          <label class="relative block w-full sm:w-72">
            <Search class="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
            <input
              v-model="query"
              class="field pl-8"
              type="search"
              placeholder="Buscar por nombre o correo…"
            />
          </label>
        </div>

        <p class="mb-4 rounded-lg bg-surface-muted px-3 py-2.5 text-[12px] leading-relaxed text-ink-muted">
          «Inicio» siempre está visible. «Ajustes» se abre desde el avatar y no forma parte de
          esta configuración. Los usuarios de SVA aparecen tras la sincronización.
        </p>

        <div v-if="loading" class="grid place-items-center py-12">
          <Loader2 class="size-5 animate-spin text-ink-subtle" />
        </div>

        <div v-else-if="filtered.length === 0" class="py-10 text-center">
          <p class="text-[13px] text-ink-muted">No hay usuarios que coincidan con la búsqueda.</p>
        </div>

        <div v-else class="overflow-x-auto">
          <table class="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr class="border-b border-hairline text-[11px] uppercase tracking-wide text-ink-subtle">
                <th class="px-2 py-2.5 font-semibold">Usuario</th>
                <th v-for="menu in MENU_CATALOG" :key="menu.key" class="px-2 py-2.5 text-center font-semibold">
                  {{ menu.label }}
                </th>
                <th class="px-2 py-2.5 text-right font-semibold">Acción</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="user in filtered" :key="user.id" class="border-b border-hairline last:border-0">
                <td class="px-2 py-3">
                  <div class="flex items-center gap-2.5">
                    <UserAvatar :name="user.name" :src="user.avatarUrl" size="sm" />
                    <div class="min-w-0">
                      <div class="flex items-center gap-1.5">
                        <p class="truncate text-[13px] font-medium">{{ user.name }}</p>
                        <span v-if="!user.isActive" class="chip !bg-danger-soft !text-danger">Inactivo</span>
                      </div>
                      <p class="truncate text-[11.5px] text-ink-muted">{{ user.email }}</p>
                      <p class="mt-0.5 text-[10.5px] uppercase tracking-wide text-ink-subtle">
                        {{ user.role === 'admin' ? 'Administrador' : 'Miembro' }}
                        · {{ user.authProvider === 'sva' ? 'SVA' : 'Local' }}
                      </p>
                    </div>
                  </div>
                </td>

                <td v-for="menu in MENU_CATALOG" :key="menu.key" class="px-2 py-3 text-center">
                  <input
                    type="checkbox"
                    class="size-4 accent-[var(--color-accent)]"
                    :checked="isChecked(user, menu.key)"
                    :disabled="menu.key === 'home'"
                    :title="menu.key === 'home' ? 'Inicio siempre está visible' : menu.label"
                    @change="toggle(user, menu.key)"
                  />
                </td>

                <td class="px-2 py-3">
                  <div class="flex items-center justify-end gap-1.5">
                    <button
                      type="button"
                      class="text-[11.5px] font-medium text-ink-muted hover:text-ink"
                      @click="selectAll(user)"
                    >
                      Todos
                    </button>
                    <span class="text-ink-subtle">/</span>
                    <button
                      type="button"
                      class="text-[11.5px] font-medium text-ink-muted hover:text-ink"
                      @click="selectNone(user)"
                    >
                      Ninguno
                    </button>
                    <button
                      type="button"
                      class="btn btn-primary ml-1 !px-2.5 !py-1.5 text-[11.5px]"
                      :disabled="saving[user.id]"
                      @click="save(user)"
                    >
                      <component :is="saving[user.id] ? Loader2 : Save" :class="['size-3.5', saving[user.id] ? 'animate-spin' : '']" />
                      {{ saving[user.id] ? 'Guardando…' : 'Guardar' }}
                    </button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </AppShell>
</template>
