import type { DesignTokens, JSONContent, VariableDef } from '@sirpefoffice/shared';

import { DEFAULT_DESIGN_TOKENS } from '@sirpefoffice/shared';

/* ────────────────────────── Constructores JSON ────────────────────────── */

type Mark = { type: string; attrs?: Record<string, unknown> };

const text = (value: string, marks?: Mark[]): JSONContent => ({
  type: 'text',
  text: value,
  ...(marks ? { marks } : {}),
});

const bold = (value: string): JSONContent => text(value, [{ type: 'bold' }]);
const italic = (value: string): JSONContent => text(value, [{ type: 'italic' }]);
const underline = (value: string): JSONContent => text(value, [{ type: 'underline' }]);

const para = (...content: (JSONContent | string)[]): JSONContent => ({
  type: 'paragraph',
  content: content.map((c) => (typeof c === 'string' ? text(c) : c)),
});

const emptyPara = (): JSONContent => ({ type: 'paragraph' });

const heading = (level: 1 | 2 | 3, ...content: (JSONContent | string)[]): JSONContent => ({
  type: 'heading',
  attrs: { level },
  content: content.map((c) => (typeof c === 'string' ? text(c) : c)),
});

const rule = (): JSONContent => ({ type: 'horizontalRule' });

const cell = (value: string | JSONContent | JSONContent[], header = false): JSONContent => ({
  type: header ? 'tableHeader' : 'tableCell',
  attrs: { colspan: 1, rowspan: 1 },
  content: [
    Array.isArray(value)
      ? { type: 'paragraph', content: value }
      : typeof value === 'string'
        ? { type: 'paragraph', content: [{ type: 'text', text: value }] }
        : { type: 'paragraph', content: [value] },
  ],
});

const table = (rows: (string | JSONContent | JSONContent[])[][], headerRow = true): JSONContent => ({
  type: 'table',
  content: rows.map((row, rowIndex) => ({
    type: 'tableRow',
    content: row.map((c) => cell(c, headerRow && rowIndex === 0)),
  })),
});

/* ─────────────────────────────── Diseños ──────────────────────────────── */

export interface SeedDesign {
  name: string;
  description: string;
  tokens: DesignTokens;
}

export const seedDesigns: SeedDesign[] = [
  {
    name: 'Serif Ejecutivo',
    description: 'Tipografía serif sobria con azul institucional. Ideal para memorándums, informes y oficios.',
    tokens: {
      ...DEFAULT_DESIGN_TOKENS,
      fontFamily: "Georgia, 'Times New Roman', serif",
      fontSize: 11,
      lineHeight: 1.55,
      primaryColor: '#12304f',
      accentColor: '#9b2226',
      tableHeadColor: '#e6ecf3',
      tableBorderColor: '#b9c5d3',
      letterhead: {
        enabled: true,
        title: 'INSTITUCIÓN',
        subtitle: 'Área / Departamento',
        align: 'center',
      },
      footer: {
        enabled: true,
        content: 'Página {page} de {total}',
        align: 'center',
        showPageNumber: true,
        showTotal: true,
      },
    },
  },
  {
    name: 'Coral Moderno',
    description: 'Sans serif con acentos coral. Para cartas, propuestas y documentos comerciales.',
    tokens: {
      ...DEFAULT_DESIGN_TOKENS,
      fontFamily: "Inter, 'Helvetica Neue', Arial, sans-serif",
      fontSize: 10.5,
      lineHeight: 1.6,
      primaryColor: '#c94f43',
      accentColor: '#f2b134',
      textColor: '#22252a',
      tableHeadColor: '#fbeae7',
      tableBorderColor: '#e7c7c1',
      margins: { top: 2.2, right: 2.2, bottom: 2.2, left: 2.2, header: 1.1, footer: 1.1 },
    },
  },
  {
    name: 'Menta Verde',
    description: 'Verde institucional con tablas suaves. Pensado para planes de evaluación y reportes.',
    tokens: {
      ...DEFAULT_DESIGN_TOKENS,
      fontFamily: "Calibri, 'Segoe UI', Arial, sans-serif",
      fontSize: 11,
      lineHeight: 1.5,
      primaryColor: '#1f7a5c',
      accentColor: '#8fd3b6',
      tableHeadColor: '#e3f3ec',
      tableBorderColor: '#b7d8ca',
      margins: { top: 2.4, right: 2.4, bottom: 2.4, left: 2.4, header: 1.2, footer: 1.2 },
    },
  },
  {
    name: 'Navidad 2026',
    description:
      'Diseño de campaña navideña (verdes y rojo). Se enciende con el interruptor «En uso» y todas las plantillas pasan a usarlo.',
    tokens: {
      ...DEFAULT_DESIGN_TOKENS,
      fontFamily: "Georgia, 'Times New Roman', serif",
      fontSize: 11,
      lineHeight: 1.55,
      primaryColor: '#0f5132',
      accentColor: '#9b2226',
      tableHeadColor: '#e4f1ea',
      tableBorderColor: '#a9c7b6',
      letterhead: {
        enabled: true,
        title: 'INSTITUCIÓN',
        subtitle: 'Área / Departamento',
        align: 'center',
      },
      footer: {
        enabled: true,
        content: 'Página {page} de {total}',
        align: 'center',
        showPageNumber: true,
        showTotal: true,
      },
    },
  },
];

/* ────────────────────────────── Plantillas ────────────────────────────── */

export interface SeedTemplate {
  name: string;
  docType:
    | 'memorandum'
    | 'delivery_note'
    | 'report'
    | 'meeting_minutes'
    | 'evaluation_plan'
    | 'resume'
    | 'letter'
    | 'certificate';
  description: string;
  designIndex: number;
  schema: VariableDef[];
  body: JSONContent;
  aiInstructions: string;
}

export const seedTemplates: SeedTemplate[] = [
  {
    name: 'Memorándum',
    docType: 'memorandum',
    description: 'Comunicación interna con destinatario, remitente, asunto y cuerpo.',
    designIndex: 0,
    schema: [
      { key: 'numero', label: 'Número', type: 'text', required: true, aiHint: 'Correlativo, p. ej. MEM-0001-2026' },
      { key: 'destinatario', label: 'Para', type: 'text', required: true },
      { key: 'cargo_destinatario', label: 'Cargo del destinatario', type: 'text' },
      { key: 'remitente', label: 'De', type: 'text', required: true },
      { key: 'cargo_remitente', label: 'Cargo del remitente', type: 'text' },
      { key: 'asunto', label: 'Asunto', type: 'text', required: true },
      { key: 'fecha', label: 'Fecha', type: 'date', required: true },
      { key: 'referencia', label: 'Referencia', type: 'text' },
      { key: 'cuerpo', label: 'Cuerpo del memorándum', type: 'longtext', required: true },
      { key: 'firma', label: 'Nombre del firmante', type: 'text' },
    ],
    aiInstructions:
      'Redacta un memorándum formal en español, tono institucional, párrafos claros y concisos. Estructura: exposición de la situación, detalle y solicitud o decisión.',
    body: {
      type: 'doc',
      content: [
        heading(1, 'MEMORÁNDUM'),
        para(bold('N° '), '{{numero}}'),
        rule(),
        table(
          [
            [bold('PARA:'), '{{destinatario}} — {{cargo_destinatario}}'],
            [bold('DE:'), '{{remitente}} — {{cargo_remitente}}'],
            [bold('ASUNTO:'), '{{asunto}}'],
            [bold('FECHA:'), '{{fecha}}'],
            [bold('REF.:'), '{{referencia}}'],
          ],
          false,
        ),
        emptyPara(),
        para('{{cuerpo}}'),
        emptyPara(),
        emptyPara(),
        para('Atentamente,'),
        emptyPara(),
        emptyPara(),
        para(bold('{{firma}}'), text('\n' + '{{cargo_remitente}}')),
      ],
    },
  },
  {
    name: 'Nota de entrega',
    docType: 'delivery_note',
    description: 'Constancia de entrega de bienes o documentos, con detalle en tabla y totales.',
    designIndex: 2,
    schema: [
      { key: 'numero', label: 'Número', type: 'text', required: true },
      { key: 'fecha', label: 'Fecha', type: 'date', required: true },
      { key: 'receptor', label: 'Recibe', type: 'text', required: true },
      { key: 'cargo_receptor', label: 'Cargo de quien recibe', type: 'text' },
      { key: 'entregado_por', label: 'Entrega', type: 'text', required: true },
      { key: 'area', label: 'Área / Destino', type: 'text' },
      {
        key: 'items',
        label: 'Bienes entregados',
        type: 'table',
        columns: [
          { key: 'cantidad', label: 'Cantidad', type: 'number' },
          { key: 'descripcion', label: 'Descripción', type: 'text' },
          { key: 'unidad', label: 'Unidad', type: 'text' },
          { key: 'observacion', label: 'Observación', type: 'text' },
        ],
      },
      { key: 'observaciones', label: 'Observaciones generales', type: 'longtext' },
    ],
    aiInstructions:
      'Redacta una nota de entrega formal en español. Enumera los bienes entregados de forma clara y añade una cláusula de conformidad.',
    body: {
      type: 'doc',
      content: [
        heading(1, 'NOTA DE ENTREGA'),
        para(bold('N° '), '{{numero}}'),
        rule(),
        para(bold('FECHA: '), '{{fecha}}'),
        para(bold('RECIBE: '), '{{receptor}} — {{cargo_receptor}}'),
        para(bold('ENTREGA: '), '{{entregado_por}}'),
        para(bold('ÁREA / DESTINO: '), '{{area}}'),
        emptyPara(),
        para('Por medio de la presente se hace entrega de los siguientes bienes:'),
        table([
          ['Cantidad', 'Descripción', 'Unidad', 'Observación'],
          ['{{items.0.cantidad}}', '{{items.0.descripcion}}', '{{items.0.unidad}}', '{{items.0.observacion}}'],
        ]),
        emptyPara(),
        para(bold('OBSERVACIONES: '), '{{observaciones}}'),
        emptyPara(),
        para('En señal de conformidad, firman las partes.'),
        emptyPara(),
        emptyPara(),
        table([['ENTREGA', 'RECIBE'], ['{{entregado_por}}', '{{receptor}}']], false),
      ],
    },
  },
  {
    name: 'Informe técnico',
    docType: 'report',
    description: 'Informe estructurado con objetivos, desarrollo, resultados y conclusiones.',
    designIndex: 0,
    schema: [
      { key: 'titulo', label: 'Título del informe', type: 'text', required: true },
      { key: 'autor', label: 'Autor', type: 'text', required: true },
      { key: 'area', label: 'Área', type: 'text' },
      { key: 'fecha', label: 'Fecha', type: 'date', required: true },
      { key: 'resumen', label: 'Resumen ejecutivo', type: 'longtext' },
      { key: 'objetivos', label: 'Objetivos', type: 'longtext' },
      { key: 'desarrollo', label: 'Desarrollo', type: 'longtext', required: true },
      { key: 'resultados', label: 'Resultados', type: 'longtext' },
      { key: 'conclusiones', label: 'Conclusiones', type: 'longtext' },
    ],
    aiInstructions:
      'Redacta un informe técnico en español con lenguaje formal y preciso. Usa secciones numeradas y párrafos breves.',
    body: {
      type: 'doc',
      content: [
        heading(1, '{{titulo}}'),
        para(italic('{{area}} — {{fecha}}')),
        para('Elaborado por: '),
        para(bold('{{autor}}')),
        rule(),
        heading(2, '1. Resumen ejecutivo'),
        para('{{resumen}}'),
        heading(2, '2. Objetivos'),
        para('{{objetivos}}'),
        heading(2, '3. Desarrollo'),
        para('{{desarrollo}}'),
        heading(2, '4. Resultados'),
        para('{{resultados}}'),
        heading(2, '5. Conclusiones'),
        para('{{conclusiones}}'),
      ],
    },
  },
  {
    name: 'Acta de reunión',
    docType: 'meeting_minutes',
    description: 'Registro de asistentes, agenda, acuerdos y compromisos.',
    designIndex: 2,
    schema: [
      { key: 'numero', label: 'Número de acta', type: 'text', required: true },
      { key: 'fecha', label: 'Fecha', type: 'date', required: true },
      { key: 'hora', label: 'Hora', type: 'text' },
      { key: 'lugar', label: 'Lugar', type: 'text' },
      { key: 'asistentes', label: 'Asistentes', type: 'longtext' },
      { key: 'agenda', label: 'Agenda', type: 'longtext' },
      { key: 'acuerdos', label: 'Acuerdos', type: 'longtext', required: true },
      { key: 'responsable', label: 'Responsable del acta', type: 'text' },
    ],
    aiInstructions:
      'Redacta un acta de reunión formal en español, en tercera persona y tiempo pasado. Separa asistentes, agenda y acuerdos con viñetas.',
    body: {
      type: 'doc',
      content: [
        heading(1, 'ACTA DE REUNIÓN N° {{numero}}'),
        rule(),
        table(
          [
            [bold('FECHA:'), '{{fecha}}', bold('HORA:'), '{{hora}}'],
            [bold('LUGAR:'), '{{lugar}}', bold('RESPONSABLE:'), '{{responsable}}'],
          ],
          false,
        ),
        heading(2, 'Asistentes'),
        para('{{asistentes}}'),
        heading(2, 'Agenda'),
        para('{{agenda}}'),
        heading(2, 'Acuerdos'),
        para('{{acuerdos}}'),
        emptyPara(),
        para('Siendo las horas indicadas, se da por concluida la reunión.'),
        emptyPara(),
        table([['RESPONSABLE DEL ACTA'], ['{{responsable}}']], false),
      ],
    },
  },
  {
    name: 'Plan de evaluación',
    docType: 'evaluation_plan',
    description: 'Cronograma de actividades con ítem, actividad, fechas y porcentaje.',
    designIndex: 2,
    schema: [
      { key: 'titulo', label: 'Título', type: 'text', required: true },
      { key: 'curso', label: 'Curso / Asignatura', type: 'text' },
      { key: 'periodo', label: 'Periodo', type: 'text' },
      { key: 'docente', label: 'Docente', type: 'text' },
      {
        key: 'actividades',
        label: 'Actividades',
        type: 'table',
        columns: [
          { key: 'item', label: 'Ítem', type: 'number' },
          { key: 'actividad', label: 'Actividad', type: 'text' },
          { key: 'inicio', label: 'Fecha de inicio', type: 'date' },
          { key: 'fin', label: 'Fecha final', type: 'date' },
          { key: 'porcentaje', label: '%', type: 'number' },
        ],
      },
    ],
    aiInstructions:
      'Genera un plan de evaluación equilibrado con actividades distribuidas en el periodo, indicando fechas y porcentajes que sumen 100%.',
    body: {
      type: 'doc',
      content: [
        heading(1, 'PLAN DE EVALUACIÓN'),
        para(bold('{{titulo}}')),
        para('Curso: '),
        heading(2, '{{curso}}'),
        table(
          [
            [bold('PERIODO'), '{{periodo}}', bold('DOCENTE'), '{{docente}}'],
          ],
          false,
        ),
        emptyPara(),
        table([
          ['Actividad', 'Fecha de inicio', 'Fecha final', '%'],
          ['{{actividades.0.actividad}}', '{{actividades.0.inicio}}', '{{actividades.0.fin}}', '{{actividades.0.porcentaje}}'],
        ]),
        emptyPara(),
        para(italic('Total: 100%')),
      ],
    },
  },
  {
    name: 'Currículum',
    docType: 'resume',
    description: 'Currículum con perfil, experiencia, formación y habilidades.',
    designIndex: 1,
    schema: [
      { key: 'nombre', label: 'Nombre completo', type: 'text', required: true },
      { key: 'titulo', label: 'Título profesional', type: 'text' },
      { key: 'email', label: 'Correo', type: 'text' },
      { key: 'telefono', label: 'Teléfono', type: 'text' },
      { key: 'ciudad', label: 'Ciudad', type: 'text' },
      { key: 'perfil', label: 'Perfil profesional', type: 'longtext' },
      { key: 'experiencia', label: 'Experiencia', type: 'longtext' },
      { key: 'formacion', label: 'Formación académica', type: 'longtext' },
      { key: 'habilidades', label: 'Habilidades', type: 'longtext' },
    ],
    aiInstructions:
      'Redacta un currículum profesional en español, con verbos de acción y logros medibles. Mantén las secciones claras.',
    body: {
      type: 'doc',
      content: [
        heading(1, '{{nombre}}'),
        para(italic('{{titulo}}')),
        para('{{email}} · {{telefono}} · {{ciudad}}'),
        rule(),
        heading(2, 'Perfil'),
        para('{{perfil}}'),
        heading(2, 'Experiencia'),
        para('{{experiencia}}'),
        heading(2, 'Formación'),
        para('{{formacion}}'),
        heading(2, 'Habilidades'),
        para('{{habilidades}}'),
      ],
    },
  },
  {
    name: 'Carta / Oficio',
    docType: 'letter',
    description: 'Carta formal con destinatario, cuerpo y despedida.',
    designIndex: 1,
    schema: [
      { key: 'ciudad', label: 'Ciudad', type: 'text' },
      { key: 'fecha', label: 'Fecha', type: 'date', required: true },
      { key: 'destinatario', label: 'Destinatario', type: 'text', required: true },
      { key: 'cargo_destinatario', label: 'Cargo', type: 'text' },
      { key: 'institucion', label: 'Institución', type: 'text' },
      { key: 'asunto', label: 'Asunto', type: 'text' },
      { key: 'cuerpo', label: 'Cuerpo de la carta', type: 'longtext', required: true },
      { key: 'remitente', label: 'Remitente', type: 'text' },
      { key: 'cargo_remitente', label: 'Cargo del remitente', type: 'text' },
    ],
    aiInstructions:
      'Redacta una carta formal en español, con saludo, exposición y despedida. Tono respetuoso y directo.',
    body: {
      type: 'doc',
      content: [
        para('{{ciudad}}, {{fecha}}'),
        emptyPara(),
        para(bold('{{destinatario}}')),
        para('{{cargo_destinatario}}'),
        para(bold('{{institucion}}')),
        emptyPara(),
        para(bold('Asunto: '), '{{asunto}}'),
        emptyPara(),
        para('De mi consideración:'),
        emptyPara(),
        para('{{cuerpo}}'),
        emptyPara(),
        para('Sin otro particular, me despido.'),
        emptyPara(),
        emptyPara(),
        para(bold('{{remitente}}')),
        para('{{cargo_remitente}}'),
      ],
    },
  },
  {
    name: 'Certificado',
    docType: 'certificate',
    description: 'Certificado de participación o culminación con firma y sello.',
    designIndex: 0,
    schema: [
      { key: 'titulo', label: 'Título del certificado', type: 'text', required: true },
      { key: 'nombre', label: 'Nombre del participante', type: 'text', required: true },
      { key: 'evento', label: 'Evento / Curso', type: 'text', required: true },
      { key: 'horas', label: 'Horas', type: 'text' },
      { key: 'fecha', label: 'Fecha', type: 'date', required: true },
      { key: 'ciudad', label: 'Ciudad', type: 'text' },
      { key: 'firmante', label: 'Firmante', type: 'text' },
      { key: 'cargo_firmante', label: 'Cargo del firmante', type: 'text' },
    ],
    aiInstructions:
      'Redacta un certificado formal en español, en una sola frase principal, con lenguaje protocolario.',
    body: {
      type: 'doc',
      content: [
        heading(1, '{{titulo}}'),
        rule(),
        emptyPara(),
        para('Se certifica que:'),
        emptyPara(),
        heading(2, '{{nombre}}'),
        emptyPara(),
        para('ha participado satisfactoriamente en '),
        para(bold('{{evento}}')),
        para('con una duración de {{horas}}, realizado en {{ciudad}} el {{fecha}}.'),
        emptyPara(),
        emptyPara(),
        para('Se expide el presente certificado para los fines que estime convenientes.'),
        emptyPara(),
        emptyPara(),
        table([['{{firmante}}'], ['{{cargo_firmante}}']], false),
      ],
    },
  },
];
