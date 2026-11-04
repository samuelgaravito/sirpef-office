import { env } from '../env.js';

/**
 * Cliente mínimo de SVA. SVA es la única fuente de identidad: aquí solo se
 * valida la sesión y se lee la lista de usuarios asignados al sistema.
 */

export type SvaRole = 'admin' | 'member';

export interface SvaUser {
  uuid: string;
  name: string;
  email: string;
  cedula: string | null;
  avatar: string | null;
  role: SvaRole;
  roleName: string | null;
  systemId: number | null;
}

export interface SvaSystem {
  id: number;
  name: string;
}

/** SVA no respondió o devolvió algo que no es un contrato válido. */
export class SvaUnavailableError extends Error {
  constructor(message = 'No se pudo contactar con SVA') {
    super(message);
    this.name = 'SvaUnavailableError';
  }
}

/** SVA respondió, pero rechazó la credencial o el acceso. */
export class SvaAccessError extends Error {
  constructor(
    message: string,
    public readonly statusCode = 403,
  ) {
    super(message);
    this.name = 'SvaAccessError';
  }
}

function baseUrl(): string {
  const raw = env.SVA_SERVER_URL.trim().replace(/\/+$/, '');
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  // Sigepres guarda la URL sin protocolo; se corrige sin copiar ese error.
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(raw);
  return `${local ? 'http' : 'https'}://${raw}`;
}

interface SvaEnvelope<T> {
  status?: number;
  message?: string;
  data?: T;
  msg?: string;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const url = `${baseUrl()}${path}`;
  if (!baseUrl()) throw new SvaUnavailableError('SVA_SERVER_URL no está configurado');

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(env.SVA_TIMEOUT_MS),
    });
  } catch (error) {
    throw new SvaUnavailableError(
      `No se pudo contactar con SVA (${(error as Error).message})`,
    );
  }

  let payload: SvaEnvelope<T> | null = null;
  try {
    payload = (await response.json()) as SvaEnvelope<T>;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const message =
      (typeof payload?.msg === 'string' && payload.msg) ||
      (typeof payload?.message === 'string' && payload.message) ||
      `SVA respondió ${response.status}`;
    if (response.status >= 500) throw new SvaUnavailableError(message);
    throw new SvaAccessError(message, response.status);
  }

  if (!payload || payload.data === undefined) {
    throw new SvaUnavailableError('SVA devolvió una respuesta inesperada');
  }

  return payload.data;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asNullableString(value: unknown): string | null {
  const text = asString(value);
  return text ? text : null;
}

/** Normaliza la identidad que devuelve SVA, venga envuelta en `user` o no. */
function normalizeUser(input: unknown): SvaUser {
  const raw = (input ?? {}) as Record<string, unknown>;
  const nested = (raw.user ?? raw) as Record<string, unknown>;

  const uuid = asString(nested.uuid);
  const email = asString(nested.email).toLowerCase();
  const name = asString(nested.name);

  if (!uuid) throw new SvaAccessError('SVA no devolvió el identificador del usuario');
  if (!email || !name) {
    throw new SvaAccessError(
      'El usuario no tiene nombre o correo en SVA. Corrígelo en SVA antes de entrar.',
    );
  }

  const role = nested.role === 'admin' ? 'admin' : 'member';
  const systemIdRaw = nested.systemId;

  return {
    uuid,
    name,
    email,
    cedula: asNullableString(nested.cedula),
    avatar: asNullableString(nested.avatar),
    role,
    roleName: asNullableString(nested.roleName),
    systemId:
      typeof systemIdRaw === 'number' && Number.isFinite(systemIdRaw) ? systemIdRaw : null,
  };
}

/** Valida la cookie de SVA y devuelve la identidad + rol del sistema. */
export async function verifySvaSession(token: string): Promise<SvaUser> {
  if (!token) throw new SvaAccessError('No hay sesión de SVA');
  // Ruta servidor-a-servidor: valida la API key del sistema, la sesión del
  // usuario y que tenga asignado este sistema en SVA.
  const data = await post<unknown>('/auth/system/session', {
    token,
    api_key: env.SVA_API_KEY,
  });
  return normalizeUser(data);
}

/** Lista completa de usuarios asignados al sistema SirpefOffice en SVA. */
export async function fetchSvaUsers(): Promise<{
  system: SvaSystem | null;
  users: SvaUser[];
  errors: string[];
  uuids: string[];
}> {
  const data = await post<unknown>('/auth/sync', { api_key: env.SVA_API_KEY });

  const raw = (data ?? {}) as Record<string, unknown>;
  const list = Array.isArray(raw.users)
    ? raw.users
    : Array.isArray(data)
      ? (data as unknown[])
      : [];

  const systemRaw = raw.system as Record<string, unknown> | undefined;
  const system =
    systemRaw && typeof systemRaw.id === 'number'
      ? { id: systemRaw.id, name: asString(systemRaw.name) }
      : null;

  const users: SvaUser[] = [];
  const errors: string[] = [];
  const uuids: string[] = [];
  for (const item of list) {
    const raw = (item ?? {}) as Record<string, unknown>;
    const uuid = asString((raw.user as Record<string, unknown> | undefined)?.uuid ?? raw.uuid);
    if (uuid) uuids.push(uuid);
    try {
      users.push(normalizeUser(item));
    } catch (error) {
      const hint = asString(raw.email) || uuid || 'registro sin identificar';
      errors.push(`Datos incompletos en SVA (${hint}): ${(error as Error).message}`);
    }
  }

  return { system, users, errors, uuids };
}
