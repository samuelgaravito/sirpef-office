<script setup lang="ts">
import { UserPlus, X } from 'lucide-vue-next';
import { onMounted, ref, watch } from 'vue';

import { api } from '@/api/client';
import BaseModal from '@/components/ui/BaseModal.vue';
import UserAvatar from '@/components/ui/UserAvatar.vue';
import { useToast } from '@/composables/useToast';
import type { ListResponse, ShareRecord, UserListItem } from '@/types';

const props = defineProps<{
  open: boolean;
  documentId: string;
  shares: ShareRecord[];
}>();

const emit = defineEmits<{ close: []; changed: [] }>();

const toast = useToast();
const users = ref<UserListItem[]>([]);
const selectedUser = ref('');
const permission = ref<'editor' | 'viewer'>('editor');
const adding = ref(false);
const localShares = ref<ShareRecord[]>([]);

watch(
  () => props.shares,
  (value) => {
    localShares.value = [...value];
  },
  { immediate: true, deep: true },
);

async function loadUsers(): Promise<void> {
  try {
    const data = await api.get<ListResponse<UserListItem>>('/auth/users');
    users.value = data.items;
  } catch (error) {
    toast.failure(error, 'No se pudo cargar la lista de usuarios');
  }
}

const available = () =>
  users.value.filter((user) => !localShares.value.some((share) => share.userId === user.id));

async function add(): Promise<void> {
  if (!selectedUser.value || adding.value) return;
  adding.value = true;
  try {
    await api.post(`/documents/${props.documentId}/shares`, {
      userId: selectedUser.value,
      permission: permission.value,
    });
    const user = users.value.find((item) => item.id === selectedUser.value);
    if (user) {
      localShares.value.push({
        userId: user.id,
        name: user.name,
        email: user.email ?? '',
        permission: permission.value,
      });
    }
    selectedUser.value = '';
    toast.success('Acceso otorgado');
    emit('changed');
  } catch (error) {
    toast.failure(error, 'No se pudo compartir');
  } finally {
    adding.value = false;
  }
}

async function remove(userId: string): Promise<void> {
  try {
    await api.del(`/documents/${props.documentId}/shares/${userId}`);
    localShares.value = localShares.value.filter((share) => share.userId !== userId);
    toast.success('Acceso retirado');
    emit('changed');
  } catch (error) {
    toast.failure(error, 'No se pudo retirar el acceso');
  }
}

onMounted(loadUsers);
</script>

<template>
  <BaseModal
    :open="open"
    title="Compartir documento"
    description="Las personas con acceso pueden abrirlo desde su panel."
    @close="emit('close')"
  >
    <div class="flex flex-col gap-2 sm:flex-row">
      <select v-model="selectedUser" class="field flex-1">
        <option value="">Selecciona una persona…</option>
        <option v-for="user in available()" :key="user.id" :value="user.id">
          {{ user.name }}{{ user.email ? ` · ${user.email}` : '' }}
        </option>
      </select>
      <select v-model="permission" class="field w-full sm:w-[130px]">
        <option value="editor">Editor</option>
        <option value="viewer">Lector</option>
      </select>
      <button type="button" class="btn btn-primary" :disabled="!selectedUser || adding" @click="add">
        <UserPlus class="size-4" />
        Añadir
      </button>
    </div>

    <div class="mt-5">
      <p class="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">Con acceso</p>

      <div v-if="localShares.length === 0" class="rounded-lg border border-dashed border-hairline px-3 py-6 text-center text-[12.5px] text-ink-muted">
        Solo tú puedes ver este documento.
      </div>

      <ul v-else class="divide-y divide-hairline rounded-lg border border-hairline">
        <li v-for="share in localShares" :key="share.userId" class="flex items-center gap-2.5 px-3 py-2.5">
          <UserAvatar :name="share.name" size="sm" />
          <div class="min-w-0 flex-1">
            <p class="truncate text-[12.5px] font-medium">{{ share.name }}</p>
            <p class="truncate text-[11px] text-ink-subtle">{{ share.email }}</p>
          </div>
          <span class="chip">{{ share.permission === 'editor' ? 'Editor' : 'Lector' }}</span>
          <button
            type="button"
            class="rounded p-1 text-ink-subtle hover:bg-danger-soft hover:text-danger"
            :aria-label="`Quitar acceso a ${share.name}`"
            @click="remove(share.userId)"
          >
            <X class="size-3.5" />
          </button>
        </li>
      </ul>
    </div>
  </BaseModal>
</template>
