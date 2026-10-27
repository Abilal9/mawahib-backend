import { ConversationType, WorkEngagementStatus } from '@prisma/client';
import { ConversationResponseDto } from '../messaging/dto/messaging-response.dto';
import type { ConversationWithRelations } from '../messaging/repositories/messaging.repository';
import { WorkEngagementResponseDto } from '../marketplace/dto/marketplace-response.dto';
import type { WorkEngagementWithRelations } from '../marketplace/repositories/marketplace.repository';
import { buildReviewState, isReviewPublic } from './review-state';

const clientId = 'client';
const providerId = 'provider';
const createdAt = new Date('2026-10-07T12:00:00.000Z');
const completedAt = new Date('2026-10-01T00:00:00.000Z');
const closesAt = new Date('2026-10-15T00:00:00.000Z');
const open = new Date('2026-10-02T00:00:00.000Z');

function row(
  reviewerId: string,
  id: string,
  extra?: { body?: string; rating?: number },
) {
  return {
    id,
    reviewerId,
    rating: extra?.rating ?? 4,
    body: extra?.body ?? 'Hidden text',
    createdAt,
    media: [
      {
        id: `${id}-media`,
        mediaAssetId: `${id}-asset`,
        mediaAsset: { mimeType: 'image/jpeg' },
      },
    ],
  };
}

function state(input: {
  viewerId: string;
  reviews: ReturnType<typeof row>[];
  asOf?: Date;
  status?: string;
  deletedAt?: Date | null;
  completedAt?: Date | null;
  reviewWindowClosesAt?: Date | null;
}) {
  return buildReviewState({
    status: input.status ?? 'completed',
    deletedAt: input.deletedAt ?? null,
    viewerId: input.viewerId,
    clientId,
    providerId,
    completedAt:
      input.completedAt === undefined ? completedAt : input.completedAt,
    reviewWindowClosesAt:
      input.reviewWindowClosesAt === undefined
        ? closesAt
        : input.reviewWindowClosesAt,
    asOf: input.asOf ?? open,
    reviews: input.reviews,
  });
}

describe('double-blind review state', () => {
  it('lets a completed party submit and hides an absent counterpart', () => {
    const result = state({ viewerId: clientId, reviews: [] });
    expect(result.eligible).toBe(true);
    expect(result.canSubmit).toBe(true);
    expect(result.myReview).toBeNull();
    expect(result.counterpartReview).toBeUndefined();
    expect(result.published).toBe(false);
    expect(result.windowClosesAt).toBe(closesAt.toISOString());
    expect(result).not.toHaveProperty('otherPartyReview');
  });

  it.each(['requested', 'accepted', 'in_progress', 'delivered', 'disputed', 'cancelled'])(
    'blocks %s',
    (status) => {
      const result = state({ viewerId: clientId, reviews: [], status });
      expect(result.canSubmit).toBe(false);
      expect(result.eligible).toBe(false);
    },
  );

  it('shows the author their own pending review and nothing about the other party', () => {
    const result = state({
      viewerId: clientId,
      reviews: [row(clientId, 'mine', { body: 'Mine', rating: 2 })],
    });
    expect(result.canSubmit).toBe(false);
    expect(result.published).toBe(false);
    expect(result.myReview).toEqual({
      id: 'mine',
      rating: 2,
      body: 'Mine',
      createdAt: createdAt.toISOString(),
      media: [
        {
          id: 'mine-media',
          mediaAssetId: 'mine-asset',
          mimeType: 'image/jpeg',
        },
      ],
    });
    expect(result.counterpartReview).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('theirs');
  });

  it('does not tell the other party that a review exists', () => {
    const result = state({
      viewerId: providerId,
      reviews: [row(clientId, 'mine', { body: 'Secret', rating: 2 })],
    });
    const encoded = JSON.stringify(result);
    expect(result.canSubmit).toBe(true);
    expect(result.myReview).toBeNull();
    expect(result.counterpartReview).toBeUndefined();
    expect(result.published).toBe(false);
    expect(encoded).not.toContain('Secret');
    expect(encoded).not.toContain('mine');
    expect(encoded).not.toContain('image/jpeg');
    expect(result).not.toHaveProperty('counterpartSubmitted');
    expect(result).not.toHaveProperty('hasOtherReview');
  });

  it('publishes both reviews as soon as the second exists', () => {
    const reviews = [
      row(clientId, 'mine', { rating: 2, body: 'Client' }),
      row(providerId, 'theirs', { rating: 5, body: 'Provider' }),
    ];
    const asClient = state({ viewerId: clientId, reviews });
    const asProvider = state({ viewerId: providerId, reviews });
    expect(asClient.published).toBe(true);
    expect(asClient.counterpartReview?.id).toBe('theirs');
    expect(asClient.counterpartReview?.rating).toBe(5);
    expect(asProvider.counterpartReview?.id).toBe('mine');
    expect(asProvider.myReview?.rating).toBe(5);
  });

  it('keeps a one-sided review private before the deadline and public at the deadline', () => {
    const reviews = [row(clientId, 'mine')];
    const before = state({ viewerId: providerId, reviews, asOf: closesAt });
    const justBefore = state({
      viewerId: providerId,
      reviews,
      asOf: new Date(closesAt.getTime() - 1),
    });
    expect(justBefore.published).toBe(false);
    expect(justBefore.counterpartReview).toBeUndefined();
    expect(justBefore.canSubmit).toBe(true);
    expect(before.published).toBe(true);
    expect(before.canSubmit).toBe(false);
    expect(before.counterpartReview?.id).toBe('mine');
    const authorAfter = state({
      viewerId: clientId,
      reviews,
      asOf: new Date(closesAt.getTime() + 1000),
    });
    expect(authorAfter.published).toBe(true);
    expect(authorAfter.canSubmit).toBe(false);
    expect(authorAfter.myReview?.id).toBe('mine');
  });

  it('returns an empty state to a non-party', () => {
    const result = state({
      viewerId: 'stranger',
      reviews: [row(clientId, 'mine'), row(providerId, 'theirs')],
    });
    expect(result).toEqual({
      eligible: false,
      canSubmit: false,
      windowClosesAt: null,
      published: false,
      myReview: null,
    });
  });

  it('publication requires a live engagement and a stored deadline', () => {
    expect(
      isReviewPublic({
        asOf: closesAt,
        reviewWindowClosesAt: closesAt,
        deletedAt: new Date(),
        counterpartExists: true,
      }),
    ).toBe(false);
    expect(
      isReviewPublic({
        asOf: open,
        reviewWindowClosesAt: null,
        deletedAt: null,
        counterpartExists: true,
      }),
    ).toBe(false);
  });
});

describe('review payloads omit a private counterpart', () => {
  const asOf = open;

  it('engagement DTO', () => {
    const dto = WorkEngagementResponseDto.fromEntity(
      {
        id: 'eng',
        listingId: null,
        applicationId: null,
        serviceOfferingId: null,
        clientId,
        providerId,
        title: 'Private direct title',
        status: WorkEngagementStatus.completed,
        source: 'direct',
        dueAt: null,
        completedAt,
        reviewWindowClosesAt: closesAt,
        deletedAt: null,
        createdAt,
        updatedAt: createdAt,
        client: party(clientId),
        provider: party(providerId),
        reviews: [row(clientId, 'mine', { body: 'Secret', rating: 2 })],
        detail: null,
        events: [],
      } as unknown as WorkEngagementWithRelations,
      providerId,
      asOf,
    );
    const encoded = JSON.stringify(dto.reviewState);
    expect(encoded).not.toContain('Secret');
    expect(dto.reviewState?.counterpartReview).toBeUndefined();
    expect(dto.reviewState).not.toHaveProperty('otherPartyReview');
    expect(dto.reviewState?.canSubmit).toBe(true);
  });

  it('messaging work context', () => {
    const dto = ConversationResponseDto.fromEntity(
      {
        id: 'convo',
        type: ConversationType.work,
        connectionId: null,
        workEngagementId: 'eng',
        archivedAt: null,
        createdAt,
        updatedAt: createdAt,
        lastMessageAt: null,
        lastMessagePreview: null,
        participants: [
          {
            conversationId: 'convo',
            userId: providerId,
            lastReadAt: null,
            archivedAt: null,
            deletedAt: null,
            user: party(providerId),
          },
        ],
        connection: null,
        workEngagement: {
          id: 'eng',
          clientId,
          providerId,
          title: 'Job',
          status: WorkEngagementStatus.completed,
          source: 'direct',
          dueAt: null,
          completedAt,
          reviewWindowClosesAt: closesAt,
          deletedAt: null,
          detail: null,
          workRequest: null,
          reviews: [row(clientId, 'mine', { body: 'Secret', rating: 2 })],
        },
      } as unknown as ConversationWithRelations,
      providerId,
      true,
      asOf,
    );
    const encoded = JSON.stringify(dto.workContext);
    expect(encoded).not.toContain('Secret');
    expect(dto.workContext?.counterpartReview).toBeUndefined();
    expect(dto.workContext?.viewerReviewRating).toBeNull();
    expect(dto.workContext?.canSubmit).toBe(true);
    expect(dto.workContext?.published).toBe(false);
    expect(dto.workContext).not.toHaveProperty('otherPartyReview');
    expect(dto.workContext).not.toHaveProperty('canReview');
  });
});

function party(id: string) {
  return {
    id,
    displayName: id,
    username: id,
    isVerified: false,
    profile: { avatarUrl: null, title: null },
  };
}
