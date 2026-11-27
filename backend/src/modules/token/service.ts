import { and, eq, gt, inArray, isNull, sql } from 'drizzle-orm';

import { db } from '../../db/index.js';
import {
  documents,
  mobileDevices,
  signatureChallenges,
  totpCredentials,
  totpDeviceChallenges,
  totpPairingCodes,
  totpRecoveryCodes,
  users,
  type MobileDeviceRow,
  type SignatureChallengeRow,
  type TotpCredentialRow,
} from '../../db/schema.js';
import { env } from '../../env.js';
import { logActivity } from '../../lib/activity.js';
import type { AuthenticatedUser } from '../../lib/auth-guard.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import {
  buildSigningPayload,
  canonicalContentHash,
  verifyDeviceAssertion,
} from '../../lib/signature.js';
import {
  activeTotpKeyId,
  buildTotpDevicePayload,
  decryptTotpSecret,
  defaultTotpParams,
  encryptTotpSecret,
  generateTotpSecret,
  hashDeviceNonce,
  hashHumanCode,
  newDeviceNonce,
  newPairingCode,
  normalizeHumanCode,
  otpauthUrl,
  verifyTotpCode,
} from '../../lib/totp.js';
import {
  newWordRecoveryCode,
  recoveryCodeHashes,
} from '../../lib/recovery-words.js';

const DEVICE_CHALLENGE_TTL_SECONDS = 180;

export interface TotpStatus {
  paired: boolean;
  account: string;
  issuer: string;
  digits: number;
  period: number;
  algorithm: string;
  secretUpdatedAt: string | null;
  pairedDeviceId: string | null;
  pairedDeviceLabel: string | null;
  pairedAt: string | null;
  requiredForSigning: boolean;
  serverTime: string;
}

async function findCredential(userId: string): Promise<TotpCredentialRow | null> {
  const [row] = await db
    .select()
    .from(totpCredentials)
    .where(eq(totpCredentials.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function totpStatus(user: AuthenticatedUser): Promise<TotpStatus> {
  const [credential, dbUser] = await Promise.all([
    findCredential(user.sub),
    db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, user.sub))
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  const params = defaultTotpParams();
  return {
    paired: Boolean(credential),
    account: dbUser?.email ?? user.email,
    issuer: env.TOTP_ISSUER,
    digits: credential?.digits ?? params.digits,
    period: credential?.period ?? params.period,
    algorithm: credential?.algorithm ?? params.algorithm,
    secretUpdatedAt: credential?.secretUpdatedAt.toISOString() ?? null,
    pairedDeviceId: credential?.pairedDeviceId ?? null,
    pairedDeviceLabel: credential?.pairedDeviceLabel ?? null,
    pairedAt: credential?.pairedAt.toISOString() ?? null,
    requiredForSigning: env.TOTP_REQUIRED_FOR_SIGNING,
    serverTime: new Date().toISOString(),
  };
}

async function activeDevice(userId: string, deviceId: string): Promise<MobileDeviceRow> {
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
    throw new AppError(403, 'TOTP_DEVICE_MISMATCH', 'Este dispositivo no está vinculado o fue revocado');
  }
  return device;
}

export async function createDeviceChallenge(input: {
  user: AuthenticatedUser;
  deviceId: string;
  purpose: 'pairing' | 'recovery';
}): Promise<{ nonce: string; expiresAt: string }> {
  const device = await activeDevice(input.user.sub, input.deviceId);
  const nonce = newDeviceNonce();
  const expiresAt = new Date(Date.now() + DEVICE_CHALLENGE_TTL_SECONDS * 1000);

  await db.insert(totpDeviceChallenges).values({
    userId: input.user.sub,
    deviceId: device.id,
    purpose: input.purpose,
    nonceHash: hashDeviceNonce(nonce),
    expiresAt,
  });

  return { nonce, expiresAt: expiresAt.toISOString() };
}

async function consumeDeviceChallenge(input: {
  user: AuthenticatedUser;
  deviceId: string;
  purpose: 'pairing' | 'recovery';
  nonce: string;
}): Promise<MobileDeviceRow> {
  const device = await activeDevice(input.user.sub, input.deviceId);
  const [challenge] = await db
    .select()
    .from(totpDeviceChallenges)
    .where(
      and(
        eq(totpDeviceChallenges.userId, input.user.sub),
        eq(totpDeviceChallenges.purpose, input.purpose),
        eq(totpDeviceChallenges.nonceHash, hashDeviceNonce(input.nonce)),
        isNull(totpDeviceChallenges.usedAt),
        gt(totpDeviceChallenges.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!challenge || challenge.deviceId !== device.id) {
    throw new AppError(403, 'TOTP_PAIRING_INVALID', 'El desafío de vinculación expiró o no es válido');
  }

  const [claimed] = await db
    .update(totpDeviceChallenges)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(totpDeviceChallenges.id, challenge.id),
        isNull(totpDeviceChallenges.usedAt),
        gt(totpDeviceChallenges.expiresAt, new Date()),
      ),
    )
    .returning();

  if (!claimed) {
    throw new AppError(403, 'TOTP_PAIRING_INVALID', 'El desafío de vinculación ya fue utilizado');
  }
  return device;
}

export async function createPairingCode(input: {
  user: AuthenticatedUser;
  deviceId: string;
  nonce: string;
  deviceAssertion: string;
}): Promise<{ code: string; expiresAt: string }> {
  const device = await consumeDeviceChallenge({
    user: input.user,
    deviceId: input.deviceId,
    purpose: 'pairing',
    nonce: input.nonce,
  });

  const payload = buildTotpDevicePayload({ purpose: 'pairing', nonce: input.nonce });
  if (!verifyDeviceAssertion({ publicKeyPem: device.publicKey, payload, signatureBase64: input.deviceAssertion })) {
    throw forbidden('No se pudo verificar la firma del dispositivo para vincular Token');
  }

  await db
    .update(totpPairingCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(totpPairingCodes.userId, input.user.sub), isNull(totpPairingCodes.usedAt)));

  const code = newPairingCode();
  const expiresAt = new Date(Date.now() + env.TOTP_PAIRING_TTL_SECONDS * 1000);
  await db.insert(totpPairingCodes).values({
    userId: input.user.sub,
    codeHash: hashHumanCode(code, 'pairing', input.user.sub),
    createdByDeviceId: device.id,
    expiresAt,
  });

  await logActivity(input.user.sub, 'user', input.user.sub, 'totp.pairing_code_created', {
    expiresAt: expiresAt.toISOString(),
  });

  return { code, expiresAt: expiresAt.toISOString() };
}

export async function createRecoveryCodes(input: {
  user: AuthenticatedUser;
  deviceId: string;
  nonce: string;
  deviceAssertion: string;
}): Promise<{ codes: string[]; generatedAt: string }> {
  const device = await consumeDeviceChallenge({
    user: input.user,
    deviceId: input.deviceId,
    purpose: 'recovery',
    nonce: input.nonce,
  });

  const payload = buildTotpDevicePayload({ purpose: 'recovery', nonce: input.nonce });
  if (!verifyDeviceAssertion({ publicKeyPem: device.publicKey, payload, signatureBase64: input.deviceAssertion })) {
    throw forbidden('No se pudo verificar la firma del dispositivo para generar códigos');
  }

  await db.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, input.user.sub));

  const codes = Array.from(
    { length: env.TOTP_RECOVERY_CODE_COUNT },
    () => newWordRecoveryCode(),
  );
  await db.insert(totpRecoveryCodes).values(
    codes.map((code) => ({
      userId: input.user.sub,
      codeHash: hashHumanCode(code, 'recovery', input.user.sub),
    })),
  );

  await logActivity(input.user.sub, 'user', input.user.sub, 'totp.recovery_codes_created', {
    count: codes.length,
  });

  return { codes, generatedAt: new Date().toISOString() };
}

export interface PairInput {
  user: AuthenticatedUser;
  mode: 'pairing' | 'recovery';
  code: string;
  deviceId: string;
  deviceLabel?: string;
  replace?: boolean;
}

export async function pairToken(input: PairInput): Promise<{
  secret: string;
  secretUpdatedAt: string;
  status: TotpStatus;
}> {
  const normalized = normalizeHumanCode(input.code);
  if (!normalized) {
    throw new AppError(400, 'TOTP_PAIRING_INVALID', 'Escribe el código de vinculación');
  }

  const existing = await findCredential(input.user.sub);
  if (existing && !input.replace) {
    throw new AppError(
      409,
      'TOTP_ALREADY_PAIRED',
      'Ya hay un teléfono Token vinculado. Confirma que deseas reemplazarlo.',
      { pairedDeviceLabel: existing.pairedDeviceLabel },
    );
  }

  if (input.mode === 'pairing') {
    const [row] = await db
      .select()
      .from(totpPairingCodes)
      .where(
        and(
          eq(totpPairingCodes.userId, input.user.sub),
          eq(totpPairingCodes.codeHash, hashHumanCode(normalized, 'pairing', input.user.sub)),
          isNull(totpPairingCodes.usedAt),
          gt(totpPairingCodes.expiresAt, new Date()),
        ),
      )
      .limit(1);

    if (!row) {
      throw new AppError(403, 'TOTP_PAIRING_INVALID', 'El código de vinculación no es válido o expiró');
    }
    if (row.attempts >= env.TOTP_MAX_ATTEMPTS) {
      throw new AppError(429, 'TOTP_LOCKED', 'Demasiados intentos. Genera un código nuevo.');
    }

    await db
      .update(totpPairingCodes)
      .set({ usedAt: new Date() })
      .where(eq(totpPairingCodes.id, row.id));
  } else {
    const [row] = await db
      .select()
      .from(totpRecoveryCodes)
      .where(
        and(
          eq(totpRecoveryCodes.userId, input.user.sub),
          inArray(
            totpRecoveryCodes.codeHash,
            recoveryCodeHashes(input.code, input.user.sub),
          ),
          isNull(totpRecoveryCodes.usedAt),
        ),
      )
      .limit(1);

    if (!row) {
      throw new AppError(403, 'TOTP_RECOVERY_INVALID', 'El código de recuperación no es válido o ya fue usado');
    }

    await db
      .update(totpRecoveryCodes)
      .set({ usedAt: new Date() })
      .where(eq(totpRecoveryCodes.id, row.id));
  }

  const secret = generateTotpSecret();
  const encrypted = encryptTotpSecret({ userId: input.user.sub, secret });
  const now = new Date();
  const deviceLabel = input.deviceLabel?.trim().slice(0, 120) || 'Teléfono Token';

  await db
    .insert(totpCredentials)
    .values({
      userId: input.user.sub,
      secretEncrypted: encrypted.encrypted,
      keyId: encrypted.keyId,
      pairedDeviceId: input.deviceId,
      pairedDeviceLabel: deviceLabel,
      lastUsedStep: null,
      secretUpdatedAt: now,
      pairedAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: totpCredentials.userId,
      set: {
        secretEncrypted: encrypted.encrypted,
        keyId: encrypted.keyId,
        pairedDeviceId: input.deviceId,
        pairedDeviceLabel: deviceLabel,
        lastUsedStep: null,
        secretUpdatedAt: now,
        pairedAt: now,
        updatedAt: now,
      },
    });

  await logActivity(input.user.sub, 'user', input.user.sub, 'totp.paired', {
    mode: input.mode,
    replaced: Boolean(existing),
    deviceLabel,
  });

  return {
    secret,
    secretUpdatedAt: now.toISOString(),
    status: await totpStatus(input.user),
  };
}

export async function resetTotpSecret(input: {
  user: AuthenticatedUser;
  deviceId?: string;
  deviceLabel?: string;
}): Promise<{ secret: string; secretUpdatedAt: string }> {
  const credential = await findCredential(input.user.sub);
  if (!credential) {
    throw new AppError(404, 'TOTP_NOT_PAIRED', 'Todavía no hay un SirpefOffice Token vinculado');
  }
  if (!input.deviceId || input.deviceId !== credential.pairedDeviceId) {
    throw new AppError(
      403,
      'TOTP_DEVICE_MISMATCH',
      'Solo el teléfono Token vinculado puede restablecer el secreto.',
    );
  }

  const secret = generateTotpSecret();
  const encrypted = encryptTotpSecret({ userId: input.user.sub, secret });
  const now = new Date();

  await db
    .update(totpCredentials)
    .set({
      secretEncrypted: encrypted.encrypted,
      keyId: encrypted.keyId,
      lastUsedStep: null,
      secretUpdatedAt: now,
      updatedAt: now,
      ...(input.deviceId ? { pairedDeviceId: input.deviceId } : {}),
      ...(input.deviceLabel ? { pairedDeviceLabel: input.deviceLabel.slice(0, 120) } : {}),
    })
    .where(eq(totpCredentials.userId, input.user.sub));

  await logActivity(input.user.sub, 'user', input.user.sub, 'totp.reset');
  return { secret, secretUpdatedAt: now.toISOString() };
}

export async function unpairTotp(
  user: AuthenticatedUser,
  deviceId: string,
): Promise<{ ok: true }> {
  const credential = await findCredential(user.sub);
  if (credential && credential.pairedDeviceId !== deviceId) {
    throw new AppError(
      403,
      'TOTP_DEVICE_MISMATCH',
      'Solo el teléfono Token vinculado puede desvincularse.',
    );
  }
  await db.delete(totpCredentials).where(eq(totpCredentials.userId, user.sub));
  await db.delete(totpPairingCodes).where(eq(totpPairingCodes.userId, user.sub));
  await db.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, user.sub));
  await logActivity(user.sub, 'user', user.sub, 'totp.unpaired');
  return { ok: true };
}

async function consumeTotpStep(input: {
  userId: string;
  credential: TotpCredentialRow;
  step: number;
}): Promise<void> {
  const [updated] = await db
    .update(totpCredentials)
    .set({ lastUsedStep: input.step, updatedAt: new Date() })
    .where(
      and(
        eq(totpCredentials.userId, input.userId),
        sql`(${totpCredentials.lastUsedStep} is null or ${totpCredentials.lastUsedStep} < ${input.step})`,
      ),
    )
    .returning({ id: totpCredentials.id });

  if (!updated) {
    throw new AppError(
      409,
      'TOTP_REPLAY',
      'Ese código ya fue usado. Espera al siguiente código de SirpefOffice Token.',
    );
  }
}

/** Verifica un código TOTP para una acción sensible (p. ej. edición de emergencia). */
export async function verifyUserTotp(input: {
  userId: string;
  code: string;
  purpose: string;
}): Promise<{ step: number }> {
  const credential = await findCredential(input.userId);
  if (!credential) {
    throw new AppError(
      403,
      'TOTP_NOT_PAIRED',
      'Configura SirpefOffice Token antes de usar esta acción.',
    );
  }

  const { secret } = decryptTotpSecret({
    userId: input.userId,
    encrypted: credential.secretEncrypted,
    keyId: credential.keyId,
  });

  const verification = verifyTotpCode({
    secret,
    code: input.code,
    lastUsedStep: credential.lastUsedStep,
    digits: credential.digits,
    period: credential.period,
  });

  if (!verification.valid) {
    throw new AppError(
      verification.reason === 'replay' ? 409 : 400,
      verification.reason === 'replay' ? 'TOTP_REPLAY' : 'TOTP_INVALID',
      verification.reason === 'replay'
        ? 'Ese código ya fue usado. Espera al siguiente código de SirpefOffice Token.'
        : 'El código de SirpefOffice Token no es válido o expiró.',
    );
  }

  await consumeTotpStep({
    userId: input.userId,
    credential,
    step: verification.step!,
  });

  await logActivity(input.userId, 'user', input.userId, 'totp.verified', {
    purpose: input.purpose,
    step: verification.step,
  });

  return { step: verification.step! };
}

export async function authorizeSignature(input: {
  user: AuthenticatedUser;
  documentId: string;
  messageId: string;
  challengeId: string;
  code: string;
  signatureSha256: string;
  deviceAssertion: string;
  deviceId: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<{
  authorized: true;
  challengeId: string;
  expiresAt: string;
  step: number | null;
  serverTime: string;
}> {
  const [challenge] = await db
    .select()
    .from(signatureChallenges)
    .where(eq(signatureChallenges.id, input.challengeId))
    .limit(1);

  if (!challenge) throw notFound('Desafío de firma no encontrado');
  if (challenge.userId !== input.user.sub) throw forbidden('El desafío pertenece a otro usuario');
  if (challenge.documentId !== input.documentId || challenge.messageId !== input.messageId) {
    throw badRequest('El desafío no corresponde a este documento');
  }
  if (challenge.usedAt) throw conflict('Este desafío ya fue utilizado');
  if (challenge.expiresAt.getTime() <= Date.now()) {
    throw conflict('El desafío de firma expiró; vuelve a firmar');
  }

  const [document] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, input.documentId))
    .limit(1);
  if (!document || document.deletedAt) throw notFound('Documento no encontrado');
  if (challenge.version !== document.version) {
    throw conflict('El documento cambió después de crear el desafío', {
      currentVersion: document.version,
    });
  }
  const currentHash = canonicalContentHash(document);
  if (currentHash !== challenge.contentSha256) {
    throw conflict('El contenido del documento cambió; vuelve a revisarlo y firma de nuevo');
  }

  const device = await activeDevice(input.user.sub, input.deviceId);

  const payload = buildSigningPayload({
    challengeId: challenge.id,
    documentId: document.id,
    messageId: input.messageId,
    version: challenge.version,
    contentSha256: challenge.contentSha256,
    signatureSha256: input.signatureSha256,
  });
  if (!verifyDeviceAssertion({ publicKeyPem: device.publicKey, payload, signatureBase64: input.deviceAssertion })) {
    throw forbidden('No se pudo verificar la firma del dispositivo. Vuelve a autenticarte.');
  }

  // Si el desafío ya fue autorizado, la llamada es idempotente.
  if (challenge.totpVerifiedAt) {
    return {
      authorized: true,
      challengeId: challenge.id,
      expiresAt: challenge.expiresAt.toISOString(),
      step: challenge.totpStep,
      serverTime: new Date().toISOString(),
    };
  }

  const credential = await findCredential(input.user.sub);
  if (!credential) {
    throw new AppError(
      403,
      'TOTP_NOT_PAIRED',
      'Configura SirpefOffice Token antes de firmar. Abre la app Token y vincúlala desde Seguridad.',
    );
  }

  const { secret } = decryptTotpSecret({
    userId: input.user.sub,
    encrypted: credential.secretEncrypted,
    keyId: credential.keyId,
  });

  const verification = verifyTotpCode({
    secret,
    code: input.code,
    lastUsedStep: credential.lastUsedStep,
    digits: credential.digits,
    period: credential.period,
  });

  if (!verification.valid) {
    const [attemptRow] = await db
      .update(signatureChallenges)
      .set({ totpAttempts: sql`${signatureChallenges.totpAttempts} + 1` })
      .where(eq(signatureChallenges.id, challenge.id))
      .returning({ attempts: signatureChallenges.totpAttempts });

    const attempts = attemptRow?.attempts ?? challenge.totpAttempts + 1;
    if (attempts >= env.TOTP_MAX_ATTEMPTS) {
      await logActivity(input.user.sub, 'document', document.id, 'totp.locked', {
        challengeId: challenge.id,
        attempts,
      });
      throw new AppError(
        429,
        'TOTP_LOCKED',
        'Demasiados intentos con el código. Vuelve a abrir el documento y firma de nuevo.',
        { attempts },
      );
    }

    await logActivity(input.user.sub, 'document', document.id, 'totp.failed', {
      challengeId: challenge.id,
      reason: verification.reason ?? 'invalid',
      attempts,
    });
    if (verification.reason === 'replay') {
      throw new AppError(
        409,
        'TOTP_REPLAY',
        'Ese código ya fue usado. Espera al siguiente código de SirpefOffice Token.',
        { attempts, remainingAttempts: Math.max(0, env.TOTP_MAX_ATTEMPTS - attempts) },
      );
    }
    throw new AppError(
      400,
      'TOTP_INVALID',
      'El código de SirpefOffice Token no es válido o expiró.',
      { attempts, remainingAttempts: Math.max(0, env.TOTP_MAX_ATTEMPTS - attempts) },
    );
  }

  await consumeTotpStep({
    userId: input.user.sub,
    credential,
    step: verification.step!,
  });

  await db
    .update(signatureChallenges)
    .set({
      totpVerifiedAt: new Date(),
      totpStep: verification.step,
      totpAuthorizedDeviceId: device.id,
    })
    .where(eq(signatureChallenges.id, challenge.id));

  await logActivity(input.user.sub, 'document', document.id, 'sign.authorized', {
    challengeId: challenge.id,
    step: verification.step,
    deviceId: device.id,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
  });

  return {
    authorized: true,
    challengeId: challenge.id,
    expiresAt: challenge.expiresAt.toISOString(),
    step: verification.step,
    serverTime: new Date().toISOString(),
  };
}

export async function assertSignatureAuthorization(input: {
  user: AuthenticatedUser;
  documentId: string;
  messageId: string;
  challengeId: string;
  deviceId: string;
}): Promise<SignatureChallengeRow> {
  const [challenge] = await db
    .select()
    .from(signatureChallenges)
    .where(
      and(
        eq(signatureChallenges.id, input.challengeId),
        eq(signatureChallenges.userId, input.user.sub),
        eq(signatureChallenges.documentId, input.documentId),
        eq(signatureChallenges.messageId, input.messageId),
      ),
    )
    .limit(1);

  if (!challenge) throw notFound('Desafío de firma no encontrado');
  if (challenge.usedAt) throw conflict('Este desafío ya fue utilizado');
  if (challenge.expiresAt.getTime() <= Date.now()) {
    throw conflict('El desafío de firma expiró; vuelve a firmar');
  }
  if (!env.TOTP_REQUIRED_FOR_SIGNING) return challenge;

  if (!challenge.totpVerifiedAt) {
    throw new AppError(
      403,
      'TOTP_REQUIRED',
      'Autoriza la firma con el código de SirpefOffice Token antes de sellar.',
    );
  }

  if (challenge.totpAuthorizedDeviceId) {
    const [device] = await db
      .select()
      .from(mobileDevices)
      .where(
        and(
          eq(mobileDevices.id, challenge.totpAuthorizedDeviceId),
          eq(mobileDevices.status, 'active'),
        ),
      )
      .limit(1);
    if (!device || device.deviceId !== input.deviceId) {
      throw new AppError(
        403,
        'TOTP_DEVICE_MISMATCH',
        'La autorización se emitió para otro dispositivo. Vuelve a firmar.',
      );
    }
  }

  return challenge;
}

/** Archivo de apoyo para scripts de mantenimiento. */
export async function rotateCredentialKeys(encryptWith: string): Promise<number> {
  const rows = await db.select().from(totpCredentials);
  let updated = 0;
  for (const row of rows) {
    const { secret } = decryptTotpSecret({
      userId: row.userId,
      encrypted: row.secretEncrypted,
      keyId: row.keyId,
    });
    if (row.keyId === encryptWith && encryptWith === activeTotpKeyId()) continue;
    const encrypted = encryptTotpSecret({ userId: row.userId, secret });
    await db
      .update(totpCredentials)
      .set({ secretEncrypted: encrypted.encrypted, keyId: encrypted.keyId, updatedAt: new Date() })
      .where(eq(totpCredentials.id, row.id));
    updated += 1;
  }
  return updated;
}

export async function listTotpCoverage(): Promise<
  Array<{ id: string; email: string; name: string; paired: boolean; pairedDeviceLabel: string | null }>
> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      credentialId: totpCredentials.id,
      pairedDeviceLabel: totpCredentials.pairedDeviceLabel,
    })
    .from(users)
    .leftJoin(totpCredentials, eq(totpCredentials.userId, users.id))
    .where(and(eq(users.isActive, true), eq(users.role, 'admin')))
    .orderBy(users.name);

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    paired: Boolean(row.credentialId),
    pairedDeviceLabel: row.pairedDeviceLabel,
  }));
}

export async function resetTotpForEmail(email: string): Promise<{
  user: { id: string; email: string };
  deleted: boolean;
}> {
  const [user] = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`)
    .limit(1);
  if (!user) throw notFound('Usuario no encontrado');

  const deleted = await db
    .delete(totpCredentials)
    .where(eq(totpCredentials.userId, user.id))
    .returning({ id: totpCredentials.id });
  await db.delete(totpPairingCodes).where(eq(totpPairingCodes.userId, user.id));
  await db.delete(totpRecoveryCodes).where(eq(totpRecoveryCodes.userId, user.id));
  await db.delete(totpDeviceChallenges).where(eq(totpDeviceChallenges.userId, user.id));
  await logActivity(user.id, 'user', user.id, 'totp.admin_reset');
  return { user, deleted: deleted.length > 0 };
}
