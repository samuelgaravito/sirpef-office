/**
 * Prueba de humo del historial de consulta y los informes guardados.
 *
 * Requiere la API levantada y la misma base de datos.
 *   npm run smoke:ai-conversations
 *
 * Usa dos usuarios temporales: el dueño crea la conversación y el otro
 * comprueba que recibe 404. No llama al proveedor de IA: ejecuta un plan ya
 * resuelto (camino determinista).
 */
import { inArray } from 'drizzle-orm';

import { db } from '../src/db/index.js';
import { users } from '../src/db/schema.js';
import { signAccessToken } from '../src/lib/jwt.js';

const API = process.env.SD_API ?? 'http://localhost:3101/api';

interface ApiResult<T = unknown> {
  status: number;
  body: T;
}

async function call<T = unknown>(
  path: string,
  token: string,
  method = 'GET',
  body?: unknown,
): Promise<ApiResult<T>> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* respuesta de texto */
  }
  return { status: response.status, body: parsed as T };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`✖ ${message}`);
  console.log(`✔ ${message}`);
}

const plan = {
  mode: 'count',
  metrics: ['count'],
  dimensions: [],
  bucket: null,
  compare: null,
  chart: 'kpi',
  sort: { by: 'value', dir: 'desc' },
  limit: 8,
  clarification: null,
  filters: {
    intent: 'count',
    groupBy: 'none',
    scope: 'all',
    docTypes: [],
    statuses: [],
    templateName: '',
    recipient: '',
    text: '',
    from: '',
    to: '',
    dateField: 'created',
    approvedByMe: false,
    limit: 8,
  },
};

async function main(): Promise<void> {
  const stamp = Date.now();
  const created = await db
    .insert(users)
    .values([
      { email: `smoke-ai-owner-${stamp}@local`, name: 'Smoke IA dueño' },
      { email: `smoke-ai-other-${stamp}@local`, name: 'Smoke IA otro' },
    ])
    .returning();

  const owner = created[0];
  const other = created[1];
  if (!owner || !other) throw new Error('No se pudieron crear los usuarios de humo');

  const ownerToken = await signAccessToken({
    sub: owner.id,
    email: owner.email,
    name: owner.name,
    role: owner.role,
  });
  const otherToken = await signAccessToken({
    sub: other.id,
    email: other.email,
    name: other.name,
    role: other.role,
  });

  try {
    const ask = await call<{ conversationId: string; chart: { kind: string } | null }>(
      '/ai/ask',
      ownerToken,
      'POST',
      { question: '¿Cuántos documentos tengo?', plan },
    );
    assert(ask.status === 200, 'La consulta determinista responde 200');
    assert(Boolean(ask.body.conversationId), 'La consulta crea una conversación');
    const conversationId = ask.body.conversationId;

    const list = await call<{ items: { id: string; messageCount: number }[] }>(
      '/ai/conversations',
      ownerToken,
    );
    const summary = list.body.items.find((item) => item.id === conversationId);
    assert(Boolean(summary), 'La conversación aparece en el historial');
    assert(summary?.messageCount === 2, 'La conversación guarda pregunta y respuesta');

    const detail = await call<{ messages: { role: string; result: unknown }[] }>(
      `/ai/conversations/${conversationId}`,
      ownerToken,
    );
    assert(detail.body.messages.length === 2, 'El detalle devuelve los dos turnos');
    assert(
      detail.body.messages[0]?.role === 'user' &&
        detail.body.messages[1]?.role === 'assistant',
      'Los turnos conservan el orden pregunta → respuesta',
    );
    assert(
      detail.body.messages[1]?.result !== null,
      'La respuesta se reconstruye al abrir la conversación',
    );

    const foreign = await call(`/ai/conversations/${conversationId}`, otherToken);
    assert(foreign.status === 404, 'Otro usuario recibe 404 sobre la conversación ajena');

    const renamed = await call(
      `/ai/conversations/${conversationId}`,
      ownerToken,
      'PATCH',
      { title: 'Consulta de humo' },
    );
    assert(renamed.status === 200, 'La conversación se puede renombrar');

    const saved = await call<{ id: string }>(
      '/stats/charts',
      ownerToken,
      'POST',
      { title: 'Informe de humo', plan },
    );
    assert(saved.status === 201, 'El gráfico se guarda como informe');
    const chartId = saved.body.id;

    const charts = await call<{ items: { id: string }[] }>('/stats/charts', ownerToken);
    assert(
      charts.body.items.some((item) => item.id === chartId),
      'El informe aparece en la lista',
    );

    const run = await call<{ chart: { kind: string } | null }>(
      '/ai/run',
      ownerToken,
      'POST',
      { plan },
    );
    assert(run.status === 200 && run.body.chart?.kind === 'kpi', 'El informe se ejecuta con su plan');

    const removedChart = await call(`/stats/charts/${chartId}`, ownerToken, 'DELETE');
    assert(removedChart.status === 200, 'El informe se puede borrar');

    const removed = await call(`/ai/conversations/${conversationId}`, ownerToken, 'DELETE');
    assert(removed.status === 200, 'La conversación se puede borrar');

    const after = await call<{ items: { id: string }[] }>('/ai/conversations', ownerToken);
    assert(
      !after.body.items.some((item) => item.id === conversationId),
      'La conversación borrada desaparece del historial',
    );
  } finally {
    await db.delete(users).where(inArray(users.id, [owner.id, other.id]));
  }

  console.log('\nRESULTADO: todas las comprobaciones pasaron');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
