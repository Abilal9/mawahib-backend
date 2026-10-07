import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  PaymentMethod,
  PaymentProviderKind,
  PaymentStatus,
  WorkEngagementStatus,
} from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InvoicesService } from '../invoices/invoices.service';
import { MarketplaceService } from '../marketplace/marketplace.service';
import { CreatePaymentDto } from './dto/payment.dto';
import { MockPaymentProvider } from './mock-payment.provider';
import { PAYMENT_PROVIDER } from './payment-provider.interface';
import { PaymentsService } from './payments.service';
import { PAYMENT_REPOSITORY } from './repositories/payment.repository';

/** Lets fire-and-forget promise chains settle. */
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

describe('PaymentsService', () => {
  let service: PaymentsService;

  const payments = {
    create: jest.fn(),
    findById: jest.fn(),
    findByIdempotencyKey: jest.fn(),
    findSucceededForEngagement: jest.fn(),
    findLatestForEngagement: jest.fn(),
    markProcessing: jest.fn(),
    markSucceeded: jest.fn(),
    markFailed: jest.fn(),
  };
  const marketplace = {
    getEngagement: jest.fn(),
    settleEngagementAfterSuccessfulPayment: jest.fn(),
  };
  const invoices = { generateForPayment: jest.fn() };

  const ENGAGEMENT_ID = '11111111-1111-4111-8111-111111111111';

  // Package 1000 + add-on 250 = 1250; the response carries the canonical total.
  const engagement = {
    id: ENGAGEMENT_ID,
    clientId: 'biz-1',
    providerId: 'tal-1',
    status: WorkEngagementStatus.pending_payment,
    detail: {
      packagePrice: '1000',
      currency: 'AED',
      chargeableTotal: '1250.00',
    },
  };

  const dto = (
    overrides: Partial<CreatePaymentDto> = {},
  ): CreatePaymentDto => ({
    engagementId: ENGAGEMENT_ID,
    method: PaymentMethod.card,
    mockMethodToken: 'mock_visa_success',
    idempotencyKey: 'idem-key-0001',
    ...overrides,
  });

  const payment = (overrides: Record<string, unknown> = {}) => ({
    id: 'pay-1',
    engagementId: ENGAGEMENT_ID,
    payerUserId: 'biz-1',
    payeeUserId: 'tal-1',
    amount: '1250.00',
    currency: 'AED',
    method: PaymentMethod.card,
    provider: PaymentProviderKind.mock,
    providerReference: null,
    status: PaymentStatus.pending,
    idempotencyKey: 'idem-key-0001',
    settlementKey: null,
    mockMethodToken: 'mock_visa_success',
    failureCode: null,
    failureMessage: null,
    succeededAt: null,
    failedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    invoice: null,
    ...overrides,
  });

  beforeEach(async () => {
    jest.resetAllMocks();

    // Repository behaves like a tiny state machine over the created record.
    payments.findByIdempotencyKey.mockResolvedValue(null);
    payments.findSucceededForEngagement.mockResolvedValue(null);
    payments.create.mockImplementation((input: Record<string, unknown>) =>
      // The service generates the id; pin it so assertions stay readable.
      Promise.resolve(payment({ ...input, id: 'pay-1' })),
    );
    payments.markProcessing.mockImplementation(
      (_id: string, providerReference: string) =>
        Promise.resolve(
          payment({ status: PaymentStatus.processing, providerReference }),
        ),
    );
    payments.markSucceeded.mockImplementation(
      (input: { providerReference: string }) =>
        Promise.resolve(
          payment({
            status: PaymentStatus.succeeded,
            providerReference: input.providerReference,
            settlementKey: ENGAGEMENT_ID,
            succeededAt: new Date(),
          }),
        ),
    );
    payments.markFailed.mockImplementation(
      (_id: string, failure: { failureCode: string; failureMessage: string }) =>
        Promise.resolve(
          payment({
            status: PaymentStatus.failed,
            failureCode: failure.failureCode,
            failureMessage: failure.failureMessage,
            failedAt: new Date(),
          }),
        ),
    );
    marketplace.getEngagement.mockResolvedValue(engagement);
    marketplace.settleEngagementAfterSuccessfulPayment.mockResolvedValue({});
    invoices.generateForPayment.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PAYMENT_REPOSITORY, useValue: payments },
        { provide: PAYMENT_PROVIDER, useClass: MockPaymentProvider },
        { provide: MarketplaceService, useValue: marketplace },
        { provide: InvoicesService, useValue: invoices },
      ],
    }).compile();
    service = module.get(PaymentsService);
  });

  describe('success', () => {
    it('charges the engagement chargeableTotal, settles the engagement and issues an invoice', async () => {
      const result = await service.createPayment('biz-1', dto());

      expect(result.status).toBe(PaymentStatus.succeeded);
      expect(result.providerReference).toMatch(/^mock_pay_/);
      expect(payments.create).toHaveBeenCalledWith(
        expect.objectContaining({
          engagementId: ENGAGEMENT_ID,
          payerUserId: 'biz-1',
          payeeUserId: 'tal-1',
          // Package + add-ons, in the engagement currency.
          amount: '1250.00',
          currency: 'AED',
          idempotencyKey: 'idem-key-0001',
        }),
      );
      expect(payments.markSucceeded).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'pay-1',
          // settlementKey = engagementId is applied by the repository.
          engagementId: ENGAGEMENT_ID,
        }),
      );
      expect(
        marketplace.settleEngagementAfterSuccessfulPayment,
      ).toHaveBeenCalledWith(ENGAGEMENT_ID, 'biz-1');

      await flush();
      expect(invoices.generateForPayment).toHaveBeenCalledWith('pay-1');
    });

    it('ignores any client-supplied amount or currency', async () => {
      const tampered = {
        ...dto(),
        amount: '1.00',
        currency: 'SAR',
      } as unknown as CreatePaymentDto;

      await service.createPayment('biz-1', tampered);

      expect(payments.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: '1250.00', currency: 'AED' }),
      );
    });

    it('accepts Apple Pay with an apple pay token', async () => {
      const result = await service.createPayment(
        'biz-1',
        dto({
          method: PaymentMethod.apple_pay,
          mockMethodToken: 'mock_apple_pay_success',
        }),
      );

      expect(result.status).toBe(PaymentStatus.succeeded);
    });

    it('still succeeds when invoice generation fails', async () => {
      invoices.generateForPayment.mockRejectedValue(new Error('storage down'));

      const result = await service.createPayment('biz-1', dto());
      await flush();

      expect(result.status).toBe(PaymentStatus.succeeded);
      expect(invoices.generateForPayment).toHaveBeenCalled();
      // The payment is never rolled back because of the invoice.
      expect(payments.markFailed).not.toHaveBeenCalled();
    });

    it('still succeeds when invoice generation throws synchronously', async () => {
      invoices.generateForPayment.mockImplementation(() => {
        throw new Error('boom');
      });

      const result = await service.createPayment('biz-1', dto());
      await flush();

      expect(result.status).toBe(PaymentStatus.succeeded);
    });
  });

  describe('declines', () => {
    it.each([
      [PaymentMethod.card, 'mock_card_declined', 'card_declined'],
      [
        PaymentMethod.apple_pay,
        'mock_apple_pay_declined',
        'apple_pay_declined',
      ],
    ])(
      'fails %s via %s and leaves the engagement pending_payment',
      async (method, token, code) => {
        const result = await service.createPayment(
          'biz-1',
          dto({ method, mockMethodToken: token }),
        );
        await flush();

        expect(result.status).toBe(PaymentStatus.failed);
        expect(result.failureCode).toBe(code);
        expect(result.failureMessage).toBeTruthy();
        expect(payments.markSucceeded).not.toHaveBeenCalled();
        expect(
          marketplace.settleEngagementAfterSuccessfulPayment,
        ).not.toHaveBeenCalled();
        expect(invoices.generateForPayment).not.toHaveBeenCalled();
      },
    );

    it('records a provider outage as a failed payment', async () => {
      const module = service as unknown as {
        provider: { confirmPayment: jest.Mock };
      };
      module.provider.confirmPayment = jest
        .fn()
        .mockRejectedValue(new Error('network'));

      const result = await service.createPayment('biz-1', dto());

      expect(result.status).toBe(PaymentStatus.failed);
      expect(result.failureCode).toBe('provider_error');
      expect(
        marketplace.settleEngagementAfterSuccessfulPayment,
      ).not.toHaveBeenCalled();
    });

    it('marks the loser failed when another payment settled first', async () => {
      payments.markSucceeded.mockRejectedValue(
        new ConflictException(
          'This engagement already has a successful payment',
        ),
      );

      await expect(
        service.createPayment('biz-1', dto()),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(payments.markFailed).toHaveBeenCalledWith(
        'pay-1',
        expect.objectContaining({ failureCode: 'duplicate_settlement' }),
      );
      expect(
        marketplace.settleEngagementAfterSuccessfulPayment,
      ).not.toHaveBeenCalled();
    });
  });

  describe('idempotency', () => {
    it('returns the existing payment for the same key without charging again', async () => {
      payments.findByIdempotencyKey.mockResolvedValue(
        payment({ status: PaymentStatus.failed, failureCode: 'card_declined' }),
      );

      const result = await service.createPayment('biz-1', dto());

      expect(result.id).toBe('pay-1');
      expect(result.status).toBe(PaymentStatus.failed);
      expect(payments.create).not.toHaveBeenCalled();
      expect(payments.markProcessing).not.toHaveBeenCalled();
      expect(marketplace.getEngagement).not.toHaveBeenCalled();
    });

    it('heals a succeeded payment whose engagement never started', async () => {
      payments.findByIdempotencyKey.mockResolvedValue(
        payment({ status: PaymentStatus.succeeded }),
      );

      const result = await service.createPayment('biz-1', dto());
      await flush();

      expect(result.status).toBe(PaymentStatus.succeeded);
      expect(payments.create).not.toHaveBeenCalled();
      expect(
        marketplace.settleEngagementAfterSuccessfulPayment,
      ).toHaveBeenCalledWith(ENGAGEMENT_ID, 'biz-1');
      expect(invoices.generateForPayment).toHaveBeenCalledWith('pay-1');
    });

    it('does not re-settle a succeeded payment that already started work', async () => {
      payments.findByIdempotencyKey.mockResolvedValue(
        payment({
          status: PaymentStatus.succeeded,
          invoice: {
            id: 'inv-1',
            invoiceNumber: 'MWH-2026-000001',
            status: 'generated',
          },
        }),
      );
      marketplace.getEngagement.mockResolvedValue({
        ...engagement,
        status: WorkEngagementStatus.in_progress,
      });

      await service.createPayment('biz-1', dto());
      await flush();

      expect(
        marketplace.settleEngagementAfterSuccessfulPayment,
      ).not.toHaveBeenCalled();
      expect(invoices.generateForPayment).not.toHaveBeenCalled();
    });

    it('rejects a key reused by another user or for another engagement', async () => {
      payments.findByIdempotencyKey.mockResolvedValue(payment());

      await expect(
        service.createPayment('someone-else', dto()),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        service.createPayment(
          'biz-1',
          dto({ engagementId: '22222222-2222-4222-8222-222222222222' }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('treats a unique-key race on create as a replay', async () => {
      payments.findByIdempotencyKey
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(payment({ status: PaymentStatus.processing }));
      payments.create.mockRejectedValue({ code: 'P2002' });

      const result = await service.createPayment('biz-1', dto());

      expect(result.status).toBe(PaymentStatus.processing);
      expect(payments.markProcessing).not.toHaveBeenCalled();
      expect(payments.create).toHaveBeenCalledTimes(1);
    });

    it('returns the settled payment when a same-key race finishes during replay', async () => {
      payments.findByIdempotencyKey
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(payment({ status: PaymentStatus.processing }));
      payments.create.mockRejectedValue({ code: 'P2002' });
      payments.findById.mockResolvedValue(
        payment({
          status: PaymentStatus.succeeded,
          invoice: {
            id: 'inv-1',
            invoiceNumber: 'MWH-2026-000001',
            status: 'generated',
          },
        }),
      );
      marketplace.getEngagement
        .mockResolvedValueOnce(engagement)
        .mockResolvedValueOnce({
          ...engagement,
          status: WorkEngagementStatus.in_progress,
        });

      const result = await service.createPayment('biz-1', dto());

      expect(result.status).toBe(PaymentStatus.succeeded);
      expect(result.id).toBe('pay-1');
      expect(payments.markProcessing).not.toHaveBeenCalled();
      expect(
        marketplace.settleEngagementAfterSuccessfulPayment,
      ).not.toHaveBeenCalled();
    });
  });

  describe('guards', () => {
    it('only lets the client pay', async () => {
      await expect(
        service.createPayment('tal-1', dto()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(payments.create).not.toHaveBeenCalled();
    });

    it('propagates the marketplace party check for strangers', async () => {
      marketplace.getEngagement.mockRejectedValue(new ForbiddenException());

      await expect(
        service.createPayment('stranger', dto()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(payments.create).not.toHaveBeenCalled();
    });

    it('conflicts when the engagement already has a succeeded payment', async () => {
      payments.findSucceededForEngagement.mockResolvedValue(
        payment({ status: PaymentStatus.succeeded }),
      );

      await expect(
        service.createPayment(
          'biz-1',
          dto({ idempotencyKey: 'idem-key-0002' }),
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(payments.create).not.toHaveBeenCalled();
    });

    it('refuses engagements that are not pending_payment', async () => {
      marketplace.getEngagement.mockResolvedValue({
        ...engagement,
        status: WorkEngagementStatus.cancelled,
      });

      await expect(
        service.createPayment('biz-1', dto()),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('refuses a zero chargeable total', async () => {
      marketplace.getEngagement.mockResolvedValue({
        ...engagement,
        detail: { ...engagement.detail, chargeableTotal: '0.00' },
      });

      await expect(
        service.createPayment('biz-1', dto()),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects unknown tokens and token / method mismatches before creating a payment', async () => {
      await expect(
        service.createPayment('biz-1', dto({ mockMethodToken: 'mock_nope' })),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.createPayment(
          'biz-1',
          dto({
            method: PaymentMethod.apple_pay,
            mockMethodToken: 'mock_visa_success',
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(payments.create).not.toHaveBeenCalled();
    });
  });

  describe('reads', () => {
    it('lets payer and payee read a payment, nobody else', async () => {
      payments.findById.mockResolvedValue(payment());

      await expect(service.getPayment('biz-1', 'pay-1')).resolves.toBeDefined();
      await expect(service.getPayment('tal-1', 'pay-1')).resolves.toBeDefined();
      await expect(
        service.getPayment('stranger', 'pay-1'),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('404s for a missing payment', async () => {
      payments.findById.mockResolvedValue(null);

      await expect(service.getPayment('biz-1', 'nope')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('returns the engagement payment for parties and 404s when none exists', async () => {
      payments.findLatestForEngagement.mockResolvedValue(payment());
      await expect(
        service.getPaymentForEngagement('tal-1', ENGAGEMENT_ID),
      ).resolves.toEqual(expect.objectContaining({ id: 'pay-1' }));

      payments.findLatestForEngagement.mockResolvedValue(null);
      await expect(
        service.getPaymentForEngagement('tal-1', ENGAGEMENT_ID),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('never exposes the mock token or idempotency internals beyond the payment view', async () => {
      payments.findById.mockResolvedValue(payment());

      const result = await service.getPayment('biz-1', 'pay-1');

      expect(result).not.toHaveProperty('mockMethodToken');
      expect(result).not.toHaveProperty('settlementKey');
    });
  });
});

describe('CreatePaymentDto', () => {
  const validate_ = (body: Record<string, unknown>) =>
    validate(plainToInstance(CreatePaymentDto, body), {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

  const valid = {
    engagementId: '11111111-1111-4111-8111-111111111111',
    method: 'card',
    mockMethodToken: 'mock_visa_success',
    idempotencyKey: 'idem-key-0001',
  };

  it('accepts the tokenised payload', async () => {
    expect(await validate_(valid)).toHaveLength(0);
  });

  it.each(['pan', 'cardNumber', 'cvv', 'cvc', 'expiry', 'amount', 'currency'])(
    'rejects a %s field',
    async (field) => {
      const errors = await validate_({ ...valid, [field]: '4242424242424242' });
      expect(errors.length).toBeGreaterThan(0);
    },
  );

  it('rejects a card number smuggled in as the token', async () => {
    const errors = await validate_({
      ...valid,
      mockMethodToken: '4242 4242 4242 4242',
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});
