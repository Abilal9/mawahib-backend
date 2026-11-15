import { ForbiddenException } from '@nestjs/common';
import {
  InvoiceStatus,
  MediaPurpose,
  MediaStatus,
  PaymentMethod,
  PaymentProviderKind,
  PaymentStatus,
  PrismaClient,
  StaffMembershipStatus,
  WorkEngagementSource,
} from '@prisma/client';
import { PrismaInvoiceRepository } from './repositories/prisma-invoice.repository';

const databaseUrl = process.env.INVOICE_CLAIM_DATABASE_URL;

describe('invoice generation claim', () => {
  if (!databaseUrl) {
    it.skip('requires INVOICE_CLAIM_DATABASE_URL', () => undefined);
    return;
  }
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const invoices = new PrismaInvoiceRepository(prisma as never);
  const stale = new Date(Date.now() - 3 * 60 * 1000);

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.$executeRawUnsafe(`
      DELETE FROM "invoices"
      WHERE NOT (
        ("payer_display_name" IS NULL AND "payee_display_name" IS NULL AND "description" IS NULL)
        OR ("payer_display_name" IS NOT NULL AND "payee_display_name" IS NOT NULL AND "description" IS NOT NULL)
      )
    `);
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'invoices_snapshot_all_or_nothing'
            AND conrelid = 'public.invoices'::regclass
        ) THEN
          ALTER TABLE "invoices"
            ADD CONSTRAINT "invoices_snapshot_all_or_nothing"
            CHECK (
              (
                "payer_display_name" IS NULL
                AND "payee_display_name" IS NULL
                AND "description" IS NULL
              )
              OR (
                "payer_display_name" IS NOT NULL
                AND "payee_display_name" IS NOT NULL
                AND "description" IS NOT NULL
              )
            );
        END IF;
      END $$;
    `);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function seed(paymentStatus: PaymentStatus = PaymentStatus.succeeded) {
    const clientId = crypto.randomUUID();
    const providerId = crypto.randomUUID();
    const engagementId = crypto.randomUUID();
    await prisma.user.create({
      data: {
        id: clientId,
        email: `${clientId}@invoice-claim.test`,
        accountType: 'business',
        displayName: 'Payer Then',
        username: `c${clientId.slice(0, 12)}`,
      },
    });
    await prisma.user.create({
      data: {
        id: providerId,
        email: `${providerId}@invoice-claim.test`,
        accountType: 'talent',
        displayName: 'Payee Then',
        username: `p${providerId.slice(0, 12)}`,
      },
    });
    await prisma.workEngagement.create({
      data: {
        id: engagementId,
        clientId,
        providerId,
        title: 'Original title',
        status: 'in_progress',
        source: WorkEngagementSource.direct,
      },
    });
    const payment = await prisma.payment.create({
      data: {
        engagementId,
        payerUserId: clientId,
        payeeUserId: providerId,
        amount: '25.00',
        currency: 'SAR',
        method: PaymentMethod.card,
        provider: PaymentProviderKind.mock,
        status: paymentStatus,
        providerReference: 'mock_ref',
        idempotencyKey: crypto.randomUUID(),
        ...(paymentStatus === PaymentStatus.succeeded
          ? { settlementKey: engagementId }
          : {}),
      },
    });
    return { clientId, providerId, engagementId, paymentId: payment.id };
  }

  async function invoiceFor(
    row: { engagementId: string; paymentId: string },
    snapshot: { payer: string | null; payee: string | null; description: string | null },
    status: InvoiceStatus = InvoiceStatus.pending,
  ) {
    return prisma.invoice.create({
      data: {
        engagementId: row.engagementId,
        paymentId: row.paymentId,
        invoiceNumber: `MWH-TEST-${crypto.randomUUID().slice(0, 8)}`,
        provider: 'mock',
        status,
        currency: 'SAR',
        subtotal: '25.00',
        taxAmount: '0.00',
        total: '25.00',
        payerDisplayName: snapshot.payer,
        payeeDisplayName: snapshot.payee,
        description: snapshot.description,
        paymentReference: snapshot.payer == null ? null : 'mock_ref',
      },
    });
  }

  it('keeps the snapshot after the profile name changes', async () => {
    const row = await seed();
    const invoice = await invoiceFor(row, {
      payer: 'Payer Then',
      payee: 'Payee Then',
      description: 'Original title',
    });
    await prisma.user.update({
      where: { id: row.clientId },
      data: { displayName: 'Payer Now' },
    });
    await prisma.workEngagement.update({
      where: { id: row.engagementId },
      data: { title: 'Renamed' },
    });

    const claim = await invoices.claimGeneration({
      invoiceId: invoice.id,
      token: crypto.randomUUID(),
      staleBefore: stale,
      staff: null,
    });

    expect(claim.kind).toBe('claimed');
    if (claim.kind !== 'claimed') return;
    expect(claim.invoice.payerDisplayName).toBe('Payer Then');
    expect(claim.invoice.description).toBe('Original title');
    expect(claim.payerUserId).toBe(row.clientId);
  });

  it('lets one claim win and keeps the other from writing', async () => {
    const row = await seed();
    const invoice = await invoiceFor(row, {
      payer: 'Payer Then',
      payee: 'Payee Then',
      description: 'Original title',
    });
    const first = crypto.randomUUID();
    const second = crypto.randomUUID();
    const [left, right] = await Promise.all([
      invoices.claimGeneration({ invoiceId: invoice.id, token: first, staleBefore: stale, staff: null }),
      invoices.claimGeneration({ invoiceId: invoice.id, token: second, staleBefore: stale, staff: null }),
    ]);
    const kinds = [left.kind, right.kind].sort();
    expect(kinds).toEqual(['claimed', 'in_progress']);

    const winner = left.kind === 'claimed' ? first : second;
    const loser = winner === first ? second : first;
    const assetId = crypto.randomUUID();
    await prisma.mediaAsset.create({
      data: {
        id: assetId,
        ownerId: row.clientId,
        bucket: 'invoices',
        objectKey: `${row.clientId}/${assetId}.pdf`,
        mimeType: 'application/pdf',
        byteSize: 10,
        purpose: MediaPurpose.invoice,
        status: MediaStatus.ready,
      },
    });
    const completed = await invoices.completeGeneration(invoice.id, winner, {
      providerReference: 'mock_inv',
      documentMediaAssetId: assetId,
      originalFileName: 'invoice.pdf',
      issuedAt: new Date('2026-11-15T00:00:00.000Z'),
    });
    expect(completed?.status).toBe(InvoiceStatus.generated);
    expect(await invoices.completeGeneration(invoice.id, loser, {
      providerReference: 'late',
      documentMediaAssetId: assetId,
      originalFileName: 'late.pdf',
      issuedAt: new Date('2026-11-15T01:00:00.000Z'),
    })).toBeNull();
    expect(await invoices.failGeneration(invoice.id, loser, 'late failure')).toBe(false);
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(stored.status).toBe(InvoiceStatus.generated);
    expect(stored.documentMediaAssetId).toBe(assetId);
    expect(stored.invoiceNumber).toBe(invoice.invoiceNumber);
    expect(stored.originalFileName).toBe('invoice.pdf');
  });

  it('replaces a stale claim without letting the old token overwrite the new document', async () => {
    const row = await seed();
    const invoice = await invoiceFor(row, {
      payer: 'Payer Then',
      payee: 'Payee Then',
      description: 'Original title',
    });
    const oldToken = crypto.randomUUID();
    await prisma.invoice.update({
      where: { id: invoice.id },
      data: { generationClaimToken: oldToken, generationClaimedAt: stale },
    });
    const fresh = crypto.randomUUID();
    const claim = await invoices.claimGeneration({
      invoiceId: invoice.id,
      token: fresh,
      staleBefore: new Date(Date.now() - 2 * 60 * 1000),
      staff: null,
    });
    expect(claim.kind).toBe('claimed');
    const assetId = crypto.randomUUID();
    await prisma.mediaAsset.create({
      data: {
        id: assetId,
        ownerId: row.clientId,
        bucket: 'invoices',
        objectKey: `${row.clientId}/${assetId}.pdf`,
        mimeType: 'application/pdf',
        byteSize: 10,
        purpose: MediaPurpose.invoice,
        status: MediaStatus.ready,
      },
    });
    await invoices.completeGeneration(invoice.id, fresh, {
      providerReference: 'mock_inv',
      documentMediaAssetId: assetId,
      originalFileName: 'fresh.pdf',
      issuedAt: new Date('2026-11-15T00:00:00.000Z'),
    });
    expect(await invoices.completeGeneration(invoice.id, oldToken, {
      providerReference: 'old',
      documentMediaAssetId: assetId,
      originalFileName: 'old.pdf',
      issuedAt: new Date('2026-11-15T02:00:00.000Z'),
    })).toBeNull();
    expect(await invoices.failGeneration(invoice.id, oldToken, 'stale')).toBe(false);
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(stored.originalFileName).toBe('fresh.pdf');
    expect(stored.status).toBe(InvoiceStatus.generated);
  });

  it('releases a failed claim so the next retry does not wait', async () => {
    const row = await seed();
    const invoice = await invoiceFor(row, {
      payer: 'Payer Then',
      payee: 'Payee Then',
      description: 'Original title',
    });
    const first = crypto.randomUUID();
    expect((await invoices.claimGeneration({
      invoiceId: invoice.id,
      token: first,
      staleBefore: stale,
      staff: null,
    })).kind).toBe('claimed');
    expect(await invoices.failGeneration(invoice.id, first, 'storage down')).toBe(true);
    const second = crypto.randomUUID();
    const again = await invoices.claimGeneration({
      invoiceId: invoice.id,
      token: second,
      staleBefore: new Date(),
      staff: null,
    });
    expect(again.kind).toBe('claimed');
  });

  it('does not claim a legacy invoice or a generated document', async () => {
    const legacyPayment = await seed();
    const legacy = await invoiceFor(legacyPayment, {
      payer: null,
      payee: null,
      description: null,
    });
    expect((await invoices.claimGeneration({
      invoiceId: legacy.id,
      token: crypto.randomUUID(),
      staleBefore: stale,
      staff: null,
    })).kind).toBe('snapshot_unavailable');
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: legacy.id } })).generationClaimToken).toBeNull();

    const done = await seed();
    const assetId = crypto.randomUUID();
    await prisma.mediaAsset.create({
      data: {
        id: assetId,
        ownerId: done.clientId,
        bucket: 'invoices',
        objectKey: `${done.clientId}/${assetId}.pdf`,
        mimeType: 'application/pdf',
        byteSize: 10,
        purpose: MediaPurpose.invoice,
        status: MediaStatus.ready,
      },
    });
    const generated = await invoiceFor(done, {
      payer: null,
      payee: null,
      description: null,
    }, InvoiceStatus.generated);
    await prisma.invoice.update({
      where: { id: generated.id },
      data: { documentMediaAssetId: assetId, originalFileName: 'kept.pdf' },
    });
    const claim = await invoices.claimGeneration({
      invoiceId: generated.id,
      token: crypto.randomUUID(),
      staleBefore: stale,
      staff: null,
    });
    expect(claim.kind).toBe('generated');
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: generated.id } });
    expect(stored.originalFileName).toBe('kept.pdf');
    expect(stored.documentMediaAssetId).toBe(assetId);
  });

  it('refuses a payment that did not succeed and an inactive staff member', async () => {
    const row = await seed(PaymentStatus.failed);
    const invoice = await invoiceFor(row, {
      payer: 'Payer Then',
      payee: 'Payee Then',
      description: 'Original title',
    });
    expect((await invoices.claimGeneration({
      invoiceId: invoice.id,
      token: crypto.randomUUID(),
      staleBefore: stale,
      staff: null,
    })).kind).toBe('payment_not_succeeded');

    const issuer = 'https://staff.example/auth/v1';
    const subjectId = crypto.randomUUID();
    await prisma.staffMember.create({
      data: {
        issuer,
        subjectId,
        status: StaffMembershipStatus.inactive,
      },
    });
    const activeRow = await seed();
    const activeInvoice = await invoiceFor(activeRow, {
      payer: 'Payer Then',
      payee: 'Payee Then',
      description: 'Original title',
    });
    await expect(invoices.claimGeneration({
      invoiceId: activeInvoice.id,
      token: crypto.randomUUID(),
      staleBefore: stale,
      staff: { issuer, subjectId },
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: activeInvoice.id } })).generationClaimToken).toBeNull();
    expect(await prisma.staffAuditEvent.count({ where: { targetInvoiceId: activeInvoice.id } })).toBe(0);
  });

  it('audits only the staff claim that was taken', async () => {
    const issuer = 'https://staff.example/auth/v1';
    const subjectId = crypto.randomUUID();
    await prisma.staffMember.create({
      data: { issuer, subjectId, status: StaffMembershipStatus.active },
    });
    const row = await seed();
    const invoice = await invoiceFor(row, {
      payer: 'Payer Then',
      payee: 'Payee Then',
      description: 'Original title',
    });
    const claim = await invoices.claimGeneration({
      invoiceId: invoice.id,
      token: crypto.randomUUID(),
      staleBefore: stale,
      staff: { issuer, subjectId },
    });
    expect(claim.kind).toBe('claimed');
    expect(await prisma.staffAuditEvent.count({
      where: { targetInvoiceId: invoice.id, action: 'invoice_retried' },
    })).toBe(1);
    const second = await invoices.claimGeneration({
      invoiceId: invoice.id,
      token: crypto.randomUUID(),
      staleBefore: stale,
      staff: { issuer, subjectId },
    });
    expect(second.kind).toBe('in_progress');
    expect(await prisma.staffAuditEvent.count({ where: { targetInvoiceId: invoice.id } })).toBe(1);
  });

  it('rejects a partial snapshot', async () => {
    const row = await seed();
    await expect(prisma.invoice.create({
      data: {
        engagementId: row.engagementId,
        paymentId: row.paymentId,
        invoiceNumber: `MWH-TEST-${crypto.randomUUID().slice(0, 8)}`,
        currency: 'SAR',
        subtotal: '25.00',
        taxAmount: '0.00',
        total: '25.00',
        payerDisplayName: 'Only the payer',
      },
    })).rejects.toThrow();
  });
});
