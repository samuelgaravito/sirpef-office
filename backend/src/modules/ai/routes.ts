import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { VariableDef } from '@sirpefoffice/shared';

import { db } from '../../db/index.js';
import { documents, templates } from '../../db/schema.js';
import { assertDocument, assertDocumentMutable } from '../../lib/access.js';
import { logActivity } from '../../lib/activity.js';
import { authenticate, requireAdmin } from '../../lib/auth-guard.js';
import { badRequest, internal, notFound } from '../../lib/errors.js';
import { saveVersion } from '../documents/routes.js';
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

const generateSchema = z.object({
  overwrite: z.boolean().optional(),
  instructions: z.string().max(4000).optional(),
});

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
}
