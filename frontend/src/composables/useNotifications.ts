import { computed, ref } from 'vue';

import { isInboxRealtimeEvent, type RealtimeMessage } from '@sirpefoffice/shared';

import { useInboxBadge } from '@/composables/useInboxBadge';
import { onRealtimeEvent } from '@/composables/useRealtime';

export type SystemNotificationPermission = NotificationPermission | 'unsupported';
export type BellTone = 'info' | 'success' | 'warning';

interface BellCopy {
  title: string;
  detail: string;
  tone: BellTone;
}

interface StartOptions {
  /** Qué hacer al pulsar la campana (o el aviso del sistema). */
  onOpenInbox: () => void;
}

/** Cuánto tiempo queda el aviso flotante en pantalla. */
const AUTOHIDE_MS = 6000;
/** Recuerda si el usuario silenció los avisos del sistema en este navegador. */
const MUTE_KEY = 'sirpefoffice.avisosSilenciados';

const bellVisible = ref(false);
const bellCount = ref(0);
const bellTitle = ref('');
const bellDetail = ref('');
const bellTone = ref<BellTone>('info');
const permission = ref<SystemNotificationPermission>(detectPermission());
const muted = ref(readMuted());
const supported = computed(() => permission.value !== 'unsupported');

const { refresh: refreshInbox } = useInboxBadge();

let unsubscribe: (() => void) | null = null;
let openInboxHandler: (() => void) | null = null;
let hideTimer: number | undefined;
/** Milisegundos que le quedan al aviso cuando se pausa (hover o foco). */
let remaining = AUTOHIDE_MS;
let startedAt = 0;

function detectPermission(): SystemNotificationPermission {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeMuted(value: boolean): void {
  try {
    window.localStorage.setItem(MUTE_KEY, value ? '1' : '0');
  } catch {
    // Sin almacenamiento la preferencia dura lo que la pestaña.
  }
}

function clearTimer(): void {
  if (hideTimer !== undefined) {
    window.clearTimeout(hideTimer);
    hideTimer = undefined;
  }
}

function hideBell(): void {
  clearTimer();
  bellVisible.value = false;
  bellCount.value = 0;
  remaining = AUTOHIDE_MS;
}

function restartTimer(): void {
  clearTimer();
  remaining = AUTOHIDE_MS;
  startedAt = Date.now();
  hideTimer = window.setTimeout(hideBell, remaining);
}

/** Pausa la cuenta atrás (el puntero o el foco están sobre el aviso). */
function pause(): void {
  if (hideTimer === undefined) return;
  clearTimer();
  remaining = Math.max(0, remaining - (Date.now() - startedAt));
}

/** Reanuda la cuenta atrás con lo que quedaba. */
function resume(): void {
  if (!bellVisible.value || hideTimer !== undefined || remaining <= 0) return;
  startedAt = Date.now();
  hideTimer = window.setTimeout(hideBell, remaining);
}

/** Traduce cada evento de la bandeja a lo que se muestra en la campana. */
function describe(message: RealtimeMessage): BellCopy | null {
  const payload = message.payload;
  if (!payload) return null;

  switch (message.type) {
    case 'inbox.message.created':
      return {
        title: `Nuevo mensaje de ${payload.actorName}`,
        detail: payload.subject,
        tone: 'info',
      };
    case 'inbox.message.pending':
      return {
        title: 'Envío pendiente de aprobación',
        detail: `${payload.subject} · ${payload.actorName}`,
        tone: 'warning',
      };
    case 'inbox.message.approved':
      return {
        title: 'Documento aprobado y enviado',
        detail: payload.subject,
        tone: 'success',
      };
    case 'inbox.result.approved':
      return {
        title: `Documento aprobado por ${payload.actorName}`,
        detail: payload.subject,
        tone: 'success',
      };
    case 'inbox.result.rejected':
      return {
        title: `Documento rechazado por ${payload.actorName}`,
        detail: payload.subject,
        tone: 'warning',
      };
    case 'inbox.message.cancelled':
      return {
        title: 'Envío cancelado',
        detail: payload.subject,
        tone: 'info',
      };
    default:
      return null;
  }
}

function shouldNotifySystem(): boolean {
  if (permission.value !== 'granted' || muted.value) return false;
  // Solo cuando el usuario no está mirando la aplicación: si la pestaña está
  // a la vista, ya está la campana dentro de la app.
  return document.visibilityState === 'hidden' || !document.hasFocus();
}

function showSystemNotification(title: string, body: string): void {
  try {
    const notification = new Notification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // El mismo `tag` agrupa: un aviso nuevo sustituye al anterior.
      tag: 'sirpefoffice-bandeja',
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
      openInbox();
    };
  } catch {
    // Android Chrome no permite el constructor desde la página: en ese caso
    // queda la campana de la aplicación.
  }
}

function showBell(copy: BellCopy): void {
  bellTitle.value = copy.title;
  bellDetail.value = copy.detail;
  bellTone.value = copy.tone;
  // Si llegan varios seguidos se agrupan en una sola campana con el contador.
  bellCount.value += 1;
  bellVisible.value = true;
  restartTimer();
}

function handleEvent(message: RealtimeMessage): void {
  if (!isInboxRealtimeEvent(message.type)) return;

  // El badge y los contadores se recalculan con la API de siempre.
  void refreshInbox();

  const copy = describe(message);
  if (!copy) return;

  showBell(copy);
  if (shouldNotifySystem()) showSystemNotification(copy.title, copy.detail);
}

/** Pide permiso al navegador. Debe llamarse desde un clic (lo exigen los navegadores). */
async function requestPermission(): Promise<void> {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'denied') {
    permission.value = 'denied';
    return;
  }
  try {
    permission.value = await Notification.requestPermission();
  } catch {
    permission.value = detectPermission();
  }
}

function toggleMuted(): void {
  muted.value = !muted.value;
  writeMuted(muted.value);
}

function openInbox(): void {
  hideBell();
  openInboxHandler?.();
}

/** Empieza a escuchar los eventos de la bandeja (idempotente). */
function start(options: StartOptions): void {
  openInboxHandler = options.onOpenInbox;
  permission.value = detectPermission();
  if (unsubscribe) return;
  unsubscribe = onRealtimeEvent(handleEvent);
}

/** Deja de escuchar y oculta la campana (fin de sesión). */
function reset(): void {
  hideBell();
  bellTitle.value = '';
  bellDetail.value = '';
  bellTone.value = 'info';
}

export function useNotifications() {
  return {
    bellVisible,
    bellCount,
    bellTitle,
    bellDetail,
    bellTone,
    permission,
    muted,
    supported,
    start,
    reset,
    pause,
    resume,
    dismiss: hideBell,
    openInbox,
    requestPermission,
    toggleMuted,
  };
}
