<script setup lang="ts">
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  FileCode2,
  FileText,
  Loader2,
  Lock,
  Pencil,
  Send,
  ShieldCheck,
  TriangleAlert,
  X,
  XCircle,
} from 'lucide-vue-next';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { api, downloadFile } from '@/api/client';
import DocumentViewer from '@/components/documents/DocumentViewer.vue';
import RejectDocumentDialog from '@/components/inbox/RejectDocumentDialog.vue';
import SendDocumentDialog from '@/components/inbox/SendDocumentDialog.vue';
import InboxStatusChip from '@/components/inbox/InboxStatusChip.vue';
import AppShell from '@/components/layout/AppShell.vue';
import BaseDropdown from '@/components/ui/BaseDropdown.vue';
import BaseSpinner from '@/components/ui/BaseSpinner.vue';
import UserAvatar from '@/components/ui/UserAvatar.vue';
import { useInboxBadge } from '@/composables/useInboxBadge';
import { useToast } from '@/composables/useToast';
import { errorMessage as explainError } from '@/lib/error-message';
import {
  formatDateTime,
  type InboxStatusContext,
} from '@/lib/labels';
import { normalizeRouteId } from '@/lib/routes';
import { useAuthStore } from '@/stores/auth';
import type { InboxMessageDetail, InboxMessageSummary, ListResponse } from '@/types';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const auth = useAuthStore();
const { refresh: refreshInbox } = useInboxBadge();

const message = ref<InboxMessageDetail | null>(null);
const loading = ref(true);
const errorMessage = ref('');
const cancelling = ref(false);
const sendOpen = ref(false);
const rejectOpen = ref(false);
const viewerExpanded = ref(false);
const detailsOpen = ref(true);
const noteExpanded = ref(false);
const pendingQueue = ref<InboxMessageSummary[]>([]);

const messageId = computed(() => normalizeRouteId(route.params.id));

const locked = computed(() => Boolean(message.value?.document.lockedAt) || message.value?.document.status === 'sent');
const canExport = computed(() => message.value?.canExport ?? false);
const canApprove = computed(() => Boolean(message.value?.canApprove && message.value.status === 'pending_approval'));
const canCancel = computed(
  () =>
    message.value?.status === 'pending_approval' &&
    Boolean(message.value.isSender) &&
    !locked.value,
);
const recipientNames = computed(() => message.value?.recipients.map((recipient) => recipient.name).join(', ') ?? '');
const recipientCount = computed(() => message.value?.recipients.length ?? 0);
const pendingPosition = computed(() => {
  const id = message.value?.id;
  if (!id) return -1;
  return pendingQueue.value.findIndex((item) => item.id === id);
});
const prevPending = computed(() => {
  const total = pendingQueue.value.length;
  if (total === 0) return null;
  const position = pendingPosition.value;
  if (position === -1) return pendingQueue.value[total - 1] ?? null;
  return pendingQueue.value[position - 1] ?? pendingQueue.value[total - 1] ?? null;
});
const nextPending = computed(() => {
  const total = pendingQueue.value.length;
  if (total === 0) return null;
  const position = pendingPosition.value;
  if (position === -1) return pendingQueue.value[0] ?? null;
  return pendingQueue.value[position + 1] ?? pendingQueue.value[0] ?? null;
});
const queueLabel = computed(() => {
  const total = pendingQueue.value.length;
  if (total === 0) return '';
  if (pendingPosition.value === -1) {
    return `${total} pendiente${total === 1 ? '' : 's'}`;
  }
  return `${pendingPosition.value + 1} de ${total}`;
});
const showQueue = computed(() => canApprove.value && pendingQueue.value.length > 1);
const versionChanged = computed(
  () => Boolean(message.value && message.value.documentVersion !== message.value.document.version),
);
const showDecisionBlock = computed(() => {
  if (!message.value) return false;
  if (canApprove.value) return true;
  if (message.value.status === 'rejected') return true;
  if (message.value.status === 'pending_approval' && message.value.isSender) return true;
  if (message.value.status === 'sent' && (message.value.isSender || auth.isAdmin)) return true;
  return false;
});

const chipContext = computed<InboxStatusContext>(() => {
  if (!message.value) return 'result';
  if (message.value.status === 'pending_approval') {
    return message.value.canApprove ? 'pending-approver' : 'pending-owner';
  }
  if (message.value.status === 'sent' && message.value.isRecipient && !message.value.isSender) {
    return 'recipient';
  }
  return 'result';
});

async function load(): Promise<void> {
  const id = messageId.value;
  if (!id) {
    void router.replace({ name: 'inbox' });
    return;
  }

  loading.value = true;
  errorMessage.value = '';
  try {
    const data = await api.get<InboxMessageDetail>(`/inbox/${id}`);
    message.value = data;

    if (data.isRecipient && data.status === 'sent' && !data.readAt) {
      await api.patch(`/inbox/${id}`, { read: true });
      data.readAt = new Date().toISOString();
      data.unread = false;
      await refreshInbox();
    }

    if (
      data.isSender &&
      data.unread &&
      (data.status === 'sent' || data.status === 'rejected')
    ) {
      await api.patch(`/inbox/${id}`, { resultRead: true });
      data.senderReadAt = new Date().toISOString();
      data.unread = false;
      await refreshInbox();
    }

    if (auth.isAdmin) await loadPendingQueue();
  } catch (error) {
    errorMessage.value = explainError(error, 'No se pudo cargar el mensaje');
  } finally {
    loading.value = false;
  }
}

/** Cola de solicitudes pendientes para navegar sin volver a la bandeja. */
async function loadPendingQueue(): Promise<void> {
  if (!auth.isAdmin) {
    pendingQueue.value = [];
    return;
  }
  try {
    const data = await api.get<ListResponse<InboxMessageSummary>>('/inbox', {
      scope: 'received',
      filter: 'pending',
      pageSize: 50,
    });
    pendingQueue.value = data.items;
  } catch {
    pendingQueue.value = [];
  }
}

function openMessage(id: string): void {
  viewerExpanded.value = false;
  void router.push({ name: 'inbox-message', params: { id } });
}

function openPrevPending(): void {
  if (prevPending.value) openMessage(prevPending.value.id);
}

function openNextPending(): void {
  if (nextPending.value) openMessage(nextPending.value.id);
}

function openDocument(): void {
  if (!message.value) return;
  viewerExpanded.value = false;
  void router.push({
    name: 'document',
    params: { id: message.value.document.id },
    query: { from: 'inbox', message: message.value.id },
  });
}

async function exportDocument(format: 'pdf' | 'docx' | 'html'): Promise<void> {
  if (!message.value || !canExport.value) return;
  try {
    await downloadFile(`/documents/${message.value.document.id}/export/${format}`);
    toast.success(`Archivo ${format.toUpperCase()} descargado`);
  } catch (error) {
    toast.failure(error, 'No se pudo exportar el documento');
  }
}

async function cancelSend(): Promise<void> {
  if (!message.value || cancelling.value) return;
  cancelling.value = true;
  try {
    await api.post(`/inbox/${message.value.id}/cancel`);
    await refreshInbox();
    toast.success('Solicitud de envío cancelada');
    await load();
  } catch (error) {
    toast.failure(error, 'No se pudo cancelar el envío');
  } finally {
    cancelling.value = false;
  }
}

function openApprove(): void {
  viewerExpanded.value = false;
  sendOpen.value = true;
}

function openReject(): void {
  viewerExpanded.value = false;
  rejectOpen.value = true;
}

async function onRejected(): Promise<void> {
  rejectOpen.value = false;
  await load();
}

async function onSent(): Promise<void> {
  sendOpen.value = false;
  await load();
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (isTypingTarget(event.target)) return;

  if (event.key === 'Escape' && viewerExpanded.value) {
    viewerExpanded.value = false;
    return;
  }

  if (!canApprove.value || sendOpen.value || rejectOpen.value) return;

  if (event.key === 'a' || event.key === 'A') {
    event.preventDefault();
    openApprove();
  } else if (event.key === 'r' || event.key === 'R') {
    event.preventDefault();
    openReject();
  } else if (event.key === 'e' || event.key === 'E') {
    event.preventDefault();
    openDocument();
  } else if (event.key === 'n' || event.key === 'N') {
    const next = nextPending.value;
    if (next) {
      event.preventDefault();
      openMessage(next.id);
    }
  }
}

watch(messageId, () => {
  sendOpen.value = false;
  rejectOpen.value = false;
  viewerExpanded.value = false;
  void load();
});
onMounted(() => {
  window.addEventListener('keydown', onKeydown);
  void load();
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown));
</script>

<template>
  <AppShell>
    <div class="mx-auto max-w-[1280px] px-5 pb-6 pt-5 sm:px-8 lg:flex lg:h-full lg:min-h-0 lg:flex-col">
      <RouterLink
        :to="{ name: 'inbox' }"
        class="btn btn-ghost btn-sm mb-4 -ml-2 shrink-0 self-start"
      >
        <ArrowLeft class="size-4" />
        Bandeja
      </RouterLink>

      <div v-if="loading" class="grid place-items-center py-24">
        <BaseSpinner label="Cargando mensaje…" />
      </div>

      <div v-else-if="errorMessage" class="card px-6 py-10 text-center">
        <XCircle class="mx-auto size-8 text-danger" />
        <p class="mt-3 text-[14px] font-medium text-ink">{{ errorMessage }}</p>
        <button type="button" class="btn btn-outline mt-4" @click="load">Reintentar</button>
      </div>

      <template v-else-if="message">
        <!-- Resumen del mensaje -->
        <header class="card shrink-0 px-5 py-3.5 sm:px-6">
          <div class="flex flex-wrap items-center gap-2">
            <InboxStatusChip :status="message.status" :context="chipContext" size="md" />
            <span
              v-if="locked"
              class="inline-flex items-center gap-1 rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-ink-subtle"
            >
              <Lock class="size-3" />
              Solo lectura
            </span>
          </div>

          <h1 class="mt-2 text-[20px] font-semibold leading-tight tracking-tight text-ink">
            {{ message.subject }}
          </h1>

          <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-muted">
            <UserAvatar :name="message.senderName" :src="message.senderAvatarUrl" size="xs" />
            <span>De <strong class="font-medium text-ink">{{ message.senderName }}</strong></span>
            <span aria-hidden="true">·</span>
            <span>{{ formatDateTime(message.sentAt ?? message.createdAt) }}</span>
            <span aria-hidden="true">·</span>
            <span>v{{ message.documentVersion }}</span>
            <span aria-hidden="true">·</span>
            <span :title="recipientNames">{{ recipientCount }} destinatario{{ recipientCount === 1 ? '' : 's' }}</span>
          </div>

          <div
            v-if="!canApprove && message.body"
            class="mt-2 border-t border-hairline pt-2 text-[12px] text-ink-muted"
          >
            <p :class="['whitespace-pre-wrap', noteExpanded ? '' : 'line-clamp-2']">
              {{ message.body }}
            </p>
            <button
              v-if="message.body.length > 110"
              type="button"
              class="mt-1 text-[11px] font-medium text-accent hover:underline"
              @click="noteExpanded = !noteExpanded"
            >
              {{ noteExpanded ? 'Ver menos' : 'Ver más' }}
            </button>
          </div>
        </header>

        <!-- Documento + ficha/decisión -->
        <section
          class="mt-3 grid gap-4 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_300px] lg:grid-rows-[minmax(0,1fr)]"
        >
          <!-- El documento, un solo bloque -->
          <div class="min-w-0 lg:h-full">
            <DocumentViewer
              :document-id="message.document.id"
              :version="message.document.version"
              :updated-at="message.document.updatedAt"
              :design-updated-at="message.document.designUpdatedAt"
              :tokens="message.document.designTokens"
              :title="message.document.title"
              expandable
              fill
              @expand="viewerExpanded = true"
            />
          </div>

          <aside class="flex min-w-0 flex-col gap-2.5 lg:min-h-0 lg:overflow-y-auto">
            <!-- Decisión: primero en móvil -->
            <section v-if="showDecisionBlock" class="card p-4">
              <!-- Aprobador -->
              <template v-if="canApprove">
                <p class="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
                  <ShieldCheck class="size-3.5 text-warning" />
                  Tu decisión
                </p>

                <div v-if="message.body" class="mt-2.5">
                  <p class="flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wide text-ink-subtle">
                    <Send class="size-3" />
                    Nota del remitente
                  </p>
                  <p
                    :class="[
                      'mt-1 whitespace-pre-wrap text-[12px] leading-snug text-ink-muted',
                      noteExpanded ? '' : 'line-clamp-2',
                    ]"
                  >
                    {{ message.body }}
                  </p>
                  <button
                    v-if="message.body.length > 110"
                    type="button"
                    class="mt-1 text-[11px] font-medium text-accent hover:underline"
                    @click="noteExpanded = !noteExpanded"
                  >
                    {{ noteExpanded ? 'Ver menos' : 'Ver más' }}
                  </button>
                </div>

                <div
                  v-if="versionChanged"
                  class="mt-2 rounded-lg border border-danger/20 bg-danger-soft/50 px-2.5 py-1.5 text-[11.5px] text-danger"
                >
                  <p class="flex items-start gap-1.5">
                    <TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
                    <span>
                      Cambió desde el envío (v{{ message.documentVersion }} → v{{ message.document.version }}).
                    </span>
                  </p>
                </div>

                <div class="mt-3 space-y-2">
                  <button type="button" class="btn btn-primary btn-sm w-full" @click="openApprove">
                    <CheckCircle2 class="size-4" />
                    Aprobar y enviar
                  </button>
                  <button type="button" class="btn btn-outline btn-sm w-full" @click="openReject">
                    <XCircle class="size-4" />
                    Devolver
                  </button>
                </div>

                <div
                  v-if="showQueue"
                  class="mt-3 flex items-center justify-between gap-2 rounded-lg border border-hairline px-2 py-1 text-[11px] text-ink-muted"
                >
                  <button
                    type="button"
                    class="grid size-6 place-items-center rounded transition-colors hover:bg-surface-hover"
                    aria-label="Solicitud pendiente anterior"
                    @click="openPrevPending"
                  >
                    <ChevronLeft class="size-3.5" />
                  </button>
                  <span class="font-medium">{{ queueLabel }}</span>
                  <button
                    type="button"
                    class="grid size-6 place-items-center rounded transition-colors hover:bg-surface-hover"
                    aria-label="Solicitud pendiente siguiente"
                    @click="openNextPending"
                  >
                    <ChevronRight class="size-3.5" />
                  </button>
                </div>

                <div class="mt-3 flex items-center justify-between gap-2 text-[11px]">
                  <button
                    type="button"
                    class="font-medium text-accent hover:underline"
                    @click="openDocument"
                  >
                    Prefiero corregirlo yo →
                  </button>
                  <span
                    class="grid size-5 cursor-help place-items-center rounded-full border border-hairline text-[10px] font-semibold text-ink-subtle"
                    title="Atajos: A aprobar · R devolver · E editar · N siguiente"
                  >?</span>
                </div>
              </template>

              <!-- Remitente con rechazo -->
              <template v-else-if="message.status === 'rejected'">
                <p class="text-[11px] font-medium uppercase tracking-wide text-danger">
                  Devuelto para corrección
                </p>
                <p class="mt-1 text-[11.5px] text-ink-muted">
                  <template v-if="message.approvedByName">por {{ message.approvedByName }}</template>
                  <template v-if="message.approvedAt"> · {{ formatDateTime(message.approvedAt) }}</template>
                </p>
                <p
                  v-if="message.rejectedReason"
                  class="mt-2 whitespace-pre-wrap rounded-lg border border-danger/20 bg-danger-soft/50 px-2.5 py-2 text-[12px] text-ink"
                >
                  {{ message.rejectedReason }}
                </p>
                <p
                  v-if="!message.allowSenderEdit"
                  class="mt-2 text-[11.5px] leading-snug text-ink-muted"
                >
                  El documento quedó cerrado y no se puede editar.
                </p>
                <button
                  v-if="message.isSender && message.allowSenderEdit"
                  type="button"
                  class="btn btn-primary mt-3 w-full"
                  @click="openDocument"
                >
                  <Pencil class="size-4" />
                  Corregir y reenviar
                </button>
                <button
                  v-if="auth.isAdmin && nextPending"
                  type="button"
                  class="btn btn-outline mt-2 w-full"
                  @click="openNextPending"
                >
                  Siguiente pendiente
                  <ChevronRight class="size-3.5" />
                </button>
              </template>

              <!-- Remitente esperando aprobación -->
              <template v-else-if="message.status === 'pending_approval' && message.isSender">
                <p class="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
                  Esperando aprobación
                </p>
                <p class="mt-1 text-[12px] leading-snug text-ink-muted">
                  El jefe recibió la solicitud. Puedes cancelarla mientras siga pendiente.
                </p>
                <button
                  v-if="canCancel"
                  type="button"
                  class="btn btn-outline mt-3 w-full"
                  :disabled="cancelling"
                  @click="cancelSend"
                >
                  <component
                    :is="cancelling ? Loader2 : XCircle"
                    :class="['size-4', cancelling ? 'animate-spin' : '']"
                  />
                  Cancelar envío
                </button>
              </template>

              <!-- Resultado de un envío -->
              <template v-else-if="message.status === 'sent'">
                <p class="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-success">
                  <CheckCircle2 class="size-3.5" />
                  {{ message.isRecipient && !message.isSender ? 'Recibido' : 'Aprobado y enviado' }}
                </p>
                <p class="mt-1 text-[11.5px] leading-snug text-ink-muted">
                  <template v-if="message.isRecipient && !message.isSender">
                    El documento quedó bloqueado como solo lectura.
                  </template>
                  <template v-else>
                    <template v-if="message.approvedByName">Por {{ message.approvedByName }}</template>
                    <template v-if="message.approvedAt"> · {{ formatDateTime(message.approvedAt) }}</template>.
                    Quedó bloqueado como solo lectura.
                  </template>
                </p>
                <button
                  v-if="auth.isAdmin && nextPending"
                  type="button"
                  class="btn btn-outline mt-3 w-full"
                  @click="openNextPending"
                >
                  Siguiente pendiente
                  <ChevronRight class="size-3.5" />
                </button>
              </template>
            </section>

            <!-- Ficha: primero en escritorio -->
            <section class="card p-4">
              <button
                type="button"
                class="flex w-full items-center justify-between gap-2 text-left"
                @click="detailsOpen = !detailsOpen"
              >
                <span class="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">Detalles</span>
                <ChevronDown
                  :class="['size-3.5 text-ink-subtle transition-transform', detailsOpen ? 'rotate-180' : '']"
                />
              </button>

              <dl
                v-if="detailsOpen"
                class="mt-2.5 grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1.5 text-[12px]"
              >
                <dt class="text-ink-subtle">Asunto del envío</dt>
                <dd class="min-w-0 font-medium text-ink">{{ message.subject }}</dd>

                <dt class="text-ink-subtle">Documento</dt>
                <dd class="min-w-0 font-medium text-ink">{{ message.document.title }}</dd>

                <template v-if="message.document.docNumber">
                  <dt class="text-ink-subtle">Número</dt>
                  <dd class="min-w-0 font-medium text-ink">{{ message.document.docNumber }}</dd>
                </template>
                <template v-else-if="message.document.numberingPreview">
                  <dt class="text-ink-subtle">Número</dt>
                  <dd class="min-w-0">
                    <span
                      class="chip"
                      title="Se asigna al aprobar y enviar. Puede cambiar si otro documento de esta plantilla se aprueba antes."
                    >
                      Se asignará {{ message.document.numberingPreview.number }}
                    </span>
                  </dd>
                </template>

                <template v-if="locked">
                  <dt class="text-ink-subtle">Exportación</dt>
                  <dd class="min-w-0 font-medium text-ink">
                    {{ message.allowSenderExport ? 'Administrador y asistente' : 'Solo administrador' }}
                  </dd>
                </template>

                <dt class="col-span-2 mt-1 text-ink-subtle">Destinatarios</dt>
                <dd class="col-span-2 mt-0 space-y-1.5">
                  <div v-for="recipient in message.recipients" :key="recipient.userId" class="flex items-center gap-2">
                    <UserAvatar :name="recipient.name" size="xs" />
                    <span class="min-w-0 flex-1 truncate text-ink">{{ recipient.name }}</span>
                    <span v-if="recipient.readAt" class="text-[10.5px] text-success">Leído</span>
                    <span v-else-if="message.status === 'sent'" class="text-[10.5px] text-ink-subtle">Sin leer</span>
                  </div>
                </dd>
              </dl>

              <BaseDropdown v-if="canExport" class="mt-2 w-full" align="right" width="w-full">
                <template #trigger>
                  <button type="button" class="btn btn-ghost btn-sm w-full text-ink-muted">
                    <span class="flex w-full items-center justify-between">
                      <span class="flex items-center gap-2">
                        <Download class="size-3.5" />
                        Exportar
                      </span>
                      <ChevronDown class="size-3" />
                    </span>
                  </button>
                </template>
                <template #content>
                  <button type="button" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink" @click="exportDocument('pdf')">
                    <FileText class="size-4" />
                    PDF
                  </button>
                  <button type="button" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink" @click="exportDocument('docx')">
                    <FileText class="size-4" />
                    Word (.docx)
                  </button>
                  <button type="button" class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink" @click="exportDocument('html')">
                    <FileCode2 class="size-4" />
                    HTML
                  </button>
                </template>
              </BaseDropdown>
              <p v-else-if="locked" class="mt-3 rounded-lg bg-surface-muted px-3 py-2 text-[11px] leading-snug text-ink-subtle">
                Solo el administrador puede exportar este documento sellado.
              </p>
            </section>
          </aside>
        </section>
      </template>
    </div>

    <!-- Vista final a pantalla completa -->
    <Teleport to="body">
      <div
        v-if="viewerExpanded && message"
        class="fixed inset-0 z-[125] flex flex-col bg-[#0b1220]/70 p-2 sm:p-4"
        @mousedown.self="viewerExpanded = false"
      >
        <div class="card flex min-h-0 flex-1 flex-col overflow-hidden">
          <div class="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-2.5">
            <FileText class="size-4 shrink-0 text-accent" />
            <div class="min-w-0">
              <p class="truncate text-[13px] font-semibold text-ink">{{ message.document.title }}</p>
              <p class="truncate text-[11px] text-ink-subtle">
                {{ message.subject }} · v{{ message.documentVersion }}
              </p>
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-sm ml-auto"
              @click="viewerExpanded = false"
            >
              <X class="size-4" />
              Cerrar
            </button>
          </div>

          <div class="min-h-0 flex-1 overflow-hidden p-3">
            <DocumentViewer
              :document-id="message.document.id"
              :version="message.document.version"
              :updated-at="message.document.updatedAt"
              :design-updated-at="message.document.designUpdatedAt"
              :tokens="message.document.designTokens"
              :title="message.document.title"
              max-height-class="max-h-[calc(100vh_-_190px)]"
            />
          </div>

          <div class="flex flex-wrap items-center gap-2 border-t border-hairline bg-surface px-4 py-2.5">
            <span
              :class="[
                'mr-auto flex items-center gap-1.5 text-[11.5px]',
                versionChanged ? 'font-medium text-danger' : 'text-ink-subtle',
              ]"
            >
              <TriangleAlert v-if="versionChanged" class="size-3.5 shrink-0" />
              <template v-if="versionChanged">
                El documento cambió desde el envío (v{{ message.documentVersion }} → v{{ message.document.version }}). Revísalo antes de aprobar.
              </template>
              <template v-else>
                {{ canApprove ? 'Revisa y decide sin salir de la vista.' : 'Vista final del documento.' }}
              </template>
            </span>
            <template v-if="canApprove">
              <button type="button" class="btn btn-outline btn-sm" @click="openReject">
                <XCircle class="size-4" />
                Devolver
              </button>
              <button type="button" class="btn btn-primary btn-sm" @click="openApprove">
                <CheckCircle2 class="size-4" />
                Aprobar y enviar
              </button>
            </template>
            <button v-else type="button" class="btn btn-outline btn-sm" @click="viewerExpanded = false">
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </Teleport>

    <RejectDocumentDialog
      v-if="message"
      :open="rejectOpen"
      :message-id="message.id"
      @close="rejectOpen = false"
      @rejected="onRejected"
    />

    <SendDocumentDialog
      v-if="message"
      :open="sendOpen"
      mode="approve"
      :message-id="message.id"
      :document-id="message.document.id"
      :document-title="message.document.title"
      :expected-version="message.document.version"
      :sent-version="message.documentVersion"
      :initial-subject="message.subject"
      :initial-body="message.body"
      :initial-recipient-ids="message.recipients.map((recipient) => recipient.userId)"
      @close="sendOpen = false"
      @sent="onSent"
    />
  </AppShell>
</template>
