import QRCode from 'qrcode';
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from 'pdf-lib';

export interface SignatureCertificateData {
  serial: string;
  verificationUrl: string;
  documentId: string;
  messageId: string | null;
  documentTitle: string;
  docNumber: string | null;
  signerName: string;
  signerCedula: string | null;
  signerRole: string;
  signedAt: Date;
  method: 'drawn' | 'typed';
  deviceLabel: string;
  ip: string | null;
  contentSha256: string;
  signatureSha256: string;
  sealedPdfSha256?: string;
  signaturePngBase64: string;
}

const INK = rgb(0.06, 0.09, 0.16);
const INDIGO = rgb(0.31, 0.27, 0.9);
const MUTED = rgb(0.39, 0.45, 0.55);
const LIGHT = rgb(0.96, 0.97, 0.99);

function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('es-VE', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(date) + ' UTC';
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];

  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      line = word;
      continue;
    }
    // Palabras muy largas (hashes): se parten por caracteres.
    let chunk = '';
    for (const char of word) {
      if (font.widthOfTextAtSize(chunk + char, size) > maxWidth && chunk) {
        lines.push(chunk);
        chunk = char;
      } else {
        chunk += char;
      }
    }
    line = chunk;
  }
  if (line) lines.push(line);
  return lines;
}

function drawParagraph(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  font: PDFFont,
  size: number,
  maxWidth: number,
  lineHeight: number,
  color = INK,
): number {
  let cursor = y;
  for (const line of wrapText(text, font, size, maxWidth)) {
    page.drawText(line, { x, y: cursor, size, font, color });
    cursor -= lineHeight;
  }
  return cursor;
}

function drawField(
  page: PDFPage,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  regular: PDFFont,
  bold: PDFFont,
): void {
  page.drawText(label.toUpperCase(), {
    x,
    y,
    size: 7.5,
    font: bold,
    color: MUTED,
  });
  drawParagraph(page, value, x, y - 13, regular, 10, width, 12);
}

/** Añade una hoja de firmas al final del PDF original. */
export async function appendSignaturePage(
  pdfBytes: Buffer,
  data: SignatureCertificateData,
): Promise<Buffer> {
  const pdf = await PDFDocument.load(pdfBytes);
  const page = pdf.addPage([595.28, 841.89]); // A4
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const { width, height } = page.getSize();

  // Cabecera
  page.drawRectangle({
    x: 0,
    y: height - 110,
    width,
    height: 110,
    color: INK,
  });
  page.drawText('SIRPEFOFFICE', {
    x: 48,
    y: height - 56,
    size: 18,
    font: bold,
    color: rgb(1, 1, 1),
  });
  page.drawText('HOJA DE FIRMAS ELECTRÓNICA', {
    x: 48,
    y: height - 76,
    size: 10,
    font: regular,
    color: rgb(0.75, 0.8, 0.9),
  });
  page.drawText(`Serie ${data.serial}`, {
    x: 48,
    y: height - 94,
    size: 8,
    font: mono,
    color: rgb(0.65, 0.72, 0.85),
  });

  let y = height - 150;
  page.drawText('DOCUMENTO FIRMADO', { x: 48, y, size: 8, font: bold, color: MUTED });
  y -= 16;
  y = drawParagraph(page, data.documentTitle, 48, y, bold, 15, width - 96, 18);
  if (data.docNumber) {
    page.drawText(`Número: ${data.docNumber}`, {
      x: 48,
      y: y - 2,
      size: 9,
      font: mono,
      color: INDIGO,
    });
    y -= 18;
  }

  y -= 16;
  page.drawLine({
    start: { x: 48, y },
    end: { x: width - 48, y },
    thickness: 0.8,
    color: rgb(0.88, 0.9, 0.94),
  });
  y -= 24;

  drawField(page, 'Firmante', data.signerName, 48, y, 250, regular, bold);
  drawField(page, 'Cédula', data.signerCedula ?? 'No registrada', 320, y, 220, regular, bold);
  y -= 48;
  drawField(page, 'Rol', data.signerRole, 48, y, 250, regular, bold);
  drawField(page, 'Fecha y hora', formatDate(data.signedAt), 320, y, 220, regular, bold);
  y -= 48;
  drawField(page, 'Método', data.method === 'drawn' ? 'Trazo táctil' : 'Firma tipográfica', 48, y, 250, regular, bold);
  drawField(page, 'Dispositivo', data.deviceLabel || 'Android', 320, y, 220, regular, bold);

  // Recuadro de la rúbrica
  y -= 34;
  page.drawRectangle({
    x: 48,
    y: y - 116,
    width: 300,
    height: 116,
    color: LIGHT,
    borderColor: rgb(0.86, 0.88, 0.93),
    borderWidth: 1,
  });
  try {
    const signature = await pdf.embedPng(Buffer.from(data.signaturePngBase64, 'base64'));
    const maxWidth = 264;
    const maxHeight = 78;
    const scale = Math.min(maxWidth / signature.width, maxHeight / signature.height, 1);
    page.drawImage(signature, {
      x: 48 + (300 - signature.width * scale) / 2,
      y: y - 100,
      width: signature.width * scale,
      height: signature.height * scale,
    });
  } catch {
    page.drawText('Rúbrica no disponible', {
      x: 62,
      y: y - 70,
      size: 9,
      font: regular,
      color: MUTED,
    });
  }
  page.drawText('FIRMA DEL TITULAR', {
    x: 62,
    y: y - 112,
    size: 7,
    font: bold,
    color: MUTED,
  });

  // QR de verificación
  const qrBytes = await QRCode.toBuffer(data.verificationUrl, {
    type: 'png',
    width: 320,
    margin: 1,
    errorCorrectionLevel: 'M',
  });
  const qr = await pdf.embedPng(qrBytes);
  page.drawImage(qr, { x: width - 180, y: y - 116, width: 116, height: 116 });
  page.drawText('Escanear para validar', {
    x: width - 180,
    y: y - 128,
    size: 7.5,
    font: regular,
    color: INDIGO,
  });

  // Hashes
  y -= 156;
  page.drawRectangle({
    x: 48,
    y: y - 104,
    width: width - 96,
    height: 104,
    color: INK,
  });
  page.drawText('HUELLA DEL CONTENIDO (SHA-256)', {
    x: 60,
    y: y - 20,
    size: 7.5,
    font: bold,
    color: rgb(0.65, 0.72, 0.95),
  });
  drawParagraph(page, data.contentSha256, 60, y - 34, mono, 7.5, width - 120, 10, rgb(0.85, 0.88, 0.95));
  page.drawText('HUELLA DE LA RÚBRICA (SHA-256)', {
    x: 60,
    y: y - 64,
    size: 7.5,
    font: bold,
    color: rgb(0.65, 0.72, 0.95),
  });
  drawParagraph(page, data.signatureSha256, 60, y - 78, mono, 7.5, width - 120, 10, rgb(0.85, 0.88, 0.95));

  drawParagraph(
    page,
    'Constancia de firma electrónica simple auditada. La validez jurídica depende del marco legal aplicable.',
    48,
    48,
    regular,
    7,
    width - 96,
    9,
    MUTED,
  );
  drawParagraph(
    page,
    `Verificación: ${data.verificationUrl}`,
    48,
    34,
    mono,
    7,
    width - 96,
    9,
    INDIGO,
  );

  return Buffer.from(await pdf.save());
}

/** Certificado PDF independiente, con el hash del PDF ya sellado. */
export async function buildCertificatePdf(data: SignatureCertificateData): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const mono = await pdf.embedFont(StandardFonts.Courier);
  const { width, height } = page.getSize();

  page.drawRectangle({ x: 0, y: 0, width, height, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 0, y: height - 120, width, height: 120, color: INK });
  page.drawText('SIRPEFOFFICE', { x: 48, y: height - 58, size: 20, font: bold, color: rgb(1, 1, 1) });
  page.drawText('CERTIFICADO DE FIRMA ELECTRÓNICA', {
    x: 48,
    y: height - 80,
    size: 10,
    font: regular,
    color: rgb(0.75, 0.8, 0.9),
  });
  page.drawText(`Serie ${data.serial}`, {
    x: 48,
    y: height - 102,
    size: 9,
    font: mono,
    color: rgb(0.65, 0.72, 0.85),
  });

  let y = height - 160;
  y = drawParagraph(page, data.documentTitle, 48, y, bold, 16, width - 96, 20);
  if (data.docNumber) {
    page.drawText(`Número: ${data.docNumber}`, { x: 48, y: y - 2, size: 9, font: mono, color: INDIGO });
    y -= 18;
  }

  y -= 18;
  drawField(page, 'Firmante', data.signerName, 48, y, 250, regular, bold);
  drawField(page, 'Cédula', data.signerCedula ?? 'No registrada', 320, y, 220, regular, bold);
  y -= 48;
  drawField(page, 'Rol', data.signerRole, 48, y, 250, regular, bold);
  drawField(page, 'Fecha y hora', formatDate(data.signedAt), 320, y, 220, regular, bold);
  y -= 48;
  drawField(page, 'Método', data.method === 'drawn' ? 'Trazo táctil' : 'Firma tipográfica', 48, y, 250, regular, bold);
  drawField(page, 'Dispositivo', data.deviceLabel || 'Android', 320, y, 220, regular, bold);

  y -= 40;
  page.drawRectangle({
    x: 48,
    y: y - 130,
    width: 300,
    height: 130,
    color: LIGHT,
    borderColor: rgb(0.86, 0.88, 0.93),
    borderWidth: 1,
  });
  try {
    const signature = await pdf.embedPng(Buffer.from(data.signaturePngBase64, 'base64'));
    const scale = Math.min(264 / signature.width, 86 / signature.height, 1);
    page.drawImage(signature, {
      x: 48 + (300 - signature.width * scale) / 2,
      y: y - 112,
      width: signature.width * scale,
      height: signature.height * scale,
    });
  } catch {
    page.drawText('Rúbrica no disponible', { x: 62, y: y - 78, size: 9, font: regular, color: MUTED });
  }
  page.drawText('RÚBRICA REGISTRADA', { x: 62, y: y - 124, size: 7, font: bold, color: MUTED });

  const qrBytes = await QRCode.toBuffer(data.verificationUrl, {
    type: 'png',
    width: 360,
    margin: 1,
    errorCorrectionLevel: 'M',
  });
  const qr = await pdf.embedPng(qrBytes);
  page.drawImage(qr, { x: width - 190, y: y - 132, width: 132, height: 132 });
  page.drawText('Validación pública', { x: width - 190, y: y - 146, size: 8, font: regular, color: INDIGO });

  y -= 170;
  page.drawRectangle({ x: 48, y: y - 176, width: width - 96, height: 176, color: INK });
  page.drawText('HUELLA DEL CONTENIDO (SHA-256)', {
    x: 60, y: y - 18, size: 7.5, font: bold, color: rgb(0.65, 0.72, 0.95),
  });
  drawParagraph(page, data.contentSha256, 60, y - 32, mono, 7.5, width - 120, 10, rgb(0.85, 0.88, 0.95));
  page.drawText('HUELLA DE LA RÚBRICA (SHA-256)', {
    x: 60, y: y - 62, size: 7.5, font: bold, color: rgb(0.65, 0.72, 0.95),
  });
  drawParagraph(page, data.signatureSha256, 60, y - 76, mono, 7.5, width - 120, 10, rgb(0.85, 0.88, 0.95));
  if (data.sealedPdfSha256) {
    page.drawText('HUELLA DEL PDF SELLADO (SHA-256)', {
      x: 60, y: y - 106, size: 7.5, font: bold, color: rgb(0.65, 0.72, 0.95),
    });
    drawParagraph(page, data.sealedPdfSha256, 60, y - 120, mono, 7.5, width - 120, 10, rgb(0.85, 0.88, 0.95));
  }
  page.drawText(`IP de la firma: ${data.ip ?? 'No registrada'}`, {
    x: 60, y: y - 156, size: 7, font: regular, color: rgb(0.65, 0.72, 0.85),
  });

  drawParagraph(
    page,
    'Constancia de firma electrónica simple auditada. La validez jurídica depende del marco legal aplicable.',
    48,
    42,
    regular,
    7,
    width - 96,
    9,
    MUTED,
  );

  return Buffer.from(await pdf.save());
}
