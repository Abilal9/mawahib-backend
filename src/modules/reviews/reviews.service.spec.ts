import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { MediaPurpose, Prisma, WorkEngagementStatus } from '@prisma/client';
import { CreateEngagementReviewDto } from '../marketplace/dto/marketplace.dto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { MediaService } from '../media/media.service';
import {
  clientReceivedSql,
  providerRatingLateral,
  providerReceivedSql,
  publishedReviewSql,
  serviceRatingLateral,
  serviceReviewSql,
} from './review-sql';
import { ReviewsService } from './reviews.service';

const CLIENT = '11111111-1111-4111-8111-111111111111';
const PROVIDER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const ENGAGEMENT = '44444444-4444-4444-8444-444444444444';
const SERVICE = '55555555-5555-4555-8555-555555555555';
const completedAt = new Date('2026-10-01T00:00:00.000Z');
const closesAt = new Date('2026-10-15T00:00:00.000Z');
const asOf = new Date('2026-10-02T00:00:00.000Z');

function flatten(sql: Prisma.Sql): string {
  let text = '';
  sql.strings.forEach((part, index) => {
    text += part;
    const value = sql.values[index];
    if (
      value &&
      typeof value === 'object' &&
      'strings' in value &&
      'values' in value
    ) {
      text += flatten(value as Prisma.Sql);
    } else if (value instanceof Date) text += value.toISOString();
    else if (value !== undefined) text += String(value);
  });
  return text.replace(/\s+/g, ' ');
}

function taggedText(call: unknown[]): string {
  const [strings, ...values] = call;
  return flatten({
    strings: strings as TemplateStringsArray,
    values,
  } as Prisma.Sql);
}

describe('ReviewsService', () => {
  const engagementFind = jest.fn();
  const engagementOpen = jest.fn();
  const reviewCreate = jest.fn();
  const reviewGet = jest.fn();
  const reviewFind = jest.fn();
  const reviewFindMany = jest.fn();
  const userFind = jest.fn();
  const userUpdate = jest.fn();
  const serviceFind = jest.fn();
  const queryRaw = jest.fn();
  const requireAssets = jest.fn();
  const tx = {
    workEngagement: { findFirst: engagementOpen },
    engagementReview: { create: reviewCreate },
  };
  const prisma = {
    workEngagement: { findUnique: engagementFind },
    engagementReview: {
      create: reviewCreate,
      findUnique: reviewFind,
      findUniqueOrThrow: reviewGet,
      findFirst: reviewFind,
      findMany: reviewFindMany,
    },
    user: { findFirst: userFind, update: userUpdate },
    serviceOffering: { findFirst: serviceFind },
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) =>
      fn(tx),
    ),
    $queryRaw: queryRaw,
  };
  const media = { requireReadyOwnedAssets: requireAssets };
  const service = new ReviewsService(
    prisma as unknown as PrismaService,
    media as unknown as MediaService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    engagementOpen.mockResolvedValue({ id: ENGAGEMENT });
    reviewCreate.mockResolvedValue({ id: 'rev-new' });
    reviewGet.mockResolvedValue(stored());
    reviewFind.mockResolvedValue(null);
    queryRaw.mockResolvedValue([]);
    requireAssets.mockResolvedValue([{ purpose: MediaPurpose.review }]);
  });

  function stored(partial: Record<string, unknown> = {}) {
    return {
      id: 'rev-new',
      engagementId: ENGAGEMENT,
      reviewerId: CLIENT,
      revieweeId: PROVIDER,
      rating: 5,
      body: 'Great',
      createdAt: asOf,
      media: [],
      ...partial,
    };
  }

  function engagement(partial: Record<string, unknown> = {}) {
    return {
      id: ENGAGEMENT,
      clientId: CLIENT,
      providerId: PROVIDER,
      status: WorkEngagementStatus.completed,
      deletedAt: null,
      completedAt,
      reviewWindowClosesAt: closesAt,
      reviews: [],
      ...partial,
    };
  }

  async function submit(
    partial: Partial<{
      reviewerId: string;
      rating: number;
      body: string;
      mediaAssetIds: string[];
      asOf: Date;
    }> = {},
  ) {
    return service.submit({
      reviewerId: CLIENT,
      engagementId: ENGAGEMENT,
      rating: 5,
      body: 'Great',
      asOf,
      ...partial,
    });
  }

  it('lets the client review the provider and does not touch a stored average', async () => {
    engagementFind.mockResolvedValue(engagement());
    const result = await submit();
    expect(result.review.reviewerId).toBe(CLIENT);
    expect(result.counterpart).toBeNull();
    expect(reviewCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reviewerId: CLIENT,
          revieweeId: PROVIDER,
          rating: 5,
          body: 'Great',
        }),
      }),
    );
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('lets the provider review the client', async () => {
    engagementFind.mockResolvedValue(engagement());
    reviewGet.mockResolvedValue(stored({ reviewerId: PROVIDER, revieweeId: CLIENT }));
    await submit({ reviewerId: PROVIDER, rating: 1, body: '' });
    expect(reviewCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          reviewerId: PROVIDER,
          revieweeId: CLIENT,
          rating: 1,
          body: '',
        }),
      }),
    );
  });

  it.each([
    WorkEngagementStatus.requested,
    WorkEngagementStatus.accepted,
    WorkEngagementStatus.in_progress,
    WorkEngagementStatus.delivered,
    WorkEngagementStatus.disputed,
    WorkEngagementStatus.cancelled,
  ])('rejects %s', async (status) => {
    engagementFind.mockResolvedValue(engagement({ status }));
    await expect(submit()).rejects.toBeInstanceOf(BadRequestException);
    expect(reviewCreate).not.toHaveBeenCalled();
  });

  it('hides missing, foreign, and soft-deleted engagements', async () => {
    engagementFind.mockResolvedValue(null);
    await expect(submit()).rejects.toBeInstanceOf(NotFoundException);
    engagementFind.mockResolvedValue(engagement());
    await expect(submit({ reviewerId: OTHER })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    engagementFind.mockResolvedValue(
      engagement({ deletedAt: new Date('2026-10-03T00:00:00.000Z') }),
    );
    await expect(submit()).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a self-review', async () => {
    engagementFind.mockResolvedValue(
      engagement({ clientId: CLIENT, providerId: CLIENT }),
    );
    await expect(submit()).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects an expired window and accepts the same review replay', async () => {
    engagementFind.mockResolvedValue(engagement());
    await expect(
      submit({ asOf: closesAt }),
    ).rejects.toBeInstanceOf(BadRequestException);

    engagementFind.mockResolvedValue(
      engagement({
        reviews: [
          {
            id: 'rev-old',
            reviewerId: CLIENT,
            rating: 5,
            body: 'Great',
            media: [],
          },
        ],
      }),
    );
    reviewGet.mockResolvedValue(stored({ id: 'rev-old' }));
    const replay = await submit({ asOf: new Date(closesAt.getTime() + 1000) });
    expect(replay.review.id).toBe('rev-old');
    expect(reviewCreate).not.toHaveBeenCalled();
  });

  it.each([0, 6, 1.5])('rejects rating %s', async (rating) => {
    await expect(submit({ rating })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(engagementFind).not.toHaveBeenCalled();
  });

  it('normalizes a blank body and rejects text over 2000 characters', async () => {
    engagementFind.mockResolvedValue(engagement());
    await submit({ body: '   ' });
    expect(reviewCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ body: '' }),
      }),
    );
    await expect(submit({ body: 'a'.repeat(2001) })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('returns the same review for an identical retry and conflicts when content changes', async () => {
    const existing = {
      id: 'rev-old',
      reviewerId: CLIENT,
      rating: 5,
      body: 'Great',
      media: [{ mediaAssetId: 'asset-b' }, { mediaAssetId: 'asset-a' }],
    };
    engagementFind.mockResolvedValue(engagement({ reviews: [existing] }));
    reviewGet.mockResolvedValue(stored({ id: 'rev-old' }));
    const same = await submit({
      body: '  Great  ',
      mediaAssetIds: ['asset-a', 'asset-b'],
    });
    expect(same.review.id).toBe('rev-old');
    expect(reviewCreate).not.toHaveBeenCalled();

    await expect(submit({ rating: 4 })).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(submit({ body: 'Different' })).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(
      submit({ mediaAssetIds: ['asset-a'] }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('applies the same duplicate rule after a unique-constraint race', async () => {
    engagementFind.mockResolvedValue(engagement());
    reviewCreate.mockRejectedValue({ code: 'P2002' });
    reviewFind.mockResolvedValue({
      id: 'rev-raced',
      rating: 5,
      body: 'Great',
      media: [],
    });
    reviewGet.mockResolvedValue(stored({ id: 'rev-raced' }));
    const same = await submit();
    expect(same.review.id).toBe('rev-raced');

    reviewFind.mockResolvedValue({
      id: 'rev-raced',
      rating: 2,
      body: 'Other',
      media: [],
    });
    await expect(submit()).rejects.toBeInstanceOf(ConflictException);
  });

  it('keeps a pending review out of profile and service aggregates', async () => {
    userFind.mockResolvedValue({ id: PROVIDER });
    serviceFind.mockResolvedValue({ id: SERVICE });
    await service.listReceived({
      userId: PROVIDER,
      role: 'provider',
      asOf,
    });
    await service.listForService({ serviceId: SERVICE, asOf });
    await service.summarizeUsers([PROVIDER], asOf);
    await service.summarizeServices([SERVICE], asOf);
    const sql = queryRaw.mock.calls.map((call) => taggedText(call)).join('\n');
    expect(sql).toContain('review_window_closes_at IS NOT NULL');
    expect(sql).toContain('counterpart.reviewer_id');
    expect(sql).toContain(asOf.toISOString());
    expect(sql).toContain('r.reviewer_id = e.client_id');
    expect(sql).toContain('e.service_offering_id IS NOT NULL');
    expect(sql).not.toContain('rating_avg');
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it('splits provider and client averages and leaves the other role empty', async () => {
    queryRaw.mockResolvedValueOnce([
      {
        user_id: PROVIDER,
        role: 'provider',
        review_count: 2,
        average: 4.5,
      },
    ]);
    const summaries = await service.summarizeUsers([PROVIDER, CLIENT], asOf);
    expect(summaries.get(PROVIDER)).toEqual({
      asProvider: { average: 4.5, count: 2 },
      asClient: { average: null, count: 0 },
    });
    expect(summaries.get(CLIENT)).toEqual({
      asProvider: { average: null, count: 0 },
      asClient: { average: null, count: 0 },
    });
    const providerSql = taggedText(queryRaw.mock.calls[0]);
    expect(providerSql).toContain('e.provider_id = r.reviewee_id');
  });

  it('counts only published client-to-provider reviews for a service', async () => {
    queryRaw.mockResolvedValueOnce([
      { service_id: SERVICE, review_count: 1, average: 5 },
    ]);
    const summaries = await service.summarizeServices([SERVICE], asOf);
    expect(summaries.get(SERVICE)).toEqual({ average: 5, count: 1 });
    const sql = taggedText(queryRaw.mock.calls[0]);
    expect(sql).toContain('r.reviewer_id = e.client_id');
    expect(sql).toContain('r.reviewee_id = e.provider_id');
    expect(sql).not.toContain('rating_avg');
  });
});

describe('review publication SQL', () => {
  const at = new Date('2026-10-20T00:00:00.000Z');

  it('ranks talent by the provider aggregate and services by client reviews', () => {
    const talent = flatten(providerRatingLateral(at));
    const service = flatten(serviceRatingLateral(at));
    expect(talent).toContain('r.reviewee_id = u.id');
    expect(talent).toContain(flatten(providerReceivedSql()));
    expect(talent).toContain(at.toISOString());
    expect(service).toContain('e.service_offering_id = so.id');
    expect(service).toContain(flatten(serviceReviewSql()));
    expect(flatten(publishedReviewSql(at))).toContain(at.toISOString());
    expect(flatten(clientReceivedSql())).toContain(
      'e.client_id = r.reviewee_id',
    );
  });
});

describe('CreateEngagementReviewDto', () => {
  const validateRating = (rating: unknown) =>
    validate(
      plainToInstance(CreateEngagementReviewDto, { rating, body: 'ok' }),
    );

  it('accepts 1 and 5 and an omitted body', async () => {
    expect(await validateRating(1)).toHaveLength(0);
    expect(await validateRating(5)).toHaveLength(0);
    expect(
      await validate(plainToInstance(CreateEngagementReviewDto, { rating: 3 })),
    ).toHaveLength(0);
  });

  it.each([0, 6, 1.5, 'five'])('rejects %s', async (rating) => {
    expect(await validateRating(rating)).not.toHaveLength(0);
  });

  it('rejects a body over 2000 characters and reviewer fields', async () => {
    const long = await validate(
      plainToInstance(CreateEngagementReviewDto, {
        rating: 5,
        body: 'a'.repeat(2001),
      }),
    );
    expect(long.length).toBeGreaterThan(0);
    const injected = await validate(
      plainToInstance(CreateEngagementReviewDto, {
        rating: 5,
        reviewerId: CLIENT,
        revieweeId: PROVIDER,
      }),
      { whitelist: true, forbidNonWhitelisted: true },
    );
    expect(injected.length).toBeGreaterThan(0);
  });
});
