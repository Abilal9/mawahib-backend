import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, StaffAuditAction } from '@prisma/client';
import { ReportQueueService } from './report-queue.service';

const STAFF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REPORT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

function harness(status = 'open') {
  const tx = {
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([{ id: STAFF, status: 'active', role: 'operator' }])
      .mockResolvedValueOnce([{ id: REPORT, status }]),
    contentReport: { update: jest.fn().mockResolvedValue({}) },
    staffAuditEvent: { create: jest.fn().mockResolvedValue({}) },
    user: { update: jest.fn() },
    postComment: { update: jest.fn() },
    workRequest: { update: jest.fn() },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    contentReport: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(4),
    },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  return { service: new ReportQueueService(prisma as never), tx, prisma };
}

const body = { status: 'resolved' as const, expectedStatus: 'open' as const, note: 'Reviewed and closed.' };

describe('ReportQueueService', () => {
  it('resolves a report with one audit event and no content or account change', async () => {
    const { service, tx } = harness();
    await expect(
      service.changeStatus(REPORT, { issuer: 'https://staff.example', subjectId: ACTOR }, body),
    ).resolves.toEqual({ id: REPORT, status: 'resolved' });
    expect(tx.contentReport.update).toHaveBeenCalledTimes(1);
    expect(tx.staffAuditEvent.create).toHaveBeenCalledTimes(1);
    expect(tx.staffAuditEvent.create.mock.calls[0][0].data).toMatchObject({
      action: StaffAuditAction.report_resolved,
      targetSubjectId: REPORT,
      targetReportId: REPORT,
      actorSubjectId: ACTOR,
      reason: 'Reviewed and closed.',
    });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.postComment.update).not.toHaveBeenCalled();
    expect(tx.workRequest.update).not.toHaveBeenCalled();
  });

  it('refuses a stale expected status', async () => {
    const { service, tx } = harness('dismissed');
    await expect(
      service.changeStatus(REPORT, { issuer: 'https://staff.example', subjectId: ACTOR }, body),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.contentReport.update).not.toHaveBeenCalled();
    expect(tx.staffAuditEvent.create).not.toHaveBeenCalled();
  });

  it('turns a duplicate open report into a conflict and writes no audit', async () => {
    const { service, tx } = harness('dismissed');
    tx.contentReport.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '6' }),
    );
    await expect(
      service.changeStatus(REPORT, { issuer: 'https://staff.example', subjectId: ACTOR }, {
        status: 'open',
        expectedStatus: 'dismissed',
        note: 'Reopen',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(tx.staffAuditEvent.create).not.toHaveBeenCalled();
  });

  it('accepts the new target filters and omits live text from a deleted post', async () => {
    const { service, prisma } = harness();
    const db = prisma as unknown as {
      contentReport: {
        findMany: jest.Mock;
        findUnique: jest.Mock;
      };
      post: { findUnique: jest.Mock };
    };
    await service.list({ targetType: 'service_offering' });
    expect(db.contentReport.findMany.mock.calls.at(-1)[0].where.targetType).toEqual({ in: ['service_offering'] });
    expect((await service.list({ targetType: 'service_offering' })).matchCount).toBe(4);
    await expect(service.list({ targetType: 'invoice' })).rejects.toBeTruthy();
    db.contentReport.findUnique = jest.fn().mockResolvedValue({
      id: REPORT,
      targetType: 'post',
      targetId: 'post-1',
      reason: 'spam',
      details: null,
      status: 'open',
      contextPostId: null,
      createdAt: new Date('2026-11-08T00:00:00.000Z'),
      statusChangedAt: null,
      reporter: null,
      reportedUser: null,
      auditEvents: [],
    });
    db.post = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'post-1',
        visibility: 'public',
        text: 'secret current text',
        createdAt: new Date('2026-11-08T00:00:00.000Z'),
        deletedAt: new Date('2026-11-08T01:00:00.000Z'),
        author: { deletedAt: null },
        _count: { media: 2 },
      }),
    };
    const detail = await service.detail(REPORT);
    expect(detail.target).toMatchObject({ state: 'deleted', post: { excerpt: null, deleted: true, mediaCount: 2 } });
    expect(JSON.stringify(detail.target)).not.toContain('secret current text');
  });

  it('counts every report row and combines status or target filters', async () => {
    const { service, prisma } = harness();
    const db = prisma as unknown as { contentReport: { count: jest.Mock; findMany: jest.Mock } };
    db.contentReport.count.mockResolvedValueOnce(2).mockResolvedValueOnce(7);
    await expect(service.summary()).resolves.toEqual({ openReports: 2, totalReports: 7 });
    expect(db.contentReport.count.mock.calls[0][0]).toEqual({ where: { status: 'open' } });
    expect(db.contentReport.count.mock.calls[1][0]).toEqual(undefined);
    db.contentReport.findMany.mockResolvedValue([]);
    db.contentReport.count.mockResolvedValue(3);
    await service.list({ status: ['open', 'resolved'], targetType: 'post,post_comment', cursor: undefined });
    const where = db.contentReport.findMany.mock.calls.at(-1)[0].where;
    expect(where.status).toEqual({ in: ['open', 'resolved'] });
    expect(where.targetType).toEqual({ in: ['post', 'post_comment'] });
    expect(where.AND).toBeUndefined();
  });

  it('continues the next page at the last report shown', async () => {
    const { service, prisma } = harness();
    const db = prisma as unknown as { contentReport: { findMany: jest.Mock } };
    const older = new Date('2026-11-08T00:00:01.000Z');
    const newer = new Date('2026-11-08T00:00:02.000Z');
    const row = (id: string, createdAt: Date) => ({
      id,
      targetType: 'post',
      reason: 'spam',
      status: 'open',
      createdAt,
      statusChangedAt: null,
      details: null,
      reportedUser: null,
    });
    db.contentReport.findMany.mockResolvedValue([row('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', newer), row('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', older)]);
    const page = await service.list({ limit: 1 });
    expect(page.items.map((item) => item.id)).toEqual(['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa']);
    expect(Buffer.from(page.nextCursor ?? '', 'base64url').toString('utf8')).toContain('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(Buffer.from(page.nextCursor ?? '', 'base64url').toString('utf8')).not.toContain('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
  });

  it('counts each exact target once and keeps comment reports off the parent post', async () => {
    const { service, prisma } = harness();
    const db = prisma as unknown as { contentReport: { findMany: jest.Mock }; $queryRaw: jest.Mock };
    const createdAt = new Date('2026-11-08T00:00:00.000Z');
    const row = (id: string, targetType: string, targetId: string) => ({
      id, targetType, targetId, reason: 'spam', status: 'open', createdAt, statusChangedAt: null, details: null, reportedUser: null,
    });
    const commentId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const postId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    db.contentReport.findMany.mockResolvedValue([
      row(commentId, 'post_comment', commentId),
      row(postId, 'post', postId),
    ]);
    db.$queryRaw.mockResolvedValue([
      { target_type: 'post_comment', target_id: commentId, open_count: 2, total_count: 3, unique_reporters: 2 },
      { target_type: 'post', target_id: postId, open_count: 1, total_count: 1, unique_reporters: 1 },
    ]);
    const page = await service.list({ status: 'resolved' });
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(page.items[0].targetCounts).toEqual({ openReportCount: 2, totalReportCount: 3, uniqueReporterCount: 2 });
    expect(page.items[1].targetCounts).toEqual({ openReportCount: 1, totalReportCount: 1, uniqueReporterCount: 1 });
    expect(JSON.stringify(db.$queryRaw.mock.calls[0])).not.toContain('resolved');
  });

  it('filters related reports to one target without dropping the status filter', async () => {
    const { service, prisma } = harness();
    const db = prisma as unknown as { contentReport: { findMany: jest.Mock } };
    const targetId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await service.list({ status: 'open', exactTargetType: 'post_comment', exactTargetId: targetId });
    expect(db.contentReport.findMany.mock.calls.at(-1)[0].where).toMatchObject({
      status: { in: ['open'] },
      targetType: 'post_comment',
      targetId,
    });
    await expect(service.list({ exactTargetType: 'post_comment' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not select the reporter on the queue list', async () => {
    const { service, prisma } = harness();
    await service.list({ status: 'open' });
    const select = prisma.contentReport.findMany.mock.calls[0][0].select;
    expect(select).not.toHaveProperty('reporter');
    expect(select).not.toHaveProperty('reporterUserId');
    expect(select.reportedUser).toBeTruthy();
  });

  it('hides a missing report', async () => {
    const { service, tx } = harness();
    tx.$queryRaw.mockReset();
    tx.$queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    await expect(
      service.changeStatus(REPORT, { issuer: 'https://staff.example', subjectId: ACTOR }, body),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
