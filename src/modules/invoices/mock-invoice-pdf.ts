/**
 * Minimal single-page PDF writer for the mock invoicing provider.
 * No dependencies: standard Helvetica fonts, ASCII-only output so string
 * length equals byte length and xref offsets stay exact.
 */

export const TEST_INVOICE_WATERMARK =
  'TEST INVOICE — DEVELOPMENT ONLY — NOT A FISCAL DOCUMENT';

export interface MockInvoicePdfInput {
  invoiceNumber: string;
  issuedAt: Date;
  currency: string;
  subtotal: string;
  taxAmount: string;
  total: string;
  description: string;
  payerName: string;
  payeeName: string;
  paymentReference: string | null;
}

/**
 * Escapes a PDF literal string for WinAnsi Helvetica. Em/en dashes use their
 * WinAnsi octal codes; anything else outside printable ASCII becomes `?`.
 */
export function pdfEscape(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 63;
    if (ch === '\\' || ch === '(' || ch === ')') out += `\\${ch}`;
    else if (ch === '—') out += '\\227';
    else if (ch === '–') out += '\\226';
    else if (code >= 0x20 && code <= 0x7e) out += ch;
    else out += code < 0x20 ? ' ' : '?';
  }
  return out;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

type Font = 'F1' | 'F2';

function text(
  font: Font,
  size: number,
  x: number,
  y: number,
  value: string,
  color = '0 g',
): string {
  return `BT /${font} ${size} Tf ${color} ${x} ${y} Td (${pdfEscape(value)}) Tj ET`;
}

function watermarkText(size: number, x: number, y: number, value: string) {
  // 45° rotation matrix, light grey so the invoice body stays legible.
  return `BT /F2 ${size} Tf 0.87 g 0.7071 0.7071 -0.7071 0.7071 ${x} ${y} Tm (${pdfEscape(value)}) Tj ET`;
}

function contentStream(input: MockInvoicePdfInput): string {
  const issued = input.issuedAt.toISOString().slice(0, 10);
  const money = (value: string) => `${input.currency} ${value}`;
  const ops = [
    // Diagonal watermark first so everything else draws over it.
    watermarkText(44, 60, 300, 'TEST INVOICE'),
    watermarkText(44, 90, 230, 'DEVELOPMENT ONLY'),
    // Top banner with the full disclaimer.
    '0.75 0.10 0.10 rg 0 802 595 40 re f',
    text('F2', 10, 40, 818, TEST_INVOICE_WATERMARK, '1 g'),
    // Header.
    text('F2', 22, 40, 760, 'INVOICE'),
    text('F1', 11, 40, 735, `Invoice number: ${input.invoiceNumber}`),
    text('F1', 11, 40, 718, `Issue date: ${issued}`),
    text(
      'F1',
      11,
      40,
      701,
      `Payment reference: ${input.paymentReference ?? 'n/a'}`,
    ),
    // Parties.
    text('F2', 10, 40, 665, 'BILLED TO'),
    text('F1', 11, 40, 649, truncate(input.payerName, 60)),
    text('F2', 10, 320, 665, 'PROVIDER'),
    text('F1', 11, 320, 649, truncate(input.payeeName, 40)),
    // Line item.
    '0.5 w 40 612 m 555 612 l S',
    text('F2', 10, 40, 598, 'DESCRIPTION'),
    text('F2', 10, 440, 598, 'AMOUNT'),
    '0.5 w 40 590 m 555 590 l S',
    text('F1', 11, 40, 572, truncate(input.description, 62)),
    text('F1', 11, 440, 572, money(input.subtotal)),
    // Totals.
    text('F1', 11, 320, 530, 'Subtotal'),
    text('F1', 11, 440, 530, money(input.subtotal)),
    text('F1', 11, 320, 512, 'Tax'),
    text('F1', 11, 440, 512, money(input.taxAmount)),
    '0.5 w 320 500 m 555 500 l S',
    text('F2', 12, 320, 482, 'Total'),
    text('F2', 12, 440, 482, money(input.total)),
    text(
      'F1',
      9,
      40,
      430,
      'Paid through the development mock payment provider. No real funds were moved.',
    ),
    // Footer disclaimer.
    '0.75 0.10 0.10 rg 0 0 595 36 re f',
    text('F2', 9, 40, 14, TEST_INVOICE_WATERMARK, '1 g'),
  ];
  return ops.join('\n');
}

export function renderMockInvoicePdf(input: MockInvoicePdfInput): Buffer {
  const content = contentStream(input);
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] ' +
      '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
  pdf += `startxref\n${xrefOffset}\n%%EOF\n`;

  return Buffer.from(pdf, 'latin1');
}
