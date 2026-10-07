import { Injectable } from '@nestjs/common';
import {
  InvoiceStatus,
  type Invoice,
  type InvoiceProviderKind,
} from '@prisma/client';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type {
  InvoiceRepository,
  InvoiceWithParties,
  PaymentInvoiceContext,
} from './invoice.repository';

@Injectable()
export class PrismaInvoiceRepository implements InvoiceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadPaymentContext(
    paymentId: string,
  ): Promise<PaymentInvoiceContext | null> {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: {
        engagement: { select: { id: true, title: true } },
        payer: { select: { displayName: true } },
        payee: { select: { displayName: true } },
      },
    });
    if (!payment) return null;
    return {
      paymentId: payment.id,
      status: payment.status,
      engagementId: payment.engagementId,
      engagementTitle: payment.engagement.title,
      payerUserId: payment.payerUserId,
      payerName: payment.payer.displayName,
      payeeName: payment.payee.displayName,
      amount: payment.amount.toString(),
      currency: payment.currency,
      providerReference: payment.providerReference,
    };
  }

  findByPaymentId(paymentId: string): Promise<Invoice | null> {
    return this.prisma.invoice.findUnique({ where: { paymentId } });
  }

  createPending(input: {
    id: string;
    engagementId: string;
    paymentId: string;
    invoiceNumber: string;
    provider: InvoiceProviderKind;
    currency: string;
    subtotal: string;
    taxAmount: string;
    total: string;
  }): Promise<Invoice> {
    return this.prisma.invoice.create({
      data: { ...input, status: InvoiceStatus.pending },
    });
  }

  markPending(id: string): Promise<Invoice> {
    return this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.pending, failureMessage: null },
    });
  }

  markGenerated(
    id: string,
    input: {
      providerReference: string;
      documentMediaAssetId: string;
      originalFileName: string;
      issuedAt: Date;
    },
  ): Promise<Invoice> {
    return this.prisma.invoice.update({
      where: { id },
      data: {
        status: InvoiceStatus.generated,
        providerReference: input.providerReference,
        documentMediaAssetId: input.documentMediaAssetId,
        originalFileName: input.originalFileName,
        issuedAt: input.issuedAt,
        failureMessage: null,
      },
    });
  }

  markFailed(id: string, failureMessage: string): Promise<Invoice> {
    return this.prisma.invoice.update({
      where: { id },
      data: { status: InvoiceStatus.failed, failureMessage },
    });
  }

  findById(id: string): Promise<InvoiceWithParties | null> {
    return this.prisma.invoice.findUnique({
      where: { id },
      include: {
        engagement: { select: { id: true, clientId: true, providerId: true } },
      },
    });
  }

  listForEngagement(engagementId: string): Promise<Invoice[]> {
    return this.prisma.invoice.findMany({
      where: { engagementId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findEngagementParties(engagementId: string) {
    return this.prisma.workEngagement.findFirst({
      where: { id: engagementId, deletedAt: null },
      select: { id: true, clientId: true, providerId: true },
    });
  }
}
