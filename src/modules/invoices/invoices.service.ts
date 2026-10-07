import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MediaPurpose, PaymentStatus } from '@prisma/client';
import { randomInt, randomUUID } from 'crypto';
import {
  SupabaseService,
  type StorageBucket,
} from '../../infrastructure/supabase/supabase.service';
import { MediaService } from '../media/media.service';
import { MEDIA_ASSET_REPOSITORY } from '../media/repositories/media-asset.repository';
import type { MediaAssetRepository } from '../media/repositories/media-asset.repository';
import {
  InvoiceDocumentResponseDto,
  InvoiceResponseDto,
} from './dto/invoice-response.dto';
import {
  INVOICING_PROVIDER,
  type InvoicingProvider,
} from './invoicing-provider.interface';
import {
  INVOICE_REPOSITORY,
  type InvoiceRepository,
} from './repositories/invoice.repository';

const INVOICE_BUCKET: StorageBucket = 'invoices';
const MAX_NUMBER_ATTEMPTS = 5;

/** `MWH-2026-004217` — year + six random digits (unique-constrained). */
export function generateInvoiceNumber(now = new Date()): string {
  const serial = String(randomInt(0, 1_000_000)).padStart(6, '0');
  return `MWH-${now.getUTCFullYear()}-${serial}`;
}

export function invoiceFileName(invoiceNumber: string): string {
  return `Mawahib-Invoice-${invoiceNumber}.pdf`;
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code: string }).code === 'P2002'
  );
}

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    @Inject(INVOICE_REPOSITORY)
    private readonly invoices: InvoiceRepository,
    @Inject(INVOICING_PROVIDER)
    private readonly provider: InvoicingProvider,
    @Inject(MEDIA_ASSET_REPOSITORY)
    private readonly mediaAssets: MediaAssetRepository,
    private readonly media: MediaService,
    private readonly supabase: SupabaseService,
  ) {}

  /**
   * Creates the invoice row and PDF for a SUCCEEDED payment. Idempotent: an
   * already generated invoice is returned untouched; a failed one is retried.
   * Callers fire-and-forget — failures here must never undo a payment.
   */
  async generateForPayment(paymentId: string): Promise<InvoiceResponseDto> {
    const ctx = await this.invoices.loadPaymentContext(paymentId);
    if (!ctx) throw new NotFoundException('Payment not found');
    if (ctx.status !== PaymentStatus.succeeded) {
      throw new ConflictException(
        'Invoices are only issued for succeeded payments',
      );
    }

    let invoice = await this.invoices.findByPaymentId(paymentId);
    if (invoice?.status === 'generated') {
      return InvoiceResponseDto.fromEntity(invoice);
    }
    if (invoice) {
      invoice = await this.invoices.markPending(invoice.id);
    } else {
      invoice = await this.createPendingInvoice(ctx);
    }

    let assetId: string | null = null;
    try {
      const issuedAt = new Date();
      const document = await this.provider.generateInvoice({
        invoiceNumber: invoice.invoiceNumber,
        issuedAt,
        currency: ctx.currency,
        subtotal: invoice.subtotal.toString(),
        taxAmount: invoice.taxAmount.toString(),
        total: invoice.total.toString(),
        description: ctx.engagementTitle,
        payerName: ctx.payerName,
        payeeName: ctx.payeeName,
        paymentReference: ctx.providerReference,
      });

      // The payer owns the asset row; both parties read it via the invoice.
      assetId = randomUUID();
      const objectKey = `${ctx.payerUserId}/${assetId}.pdf`;
      await this.mediaAssets.createPending({
        id: assetId,
        ownerId: ctx.payerUserId,
        bucket: INVOICE_BUCKET,
        objectKey,
        mimeType: document.mimeType,
        byteSize: BigInt(document.pdf.length),
        purpose: MediaPurpose.invoice,
      });
      await this.supabase.uploadObject(
        INVOICE_BUCKET,
        objectKey,
        document.pdf,
        document.mimeType,
      );
      await this.mediaAssets.markReady(assetId);

      const generated = await this.invoices.markGenerated(invoice.id, {
        providerReference: document.providerReference,
        documentMediaAssetId: assetId,
        originalFileName: invoiceFileName(invoice.invoiceNumber),
        issuedAt,
      });
      return InvoiceResponseDto.fromEntity(generated);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(
        `Invoice generation failed for payment ${paymentId}: ${message}`,
      );
      if (assetId) {
        await this.mediaAssets.markFailed(assetId).catch(() => undefined);
      }
      await this.invoices
        .markFailed(invoice.id, message.slice(0, 500))
        .catch(() => undefined);
      throw err;
    }
  }

  async getInvoice(
    userId: string,
    invoiceId: string,
  ): Promise<InvoiceResponseDto> {
    const invoice = await this.requirePartyInvoice(userId, invoiceId);
    return InvoiceResponseDto.fromEntity(invoice);
  }

  async listForEngagement(
    userId: string,
    engagementId: string,
  ): Promise<InvoiceResponseDto[]> {
    const parties = await this.invoices.findEngagementParties(engagementId);
    if (!parties) throw new NotFoundException('Engagement not found');
    if (parties.clientId !== userId && parties.providerId !== userId) {
      throw new ForbiddenException('You are not a party to this engagement');
    }
    const items = await this.invoices.listForEngagement(engagementId);
    return items.map((item) => InvoiceResponseDto.fromEntity(item));
  }

  async getDocument(
    userId: string,
    invoiceId: string,
  ): Promise<InvoiceDocumentResponseDto> {
    const invoice = await this.requirePartyInvoice(userId, invoiceId);
    if (invoice.status !== 'generated' || !invoice.documentMediaAssetId) {
      throw new ConflictException('Invoice document is not ready yet');
    }
    const url = await this.media.getSignedUrlForAsset(
      invoice.documentMediaAssetId,
    );
    if (!url) throw new NotFoundException('Invoice document is not available');
    return {
      url,
      originalFileName:
        invoice.originalFileName ?? invoiceFileName(invoice.invoiceNumber),
      mimeType: 'application/pdf',
    };
  }

  private async createPendingInvoice(ctx: {
    paymentId: string;
    engagementId: string;
    amount: string;
    currency: string;
  }) {
    for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt++) {
      try {
        return await this.invoices.createPending({
          id: randomUUID(),
          engagementId: ctx.engagementId,
          paymentId: ctx.paymentId,
          invoiceNumber: generateInvoiceNumber(),
          provider: this.provider.kind,
          currency: ctx.currency,
          // No tax logic yet: the mock invoice is subtotal == total.
          subtotal: ctx.amount,
          taxAmount: '0.00',
          total: ctx.amount,
        });
      } catch (err: unknown) {
        if (!isUniqueViolation(err)) throw err;
        // A concurrent run may have created this payment's invoice already.
        const existing = await this.invoices.findByPaymentId(ctx.paymentId);
        if (existing) return existing;
        // Otherwise the number collided — draw another.
      }
    }
    throw new ConflictException('Could not allocate a unique invoice number');
  }

  private async requirePartyInvoice(userId: string, invoiceId: string) {
    const invoice = await this.invoices.findById(invoiceId);
    if (!invoice) throw new NotFoundException('Invoice not found');
    if (
      invoice.engagement.clientId !== userId &&
      invoice.engagement.providerId !== userId
    ) {
      throw new ForbiddenException('You are not a party to this invoice');
    }
    return invoice;
  }
}
