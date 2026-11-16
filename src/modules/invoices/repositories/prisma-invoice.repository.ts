import { ForbiddenException, Injectable } from '@nestjs/common';
import {
  InvoiceStatus,
  StaffMembershipStatus,
  StaffRole,
  type Invoice,
  type InvoiceProviderKind,
} from '@prisma/client';
import { STAFF_ACCESS_DENIED } from '../../../common/auth/admission.codes';
import { assertAssetAttachable } from '../../account-deletion/asset-attachment';
import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type {
  InvoiceClaim,
  InvoiceCreateContext,
  InvoiceRepository,
  InvoiceWithParties,
} from './invoice.repository';

@Injectable()
export class PrismaInvoiceRepository implements InvoiceRepository {
  constructor(private readonly prisma: PrismaService) {}

  async loadCreateContext(paymentId: string): Promise<InvoiceCreateContext | null> {
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
    payerDisplayName: string;
    payeeDisplayName: string;
    description: string;
    paymentReference: string;
  }): Promise<Invoice> {
    return this.prisma.invoice.create({
      data: { ...input, status: InvoiceStatus.pending },
    });
  }

  async claimGeneration(input: {
    invoiceId: string;
    token: string;
    staleBefore: Date;
    staff: { issuer: string; subjectId: string } | null;
  }): Promise<InvoiceClaim> {
    return this.prisma.$transaction(async (tx) => {
      let actor: { id: string; subjectId: string } | null = null;
      if (input.staff) {
        const member = await tx.staffMember.findFirst({
          where: { issuer: input.staff.issuer, subjectId: input.staff.subjectId },
          select: { id: true, subjectId: true, status: true, role: true },
        });
        if (
          !member ||
          member.status !== StaffMembershipStatus.active ||
          member.role !== StaffRole.operator
        ) {
          throw new ForbiddenException({
            statusCode: 403,
            code: STAFF_ACCESS_DENIED,
            message: 'Staff access is required.',
          });
        }
        actor = member;
      }

      const claimed = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "invoices" AS i
        SET
          "generation_claim_token" = ${input.token}::uuid,
          "generation_claimed_at" = NOW(),
          "status" = 'pending'::"InvoiceStatus",
          "failure_message" = NULL,
          "updated_at" = NOW()
        FROM "payments" AS p
        WHERE i."payment_id" = p."id"
          AND i."id" = ${input.invoiceId}::uuid
          AND p."status" = 'succeeded'::"PaymentStatus"
          AND i."status" IN ('pending'::"InvoiceStatus", 'failed'::"InvoiceStatus")
          AND i."document_media_asset_id" IS NULL
          AND i."payer_display_name" IS NOT NULL
          AND i."payee_display_name" IS NOT NULL
          AND i."description" IS NOT NULL
          AND (
            i."generation_claim_token" IS NULL
            OR i."generation_claimed_at" < ${input.staleBefore}
          )
        RETURNING i."id"
      `;

      if (claimed.length === 1) {
        if (actor) {
          await tx.staffAuditEvent.create({
            data: {
              action: 'invoice_retried',
              targetSubjectId: input.invoiceId,
              targetInvoiceId: input.invoiceId,
              actorSubjectId: actor.subjectId,
              actorStaffMemberId: actor.id,
              unverifiedProcessUser: null,
            },
          });
        }
        const invoice = await tx.invoice.findUniqueOrThrow({
          where: { id: input.invoiceId },
        });
        const payment = await tx.payment.findUniqueOrThrow({
          where: { id: invoice.paymentId },
          select: { payerUserId: true },
        });
        return { kind: 'claimed', invoice, payerUserId: payment.payerUserId };
      }

      const state = await tx.invoice.findUnique({
        where: { id: input.invoiceId },
        include: { payment: { select: { status: true } } },
      });
      if (!state) return { kind: 'not_found' };
      if (state.status === InvoiceStatus.generated && state.documentMediaAssetId) {
        return { kind: 'generated', invoice: state };
      }
      if (
        state.payerDisplayName == null ||
        state.payeeDisplayName == null ||
        state.description == null
      ) {
        return { kind: 'snapshot_unavailable' };
      }
      if (state.payment.status !== 'succeeded') return { kind: 'payment_not_succeeded' };
      return { kind: 'in_progress' };
    });
  }

  async completeGeneration(
    id: string,
    token: string,
    input: {
      providerReference: string;
      documentMediaAssetId: string;
      originalFileName: string;
      issuedAt: Date;
    },
  ): Promise<Invoice | null> {
    return this.prisma.$transaction(async (tx) => {
      await assertAssetAttachable(tx, [input.documentMediaAssetId]);
      const updated = await tx.invoice.updateMany({
        where: {
          id,
          generationClaimToken: token,
          status: { in: [InvoiceStatus.pending, InvoiceStatus.failed] },
        },
        data: {
          status: InvoiceStatus.generated,
          providerReference: input.providerReference,
          documentMediaAssetId: input.documentMediaAssetId,
          originalFileName: input.originalFileName,
          issuedAt: input.issuedAt,
          failureMessage: null,
          generationClaimToken: null,
          generationClaimedAt: null,
        },
      });
      if (updated.count !== 1) return null;
      return tx.invoice.findUnique({ where: { id } });
    });
  }

  async failGeneration(id: string, token: string, failureMessage: string): Promise<boolean> {
    const updated = await this.prisma.invoice.updateMany({
      where: {
        id,
        generationClaimToken: token,
        status: { in: [InvoiceStatus.pending, InvoiceStatus.failed] },
      },
      data: {
        status: InvoiceStatus.failed,
        failureMessage,
        generationClaimToken: null,
        generationClaimedAt: null,
      },
    });
    return updated.count === 1;
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
