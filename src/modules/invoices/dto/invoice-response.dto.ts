import type {
  Invoice,
  InvoiceProviderKind,
  InvoiceStatus,
} from '@prisma/client';

export class InvoiceResponseDto {
  id!: string;
  engagementId!: string;
  paymentId!: string;
  invoiceNumber!: string;
  provider!: InvoiceProviderKind;
  status!: InvoiceStatus;
  currency!: string;
  /** Decimal strings, e.g. "1250.00". */
  subtotal!: string;
  taxAmount!: string;
  total!: string;
  originalFileName!: string | null;
  /** True once a PDF exists and GET /invoices/:id/document will succeed. */
  hasDocument!: boolean;
  /** Mock invoices are watermarked test documents, not fiscal invoices. */
  isTestDocument!: boolean;
  issuedAt!: string | null;
  createdAt!: string;

  static fromEntity(entity: Invoice): InvoiceResponseDto {
    const dto = new InvoiceResponseDto();
    dto.id = entity.id;
    dto.engagementId = entity.engagementId;
    dto.paymentId = entity.paymentId;
    dto.invoiceNumber = entity.invoiceNumber;
    dto.provider = entity.provider;
    dto.status = entity.status;
    dto.currency = entity.currency;
    dto.subtotal = entity.subtotal.toString();
    dto.taxAmount = entity.taxAmount.toString();
    dto.total = entity.total.toString();
    dto.originalFileName = entity.originalFileName;
    dto.hasDocument =
      entity.status === 'generated' && entity.documentMediaAssetId !== null;
    dto.isTestDocument = entity.provider === 'mock';
    dto.issuedAt = entity.issuedAt?.toISOString() ?? null;
    dto.createdAt = entity.createdAt.toISOString();
    return dto;
  }
}

export class InvoiceDocumentResponseDto {
  url!: string;
  originalFileName!: string;
  mimeType!: string;
}
