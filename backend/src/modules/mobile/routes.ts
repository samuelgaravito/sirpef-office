import { createPublicKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { and, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { db } from '../../db/index.js';
import {
  documentMessageRecipients,
  documentMessages,
  documentSignatures,
  documents,
  mobileDevices,
  refreshTokens,
  signatureCertificates,
  users,
} from '../../db/schema.js';
import { assertDocument, canExportDocument } from '../../lib/access.js';
import { authenticate, requireAdmin } from '../../lib/auth-guard.js';
import { renderDocumentPdf } from '../../lib/document-pdf.js';
import {
  badRequest,
  conflict,
  forbidden,
  internal,
  notFound,
} from '../../lib/errors.js';
import { toPublicUser } from '../../lib/mappers.js';
import { sha256Hex } from '../../lib/stable-json.js';
import { approveAndSeal } from './approve-and-seal.js';
import { publishInboxEvent, publishRealtimeEvent } from '../realtime/events.js';
import {
  createSignatureChallenge,
  sealSignature,
} from './signature.js';
import { assertSignatureAuthorization } from '../token/service.js';
import { annulMessage } from '../documents/annul.js';
import { rejectMessage } from '../inbox/reject.js';

const listQuery = z.object({
  scope: z.enum(['all', 'pending', 'received', 'sent', 'signed', 'needs_signature']).default('all'),
  q: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

const deviceSchema = z.object({
  deviceId: z.string().trim().min(8).max(200),
  publicKey: z.string().min(40).max(8_000),
  algorithm: z.string().trim().max(20).default('ES256'),
  platform: z.string().trim().max(40).default('android'),
  model: z.string().trim().max(200).default(''),
  appVersion: z.string().trim().max(40).default(''),
});

const challengeSchema = z.object({
  messageId: z.uuid(),
});

const signatureSchema = z.object({
  challengeId: z.uuid(),
  signaturePng: z.string().min(100).max(1_000_000),
  strokes: z.array(z.unknown()).max(20_000).default([]),
  method: z.enum(['drawn', 'typed']).default('drawn'),
  deviceAssertion: z.string().min(20).max(10_000),
});

const approveAndSignSchema = signatureSchema.extend({
  expectedVersion: z.number().int().positive(),
  subject: z.string().trim().min(1).max(240).optional(),
  body: z.string().max(5_000).optional(),
  allowSenderExport: z.boolean().default(false),
});

const signSchema = signatureSchema.extend({
  messageId: z.uuid(),
});

const rejectSchema = z.object({
  reason: z.string().trim().min(1).max(1000),
  allowEdit: z.boolean().default(true),
});

const annulSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  expectedVersion: z.number().int().positive(),
  code: z.string().trim().regex(/^\d{6}$/, 'El código debe tener 6 dígitos'),
});

const certificateSelect = {
  serial: signatureCertificates.serial,
  certJson: signatureCertificates.certJson,
  sealedPdfPath: signatureCertificates.sealedPdfPath,
  certificatePdfPath: signatureCertificates.certificatePdfPath,
  sealedPdfSha256: signatureCertificates.sealedPdfSha256,
  signaturePng: documentSignatures.signaturePng,
  issuedAt: signatureCertificates.issuedAt,
};

interface MobileDocument {
  id: string;
  documentId: string;
  title: string;
  subject: string;
  senderName: string;
  status: string;
  documentStatus: string;
  docNumber: string | null;
  version: number;
  createdAt: string;
  approvedAt: string | null;
  signedAt: string | null;
  signed: boolean;
  certificateSerial: string | null;
  canSign: boolean;
  /** Aprobado por mí pero sin firma sellada: falta completar el certificado. */
  needsSignature: boolean;
  /** El aprobador puede anularlo desde la app con TOTP. */
  canAnnul: boolean;
  annulled: boolean;
  annulledAt: string | null;
  annulledReason: string | null;
  /** El aprobador puede autorizar una edición de emergencia desde la app. */
  canEmergencyEdit: boolean;
}

function signedSubquery(userId: string) {
  return sql<string | null>`(
    select sc.serial
    from signature_certificates sc
    inner join document_signatures ds on ds.id = sc.signature_id
    where ds.document_id = documents.id
      and ds.user_id = ${userId}
      and ds.status = 'sealed'
    order by sc.issued_at desc
    limit 1
  )`;
}

function signedAtSubquery(userId: string) {
  // Un subselect crudo no pasa por el decodificador de Drizzle: se pide ya en
  // ISO 8601 para que la app reciba siempre una fecha, nunca un `Date` suelto.
  return sql<string | null>`(
    select to_char(ds.signed_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    from document_signatures ds
    where ds.document_id = documents.id
      and ds.user_id = ${userId}
      and ds.status = 'sealed'
    order by ds.signed_at desc
    limit 1
  )`;
}

/** Normaliza a ISO 8601 una fecha que llega como `Date` o como texto. */
function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`Fecha inválida en el documento móvil: ${value}`);
  }
  return parsed.toISOString();
}

function toIsoOrNull(value: Date | string | null | undefined): string | null {
  return value === null || value === undefined ? null : toIso(value);
}

function toMobileDocument(
  row: {
    id: string;
    documentId: string;
    title: string;
    subject: string;
    senderName: string;
    status: string;
    documentStatus: string;
    docNumber: string | null;
    version: number;
    createdAt: Date | string;
    approvedAt: Date | string | null;
    approvedById: string | null;
    certificateSerial: string | null;
    signedAt: Date | string | null;
    annulledAt: Date | string | null;
    annulledReason: string | null;
  },
  canSign: boolean,
  userId: string,
): MobileDocument {
  const signed = Boolean(row.certificateSerial);
  const isApprover = row.approvedById === userId;
  const annulled = row.annulledAt !== null;
  const approvedAndSent = row.status === 'sent' && isApprover && !annulled;

  return {
    id: row.id,
    documentId: row.documentId,
    title: row.title,
    subject: row.subject,
    senderName: row.senderName,
    status: row.status,
    documentStatus: row.documentStatus,
    docNumber: row.docNumber,
    version: row.version,
    createdAt: toIso(row.createdAt),
    approvedAt: toIsoOrNull(row.approvedAt),
    signedAt: toIsoOrNull(row.signedAt),
    signed,
    certificateSerial: row.certificateSerial,
    canSign,
    needsSignature: approvedAndSent && !signed,
    canAnnul: approvedAndSent,
    annulled,
    annulledAt: toIsoOrNull(row.annulledAt),
    annulledReason: row.annulledReason,
    canEmergencyEdit: approvedAndSent,
  };
}

function searchFilter(q: string | undefined) {
  return q
    ? or(
        ilike(documents.title, `%${q}%`),
        ilike(documentMessages.subject, `%${q}%`),
        ilike(users.name, `%${q}%`),
      )
    : undefined;
}

function pendingFilter(q: string | undefined) {
  return and(
    eq(documentMessages.status, 'pending_approval'),
    isNull(documents.deletedAt),
    searchFilter(q),
  );
}

function sentFilter(userId: string, q: string | undefined) {
  return and(
    inArray(documentMessages.status, ['sent', 'rejected', 'cancelled', 'superseded']),
    isNull(documents.deletedAt),
    or(
      eq(documentMessages.senderId, userId),
      eq(documentMessages.approvedById, userId),
    ),
    searchFilter(q),
  );
}

function needsSignatureFilter(userId: string, q: string | undefined) {
  return and(
    eq(documentMessages.status, 'sent'),
    isNull(documents.deletedAt),
    eq(documentMessages.approvedById, userId),
    isNull(documentMessages.annulledAt),
    sql`not exists (
      select 1 from document_signatures ds
      where ds.document_id = documents.id
        and ds.user_id = ${userId}
        and ds.status = 'sealed'
    )`,
    searchFilter(q),
  );
}

function signedFilter(userId: string, q: string | undefined) {
  return and(
    eq(documentSignatures.userId, userId),
    eq(documentSignatures.status, 'sealed'),
    isNull(documents.deletedAt),
    searchFilter(q),
  );
}

/** Avisa al aprobador de que la firma quedó estampada. */
async function publishSignatureEvent(input: {
  userId: string;
  userName: string;
  messageId: string;
  documentId: string;
  documentTitle: string;
  subject: string;
  certificate: Record<string, unknown>;
}): Promise<void> {
  const serial = typeof input.certificate.serial === 'string' ? input.certificate.serial : null;
  const signedAt =
    typeof input.certificate.issuedAt === 'string' ? input.certificate.issuedAt : null;

  await publishInboxEvent({
    type: 'inbox.message.signed',
    userIds: [input.userId],
    messageId: input.messageId,
    documentId: input.documentId,
    documentTitle: input.documentTitle,
    subject: input.subject,
    actorId: input.userId,
    actorName: input.userName,
    status: 'sent',
    signedAt,
    serial,
  });
}

function receivedFilter(userId: string, q: string | undefined) {
  return and(
    eq(documentMessages.status, 'sent'),
    isNull(documents.deletedAt),
    eq(documentMessageRecipients.userId, userId),
    isNull(documentMessageRecipients.archivedAt),
    searchFilter(q),
  );
}

async function listReceived(
  userId: string,
  q: string | undefined,
  limit: number,
  offset: number,
): Promise<MobileDocument[]> {
  const rows = await db
    .select({
      id: documentMessages.id,
      documentId: documents.id,
      title: documents.title,
      subject: documentMessages.subject,
      senderName: users.name,
      status: documentMessages.status,
      documentStatus: documents.status,
      docNumber: documents.docNumber,
      version: documentMessages.documentVersion,
      createdAt: documentMessages.createdAt,
      approvedAt: documentMessages.approvedAt,
      approvedById: documentMessages.approvedById,
      annulledAt: documentMessages.annulledAt,
      annulledReason: documentMessages.annulledReason,
      certificateSerial: signedSubquery(userId),
      signedAt: signedAtSubquery(userId),
    })
    .from(documentMessages)
    .innerJoin(documents, eq(documents.id, documentMessages.documentId))
    .innerJoin(users, eq(users.id, documentMessages.senderId))
    .innerJoin(
      documentMessageRecipients,
      eq(documentMessageRecipients.messageId, documentMessages.id),
    )
    .where(receivedFilter(userId, q))
    .orderBy(desc(documentMessages.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => toMobileDocument(row, false, userId));
}

async function countReceived(userId: string, q: string | undefined): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(documentMessages)
    .innerJoin(documents, eq(documents.id, documentMessages.documentId))
    .innerJoin(users, eq(users.id, documentMessages.senderId))
    .innerJoin(
      documentMessageRecipients,
      eq(documentMessageRecipients.messageId, documentMessages.id),
    )
    .where(receivedFilter(userId, q));

  return Number(row?.count ?? 0);
}

async function listPending(
  userId: string,
  isAdmin: boolean,
  q: string | undefined,
  limit: number,
  offset: number,
): Promise<MobileDocument[]> {
  if (!isAdmin) return [];

  const rows = await db
    .select({
      id: documentMessages.id,
      documentId: documents.id,
      title: documents.title,
      subject: documentMessages.subject,
      senderName: users.name,
      status: documentMessages.status,
      documentStatus: documents.status,
      docNumber: documents.docNumber,
      version: documentMessages.documentVersion,
      createdAt: documentMessages.createdAt,
      approvedAt: documentMessages.approvedAt,
      approvedById: documentMessages.approvedById,
      annulledAt: documentMessages.annulledAt,
      annulledReason: documentMessages.annulledReason,
      certificateSerial: signedSubquery(userId),
      signedAt: signedAtSubquery(userId),
    })
    .from(documentMessages)
    .innerJoin(documents, eq(documents.id, documentMessages.documentId))
    .innerJoin(users, eq(users.id, documentMessages.senderId))
    .where(pendingFilter(q))
    .orderBy(desc(documentMessages.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => toMobileDocument(row, true, userId));
}

async function countPending(isAdmin: boolean, q: string | undefined): Promise<number> {
  // Igual que `listPending`: un miembro sin rol de administrador no ve pendientes.
  if (!isAdmin) return 0;

  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(documentMessages)
    .innerJoin(documents, eq(documents.id, documentMessages.documentId))
    .innerJoin(users, eq(users.id, documentMessages.senderId))
    .where(pendingFilter(q));

  return Number(row?.count ?? 0);
}

async function listSent(
  userId: string,
  q: string | undefined,
  limit: number,
  offset: number,
): Promise<MobileDocument[]> {
  const rows = await db
    .select({
      id: documentMessages.id,
      documentId: documents.id,
      title: documents.title,
      subject: documentMessages.subject,
      senderName: users.name,
      status: documentMessages.status,
      documentStatus: documents.status,
      docNumber: documents.docNumber,
      version: documentMessages.documentVersion,
      createdAt: documentMessages.createdAt,
      approvedAt: documentMessages.approvedAt,
      approvedById: documentMessages.approvedById,
      annulledAt: documentMessages.annulledAt,
      annulledReason: documentMessages.annulledReason,
      certificateSerial: signedSubquery(userId),
      signedAt: signedAtSubquery(userId),
    })
    .from(documentMessages)
    .innerJoin(documents, eq(documents.id, documentMessages.documentId))
    .innerJoin(users, eq(users.id, documentMessages.senderId))
    .where(sentFilter(userId, q))
    .orderBy(desc(documentMessages.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => toMobileDocument(row, false, userId));
}

async function countSent(userId: string, q: string | undefined): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(documentMessages)
    .innerJoin(documents, eq(documents.id, documentMessages.documentId))
    .innerJoin(users, eq(users.id, documentMessages.senderId))
    .where(sentFilter(userId, q));

  return Number(row?.count ?? 0);
}

async function listNeedsSignature(
  userId: string,
  q: string | undefined,
  limit: number,
  offset: number,
): Promise<MobileDocument[]> {
  const rows = await db
    .select({
      id: documentMessages.id,
      documentId: documents.id,
      title: documents.title,
      subject: documentMessages.subject,
      senderName: users.name,
      status: documentMessages.status,
      documentStatus: documents.status,
      docNumber: documents.docNumber,
      version: documentMessages.documentVersion,
      createdAt: documentMessages.createdAt,
      approvedAt: documentMessages.approvedAt,
      approvedById: documentMessages.approvedById,
      annulledAt: documentMessages.annulledAt,
      annulledReason: documentMessages.annulledReason,
      certificateSerial: signedSubquery(userId),
      signedAt: signedAtSubquery(userId),
    })
    .from(documentMessages)
    .innerJoin(documents, eq(documents.id, documentMessages.documentId))
    .innerJoin(users, eq(users.id, documentMessages.senderId))
    .where(needsSignatureFilter(userId, q))
    .orderBy(desc(documentMessages.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map((row) => toMobileDocument(row, false, userId));
}

async function countNeedsSignature(userId: string, q: string | undefined): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(documentMessages)
    .innerJoin(documents, eq(documents.id, documentMessages.documentId))
    .innerJoin(users, eq(users.id, documentMessages.senderId))
    .where(needsSignatureFilter(userId, q));

  return Number(row?.count ?? 0);
}

async function listSigned(
  userId: string,
  q: string | undefined,
  limit: number,
  offset: number,
): Promise<MobileDocument[]> {
  const rows = await db
    .select({
      id: documentMessages.id,
      documentId: documents.id,
      title: documents.title,
      subject: documentMessages.subject,
      senderName: users.name,
      status: documentMessages.status,
      documentStatus: documents.status,
      docNumber: documents.docNumber,
      version: documentMessages.documentVersion,
      createdAt: documentMessages.createdAt,
      approvedAt: documentMessages.approvedAt,
      approvedById: documentMessages.approvedById,
      annulledAt: documentMessages.annulledAt,
      annulledReason: documentMessages.annulledReason,
      certificateSerial: signatureCertificates.serial,
      signedAt: documentSignatures.signedAt,
    })
    .from(documentSignatures)
    .innerJoin(documents, eq(documents.id, documentSignatures.documentId))
    .innerJoin(documentMessages, eq(documentMessages.id, documentSignatures.messageId))
    .innerJoin(users, eq(users.id, documentMessages.senderId))
    .innerJoin(
      signatureCertificates,
      eq(signatureCertificates.signatureId, documentSignatures.id),
    )
    .where(signedFilter(userId, q))
    .orderBy(desc(documentSignatures.signedAt))
    .limit(limit)
    .offset(offset);

  return rows.map((row) =>
    toMobileDocument(
      { ...row, signedAt: row.signedAt ?? null },
      false,
      userId,
    ),
  );
}

async function countSigned(userId: string, q: string | undefined): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(documentSignatures)
    .innerJoin(documents, eq(documents.id, documentSignatures.documentId))
    .innerJoin(documentMessages, eq(documentMessages.id, documentSignatures.messageId))
    .innerJoin(users, eq(users.id, documentMessages.senderId))
    .innerJoin(
      signatureCertificates,
      eq(signatureCertificates.signatureId, documentSignatures.id),
    )
    .where(signedFilter(userId, q));

  return Number(row?.count ?? 0);
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function mobileRoutes(app: FastifyInstance): Promise<void> {
  /** Resumen inicial para la app. */
  app.get('/mobile/bootstrap', async (request) => {
    const auth = await authenticate(request);
    const [row] = await db.select().from(users).where(eq(users.id, auth.sub)).limit(1);
    if (!row || !row.isActive) throw notFound('Usuario no encontrado');

    const [pendingRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(documentMessages)
      .where(eq(documentMessages.status, 'pending_approval'));

    const [signedRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(documentSignatures)
      .where(
        and(
          eq(documentSignatures.userId, auth.sub),
          eq(documentSignatures.status, 'sealed'),
        ),
      );

    const [sentRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(documentMessages)
      .where(
        or(
          eq(documentMessages.senderId, auth.sub),
          eq(documentMessages.approvedById, auth.sub),
        ),
      );

    return {
      user: toPublicUser(row),
      counts: {
        pending: auth.role === 'admin' ? Number(pendingRow?.count ?? 0) : 0,
        received: await countReceived(auth.sub, undefined),
        signed: Number(signedRow?.count ?? 0),
        sent: Number(sentRow?.count ?? 0),
      },
      capabilities: {
        signApproval: auth.role === 'admin',
        deviceBinding: true,
      },
      serverTime: new Date().toISOString(),
    };
  });

  /** Bandeja móvil: pendientes de aprobación, enviados y firmados. */
  app.get('/mobile/documents', async (request) => {
    const auth = await authenticate(request);
    const query = listQuery.parse(request.query);
    const limit = query.pageSize;
    const offset = (query.page - 1) * limit;
    const isAdmin = auth.role === 'admin';

    if (query.scope === 'pending') {
      const [items, total] = await Promise.all([
        listPending(auth.sub, isAdmin, query.q, limit, offset),
        countPending(isAdmin, query.q),
      ]);
      return { items, page: query.page, pageSize: limit, total };
    }
    if (query.scope === 'needs_signature') {
      const [items, total] = await Promise.all([
        listNeedsSignature(auth.sub, query.q, limit, offset),
        countNeedsSignature(auth.sub, query.q),
      ]);
      return { items, page: query.page, pageSize: limit, total };
    }
    if (query.scope === 'signed') {
      const [items, total] = await Promise.all([
        listSigned(auth.sub, query.q, limit, offset),
        countSigned(auth.sub, query.q),
      ]);
      return { items, page: query.page, pageSize: limit, total };
    }
    if (query.scope === 'received') {
      const [items, total] = await Promise.all([
        listReceived(auth.sub, query.q, limit, offset),
        countReceived(auth.sub, query.q),
      ]);
      return { items, page: query.page, pageSize: limit, total };
    }
    if (query.scope === 'sent') {
      const [items, total] = await Promise.all([
        listSent(auth.sub, query.q, limit, offset),
        countSent(auth.sub, query.q),
      ]);
      return { items, page: query.page, pageSize: limit, total };
    }

    // «Todos» concatena pendientes, recibidos y enviados. La ventana se
    // reparte en ese orden para que las páginas numeradas cuadren.
    const [pendingTotal, receivedTotal, sentTotal] = await Promise.all([
      countPending(isAdmin, query.q),
      countReceived(auth.sub, query.q),
      countSent(auth.sub, query.q),
    ]);
    const pendingOffset = Math.min(offset, pendingTotal);
    const pendingLimit = Math.min(limit, Math.max(0, pendingTotal - pendingOffset));
    const receivedOffset = Math.max(0, offset - pendingTotal);
    const receivedLimit = Math.min(limit - pendingLimit, Math.max(0, receivedTotal - receivedOffset));
    const sentOffset = Math.max(0, offset - pendingTotal - receivedTotal);
    const sentLimit = limit - pendingLimit - receivedLimit;

    const [pending, received, sent] = await Promise.all([
      pendingLimit > 0
        ? listPending(auth.sub, isAdmin, query.q, pendingLimit, pendingOffset)
        : Promise.resolve([] as MobileDocument[]),
      receivedLimit > 0
        ? listReceived(auth.sub, query.q, receivedLimit, receivedOffset)
        : Promise.resolve([] as MobileDocument[]),
      sentLimit > 0
        ? listSent(auth.sub, query.q, sentLimit, sentOffset)
        : Promise.resolve([] as MobileDocument[]),
    ]);

    const seen = new Set<string>();
    const items = [...pending, ...received, ...sent].filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });

    return {
      items,
      page: query.page,
      pageSize: limit,
      total: pendingTotal + receivedTotal + sentTotal,
    };
  });

  /** Dispositivos vinculados. */
  app.get('/mobile/devices', async (request) => {
    const auth = await authenticate(request);
    const rows = await db
      .select({
        id: mobileDevices.id,
        deviceId: mobileDevices.deviceId,
        model: mobileDevices.model,
        platform: mobileDevices.platform,
        appVersion: mobileDevices.appVersion,
        status: mobileDevices.status,
        createdAt: mobileDevices.createdAt,
        lastSeenAt: mobileDevices.lastSeenAt,
        revokedAt: mobileDevices.revokedAt,
      })
      .from(mobileDevices)
      .where(eq(mobileDevices.userId, auth.sub))
      .orderBy(desc(mobileDevices.createdAt));

    return {
      items: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
        revokedAt: row.revokedAt?.toISOString() ?? null,
      })),
    };
  });

  app.post('/mobile/devices', async (request) => {
    const auth = await authenticate(request);
    const body = deviceSchema.parse(request.body);

    let key: ReturnType<typeof createPublicKey>;
    try {
      key = createPublicKey(body.publicKey);
    } catch {
      throw badRequest('La clave pública del dispositivo no es válida');
    }
    if (key.asymmetricKeyType !== 'ec') {
      throw badRequest('La clave del dispositivo debe ser EC P-256');
    }
    const curve = key.asymmetricKeyDetails?.namedCurve;
    if (curve && !['prime256v1', 'secp256r1'].includes(curve)) {
      throw badRequest('La clave del dispositivo debe usar la curva P-256');
    }

    const [device] = await db
      .insert(mobileDevices)
      .values({
        userId: auth.sub,
        deviceId: body.deviceId,
        publicKey: body.publicKey,
        algorithm: body.algorithm,
        platform: body.platform,
        model: body.model,
        appVersion: body.appVersion,
        status: 'active',
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [mobileDevices.userId, mobileDevices.deviceId],
        set: {
          publicKey: body.publicKey,
          algorithm: body.algorithm,
          platform: body.platform,
          model: body.model,
          appVersion: body.appVersion,
          status: 'active',
          revokedAt: null,
          lastSeenAt: new Date(),
        },
      })
      .returning();

    if (!device) throw internal('DEVICE_REGISTER_FAILED', 'No se pudo registrar el dispositivo');

    return {
      device: {
        id: device.id,
        deviceId: device.deviceId,
        status: device.status,
        createdAt: device.createdAt.toISOString(),
      },
    };
  });

  app.delete('/mobile/devices/:id', async (request) => {
    const auth = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);

    const [device] = await db
      .select()
      .from(mobileDevices)
      .where(and(eq(mobileDevices.id, id), eq(mobileDevices.userId, auth.sub)))
      .limit(1);

    if (!device) throw notFound('Dispositivo no encontrado');

    const now = new Date();
    await db
      .update(mobileDevices)
      .set({ status: 'revoked', revokedAt: now })
      .where(eq(mobileDevices.id, id));

    await db
      .update(refreshTokens)
      .set({ revokedAt: now })
      .where(
        and(
          eq(refreshTokens.userId, device.userId),
          eq(refreshTokens.deviceId, device.deviceId),
          isNull(refreshTokens.revokedAt),
        ),
      );

    await publishRealtimeEvent({
      type: 'mobile.device.revoked',
      userIds: [device.userId],
      payload: { deviceId: device.deviceId },
      ts: now.toISOString(),
    });

    return { ok: true, id };
  });

  /** PDF del documento para el visor. `sealed=1` devuelve la copia firmada. */
  app.get('/documents/:id/pdf', async (request, reply) => {
    const auth = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const query = z.object({ sealed: z.enum(['0', '1']).default('0') }).parse(request.query);

    const { document } = await assertDocument(auth.sub, id, 'viewer');
    if (!(await canExportDocument(auth.sub, auth.role, document))) {
      throw forbidden('No tienes permiso para descargar este PDF');
    }

    if (query.sealed === '1') {
      const [sealed] = await db
        .select({
          signatureId: documentSignatures.id,
          path: signatureCertificates.sealedPdfPath,
        })
        .from(documentSignatures)
        .innerJoin(
          signatureCertificates,
          eq(signatureCertificates.signatureId, documentSignatures.id),
        )
        .where(
          and(
            eq(documentSignatures.documentId, id),
            eq(documentSignatures.userId, auth.sub),
            eq(documentSignatures.status, 'sealed'),
          ),
        )
        .orderBy(desc(documentSignatures.signedAt))
        .limit(1);

      if (sealed) {
        try {
          const pdf = await readFile(sealed.path);
          return reply
            .header('Content-Type', 'application/pdf')
            .header('Content-Disposition', 'inline; filename="documento-firmado.pdf"')
            .send(pdf);
        } catch {
          throw notFound('El PDF firmado no está disponible');
        }
      }
    }

    const pdf = await renderDocumentPdf(document);
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', 'inline; filename="documento.pdf"')
      .send(pdf);
  });

  /** Devuelve el documento al asistente. Decisión exclusiva de la app. */
  app.post('/mobile/inbox/:id/reject', async (request) => {
    const auth = await requireAdmin(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = rejectSchema.parse(request.body);
    return rejectMessage({
      user: auth,
      messageId: id,
      reason: body.reason,
      allowEdit: body.allowEdit,
    });
  });

  /** Anula un memo aprobado. Exige código de SirpefOffice Token. */
  app.post('/mobile/inbox/:id/annul', async (request) => {
    const auth = await requireAdmin(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = annulSchema.parse(request.body);
    return annulMessage({
      user: auth,
      messageId: id,
      expectedVersion: body.expectedVersion,
      reason: body.reason ?? null,
      code: body.code,
    });
  });

  /** Crea el desafío para firmar un envío pendiente. */
  app.post('/documents/:id/sign-challenge', async (request) => {
    const auth = await requireAdmin(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = challengeSchema.parse(request.body);
    return createSignatureChallenge({
      user: auth,
      documentId: id,
      messageId: body.messageId,
    });
  });

  /**
   * Aprueba, numera, firma y emite el certificado en una sola transacción.
   * Si cualquier paso falla, el envío sigue pendiente y puede reintentarse.
   */
  app.post('/inbox/:id/approve-and-sign', async (request) => {
    const auth = await requireAdmin(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = approveAndSignSchema.parse(request.body);
    const deviceId = request.headers['x-device-id'];
    if (typeof deviceId !== 'string' || !deviceId) {
      throw badRequest('Falta el identificador del dispositivo (X-Device-Id)');
    }

    const result = await approveAndSeal({
      user: auth,
      messageId: id,
      expectedVersion: body.expectedVersion,
      subject: body.subject,
      body: body.body,
      allowSenderExport: body.allowSenderExport,
      challengeId: body.challengeId,
      deviceId,
      signaturePng: body.signaturePng,
      strokes: body.strokes,
      method: body.method,
      deviceAssertion: body.deviceAssertion,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });

    await publishSignatureEvent({
      userId: auth.sub,
      userName: auth.name,
      messageId: id,
      documentId: result.documentId,
      documentTitle: result.subject,
      subject: result.subject,
      certificate: result.sealed.certificate,
    });

    return {
      ok: true,
      id,
      status: 'sent',
      docNumber: result.docNumber,
      approved: true,
      signed: true,
      signatureId: result.sealed.signatureId,
      certificate: result.sealed.certificate,
    };
  });

  /** Reintenta la firma de un envío ya aprobado. */
  app.post('/documents/:id/sign', async (request) => {
    const auth = await requireAdmin(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = signSchema.parse(request.body);
    const deviceId = request.headers['x-device-id'];
    if (typeof deviceId !== 'string' || !deviceId) {
      throw badRequest('Falta el identificador del dispositivo (X-Device-Id)');
    }

    const [document] = await db
      .select()
      .from(documents)
      .where(eq(documents.id, id))
      .limit(1);
    if (!document || document.deletedAt) throw notFound('Documento no encontrado');
    if (document.status !== 'sent' || !document.lockedAt) {
      throw conflict('El documento todavía no está aprobado y sellado');
    }

    await assertSignatureAuthorization({
      user: auth,
      documentId: id,
      messageId: body.messageId,
      challengeId: body.challengeId,
      deviceId,
    });

    const sealed = await sealSignature({
      user: auth,
      documentId: id,
      messageId: body.messageId,
      challengeId: body.challengeId,
      deviceId,
      signaturePng: body.signaturePng,
      strokes: body.strokes,
      method: body.method,
      deviceAssertion: body.deviceAssertion,
      ip: request.ip,
      userAgent: request.headers['user-agent'] ?? null,
    });

    await publishSignatureEvent({
      userId: auth.sub,
      userName: auth.name,
      messageId: body.messageId,
      documentId: id,
      documentTitle: document.title,
      subject: document.title,
      certificate: sealed.certificate,
    });

    return {
      ok: true,
      documentId: id,
      signatureId: sealed.signatureId,
      certificate: sealed.certificate,
    };
  });

  /** Certificado JSON del usuario para un documento. */
  app.get('/documents/:id/certificate', async (request) => {
    const auth = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    await assertDocument(auth.sub, id, 'viewer');

    const [certificate] = await db
      .select(certificateSelect)
      .from(signatureCertificates)
      .innerJoin(
        documentSignatures,
        eq(documentSignatures.id, signatureCertificates.signatureId),
      )
      .where(
        and(
          eq(signatureCertificates.documentId, id),
          eq(documentSignatures.userId, auth.sub),
          eq(documentSignatures.status, 'sealed'),
        ),
      )
      .orderBy(desc(signatureCertificates.issuedAt))
      .limit(1);

    if (!certificate) throw notFound('Este documento no tiene un certificado de firma');

    return {
      certificate: certificate.certJson,
      signaturePng: certificate.signaturePng,
      issuedAt: certificate.issuedAt.toISOString(),
      sealedPdfSha256: certificate.sealedPdfSha256,
    };
  });

  /** Descarga el certificado PDF. */
  app.get('/documents/:id/certificate.pdf', async (request, reply) => {
    const auth = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    await assertDocument(auth.sub, id, 'viewer');

    const [certificate] = await db
      .select({
        path: signatureCertificates.certificatePdfPath,
      })
      .from(signatureCertificates)
      .innerJoin(
        documentSignatures,
        eq(documentSignatures.id, signatureCertificates.signatureId),
      )
      .where(
        and(
          eq(signatureCertificates.documentId, id),
          eq(documentSignatures.userId, auth.sub),
          eq(documentSignatures.status, 'sealed'),
        ),
      )
      .orderBy(desc(signatureCertificates.issuedAt))
      .limit(1);

    if (!certificate) throw notFound('Este documento no tiene un certificado de firma');

    try {
      const pdf = await readFile(certificate.path);
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', 'attachment; filename="certificado-firma.pdf"')
        .send(pdf);
    } catch {
      throw notFound('El certificado PDF no está disponible');
    }
  });

  /** Verificación pública del QR. No revela el contenido del documento. */
  app.get(
    '/verify/:token',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const { token } = z.object({ token: z.string().min(10).max(200) }).parse(request.params);
      const [row] = await db
        .select({
          certJson: signatureCertificates.certJson,
          serial: signatureCertificates.serial,
          issuedAt: signatureCertificates.issuedAt,
          sealedPdfSha256: signatureCertificates.sealedPdfSha256,
          supersededAt: signatureCertificates.supersededAt,
          supersededReason: signatureCertificates.supersededReason,
        })
        .from(signatureCertificates)
        .where(eq(signatureCertificates.verificationTokenHash, sha256Hex(token)))
        .limit(1);

      if (!row) {
        if ((request.headers.accept ?? '').includes('text/html')) {
          return reply
            .code(404)
            .type('text/html; charset=utf-8')
            .send('<!doctype html><meta charset="utf-8"><h1>Certificado no encontrado</h1>');
        }
        throw notFound('Certificado no encontrado');
      }

      if (row.supersededAt) {
        if (!(request.headers.accept ?? '').includes('text/html')) {
          return {
            valid: false,
            superseded: true,
            serial: row.serial,
            supersededAt: row.supersededAt.toISOString(),
            reason:
              row.supersededReason ??
              'Este certificado fue reemplazado por una revisión de emergencia.',
          };
        }
        return reply
          .type('text/html; charset=utf-8')
          .send(
            `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Certificado supersedido</title></head><body style="font-family:system-ui;background:#f4f6fa;padding:24px"><main style="max-width:620px;margin:auto;background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:24px"><span style="background:#fef3c7;color:#92400e;border-radius:8px;padding:4px 8px;font-size:12px;font-weight:700">CERTIFICADO REEMPLAZADO</span><h1 style="font-size:18px">Certificado ${escapeHtml(row.serial)}</h1><p>${escapeHtml(row.supersededReason ?? 'Fue reemplazado por una revisión de emergencia.')}</p><p style="color:#64748b;font-size:12px">${escapeHtml(row.supersededAt.toISOString())}</p></main></body></html>`,
          );
      }

      const cert = row.certJson as Record<string, unknown>;
      const signature = { ...((cert.signature ?? {}) as Record<string, unknown>) };
      // La IP es un dato de auditoría interno: no se publica en el QR.
      delete signature.ip;
      const publicCert = { ...cert, signature };

      if (!(request.headers.accept ?? '').includes('text/html')) {
        return {
          valid: true,
          certificate: publicCert,
          serial: row.serial,
          issuedAt: row.issuedAt.toISOString(),
          sealedPdfSha256: row.sealedPdfSha256,
        };
      }

      const document = (cert.document ?? {}) as Record<string, unknown>;
      const signer = (cert.signer ?? {}) as Record<string, unknown>;
      const html = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verificación de firma ${escapeHtml(row.serial)}</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f4f6fa;color:#0f172a;margin:0;padding:24px}
main{max-width:620px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:24px}
h1{font-size:18px;margin:0 0 4px}small{color:#64748b}.ok{display:inline-block;background:#dcfce7;color:#15803d;border-radius:8px;padding:4px 8px;font-size:12px;font-weight:700}
.row{display:flex;justify-content:space-between;gap:12px;border-top:1px solid #eef2f7;padding:10px 0;font-size:14px}
.label{color:#64748b}.mono{font-family:ui-monospace,Menlo,monospace;font-size:10px;word-break:break-all}
</style></head><body><main>
<span class="ok">CERTIFICADO VÁLIDO</span>
<h1>${escapeHtml(document.title ?? 'Documento firmado')}</h1>
<small>Serie ${escapeHtml(row.serial)} · ${escapeHtml(row.issuedAt.toISOString())}</small>
<div class="row"><span class="label">Firmante</span><strong>${escapeHtml(signer.name)}</strong></div>
<div class="row"><span class="label">Cédula</span><span>${escapeHtml(signer.cedula ?? 'No registrada')}</span></div>
<div class="row"><span class="label">Documento</span><span>${escapeHtml(document.docNumber ?? 'Sin número')}</span></div>
<div class="row"><span class="label">Método</span><span>${escapeHtml(signature.method === 'typed' ? 'Firma tipográfica' : 'Trazo táctil')}</span></div>
<div class="row"><span class="label">SHA-256 del contenido</span></div>
<p class="mono">${escapeHtml(signature.contentSha256)}</p>
<div class="row"><span class="label">SHA-256 del PDF sellado</span></div>
<p class="mono">${escapeHtml(row.sealedPdfSha256)}</p>
<p class="label" style="font-size:11px;margin-top:16px">Constancia de firma electrónica simple auditada. La validez jurídica depende del marco legal aplicable.</p>
</main></body></html>`;
      return reply.type('text/html; charset=utf-8').send(html);
    },
  );
}


