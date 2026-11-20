import { Agent } from 'undici';

import { env } from '../../env.js';
import { AppError } from '../../lib/errors.js';
import { chatViaNode } from './nodes/registry.js';

export type AiProviderName = 'none' | 'openai' | 'anthropic' | 'gemini' | 'ollama';

export interface AiConfig {
  provider: AiProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  /**
   * Equipo local que debe atender la llamada.
   *
   * Es transitorio: no se guarda en `app_settings` ni se devuelve al navegador.
   * Lo rellena `loadConfig(actor)` cuando el usuario tiene un agente conectado.
   */
  node?: { id: string; name: string };
  /**
   * Configuración del servidor para reintentar si el equipo se cae a mitad de
   * la petición. La rellena `loadConfig(actor)`; nunca se persiste.
   */
  fallback?: AiConfig;
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Ajustes opcionales de una llamada al proveedor. */
export interface ChatOptions {
  /**
   * Esquema JSON que la respuesta debe cumplir (salidas estructuradas).
   * Con Ollama se envía como `format`, de modo que el modelo queda atado a
   * las claves y tipos declarados; en el resto de proveedores se ignora.
   */
  jsonSchema?: unknown;
  /** Se invoca con el tamaño acumulado de la respuesta mientras llega. */
  onProgress?: (chars: number) => void;
}

/**
 * Agente HTTP con esperas largas.
 *
 * El `fetch` de Node corta la conexión a los 5 minutos aunque el
 * `AbortSignal` permita más, y lo reporta como «fetch failed»: con un modelo
 * local sobre CPU, redactar un documento entero puede tardar más que eso.
 * Este agente levanta ese tope; el límite real de cada llamada lo marca su
 * `AbortSignal`.
 */
const dispatcher = new Agent({
  headersTimeout: 15 * 60_000,
  bodyTimeout: 15 * 60_000,
  connectTimeout: 30_000,
});

/** Cierra el agente: sin esto el proceso no termina solo. */
export async function closeAiDispatcher(): Promise<void> {
  await dispatcher.close();
}

/**
 * Espera máxima según el proveedor.
 *
 * Las APIs alojadas responden en segundos; los modelos locales (Ollama) corren
 * en la propia máquina y, sin GPU, tardan minutos en redactar un documento
 * entero. Con el mismo tope para todos, el asistente local se cortaba siempre
 * con «el proveedor tardó demasiado».
 */
function timeoutFor(provider: AiProviderName): number {
  return provider === 'ollama' ? env.AI_LOCAL_TIMEOUT_MS : env.AI_TIMEOUT_MS;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      dispatcher,
    } as RequestInit);
  } catch (error) {
    // Fallo de red o de tiempo de espera contra el proveedor: no es un
    // problema del documento, así que se explica como caída del servicio.
    throw connectionError(error, timeoutMessage);
  }

  const text = await response.text();

  if (!response.ok) throw providerError(response, text);

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError(502, 'AI_BAD_RESPONSE', 'El proveedor de IA devolvió una respuesta ilegible');
  }
}

/** Traduce un fallo de conexión o de espera con el proveedor. */
function connectionError(error: unknown, timeoutMessage: string): AppError {
  const cause = (error as { cause?: { code?: string } }).cause;
  const timedOut =
    (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) ||
    cause?.code === 'UND_ERR_HEADERS_TIMEOUT' ||
    cause?.code === 'UND_ERR_BODY_TIMEOUT';
  return new AppError(
    timedOut ? 504 : 502,
    timedOut ? 'AI_TIMEOUT' : 'AI_UNREACHABLE',
    timedOut
      ? timeoutMessage
      : 'No se pudo contactar con el proveedor de IA. Comprueba tu conexión e inténtalo de nuevo.',
  );
}

/** Traduce una respuesta HTTP fallida del proveedor a un `AppError`. */
function providerError(response: Response, text: string): AppError {
  let detail = text.slice(0, 500);
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    detail =
      (typeof parsed.error === 'string' ? parsed.error : parsed.error?.message) ??
      parsed.message ??
      detail;
  } catch {
    /* respuesta no JSON */
  }
  // El mensaje del proveedor ayuda a diagnosticar (clave inválida, cuota,
  // modelo inexistente…), pero se acompaña de una explicación en español.
  return new AppError(
    response.status >= 500 ? 502 : 400,
    'AI_PROVIDER_ERROR',
    response.status === 401 || response.status === 403
      ? 'El proveedor de IA rechazó la clave de API. Revísala en Ajustes.'
      : response.status === 429
        ? 'El proveedor de IA alcanzó su límite de peticiones. Espera unos minutos e inténtalo de nuevo.'
        : `El proveedor de IA respondió con un error (${response.status}): ${detail}`,
  );
}

/** ¿El proveedor puede atender una llamada sin configurar nada más? */
function canUse(config: AiConfig): boolean {
  return config.provider !== 'none' && (config.provider === 'ollama' || config.apiKey.length > 0);
}

export function assertConfigured(config: AiConfig): void {
  if (config.provider === 'none') {
    throw new AppError(
      400,
      'AI_NOT_CONFIGURED',
      'No hay proveedor de IA configurado. Elige uno en Ajustes o usa el modo manual.',
    );
  }
  if (config.provider !== 'ollama' && !config.apiKey) {
    throw new AppError(400, 'AI_NOT_CONFIGURED', 'Falta la clave de API del proveedor de IA');
  }
}

/**
 * Consume el flujo NDJSON de Ollama para informar del avance.
 *
 * Se usa en el asistente: el navegador ve cuánto se ha escrito aunque el
 * documento solo llegue al final. Devuelve el texto completo.
 */
async function ollamaStream(
  url: string,
  body: unknown,
  timeoutMs: number,
  timeoutMessage: string,
  onProgress: (chars: number) => void,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
      dispatcher,
    } as RequestInit);
  } catch (error) {
    throw connectionError(error, timeoutMessage);
  }

  if (!response.ok) throw providerError(response, await response.text());
  if (!response.body) {
    throw new AppError(502, 'AI_BAD_RESPONSE', 'El proveedor de IA no devolvió un flujo legible');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reported = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf('\n');
      if (!line) continue;

      let chunk: { error?: string; message?: { content?: string } };
      try {
        chunk = JSON.parse(line) as typeof chunk;
      } catch {
        continue;
      }

      if (chunk.error) {
        throw new AppError(
          502,
          'AI_PROVIDER_ERROR',
          `El proveedor de IA respondió con un error: ${chunk.error}`,
        );
      }

      if (typeof chunk.message?.content === 'string') content += chunk.message.content;

      // Se informa por tramos: un evento por carácter saturaría la red.
      if (content.length - reported >= 60) {
        reported = content.length;
        onProgress(content.length);
      }
    }
  }

  if (content.length > reported) onProgress(content.length);
  if (!content) throw new AppError(502, 'AI_EMPTY', 'El proveedor no devolvió contenido');
  return content;
}

/**
 * Envía una conversación al proveedor elegido y devuelve el texto plano.
 * Todos los proveedores se normalizan a la misma interfaz.
 */
export async function chat(
  config: AiConfig,
  messages: AiMessage[],
  jsonMode = false,
  options: ChatOptions = {},
): Promise<string> {
  assertConfigured(config);

  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const conversation = messages.filter((message) => message.role !== 'system');

  const timeoutMs = timeoutFor(config.provider);
  const timeoutMessage =
    config.provider === 'ollama'
      ? 'El modelo local tardó demasiado en responder. Redactar un documento entero puede tardar ' +
        'varios minutos: inténtalo de nuevo o usa un modelo más pequeño.'
      : 'El proveedor de IA tardó demasiado en responder. Inténtalo de nuevo en unos minutos.';

  switch (config.provider) {
    case 'openai': {
      const data = (await postJson(
        `${trimSlash(config.baseUrl)}/chat/completions`,
        { authorization: `Bearer ${config.apiKey}` },
        {
          model: config.model,
          temperature: config.temperature,
          max_tokens: config.maxTokens,
          messages,
          ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
        },
        timeoutMs,
        timeoutMessage,
      )) as { choices?: { message?: { content?: string } }[] };

      const content = data.choices?.[0]?.message?.content;
      if (!content) throw new AppError(502, 'AI_EMPTY', 'El proveedor no devolvió contenido');
      return content;
    }

    case 'anthropic': {
      const data = (await postJson(
        `${trimSlash(config.baseUrl || 'https://api.anthropic.com')}/v1/messages`,
        {
          'x-api-key': config.apiKey,
          'anthropic-version': '2023-06-01',
        },
        {
          model: config.model,
          max_tokens: config.maxTokens,
          temperature: config.temperature,
          ...(system ? { system } : {}),
          messages: conversation.map((message) => ({
            role: message.role === 'assistant' ? 'assistant' : 'user',
            content: message.content,
          })),
        },
        timeoutMs,
        timeoutMessage,
      )) as { content?: { type: string; text?: string }[] };

      const text = (data.content ?? [])
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('\n');
      if (!text) throw new AppError(502, 'AI_EMPTY', 'El proveedor no devolvió contenido');
      return text;
    }

    case 'gemini': {
      const base = trimSlash(config.baseUrl || 'https://generativelanguage.googleapis.com/v1beta');
      const data = (await postJson(
        `${base}/models/${encodeURIComponent(config.model)}:generateContent?key=${encodeURIComponent(config.apiKey)}`,
        {},
        {
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: conversation.map((message) => ({
            role: message.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: message.content }],
          })),
          generationConfig: {
            temperature: config.temperature,
            maxOutputTokens: config.maxTokens,
            ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
          },
        },
        timeoutMs,
        timeoutMessage,
      )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };

      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('');
      if (!text) throw new AppError(502, 'AI_EMPTY', 'El proveedor no devolvió contenido');
      return text;
    }

    case 'ollama': {
      const url = `${trimSlash(config.baseUrl || 'http://localhost:11434')}/api/chat`;
      const body = {
        model: config.model,
        stream: typeof options.onProgress === 'function',
        options: {
          temperature: config.temperature,
          num_predict: config.maxTokens,
          // Sin esto Ollama usa 4 096 y recorta el prompt por delante.
          num_ctx: env.AI_NUM_CTX,
        },
        // Salidas estructuradas: el esquema sustituye al `"json"` genérico y
        // ata la respuesta a las claves y tipos que espera la aplicación.
        ...(options.jsonSchema
          ? { format: options.jsonSchema }
          : jsonMode
            ? { format: 'json' }
            : {}),
        messages,
      };

      // El equipo del usuario tiene prioridad. El agente reenvía este mismo
      // cuerpo a su Ollama y devuelve el NDJSON; el parseo sigue aquí.
      if (config.node) {
        try {
          return await chatViaNode(config.node.id, body, options.onProgress);
        } catch (error) {
          // Solo se reintenta si el problema fue la conexión del equipo: un
          // error del modelo o una respuesta inválida no se repiten a ciegas.
          const offline = error instanceof AppError && error.code === 'AI_NODE_OFFLINE';
          const fallback = config.fallback;
          if (!offline || !fallback || !canUse(fallback)) throw error;
          return chat(fallback, messages, jsonMode, options);
        }
      }

      if (options.onProgress) {
        return ollamaStream(url, body, timeoutMs, timeoutMessage, options.onProgress);
      }

      const data = (await postJson(url, {}, body, timeoutMs, timeoutMessage)) as {
        message?: { content?: string };
      };

      const content = data.message?.content;
      if (!content) throw new AppError(502, 'AI_EMPTY', 'El proveedor no devolvió contenido');
      return content;
    }

    default:
      throw new AppError(400, 'AI_NOT_CONFIGURED', 'Proveedor de IA no soportado');
  }
}
