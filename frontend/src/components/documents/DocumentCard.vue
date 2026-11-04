<script setup lang="ts">
import { Copy, ExternalLink, Lock, MoreVertical, RotateCcw, Trash2 } from 'lucide-vue-next';
import { computed } from 'vue';

import DocumentPreview from '@/components/documents/DocumentPreview.vue';
import BaseDropdown from '@/components/ui/BaseDropdown.vue';
import UserAvatar from '@/components/ui/UserAvatar.vue';
import { docTypeLabel, relativeTime, STATUS_LABELS, STATUS_STYLES } from '@/lib/labels';
import type { DocumentSummary } from '@sirpefoffice/shared';

const props = defineProps<{ document: DocumentSummary; showOwner?: boolean; trashed?: boolean }>();

const emit = defineEmits<{
  open: [id: string];
  delete: [document: DocumentSummary];
  duplicate: [document: DocumentSummary];
  restore: [document: DocumentSummary];
}>();

const isLocked = computed(
  () => Boolean(props.document.lockedAt) || props.document.status === 'sent',
);

function openDocument(): void {
  if (!props.trashed) emit('open', props.document.id);
}
</script>

<template>
  <article class="card group flex flex-col transition-shadow hover:shadow-pop">
    <button
      type="button"
      class="flex justify-center overflow-hidden px-2.5 pt-2.5 text-left"
      :class="{ 'cursor-default': trashed }"
      @click="openDocument"
    >
      <DocumentPreview
        :document-id="document.id"
        :version="document.version"
        :updated-at="document.updatedAt"
        :design-updated-at="document.designUpdatedAt"
        :tokens="document.designTokens"
        :scale="0.24"
        :title="document.title"
      />
    </button>

    <div class="flex flex-1 items-start gap-1.5 px-3 pb-2.5 pt-2.5">
      <button type="button" class="min-w-0 flex-1 text-left" @click="openDocument">
        <p class="truncate text-[13px] font-medium text-ink">{{ document.title }}</p>
        <p v-if="document.description || document.autoDescription" class="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-ink-muted">
          {{ document.description || document.autoDescription }}
        </p>
        <p class="mt-0.5 flex items-center gap-1 truncate text-[11.5px] text-ink-subtle">
          <span class="truncate">{{ document.docNumber ?? docTypeLabel(document.docType) }}</span>
          <span aria-hidden="true">·</span>
          <span class="shrink-0">
            {{ trashed ? `Eliminado ${relativeTime(document.deletedAt ?? document.updatedAt)}` : relativeTime(document.updatedAt) }}
          </span>
        </p>
        <span
          :class="['mt-1.5 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-medium', STATUS_STYLES[document.status]]"
        >
          {{ STATUS_LABELS[document.status] }}
        </span>
        <span
          v-if="isLocked"
          class="ml-1 mt-1.5 inline-flex items-center gap-0.5 rounded-full bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-ink-subtle"
        >
          <Lock class="size-2.5" />
          Solo lectura
        </span>
      </button>

      <UserAvatar
        v-if="showOwner && document.ownerName"
        :name="document.ownerName"
        size="xs"
        class="mt-0.5"
      />

      <BaseDropdown align="right" width="w-44">
        <template #trigger>
          <button
            type="button"
            class="rounded-md p-1 text-ink-subtle opacity-0 transition-all hover:bg-surface-hover hover:text-ink group-hover:opacity-100 focus:opacity-100"
            aria-label="Acciones del documento"
          >
            <MoreVertical class="size-4" />
          </button>
        </template>
        <template #content>
          <template v-if="!trashed">
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink"
              @click="emit('open', document.id)"
            >
              <ExternalLink class="size-4" />
              Abrir
            </button>
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-ink-muted hover:bg-surface-hover hover:text-ink"
              @click="emit('duplicate', document)"
            >
              <Copy class="size-4" />
              Duplicar
            </button>
            <button
              v-if="document.permission === 'owner' && !isLocked"
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-danger hover:bg-danger-soft"
              @click="emit('delete', document)"
            >
              <Trash2 class="size-4" />
              Eliminar
            </button>
          </template>
          <button
            v-else
            type="button"
            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-accent hover:bg-accent-soft"
            @click="emit('restore', document)"
          >
            <RotateCcw class="size-4" />
            Restaurar
          </button>
        </template>
      </BaseDropdown>
    </div>
  </article>
</template>
