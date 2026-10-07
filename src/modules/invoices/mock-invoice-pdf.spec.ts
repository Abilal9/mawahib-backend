import {
  pdfEscape,
  renderMockInvoicePdf,
  TEST_INVOICE_WATERMARK,
} from './mock-invoice-pdf';

describe('renderMockInvoicePdf', () => {
  const pdf = renderMockInvoicePdf({
    invoiceNumber: 'MWH-2026-004217',
    issuedAt: new Date('2026-10-06T10:00:00Z'),
    currency: 'SAR',
    subtotal: '1250.00',
    taxAmount: '0.00',
    total: '1250.00',
    description: 'Logo (v2) & brand \\ identity',
    payerName: 'Najd',
    payeeName: 'Layla',
    paymentReference: 'mock_pay_abc',
  });
  const text = pdf.toString('latin1');

  it('is a well-formed single-page PDF', () => {
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Count 1');
  });

  it('has exact xref offsets', () => {
    const startxref = Number(/startxref\n(\d+)\n/.exec(text)![1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const entries = [...text.slice(startxref).matchAll(/(\d{10}) 00000 n /g)];
    expect(entries).toHaveLength(6);
    entries.forEach((entry, index) => {
      const offset = Number(entry[1]);
      expect(text.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true);
    });
  });

  it('declares a correct stream length', () => {
    const match = /\/Length (\d+) >>\nstream\n([\s\S]*)\nendstream/.exec(text)!;
    expect(match[2].length).toBe(Number(match[1]));
  });

  it('carries the test-only watermark, number and amounts', () => {
    // Em dashes are written as WinAnsi octal escapes.
    expect(text).toContain(
      'TEST INVOICE \\227 DEVELOPMENT ONLY \\227 NOT A FISCAL DOCUMENT',
    );
    expect(TEST_INVOICE_WATERMARK).toContain('NOT A FISCAL DOCUMENT');
    expect(text).toContain('(TEST INVOICE) Tj');
    expect(text).toContain('MWH-2026-004217');
    expect(text).toContain('SAR 1250.00');
  });

  it('escapes PDF string delimiters', () => {
    expect(text).toContain('Logo \\(v2\\) & brand \\\\ identity');
    expect(pdfEscape('a(b)c\\d')).toBe('a\\(b\\)c\\\\d');
    expect(pdfEscape('مرحبا')).toBe('?????');
  });

  it('is pure ASCII so offsets are byte offsets', () => {
    for (const byte of pdf) expect(byte).toBeLessThan(128);
  });
});
