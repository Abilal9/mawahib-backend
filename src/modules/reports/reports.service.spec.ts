import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ReportsService, ReportRateLimited } from './reports.service';

const REPORTER = '11111111-1111-4111-8111-111111111111';
const COMMENT = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

function harness() {
  const tx = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(),
    contentReport: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({ id: 'report-1', createdAt: new Date('2026-11-08T00:00:00.000Z') }),
      count: jest.fn().mockResolvedValue(0),
    },
    user: { update: jest.fn() },
    postComment: { update: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    contentReport: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const service = new ReportsService(prisma as never);
  return { service, tx, prisma };
}

const visibleComment = {
  author_id: OTHER,
  post_id: 'post-1',
  comment_deleted: null,
  post_deleted: null,
  visibility: 'public',
  post_author: '55555555-5555-4555-8555-555555555555',
  author_deleted: null,
};

describe('ReportsService', () => {
  it('rejects the reporter’s own comment and does not persist', async () => {
    const { service, tx } = harness();
    tx.$queryRaw.mockResolvedValueOnce([{ ...visibleComment, author_id: REPORTER }]);
    await expect(
      service.submit(REPORTER, { targetType: 'post_comment', targetId: COMMENT, reason: 'spam' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(tx.contentReport.create).not.toHaveBeenCalled();
  });

  it('hides deleted and invisible targets behind the same unavailable result', async () => {
    const { service, tx } = harness();
    tx.$queryRaw.mockResolvedValueOnce([{ ...visibleComment, comment_deleted: new Date() }]);
    await expect(
      service.submit(REPORTER, { targetType: 'post_comment', targetId: COMMENT, reason: 'spam' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    tx.$queryRaw.mockResolvedValueOnce([{ ...visibleComment, visibility: 'connections' }]);
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(
      service.submit(REPORTER, { targetType: 'post_comment', targetId: COMMENT, reason: 'spam' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('returns the existing open report without counting it against the rate limit', async () => {
    const { service, tx } = harness();
    tx.$queryRaw.mockResolvedValueOnce([visibleComment]);
    tx.contentReport.findFirst.mockResolvedValue({ id: 'report-1', createdAt: new Date('2026-11-08T00:00:00.000Z') });
    await expect(
      service.submit(REPORTER, { targetType: 'post_comment', targetId: COMMENT, reason: 'spam' }),
    ).resolves.toMatchObject({ alreadyReported: true, reportId: 'report-1' });
    expect(tx.contentReport.count).not.toHaveBeenCalled();
    expect(tx.contentReport.create).not.toHaveBeenCalled();
  });

  it('persists a comment report from the authenticated reporter and leaves content unchanged', async () => {
    const { service, tx } = harness();
    tx.$queryRaw.mockResolvedValueOnce([visibleComment]);
    const result = await service.submit(REPORTER, {
      targetType: 'post_comment',
      targetId: COMMENT,
      reason: 'other',
      details: '  This comment is a scam. ',
    });
    expect(result.alreadyReported).toBe(false);
    expect(tx.contentReport.create.mock.calls[0][0].data).toMatchObject({
      reporterUserId: REPORTER,
      targetType: 'post_comment',
      targetId: COMMENT,
      reportedUserId: OTHER,
      contextPostId: 'post-1',
      reason: 'other',
      details: 'This comment is a scam.',
    });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.postComment.update).not.toHaveBeenCalled();
  });

  it('reads the winning open report after a unique conflict rolls the transaction back', async () => {
    const { service, tx, prisma } = harness();
    tx.$queryRaw.mockResolvedValueOnce([visibleComment]);
    tx.contentReport.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '6' }),
    );
    prisma.contentReport.findFirst.mockResolvedValue({ id: 'report-9', createdAt: new Date('2026-11-08T00:00:00.000Z') });
    await expect(
      service.submit(REPORTER, { targetType: 'post_comment', targetId: COMMENT, reason: 'spam' }),
    ).resolves.toMatchObject({ alreadyReported: true, reportId: 'report-9' });
  });

  it('refuses a work request the reporter is not part of', async () => {
    const { service, tx } = harness();
    tx.$queryRaw.mockResolvedValueOnce([{
      sender_user_id: OTHER,
      recipient_user_id: '44444444-4444-4444-8444-444444444444',
      deleted_at: null,
    }]);
    await expect(
      service.submit(REPORTER, { targetType: 'work_request', targetId: COMMENT, reason: 'spam' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('stops the eleventh report in an hour', async () => {
    const { service, tx } = harness();
    tx.$queryRaw.mockResolvedValueOnce([visibleComment]);
    tx.contentReport.count.mockResolvedValueOnce(10).mockResolvedValueOnce(10);
    await expect(
      service.submit(REPORTER, { targetType: 'post_comment', targetId: COMMENT, reason: 'spam' }),
    ).rejects.toBeInstanceOf(ReportRateLimited);
    expect(tx.contentReport.create).not.toHaveBeenCalled();
  });
});

const TARGET = '66666666-6666-4666-8666-666666666666';
const SECOND = '77777777-7777-4777-8777-777777777777';

describe('report targets beyond comments and work requests', () => {
  it('lets two people report one account and rejects a self report', async () => {
    const { service, tx } = harness();
    tx.$queryRaw.mockResolvedValue([{ deleted_at: null }]);
    await expect(service.submit(REPORTER, { targetType: 'user', targetId: REPORTER, reason: 'spam' })).rejects.toBeInstanceOf(BadRequestException);
    const first = await service.submit(REPORTER, { targetType: 'user', targetId: TARGET, reason: 'spam' });
    const second = await service.submit(SECOND, { targetType: 'user', targetId: TARGET, reason: 'spam' });
    expect(first.alreadyReported).toBe(false);
    expect(second.alreadyReported).toBe(false);
    expect(tx.contentReport.create).toHaveBeenCalledTimes(2);
  });

  it('does not count a duplicate open account report', async () => {
    const { service, tx } = harness();
    tx.$queryRaw.mockResolvedValue([{ deleted_at: null }]);
    tx.contentReport.findFirst.mockResolvedValue({ id: 'report-1', createdAt: new Date('2026-11-08T00:00:00.000Z') });
    await expect(service.submit(REPORTER, { targetType: 'user', targetId: TARGET, reason: 'spam' })).resolves.toMatchObject({ alreadyReported: true });
    expect(tx.contentReport.count).not.toHaveBeenCalled();
  });

  it('hides a deleted account and accepts a suspended one', async () => {
    const { service, tx } = harness();
    tx.$queryRaw.mockResolvedValueOnce([{ deleted_at: new Date() }]);
    await expect(service.submit(REPORTER, { targetType: 'user', targetId: TARGET, reason: 'spam' })).rejects.toBeInstanceOf(NotFoundException);
    tx.$queryRaw.mockResolvedValueOnce([{ deleted_at: null }]);
    await expect(service.submit(REPORTER, { targetType: 'user', targetId: TARGET, reason: 'spam' })).resolves.toMatchObject({ alreadyReported: false });
  });

  it('requires the existing connection for a private post', async () => {
    const { service, tx } = harness();
    tx.$queryRaw.mockResolvedValueOnce([{ author_id: OTHER, visibility: 'connections', deleted_at: null, author_deleted: null }]);
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(service.submit(REPORTER, { targetType: 'post', targetId: TARGET, reason: 'spam' })).rejects.toBeInstanceOf(NotFoundException);
    tx.$queryRaw.mockResolvedValueOnce([{ author_id: OTHER, visibility: 'connections', deleted_at: null, author_deleted: null }]);
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'connection' }]);
    await expect(service.submit(REPORTER, { targetType: 'post', targetId: TARGET, reason: 'spam' })).resolves.toMatchObject({ alreadyReported: false });
  });

  it('rejects the post author and a public post from someone else', async () => {
    const { service, tx } = harness();
    tx.$queryRaw.mockResolvedValueOnce([{ author_id: REPORTER, visibility: 'public', deleted_at: null, author_deleted: null }]);
    await expect(service.submit(REPORTER, { targetType: 'post', targetId: TARGET, reason: 'spam' })).rejects.toBeInstanceOf(BadRequestException);
    tx.$queryRaw.mockResolvedValueOnce([{ author_id: OTHER, visibility: 'public', deleted_at: null, author_deleted: null }]);
    const result = await service.submit(REPORTER, { targetType: 'post', targetId: TARGET, reason: 'spam' });
    expect(result.alreadyReported).toBe(false);
    expect(tx.contentReport.create.mock.calls.at(-1)[0].data.reportedUserId).toBe(OTHER);
  });

  it('hides an unpublished review from the reviewee and accepts a published one', async () => {
    const { service, tx } = harness();
    tx.$queryRaw.mockResolvedValueOnce([{ reviewer_id: OTHER, engagement_deleted: null, reviewee_deleted: null, published: false }]);
    await expect(service.submit(REPORTER, { targetType: 'engagement_review', targetId: TARGET, reason: 'spam' })).rejects.toBeInstanceOf(NotFoundException);
    tx.$queryRaw.mockResolvedValueOnce([{ reviewer_id: OTHER, engagement_deleted: null, reviewee_deleted: null, published: true }]);
    await expect(service.submit(REPORTER, { targetType: 'engagement_review', targetId: TARGET, reason: 'spam' })).resolves.toMatchObject({ alreadyReported: false });
  });

  it('does not confirm an unpublished review to its author', async () => {
    const { service, tx } = harness();
    tx.$queryRaw.mockResolvedValueOnce([{ reviewer_id: REPORTER, engagement_deleted: null, reviewee_deleted: null, published: false }]);
    await expect(service.submit(REPORTER, { targetType: 'engagement_review', targetId: TARGET, reason: 'spam' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects the reviewer and a deleted engagement', async () => {
    const { service, tx } = harness();
    tx.$queryRaw.mockResolvedValueOnce([{ reviewer_id: REPORTER, engagement_deleted: null, reviewee_deleted: null, published: true }]);
    await expect(service.submit(REPORTER, { targetType: 'engagement_review', targetId: TARGET, reason: 'spam' })).rejects.toBeInstanceOf(BadRequestException);
    tx.$queryRaw.mockResolvedValueOnce([{ reviewer_id: OTHER, engagement_deleted: new Date(), reviewee_deleted: null, published: true }]);
    await expect(service.submit(REPORTER, { targetType: 'engagement_review', targetId: TARGET, reason: 'spam' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('follows listing access for open, draft, and closed jobs', async () => {
    const { service, tx } = harness();
    tx.$queryRaw.mockResolvedValueOnce([{ poster_id: OTHER, status: 'draft', deleted_at: null, poster_deleted: null }]);
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(service.submit(REPORTER, { targetType: 'job_listing', targetId: TARGET, reason: 'spam' })).rejects.toBeInstanceOf(NotFoundException);
    tx.$queryRaw.mockResolvedValueOnce([{ poster_id: OTHER, status: 'closed', deleted_at: null, poster_deleted: null }]);
    tx.$queryRaw.mockResolvedValueOnce([]);
    await expect(service.submit(REPORTER, { targetType: 'job_listing', targetId: TARGET, reason: 'spam' })).rejects.toBeInstanceOf(NotFoundException);
    tx.$queryRaw.mockResolvedValueOnce([{ poster_id: OTHER, status: 'closed', deleted_at: null, poster_deleted: null }]);
    tx.$queryRaw.mockResolvedValueOnce([{ id: 'application' }]);
    await expect(service.submit(REPORTER, { targetType: 'job_listing', targetId: TARGET, reason: 'spam' })).resolves.toMatchObject({ alreadyReported: false });
    tx.$queryRaw.mockResolvedValueOnce([{ poster_id: REPORTER, status: 'open', deleted_at: null, poster_deleted: null }]);
    await expect(service.submit(REPORTER, { targetType: 'job_listing', targetId: TARGET, reason: 'spam' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects draft, archived, and deleted-owner services', async () => {
    const { service, tx } = harness();
    for (const row of [
      { user_id: OTHER, status: 'draft', deleted_at: null, owner_deleted: null },
      { user_id: OTHER, status: 'archived', deleted_at: null, owner_deleted: null },
      { user_id: OTHER, status: 'published', deleted_at: null, owner_deleted: new Date() },
    ]) {
      tx.$queryRaw.mockResolvedValueOnce([row]);
      await expect(service.submit(REPORTER, { targetType: 'service_offering', targetId: TARGET, reason: 'spam' })).rejects.toBeInstanceOf(NotFoundException);
    }
    tx.$queryRaw.mockResolvedValueOnce([{ user_id: REPORTER, status: 'draft', deleted_at: null, owner_deleted: null }]);
    await expect(service.submit(REPORTER, { targetType: 'service_offering', targetId: TARGET, reason: 'spam' })).rejects.toBeInstanceOf(BadRequestException);
    tx.$queryRaw.mockResolvedValueOnce([{ user_id: OTHER, status: 'published', deleted_at: null, owner_deleted: null }]);
    await expect(service.submit(REPORTER, { targetType: 'service_offering', targetId: TARGET, reason: 'spam' })).resolves.toMatchObject({ alreadyReported: false });
  });
});
