import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  InvoiceProviderKind,
  InvoiceStatus,
  MediaPurpose,
  PaymentStatus,
} from '@prisma/client';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { MediaService } from '../media/media.service';
import { MEDIA_ASSET_REPOSITORY } from '../media/repositories/media-asset.repository';
import {
  generateInvoiceNumber,
  invoiceFileName,
  InvoicesService,
} from './invoices.service';
import { INVOICING_PROVIDER } from './invoicing-provider.interface';
import { MockInvoicingProvider } from './mock-invoicing.provider';
import { INVOICE_REPOSITORY } from './repositories/invoice.repository';

describe('invoice numbering', () => {
  it('uses MWH-<year>-<6 digits>', () => {
    expect(generateInvoiceNumber(new Date('2026-10-06T00:00:00Z'))).toMatch(
      /^MWH-2026-\d{6}$/,
    );
  });

  it('names the file after the number', () => {
    expect(invoiceFileName('MWH-2026-004217')).toBe(
      'Mawahib-Invoice-MWH-2026-004217.pdf',
    );
  });
});

describe('MockInvoicingProvider', () => {
  it('renders a watermarked PDF', async () => {
    const doc = await new MockInvoicingProvider().generateInvoice({
      invoiceNumber: 'MWH-2026-000001',
      issuedAt: new Date(),
      currency: 'SAR',
      subtotal: '10.00',
      taxAmount: '0.00',
      total: '10.00',
      description: 'Job',
      payerName: 'A',
      payeeName: 'B',
      paymentReference: null,
    });
    expect(doc.mimeType).toBe('application/pdf');
    expect(doc.pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(doc.pdf.toString('latin1')).toContain('DEVELOPMENT ONLY');
    expect(doc.providerReference).toBe('mock_inv_MWH-2026-000001');
  });
});

describe('InvoicesService', () => {
  let service: InvoicesService;

  const invoices = {
    loadCreateContext: jest.fn(),
    findByPaymentId: jest.fn(),
    createPending: jest.fn(),
    claimGeneration: jest.fn(),
    completeGeneration: jest.fn(),
    failGeneration: jest.fn(),
    findById: jest.fn(),
    listForEngagement: jest.fn(),
    findEngagementParties: jest.fn(),
  };
  const mediaAssets = {
    createPending: jest.fn(),
    markReady: jest.fn(),
    markFailed: jest.fn(),
  };
  const media = { getSignedUrlForAsset: jest.fn() };
  const supabase = { uploadObject: jest.fn() };
  const provider = {
    kind: InvoiceProviderKind.mock,
    generateInvoice: jest.fn(),
  };

  const ctx = {
    paymentId: 'pay-1',
    status: PaymentStatus.succeeded,
    engagementId: 'eng-1',
    engagementTitle: 'Logo & Brand',
    payerUserId: 'biz-1',
    payerName: 'Najd',
    payeeName: 'Layla',
    amount: '1250.00',
    currency: 'AED',
    providerReference: 'mock_pay_abc',
  };

  const invoice = (overrides: Record<string, unknown> = {}) => ({
    id: 'inv-1',
    engagementId: 'eng-1',
    paymentId: 'pay-1',
    invoiceNumber: 'MWH-2026-004217',
    provider: InvoiceProviderKind.mock,
    providerReference: null,
    status: InvoiceStatus.pending,
    currency: 'AED',
    subtotal: '1250.00',
    taxAmount: '0.00',
    total: '1250.00',
    documentMediaAssetId: null,
    originalFileName: null,
    failureMessage: null,
    issuedAt: null,
    payerDisplayName: 'Najd',
    payeeDisplayName: 'Layla',
    description: 'Logo & Brand',
    paymentReference: 'mock_pay_abc',
    generationClaimToken: null,
    generationClaimedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  const withParties = (overrides: Record<string, unknown> = {}) => ({
    ...invoice({
      status: InvoiceStatus.generated,
      documentMediaAssetId: 'asset-1',
      originalFileName: 'Mawahib-Invoice-MWH-2026-004217.pdf',
      ...overrides,
    }),
    engagement: { id: 'eng-1', clientId: 'biz-1', providerId: 'tal-1' },
  });

  beforeEach(async () => {
    jest.resetAllMocks();
    invoices.loadCreateContext.mockResolvedValue(ctx);
    invoices.findByPaymentId.mockResolvedValue(null);
    invoices.createPending.mockImplementation(
      (input: Record<string, unknown>) =>
        Promise.resolve(
          invoice({ ...input, id: 'inv-1', invoiceNumber: 'MWH-2026-004217' }),
        ),
    );
    invoices.claimGeneration.mockResolvedValue({
      kind: 'claimed',
      payerUserId: 'biz-1',
      invoice: invoice(),
    });
    invoices.completeGeneration.mockImplementation(
      (_id: string, _token: string, input: Record<string, unknown>) =>
        Promise.resolve(invoice({ status: InvoiceStatus.generated, ...input })),
    );
    invoices.failGeneration.mockResolvedValue(true);
    mediaAssets.createPending.mockResolvedValue({});
    mediaAssets.markReady.mockResolvedValue({});
    mediaAssets.markFailed.mockResolvedValue({});
    supabase.uploadObject.mockResolvedValue(undefined);
    provider.generateInvoice.mockResolvedValue({
      providerReference: 'mock_inv_x',
      pdf: Buffer.from('%PDF-1.4 fake'),
      mimeType: 'application/pdf',
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InvoicesService,
        { provide: INVOICE_REPOSITORY, useValue: invoices },
        { provide: INVOICING_PROVIDER, useValue: provider },
        { provide: MEDIA_ASSET_REPOSITORY, useValue: mediaAssets },
        { provide: MediaService, useValue: media },
        { provide: SupabaseService, useValue: supabase },
      ],
    }).compile();
    service = module.get(InvoicesService);
  });

  describe('generateForPayment', () => {
    it('creates the invoice from the payment amount, stores the PDF as invoice media', async () => {
      const result = await service.generateForPayment('pay-1');

      expect(invoices.createPending).toHaveBeenCalledWith(
        expect.objectContaining({
          engagementId: 'eng-1',
          paymentId: 'pay-1',
          currency: 'AED',
          subtotal: '1250.00',
          taxAmount: '0.00',
          total: '1250.00',
          payerDisplayName: 'Najd',
          payeeDisplayName: 'Layla',
          description: 'Logo & Brand',
          paymentReference: 'mock_pay_abc',
          invoiceNumber: expect.stringMatching(/^MWH-\d{4}-\d{6}$/) as string,
        }),
      );
      expect(provider.generateInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          description: 'Logo & Brand',
          total: '1250.00',
          payerName: 'Najd',
          payeeName: 'Layla',
        }),
      );
      expect(mediaAssets.createPending).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: 'biz-1',
          bucket: 'invoices',
          purpose: MediaPurpose.invoice,
          mimeType: 'application/pdf',
        }),
      );
      expect(supabase.uploadObject).toHaveBeenCalledWith(
        'invoices',
        expect.stringMatching(/^biz-1\/.+\.pdf$/) as string,
        expect.any(Buffer) as Buffer,
        'application/pdf',
      );
      expect(mediaAssets.markReady).toHaveBeenCalled();
      expect(invoices.completeGeneration).toHaveBeenCalledWith(
        'inv-1',
        expect.any(String),
        expect.objectContaining({
          originalFileName: 'Mawahib-Invoice-MWH-2026-004217.pdf',
        }),
      );
      expect(result.status).toBe(InvoiceStatus.generated);
      expect(result.hasDocument).toBe(true);
      expect(result.isTestDocument).toBe(true);
    });

    it('is idempotent for an already generated invoice', async () => {
      invoices.findByPaymentId.mockResolvedValue(
        invoice({
          status: InvoiceStatus.generated,
          documentMediaAssetId: 'asset-1',
        }),
      );

      await service.generateForPayment('pay-1');

      expect(provider.generateInvoice).not.toHaveBeenCalled();
      expect(invoices.createPending).not.toHaveBeenCalled();
      expect(invoices.claimGeneration).not.toHaveBeenCalled();
    });

    it('retries a failed invoice from the stored names, not a fresh profile', async () => {
      invoices.findByPaymentId.mockResolvedValue(
        invoice({
          status: InvoiceStatus.failed,
          payerDisplayName: 'Before',
          payeeDisplayName: 'Provider then',
        }),
      );
      invoices.claimGeneration.mockResolvedValue({
        kind: 'claimed',
        payerUserId: 'biz-1',
        invoice: invoice({
          status: InvoiceStatus.pending,
          payerDisplayName: 'Before',
          payeeDisplayName: 'Provider then',
        }),
      });

      await service.generateForPayment('pay-1');

      expect(invoices.loadCreateContext).not.toHaveBeenCalled();
      expect(invoices.createPending).not.toHaveBeenCalled();
      expect(provider.generateInvoice).toHaveBeenCalledWith(
        expect.objectContaining({
          payerName: 'Before',
          payeeName: 'Provider then',
        }),
      );
    });

    it('marks the invoice failed with the claim token when storage fails', async () => {
      supabase.uploadObject.mockRejectedValue(new Error('storage down'));
      invoices.findById.mockResolvedValue(
        invoice({ status: InvoiceStatus.pending, documentMediaAssetId: null }),
      );

      await expect(service.generateForPayment('pay-1')).rejects.toThrow(
        'storage down',
      );

      expect(invoices.failGeneration).toHaveBeenCalledWith(
        'inv-1',
        expect.any(String),
        'storage down',
      );
      expect(mediaAssets.markFailed).toHaveBeenCalled();
      expect(invoices.completeGeneration).not.toHaveBeenCalled();
    });

    it('does not fail the uploaded asset when the invoice state cannot be read', async () => {
      supabase.uploadObject.mockRejectedValue(new Error('storage down'));
      invoices.findById.mockRejectedValue(new Error('db down'));

      await expect(service.generateForPayment('pay-1')).rejects.toThrow('storage down');

      expect(mediaAssets.markFailed).not.toHaveBeenCalled();
    });

    it('keeps a generated invoice when a late attempt loses the claim', async () => {
      invoices.completeGeneration.mockResolvedValue(null);
      invoices.findById.mockResolvedValue(
        invoice({
          status: InvoiceStatus.generated,
          documentMediaAssetId: 'winner-asset',
        }),
      );

      const result = await service.generateForPayment('pay-1');

      expect(result.hasDocument).toBe(true);
      expect(mediaAssets.markFailed).toHaveBeenCalled();
      expect(invoices.failGeneration).not.toHaveBeenCalled();
    });

    it('does not fail the asset after the invoice already points at it', async () => {
      let storedAsset = '';
      mediaAssets.createPending.mockImplementation(async (input: { id: string }) => {
        storedAsset = input.id;
        return {};
      });
      invoices.completeGeneration.mockRejectedValue(new Error('result read failed'));
      invoices.findById.mockImplementation(async () =>
        invoice({
          status: InvoiceStatus.generated,
          documentMediaAssetId: storedAsset,
        }),
      );

      const result = await service.generateForPayment('pay-1');

      expect(result.hasDocument).toBe(true);
      expect(mediaAssets.markFailed).not.toHaveBeenCalled();
      expect(invoices.failGeneration).not.toHaveBeenCalled();
    });

    it('returns the winner when failure finalization loses the claim', async () => {
      supabase.uploadObject.mockRejectedValue(new Error('storage down'));
      invoices.failGeneration.mockResolvedValue(false);
      invoices.findById.mockResolvedValue(
        invoice({
          status: InvoiceStatus.generated,
          documentMediaAssetId: 'winner-asset',
        }),
      );

      const result = await service.generateForPayment('pay-1');

      expect(result.hasDocument).toBe(true);
    });

    it('refuses a legacy invoice that has no snapshot', async () => {
      invoices.findByPaymentId.mockResolvedValue(
        invoice({ payerDisplayName: null, payeeDisplayName: null, description: null }),
      );
      invoices.claimGeneration.mockResolvedValue({ kind: 'snapshot_unavailable' });

      await expect(service.generateForPayment('pay-1')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'invoice_snapshot_unavailable' }) as object,
      });
      expect(provider.generateInvoice).not.toHaveBeenCalled();
    });

    it('does not start a second attempt while a claim is current', async () => {
      invoices.findByPaymentId.mockResolvedValue(invoice({ status: InvoiceStatus.pending }));
      invoices.claimGeneration.mockResolvedValue({ kind: 'in_progress' });

      await expect(service.generateForPayment('pay-1')).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'invoice_generation_in_progress' }) as object,
      });
    });

    it('draws another number when the first collides', async () => {
      invoices.createPending
        .mockRejectedValueOnce({ code: 'P2002' })
        .mockImplementation((input: Record<string, unknown>) =>
          Promise.resolve(invoice({ ...input, id: 'inv-1' })),
        );

      await service.generateForPayment('pay-1');

      expect(invoices.createPending).toHaveBeenCalledTimes(2);
    });

    it('reuses the invoice a concurrent run already created for the payment', async () => {
      invoices.createPending.mockRejectedValueOnce({ code: 'P2002' });
      invoices.findByPaymentId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(invoice());

      await service.generateForPayment('pay-1');

      expect(invoices.createPending).toHaveBeenCalledTimes(1);
      expect(invoices.claimGeneration).toHaveBeenCalled();
    });

    it('only invoices succeeded payments', async () => {
      invoices.loadCreateContext.mockResolvedValue({
        ...ctx,
        status: PaymentStatus.failed,
      });

      await expect(service.generateForPayment('pay-1')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(invoices.createPending).not.toHaveBeenCalled();
    });

    it('404s for an unknown payment', async () => {
      invoices.loadCreateContext.mockResolvedValue(null);

      await expect(service.generateForPayment('nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('retryForStaff', () => {
    const staff = { issuer: 'https://staff.example', subjectId: 'staff-1' };

    it('returns a generated invoice without rendering another document', async () => {
      invoices.findById.mockResolvedValue(withParties());

      const result = await service.retryForStaff('inv-1', staff);

      expect(result.hasDocument).toBe(true);
      expect(invoices.claimGeneration).not.toHaveBeenCalled();
      expect(provider.generateInvoice).not.toHaveBeenCalled();
    });

    it('passes the staff identity into the claim and renders the snapshot', async () => {
      invoices.findById.mockResolvedValue(
        withParties({ status: InvoiceStatus.failed, documentMediaAssetId: null }),
      );

      await service.retryForStaff('inv-1', staff);

      expect(invoices.claimGeneration).toHaveBeenCalledWith(
        expect.objectContaining({ invoiceId: 'inv-1', staff }),
      );
      expect(invoices.loadCreateContext).not.toHaveBeenCalled();
    });

    it('surfaces an inactive-staff refusal from the claim', async () => {
      invoices.findById.mockResolvedValue(
        withParties({ status: InvoiceStatus.failed, documentMediaAssetId: null }),
      );
      invoices.claimGeneration.mockRejectedValue(new ForbiddenException('Staff access is required.'));

      await expect(service.retryForStaff('inv-1', staff)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(provider.generateInvoice).not.toHaveBeenCalled();
    });
  });

  describe('reads (parties only)', () => {
    it('lets both parties fetch an invoice, nobody else', async () => {
      invoices.findById.mockResolvedValue(withParties());

      await expect(service.getInvoice('biz-1', 'inv-1')).resolves.toEqual(
        expect.objectContaining({
          invoiceNumber: 'MWH-2026-004217',
          total: '1250.00',
        }),
      );
      await expect(service.getInvoice('tal-1', 'inv-1')).resolves.toBeDefined();
      await expect(
        service.getInvoice('stranger', 'inv-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404s for a missing invoice', async () => {
      invoices.findById.mockResolvedValue(null);

      await expect(service.getInvoice('biz-1', 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('lists engagement invoices for parties only', async () => {
      invoices.findEngagementParties.mockResolvedValue({
        id: 'eng-1',
        clientId: 'biz-1',
        providerId: 'tal-1',
      });
      invoices.listForEngagement.mockResolvedValue([invoice()]);

      await expect(
        service.listForEngagement('tal-1', 'eng-1'),
      ).resolves.toHaveLength(1);
      await expect(
        service.listForEngagement('stranger', 'eng-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);

      invoices.findEngagementParties.mockResolvedValue(null);
      await expect(
        service.listForEngagement('biz-1', 'nope'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('returns a signed document url for parties', async () => {
      invoices.findById.mockResolvedValue(withParties());
      media.getSignedUrlForAsset.mockResolvedValue(
        'https://signed/invoice.pdf',
      );

      await expect(service.getDocument('tal-1', 'inv-1')).resolves.toEqual({
        url: 'https://signed/invoice.pdf',
        originalFileName: 'Mawahib-Invoice-MWH-2026-004217.pdf',
        mimeType: 'application/pdf',
      });
      expect(media.getSignedUrlForAsset).toHaveBeenCalledWith('asset-1');
    });

    it('forbids strangers from the document and conflicts while it is not ready', async () => {
      invoices.findById.mockResolvedValue(withParties());
      await expect(
        service.getDocument('stranger', 'inv-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(media.getSignedUrlForAsset).not.toHaveBeenCalled();

      invoices.findById.mockResolvedValue(
        withParties({
          status: InvoiceStatus.pending,
          documentMediaAssetId: null,
        }),
      );
      await expect(
        service.getDocument('biz-1', 'inv-1'),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });
});
