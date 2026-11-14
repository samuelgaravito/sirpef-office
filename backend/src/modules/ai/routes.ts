import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { AI_DRAFT_MAX_MESSAGES, plainTextFromContent } from '@sirpefoffice/shared';
import type { AiDraftMessage, JSONContent, VariableDef } from '@sirpefoffice/shared';

import { db } from '../../db/index.js';
import { documents, templates } from '../../db/schema.js';
import { assertDocument, assertDocumentMutable, getTemplateAccess } from '../../lib/access.js';
import { logActivity } from '../../lib/activity.js';
import { authenticate, requireAdmin } from '../../lib/auth-guard.js';
import { badRequest, conflict, forbidden, internal, notFound } from '../../lib/errors.js';
import { jsonContentSchema } from '../../lib/validators.js';
import { defaultData, saveVersion } from '../documents/routes.js';
import { deriveStyle, draftDocument } from './draft.js';
import {
  clearApiKey,
  generateVariables,
  loadConfig,
  saveConfig,
  testConnection,
  toPublicConfig,
} from './service.js';

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

export async function aiRoutes(app: FastifyInstance): Promise<void> {
  /** Estado del proveedor, visible para cualquier usuario autenticado. */
  app.get('/ai/status', async (request) => {
    await authenticate(request);
    const config = await loadConfig();
    const publicConfig = toPublicConfig(config);
    return {
      configured: publicConfig.configured,
      provider: publicConfig.provider,
      model: publicConfig.model,
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

    const config = await loadConfig();
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

    const { template } = await getTemplateAccess(user.sub, templateId, user.role);
    if (!template.isActive) {
      throw badRequest('La plantilla está inactiva y no se puede usar para redactar');
    }

    const config = await loadConfig();
    const messages = body.messages as AiDraftMessage[];
    const examples =
      body.useExamples === false ? [] : await loadStyleExamples(user.sub, template.id);

    return draftDocument(config, {
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
      messages,
      examples,
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

    const config = await loadConfig();
    const style = await deriveStyle(config, {
      templateName: template.name,
      docType: template.docType,
      aiInstructions: template.aiInstructions,
      aiStyle: template.aiStyle,
      examples,
    });

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

    const config = await loadConfig();
    const messages = body.messages as AiDraftMessage[];
    const examples =
      body.useExamples === false || !template
        ? []
        : await loadStyleExamples(user.sub, template.id);

    return draftDocument(config, {
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
      messages,
      examples,
    });
  });

}
