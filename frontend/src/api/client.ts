import type { ApiError as ApiErrorShape } from '@sirpefoffice/shared';

const BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/$/, '');

let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
  signal?: AbortSignal;
  raw?: boolean;
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

  const response = await fetch(buildUrl(path, options.query), {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    credentials: 'include',
    signal: options.signal,
  });

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  const isJson = contentType.includes('application/json');
  const payload = isJson ? await response.json() : await response.text();

  if (!response.ok) {
    const error = isJson ? (payload as ApiErrorShape) : { error: 'ERROR', message: String(payload) };
    throw new ApiError(response.status, error.error ?? 'ERROR', error.message ?? 'Error inesperado', error.details);
  }

  return payload as T;
}

export const api = {
  get: <T>(path: string, query?: RequestOptions['query']) => request<T>(path, { query }),
  post: <T>(path: string, body?: unknown) => request<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => request<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

/** Descarga un archivo exportado respetando el nombre que envía el servidor. */
export async function downloadFile(path: string): Promise<void> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  const response = await fetch(BASE + path, { headers, credentials: 'include' });
  if (!response.ok) {
    let message = 'No se pudo generar el archivo';
    try {
      const data = await response.json();
      message = data.message ?? message;
    } catch {
      /* respuesta no JSON */
    }
    throw new ApiError(response.status, 'EXPORT_FAILED', message);
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
