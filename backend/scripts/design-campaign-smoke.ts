/**
 * Prueba de humo del diseño en uso.
 *
 * Verifica que:
 * 1. encender un diseño lo deja en uso y apaga el que lo estuviera;
 * 2. todas las plantillas de la cuenta se dibujan con el diseño en uso, sin
 *    tocar su estructura ni sus variables;
 * 3. un documento creado mientras hay un diseño en uso guarda ese diseño y
 *    no cambia después de encender otro;
 * 4. apagar el diseño en uso devuelve las plantillas al diseño que tenían
 *    guardado.
 *
 * Requiere la API en marcha y un administrador activo.
 * Uso: npm run smoke:campaign
 */
import { and, eq } from 'drizzle-orm';

import { db, sql } from '../src/db/index.js';
import { designs, documents, templates, users } from '../src/db/schema.js';
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

interface DesignPayload {
  id: string;
  name: string;
  tokens: { primaryColor: string };
  isCurrent?: boolean;
}

interface TemplatePayload {
  id: string;
  name: string;
  schema: Array<{ key: string }>;
  designId: string | null;
  designTokens: { primaryColor: string } | null;
  effectiveDesignId?: string | null;
  effectiveDesignName?: string | null;
}

interface DocumentPayload {
  document: { id: string; designId: string | null };
}

async function main(): Promise<void> {
  const [admin] = await db
    .select()
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.isActive, true)))
    .limit(1);
  if (!admin) throw new Error('Se necesita un administrador activo');

  const token = await signAccessToken({
    sub: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });

  // Dos diseños de prueba con colores distintos.
  const createdDesigns: string[] = [];
  const createdDocs: string[] = [];
  let createdTemplate: string | null = null;

  // Diseño en uso original: se restaura al terminar (la prueba enciende y
  // apaga diseños).
  const [originalActive] = await db
    .select({ id: designs.id })
    .from(designs)
    .where(and(eq(designs.ownerId, admin.id), eq(designs.isCurrent, true)))
    .limit(1);

  async function createDesign(name: string, color: string): Promise<DesignPayload['design']> {
    const created = await call<{ design: DesignPayload }>('/designs', token, 'POST', {
      name,
      description: 'Diseño de prueba',
      tokens: {
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: 11,
        lineHeight: 1.5,
        primaryColor: color,
        textColor: '#1a1a1a',
        backgroundColor: '#ffffff',
        tableHeadColor: '#e8eef5',
        tableBorderColor: '#c9d2dd',
        accentColor: '#c0392b',
        pageFormat: 'A4',
        orientation: 'portrait',
        margins: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5, header: 1.25, footer: 1.25 },
        header: {
          enabled: false,
          content: { type: 'doc', content: [{ type: 'paragraph' }] },
          align: 'center',
        },
        footer: {
          enabled: true,
          content: 'Página {page} de {total}',
          align: 'center',
          showPageNumber: true,
          showTotal: true,
        },
        logo: { enabled: false, dataUrl: '', width: 120, align: 'center' },
        letterhead: { enabled: false, title: '', subtitle: '', align: 'center' },
        headingScale: 1,
      },
      isShared: false,
    });
    if (created.status !== 201) throw new Error('No se pudo crear el diseño de prueba');
    createdDesigns.push(created.body.design.id);
    return created.body.design;
  }

  try {
    const navidad = await createDesign(`Navidad ${Date.now()}`, '#0f5132');
    const anioNuevo = await createDesign(`Año nuevo ${Date.now()}`, '#12304f');

    /* Plantilla de prueba con el diseño de Navidad guardado. */
    const templateResponse = await call<{ template: { id: string } }>('/templates', token, 'POST', {
      name: `Plantilla de prueba ${Date.now()}`,
      description: 'Plantilla temporal de la prueba',
      docType: 'report',
      designId: navidad.id,
      schema: [{ key: 'titulo', label: 'Título', type: 'text' }],
      body: {
        type: 'doc',
        content: [
          { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '{{titulo}}' }] },
        ],
      },
      isShared: false,
    });
    if (templateResponse.status !== 201) {
      throw new Error('No se pudo crear la plantilla de prueba');
    }
    const templateId = templateResponse.body.template.id;
    createdTemplate = templateId;

    /* 1. Encender un diseño lo deja en uso. */
    const on = await call(`/designs/${navidad.id}/activate`, token, 'POST', { isCurrent: true });
    assert(on.status === 200, 'Se puede encender un diseño');
    assert(
      on.body.design.isCurrent === true,
      'El diseño encendido queda en uso',
    );

    const list = await call<{ items: DesignPayload[] }>('/designs', token);
    const encendidos = list.body.items.filter((item) => item.isCurrent);
    assert(encendidos.length === 1, 'Solo hay un diseño en uso');
    assert(encendidos[0]?.id === navidad.id, 'El diseño en uso es el que se encendió');

    /* 2. Las plantillas cargan el diseño en uso. */
    const before = await call<TemplatePayload>(`/templates/${templateId}`, token);
    assert(
      before.body.effectiveDesignId === navidad.id,
      'La plantilla se dibuja con el diseño en uso',
    );
    const schemaBefore = JSON.stringify(before.body.template.schema);
    const bodyBefore = JSON.stringify(before.body.template.body);

    /* 3. Un documento creado ahora guarda el diseño en uso. */
    const doc = await call<DocumentPayload>('/documents', token, 'POST', {
      templateId,
      title: 'Documento de Navidad',
    });
    assert(doc.status === 201, 'Se crea un documento desde la plantilla');
    createdDocs.push(doc.body.document.id);
    assert(
      doc.body.document.designId === navidad.id,
      'El documento guarda el diseño que estaba en uso',
    );

    /* 4. Encender otro diseño cambia las plantillas… */
    const on2 = await call(`/designs/${anioNuevo.id}/activate`, token, 'POST', { isCurrent: true });
    assert(on2.status === 200, 'Se puede encender otro diseño');

    const after = await call<TemplatePayload>(`/templates/${templateId}`, token);
    assert(
      after.body.effectiveDesignId === anioNuevo.id,
      'Las plantillas pasan al diseño nuevo sin recrearse',
    );
    assert(
      JSON.stringify(after.body.template.schema) === schemaBefore,
      'El cambio de diseño no altera las variables de la plantilla',
    );
    assert(
      JSON.stringify(after.body.template.body) === bodyBefore,
      'El cambio de diseño no altera la estructura de la plantilla',
    );

    /* …pero el documento ya creado conserva su diseño. */
    const docDetail = await call<DocumentPayload>(`/documents/${doc.body.document.id}`, token);
    assert(
      docDetail.body.document.designId === navidad.id,
      'El documento ya creado conserva el diseño con el que nació',
    );

    /* 5. Solo puede haber un diseño en uso. */
    const list2 = await call<{ items: DesignPayload[] }>('/designs', token);
    assert(
      list2.body.items.filter((item) => item.isCurrent).length === 1,
      'Sigue habiendo un único diseño en uso',
    );
    assert(
      list2.body.items.find((item) => item.id === navidad.id)?.isCurrent === false,
      'El diseño anterior se apagó solo',
    );

    /* 6. Apagar el diseño en uso devuelve las plantillas al que tenían. */
    const off = await call(`/designs/${anioNuevo.id}/activate`, token, 'POST', { isCurrent: false });
    assert(off.status === 200, 'Se puede apagar el diseño en uso');

    const fallback = await call<TemplatePayload>(`/templates/${templateId}`, token);
    assert(
      fallback.body.effectiveDesignId === navidad.id,
      'Sin diseño en uso, la plantilla usa el que tenía guardado',
    );
  } finally {
    for (const id of createdDocs) {
      await db.delete(documents).where(eq(documents.id, id));
    }
    if (createdTemplate) {
      await db.delete(templates).where(eq(templates.id, createdTemplate));
    }
    for (const id of createdDesigns) {
      await db.delete(designs).where(eq(designs.id, id));
    }
    // Restaura el diseño en uso que había antes de la prueba.
    if (originalActive) {
      await db
        .update(designs)
        .set({ isCurrent: true })
        .where(eq(designs.id, originalActive.id));
    }
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
