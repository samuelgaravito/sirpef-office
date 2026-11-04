<script setup lang="ts">
import {
  ChevronRight,
  Clock,
  Inbox,
  MailOpen,
  Search,
  Send,
} from 'lucide-vue-next';
import { computed, onMounted, ref, watch, type Component } from 'vue';
import { useRouter } from 'vue-router';

import AppShell from '@/components/layout/AppShell.vue';
import InboxStatusChip from '@/components/inbox/InboxStatusChip.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import BaseSpinner from '@/components/ui/BaseSpinner.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import UserAvatar from '@/components/ui/UserAvatar.vue';
import { api } from '@/api/client';
import { useInboxBadge } from '@/composables/useInboxBadge';
import { useToast } from '@/composables/useToast';
import { relativeTime, type InboxStatusContext } from '@/lib/labels';
import { useAuthStore } from '@/stores/auth';
import type { InboxMessageStatus, InboxMessageSummary, ListResponse } from '@/types';

type Scope = 'received' | 'sent';
type StatusFilter = 'all' | InboxMessageStatus;

interface MessageGroup {
  title: string;
  tone: 'warning' | 'default';
  items: InboxMessageSummary[];
}

const auth = useAuthStore();
const router = useRouter();
const toast = useToast();
const { pendingCount, sections, refresh: refreshInbox } = useInboxBadge();

const messages = ref<InboxMessageSummary[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = 20;
const loading = ref(true);
const search = ref('');
const scope = ref<Scope>('received');
const statusFilter = ref<StatusFilter>('all');

let searchTimer: number | undefined;

const tabs: { value: Scope; label: string; icon: Component }[] = [
  { value: 'received', label: 'Recibidos', icon: Inbox },
  { value: 'sent', label: 'Enviados', icon: Send },
];

const statusOptions: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'pending_approval', label: 'Pendientes' },
  { value: 'sent', label: 'Aprobados' },
  { value: 'rejected', label: 'Rechazados' },
  { value: 'cancelled', label: 'Anulados' },
];

function statusFilterLabel(value: StatusFilter): string {
  return statusOptions.find((option) => option.value === value)?.label ?? 'Todos los estados';
}

/** Contador de novedades por pestaña. */
function tabCount(value: Scope): number {
  return value === 'received' ? sections.value.received : sections.value.sent;
}

const tabBadgeClass: Record<Scope, string> = {
  received: 'bg-accent text-accent-ink',
  sent: 'bg-success text-white',
};

/** Qué contexto tiene el usuario sobre cada mensaje del listado. */
function chipContext(message: InboxMessageSummary): InboxStatusContext {
  if (message.status === 'pending_approval') {
    return scope.value === 'received' && auth.isAdmin
      ? 'pending-approver'
      : 'pending-owner';
  }
  if (message.status === 'sent') {
    return scope.value === 'received' ? 'recipient' : 'result';
  }
  return 'result';
}

/** Barra lateral: ámbar si requiere aprobación, azul si es nuevo. */
function rowAccent(message: InboxMessageSummary): string {
  if (message.status === 'pending_approval') {
    return '!border-l-warning bg-warning-soft/20';
  }
  if (message.unread) {
    return '!border-l-accent bg-accent-soft/15';
  }
  return 'border-l-transparent';
}

/**
 * En Recibidos los pendientes se separan en un bloque destacado arriba;
 * el resto se muestra debajo sin necesidad de filtros.
 */
const messageGroups = computed<MessageGroup[]>(() => {
  if (scope.value !== 'received') {
    return [{ title: '', tone: 'default', items: messages.value }];
  }

  const pending = messages.value.filter((message) => message.status === 'pending_approval');
  const rest = messages.value.filter((message) => message.status !== 'pending_approval');
  const groups: MessageGroup[] = [];

  if (pending.length > 0) {
    groups.push({ title: 'Requiere tu aprobación', tone: 'warning', items: pending });
  }
  if (rest.length > 0 || pending.length === 0) {
    groups.push({
      title: pending.length > 0 ? 'Recibidos' : '',
      tone: 'default',
      items: rest,
    });
  }

  return groups;
});

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / pageSize)));

const subtitle = computed(() => {
  if (scope.value === 'sent') {
    if (statusFilter.value !== 'all') {
      return `${total.value} ${statusFilterLabel(statusFilter.value).toLowerCase()}`;
    }
    if (auth.isAdmin) {
      return `${total.value} documento${total.value === 1 ? '' : 's'} en tu seguimiento`;
    }
    return `${total.value} envío${total.value === 1 ? '' : 's'} realizad${total.value === 1 ? 'o' : 'os'}`;
  }
  const base = `${total.value} mensaje${total.value === 1 ? '' : 's'} en tu bandeja`;
  return pendingCount.value > 0
    ? `${base} · ${pendingCount.value} por aprobar`
    : base;
});

const emptyTitle = computed(() => {
  if (search.value.trim()) return 'Sin resultados';
  if (scope.value === 'sent') {
    if (statusFilter.value !== 'all') return 'Sin envíos en este estado';
    return auth.isAdmin ? 'Sin documentos en tu seguimiento' : 'Aún no has enviado documentos';
  }
  return 'Tu bandeja está vacía';
});

const emptyDescription = computed(() => {
  if (search.value.trim()) return 'Prueba con otro asunto, mensaje o documento.';
  if (scope.value === 'sent') {
    if (statusFilter.value !== 'all') {
      return `No hay envíos ${statusFilterLabel(statusFilter.value).toLowerCase()}. Cambia el estado o envía un documento.`;
    }
    return auth.isAdmin
      ? 'Aquí aparecerán tus envíos y los memos que apruebes o rechaces.'
      : 'Abre un documento y pulsa «Enviar» para compartirlo con otros usuarios.';
  }
  return 'Los documentos que te envíen aparecerán aquí.';
});

function rowContext(message: InboxMessageSummary): string {
  const recipients = `Para ${message.recipientCount} destinatario${message.recipientCount === 1 ? '' : 's'}`;
  if (scope.value === 'sent') {
    return message.senderId === auth.user?.id
      ? recipients
      : `Enviado por ${message.senderName}`;
  }
  return `De ${message.senderName}`;
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await api.get<ListResponse<InboxMessageSummary>>('/inbox', {
      scope: scope.value,
      status: scope.value === 'sent' ? statusFilter.value : undefined,
      q: search.value.trim() || undefined,
      page: page.value,
      pageSize,
    });
    messages.value = data.items;
    total.value = data.total ?? data.items.length;
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo cargar la bandeja');
  } finally {
    loading.value = false;
  }
}

function openMessage(id: string): void {
  void router.push({ name: 'inbox-message', params: { id } });
}

watch(scope, () => {
  statusFilter.value = 'all';
  page.value = 1;
  void load();
});

watch(statusFilter, () => {
  page.value = 1;
  void load();
});

watch(page, () => void load());

watch(search, () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => {
    page.value = 1;
    void load();
  }, 300);
});

onMounted(() => {
  void refreshInbox();
  void load();
});
</script>

<template>
  <AppShell>
    <PageHeader title="Bandeja" :subtitle="subtitle" />

    <div class="mx-auto max-w-[1100px] px-5 pb-14 pt-2 sm:px-8">
      <div class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div class="flex flex-wrap items-center gap-1 rounded-lg border border-hairline bg-surface p-1">
          <button
            v-for="tab in tabs"
            :key="tab.value"
            type="button"
            :class="[
              'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors',
              scope === tab.value ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:bg-surface-hover',
            ]"
            @click="scope = tab.value"
          >
            <component :is="tab.icon" class="size-3.5" />
            {{ tab.label }}
            <span
              v-if="tabCount(tab.value) > 0"
              :class="[
                'grid min-w-[18px] place-items-center rounded-full px-1 py-0.5 text-[10px] font-bold leading-none',
                tabBadgeClass[tab.value],
              ]"
            >
              {{ tabCount(tab.value) > 99 ? '99+' : tabCount(tab.value) }}
            </span>
          </button>
        </div>

        <div class="relative flex-1">
          <Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <input v-model="search" class="field pl-9" placeholder="Buscar por asunto, mensaje o documento…" />
        </div>

        <select
          v-if="scope === 'sent'"
          v-model="statusFilter"
          class="field w-full cursor-pointer sm:w-auto sm:min-w-[170px]"
          aria-label="Filtrar envíos por estado"
        >
          <option v-for="option in statusOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </div>

      <div v-if="loading" class="grid place-items-center py-20">
        <BaseSpinner label="Cargando bandeja…" />
      </div>

      <EmptyState v-else-if="messages.length === 0" :icon="MailOpen" :title="emptyTitle" :description="emptyDescription" />

      <div v-else class="space-y-4">
        <section
          v-for="(group, index) in messageGroups"
          :key="index"
          :class="[
            'overflow-hidden rounded-xl border',
            group.tone === 'warning'
              ? 'border-warning/25 bg-warning-soft/20'
              : 'border-hairline bg-surface',
          ]"
        >
          <header
            v-if="group.title"
            :class="[
              'flex flex-wrap items-center gap-2 border-b px-4 py-2.5',
              group.tone === 'warning' ? 'border-warning/20' : 'border-hairline',
            ]"
          >
            <component
              :is="group.tone === 'warning' ? Clock : Inbox"
              :class="['size-4', group.tone === 'warning' ? 'text-warning' : 'text-ink-subtle']"
            />
            <span
              :class="[
                'text-[12.5px] font-semibold',
                group.tone === 'warning' ? 'text-warning' : 'text-ink-muted',
              ]"
            >
              {{ group.title }}
            </span>
            <span
              v-if="group.tone === 'warning'"
              class="grid min-w-5 place-items-center rounded-full bg-warning px-1.5 py-0.5 text-[10px] font-bold leading-none text-white"
            >
              {{ group.items.length }}
            </span>
            <span
              v-if="group.tone === 'warning'"
              class="ml-auto text-[11.5px] text-ink-muted"
            >
              Revisa y aprueba o rechaza
            </span>
          </header>

          <button
            v-for="message in group.items"
            :key="message.id"
            type="button"
          :class="[
            'flex w-full items-start gap-3 border-b border-l-2 border-hairline px-4 py-3.5 text-left transition-colors last:border-b-0 hover:bg-surface-hover',
            rowAccent(message),
          ]"
          @click="openMessage(message.id)"
        >
          <span class="relative mt-0.5">
            <UserAvatar :name="message.senderName" :src="message.senderAvatarUrl" size="md" />
            <span
              v-if="message.unread"
              class="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-surface bg-accent"
              aria-label="No leído"
            />
          </span>

          <span class="min-w-0 flex-1">
            <span class="flex flex-wrap items-center gap-2">
              <span :class="['truncate text-[13px]', message.unread ? 'font-semibold text-ink' : 'font-medium text-ink']">
                {{ message.subject }}
              </span>
              <InboxStatusChip :status="message.status" :context="chipContext(message)" />
              <span
                v-if="message.unread && scope !== 'received'"
                class="inline-flex items-center rounded-full bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent"
              >
                Nuevo
              </span>
            </span>
            <span class="mt-0.5 block truncate text-[11.5px] text-ink-muted">
              {{ rowContext(message) }}
              <template v-if="message.documentDocNumber"> · {{ message.documentDocNumber }}</template>
              <template v-else> · {{ message.documentTitle }}</template>
            </span>
            <span class="mt-1 line-clamp-2 block text-[12px] leading-snug text-ink-subtle">
              {{ message.body || message.documentTitle }}
            </span>
          </span>

          <span class="shrink-0 text-right">
            <span class="block text-[11px] text-ink-subtle">{{ relativeTime(message.sentAt ?? message.createdAt) }}</span>
            <span
              v-if="message.status === 'pending_approval'"
              class="mt-1 inline-flex items-center justify-end gap-0.5 text-[11px] font-semibold text-warning"
            >
              {{ chipContext(message) === 'pending-approver' ? 'Revisar' : 'Ver estado' }}
              <ChevronRight class="size-3" />
            </span>
            <span v-else class="mt-1 block text-[11px] text-ink-subtle">
              {{ message.recipientCount }} destinatario{{ message.recipientCount === 1 ? '' : 's' }}
            </span>
          </span>
        </button>
        </section>
      </div>

      <div v-if="totalPages > 1" class="mt-6 flex items-center justify-between">
        <p class="text-[12.5px] text-ink-muted">Página {{ page }} de {{ totalPages }}</p>
        <div class="flex gap-2">
          <button type="button" class="btn btn-outline btn-sm" :disabled="page <= 1" @click="page -= 1">Anterior</button>
          <button type="button" class="btn btn-outline btn-sm" :disabled="page >= totalPages" @click="page += 1">Siguiente</button>
        </div>
      </div>
    </div>
  </AppShell>
</template>
