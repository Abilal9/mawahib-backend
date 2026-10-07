import type {
  InvoiceStatus,
  PaymentMethod,
  PaymentProviderKind,
  PaymentStatus,
} from '@prisma/client';
import type { PaymentWithInvoice } from '../repositories/payment.repository';

export class PaymentInvoiceSummaryDto {
  id!: string;
  invoiceNumber!: string;
  status!: InvoiceStatus;
}

export class PaymentResponseDto {
  id!: string;
  engagementId!: string;
  payerUserId!: string;
  payeeUserId!: string;
  /** Decimal string, e.g. "1250.00". */
  amount!: string;
  currency!: string;
  method!: PaymentMethod;
  provider!: PaymentProviderKind;
  providerReference!: string | null;
  status!: PaymentStatus;
  failureCode!: string | null;
  failureMessage!: string | null;
  succeededAt!: string | null;
  failedAt!: string | null;
  createdAt!: string;
  invoice!: PaymentInvoiceSummaryDto | null;

  static fromEntity(entity: PaymentWithInvoice): PaymentResponseDto {
    const dto = new PaymentResponseDto();
    dto.id = entity.id;
    dto.engagementId = entity.engagementId;
    dto.payerUserId = entity.payerUserId;
    dto.payeeUserId = entity.payeeUserId;
    dto.amount = entity.amount.toString();
    dto.currency = entity.currency;
    dto.method = entity.method;
    dto.provider = entity.provider;
    dto.providerReference = entity.providerReference;
    dto.status = entity.status;
    dto.failureCode = entity.failureCode;
    dto.failureMessage = entity.failureMessage;
    dto.succeededAt = entity.succeededAt?.toISOString() ?? null;
    dto.failedAt = entity.failedAt?.toISOString() ?? null;
    dto.createdAt = entity.createdAt.toISOString();
    dto.invoice = entity.invoice
      ? {
          id: entity.invoice.id,
          invoiceNumber: entity.invoice.invoiceNumber,
          status: entity.invoice.status,
        }
      : null;
    return dto;
  }
}
