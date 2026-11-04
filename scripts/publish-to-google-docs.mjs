#!/usr/bin/env node
/**
 * Publica un documento Markdown como Google Doc.
 *
 * Modos:
 *   node scripts/publish-to-google-docs.mjs                      # crea un Doc nuevo
 *   node scripts/publish-to-google-docs.mjs --file otro.md       # otro archivo
 *   node scripts/publish-to-google-docs.mjs --doc <ID>           # añade al final de un Doc
 *   node scripts/publish-to-google-docs.mjs --dry-run            # solo genera el HTML
 *
 * Requisitos (una sola vez):
 *   1. En Google Cloud Console crea un proyecto y habilita **Google Drive API** y
 *      **Google Docs API**.
 *   2. Crea credenciales OAuth 2.0 (tipo "Aplicación web" o "Aplicación de escritorio")
 *      y añade `http://localhost:3101/auth/google/callback` como URI de redirección.
 *   3. Obtén un refresh token con scope:
 *        https://www.googleapis.com/auth/drive.file
 *        https://www.googleapis.com/auth/documents
 *      La forma más rápida es el OAuth 2.0 Playground
 *      (https://developers.google.com/oauthplayground) activando "Use your own OAuth
 *      credentials". Para añadir contenido a un Doc que no creó esta app, usa el scope
 *      completo `https://www.googleapis.com/auth/drive`.
 *   4. Exporta las variables:
 *        GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *      (o directamente GOOGLE_ACCESS_TOKEN si lo obtienes por otro medio).
 *
 * El modo creación sube el Markdown convertido a HTML y deja que Drive lo convierta a
 * Google Docs (conserva títulos, listas, tablas, negritas, código y enlaces). El modo
 * `--doc` inserta el contenido como texto plano al final del documento existente.
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const DEFAULT_FILE = 'docs/INGENIERIA-INVERSA-EIGENT.md';
const DEFAULT_TITLE = 'Ingeniería inversa de Eigent — SirpefOffice';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const DOCS_API = 'https://docs.googleapis.com/v1/documents';

/* ─────────────────────────── Argumentos ─────────────────────────── */

function parseArgs(argv) {
  const args = { file: DEFAULT_FILE, title: DEFAULT_TITLE, doc: null, dryRun: false };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file' || arg === '-f') args.file = argv[++i];
    else if (arg === '--title' || arg === '-t') args.title = argv[++i];
    else if (arg === '--doc' || arg === '-d') args.doc = argv[++i];
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') {
      console.log(`Uso: node scripts/publish-to-google-docs.mjs [opciones]

  -f, --file <ruta>    Markdown a publicar (por defecto ${DEFAULT_FILE})
  -t, --title <texto>  Título del Google Doc
  -d, --doc <id>       Añade el contenido al final de un Doc existente
      --dry-run        No llama a Google; guarda el HTML en /tmp
  -h, --help           Esta ayuda`);
      process.exit(0);
    } else {
      console.error(`Opción desconocida: ${arg}`);
      process.exit(1);
    }
  }

  return args;
}

/* ───────────────────── Markdown → HTML (sin dependencias) ───────────────────── */

function escapeHtml(text) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function inline(text) {
  const codes = [];
  let result = escapeHtml(text);

  // Código en línea: se protege antes de aplicar el resto de marcas.
  result = result.replace(/`([^`]+)`/g, (_match, code) => {
    codes.push(`<code>${code}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });

  result = result
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

  return result.replace(/\u0000(\d+)\u0000/g, (_match, index) => codes[Number(index)]);
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((cell) => cell.trim());
}

function isTableSeparator(line) {
  return /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(line) && line.includes('-');
}

function markdownToHtml(markdown) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    // Bloques de código ```lang
    if (/^\s*```/.test(line)) {
      const language = line.trim().replace(/^```/, '') || 'plain';
      const code = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      out.push(
        `<pre><code class="language-${escapeHtml(language)}">${escapeHtml(code.join('\n'))}</code></pre>`,
      );
      continue;
    }

    // Tablas
    if (line.includes('|') && lines[index + 1] && isTableSeparator(lines[index + 1])) {
      const header = splitTableRow(line);
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes('|')) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      const head = `<tr>${header.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr>`;
      const body = rows
        .map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`)
        .join('');
      out.push(`<table border="1" cellspacing="0" cellpadding="6">${head}${body}</table>`);
      continue;
    }

    // Encabezados
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    // Regla horizontal
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      out.push('<hr />');
      index += 1;
      continue;
    }

    // Cita
    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ''));
        index += 1;
      }
      out.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`);
      continue;
    }

    // Listas (con un nivel de anidación simple)
    const listMatch = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[2]);
      const tag = ordered ? 'ol' : 'ul';
      const items = [];

      while (index < lines.length) {
        const item = /^(\s*)([-*+]|\d+\.)\s+(.*)$/.exec(lines[index]);
        if (!item) break;
        const isNested = item[1].length >= 2;
        const isOrdered = /\d+\./.test(item[2]);
        if (isOrdered !== ordered && !isNested) break;
        items.push(
          `<li${isNested ? ' style="margin-left:24px"' : ''}>${inline(item[3])}</li>`,
        );
        index += 1;
      }

      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    // Línea vacía
    if (line.trim() === '') {
      index += 1;
      continue;
    }

    // Párrafo: agrupa líneas hasta una línea vacía o un bloque nuevo.
    const paragraph = [line.trim()];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() !== '' &&
      !/^(#{1,6})\s/.test(lines[index]) &&
      !/^\s*```/.test(lines[index]) &&
      !/^\s*>\s?/.test(lines[index]) &&
      !/^(\s*)([-*+]|\d+\.)\s+/.test(lines[index]) &&
      !(lines[index].includes('|') && lines[index + 1] && isTableSeparator(lines[index + 1]))
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }
    out.push(`<p>${inline(paragraph.join(' '))}</p>`);
  }

  return out.join('\n');
}

/** Markdown → texto plano (para insertar en un Doc existente vía Docs API). */
function markdownToPlainText(markdown) {
  return markdown
    .replace(/\r\n?/g, '\n')
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/* ───────────────────────────── OAuth ───────────────────────────── */

async function getAccessToken() {
  if (process.env.GOOGLE_ACCESS_TOKEN) return process.env.GOOGLE_ACCESS_TOKEN;

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Faltan credenciales. Define GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET y ' +
        'GOOGLE_REFRESH_TOKEN (o GOOGLE_ACCESS_TOKEN).',
    );
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`No se pudo renovar el token (${response.status}): ${detail.slice(0, 300)}`);
  }

  const data = await response.json();
  if (!data.access_token) throw new Error('La respuesta de OAuth no incluyó access_token');
  return data.access_token;
}

/* ─────────────────────────── Drive / Docs ─────────────────────────── */

/** Crea un Google Doc importando HTML (Drive hace la conversión). */
async function createDocument({ token, title, html }) {
  const boundary = `sirpefoffice_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const metadata = {
    name: title,
    mimeType: 'application/vnd.google-apps.document',
  };

  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    html,
    `--${boundary}--`,
    '',
  ].join('\r\n');

  const response = await fetch(
    `${DRIVE_UPLOAD}?uploadType=multipart&fields=id,name,webViewLink&supportsAllDrives=true`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Drive rechazó la creación (${response.status}): ${detail.slice(0, 500)}`);
  }

  return response.json();
}

/** Añade texto al final de un Doc existente usando la Docs API. */
async function appendToDocument({ token, documentId, text }) {
  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };

  const docResponse = await fetch(`${DOCS_API}/${documentId}`, { headers });
  if (!docResponse.ok) {
    const detail = await docResponse.text();
    throw new Error(`No se pudo leer el Doc (${docResponse.status}): ${detail.slice(0, 500)}`);
  }

  const doc = await docResponse.json();
  const endIndex = doc.body?.content?.at(-1)?.endIndex;
  if (typeof endIndex !== 'number') throw new Error('El Doc no tiene un cuerpo válido');

  // Se inserta antes del índice final del cuerpo (que no es editable).
  const insertAt = Math.max(1, endIndex - 1);
  const payload = `\n\n${text}\n`;

  const updateResponse = await fetch(`${DOCS_API}/${documentId}:batchUpdate`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      requests: [{ insertText: { location: { index: insertAt }, text: payload } }],
    }),
  });

  if (!updateResponse.ok) {
    const detail = await updateResponse.text();
    throw new Error(`Docs rechazó la inserción (${updateResponse.status}): ${detail.slice(0, 500)}`);
  }

  return {
    id: documentId,
    webViewLink: `https://docs.google.com/document/d/${documentId}/edit`,
  };
}

/* ─────────────────────────────── Main ─────────────────────────────── */

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const filePath = path.resolve(process.cwd(), args.file);

  const markdown = await readFile(filePath, 'utf8');
  const html = markdownToHtml(markdown);
  const plain = markdownToPlainText(markdown);

  console.log(`· Origen: ${path.relative(process.cwd(), filePath)} (${markdown.length} caracteres)`);
  console.log(`· HTML generado: ${html.length} caracteres`);

  if (args.dryRun) {
    const outFile = '/tmp/sirpefoffice-google-doc.html';
    await writeFile(outFile, html, 'utf8');
    console.log(`· Modo --dry-run: HTML guardado en ${outFile}`);
    console.log(`· Primeras líneas:\n${plain.split('\n').slice(0, 12).join('\n')}`);
    return;
  }

  const token = await getAccessToken();
  console.log('· Token de acceso obtenido');

  const result = args.doc
    ? await appendToDocument({ token, documentId: args.doc, text: plain })
    : await createDocument({ token, title: args.title, html });

  console.log(`\n✓ Publicado: ${result.name ?? args.title}`);
  console.log(`  ${result.webViewLink}`);
}

await main().catch((error) => {
  console.error(`\n✗ ${error.message}`);
  process.exitCode = 1;
});
