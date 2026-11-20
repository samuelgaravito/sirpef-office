import { and, desc, eq, inArray, isNull, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z, ZodError } from 'zod';

import { AI_DRAFT_MAX_MESSAGES, plainTextFromContent } from '@sirpefoffice/shared';
import type {
  AiDraftMessage,
  AiDraftResult,
  AiInlineContext,
  JSONContent,
  VariableDef,
} from '@sirpefoffice/shared';

import { db } from '../../db/index.js';
import { aiNodes, documents, templateShares, templates } from '../../db/schema.js';
import { assertDocument, assertDocumentMutable, getTemplateAccess } from '../../lib/access.js';
import { logActivity } from '../../lib/activity.js';
import { authenticate, requireAdmin } from '../../lib/auth-guard.js';
import { AppError, badRequest, conflict, forbidden, internal, newReference, notFound } from '../../lib/errors.js';
import { compactZodIssues, summarizeZodIssues } from '../../lib/validation.js';
import { docTypeSchema, jsonContentSchema } from '../../lib/validators.js';
import { defaultData, saveVersion } from '../documents/routes.js';
import { askDocuments, askPlanSchema, askRequestSchema, loadAskTemplates, runWithPlan } from './ask.js';
import {
  appendTurn,
  assertConversation,
  conversationHistory,
  createConversation,
  discardConversation,
} from './conversations.js';
import { deriveStyle, draftDocument, type DraftInput } from './draft.js';
import { inlineText } from './inline.js';
import { connectedNodes } from './nodes/registry.js';
import { toNodeSummary } from './nodes/summary.js';
import type { AiConfig } from './providers.js';
import {
  clearApiKey,
  generateVariables,
  loadConfig,
  saveConfig,
  testConnection,
  toPublicConfig,
} from './service.js';
import { chooseTemplate, MAX_TEMPLATE_CANDIDATES } from './template-choice.js';

const configSchema = z.object({
  provider: z.enum(['none', 'openai', 'anthropic', 'gemini', 'ollama']).optional(),
  baseUrl: z.string().max(500).optional(),
  apiKey: z.string().max(500).optional(),
  model: z.string().max(200).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(64).max(32_000).optional(),
});

const draftMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1).max(8_000),
});

const draftCurrentSchema = z.object({
  title: z.string().max(240).optional(),
  description: z.string().max(500).optional(),
  content: jsonContentSchema.optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

const draftSchema = z.object({
  messages: z.array(draftMessageSchema).min(1).max(AI_DRAFT_MAX_MESSAGES),
  current: draftCurrentSchema.optional(),
  /** `false` evita enviar extractos de documentos aprobados. */
  useExamples: z.boolean().optional(),
});

const documentDraftSchema = draftSchema.extend({
  expectedVersion: z.number().int().positive().optional(),
});

const generateSchema = z.object({
  overwrite: z.boolean().optional(),
  instructions: z.string().max(4000).optional(),
});

const chooseTemplateSchema = z.object({
  prompt: z.string().trim().min(3).max(2_000),
});

const inlineContextSchema = z.object({
  selection: z.string().max(12_000).optional(),
  before: z.string().max(6_000).optional(),
  after: z.string().max(6_000).optional(),
  docType: docTypeSchema.optional(),
  title: z.string().max(240).optional(),
  templateName: z.string().max(200).optional(),
});

const inlineSchema = z.object({
  documentId: z.uuid().optional(),
  templateId: z.uuid().optional(),
  instruction: z.string().trim().min(3).max(4_000),
  mode: z.enum(['insert', 'replace']).optional(),
  context: inlineContextSchema.optional(),
});


/** Extractos de documentos aprobados del usuario para anclar el estilo. */
async function loadStyleExamples(userId: string, templateId: string): Promise<string[]> {
  const rows = await db
    .select({ content: documents.content })
    .from(documents)
    .where(
      and(
        eq(documents.templateId, templateId),
        eq(documents.ownerId, userId),
        inArray(documents.status, ['approved', 'sent', 'final']),
        isNull(documents.deletedAt),
      ),
    )
    .orderBy(desc(documents.updatedAt))
    .limit(3);

  return rows
    .map((row) => plainTextFromContent(row.content))
    .filter((text) => text.trim().length > 0)
    .map((text) => (text.length > 900 ? `${text.slice(0, 900)}…` : text));
}

function toDraftTemplate(template: {
  name: string;
  docType: string;
  schema: VariableDef[];
  body: JSONContent;
  aiInstructions: string | null;
  aiStyle: string | null;
}) {
  return {
    name: template.name,
    docType: template.docType,
    schema: template.schema,
    body: template.body,
    aiInstructions: template.aiInstructions,
    aiStyle: template.aiStyle,
  };
}

type AuthUser = Awaited<ReturnType<typeof authenticate>>;
type DraftBody = z.infer<typeof draftSchema>;
type DocumentDraftBody = z.infer<typeof documentDraftSchema>;

/** Todo lo que necesita una llamada al redactor, ya validado y autorizado. */
interface PreparedDraft {
  config: AiConfig;
  input: DraftInput;
}

/** Prepara el redactor para una plantilla (documento nuevo). */
async function prepareTemplateDraft(
  user: AuthUser,
  templateId: string,
  body: DraftBody,
): Promise<PreparedDraft> {
  const { template } = await getTemplateAccess(user.sub, templateId, user.role);
  if (!template.isActive) {
    throw badRequest('La plantilla está inactiva y no se puede usar para redactar');
  }

  const config = await loadConfig({ userId: user.sub });
  const examples =
    body.useExamples === false ? [] : await loadStyleExamples(user.sub, template.id);

  return {
    config,
    input: {
      template: toDraftTemplate({
        name: template.name,
        docType: template.docType,
        schema: template.schema ?? [],
        body: template.body,
        aiInstructions: template.aiInstructions,
        aiStyle: template.aiStyle,
      }),
      current: {
        title: body.current?.title ?? template.name,
        description: body.current?.description ?? template.description.slice(0, 500),
        content: body.current?.content ?? template.body,
        data: { ...defaultData(template.schema ?? []), ...(body.current?.data ?? {}) },
      },
      messages: body.messages as AiDraftMessage[],
      examples,
    },
  };
}

/** Prepara el redactor para un documento existente. */
async function prepareDocumentDraft(
  user: AuthUser,
  id: string,
  body: DocumentDraftBody,
): Promise<PreparedDraft> {
  const { document } = await assertDocument(user.sub, id, 'editor');
  assertDocumentMutable(document);

  if (body.expectedVersion !== undefined && body.expectedVersion !== document.version) {
    throw conflict('El documento se modificó en otra sesión', {
      currentVersion: document.version,
    });
  }

  const [template] = document.templateId
    ? await db
        .select()
        .from(templates)
        .where(and(eq(templates.id, document.templateId), isNull(templates.deletedAt)))
        .limit(1)
    : [];

  const config = await loadConfig({ userId: user.sub });
  const examples =
    body.useExamples === false || !template
      ? []
      : await loadStyleExamples(user.sub, template.id);

  return {
    config,
    input: {
      template: template
        ? toDraftTemplate({
            name: template.name,
            docType: template.docType,
            schema: template.schema ?? [],
            body: template.body,
            aiInstructions: template.aiInstructions,
            aiStyle: template.aiStyle,
          })
        : {
            name: document.title,
            docType: document.docType,
            schema: [],
            body: document.content,
            aiInstructions: null,
            aiStyle: null,
          },
      current: {
        title: body.current?.title ?? document.title,
        description: body.current?.description ?? document.description,
        content: body.current?.content ?? document.content,
        data: body.current?.data ?? document.data,
      },
      messages: body.messages as AiDraftMessage[],
      examples,
    },
  };
}

/** Traduce un error a la forma que viaja por el flujo NDJSON. */
function streamError(error: unknown, request: FastifyRequest): Record<string, unknown> {
  if (error instanceof AppError) {
    return {
      error: error.code,
      message: error.message,
      ...(error.details ? { details: error.details } : {}),
    };
  }

  if (error instanceof ZodError) {
    return {
      error: 'VALIDATION_ERROR',
      message: summarizeZodIssues(error),
      details: compactZodIssues(error),
    };
  }

  const reference = newReference();
  request.log.error({ err: error, reference }, 'Error no controlado en el asistente');
  return {
    error: 'INTERNAL_ERROR',
    message: `Ocurrió un fallo al procesar la solicitud. Si el problema continúa, communícalo con la referencia ${reference}.`,
    reference,
  };
}

/**
 * Responde en NDJSON: primero los avances y al final el resultado (o el
 * error). La vista se toma con `reply.hijack()` porque la respuesta se
 * escribe a mano, fuera del ciclo normal de Fastify.
 */
async function streamDraft(
  request: FastifyRequest,
  reply: FastifyReply,
  run: (onProgress: (chars: number) => void) => Promise<AiDraftResult>,
): Promise<void> {
  reply.hijack();
  const raw = reply.raw;

  raw.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    'x-accel-buffering': 'no',
  });

  let abierto = true;
  raw.on('close', () => {
    abierto = false;
  });

  const send = (event: unknown): void => {
    if (!abierto || raw.writableEnded) return;
    raw.write(`${JSON.stringify(event)}\n`);
  };

  try {
    const result = await run((chars) => send({ type: 'progress', chars }));
    send({ type: 'result', result });
  } catch (error) {
    send({ type: 'error', error: streamError(error, request) });
  } finally {
    if (!raw.writableEnded) raw.end();
  }
}

/**
 * Deja constancia de que una tarea la atendió el equipo del usuario.
 *
 * Guarda el nodo y el modelo, nunca el prompt ni la respuesta. Si la tarea la
 * hizo el proveedor del servidor no se registra aquí: eso ya queda en la
 * actividad normal de la operación.
 */
function logNodeUsage(
  userId: string,
  entityType: 'document' | 'template' | 'user',
  entityId: string,
  task: string,
  config: AiConfig,
): void {
  if (!config.node) return;
  void logActivity(userId, entityType, entityId, 'ai_node_used', {
    nodeId: config.node.id,
    nodeName: config.node.name,
    model: config.model,
    task,
  });
}

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  /** Estado del proveedor, visible para cualquier usuario autenticado. */
  app.get('/ai/status', async (request) => {
    const user = await authenticate(request);
    const config = await loadConfig({ userId: user.sub });
    const publicConfig = toPublicConfig(config);

    // Equipos del usuario: la interfaz muestra el estado y permite saber si la
    // redacción se está haciendo en su propia GPU.
    const rows = await db
      .select()
      .from(aiNodes)
      .where(and(eq(aiNodes.userId, user.sub), isNull(aiNodes.revokedAt)))
      .orderBy(desc(aiNodes.createdAt));
    const live = new Map(connectedNodes().map((node) => [node.id, node]));
    const nodes = rows.map((row) => toNodeSummary(row, live.get(row.id)));

    return {
      configured: publicConfig.configured,
      provider: publicConfig.provider,
      model: publicConfig.model,
      /** `node` = lo atiende el equipo del usuario; `server` = el proveedor. */
      mode: config.node ? 'node' : publicConfig.configured ? 'server' : 'none',
      node: config.node ? { id: config.node.id, name: config.node.name, model: config.model } : null,
      nodes,
    };
  });

  /** Configuración completa (solo administradores). */
  app.get('/ai/settings', async (request) => {
    await requireAdmin(request);
    const config = await loadConfig();
    return { settings: toPublicConfig(config) };
  });

  /** Guarda la configuración del proveedor. */
  app.put('/ai/settings', async (request) => {
    const admin = await requireAdmin(request);
    const body = configSchema.parse(request.body);

    const config = await saveConfig(body, admin.sub);
    await logActivity(admin.sub, 'user', admin.sub, 'ai_settings_updated', {
      provider: config.provider,
      model: config.model,
    });

    return { settings: toPublicConfig(config) };
  });

  /** Elimina la clave de API almacenada. */
  app.delete('/ai/key', async (request) => {
    const admin = await requireAdmin(request);
    const config = await clearApiKey(admin.sub);
    return { settings: toPublicConfig(config) };
  });

  /** Prueba la conexión con el proveedor configurado. */
  app.post('/ai/test', async (request) => {
    await requireAdmin(request);
    const config = await loadConfig();
    const result = await testConnection(config);
    return result;
  });

  /**
   * Elige la plantilla que mejor sirve de molde para un encargo escrito en
   * lenguaje natural. No crea nada: la interfaz navega al editor con ella.
   */
  app.post('/ai/choose-template', async (request) => {
    const user = await authenticate(request);
    const body = chooseTemplateSchema.parse(request.body ?? {});

    // Misma visibilidad que el listado de plantillas: propias, compartidas
    // con este usuario y compartidas con todo el mundo.
    const sharedWithMe = inArray(
      templates.id,
      db
        .select({ templateId: templateShares.templateId })
        .from(templateShares)
        .where(eq(templateShares.userId, user.sub)),
    );
    const sharedGlobal = and(
      eq(templates.isShared, true),
      sql`${templates.ownerId} <> ${user.sub}`,
    );

    // Solo las activas: una plantilla inactiva no se puede usar para redactar.
    const candidates = await db
      .select({
        id: templates.id,
        name: templates.name,
        docType: templates.docType,
        description: templates.description,
        aiInstructions: templates.aiInstructions,
        updatedAt: templates.updatedAt,
      })
      .from(templates)
      .where(
        and(
          or(eq(templates.ownerId, user.sub), sharedWithMe, sharedGlobal),
          eq(templates.isActive, true),
          isNull(templates.deletedAt),
        ),
      )
      .orderBy(desc(templates.updatedAt))
      .limit(MAX_TEMPLATE_CANDIDATES);

    const config = await loadConfig({ userId: user.sub });
    const choice = await chooseTemplate(config, body.prompt, candidates);
    logNodeUsage(user.sub, 'user', user.sub, 'choose-template', config);
    return choice;
  });

  /**
   * Modo consulta: responde preguntas sobre los documentos del usuario
   * («cuántas notas de entrega envié este mes», «búscame la de Samuel»).
   *
   * El modelo solo produce un plan; la consulta y las cifras se resuelven en
   * el servidor con la visibilidad del usuario. Cada turno queda guardado en
   * una conversación (se crea sola si el cliente no manda `conversationId`).
   */
  app.post('/ai/ask', async (request) => {
    const user = await authenticate(request);
    const body = askRequestSchema.parse(request.body ?? {});
    const config = await loadConfig({ userId: user.sub });

    if (body.conversationId) {
      await assertConversation(user.sub, body.conversationId);
    }
    const created = !body.conversationId;
    const conversationId =
      body.conversationId ?? (await createConversation(user.sub, body.question));

    // Con conversación, el historial sale de la base: el cliente no lo manda.
    const history = body.conversationId
      ? await conversationHistory(conversationId)
      : body.history;

    try {
      const result = await askDocuments(config, body.question, { userId: user.sub }, {
        ...(body.plan ? { plan: body.plan } : {}),
        ...(body.filters ? { filters: body.filters } : {}),
        ...(history ? { history } : {}),
      });

      await appendTurn(conversationId, body.question, result);
      logNodeUsage(user.sub, 'user', user.sub, 'ask', config);
      return { ...result, conversationId };
    } catch (error) {
      // Una conversación recién creada que no llegó a responder no se guarda.
      if (created) await discardConversation(conversationId);
      throw error;
    }
  });

  /**
   * Ejecuta un plan ya resuelto sin modelo y sin conversación.
   *
   * Lo usan los informes guardados y cualquier vista que quiera repetir una
   * consulta con los permisos actuales.
   */
  app.post('/ai/run', async (request) => {
    const user = await authenticate(request);
    const body = z.object({ plan: askPlanSchema }).parse(request.body ?? {});
    const templates = await loadAskTemplates(user.sub);
    return runWithPlan({ userId: user.sub }, body.plan, templates);
  });

  /**
   * Genera un fragmento para insertar o reemplazar en el cursor.
   *
   * La barra inferior de la hoja lo usa para «escribe un párrafo sobre…»,
   * «mejora la selección», etc. No guarda nada: el cliente aplica el
   * fragmento y el autoguardado sigue su curso normal.
   */
  app.post('/ai/inline', async (request) => {
    const user = await authenticate(request);
    const body = inlineSchema.parse(request.body ?? {});
    const config = await loadConfig({ userId: user.sub });

    let context: AiInlineContext = body.context ?? {};

    if (body.documentId) {
      const { document } = await assertDocument(user.sub, body.documentId, 'editor');
      context = {
        ...context,
        docType: context.docType ?? document.docType,
        title: context.title ?? document.title,
      };
    } else if (body.templateId) {
      const { template, permission } = await getTemplateAccess(
        user.sub,
        body.templateId,
        user.role,
      );
      if (permission === 'viewer') {
        throw forbidden('Necesitas permiso de edición sobre esta plantilla');
      }
      context = {
        ...context,
        docType: context.docType ?? template.docType,
        title: context.title ?? template.name,
        templateName: context.templateName ?? template.name,
      };
    }

    const result = await inlineText(config, { instruction: body.instruction, context });
    logNodeUsage(
      user.sub,
      body.documentId ? 'document' : body.templateId ? 'template' : 'user',
      body.documentId ?? body.templateId ?? user.sub,
      'inline',
      config,
    );
    return result;
  });

  /**
   * Rellena las variables vacías del documento con el proveedor configurado.
   * No modifica el cuerpo: solo los datos, de modo que el formato se conserva.
   */
  app.post('/documents/:id/ai/generate', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = generateSchema.parse(request.body ?? {});

    const { document } = await assertDocument(user.sub, id, 'editor');
    assertDocumentMutable(document);

    if (!document.templateId) {
      throw badRequest('Este documento no proviene de una plantilla con variables definidas');
    }

    const [template] = await db
      .select({ schema: templates.schema, aiInstructions: templates.aiInstructions, name: templates.name })
      .from(templates)
      .where(and(eq(templates.id, document.templateId), isNull(templates.deletedAt)))
      .limit(1);

    if (!template) throw notFound('La plantilla del documento ya no existe');

    const config = await loadConfig({ userId: user.sub });
    const schema = (template.schema ?? []) as VariableDef[];

    const result = await generateVariables(config, {
      title: document.title,
      docType: document.docType,
      schema,
      data: document.data,
      instructions: body.instructions ?? template.aiInstructions,
      overwrite: body.overwrite ?? false,
    });

    const [updated] = await db
      .update(documents)
      .set({ data: result.data, version: document.version + 1, updatedAt: new Date() })
      .where(eq(documents.id, id))
      .returning();

    if (!updated) throw internal('AI_SAVE_FAILED', 'No se pudo guardar el contenido generado');

    await saveVersion(id, user.sub, 'ai', `Redacción IA (${config.model})`);
    await logActivity(user.sub, 'document', id, 'ai_generated', {
      provider: config.provider,
      model: config.model,
      filled: result.filled,
    });
    logNodeUsage(user.sub, 'document', id, 'generate', config);

    return { data: result.data, filled: result.filled, version: updated.version };
  });
  /**
   * Asistente de redacción para un documento nuevo: recibe el historial de la
   * conversación y devuelve una propuesta completa sin guardar nada.
   */
  app.post('/templates/:templateId/ai/draft', async (request) => {
    const user = await authenticate(request);
    const { templateId } = z.object({ templateId: z.uuid() }).parse(request.params);
    const body = draftSchema.parse(request.body);

    const prepared = await prepareTemplateDraft(user, templateId, body);
    const result = await draftDocument(prepared.config, prepared.input);
    logNodeUsage(user.sub, 'template', templateId, 'draft', prepared.config);
    return result;
  });

  /**
   * Igual que la anterior, pero cuenta el avance mientras el modelo escribe
   * (NDJSON). Es la que usa el asistente en pantalla.
   */
  app.post('/templates/:templateId/ai/draft/stream', async (request, reply) => {
    const user = await authenticate(request);
    const { templateId } = z.object({ templateId: z.uuid() }).parse(request.params);
    const body = draftSchema.parse(request.body);

    const prepared = await prepareTemplateDraft(user, templateId, body);
    await streamDraft(request, reply, async (onProgress) => {
      const result = await draftDocument(prepared.config, prepared.input, { onProgress });
      logNodeUsage(user.sub, 'template', templateId, 'draft', prepared.config);
      return result;
    });
  });

  /**
   * Deduce un perfil de estilo a partir de documentos aprobados. No guarda:
   * el editor de plantillas lo revisa y lo guarda con el PATCH normal.
   */
  app.post('/templates/:id/ai/style', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);

    const { template, permission } = await getTemplateAccess(user.sub, id, user.role);
    if (permission === 'viewer') {
      throw forbidden('Necesitas permiso de edición sobre esta plantilla');
    }

    const examples = await loadStyleExamples(user.sub, template.id);
    if (examples.length === 0) {
      throw badRequest(
        'Todavía no hay documentos aprobados de esta plantilla para deducir el estilo. Escribe el perfil a mano o espera a tener ejemplos.',
      );
    }

    const config = await loadConfig({ userId: user.sub });
    const style = await deriveStyle(config, {
      templateName: template.name,
      docType: template.docType,
      aiInstructions: template.aiInstructions,
      aiStyle: template.aiStyle,
      examples,
    });

    logNodeUsage(user.sub, 'template', id, 'style', config);
    return { style };
  });

  /**
   * Asistente de redacción sobre un documento existente. No escribe en la
   * base: el cliente aplica la propuesta y el guardado sigue su curso normal
   * (con versionado optimista).
   */
  app.post('/documents/:id/ai/draft', async (request) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = documentDraftSchema.parse(request.body);

    const prepared = await prepareDocumentDraft(user, id, body);
    const result = await draftDocument(prepared.config, prepared.input);
    logNodeUsage(user.sub, 'document', id, 'draft', prepared.config);
    return result;
  });

  /** Igual que la anterior, con el avance en NDJSON. */
  app.post('/documents/:id/ai/draft/stream', async (request, reply) => {
    const user = await authenticate(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const body = documentDraftSchema.parse(request.body);

    const prepared = await prepareDocumentDraft(user, id, body);
    await streamDraft(request, reply, async (onProgress) => {
      const result = await draftDocument(prepared.config, prepared.input, { onProgress });
      logNodeUsage(user.sub, 'document', id, 'draft', prepared.config);
      return result;
    });
  });

}
