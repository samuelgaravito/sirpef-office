/**
 * Prueba de humo de la compartición de plantillas.
 *
 * Verifica que:
 * 1. el propietario comparte una plantilla con un usuario como editor;
 * 2. el editor puede mejorarla (el cambio se aplica a la plantilla original);
 * 3. la mejora queda en el historial firmada con el autor;
 * 4. el editor NO puede cambiar los ajustes de propiedad (visibilidad,
 *    numeración, tipo de documento);
 * 5. un lector puede usarla pero no editarla;
 * 6. el propietario puede restaurar una versión anterior;
 * 7. quitar el acceso deja al usuario sin permiso.
 *
 * Requiere la API en marcha, un administrador y un miembro activos.
 * Uso: npm run smoke:template-share
 */
import { and, eq } from 'drizzle-orm';

import { db } from '../src/db/index.js';
import { templateShares, templates, users } from '../src/db/schema.js';
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

type TemplatePayload = {
  template: {
    id: string;
    name: string;
    version: number;
    body: { type: string; content?: unknown[] };
  };
};

type DetailPayload = {
  template: { id: string; name: string; version: number; description: string };
  permission: 'owner' | 'editor' | 'viewer';
  ownerName: string | null;
  shares: { userId: string; permission: string }[];
};

type VersionsPayload = {
  items: { version: number; note: string; authorName: string | null }[];
};

async function main(): Promise<void> {
  const [owner] = await db
    .select()
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.isActive, true)))
    .limit(1);
  if (!owner) throw new Error('Se necesita un administrador activo');

  const [member] = await db
    .select()
    .from(users)
    .where(and(eq(users.role, 'member'), eq(users.isActive, true)))
    .limit(1);
  if (!member) throw new Error('Se necesita un miembro activo');

  const ownerToken = await signAccessToken({
    sub: owner.id,
    email: owner.email,
    name: owner.name,
    role: owner.role,
  });
  const memberToken = await signAccessToken({
    sub: member.id,
    email: member.email,
    name: member.name,
    role: member.role,
  });

  // Plantilla de trabajo del propietario.
  const created = await call<TemplatePayload>(
    '/templates',
    ownerToken,
    'POST',
    {
      name: `Plantilla de prueba ${Date.now()}`,
      description: 'Plantilla temporal para la prueba de compartición',
      docType: 'memorandum',
      schema: [],
      body: { type: 'doc', content: [{ type: 'paragraph' }] },
      isShared: false,
    },
  );
  assert(created.status === 201, 'el propietario crea una plantilla privada');
  const templateId = created.body.template.id;

  try {
    // 1. Compartir como editor.
    const share = await call(
      `/templates/${templateId}/shares`,
      ownerToken,
      'POST',
      { userId: member.id, permission: 'editor' },
    );
    assert(share.status === 200, 'el propietario comparte la plantilla como editor');

    const list = await call<{ items: { userId: string; permission: string }[] }>(
      `/templates/${templateId}/shares`,
      ownerToken,
    );
    assert(
      list.body.items.some(
        (item) => item.userId === member.id && item.permission === 'editor',
      ),
      'el acceso del editor aparece en la lista de accesos',
    );

    // 2. El editor puede mejorar la plantilla.
    const detailBefore = await call<DetailPayload>(`/templates/${templateId}`, memberToken);
    assert(
      detailBefore.body.permission === 'editor',
      'el editor ve la plantilla con permiso de edición',
    );

    const improved = await call<TemplatePayload>(
      `/templates/${templateId}`,
      memberToken,
      'PATCH',
      {
        description: 'Mejorada por un colaborador',
        body: { type: 'doc', content: [{ type: 'paragraph' }] },
        expectedVersion: detailBefore.body.template.version,
      },
    );
    assert(improved.status === 200, 'el editor puede guardar una mejora');

    const ownerDetail = await call<DetailPayload>(`/templates/${templateId}`, ownerToken);
    assert(
      ownerDetail.body.template.description === 'Mejorada por un colaborador',
      'la mejora se aplica a la plantilla original',
    );

    // 3. La mejora queda firmada en el historial.
    const versions = await call<VersionsPayload>(`/templates/${templateId}/versions`, ownerToken);
    const latest = versions.body.items[0];
    assert(
      latest?.authorName === member.name,
      'el historial muestra quién hizo la mejora',
    );

    // Una segunda mejora deja dos versiones en el historial: la que se va a
    // restaurar y la actual.
    const second = await call<TemplatePayload>(
      `/templates/${templateId}`,
      memberToken,
      'PATCH',
      {
        description: 'Segunda mejora del colaborador',
        expectedVersion: improved.body.template.version,
      },
    );
    assert(second.status === 200, 'el editor puede seguir mejorando la plantilla');

    // 4. El editor no puede tocar los ajustes de propiedad.
    const forbidden = await call(
      `/templates/${templateId}`,
      memberToken,
      'PATCH',
      { isShared: true },
    );
    assert(forbidden.status === 403, 'el editor no puede cambiar la visibilidad');

    const forbiddenNumbering = await call(
      `/templates/${templateId}`,
      memberToken,
      'PATCH',
      { numbering: { enabled: false } },
    );
    assert(
      forbiddenNumbering.status === 403,
      'el editor no puede cambiar la numeración',
    );

    // 5. Un lector puede ver la plantilla, pero no editarla.
    await call(
      `/templates/${templateId}/shares`,
      ownerToken,
      'POST',
      { userId: member.id, permission: 'viewer' },
    );
    const asViewer = await call<DetailPayload>(`/templates/${templateId}`, memberToken);
    assert(asViewer.body.permission === 'viewer', 'el permiso pasa a lector');

    const viewerEdit = await call(
      `/templates/${templateId}`,
      memberToken,
      'PATCH',
      { description: 'No debería guardarse' },
    );
    assert(viewerEdit.status === 403, 'el lector no puede editar la plantilla');

    // 6. El propietario restaura una versión anterior.
    const restore = await call<TemplatePayload>(
      `/templates/${templateId}/versions/${second.body.template.version - 1}/restore`,
      ownerToken,
      'POST',
    );
    assert(restore.status === 200, 'el propietario restaura una versión anterior');
    assert(
      restore.body.template.description === 'Mejorada por un colaborador',
      'la restauración devuelve el contenido anterior',
    );

    // La restauración no borra la historia: queda como una versión nueva.
    const versionsAfter = await call<VersionsPayload>(
      `/templates/${templateId}/versions`,
      ownerToken,
    );
    assert(
      versionsAfter.body.items.length > versions.body.items.length,
      'la restauración se guarda como una versión nueva',
    );

    // 7. Quitar el acceso deja al usuario sin permiso.
    const revoke = await call(
      `/templates/${templateId}/shares/${member.id}`,
      ownerToken,
      'DELETE',
    );
    assert(revoke.status === 200, 'el propietario retira el acceso');

    const afterRevoke = await call<DetailPayload>(`/templates/${templateId}`, memberToken);
    assert(afterRevoke.status === 404, 'sin acceso, la plantilla ya no se ve');

    console.log('\n✔ Flujo de compartición de plantillas verificado');
  } finally {
    // Limpieza: la plantilla y sus accesos.
    await db.delete(templateShares).where(eq(templateShares.templateId, templateId));
    await db.delete(templates).where(eq(templates.id, templateId));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
