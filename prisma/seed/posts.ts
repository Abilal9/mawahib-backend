import {
  ConnectionRequestStatus,
  MediaPurpose,
  PostVisibility,
  PrismaClient,
} from '@prisma/client';
import { seedId } from './ids';
import { uploadReadyAsset } from './media';

/**
 * Hybrid feed seed:
 * A (talent) ↔ B (business) connected
 * C (talent2), D (business2) not connected to A
 */
export async function seedPostsAndConnections(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  prisma: PrismaClient,
  ids: {
    talent: string;
    business: string;
    talent2: string;
    business2: string;
  },
) {
  const { talent: A, business: B, talent2: C, business2: D } = ids;

  // Clear prior seed posts for these users
  await prisma.postComment.deleteMany({
    where: { authorId: { in: [A, B, C, D] } },
  });
  await prisma.postLike.deleteMany({
    where: { userId: { in: [A, B, C, D] } },
  });
  await prisma.postSave.deleteMany({
    where: { userId: { in: [A, B, C, D] } },
  });
  await prisma.postMedia.deleteMany({
    where: { post: { authorId: { in: [A, B, C, D] } } },
  });
  await prisma.post.deleteMany({
    where: { authorId: { in: [A, B, C, D] } },
  });

  // A ↔ B accepted connection
  const [low, high] = A < B ? [A, B] : [B, A];
  await prisma.connectionRequest.deleteMany({
    where: {
      OR: [
        { fromUserId: A, toUserId: B },
        { fromUserId: B, toUserId: A },
      ],
    },
  });
  await prisma.connection.deleteMany({
    where: { userLowId: low, userHighId: high },
  });
  await prisma.connection.create({
    data: {
      id: seedId('connection:a-b'),
      userLowId: low,
      userHighId: high,
    },
  });
  await prisma.connectionRequest.create({
    data: {
      id: seedId('connection-request:a-b'),
      fromUserId: A,
      toUserId: B,
      status: ConnectionRequestStatus.accepted,
      message: 'Seed accepted',
    },
  });

  const imageA1 = await uploadReadyAsset(
    supabase,
    prisma,
    A,
    'posts',
    MediaPurpose.post,
    'post-a-1',
    'https://images.unsplash.com/photo-1561070791-2526d30994b5?w=800&h=600&fit=crop',
  );
  const imageA2 = await uploadReadyAsset(
    supabase,
    prisma,
    A,
    'posts',
    MediaPurpose.post,
    'post-a-2',
    'https://images.unsplash.com/photo-1558655146-d09347e92766?w=800&h=600&fit=crop',
  );
  const imageB = await uploadReadyAsset(
    supabase,
    prisma,
    B,
    'posts',
    MediaPurpose.post,
    'post-b-1',
    'https://images.unsplash.com/photo-1497366216548-37526070297c?w=800&h=600&fit=crop',
  );
  const imageC = await uploadReadyAsset(
    supabase,
    prisma,
    C,
    'posts',
    MediaPurpose.post,
    'post-c-1',
    'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=800&h=600&fit=crop',
  );

  const t0 = Date.now();
  const mkDate = (offsetMs: number) => new Date(t0 - offsetMs);

  // A: multi-image self post
  const postA = await prisma.post.create({
    data: {
      id: seedId('post:a-multi'),
      authorId: A,
      text: 'Shipping a bilingual brand system for a Riyadh fintech this week.',
      visibility: PostVisibility.public,
      createdAt: mkDate(1000),
      media: {
        create: [
          { mediaAssetId: imageA1.asset.id, position: 0 },
          { mediaAssetId: imageA2.asset.id, position: 1 },
        ],
      },
    },
  });

  // A: text-only
  const postAText = await prisma.post.create({
    data: {
      id: seedId('post:a-text'),
      authorId: A,
      text: 'Looking for a motion designer for a short campaign loop — DM if you are free next week.',
      visibility: PostVisibility.public,
      createdAt: mkDate(5000),
    },
  });

  // B: connection post (image)
  const postB = await prisma.post.create({
    data: {
      id: seedId('post:b-image'),
      authorId: B,
      text: 'Najd Studio is opening two freelance seats for campaign art direction in Dubai.',
      visibility: PostVisibility.public,
      createdAt: mkDate(2000),
      media: {
        create: [{ mediaAssetId: imageB.asset.id, position: 0 }],
      },
    },
  });

  // C: discovery
  const postC = await prisma.post.create({
    data: {
      id: seedId('post:c-discovery'),
      authorId: C,
      text: 'New illustration pack for hospitality menus — available for commissions.',
      visibility: PostVisibility.public,
      createdAt: mkDate(3000),
      media: {
        create: [{ mediaAssetId: imageC.asset.id, position: 0 }],
      },
    },
  });

  // D: discovery text
  const postD = await prisma.post.create({
    data: {
      id: seedId('post:d-discovery'),
      authorId: D,
      text: 'Hiring a product designer for a 6-week sprint on our AE marketplace rebuild.',
      visibility: PostVisibility.public,
      createdAt: mkDate(4000),
    },
  });

  // Engagements: B likes A's post; A comments on B; A saves C
  await prisma.postLike.create({
    data: { postId: postA.id, userId: B },
  });
  await prisma.postLike.create({
    data: { postId: postC.id, userId: A },
  });
  await prisma.postComment.create({
    data: {
      id: seedId('post-comment:a-on-b'),
      postId: postB.id,
      authorId: A,
      text: 'Happy to refer a strong art director — sending details.',
    },
  });
  await prisma.postSave.create({
    data: { postId: postC.id, userId: A },
  });

  // Sync postsCount to real totals
  for (const userId of [A, B, C, D]) {
    const count = await prisma.post.count({
      where: { authorId: userId, deletedAt: null },
    });
    await prisma.user.update({
      where: { id: userId },
      data: { postsCount: count },
    });
  }

  return {
    posts: [postA.id, postAText.id, postB.id, postC.id, postD.id],
  };
}
