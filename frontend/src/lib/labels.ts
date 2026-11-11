import type { DocType, DocumentStatus, InboxMessageStatus } from '@sirpefoffice/shared';

export const DOC_TYPE_LABELS: Record<DocType, string> = {
  memorandum: 'Memorándum',
  delivery_note: 'Nota de entrega',
  report: 'Informe',
  meeting_minutes: 'Acta de reunión',
  evaluation_plan: 'Plan de evaluación',
  resume: 'Currículum',
  letter: 'Carta / Oficio',
  certificate: 'Certificado',
  blank: 'Documento en blanco',
};

export const STATUS_LABELS: Record<DocumentStatus, string> = {
  draft: 'Borrador',
  in_review: 'Pendiente de aprobación',
  final: 'Final',
  archived: 'Archivado',
  sent: 'Enviado',
  approved: 'Aprobado',
  rejected: 'Rechazado',
  cancelled: 'Anulado',
};

/** Motivo por el que no se puede exportar (el administrador debe autorizarlo). */
export const EXPORT_FORBIDDEN_MESSAGE =
  'Necesitas que el administrador autorice la exportación de este documento';

/** Aviso de que el estado del documento solo lo cambian los administradores. */
export const STATUS_ADMIN_ONLY_MESSAGE =
  'Solo los administradores pueden cambiar el estado del documento';

export const STATUS_STYLES: Record<DocumentStatus, string> = {
  draft: 'bg-surface-muted text-ink-muted',
  in_review: 'bg-warning-soft text-warning',
  final: 'bg-success-soft text-success',
  archived: 'bg-surface-hover text-ink-subtle',
  sent: 'bg-accent-soft text-accent',
  approved: 'bg-success-soft text-success',
  rejected: 'bg-danger-soft text-danger',
  cancelled: 'bg-surface-hover text-ink-subtle',
};

export const INBOX_STATUS_LABELS: Record<InboxMessageStatus, string> = {
  pending_approval: 'Pendiente de aprobación',
  sent: 'Aprobado y enviado',
  rejected: 'Rechazado',
  cancelled: 'Anulado',
};

/** Contexto desde el que el usuario mira el mensaje. */
export type InboxStatusContext =
  | 'recipient'
  | 'pending-owner'
  | 'pending-approver'
  | 'result';

export function inboxStatusLabel(
  status: InboxMessageStatus,
  context: InboxStatusContext = 'result',
): string {
  if (status === 'pending_approval') {
    return context === 'pending-approver'
      ? 'Requiere tu aprobación'
      : 'Esperando aprobación';
  }
  if (status === 'sent') {
    return context === 'recipient' ? 'Enviado' : 'Aprobado y enviado';
  }
  return INBOX_STATUS_LABELS[status];
}

export function inboxStatusStyle(
  status: InboxMessageStatus,
  context: InboxStatusContext = 'result',
): string {
  if (status === 'pending_approval') {
    return 'bg-warning-soft text-warning ring-warning/25';
  }
  if (status === 'sent') {
    return context === 'recipient'
      ? 'bg-accent-soft text-accent ring-accent/25'
      : 'bg-success-soft text-success ring-success/25';
  }
  if (status === 'rejected') {
    return 'bg-danger-soft text-danger ring-danger/25';
  }
  return 'bg-surface-hover text-ink-muted ring-hairline-strong';
}

export function docTypeLabel(type: DocType | string): string {
  return DOC_TYPE_LABELS[type as DocType] ?? type;
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-PE', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** «hace 3 minutos», «ayer», etc. */
export function relativeTime(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60000);

  if (minutes < 1) return 'ahora mismo';
  if (minutes < 60) return `hace ${minutes} min`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;

  const days = Math.round(hours / 24);
  if (days === 1) return 'ayer';
  if (days < 30) return `hace ${days} días`;

  return formatDate(date);
}

export function initialsOf(name: string | null | undefined): string {
  return (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}
