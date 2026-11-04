<script setup lang="ts">
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  FileCode2,
  FileText,
  Loader2,
  Lock,
  Send,
  ShieldCheck,
  Undo2,
  XCircle,
} from 'lucide-vue-next';
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { api, downloadFile } from '@/api/client';
import DocumentPreview from '@/components/documents/DocumentPreview.vue';
import SendDocumentDialog from '@/components/inbox/SendDocumentDialog.vue';
import InboxStatusChip from '@/components/inbox/InboxStatusChip.vue';
import AppShell from '@/components/layout/AppShell.vue';
import BaseDropdown from '@/components/ui/BaseDropdown.vue';
import BaseModal from '@/components/ui/BaseModal.vue';
import BaseSpinner from '@/components/ui/BaseSpinner.vue';
import UserAvatar from '@/components/ui/UserAvatar.vue';
import { useInboxBadge } from '@/composables/useInboxBadge';
import { useToast } from '@/composables/useToast';
import {
  docTypeLabel,
  formatDateTime,
  STATUS_LABELS,
  type InboxStatusContext,
} from '@/lib/labels';
import { normalizeRouteId } from '@/lib/routes';
import type { InboxMessageDetail } from '@/types';

const route = useRoute();
const router = useRouter();
const toast = useToast();
const { refresh: refreshInbox } = useInboxBadge();

const message = ref<InboxMessageDetail | null>(null);
const loading = ref(true);
const errorMessage = ref('');
const cancelling = ref(false);
const sendOpen = ref(false);
const rejectOpen = ref(false);
const rejectReason = ref('');
const rejectAllowEdit = ref(true);
const rejecting = ref(false);

const messageId = computed(() => normalizeRouteId(route.params.id));

const locked = computed(() => Boolean(message.value?.document.lockedAt) || message.value?.document.status === 'sent');
const canExport = computed(() => message.value?.canExport ?? false);
const canApprove = computed(() => Boolean(message.value?.canApprove && message.value.status === 'pending_approval'));
const canCancel = computed(
  () =>
    message.value?.status === 'pending_approval' &&
    (message.value.isSender || message.value.canApprove) &&
    !locked.value,
);
const recipientNames = computed(() => message.value?.recipients.map((recipient) => recipient.name).join(', ') ?? '');

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
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'No se pudo cargar el mensaje';
  } finally {
    loading.value = false;
  }
}

function openDocument(): void {
  if (!message.value) return;
  void router.push({ name: 'document', params: { id: message.value.document.id } });
}

async function exportDocument(format: 'pdf' | 'docx' | 'html'): Promise<void> {
  if (!message.value || !canExport.value) return;
  try {
    await downloadFile(`/documents/${message.value.document.id}/export/${format}`);
    toast.success(`Archivo ${format.toUpperCase()} descargado`);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo exportar el documento');
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
    toast.error(error instanceof Error ? error.message : 'No se pudo cancelar el envío');
  } finally {
    cancelling.value = false;
  }
}

function openReject(): void {
  rejectAllowEdit.value = true;
  rejectOpen.value = true;
}

async function submitReject(): Promise<void> {
  if (!message.value || rejecting.value || !rejectReason.value.trim()) return;
  rejecting.value = true;
  const allowEdit = rejectAllowEdit.value;
  try {
    await api.post(`/inbox/${message.value.id}/reject`, {
      reason: rejectReason.value.trim(),
      allowEdit,
    });
    await refreshInbox();
    toast.success(
      allowEdit
        ? 'Memo devuelto para corrección; el asistente puede editarlo'
        : 'Envío rechazado y cerrado; el asistente no podrá editarlo',
    );
    rejectOpen.value = false;
    rejectReason.value = '';
    await load();
  } catch (error) {
    toast.error(error instanceof Error ? error.message : 'No se pudo rechazar el envío');
  } finally {
    rejecting.value = false;
  }
}

async function onSent(): Promise<void> {
  sendOpen.value = false;
  await load();
}

watch(messageId, () => void load());
onMounted(load);
</script>

<template>
  <AppShell>
    <div class="mx-auto max-w-[1100px] px-5 pb-16 pt-5 sm:px-8">
      <RouterLink :to="{ name: 'inbox' }" class="btn btn-ghost btn-sm mb-4 -ml-2">
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
        <!-- Cabecera del mensaje -->
        <header class="card overflow-hidden">
          <div class="border-b border-hairline px-5 py-4 sm:px-6">
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <div class="mb-2 flex flex-wrap items-center gap-2">
                  <InboxStatusChip :status="message.status" :context="chipContext" size="md" />
                  <span v-if="locked" class="inline-flex items-center gap-1 rounded-full bg-surface-hover px-2 py-0.5 text-[11px] font-medium text-ink-subtle">
                    <Lock class="size-3" />
                    Solo lectura
                  </span>
                </div>

                <h1 class="text-[20px] font-semibold leading-tight tracking-tight text-ink">{{ message.subject }}</h1>

                <p class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-ink-muted">
                  <UserAvatar :name="message.senderName" :src="message.senderAvatarUrl" size="xs" />
                  <span>De <strong class="font-medium text-ink">{{ message.senderName }}</strong></span>
                  <span aria-hidden="true">·</span>
                  <span>{{ formatDateTime(message.sentAt ?? message.createdAt) }}</span>
                </p>
                <p v-if="message.recipients.length" class="mt-1 text-[12px] text-ink-subtle">
                  Para {{ recipientNames }}
                </p>
              </div>

              
            </div>
          </div>

          <div v-if="message.body" class="whitespace-pre-wrap px-5 py-4 text-[13.5px] leading-relaxed text-ink-muted sm:px-6">
            {{ message.body }}
          </div>

          <div v-if="message.status === 'sent'" class="flex items-center gap-2 border-t border-success/20 bg-success-soft px-5 py-3 text-[12.5px] text-success sm:px-6">
            <CheckCircle2 class="size-4 shrink-0" />
            <span v-if="message.isRecipient && !message.isSender">
              <strong>Documento enviado.</strong> Quedó bloqueado como solo lectura.
            </span>
            <span v-else>
              <strong>Aprobado y enviado</strong>
              <template v-if="message.approvedByName"> por {{ message.approvedByName }}</template>
              <template v-if="message.approvedAt"> el {{ formatDateTime(message.approvedAt) }}</template>.
              El documento quedó bloqueado como solo lectura.
            </span>
          </div>

          <div v-if="message.status === 'rejected'" class="border-t border-danger/20 bg-danger-soft px-5 py-3 text-[12.5px] text-danger sm:px-6">
            <strong>Rechazado</strong>
            <template v-if="message.approvedByName"> por {{ message.approvedByName }}</template>
            <template v-if="message.approvedAt"> el {{ formatDateTime(message.approvedAt) }}</template>.
            <template v-if="message.rejectedReason"> Motivo: {{ message.rejectedReason }}</template>
            <p class="mt-1">
              <template v-if="message.allowSenderEdit">
                El memo volvió a borrador:
                {{ message.isSender ? 'puedes corregirlo y reenviarlo' : 'el asistente puede corregirlo y reenviarlo' }}.
              </template>
              <template v-else>
                El memo quedó cerrado:
                {{ message.isSender ? 'no puedes editarlo' : 'el asistente no puede editarlo' }}.
              </template>
            </p>
          </div>

          <div v-if="canApprove" class="border-t border-warning/20 bg-warning-soft/60 px-5 py-3.5 sm:px-6">
            <div class="flex flex-wrap items-center gap-3">
              <ShieldCheck class="size-5 shrink-0 text-warning" />
              <div class="min-w-0 flex-1">
                <p class="text-[12.5px] font-medium text-ink">Este envío espera tu aprobación</p>
                <p class="text-[11.5px] text-ink-muted">Puedes abrir y corregir el documento antes de sellarlo. Al aprobarlo quedará bloqueado para siempre.</p>
              </div>
              <div class="flex gap-2">
                <button type="button" class="btn btn-outline btn-sm" @click="openReject">
                  <XCircle class="size-4" />
                  Devolver / rechazar
                </button>
                <button type="button" class="btn btn-primary btn-sm" @click="sendOpen = true">
                  <CheckCircle2 class="size-4" />
                  Aprobar y enviar
                </button>
              </div>
            </div>
          </div>

          <div v-if="canCancel" class="border-t border-hairline bg-surface-muted/60 px-5 py-3 sm:px-6">
            <div class="flex flex-wrap items-center gap-3">
              <p class="flex-1 text-[12px] text-ink-muted">Esperando la aprobación del jefe. Puedes cancelar el envío mientras siga pendiente.</p>
              <button type="button" class="btn btn-outline btn-sm" :disabled="cancelling" @click="cancelSend">
                <component :is="cancelling ? Loader2 : XCircle" :class="['size-4', cancelling ? 'animate-spin' : '']" />
                Cancelar envío
              </button>
            </div>
          </div>
        </header>

        <!-- Documento adjunto -->
        <section class="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div class="card overflow-hidden">
            <div class="flex items-center gap-2 border-b border-hairline px-4 py-3">
              <FileText class="size-4 text-accent" />
              <span class="text-[12.5px] font-medium text-ink">Documento adjunto</span>
              <span class="ml-auto text-[11px] text-ink-subtle">{{ docTypeLabel(message.document.docType) }}</span>
            </div>
            <div class="flex justify-center bg-[#eef1f5] px-4 py-6">
              <DocumentPreview
                :document-id="message.document.id"
                :version="message.document.version"
                :updated-at="message.document.updatedAt"
                :design-updated-at="message.document.designUpdatedAt"
                :tokens="message.document.designTokens"
                :scale="0.55"
                :lazy="false"
                :title="message.document.title"
              />
            </div>
          </div>

          <aside class="card h-fit p-4">
            <p class="text-[11px] font-medium uppercase tracking-wide text-ink-subtle">Detalles</p>
            <dl class="mt-3 space-y-3 text-[12.5px]">
              <div>
                <dt class="text-ink-subtle">Documento</dt>
                <dd class="mt-0.5 font-medium text-ink">{{ message.document.title }}</dd>
              </div>
              <div v-if="message.document.docNumber">
                <dt class="text-ink-subtle">Número</dt>
                <dd class="mt-0.5 font-medium text-ink">{{ message.document.docNumber }}</dd>
              </div>
              <div>
                <dt class="text-ink-subtle">Estado</dt>
                <dd class="mt-0.5 font-medium text-ink">{{ STATUS_LABELS[message.document.status] }}</dd>
              </div>
              <div>
                <dt class="text-ink-subtle">Versión enviada</dt>
                <dd class="mt-0.5 font-medium text-ink">{{ message.documentVersion }}</dd>
              </div>
              <div v-if="message.approvedByName">
                <dt class="text-ink-subtle">Aprobado por</dt>
                <dd class="mt-0.5 font-medium text-ink">{{ message.approvedByName }}</dd>
              </div>
              <div v-if="locked">
                <dt class="text-ink-subtle">Exportación</dt>
                <dd class="mt-0.5 font-medium text-ink">
                  {{ message.allowSenderExport ? 'Administrador y asistente' : 'Solo administrador' }}
                </dd>
              </div>
              <div>
                <dt class="text-ink-subtle">Destinatarios</dt>
                <dd class="mt-1 space-y-1.5">
                  <div v-for="recipient in message.recipients" :key="recipient.userId" class="flex items-center gap-2">
                    <UserAvatar :name="recipient.name" size="xs" />
                    <span class="min-w-0 flex-1 truncate text-ink">{{ recipient.name }}</span>
                    <span v-if="recipient.readAt" class="text-[10.5px] text-success">Leído</span>
                    <span v-else-if="message.status === 'sent'" class="text-[10.5px] text-ink-subtle">Sin leer</span>
                  </div>
                </dd>
              </div>
            </dl>

            <button type="button" class="btn btn-outline mt-4 w-full" @click="openDocument">
              <ExternalLink class="size-4" />
              {{
                message.status === 'rejected' && message.isSender && message.allowSenderEdit
                  ? 'Corregir y reenviar'
                  : 'Ver en el editor'
              }}
            </button>
            <BaseDropdown v-if="canExport" class="mt-2 w-full" align="right" width="w-full">
              <template #trigger>
                <button type="button" class="btn btn-primary w-full">
                  <Download class="size-4" />
                  Exportar
                  <ChevronDown class="size-3.5" />
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
            <p v-else class="mt-2 rounded-lg bg-surface-muted px-3 py-2 text-[11px] leading-snug text-ink-subtle">
              Solo el administrador puede exportar este memo sellado.
            </p>
          </aside>
        </section>
      </template>
    </div>

    <BaseModal
      :open="rejectOpen"
      :title="rejectAllowEdit ? 'Devolver para corrección' : 'Rechazar envío'"
      :description="
        rejectAllowEdit
          ? 'El memo volverá a borrador para que el asistente pueda corregirlo y reenviarlo.'
          : 'El memo quedará cerrado y bloqueado: el asistente no podrá editarlo.'
      "
      size="sm"
      @close="rejectOpen = false"
    >
      <label class="label" for="reject-reason">Motivo</label>
      <textarea
        id="reject-reason"
        v-model="rejectReason"
        class="field min-h-[110px]"
        maxlength="1000"
        placeholder="Indica qué debe corregirse…"
      />

      <label class="mt-3 flex cursor-pointer items-start gap-2 text-[12.5px] leading-snug text-ink-muted">
        <input
          v-model="rejectAllowEdit"
          type="checkbox"
          class="mt-0.5 size-4 shrink-0 accent-accent"
        />
        <span>
          Permitir que el asistente corrija y reenvíe el memo.
          Si lo desactivas, quedará bloqueado como solo lectura.
        </span>
      </label>

      <template #footer>
        <button type="button" class="btn btn-outline" :disabled="rejecting" @click="rejectOpen = false">Cancelar</button>
        <button
          type="button"
          :class="['btn', rejectAllowEdit ? 'btn-primary' : 'btn-danger']"
          :disabled="rejecting || !rejectReason.trim()"
          @click="submitReject"
        >
          <component
            :is="rejecting ? Loader2 : rejectAllowEdit ? Undo2 : XCircle"
            :class="['size-4', rejecting ? 'animate-spin' : '']"
          />
          {{
            rejecting
              ? 'Procesando…'
              : rejectAllowEdit
                ? 'Devolver para corrección'
                : 'Rechazar definitivamente'
          }}
        </button>
      </template>
    </BaseModal>

    <SendDocumentDialog
      v-if="message"
      :open="sendOpen"
      mode="approve"
      :message-id="message.id"
      :document-id="message.document.id"
      :document-title="message.document.title"
      :expected-version="message.document.version"
      :initial-subject="message.subject"
      :initial-body="message.body"
      :initial-recipient-ids="message.recipients.map((recipient) => recipient.userId)"
      @close="sendOpen = false"
      @sent="onSent"
    />
  </AppShell>
</template>
