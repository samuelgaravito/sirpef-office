import { normalizeMenuKeys, type AuthProvider, type PublicUser } from '@sirpefoffice/shared';

import type { UserRow } from '../db/schema.js';

/** Convierte una fila de la tabla users en el objeto público que ve el cliente. */
export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    avatarUrl: row.avatarUrl,
    cedula: row.cedula,
    authProvider: row.authProvider === 'sva' ? 'sva' : ('local' as AuthProvider),
    isActive: row.isActive,
    menus: normalizeMenuKeys(row.menuKeys),
    createdAt: row.createdAt.toISOString(),
  };
}
