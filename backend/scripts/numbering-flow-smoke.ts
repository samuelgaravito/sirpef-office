/**
 * Prueba de humo de la numeración diferida.
 *
 * Verifica que:
 * 1. crear un borrador no consume el correlativo;
 * 2. el detalle expone un número previsto sin reservarlo;
 * 3. oficializar el documento asigna el número;
 * 4. dos documentos oficializados seguidos reciben números consecutivos;
 * 5. dos oficializaciones simultáneas no repiten número;
 * 6. un documento en la papelera no bloquea la oficialización de otro y
 *    restaurarlo nunca falla por su número;
 * 7. guardar el mismo contenido no incrementa la versión;
 * 8. cada plantilla lleva su propia enumeración: dos plantillas pueden usar
 *    el mismo prefijo y sus contadores no se intercalan.
 *
 * Requiere la API en marcha y un administrador activo.
 * Uso: npm run smoke:numbering
 */
import { and, eq, isNotNull, isNull } from 'drizzle-orm';

import { DOC_TYPE_PREFIX } from '@sirpefoffice/shared';

import { db, sql } from '../src/db/index.js';
import {
  documentCounters,
  documents,
  numberingSeries,
  templates,
  users,
} from '../src/db/schema.js';
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

type NumberingPreviewPayload = {
  number: string;
  prefix: string;
  seriesLabel: string;
  nextValue: number;
  includeYear: boolean;
  year: number;
};

type DocumentPayload = {
  document: {
    id: string;
    version: number;
    docNumber: string | null;
    pendingDocNumber?: string | null;
    numberingPreview?: NumberingPreviewPayload | null;
  };
};

async function main(): Promise<void> {
  const [admin] = await db
    .select()
    .from(users)
    .where(and(eq(users.role, 'admin'), eq(users.isActive, true)))
    .limit(1);

  if (!admin) throw new Error('Se necesita un administrador activo');

  const [template] = await db
    .select()
    .from(templates)
    .where(and(eq(templates.isActive, true), eq(templates.numberingEnabled, true)))
    .limit(1);

  if (!template) throw new Error('Se necesita una plantilla activa con numeración');

  const token = await signAccessToken({
    sub: admin.id,
    email: admin.email,
    name: admin.name,
    role: admin.role,
  });

  const createdIds: string[] = [];
  const createdTemplateIds: string[] = [];
  /** Series creadas por las plantillas de prueba (se borran al terminar). */
  const createdSeriesIds: string[] = [];
  const scope = template.numberingPrefix ?? DOC_TYPE_PREFIX[template.docType];
  // La serie declara a su plantilla: se busca por `template_id`.
  const [series] = await db
    .select()
    .from(numberingSeries)
    .where(eq(numberingSeries.templateId, template.id))
    .limit(1);
  if (!series) throw new Error(`La plantilla "${template.name}" no tiene serie de numeración propia`);
  const seriesId = series.id;
  const year = series.includeYear ? new Date().getFullYear() : 0;

  const [counterBefore] = await db
    .select()
    .from(documentCounters)
    .where(and(eq(documentCounters.seriesId, seriesId), eq(documentCounters.year, year)))
    .limit(1);

  async function createDraft(): Promise<DocumentPayload['document']> {
    const created = await call<DocumentPayload>('/documents', token, 'POST', {
      templateId: template.id,
      // Cuerpo mínimo con la variable de sistema para poder comprobar que el
      // previsto se refleja en el documento.
      content: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'Nº ' },
              { type: 'text', text: '{{numero_documento}}' },
            ],
          },
        ],
      },
    });
    assert(created.status === 201, 'Se crea un borrador');
    assert(created.body.document.docNumber === null, 'El borrador nace sin número asignado');
    createdIds.push(created.body.document.id);
    return created.body.document;
  }

  async function readCounter(): Promise<number> {
    const [row] = await db
      .select()
      .from(documentCounters)
      .where(and(eq(documentCounters.seriesId, seriesId), eq(documentCounters.year, year)))
      .limit(1);
    return row?.counter ?? 0;
  }

  try {
    /* 1. Crear un borrador no consume el contador. */
    const draft = await createDraft();
    assert(
      (await readCounter()) === (counterBefore?.counter ?? 0),
      'Crear el borrador no modifica document_counters',
    );

    /* 2. El detalle expone un número previsto sin reservarlo. */
    const detail = await call<DocumentPayload>(`/documents/${draft.id}`, token);
    assert(detail.status === 200, 'Se lee el detalle del borrador');
    assert(
      Boolean(detail.body.document.numberingPreview?.number),
      'El borrador muestra un número previsto con los datos de la serie',
    );
    assert(
      Boolean(detail.body.document.numberingPreview?.seriesLabel),
      'El previsto incluye la etiqueta de la serie',
    );
    assert(
      (await readCounter()) === (counterBefore?.counter ?? 0),
      'Consultar el previsto no reserva el número',
    );

    /* 2a. El listado también trae el previsto (cálculo en lote). */
    const list = await call<{
      items: Array<{ id: string; numberingPreview?: NumberingPreviewPayload | null }>;
    }>(`/documents?scope=mine&pageSize=100`, token);
    const listed = list.body.items.find((item) => item.id === draft.id);
    assert(
      Boolean(listed?.numberingPreview?.number),
      'El listado incluye el número previsto de los borradores',
    );

    /* 2b. La vista previa del borrador muestra el número con la marca. */
    const draftHtml = await call<string>(`/documents/${draft.id}/html`, token);
    assert(draftHtml.status === 200, 'Se genera la vista previa del borrador');
    assert(
      String(draftHtml.body).includes('(previsto)'),
      'La vista previa del borrador marca el número como previsto',
    );

    /* 2c. La plantilla expone el previsto para el modo «documento nuevo». */
    const templateDetail = await call<{ numberingPreview?: NumberingPreviewPayload | null }>(
      `/templates/${template.id}`,
      token,
    );
    assert(
      Boolean(templateDetail.body.numberingPreview?.number),
      'La plantilla expone el número previsto de un documento nuevo',
    );

    /* 3. Oficializar asigna el número. */
    const promote = await call(`/documents/${draft.id}`, token, 'PATCH', { status: 'final' });
    assert(promote.status === 200, 'El administrador pasa el borrador a final');

    const numbered = await call<DocumentPayload>(`/documents/${draft.id}`, token);
    assert(Boolean(numbered.body.document.docNumber), 'El documento final tiene número');
    assert(
      sameCorrelative(
        numbered.body.document.docNumber,
        detail.body.document.numberingPreview?.number,
      ),
      'El número asignado coincide con el previsto',
    );
    assert(
      numbered.body.document.numberingPreview === null,
      'Un documento numerado ya no muestra previsto',
    );
    assert((await readCounter()) === (counterBefore?.counter ?? 0) + 1, 'El contador avanzó una vez');

    /* 4. Dos documentos seguidos reciben números consecutivos. */
    const first = await createDraft();
    const second = await createDraft();
    await call(`/documents/${first.id}`, token, 'PATCH', { status: 'final' });
    await call(`/documents/${second.id}`, token, 'PATCH', { status: 'final' });

    const firstDoc = await call<DocumentPayload>(`/documents/${first.id}`, token);
    const secondDoc = await call<DocumentPayload>(`/documents/${second.id}`, token);
    assert(
      numericSuffix(secondDoc.body.document.docNumber) ===
        numericSuffix(firstDoc.body.document.docNumber) + 1,
      'Dos documentos consecutivos reciben números consecutivos',
    );

    /* 5. Oficializaciones simultáneas no repiten número. */
    const concurrent = await Promise.all([createDraft(), createDraft()]);
    await Promise.all([
      call(`/documents/${concurrent[0].id}`, token, 'PATCH', { status: 'final' }),
      call(`/documents/${concurrent[1].id}`, token, 'PATCH', { status: 'final' }),
    ]);
    const concurrentA = await call<DocumentPayload>(`/documents/${concurrent[0].id}`, token);
    const concurrentB = await call<DocumentPayload>(`/documents/${concurrent[1].id}`, token);
    assert(
      concurrentA.body.document.docNumber !== concurrentB.body.document.docNumber,
      'Dos oficializaciones simultáneas obtienen números distintos',
    );

    /* 6. Un documento en la papelera no bloquea la oficialización de otro. */
    const trashed = await createDraft();
    await call(`/documents/${trashed.id}`, token, 'PATCH', { status: 'final' });
    const trashedDetail = await call<DocumentPayload>(`/documents/${trashed.id}`, token);
    const trashedNumber = trashedDetail.body.document.docNumber;
    assert(Boolean(trashedNumber), 'El documento que se papelera tiene número');

    const removed = await call(`/documents/${trashed.id}`, token, 'DELETE');
    assert(removed.status === 200, 'El documento numerado se borra lógicamente');

    // El contador queda desfasado a propósito: es lo que ocurre tras una
    // reconciliación o un ajuste manual de la serie.
    await db
      .update(documentCounters)
      .set({ counter: counterBefore?.counter ?? 0 })
      .where(and(eq(documentCounters.seriesId, seriesId), eq(documentCounters.year, year)));

    const afterTrash = await createDraft();
    const officialized = await call(`/documents/${afterTrash.id}`, token, 'PATCH', {
      status: 'final',
    });
    assert(
      officialized.status === 200,
      'La papelera no bloquea la oficialización de otro documento',
    );

    const live = await db
      .select({ docNumber: documents.docNumber, seriesId: documents.numberingSeriesId })
      .from(documents)
      .where(and(isNull(documents.deletedAt), isNotNull(documents.docNumber)));
    // El número es único **dentro de su serie**: dos series distintas pueden
    // mostrar el mismo texto si comparten prefijo.
    const liveNumbers = live.map((row) => `${row.seriesId ?? ''}:${row.docNumber}`);
    assert(
      new Set(liveNumbers).size === liveNumbers.length,
      'Ningún documento vivo comparte número con otro de su misma serie',
    );

    /* 7. Restaurar un documento de la papelera nunca falla por su número. */
    const restored = await call<{ ok: boolean }>(`/documents/${trashed.id}/restore`, token, 'POST');
    assert(restored.status === 200, 'Restaurar un documento de la papelera responde 200');

    /* 8. Guardar el mismo contenido no incrementa la versión. */
    const beforeSave = await call<DocumentPayload>(`/documents/${draft.id}`, token);
    const detailForSave = await call<
      DocumentPayload & {
        document: { content: unknown; data: unknown; header: unknown; footer: unknown };
      }
    >(`/documents/${draft.id}`, token);
    const same = await call<{ version: number }>(`/documents/${draft.id}/content`, token, 'PUT', {
      content: detailForSave.body.document.content,
      data: detailForSave.body.document.data,
      header: detailForSave.body.document.header,
      footer: detailForSave.body.document.footer,
      title: (detailForSave.body.document as unknown as { title: string }).title,
      expectedVersion: beforeSave.body.document.version,
    });
    assert(
      same.status === 200 && same.body.version === beforeSave.body.document.version,
      'Guardar el mismo contenido no cambia la versión',
    );

    /* 9. Cada plantilla lleva su propia enumeración. */
    const own = await call<{
      template: { id: string; numberingPrefix: string | null; numberingSeriesId: string | null };
    }>(
      '/templates',
      token,
      'POST',
      {
        name: `Numeración propia ${Date.now()}`,
        docType: template.docType,
        body: { type: 'doc', content: [{ type: 'paragraph' }] },
        schema: [],
        numbering: {
          enabled: true,
          prefix: 'PROP',
          startValue: 1,
          padding: 4,
          includeYear: true,
        },
      },
    );
    assert(own.status === 201, 'Se crea una plantilla con numeración automática');
    createdTemplateIds.push(own.body.template.id);
    if (own.body.template.numberingSeriesId) {
      createdSeriesIds.push(own.body.template.numberingSeriesId);
    }
    const ownPrefix = own.body.template.numberingPrefix;
    assert(ownPrefix === 'PROP', 'La plantilla guarda el prefijo que el usuario escribió');
    assert(ownPrefix !== scope, 'La plantilla nueva no repite el prefijo de otra');

    const ownDraft = await call<DocumentPayload>('/documents', token, 'POST', {
      templateId: own.body.template.id,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    assert(ownDraft.status === 201, 'Se crea un borrador con la plantilla nueva');
    createdIds.push(ownDraft.body.document.id);

    await call(`/documents/${ownDraft.body.document.id}`, token, 'PATCH', { status: 'final' });
    const ownNumbered = await call<DocumentPayload>(
      `/documents/${ownDraft.body.document.id}`,
      token,
    );
    assert(
      numericSuffix(ownNumbered.body.document.docNumber) === 1,
      'La plantilla nueva empieza su enumeración en 1, sin intercalarse con la otra',
    );
    assert(
      (ownNumbered.body.document.docNumber ?? '').startsWith(`${ownPrefix}-`),
      'El número lleva el prefijo de su plantilla',
    );

    /* 9b. La serie declara a su plantilla. */
    const [ownSeries] = await db
      .select()
      .from(numberingSeries)
      .where(eq(numberingSeries.templateId, own.body.template.id))
      .limit(1);
    assert(Boolean(ownSeries), 'La serie de la plantilla declara a su plantilla');
    assert(
      typeof ownSeries?.templateName === 'string' && ownSeries.templateName.length > 0,
      'La serie guarda el nombre de su plantilla',
    );

    /* 10. El prefijo se conserva al volver a guardar. */
    const ownDetail = await call<{
      template: { id: string; version: number; numberingPrefix: string | null };
    }>(`/templates/${own.body.template.id}`, token);
    const ownAgain = await call<{
      template: { numberingPrefix: string | null };
    }>(
      `/templates/${own.body.template.id}`,
      token,
      'PATCH',
      {
        name: `Numeración propia ${Date.now()}`,
        docType: template.docType,
        body: { type: 'doc', content: [{ type: 'paragraph' }] },
        schema: [],
        expectedVersion: ownDetail.body.template.version,
        numbering: {
          enabled: true,
          prefix: ownPrefix,
          startValue: 1,
          padding: 4,
          includeYear: true,
        },
      },
    );
    assert(
      ownAgain.body.template.numberingPrefix === ownPrefix,
      'El prefijo no cambia al volver a guardar la plantilla',
    );

    /* 11. Restaurar una plantilla conserva su serie y su enumeración. */
    const removedTemplate = await call<{ ok: boolean }>(
      `/templates/${own.body.template.id}`,
      token,
      'DELETE',
    );
    assert(removedTemplate.status === 200, 'Se elimina la plantilla con numeración propia');

    const thief = await call<{ template: { id: string; numberingSeriesId: string | null } }>(
      '/templates',
      token,
      'POST',
      {
        name: `Prefijo tomado ${Date.now()}`,
        docType: template.docType,
        body: { type: 'doc', content: [{ type: 'paragraph' }] },
        schema: [],
        numbering: {
          enabled: true,
          prefix: ownPrefix,
          startValue: 1,
          padding: 4,
          includeYear: true,
        },
      },
    );
    assert(thief.status === 201, 'Otra plantilla puede ocupar el prefijo liberado');
    createdTemplateIds.push(thief.body.template.id);
    if (thief.body.template.numberingSeriesId) {
      createdSeriesIds.push(thief.body.template.numberingSeriesId);
    }

    const restoreTemplate = await call<{ ok: boolean }>(
      `/templates/${own.body.template.id}/restore`,
      token,
      'POST',
    );
    assert(
      restoreTemplate.status === 200,
      'La plantilla se restaura aunque su prefijo esté ocupado',
    );

    const ownRestored = await call<{
      template: { numberingPrefix: string | null; numberingSeriesId: string | null };
    }>(`/templates/${own.body.template.id}`, token);
    assert(
      ownRestored.body.template.numberingPrefix === ownPrefix,
      'La plantilla restaurada conserva su prefijo',
    );
    assert(
      ownRestored.body.template.numberingSeriesId === own.body.template.numberingSeriesId,
      'La plantilla restaurada conserva su serie y su enumeración',
    );

    /* 12. Dos plantillas pueden compartir prefijo: cada una con su serie. */
    const duplicated = await call<{
      template?: { id: string; numberingSeriesId: string | null; numberingPrefix: string | null };
    }>('/templates', token, 'POST', {
      name: `Prefijo duplicado ${Date.now()}`,
      docType: template.docType,
      body: { type: 'doc', content: [{ type: 'paragraph' }] },
      schema: [],
      numbering: { enabled: true, prefix: scope, startValue: 1, padding: 4, includeYear: true },
    });
    assert(
      duplicated.status === 201,
      'Se puede guardar un prefijo que ya usa otra plantilla',
    );
    createdTemplateIds.push(duplicated.body.template!.id);
    if (duplicated.body.template!.numberingSeriesId) {
      createdSeriesIds.push(duplicated.body.template!.numberingSeriesId);
    }
    assert(
      duplicated.body.template!.numberingPrefix === scope,
      'La segunda plantilla conserva el prefijo repetido',
    );
    assert(
      duplicated.body.template!.numberingSeriesId !== seriesId,
      'La segunda plantilla tiene su propia serie',
    );

    /* 12b. Las dos enumeraciones son independientes. */
    const twinDraft = await call<DocumentPayload>('/documents', token, 'POST', {
      templateId: duplicated.body.template!.id,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    assert(twinDraft.status === 201, 'Se crea un borrador con la plantilla gemela');
    createdIds.push(twinDraft.body.document.id);

    await call(`/documents/${twinDraft.body.document.id}`, token, 'PATCH', { status: 'final' });
    const twinNumbered = await call<DocumentPayload>(
      `/documents/${twinDraft.body.document.id}`,
      token,
    );
    assert(
      numericSuffix(twinNumbered.body.document.docNumber) === 1,
      'La plantilla gemela empieza su enumeración en 1, sin intercalarse con la otra',
    );
    assert(
      (twinNumbered.body.document.docNumber ?? '').startsWith(`${scope}-`),
      'El número gemelo lleva el prefijo repetido',
    );

    /* 13. El prefijo es opcional: una serie puede numerar sin etiqueta. */
    const bare = await call<{
      template?: { id: string; numberingSeriesId: string | null; numberingPrefix: string | null };
    }>('/templates', token, 'POST', {
      name: `Sin prefijo ${Date.now()}`,
      docType: template.docType,
      body: { type: 'doc', content: [{ type: 'paragraph' }] },
      schema: [],
      numbering: {
        enabled: true,
        prefix: '',
        startValue: 1,
        padding: 4,
        includeYear: true,
      },
    });
    assert(bare.status === 201, 'Se crea una plantilla sin prefijo');
    createdTemplateIds.push(bare.body.template!.id);
    if (bare.body.template!.numberingSeriesId) {
      createdSeriesIds.push(bare.body.template!.numberingSeriesId);
    }
    assert(
      !bare.body.template!.numberingPrefix,
      'La plantilla sin prefijo se queda sin etiqueta',
    );

    const bareDraft = await call<DocumentPayload>('/documents', token, 'POST', {
      templateId: bare.body.template!.id,
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    });
    assert(bareDraft.status === 201, 'Se crea un borrador con la plantilla sin prefijo');
    createdIds.push(bareDraft.body.document.id);

    await call(`/documents/${bareDraft.body.document.id}`, token, 'PATCH', { status: 'final' });
    const bareNumbered = await call<DocumentPayload>(
      `/documents/${bareDraft.body.document.id}`,
      token,
    );
    assert(
      bareNumbered.body.document.docNumber === `0001-${new Date().getFullYear()}`,
      'El número sin prefijo es solo el correlativo y el año',
    );
  } finally {
    // Limpieza: se borran los documentos, las plantillas de prueba y las
    // series que estas crearon (con su contador), y se restaura el contador
    // de la serie original.
    for (const id of createdIds) {
      await db.delete(documents).where(eq(documents.id, id));
    }
    for (const id of createdTemplateIds) {
      await db.delete(templates).where(eq(templates.id, id));
    }
    for (const id of createdSeriesIds) {
      await db.delete(documentCounters).where(eq(documentCounters.seriesId, id));
      await db.delete(numberingSeries).where(eq(numberingSeries.id, id));
    }

    if (counterBefore) {
      await db
        .update(documentCounters)
        .set({ counter: counterBefore.counter })
        .where(and(eq(documentCounters.seriesId, seriesId), eq(documentCounters.year, year)));
    } else {
      await db
        .delete(documentCounters)
        .where(and(eq(documentCounters.seriesId, seriesId), eq(documentCounters.year, year)));
    }

    await sql.end({ timeout: 5 });
  }
}

/** Compara dos números formateados ignorando el relleno de ceros. */
function sameCorrelative(a: string | null, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return numericSuffix(a) === numericSuffix(b);
}

/**
 * Correlativo de un número emitido.
 *
 * El formato es `PREFIX-CORRELATIVO-AÑO` (`MEM-0007-2026`), así que el
 * correlativo es el bloque central. Los números antiguos
 * (`PREFIX-AÑO-CORRELATIVO`) se reconocen porque el último bloque tiene
 * cuatro dígitos y el año es plausible.
 */
function numericSuffix(value: string | null | undefined): number {
  if (!value) return NaN;
  const blocks = value.split('-');
  if (blocks.length < 2) return NaN;

  const last = Number(blocks[blocks.length - 1]);
  const previous = Number(blocks[blocks.length - 2]);

  // Formato actual: el correlativo precede al año.
  if (blocks.length >= 3 && last >= 1900 && last <= 2999) return previous;
  // Formato sin año o formato antiguo: el correlativo es el último bloque.
  return last;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
