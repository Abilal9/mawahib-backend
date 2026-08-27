import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { MediaPurpose, MediaStatus, NotificationType, PostVisibility } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { MediaService } from '../media/media.service';
import { NotificationsService } from '../notifications/notifications.service';
import { encodeFeedCursor } from './feed-cursor';
import { PostsService } from './posts.service';
import { POSTS_REPOSITORY } from './repositories/posts.repository';

function author(id: string, name = 'User') {
  return {
    id,
    email: `${id}@ex.com`,
    accountType: 'talent' as const,
    displayName: name,
    username: `u_${id.slice(0, 8)}`,
    isVerified: false,
    followersCount: 0,
    followingCount: 0,
    postsCount: 0,
    ratingAvg: 0,
    ratingCount: 0,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    profile: {
      userId: id,
      bio: '',
      title: 'Designer',
      countryCode: 'SA',
      locationCode: 'riyadh',
      locationCity: 'Riyadh',
      locationCountry: 'Saudi Arabia',
      avatarUrl: null,
      coverUrl: null,
      phoneE164: null,
      phoneVerified: false,
      emailVerified: true,
      aboutJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  };
}

function post(opts: {
  id: string;
  authorId: string;
  text?: string;
  visibility?: PostVisibility;
  createdAt?: Date;
}) {
  const createdAt = opts.createdAt ?? new Date();
  return {
    id: opts.id,
    authorId: opts.authorId,
    text: opts.text ?? 'hello',
    visibility: opts.visibility ?? PostVisibility.public,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null,
    author: author(opts.authorId),
    media: [],
  };
}

describe('PostsService', () => {
  let service: PostsService;
  const posts = {
    create: jest.fn(),
    findById: jest.fn(),
    softDelete: jest.fn(),
    listPool: jest.fn(),
    listByAuthor: jest.fn(),
    countLikes: jest.fn(),
    countComments: jest.fn(),
    findLike: jest.fn(),
    createLike: jest.fn(),
    deleteLike: jest.fn(),
    findSave: jest.fn(),
    createSave: jest.fn(),
    deleteSave: jest.fn(),
    listLikesForPosts: jest.fn(),
    listSavesForPosts: jest.fn(),
    countLikesForPosts: jest.fn(),
    countCommentsForPosts: jest.fn(),
    listComments: jest.fn(),
    listLikes: jest.fn(),
    createComment: jest.fn(),
    findCommentById: jest.fn(),
    softDeleteComment: jest.fn(),
    findUserAuthor: jest.fn(),
    findMediaAssetsReadyOwned: jest.fn(),
    incrementPostsCount: jest.fn(),
    listActiveConnectionPeerIds: jest.fn(),
    listPendingRequestsForViewer: jest.fn(),
  };
  const mediaService = {
    resolveUrlForAsset: jest.fn().mockResolvedValue('https://cdn.example/x.jpg'),
  };
  const notifications = {
    createNotification: jest.fn().mockResolvedValue({ id: 'n1' }),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    posts.listLikesForPosts.mockResolvedValue([]);
    posts.listSavesForPosts.mockResolvedValue([]);
    posts.countLikesForPosts.mockResolvedValue([]);
    posts.countCommentsForPosts.mockResolvedValue([]);
    posts.listPendingRequestsForViewer.mockResolvedValue([]);
    posts.listActiveConnectionPeerIds.mockResolvedValue([]);
    posts.countLikes.mockResolvedValue(0);
    posts.countComments.mockResolvedValue(0);
    posts.findLike.mockResolvedValue(null);
    posts.findSave.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PostsService,
        { provide: POSTS_REPOSITORY, useValue: posts },
        { provide: MediaService, useValue: mediaService },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(PostsService);
  });

  describe('create', () => {
    it('creates text-only post as self', async () => {
      const created = post({ id: 'p1', authorId: 'u1', text: 'Hi' });
      posts.create.mockResolvedValue(created);
      const dto = await service.create('u1', { text: 'Hi' });
      expect(dto.feedSource).toBe('self');
      expect(dto.text).toBe('Hi');
      expect(dto.author).not.toHaveProperty('email');
      expect(posts.incrementPostsCount).toHaveBeenCalledWith('u1', 1);
    });

    it('rejects empty post', async () => {
      await expect(service.create('u1', {})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects media not owned', async () => {
      posts.findMediaAssetsReadyOwned.mockResolvedValue([]);
      await expect(
        service.create('u1', { mediaAssetIds: [randomUuid()] }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('delete', () => {
    it('allows author soft-delete', async () => {
      posts.findById.mockResolvedValue(post({ id: 'p1', authorId: 'u1' }));
      posts.softDelete.mockResolvedValue({});
      await service.softDelete('u1', 'p1');
      expect(posts.softDelete).toHaveBeenCalled();
    });

    it('forbids deleting another user post', async () => {
      posts.findById.mockResolvedValue(post({ id: 'p1', authorId: 'u1' }));
      await expect(service.softDelete('u2', 'p1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('feed classification', () => {
    it('classifies self, connection, discovery', async () => {
      const now = Date.now();
      const selfP = post({
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        authorId: 'viewer',
        createdAt: new Date(now),
      });
      const connP = post({
        id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        authorId: 'peer',
        createdAt: new Date(now - 1000),
      });
      const discP = post({
        id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        authorId: 'stranger',
        createdAt: new Date(now - 2000),
      });
      posts.listActiveConnectionPeerIds.mockResolvedValue(['peer']);
      posts.listPool
        .mockResolvedValueOnce([selfP, connP])
        .mockResolvedValueOnce([discP]);

      const page = await service.listFeed('viewer', undefined, 20);
      const byId = Object.fromEntries(page.items.map((i) => [i.id, i]));
      expect(byId[selfP.id].feedSource).toBe('self');
      expect(byId[connP.id].feedSource).toBe('connection');
      expect(byId[discP.id].feedSource).toBe('discovery');
      expect(byId[discP.id].relationship.status).toBe('none');
      expect(JSON.stringify(page)).not.toMatch(/email|phoneE164/);
    });

    it('keeps discovery while outgoing pending', async () => {
      const discP = post({
        id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        authorId: 'stranger',
      });
      posts.listPool.mockResolvedValueOnce([]).mockResolvedValueOnce([discP]);
      posts.listPendingRequestsForViewer.mockResolvedValue([
        {
          id: 'req1',
          fromUserId: 'viewer',
          toUserId: 'stranger',
        },
      ]);
      const page = await service.listFeed('viewer', undefined, 10);
      expect(page.items[0].feedSource).toBe('discovery');
      expect(page.items[0].relationship.status).toBe('outgoing');
      expect(page.items[0].relationship.connectionRequestId).toBe('req1');
    });

    it('exposes incoming request id for Accept', async () => {
      const discP = post({
        id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        authorId: 'stranger',
      });
      posts.listPool.mockResolvedValueOnce([]).mockResolvedValueOnce([discP]);
      posts.listPendingRequestsForViewer.mockResolvedValue([
        {
          id: 'req2',
          fromUserId: 'stranger',
          toUserId: 'viewer',
        },
      ]);
      const page = await service.listFeed('viewer', undefined, 10);
      expect(page.items[0].relationship.status).toBe('incoming');
      expect(page.items[0].relationship.connectionRequestId).toBe('req2');
    });

    it('fills 100% discovery when social empty', async () => {
      const rows = Array.from({ length: 5 }, (_, i) =>
        post({
          id: `00000000-0000-0000-0000-00000000000${i}`,
          authorId: `stranger${i}`,
          createdAt: new Date(Date.now() - i * 1000),
        }),
      );
      posts.listPool.mockResolvedValueOnce([]).mockResolvedValueOnce(rows);
      const page = await service.listFeed('viewer', undefined, 5);
      expect(page.items).toHaveLength(5);
      expect(page.items.every((i) => i.feedSource === 'discovery')).toBe(true);
    });

    it('paginates without duplicates across pages', async () => {
      const social = Array.from({ length: 10 }, (_, i) =>
        post({
          id: `aaaaaaaa-aaaa-aaaa-aaaa-${String(i).padStart(12, '0')}`,
          authorId: 'viewer',
          createdAt: new Date(Date.now() - i * 1000),
        }),
      );
      posts.listPool
        .mockResolvedValueOnce(social.slice(0, 8))
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(social.slice(4))
        .mockResolvedValueOnce([]);

      const page1 = await service.listFeed('viewer', undefined, 4);
      expect(page1.hasMore).toBe(true);
      const page2 = await service.listFeed(
        'viewer',
        page1.nextCursor ?? undefined,
        4,
      );
      const ids = [...page1.items, ...page2.items].map((i) => i.id);
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('likes / saves / comments', () => {
    beforeEach(() => {
      posts.findById.mockResolvedValue(post({ id: 'p1', authorId: 'u2' }));
    });

    it('like is idempotent', async () => {
      posts.findLike.mockResolvedValueOnce(null).mockResolvedValueOnce({
        postId: 'p1',
        userId: 'u1',
        createdAt: new Date(),
      });
      posts.countLikes.mockResolvedValue(1);
      await service.like('u1', 'p1');
      posts.findLike.mockResolvedValue({
        postId: 'p1',
        userId: 'u1',
        createdAt: new Date(),
      });
      await service.like('u1', 'p1');
      expect(posts.createLike).toHaveBeenCalledTimes(1);
    });

    it('like notifies post owner once; self-like and duplicate do not', async () => {
      posts.findById.mockResolvedValue(post({ id: 'p1', authorId: 'u2' }));
      posts.findLike.mockResolvedValueOnce(null).mockResolvedValue({
        postId: 'p1',
        userId: 'u1',
        createdAt: new Date(),
      });
      posts.createLike.mockResolvedValue({
        postId: 'p1',
        userId: 'u1',
        createdAt: new Date(),
      });
      posts.findUserAuthor.mockResolvedValue(author('u1', 'Omar'));
      posts.countLikes.mockResolvedValue(1);
      await service.like('u1', 'p1');
      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'u2',
          actorId: 'u1',
          type: NotificationType.post_liked,
          body: 'liked your post',
        }),
      );
      notifications.createNotification.mockClear();
      await service.like('u1', 'p1');
      expect(posts.createLike).toHaveBeenCalledTimes(1);
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it('self-like does not notify', async () => {
      posts.findById.mockResolvedValue(post({ id: 'p1', authorId: 'u1' }));
      posts.findLike.mockResolvedValue(null);
      posts.createLike.mockResolvedValue({
        postId: 'p1',
        userId: 'u1',
        createdAt: new Date(),
      });
      await service.like('u1', 'p1');
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it('comment notifies post owner; self-comment does not', async () => {
      posts.findById.mockResolvedValue(post({ id: 'p1', authorId: 'u2' }));
      posts.createComment.mockResolvedValue({
        id: 'c1',
        postId: 'p1',
        authorId: 'u1',
        text: 'Great work on this project!',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        author: author('u1', 'Omar'),
      });
      posts.findUserAuthor.mockResolvedValue(author('u1', 'Omar'));
      await service.createComment('u1', 'p1', {
        text: 'Great work on this project!',
      });
      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: 'u2',
          actorId: 'u1',
          type: NotificationType.post_commented,
          body: 'commented on your post',
          payload: expect.objectContaining({
            params: expect.objectContaining({
              postId: 'p1',
              commentId: 'c1',
              commentPreview: 'Great work on this project!',
            }),
          }),
        }),
      );

      notifications.createNotification.mockClear();
      posts.findById.mockResolvedValue(post({ id: 'p1', authorId: 'u1' }));
      posts.createComment.mockResolvedValue({
        id: 'c2',
        postId: 'p1',
        authorId: 'u1',
        text: 'note to self',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        author: author('u1'),
      });
      await service.createComment('u1', 'p1', { text: 'note to self' });
      expect(notifications.createNotification).not.toHaveBeenCalled();
    });

    it('listLikes returns public authors and blocks inaccessible connections posts', async () => {
      posts.findById.mockResolvedValue(post({ id: 'p1', authorId: 'u2' }));
      posts.listLikes.mockResolvedValue([
        {
          postId: 'p1',
          userId: 'u3',
          createdAt: new Date('2026-01-02T00:00:00.000Z'),
          user: author('u3', 'Guest'),
        },
      ]);
      const page = await service.listLikes('u1', 'p1');
      expect(page.items).toHaveLength(1);
      expect(page.items[0].id).toBe('u3');
      expect(page.items[0]).not.toHaveProperty('email');

      posts.findById.mockResolvedValue(
        post({
          id: 'p2',
          authorId: 'u2',
          visibility: PostVisibility.connections,
        }),
      );
      posts.listActiveConnectionPeerIds.mockResolvedValue([]);
      await expect(service.listLikes('u1', 'p2')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('like succeeds even if notification fails', async () => {
      posts.findById.mockResolvedValue(post({ id: 'p1', authorId: 'u2' }));
      posts.findLike
        .mockResolvedValueOnce(null)
        .mockResolvedValue({
          postId: 'p1',
          userId: 'u1',
          createdAt: new Date(),
        });
      posts.createLike.mockResolvedValue({
        postId: 'p1',
        userId: 'u1',
        createdAt: new Date(),
      });
      posts.findUserAuthor.mockResolvedValue(author('u1', 'Omar'));
      posts.countLikes.mockResolvedValue(1);
      notifications.createNotification.mockRejectedValueOnce(
        new Error('notif down'),
      );
      const eng = await service.like('u1', 'p1');
      expect(eng.isLiked).toBe(true);
      expect(eng.likeCount).toBe(1);
    });

    it('cannot delete another user comment on another user post', async () => {
      posts.findCommentById.mockResolvedValue({
        id: 'c1',
        postId: 'p1',
        authorId: 'u2',
        text: 'x',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        author: author('u2'),
      });
      posts.findById.mockResolvedValue(post({ id: 'p1', authorId: 'u3' }));
      await expect(service.deleteComment('u1', 'c1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('comment author can delete own comment', async () => {
      posts.findCommentById.mockResolvedValue({
        id: 'c1',
        postId: 'p1',
        authorId: 'u1',
        text: 'mine',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        author: author('u1'),
      });
      posts.findById.mockResolvedValue(post({ id: 'p1', authorId: 'u2' }));
      posts.softDeleteComment.mockResolvedValue({
        id: 'c1',
        postId: 'p1',
        authorId: 'u1',
        text: 'mine',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: new Date(),
        author: author('u1'),
      });
      await service.deleteComment('u1', 'c1');
      expect(posts.softDeleteComment).toHaveBeenCalledWith(
        'c1',
        expect.any(Date),
      );
    });

    it('post owner can delete another user comment under own post', async () => {
      posts.findCommentById.mockResolvedValue({
        id: 'c1',
        postId: 'p1',
        authorId: 'u2',
        text: 'theirs',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
        author: author('u2'),
      });
      posts.findById.mockResolvedValue(post({ id: 'p1', authorId: 'u1' }));
      posts.softDeleteComment.mockResolvedValue({
        id: 'c1',
        postId: 'p1',
        authorId: 'u2',
        text: 'theirs',
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: new Date(),
        author: author('u2'),
      });
      await service.deleteComment('u1', 'c1');
      expect(posts.softDeleteComment).toHaveBeenCalledWith(
        'c1',
        expect.any(Date),
      );
    });

    it('createComment returns canDelete for author', async () => {
      posts.findById.mockResolvedValue(post({ id: 'p1', authorId: 'u2' }));
      posts.createComment.mockResolvedValue({
        id: 'c1',
        postId: 'p1',
        authorId: 'u1',
        text: 'Nice',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        deletedAt: null,
        author: author('u1', 'Viewer'),
      });
      const created = await service.createComment('u1', 'p1', {
        text: 'Nice',
      });
      expect(created.canDelete).toBe(true);
      expect(created.author.id).toBe('u1');
      expect(posts.createComment).toHaveBeenCalledWith(
        expect.objectContaining({
          postId: 'p1',
          authorId: 'u1',
          text: 'Nice',
        }),
      );
    });

    it('listComments marks canDelete for post owner on others comments', async () => {
      posts.findById.mockResolvedValue(post({ id: 'p1', authorId: 'u1' }));
      posts.listComments.mockResolvedValue([
        {
          id: 'c1',
          postId: 'p1',
          authorId: 'u2',
          text: 'Hi',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          updatedAt: new Date('2026-01-01T00:00:00.000Z'),
          deletedAt: null,
          author: author('u2', 'Guest'),
        },
      ]);
      const page = await service.listComments('u1', 'p1');
      expect(page.items).toHaveLength(1);
      expect(page.items[0].canDelete).toBe(true);
    });

    it('rejects comments on inaccessible connections post', async () => {
      posts.findById.mockResolvedValue(
        post({
          id: 'p1',
          authorId: 'u2',
          visibility: PostVisibility.connections,
        }),
      );
      posts.listActiveConnectionPeerIds.mockResolvedValue([]);
      await expect(service.listComments('u1', 'p1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        service.createComment('u1', 'p1', { text: 'nope' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('visibility', () => {
    it('blocks non-connection from connections-only post', async () => {
      posts.findById.mockResolvedValue(
        post({
          id: 'p1',
          authorId: 'u2',
          visibility: PostVisibility.connections,
        }),
      );
      posts.listActiveConnectionPeerIds.mockResolvedValue([]);
      await expect(service.getById('u1', 'p1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });
});

function randomUuid() {
  return '11111111-1111-4111-8111-111111111111';
}

describe('feed cursor', () => {
  it('round-trips opaque cursor', () => {
    const encoded = encodeFeedCursor({
      version: 1,
      social: { createdAt: '2026-01-01T00:00:00.000Z', id: 'a' },
      discovery: null,
    });
    expect(encoded).toBeTruthy();
    expect(encoded.includes('{')).toBe(false);
  });
});
