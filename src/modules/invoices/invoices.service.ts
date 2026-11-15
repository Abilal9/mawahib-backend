import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { MediaPurpose, PaymentStatus, type Invoice } from '@prisma/client';
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
  type InvoiceClaim,
  type InvoiceCreateContext,
  type InvoiceRepository,
} from './repositories/invoice.repository';

const INVOICE_BUCKET: StorageBucket = 'invoices';
const MAX_NUMBER_ATTEMPTS = 5;
/** A crashed claim can be taken again after this. The token, not the clock, protects the row. */
export const INVOICE_CLAIM_STALE_MS = 2 * 60 * 1000;

export const INVOICE_SNAPSHOT_UNAVAILABLE = 'invoice_snapshot_unavailable';
export const INVOICE_GENERATION_IN_PROGRESS = 'invoice_generation_in_progress';
export const INVOICE_PAYMENT_NOT_SUCCEEDED = 'invoice_payment_not_succeeded';

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

function hasDocument(invoice: Invoice): boolean {
  return invoice.status === 'generated' && invoice.documentMediaAssetId != null;
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
   * already generated invoice is returned untouched; a failed one is retried
   * from its snapshot. Callers fire-and-forget — failures here must never
   * undo a payment.
   */
  async generateForPayment(paymentId: string): Promise<InvoiceResponseDto> {
    const existing = await this.invoices.findByPaymentId(paymentId);
    if (existing && hasDocument(existing)) {
      return InvoiceResponseDto.fromEntity(existing);
    }
    if (!existing) {
      const ctx = await this.invoices.loadCreateContext(paymentId);
      if (!ctx) throw new NotFoundException('Payment not found');
      if (ctx.status !== PaymentStatus.succeeded) {
        throw this.conflict(
          INVOICE_PAYMENT_NOT_SUCCEEDED,
          'Invoices are only issued for succeeded payments',
        );
      }
      const created = await this.createPendingInvoice(ctx);
      if (hasDocument(created)) return InvoiceResponseDto.fromEntity(created);
      return this.finishGeneration(created.id, null);
    }
    return this.finishGeneration(existing.id, null);
  }

  /**
   * Active staff can regenerate a pending or failed invoice without the payer.
   * A generated document is returned unchanged.
   */
  async retryForStaff(
    invoiceId: string,
    staff: { issuer: string; subjectId: string },
  ): Promise<InvoiceResponseDto> {
    const existing = await this.invoices.findById(invoiceId);
    if (!existing) throw new NotFoundException('Invoice not found');
    if (hasDocument(existing)) return InvoiceResponseDto.fromEntity(existing);
    return this.finishGeneration(invoiceId, staff);
  }

  async getInvoice(userId: string, invoiceId: string): Promise<InvoiceResponseDto> {
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
    if (!hasDocument(invoice) || !invoice.documentMediaAssetId) {
      throw new ConflictException('Invoice document is not ready yet');
    }
    const url = await this.media.getSignedUrlForAsset(invoice.documentMediaAssetId);
    if (!url) throw new NotFoundException('Invoice document is not available');
    return {
      url,
      originalFileName:
        invoice.originalFileName ?? invoiceFileName(invoice.invoiceNumber),
      mimeType: 'application/pdf',
    };
  }

  private async finishGeneration(
    invoiceId: string,
    staff: { issuer: string; subjectId: string } | null,
  ): Promise<InvoiceResponseDto> {
    const token = randomUUID();
    const claim = await this.invoices.claimGeneration({
      invoiceId,
      token,
      staleBefore: new Date(Date.now() - INVOICE_CLAIM_STALE_MS),
      staff,
    });
    if (claim.kind === 'generated') return InvoiceResponseDto.fromEntity(claim.invoice);
    if (claim.kind !== 'claimed') throw claimConflict(claim.kind);

    const invoice = claim.invoice;
    if (
      invoice.payerDisplayName == null ||
      invoice.payeeDisplayName == null ||
      invoice.description == null
    ) {
      throw claimConflict('snapshot_unavailable');
    }

    let assetId: string | null = null;
    try {
      const issuedAt = new Date();
      const document = await this.provider.generateInvoice({
        invoiceNumber: invoice.invoiceNumber,
        issuedAt,
        currency: invoice.currency,
        subtotal: invoice.subtotal.toString(),
        taxAmount: invoice.taxAmount.toString(),
        total: invoice.total.toString(),
        description: invoice.description,
        payerName: invoice.payerDisplayName,
        payeeName: invoice.payeeDisplayName,
        paymentReference: invoice.paymentReference ? invoice.paymentReference : null,
      });

      assetId = randomUUID();
      const objectKey = `${claim.payerUserId}/${assetId}.pdf`;
      await this.mediaAssets.createPending({
        id: assetId,
        ownerId: claim.payerUserId,
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

      const generated = await this.invoices.completeGeneration(invoice.id, token, {
        providerReference: document.providerReference,
        documentMediaAssetId: assetId,
        originalFileName: invoiceFileName(invoice.invoiceNumber),
        issuedAt,
      });
      if (generated) return InvoiceResponseDto.fromEntity(generated);
      await this.discardAsset(assetId);
      return this.winnerOrConflict(invoice.id);
    } catch (err: unknown) {
      const current = await Promise.resolve(this.invoices.findById(invoice.id)).catch(() => null);
      if (current && assetId && current.documentMediaAssetId === assetId && hasDocument(current)) {
        return InvoiceResponseDto.fromEntity(current);
      }
      if (current && assetId && current.documentMediaAssetId !== assetId) {
        await this.discardAsset(assetId);
      }
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Invoice generation failed for ${invoiceId}: ${message}`);
      const failed = await this.invoices
        .failGeneration(invoice.id, token, message.slice(0, 500))
        .catch(() => false);
      if (!failed) {
        const latest = await Promise.resolve(this.invoices.findById(invoice.id)).catch(() => null);
        if (latest && hasDocument(latest)) return InvoiceResponseDto.fromEntity(latest);
      }
      throw err;
    }
  }

  private async winnerOrConflict(invoiceId: string): Promise<InvoiceResponseDto> {
    const current = await this.invoices.findById(invoiceId);
    if (current && hasDocument(current)) return InvoiceResponseDto.fromEntity(current);
    throw claimConflict('in_progress');
  }

  private async discardAsset(assetId: string): Promise<void> {
    await this.mediaAssets.markFailed(assetId).catch(() => undefined);
  }

  private async createPendingInvoice(ctx: InvoiceCreateContext) {
    for (let attempt = 0; attempt < MAX_NUMBER_ATTEMPTS; attempt++) {
      try {
        return await this.invoices.createPending({
          id: randomUUID(),
          engagementId: ctx.engagementId,
          paymentId: ctx.paymentId,
          invoiceNumber: generateInvoiceNumber(),
          provider: this.provider.kind,
          currency: ctx.currency,
          subtotal: ctx.amount,
          taxAmount: '0.00',
          total: ctx.amount,
          payerDisplayName: ctx.payerName,
          payeeDisplayName: ctx.payeeName,
          description: ctx.engagementTitle,
          paymentReference: ctx.providerReference ?? '',
        });
      } catch (err: unknown) {
        if (!isUniqueViolation(err)) throw err;
        const existing = await this.invoices.findByPaymentId(ctx.paymentId);
        if (existing) return existing;
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

  private conflict(code: string, message: string): ConflictException {
    return new ConflictException({ statusCode: 409, code, message });
  }
}

function claimConflict(kind: Exclude<InvoiceClaim['kind'], 'claimed' | 'generated'>): HttpException {
  if (kind === 'not_found') return new NotFoundException('Invoice not found');
  if (kind === 'snapshot_unavailable') {
    return new ConflictException({
      statusCode: 409,
      code: INVOICE_SNAPSHOT_UNAVAILABLE,
      message: 'This invoice has no saved party names, so it cannot be regenerated.',
    });
  }
  if (kind === 'payment_not_succeeded') {
    return new ConflictException({
      statusCode: 409,
      code: INVOICE_PAYMENT_NOT_SUCCEEDED,
      message: 'Invoices are only issued for succeeded payments',
    });
  }
  return new ConflictException({
    statusCode: 409,
    code: INVOICE_GENERATION_IN_PROGRESS,
    message: 'Invoice generation is already in progress.',
  });
}
