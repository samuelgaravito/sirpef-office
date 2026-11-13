<script setup lang="ts">
import { FileText, Hash, Loader2, Search, Send, TriangleAlert, Users, X } from 'lucide-vue-next';
import { computed, ref, watch } from 'vue';

import { NUMBERING_MESSAGES, type NumberingPreview } from '@sirpefoffice/shared';

import { api } from '@/api/client';
import BaseModal from '@/components/ui/BaseModal.vue';
import UserAvatar from '@/components/ui/UserAvatar.vue';
import { useInboxBadge } from '@/composables/useInboxBadge';
import { useToast } from '@/composables/useToast';
import { useAuthStore } from '@/stores/auth';
import type { ListResponse, UserListItem } from '@/types';

const props = withDefaults(
  defineProps<{
    open: boolean;
    documentId: string;
    documentTitle: string;
    expectedVersion: number;
    mode?: 'send' | 'approve';
    messageId?: string | null;
    /** Versión que tenía el documento cuando se envió a aprobación. */
    sentVersion?: number | null;
    initialSubject?: string;
    initialBody?: string;
    initialRecipientIds?: string[];
    /** Número ya asignado al documento, si lo tiene. */
    docNumber?: string | null;
    /** Número previsto mientras el documento es borrador. */
    numbering?: NumberingPreview | null;
  }>(),
  {
    mode: 'send',
    messageId: null,
    sentVersion: null,
    initialSubject: '',
    initialBody: '',
    initialRecipientIds: () => [],
    docNumber: null,
    numbering: null,
  },
);

const emit = defineEmits<{
  close: [];
  sent: [payload: { id: string; status: 'sent' | 'pending_approval' }];
}>();

const auth = useAuthStore();
const toast = useToast();
const { refresh: refreshInbox } = useInboxBadge();

const users = ref<UserListItem[]>([]);
const loadingUsers = ref(false);
const search = ref('');
const selected = ref<string[]>([]);
const subject = ref('');
const body = ref('');
const allowSenderExport = ref(false);
const submitting = ref(false);
const editing = ref(false);

const isApprove = computed(() => props.mode === 'approve');
const pendingNumber = computed(() =>
  props.docNumber ? null : (props.numbering?.number ?? null),
);
const versionChanged = computed(
  () =>
    isApprove.value &&
    props.sentVersion !== null &&
    props.sentVersion !== props.expectedVersion,
);
const title = computed(() => (isApprove.value ? 'Aprobar y enviar' : 'Enviar documento'));
const description = computed(() =>
  isApprove.value
    ? 'Confirma el envío y los destinatarios. Al aprobar, el documento quedará bloqueado como solo lectura.'
    : auth.isAdmin
      ? 'El documento se enviará y quedará bloqueado como solo lectura.'
      : 'El jefe recibirá la solicitud y, cuando la apruebe, se enviará a los destinatarios.',
);

const available = computed(() => {
  const term = search.value.trim().toLowerCase();
  return users.value
    .filter((user) => user.id !== auth.user?.id)
    .filter((user) => {
      if (!term) return true;
      return `${user.name} ${user.email ?? ''}`.toLowerCase().includes(term);
    });
});

const selectedUsers = computed(() =>
  selected.value
    .map((id) => users.value.find((user) => user.id === id))
    .filter((user): user is UserListItem => Boolean(user)),
);

const recipientNames = computed(() => selectedUsers.value.map((user) => user.name).join(', '));

const canSubmit = computed(
  () =>
    !submitting.value &&
    Boolean(subject.value.trim()) &&
    selected.value.length > 0 &&
    (!isApprove.value || Boolean(props.messageId)),
);

async function loadUsers(): Promise<void> {
  if (users.value.length > 0) return;
  loadingUsers.value = true;
  try {
    const data = await api.get<ListResponse<UserListItem>>('/auth/users');
    users.value = data.items;
  } catch (error) {
    toast.failure(error, 'No se pudo cargar la lista de usuarios');
  } finally {
    loadingUsers.value = false;
  }
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    subject.value = props.initialSubject || props.documentTitle;
    body.value = props.initialBody;
    selected.value = [...props.initialRecipientIds];
    allowSenderExport.value = false;
    search.value = '';
    editing.value = false;
    void loadUsers();
  },
);

function toggle(userId: string): void {
  selected.value = selected.value.includes(userId)
    ? selected.value.filter((id) => id !== userId)
    : [...selected.value, userId];
}

function remove(userId: string): void {
  selected.value = selected.value.filter((id) => id !== userId);
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return;
  submitting.value = true;
  try {
    const payload = {
      subject: subject.value.trim(),
      body: body.value.trim(),
      recipientIds: selected.value,
      expectedVersion: props.expectedVersion,
      ...(isApprove.value ? { allowSenderExport: allowSenderExport.value } : {}),
    };

    if (isApprove.value && props.messageId) {
      const response = await api.post<{
        ok: boolean;
        id: string;
        status: string;
        docNumber: string | null;
      }>(`/inbox/${props.messageId}/approve`, payload);

      const assigned = response.docNumber;
      const previous = pendingNumber.value;
      let message: string;
      if (assigned && previous && assigned !== previous) {
        message = NUMBERING_MESSAGES.changedFrom(assigned, previous);
      } else if (assigned) {
        message = NUMBERING_MESSAGES.approvedAs(assigned);
      } else {
        message = 'Documento aprobado y enviado';
      }
      message += allowSenderExport.value
        ? '. El asistente también podrá exportarlo'
        : '. Solo el administrador podrá exportarlo';
      toast.success(message);

      await refreshInbox();
      emit('sent', { id: props.messageId, status: 'sent' });
    } else {
      const response = await api.post<{
        id: string;
        status: 'sent' | 'pending_approval';
        docNumber: string | null;
      }>('/inbox', { ...payload, documentId: props.documentId });
      if (response.status === 'pending_approval') {
        toast.success('Enviado a aprobación del jefe');
      } else if (response.docNumber) {
        toast.success(NUMBERING_MESSAGES.approvedAs(response.docNumber));
      } else {
        toast.success('Documento enviado');
      }
      await refreshInbox();
      emit('sent', { id: response.id, status: response.status });
    }
  } catch (error) {
    toast.failure(error, 'No se pudo enviar el documento');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <BaseModal :open="open" :title="title" :description="description" size="lg" @close="emit('close')">
    <div class="space-y-4">
      <!-- Documento adjunto -->
      <div class="flex items-center gap-2.5 rounded-xl border border-hairline bg-surface-muted/60 px-3 py-2.5">
        <span class="grid size-9 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent">
          <FileText class="size-4" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">Documento adjunto</p>
          <p class="truncate text-[13px] font-medium text-ink">{{ documentTitle }}</p>
          <p class="text-meta mt-0.5">Versión a sellar: v{{ expectedVersion }}</p>
        </div>
      </div>

      <!-- Número que tendrá el documento al oficializarse -->
      <div
        v-if="pendingNumber"
        class="flex items-start gap-2.5 rounded-xl border border-dashed border-accent/40 bg-accent-soft/40 px-3 py-2.5"
      >
        <Hash class="mt-0.5 size-4 shrink-0 text-accent" />
        <div class="min-w-0">
          <p class="text-description leading-snug text-ink">
            Al aprobarse, este documento quedará numerado como
            <strong class="font-semibold text-accent">{{ pendingNumber }}</strong>.
          </p>
          <p class="text-meta mt-0.5">{{ NUMBERING_MESSAGES.pendingWarning }}</p>
        </div>
      </div>
      <div
        v-else-if="docNumber"
        class="flex items-center gap-2.5 rounded-xl border border-hairline bg-surface-muted/60 px-3 py-2.5"
      >
        <Hash class="size-4 shrink-0 text-accent" />
        <p class="text-[12.5px] text-ink">
          Número del documento:
          <strong class="font-semibold">{{ docNumber }}</strong>
        </p>
      </div>

      <div
        v-if="versionChanged"
        class="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger-soft/60 px-3 py-2.5 text-[13px] leading-snug text-danger"
      >
        <TriangleAlert class="mt-0.5 size-4 shrink-0" />
        <span>
          El documento cambió desde el envío: se envió la v{{ sentVersion }} y ahora está en la
          v{{ expectedVersion }}. Revisa el contenido en el mensaje antes de aprobar.
        </span>
      </div>

      <!-- Resumen para el jefe: primero lo esencial, editar solo si hace falta -->
      <div v-if="isApprove && !editing" class="rounded-xl border border-hairline bg-surface-muted/50 px-3.5 py-3">
        <div class="flex items-center justify-between gap-2">
          <p class="text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">Resumen del envío</p>
          <button
            type="button"
            class="text-[13px] font-medium text-accent hover:underline"
            @click="editing = true"
          >
            Ajustar antes de enviar
          </button>
        </div>
        <dl class="mt-2.5 space-y-2 text-[13.5px]">
          <div class="flex gap-2">
            <dt class="w-[86px] shrink-0 text-ink-subtle">Destinatarios</dt>
            <dd :class="['min-w-0 flex-1', recipientNames ? 'text-ink' : 'font-medium text-danger']">
              {{ recipientNames || 'Sin destinatarios' }}
            </dd>
          </div>
          <div class="flex gap-2">
            <dt class="w-[86px] shrink-0 text-ink-subtle">Asunto</dt>
            <dd class="min-w-0 flex-1 font-medium text-ink">{{ subject || '—' }}</dd>
          </div>
          <div v-if="body.trim()" class="flex gap-2">
            <dt class="w-[86px] shrink-0 text-ink-subtle">Mensaje</dt>
            <dd class="line-clamp-3 min-w-0 flex-1 whitespace-pre-wrap text-ink-muted">{{ body }}</dd>
          </div>
        </dl>
      </div>

      <div v-if="isApprove && editing" class="flex justify-end">
        <button
          type="button"
          class="text-[13px] font-medium text-accent hover:underline"
          @click="editing = false"
        >
          Volver al resumen
        </button>
      </div>

      <!-- Destinatarios -->
      <div v-if="!isApprove || editing">
        <div class="mb-1.5 flex items-center justify-between">
          <label class="label mb-0">Destinatarios</label>
          <span class="text-[12.5px] text-ink-subtle">{{ selected.length }} seleccionado{{ selected.length === 1 ? '' : 's' }}</span>
        </div>

        <div v-if="selectedUsers.length > 0" class="mb-2 flex flex-wrap gap-1.5">
          <span
            v-for="user in selectedUsers"
            :key="user.id"
            class="inline-flex items-center gap-1.5 rounded-full bg-accent-soft py-1 pl-1 pr-2 text-[12.5px] font-medium text-accent"
          >
            <UserAvatar :name="user.name" :src="user.avatarUrl" size="xs" />
            {{ user.name }}
            <button type="button" class="rounded-full p-0.5 hover:bg-accent/15" :aria-label="`Quitar a ${user.name}`" @click="remove(user.id)">
              <X class="size-3" />
            </button>
          </span>
        </div>

        <div class="relative">
          <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <input v-model="search" class="field pl-9" placeholder="Buscar por nombre o correo…" />
        </div>

        <div class="mt-2 max-h-52 overflow-y-auto rounded-xl border border-hairline">
          <div v-if="loadingUsers" class="grid place-items-center py-8">
            <Loader2 class="size-5 animate-spin text-ink-subtle" />
          </div>
          <p v-else-if="available.length === 0" class="px-3 py-6 text-center text-[13.5px] text-ink-muted">
            No hay usuarios que coincidan.
          </p>
          <label
            v-for="user in available"
            :key="user.id"
            class="flex cursor-pointer items-center gap-2.5 border-b border-hairline px-3 py-2 last:border-b-0 hover:bg-surface-hover"
          >
            <input
              type="checkbox"
              class="size-4 accent-[var(--color-accent)]"
              :checked="selected.includes(user.id)"
              @change="toggle(user.id)"
            />
            <UserAvatar :name="user.name" :src="user.avatarUrl" size="sm" />
            <span class="min-w-0 flex-1">
              <span class="block truncate text-[13.5px] font-medium text-ink">{{ user.name }}</span>
              <span v-if="user.email" class="block truncate text-[12.5px] text-ink-subtle">{{ user.email }}</span>
            </span>
            <span v-if="user.role === 'admin'" class="chip">Jefe</span>
          </label>
        </div>
        <p class="mt-1.5 flex items-center gap-1 text-[12.5px] text-ink-subtle">
          <Users class="size-3" />
          Los destinatarios podrán leerlo, pero no editarlo.
        </p>
      </div>

      <label
        v-if="isApprove"
        class="flex cursor-pointer items-start gap-2.5 rounded-xl border border-hairline bg-surface-muted/50 px-3 py-2.5 text-description leading-snug"
      >
        <input
          v-model="allowSenderExport"
          type="checkbox"
          class="mt-0.5 size-4 shrink-0 accent-accent"
        />
        <span>
          <span class="block font-medium text-ink">Permitir que el asistente imprima o exporte el documento</span>
          Si lo desactivas, solo el administrador podrá exportarlo en PDF, Word o HTML.
        </span>
      </label>

      <div v-if="!isApprove || editing">
        <label class="label" for="inbox-subject">Asunto</label>
        <input id="inbox-subject" v-model="subject" class="field" maxlength="240" placeholder="Asunto del envío" />
      </div>

      <div v-if="!isApprove || editing">
        <label class="label" for="inbox-body">Mensaje</label>
        <textarea
          id="inbox-body"
          v-model="body"
          class="field min-h-[110px] resize-y"
          maxlength="5000"
          placeholder="Escribe una nota para los destinatarios (opcional)…"
        />
      </div>
    </div>

    <template #footer>
      <button type="button" class="btn btn-outline" :disabled="submitting" @click="emit('close')">Cancelar</button>
      <button type="button" class="btn btn-primary" :disabled="!canSubmit" @click="submit">
        <component :is="submitting ? Loader2 : Send" :class="['size-4', submitting ? 'animate-spin' : '']" />
        {{ submitting ? 'Enviando…' : isApprove ? 'Aprobar y enviar' : auth.isAdmin ? 'Enviar' : 'Enviar a aprobación' }}
      </button>
    </template>
  </BaseModal>
</template>
