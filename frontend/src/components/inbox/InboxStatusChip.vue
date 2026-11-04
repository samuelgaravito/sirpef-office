<script setup lang="ts">
import { CheckCircle2, Clock, MinusCircle, Send, XCircle } from 'lucide-vue-next';
import { computed, type Component } from 'vue';

import type { InboxMessageStatus } from '@sirpefoffice/shared';

import {
  inboxStatusLabel,
  inboxStatusStyle,
  type InboxStatusContext,
} from '@/lib/labels';

const props = withDefaults(
  defineProps<{
    status: InboxMessageStatus;
    context?: InboxStatusContext;
    size?: 'sm' | 'md';
  }>(),
  { context: 'result', size: 'sm' },
);

const label = computed(() => inboxStatusLabel(props.status, props.context));
const tone = computed(() => inboxStatusStyle(props.status, props.context));

const icon = computed<Component>(() => {
  if (props.status === 'pending_approval') return Clock;
  if (props.status === 'sent') return props.context === 'recipient' ? Send : CheckCircle2;
  if (props.status === 'rejected') return XCircle;
  return MinusCircle;
});

const sizeClass = computed(() =>
  props.size === 'md' ? 'px-2.5 py-1 text-[11.5px]' : 'px-2 py-0.5 text-[10.5px]',
);

const iconClass = computed(() => (props.size === 'md' ? 'size-3.5' : 'size-3'));
</script>

<template>
  <span
    :class="[
      'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-semibold ring-1 ring-inset',
      sizeClass,
      tone,
    ]"
  >
    <component :is="icon" :class="iconClass" />
    {{ label }}
  </span>
</template>
