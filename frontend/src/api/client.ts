import type { ApiError as ApiErrorShape } from '@sirpefoffice/shared';

const BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

/**
 * Renueva la sesión con la cookie de refresco cuando el access token caduca.
 *
 * Lo inyecta el store de autenticación: así el cliente HTTP no depende de
 * Pinia y la renovación se hace una sola vez aunque lleguen varias peticiones
 * con el token vencido al mismo tiempo.
 */
let refreshHandler: (() => Promise<string | null>) | null = null;

export function setRefreshHandler(handler: (() => Promise<string | null>) | null): void {
  refreshHandler = handler;
}

/** Promesa de renovación en curso, para no disparar varias a la vez. */
let refreshInFlight: Promise<string | null> | null = null;

async function renewSession(): Promise<string | null> {
  if (!refreshHandler) return null;
  if (!refreshInFlight) {
    refreshInFlight = refreshHandler()
      .catch(() => null)
      .finally(() => {
        refreshInFlight = null;
      });
  }
  return refreshInFlight;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
    /** Referencia para rastrear el fallo en los logs del servidor (solo 5xx). */
    public reference?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Traduce un fallo de red a un mensaje que el usuario entienda.
 *
 * `fetch` rechaza con un `TypeError: fetch failed` cuando no hay conexión o
 * el servidor no responde. Sin esto, el mensaje que llegaba al aviso era
 * «Failed to fetch», en inglés y sin explicación.
 */
function networkError(error: unknown): ApiError {
  const cause = (error as { cause?: { code?: string } } | undefined)?.cause?.code;
  const message =
    cause === 'ECONNREFUSED'
      ? 'El servidor no acepta conexiones en este momento. Inténtalo de nuevo en unos segundos.'
      : 'No se pudo conectar con el servidor. Revisa tu conexión a internet e inténtalo de nuevo.';
  return new ApiError(0, 'NETWORK_ERROR', message);
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  raw?: boolean;
  /** Impide el reintento tras un 401 (evita bucles en la propia renovación). */
  noRetry?: boolean;
}

function buildUrl(path: string, query?: RequestOptions['query']): string {
  const url = new URL(BASE + path, window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), {
      method: options.method ?? 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'include',
      signal: options.signal,
    });
  } catch (error) {
    // Sin conexión o servidor caído: se avisa con un mensaje entendible.
    if ((error as Error).name === 'AbortError') throw error;
    throw networkError(error);
  }

  // El access token caduca mientras el usuario aprende. En vez de echarlo
  // al login, se renueva la sesión con la cookie de refresco y se repite la
  // petición: el trabajo en curso no se pierde.
  if (response.status === 401 && !options.noRetry) {
    const renewed = await renewSession();
    if (renewed) {
      return request<T>(path, { ...options, noRetry: true });
    }
  }

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    if (!isJson) {
      // Un proxy (Nginx, Caddy) puede responder con HTML en vez de JSON.
      // Mostrar ese HTML dentro de un aviso sería un desastre: se explica
      // el problema con el estado HTTP y ya está.
      throw new ApiError(
        response.status,
        'INVALID_RESPONSE',
        `El servidor devolvió una respuesta no válida (HTTP ${response.status}). Inténtalo de nuevo en unos minutos.`,
      );
    }
    const error = payload as ApiErrorShape;
    throw new ApiError(
      response.status,
      error.error ?? 'ERROR',
      error.message ?? 'Ocurrió un error inesperado. Inténtalo de nuevo.',
      error.details,
      error.reference,
    );
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => request<T>(path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  /** Petición sin reintento automático (para la propia renovación de sesión). */
  raw: <T>(path: string, options: RequestOptions = {}) => request<T>(path, options),
};

/** Descarga un archivo exportado respetando el nombre que envía el servidor. */
export async function downloadFile(path: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const fetchFile = () =>
    fetch(BASE + path, { headers, credentials: 'include' }).catch((error: unknown) => {
      throw networkError(error);
    });

  let response = await fetchFile();

  // La exportación genera el archivo en el servidor: si el token caducó a
  // media descarga, se renueva la sesión y se reintenta.
  if (response.status === 401) {
    const renewed = await renewSession();
    if (renewed) {
      const renewedHeaders: Record<string, string> = {};
      if (accessToken) renewedHeaders.Authorization = `Bearer ${accessToken}`;
      response = await fetch(BASE + path, { headers: renewedHeaders, credentials: 'include' }).catch(
        (error: unknown) => {
          throw networkError(error);
        },
      );
    }
  }

  if (!response.ok) {
    let message = 'No se pudo generar el archivo. Inténtalo de nuevo.';
    let code = 'EXPORT_FAILED';
    let reference: string | undefined;
    try {
      const data = (await response.json()) as ApiErrorShape;
      message = data.message ?? message;
      code = data.error ?? code;
      reference = data.reference;
    } catch {
      // Respuesta no JSON (p. ej. la página de error de un proxy).
      message = `El servidor devolvió una respuesta no válida (HTTP ${response.status}). Inténtalo de nuevo en unos minutos.`;
    }
    throw new ApiError(response.status, code, message, undefined, reference);
  }

  const disposition = response.headers.get('content-disposition') ?? '';
  const match = /filename="?([^"]+)"?/.exec(disposition);
  const filename = match?.[1] ?? 'documento';

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
