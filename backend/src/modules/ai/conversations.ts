/**
 * Conversaciones del chat de consulta.
 *
 * Se guarda la pregunta y el **plan** de cada respuesta. Al abrir una
 * conversación se vuelve a ejecutar el plan con los permisos actuales, así que
 * nunca se muestran documentos que el usuario ya no puede ver.
 */
import { and, asc, desc, eq, ilike, isNull, lt, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type {
  AiAskHistoryMessage,
  AiAskResult,
  AiConversation,
  AiConversationMessage,
  AiConversationSummary,
  AiConversationsPage,
} from '@sirpefoffice/shared';

import { db } from '../../db/index.js';
import { aiConversationMessages, aiConversations } from '../../db/schema.js';
import { authenticate } from '../../lib/auth-guard.js';
import { notFound } from '../../lib/errors.js';
import { loadAskTemplates, runWithPlan, type AskContext } from './ask.js';

const PAGE_SIZE = 20;

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

const idParams = z.object({ id: z.uuid() });
const conversationQuery = z.object({ before: z.iso.datetime().optional() });
const createBody = z.object({ title: z.string().trim().min(1).max(120).optional() });
const updateBody = z.object({ title: z.string().trim().min(1).max(120) });

/** Título corto a partir de la primera pregunta. */
export function titleFrom(question: string): string {
  const clean = question.replace(/\s+/g, ' ').trim();
  return clean.length > 80 ? `${clean.slice(0, 77)}…` : clean || 'Nueva consulta';
}

/** Conversación del usuario o 404 (no se revela la existencia de otras). */
export async function assertConversation(userId: string, id: string): Promise<void> {
  const [row] = await db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(
      and(
        eq(aiConversations.id, id),
        eq(aiConversations.userId, userId),
        isNull(aiConversations.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw notFound('Conversación no encontrada');
}

export async function createConversation(userId: string, question: string): Promise<string> {
  const [row] = await db
    .insert(aiConversations)
    .values({ userId, title: titleFrom(question) })
    .returning({ id: aiConversations.id });
  if (!row) throw notFound('No se pudo crear la conversación');
  return row.id;
}

/** Últimos turnos para el modelo (solo texto, nunca JSON estructurado). */
export async function conversationHistory(
  conversationId: string,
): Promise<AiAskHistoryMessage[]> {
  const rows = await db
    .select({ role: aiConversationMessages.role, content: aiConversationMessages.content })
    .from(aiConversationMessages)
    .where(eq(aiConversationMessages.conversationId, conversationId))
    .orderBy(
      desc(aiConversationMessages.createdAt),
      sql`case when ${aiConversationMessages.role} = 'assistant' then 0 else 1 end`,
    )
    .limit(4);

  return rows
    .reverse()
    .filter((row) => row.role === 'user' || row.role === 'assistant')
    .map((row) => ({
      role: row.role as 'user' | 'assistant',
      content: row.content.slice(0, 2_000),
    }));
}

/** Descarta una conversación vacía que no llegó a tener respuesta. */
export async function discardConversation(id: string): Promise<void> {
  await db
    .update(aiConversations)
    .set({ deletedAt: new Date() })
    .where(eq(aiConversations.id, id));
}

/** Guarda un turno completo (pregunta + respuesta) y toca la conversación. */
export async function appendTurn(
  conversationId: string,
  question: string,
  result: AiAskResult,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Dos instantes distintos: la pregunta va antes que la respuesta aunque
    // `now()` sea el mismo dentro de la transacción.
    const now = Date.now();
    await tx.insert(aiConversationMessages).values([
      { conversationId, role: 'user', content: question, createdAt: new Date(now) },
      {
        conversationId,
        role: 'assistant',
        content: result.answer,
        plan: result.plan,
        createdAt: new Date(now + 1),
      },
    ]);
    await tx
      .update(aiConversations)
      .set({ updatedAt: new Date() })
      .where(eq(aiConversations.id, conversationId));
  });
}

async function listForUser(
  userId: string,
  query: z.infer<typeof listQuery>,
): Promise<AiConversationsPage> {
  const where = and(
    eq(aiConversations.userId, userId),
    isNull(aiConversations.deletedAt),
    query.q ? ilike(aiConversations.title, `%${query.q}%`) : undefined,
  );

  const preview = sql<string>`coalesce((select m.content from ai_conversation_messages m where m.conversation_id = ai_conversations.id order by m.created_at desc, case when m.role = 'assistant' then 0 else 1 end limit 1), '')`;
  const messageCount = sql<number>`(select count(*)::int from ai_conversation_messages m where m.conversation_id = ai_conversations.id)`;

  const [rows, countRow] = await Promise.all([
    db
      .select({
        id: aiConversations.id,
        title: aiConversations.title,
        preview,
        messageCount,
        updatedAt: aiConversations.updatedAt,
      })
      .from(aiConversations)
      .where(where)
      .orderBy(desc(aiConversations.updatedAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(aiConversations)
      .where(where),
  ]);

  const items: AiConversationSummary[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    preview: String(row.preview ?? '').slice(0, 160),
    messageCount: Number(row.messageCount ?? 0),
    updatedAt: row.updatedAt.toISOString(),
  }));

  return {
    items,
    total: Number(countRow[0]?.count ?? 0),
    page: query.page,
    pageSize: query.pageSize,
  };
}

async function loadConversation(
  userId: string,
  id: string,
  before?: string,
): Promise<AiConversation> {
  await assertConversation(userId, id);

  const [row] = await db
    .select({ id: aiConversations.id, title: aiConversations.title, updatedAt: aiConversations.updatedAt })
    .from(aiConversations)
    .where(eq(aiConversations.id, id))
    .limit(1);
  if (!row) throw notFound('Conversación no encontrada');

  const where = and(
    eq(aiConversationMessages.conversationId, id),
    before ? lt(aiConversationMessages.createdAt, new Date(before)) : undefined,
  );

  const rows = await db
    .select()
    .from(aiConversationMessages)
    .where(where)
    .orderBy(
      desc(aiConversationMessages.createdAt),
      sql`case when ${aiConversationMessages.role} = 'assistant' then 0 else 1 end`,
    )
    .limit(PAGE_SIZE + 1);

  const hasMore = rows.length > PAGE_SIZE;
  const page = rows.slice(0, PAGE_SIZE).reverse();

  const templates = await loadAskTemplates(userId);
  const ctx: AskContext = { userId };

  const messages: AiConversationMessage[] = [];
  for (const message of page) {
    let result: AiAskResult | null = null;
    if (message.role === 'assistant' && message.plan) {
      try {
        result = await runWithPlan(ctx, message.plan, templates);
      } catch {
        // Un plan antiguo puede ya no ser ejecutable: se conserva el texto.
        result = null;
      }
    }
    messages.push({
      id: message.id,
      role: message.role === 'assistant' ? 'assistant' : 'user',
      text: result?.answer ?? message.content,
      result,
      createdAt: message.createdAt.toISOString(),
    });
  }

  return {
    id: row.id,
    title: row.title,
    messages,
    hasMore,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  app.get('/ai/conversations', async (request): Promise<AiConversationsPage> => {
    const user = await authenticate(request);
    return listForUser(user.sub, listQuery.parse(request.query));
  });

  app.post('/ai/conversations', async (request, reply) => {
    const user = await authenticate(request);
    const body = createBody.parse(request.body ?? {});
    const id = await createConversation(user.sub, body.title ?? 'Nueva consulta');
    return reply.status(201).send({ id });
  });

  app.get('/ai/conversations/:id', async (request): Promise<AiConversation> => {
    const user = await authenticate(request);
    const { id } = idParams.parse(request.params);
    const query = conversationQuery.parse(request.query);
    return loadConversation(user.sub, id, query.before);
  });

  app.patch('/ai/conversations/:id', async (request): Promise<{ ok: true }> => {
    const user = await authenticate(request);
    const { id } = idParams.parse(request.params);
    const body = updateBody.parse(request.body);
    await assertConversation(user.sub, id);
    await db
      .update(aiConversations)
      .set({ title: body.title, updatedAt: new Date() })
      .where(eq(aiConversations.id, id));
    return { ok: true };
  });

  app.delete('/ai/conversations/:id', async (request): Promise<{ ok: true }> => {
    const user = await authenticate(request);
    const { id } = idParams.parse(request.params);
    await assertConversation(user.sub, id);
    await db
      .update(aiConversations)
      .set({ deletedAt: new Date() })
      .where(eq(aiConversations.id, id));
    return { ok: true };
  });
}
