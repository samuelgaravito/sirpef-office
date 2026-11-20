/**
 * SirpefOffice · agente de IA local.
 *
 * Abre una conexión saliente hacia el servidor y reenvía los trabajos a su
 * Ollama. No expone ningún puerto, no guarda documentos y solo deja pasar las
 * rutas de la lista blanca.
 *
 * Variables:
 *   SD_SERVER  wss://servidor/api/ai/node   (obligatoria)
 *   SD_TOKEN   token del equipo             (obligatoria)
 *   OLLAMA_URL http://ollama:11434          (por defecto la red de Docker)
 */

import WebSocket from 'ws';

const SERVER = process.env.SD_SERVER ?? '';
const TOKEN = process.env.SD_TOKEN ?? '';
const OLLAMA = (process.env.OLLAMA_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');

/** Debe coincidir con `AI_NODE_PROTOCOL_VERSION` de shared/src/ai.ts. */
const PROTOCOL = 1;
const AGENT_VERSION = '1.0.0';

/** Rutas de Ollama que el agente reenvía. Nada más. */
const ALLOWED_PATHS = new Set(['/api/chat']);
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const REFRESH_MS = 5 * 60_000;

if (!SERVER || !TOKEN) {
  console.error('[ai-node] Faltan SD_SERVER o SD_TOKEN. Revisa el .env del agente.');
  process.exit(1);
}

/** Estado que se reporta al servidor. `tokensPerSecond` se mide en cada trabajo. */
let tokensPerSecond = null;
let socket = null;
let attempt = 0;
let refreshTimer = null;
const active = new Map();

function log(...args) {
  console.log(new Date().toISOString(), '[ai-node]', ...args);
}

async function getJson(path, timeoutMs = 4000) {
  const response = await fetch(`${OLLAMA}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${path} respondió ${response.status}`);
  return response.json();
}

/** Lee versión, modelos y uso de VRAM del Ollama local. */
async function capabilities() {
  const result = {
    ollamaVersion: null,
    models: [],
    gpu: false,
    vramGb: null,
    tokensPerSecond,
  };

  try {
    const version = await getJson('/api/version');
    if (typeof version.version === 'string') result.ollamaVersion = version.version;
  } catch {
    /* Ollama puede estar cargando: se reporta lo que se pueda */
  }

  try {
    const tags = await getJson('/api/tags');
    if (Array.isArray(tags.models)) {
      result.models = tags.models
        .map((model) => model?.name)
        .filter((name) => typeof name === 'string');
    }
  } catch {
    /* sin modelos, el servidor pedirá otro equipo o el proveedor */
  }

  try {
    const ps = await getJson('/api/ps');
    const loaded = Array.isArray(ps.models) ? ps.models : [];
    let vram = 0;
    let total = 0;
    for (const model of loaded) {
      const inVram = Number(model?.size_vram ?? 0);
      const size = Number(model?.size ?? 0);
      if (inVram > 0) vram = Math.max(vram, inVram);
      total = Math.max(total, size);
    }
    if (vram > 0) {
      result.gpu = total === 0 ? true : vram >= total * 0.5;
      result.vramGb = Math.round((vram / 2 ** 30) * 10) / 10;
    }
  } catch {
    /* sin modelo cargado no se puede saber; se reintenta en el próximo hello */
  }

  return result;
}

function send(message) {
  if (!socket || socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(message));
}

async function sendHello() {
  const caps = await capabilities();
  send({ type: 'hello', protocol: PROTOCOL, version: AGENT_VERSION, capabilities: caps });
}

/** Extrae tokens/s del último NDJSON de Ollama. */
function measure(line) {
  try {
    const data = JSON.parse(line);
    const count = Number(data.eval_count ?? 0);
    const duration = Number(data.eval_duration ?? 0);
    if (count > 0 && duration > 0) {
      tokensPerSecond = Math.round((count / (duration / 1e9)) * 10) / 10;
    }
  } catch {
    /* una línea parcial no se mide */
  }
}

async function runJob(id, path, body) {
  if (!ALLOWED_PATHS.has(path)) {
    send({ type: 'error', id, message: `Ruta no permitida por el agente: ${path}` });
    return;
  }

  const serialized = JSON.stringify(body ?? {});
  if (Buffer.byteLength(serialized) > MAX_BODY_BYTES) {
    send({ type: 'error', id, message: 'El trabajo supera el tamaño máximo permitido' });
    return;
  }

  const controller = new AbortController();
  active.set(id, controller);

  try {
    const response = await fetch(`${OLLAMA}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: serialized,
      signal: controller.signal,
    });

    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400);
      send({ type: 'error', id, message: `Ollama respondió ${response.status}: ${detail}` });
      return;
    }

    if (!response.body) {
      send({ type: 'error', id, message: 'Ollama no devolvió un flujo legible' });
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let lastLine = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let newline = buffer.indexOf('\n');
      while (newline >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf('\n');
        if (!line.trim()) continue;
        lastLine = line;
        send({ type: 'chunk', id, data: `${line}\n` });
      }
    }

    // Respuestas sin streaming: llegan como un JSON único sin salto final.
    if (buffer.trim()) {
      lastLine = buffer;
      send({ type: 'chunk', id, data: `${buffer}\n` });
    }

    if (lastLine) measure(lastLine);
    send({ type: 'done', id });
  } catch (error) {
    if (error?.name === 'AbortError') {
      send({ type: 'error', id, message: 'Redacción cancelada' });
    } else {
      send({ type: 'error', id, message: String(error?.message ?? error).slice(0, 400) });
    }
  } finally {
    active.delete(id);
  }
}

function connect() {
  log(`conectando a ${SERVER} · Ollama en ${OLLAMA}`);
  socket = new WebSocket(SERVER, {
    headers: { authorization: `Bearer ${TOKEN}` },
    handshakeTimeout: 15_000,
  });

  socket.on('open', () => {
    attempt = 0;
    log('conectado');
    void sendHello();
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => void sendHello(), REFRESH_MS);
  });

  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (message.type === 'job' && typeof message.id === 'string') {
      void runJob(message.id, message.path, message.body).then(() => {
        // La velocidad cambia tras cada trabajo: se refresca el estado.
        void sendHello();
      });
      return;
    }

    if (message.type === 'abort' && typeof message.id === 'string') {
      active.get(message.id)?.abort();
    }
  });

  socket.on('close', (code) => {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    if (code === 4401 || code === 4403) {
      log(`el servidor rechazó el token (${code}). Revisa SD_TOKEN; no se reintenta.`);
      process.exit(2);
    }
    if (code === 4409) {
      // El servidor cierra la conexión anterior cuando el mismo equipo abre
      // otra. Reintentar aquí sería una pelea entre dos instancias.
      log('ya hay otra instancia de este agente conectada. Esta se detiene.');
      process.exit(3);
    }
    attempt += 1;
    const wait = Math.min(1_000 * 2 ** (attempt - 1), 30_000);
    log(`desconectado (${code}). Reintento en ${Math.round(wait / 1000)} s`);
    setTimeout(connect, wait);
  });

  socket.on('error', (error) => {
    log(`error de conexión: ${error?.message ?? error}`);
    // `close` se encarga del reintento.
  });
}

function shutdown(signal) {
  log(`recibido ${signal}, cerrando`);
  for (const controller of active.values()) controller.abort();
  try {
    socket?.close(1000, 'El agente se está apagando');
  } catch {
    /* nada que hacer */
  }
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

connect();
