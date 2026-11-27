import { randomUUID } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db } from '../../db/index.js';
import { documentMessages, documents } from '../../db/schema.js';
import { logActivity } from '../../lib/activity.js';
import type { AuthenticatedUser } from '../../lib/auth-guard.js';
import { conflict, notFound } from '../../lib/errors.js';
import { newCertificateSerial, newVerificationToken } from '../../lib/signature.js';
import {
  approveInTx,
  publishApprovalEffects,
  type ApproveInTxResult,
} from '../inbox/approve.js';
import {
  findSealByChallenge,
  removeSealFiles,
  sealCore,
  validateSealContext,
  type SealSignatureResult,
} from './signature.js';

export interface ApproveAndSealInput {
  user: AuthenticatedUser;
  messageId: string;
  expectedVersion: number;
  subject?: string;
  body?: string;
  allowSenderExport: boolean;
  challengeId: string;
  deviceId: string;
  signaturePng: string;
  strokes: unknown[];
  method: 'drawn' | 'typed';
  deviceAssertion: string;
  ip: string | null;
  userAgent: string | null;
}

export interface ApproveAndSealResult {
  existing: boolean;
  documentId: string;
  docNumber: string | null;
  subject: string;
  approval: ApproveInTxResult | null;
  sealed: SealSignatureResult;
}

/**
 * Aprueba, numera, firma y emite el certificado en **una sola transacción**.
 *
 * Si cualquier paso falla (hash, TOTP, dispositivo, renderizado, escritura),
 * se revierte todo: el mensaje sigue pendiente, el número no se consume y el
 * desafío queda libre para reintentar. Nunca queda un documento aprobado sin
 * certificado.
 */
export async function approveAndSeal(input: ApproveAndSealInput): Promise<ApproveAndSealResult> {
  const [message] = await db
    .select()
    .from(documentMessages)
    .where(eq(documentMessages.id, input.messageId))
    .limit(1);

  if (!message) throw notFound('Mensaje no encontrado');

  // Reintento tras una respuesta perdida: si el desafío ya tiene certificado,
  // se devuelve el mismo resultado sin volver a aprobar ni firmar.
  const existingSeal = await findSealByChallenge(input.challengeId);
  if (existingSeal) {
    const [document] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, message.documentId))
      .limit(1);
    return {
      existing: true,
      documentId: message.documentId,
      docNumber: document?.docNumber ?? null,
      subject: message.subject,
      approval: null,
      sealed: existingSeal,
    };
  }

  if (message.status !== 'pending_approval') {
    throw conflict('Este envío ya fue procesado');
  }

  const [document] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, message.documentId))
    .limit(1);

  if (!document || document.deletedAt) throw notFound('Documento no encontrado');

  // Validación previa completa: el desafío, el hash actual, el dispositivo,
  // el TOTP y la aserción deben ser válidos antes de abrir la transacción.
  const context = await validateSealContext({
    user: input.user,
    document,
    message,
    challengeId: input.challengeId,
    deviceId: input.deviceId,
    signaturePng: input.signaturePng,
    deviceAssertion: input.deviceAssertion,
    allowPendingApproval: true,
  });

  const ids = {
    signatureId: randomUUID(),
    serial: newCertificateSerial(),
    token: newVerificationToken(),
    signedAt: new Date(),
  };

  try {
    const result = await db.transaction(async (tx) => {
      const approval = await approveInTx(tx, {
        user: input.user,
        messageId: input.messageId,
        expectedVersion: input.expectedVersion,
        subject: input.subject,
        body: input.body,
        allowSenderExport: input.allowSenderExport,
      });

      const sealed = await sealCore({
        tx,
        user: input.user,
        document: approval.document,
        message: approval.message,
        context,
        method: input.method,
        strokes: input.strokes,
        ip: input.ip,
        userAgent: input.userAgent,
        ids,
      });

      return { approval, sealed };
    });

    await publishApprovalEffects(result.approval, input.user);
    await logActivity(input.user.sub, 'document', result.approval.document.id, 'signed', {
      messageId: input.messageId,
      signatureId: result.sealed.signatureId,
      serial: ids.serial,
      sealedPdfSha256: (result.sealed.certificate as { sealedPdfSha256?: string }).sealedPdfSha256,
      method: input.method,
    });

    return {
      existing: false,
      documentId: result.approval.document.id,
      docNumber: result.approval.docNumber,
      subject: result.approval.subject,
      approval: result.approval,
      sealed: result.sealed,
    };
  } catch (error) {
    // La transacción ya revirtió la base; aquí solo quedan los PDFs escritos.
    await removeSealFiles(document.id, ids.signatureId);
    throw error;
  }
}
