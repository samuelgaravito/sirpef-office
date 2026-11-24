import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { and, eq, gt, isNull } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  documentMessages,
  documentSignatures,
  documents,
  mobileDevices,
  signatureCertificates,
  signatureChallenges,
  users,
  type DocumentRow,
  type MobileDeviceRow,
} from '../../db/schema.js';
import { env } from '../../env.js';
import { assertDocumentDataComplete } from '../../lib/document-data.js';
import { assertDocumentMutable } from '../../lib/access.js';
import { logActivity } from '../../lib/activity.js';
import type { AuthenticatedUser } from '../../lib/auth-guard.js';
import { renderDocumentPdf } from '../../lib/document-pdf.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import {
  canonicalContentHash,
  buildSigningPayload,
  newCertificateSerial,
  newVerificationToken,
  parseSignaturePng,
  verifyDeviceAssertion,
  type VerifiedSignatureImage,
} from '../../lib/signature.js';
import { sha256Hex } from '../../lib/stable-json.js';
import { appendSignaturePage, buildCertificatePdf } from '../../lib/pdf-stamp.js';

const SEALED_DIR = resolve(process.cwd(), env.SIGNATURE_DIR);

export interface ChallengeResult {
  challengeId: string;
  nonce: string;
  documentId: string;
  messageId: string;
  version: number;
  contentSha256: string;
  purpose: 'approval';
  expiresAt: string;
}

function verificationUrl(token: string): string {
  return `${env.PUBLIC_APP_URL.replace(/\/+$/, '')}/api/verify/${token}`;
}

/** Crea el desafío que la app firmará con la clave EC del dispositivo. */
export async function createSignatureChallenge(input: {
  user: AuthenticatedUser;
  documentId: string;
  messageId: string;
}): Promise<ChallengeResult> {
  const [message] = await db
    .select()
    .from(documentMessages)
    .where(eq(documentMessages.id, input.messageId))
    .limit(1);

  if (!message) throw notFound('Mensaje no encontrado');
  if (message.documentId !== input.documentId) {
    throw badRequest('El mensaje no corresponde al documento');
  }
  if (message.status !== 'pending_approval') {
    throw conflict('Este envío ya fue procesado');
  }

  const [document] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, input.documentId))
    .limit(1);

  if (!document || document.deletedAt) throw notFound('Documento no encontrado');
  assertDocumentMutable(document);
  await assertDocumentDataComplete(document);

  const contentSha256 = canonicalContentHash(document);
  const nonce = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + env.SIGNATURE_CHALLENGE_TTL_SECONDS * 1000);

  const [challenge] = await db
    .insert(signatureChallenges)
    .values({
      documentId: document.id,
      messageId: message.id,
      userId: input.user.sub,
      version: document.version,
      contentSha256,
      nonce,
      purpose: 'approval',
      expiresAt,
    })
    .returning();

  if (!challenge) throw conflict('No se pudo crear el desafío de firma');

  return {
    challengeId: challenge.id,
    nonce: challenge.nonce,
    documentId: document.id,
    messageId: message.id,
    version: challenge.version,
    contentSha256: challenge.contentSha256,
    purpose: 'approval',
    expiresAt: challenge.expiresAt.toISOString(),
  };
}

export async function findActiveDevice(
  userId: string,
  deviceId: string,
): Promise<MobileDeviceRow> {
  const [device] = await db
    .select()
    .from(mobileDevices)
    .where(
      and(
        eq(mobileDevices.userId, userId),
        eq(mobileDevices.deviceId, deviceId),
        eq(mobileDevices.status, 'active'),
      ),
    )
    .limit(1);

  if (!device) {
    throw forbidden('Este dispositivo no está vinculado o fue revocado');
  }
  return device;
}

function certificateData(input: {
  document: DocumentRow;
  user: AuthenticatedUser;
  signatureId: string;
  serial: string;
  token: string;
  signedAt: Date;
  method: 'drawn' | 'typed';
  device: MobileDeviceRow;
  ip: string | null;
  contentSha256: string;
  signatureSha256: string;
  sealedPdfSha256?: string;
  signaturePngBase64: string;
  signerCedula: string | null;
}) {
  return {
    serial: input.serial,
    verificationUrl: verificationUrl(input.token),
    documentId: input.document.id,
    messageId: null,
    documentTitle: input.document.title,
    docNumber: input.document.docNumber,
    signerName: input.user.name,
    signerCedula: input.signerCedula,
    signerRole: input.user.role === 'admin' ? 'Administrador' : 'Miembro',
    signedAt: input.signedAt,
    method: input.method,
    deviceLabel: [input.device.model, input.device.platform].filter(Boolean).join(' · '),
    ip: input.ip,
    contentSha256: input.contentSha256,
    signatureSha256: input.signatureSha256,
    sealedPdfSha256: input.sealedPdfSha256,
    signaturePngBase64: input.signaturePngBase64,
  };
}

export interface SealSignatureInput {
  user: AuthenticatedUser;
  documentId: string;
  messageId: string;
  challengeId: string;
  deviceId: string;
  signaturePng: string;
  strokes: unknown[];
  method: 'drawn' | 'typed';
  deviceAssertion: string;
  ip: string | null;
  userAgent: string | null;
}

export interface SealSignatureResult {
  signatureId: string;
  certificate: Record<string, unknown>;
  certificatePdfPath: string;
  sealedPdfPath: string;
}

/**
 * Verifica la aserción, renderiza el PDF final y lo sella con una hoja de
 * firmas. El challenge se marca como usado antes de renderizar; si el sellado
 * falla, se libera para que la app pueda reintentar.
 */
export async function sealSignature(input: SealSignatureInput): Promise<SealSignatureResult> {
  const signatureImage: VerifiedSignatureImage = parseSignaturePng(input.signaturePng);

  const [document] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, input.documentId))
    .limit(1);

  if (!document || document.deletedAt) throw notFound('Documento no encontrado');
  if (document.status !== 'sent' || !document.lockedAt) {
    throw conflict('El documento debe estar aprobado y sellado antes de firmar');
  }

  const [message] = await db
    .select()
    .from(documentMessages)
    .where(eq(documentMessages.id, input.messageId))
    .limit(1);

  if (!message) throw notFound('Mensaje no encontrado');
  if (message.documentId !== document.id) throw badRequest('El mensaje no corresponde al documento');
  if (message.approvedById !== input.user.sub) {
    throw forbidden('Solo el aprobador puede firmar este documento');
  }

  // Si ya existe una firma para este desafío, se devuelve la existente
  // (idempotencia ante reintentos de red).
  const [existing] = await db
    .select({
      signature: documentSignatures,
      certificate: signatureCertificates,
    })
    .from(documentSignatures)
    .innerJoin(
      signatureCertificates,
      eq(signatureCertificates.signatureId, documentSignatures.id),
    )
    .where(eq(documentSignatures.challengeId, input.challengeId))
    .limit(1);

  if (existing) {
    return {
      signatureId: existing.signature.id,
      certificate: existing.certificate.certJson,
      certificatePdfPath: existing.certificate.certificatePdfPath,
      sealedPdfPath: existing.certificate.sealedPdfPath,
    };
  }

  const [challenge] = await db
    .select()
    .from(signatureChallenges)
    .where(eq(signatureChallenges.id, input.challengeId))
    .limit(1);

  if (!challenge) throw notFound('Desafío de firma no encontrado');
  if (challenge.userId !== input.user.sub) throw forbidden('El desafío pertenece a otro usuario');
  if (challenge.documentId !== document.id || challenge.messageId !== message.id) {
    throw badRequest('El desafío no corresponde a este documento');
  }
  if (challenge.usedAt) throw conflict('Este desafío ya fue utilizado');
  if (challenge.expiresAt.getTime() <= Date.now()) {
    throw conflict('El desafío de firma expiró; vuelve a intentarlo');
  }
  if (challenge.version !== document.version) {
    throw conflict('El documento cambió después de crear el desafío', {
      currentVersion: document.version,
    });
  }

  const currentHash = canonicalContentHash(document);
  if (currentHash !== challenge.contentSha256) {
    throw conflict('El contenido del documento cambió; vuelve a revisarlo y firma de nuevo');
  }

  const device = await findActiveDevice(input.user.sub, input.deviceId);

  const payload = buildSigningPayload({
    challengeId: challenge.id,
    documentId: document.id,
    messageId: message.id,
    version: document.version,
    contentSha256: challenge.contentSha256,
    signatureSha256: signatureImage.sha256,
  });

  if (
    !verifyDeviceAssertion({
      publicKeyPem: device.publicKey,
      payload,
      signatureBase64: input.deviceAssertion,
    })
  ) {
    throw forbidden('No se pudo verificar la firma del dispositivo. Vuelve a autenticarte.');
  }

  // Reclamo atómico del desafío (evita dos sellados concurrentes).
  const [claimed] = await db
    .update(signatureChallenges)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(signatureChallenges.id, challenge.id),
        isNull(signatureChallenges.usedAt),
        gt(signatureChallenges.expiresAt, new Date()),
      ),
    )
    .returning();

  if (!claimed) throw conflict('Este desafío ya fue utilizado');

  const signatureId = randomUUID();
  const serial = newCertificateSerial();
  const token = newVerificationToken();
  const signedAt = new Date();

  const [signer] = await db
    .select({ cedula: users.cedula })
    .from(users)
    .where(eq(users.id, input.user.sub))
    .limit(1);

  try {
    const basePdf = await renderDocumentPdf(document);
    const pageData = certificateData({
      document,
      user: input.user,
      signatureId,
      serial,
      token,
      signedAt,
      method: input.method,
      device,
      ip: input.ip,
      contentSha256: currentHash,
      signatureSha256: signatureImage.sha256,
      signaturePngBase64: signatureImage.base64,
      signerCedula: signer?.cedula ?? null,
    });

    const sealedPdf = await appendSignaturePage(basePdf, {
      ...pageData,
      messageId: message.id,
    });
    const sealedPdfSha256 = sha256Hex(sealedPdf);

    const directory = join(SEALED_DIR, document.id);
    await mkdir(directory, { recursive: true });
    const sealedPath = join(directory, `${signatureId}.pdf`);
    const certificatePath = join(directory, `${signatureId}-certificado.pdf`);
    await writeFile(sealedPath, sealedPdf);

    const certJson = {
      status: 'valid',
      serial,
      verificationUrl: pageData.verificationUrl,
      issuedAt: signedAt.toISOString(),
      document: {
        id: document.id,
        title: document.title,
        docNumber: document.docNumber,
        version: document.version,
      },
      signer: {
        id: input.user.sub,
        name: input.user.name,
        cedula: signer?.cedula ?? null,
        role: input.user.role,
      },
      signature: {
        id: signatureId,
        method: input.method,
        signedAt: signedAt.toISOString(),
        device: {
          id: device.id,
          deviceId: device.deviceId,
          model: device.model,
          platform: device.platform,
        },
        ip: input.ip,
        contentSha256: currentHash,
        signatureSha256: signatureImage.sha256,
      },
      sealedPdfSha256,
      legalNotice:
        'Constancia de firma electrónica simple auditada. La validez jurídica depende del marco legal aplicable.',
    };

    const certificatePdf = await buildCertificatePdf({
      ...pageData,
      messageId: message.id,
      sealedPdfSha256,
    });
    await writeFile(certificatePath, certificatePdf);

    await db.transaction(async (tx) => {
      const [signature] = await tx
        .insert(documentSignatures)
        .values({
          id: signatureId,
          documentId: document.id,
          messageId: message.id,
          userId: input.user.sub,
          challengeId: challenge.id,
          deviceId: device.id,
          method: input.method,
          signaturePng: signatureImage.base64,
          strokes: input.strokes,
          contentSha256: currentHash,
          signatureSha256: signatureImage.sha256,
          sealedPdfSha256,
          status: 'sealed',
          signedAt,
          ip: input.ip,
          userAgent: input.userAgent,
        })
        .returning();

      if (!signature) throw conflict('No se pudo registrar la firma');

      await tx.insert(signatureCertificates).values({
        serial,
        documentId: document.id,
        signatureId: signature.id,
        verificationTokenHash: sha256Hex(token),
        issuedAt: signedAt,
        certJson,
        sealedPdfPath: sealedPath,
        certificatePdfPath: certificatePath,
        sealedPdfSha256,
      });

      await tx
        .update(mobileDevices)
        .set({ lastSeenAt: signedAt })
        .where(eq(mobileDevices.id, device.id));
    });

    await logActivity(input.user.sub, 'document', document.id, 'signed', {
      messageId: message.id,
      signatureId,
      serial,
      sealedPdfSha256,
      method: input.method,
    });

    return {
      signatureId,
      certificate: certJson,
      certificatePdfPath: certificatePath,
      sealedPdfPath: sealedPath,
    };
  } catch (error) {
    // Si no se llegó a persistir la firma, el desafío vuelve a estar libre.
    await db
      .update(signatureChallenges)
      .set({ usedAt: null })
      .where(eq(signatureChallenges.id, challenge.id));
    throw error;
  }
}
