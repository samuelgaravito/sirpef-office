import { AppError } from '../../lib/errors.js';

export type AiProviderName = 'none' | 'openai' | 'anthropic' | 'gemini' | 'ollama';

export interface AiConfig {
  provider: AiProviderName;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
}

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const TIMEOUT_MS = 90_000;

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    // Fallo de red o de tiempo de espera contra el proveedor: no es un
    // problema del documento, así que se explica como caída del servicio.
    const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new AppError(
      timedOut ? 504 : 502,
      timedOut ? 'AI_TIMEOUT' : 'AI_UNREACHABLE',
      timedOut
        ? 'El proveedor de IA tardó demasiado en responder. Inténtalo de nuevo en unos minutos.'
        : 'No se pudo contactar con el proveedor de IA. Comprueba tu conexión e inténtalo de nuevo.',
    );
  }

  const text = await response.text();

  if (!response.ok) {
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
    throw new AppError(
      response.status >= 500 ? 502 : 400,
      'AI_PROVIDER_ERROR',
      response.status === 401 || response.status === 403
        ? 'El proveedor de IA rechazó la clave de API. Revísala en Ajustes.'
        : response.status === 429
          ? 'El proveedor de IA alcanzó su límite de peticiones. Espera unos minutos e inténtalo de nuevo.'
          : `El proveedor de IA respondió con un error (${response.status}): ${detail}`,
    );
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError(502, 'AI_BAD_RESPONSE', 'El proveedor de IA devolvió una respuesta ilegible');
  }
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
 * Envía una conversación al proveedor elegido y devuelve el texto plano.
 * Todos los proveedores se normalizan a la misma interfaz.
 */
export async function chat(config: AiConfig, messages: AiMessage[], jsonMode = false): Promise<string> {
  assertConfigured(config);

  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const conversation = messages.filter((message) => message.role !== 'system');

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
      )) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };

      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('');
      if (!text) throw new AppError(502, 'AI_EMPTY', 'El proveedor no devolvió contenido');
      return text;
    }

    case 'ollama': {
      const data = (await postJson(
        `${trimSlash(config.baseUrl || 'http://localhost:11434')}/api/chat`,
        {},
        {
          model: config.model,
          stream: false,
          options: { temperature: config.temperature, num_predict: config.maxTokens },
          ...(jsonMode ? { format: 'json' } : {}),
          messages,
        },
      )) as { message?: { content?: string } };

      const content = data.message?.content;
      if (!content) throw new AppError(502, 'AI_EMPTY', 'El proveedor no devolvió contenido');
      return content;
    }

    default:
      throw new AppError(400, 'AI_NOT_CONFIGURED', 'Proveedor de IA no soportado');
  }
}
