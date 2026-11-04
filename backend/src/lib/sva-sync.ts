import { and, eq, inArray, isNotNull, isNull, notInArray, sql } from 'drizzle-orm';

import { db } from '../db/index.js';
import { refreshTokens, users, type UserRow } from '../db/schema.js';
import { env } from '../env.js';
import { fetchSvaUsers, type SvaUser } from './sva.js';

export interface SyncSvaResult {
  total: number;
  created: number;
  updated: number;
  deactivated: number;
  skipped: number;
  errors: string[];
  syncedAt: string;
}

/**
 * Materializa (o actualiza) un usuario de SVA en la tabla local.
 *
 * La fila local nunca se borra: documentos, plantillas y comparticiones
 * apuntan a ella. Solo se desactiva cuando SVA deja de asignarla.
 */
export async function upsertSvaUser(identity: SvaUser): Promise<UserRow> {
  const email = identity.email.trim().toLowerCase();

  let [existing] = await db
    .select()
    .from(users)
    .where(eq(users.svaUuid, identity.uuid))
    .limit(1);

  if (!existing) {
    [existing] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
  }

  if (existing && existing.svaUuid && existing.svaUuid !== identity.uuid) {
    throw new Error(`El correo ${email} ya pertenece a otro usuario de SVA`);
  }

  // El admin local de emergencia no se pisa desde SVA, y tampoco se puede
  // iniciar sesión como él usando una identidad de SVA con su mismo correo.
  if (
    existing &&
    existing.authProvider === 'local' &&
    existing.role === 'admin' &&
    existing.svaUuid !== identity.uuid
  ) {
    throw new Error(
      `El correo ${email} está reservado para la cuenta local de emergencia; usa otro correo en SVA`,
    );
  }

  const base = {
    name: identity.name,
    email,
    cedula: identity.cedula,
    role: identity.role,
    svaUuid: identity.uuid,
    authProvider: 'sva',
    isActive: true,
    lastSvaSyncAt: new Date(),
    updatedAt: new Date(),
  };

  if (existing) {
    const [updated] = await db
      .update(users)
      .set({
        ...base,
        avatarUrl: identity.avatar ?? existing.avatarUrl,
        // Al convertir un usuario local en proyección de SVA se elimina su
        // contraseña: la autenticación pasa a depender solo de SVA.
        passwordHash: null,
      })
      .where(eq(users.id, existing.id))
      .returning();
    if (!updated) throw new Error(`No se pudo actualizar el usuario ${email}`);
    return updated;
  }

  const [created] = await db
    .insert(users)
    .values({
      ...base,
      avatarUrl: identity.avatar,
      passwordHash: null,
    })
    .returning();
  if (!created) throw new Error(`No se pudo crear el usuario ${email}`);
  return created;
}

/** Revoca las sesiones locales de los usuarios que dejaron de estar activos. */
async function revokeSessions(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        inArray(refreshTokens.userId, userIds),
        isNull(refreshTokens.revokedAt),
      ),
    );
}

/**
 * Sincroniza la proyección local con SVA.
 *
 * Si SVA falla, la función lanza y no desactiva a nadie: un SVA caído no
 * puede dejar sin acceso a todo el mundo.
 */
export async function syncSvaUsers(): Promise<SyncSvaResult> {
  const { users: remote, errors: remoteErrors, uuids: remoteUuids } = await fetchSvaUsers();

  // Los UUID anunciados por SVA mandan aunque un registro concreto falle al
  // materializarse: no se desactiva a nadie que siga asignado en SVA.
  const announced = new Set(remoteUuids);
  const synced = new Set<string>();
  const errors: string[] = [...remoteErrors];

  let created = 0;
  let updated = 0;

  for (const identity of remote) {
    if (!identity.email || !identity.name) {
      errors.push(`Datos incompletos en SVA: ${identity.uuid}`);
      continue;
    }

    try {
      const [before] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.svaUuid, identity.uuid))
        .limit(1);

      await upsertSvaUser(identity);
      synced.add(identity.uuid);
      if (before) updated += 1;
      else created += 1;
    } catch (error) {
      errors.push(`${identity.email}: ${(error as Error).message}`);
    }
  }

  // Solo desactivar proyecciones SVA que ya no vienen de SVA. Nunca se
  // desactiva un usuario local (break-glass).
  const announcedUuids = [...announced];
  const staleFilter =
    announcedUuids.length > 0
      ? and(
          eq(users.authProvider, 'sva'),
          eq(users.isActive, true),
          isNotNull(users.svaUuid),
          notInArray(users.svaUuid, announcedUuids),
        )
      : and(
          eq(users.authProvider, 'sva'),
          eq(users.isActive, true),
          isNotNull(users.svaUuid),
        );

  const deactivated = await db
    .update(users)
    .set({ isActive: false, updatedAt: new Date() })
    .where(staleFilter)
    .returning({ id: users.id });

  await revokeSessions(deactivated.map((row) => row.id));

  return {
    total: remote.length,
    created,
    updated,
    deactivated: deactivated.length,
    skipped: remote.length - synced.size,
    errors,
    syncedAt: new Date().toISOString(),
  };
}

let timer: NodeJS.Timeout | null = null;
let running = false;

type Logger = {
  info: (obj: unknown, msg?: string) => void;
  warn: (obj: unknown, msg?: string) => void;
  error: (obj: unknown, msg?: string) => void;
};

/** Arranca el sync al inicio y luego cada SVA_SYNC_INTERVAL_MS. */
export function startSvaSyncScheduler(log: Logger): void {
  if (env.AUTH_MODE === 'local') return;
  if (timer) return;

  const run = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const result = await syncSvaUsers();
      log.info(result, 'Sincronización con SVA completada');
    } catch (error) {
      log.warn(
        { error: (error as Error).message },
        'No se pudo sincronizar con SVA; no se desactiva a nadie',
      );
    } finally {
      running = false;
    }
  };

  void run();
  timer = setInterval(() => void run(), env.SVA_SYNC_INTERVAL_MS);
  timer.unref();
}

export function stopSvaSyncScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
