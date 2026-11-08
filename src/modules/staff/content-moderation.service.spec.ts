import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ContentModerationService } from './content-moderation.service';

const STAFF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ACTOR = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const POST = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const AUTHOR = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: POST,
    author_id: AUTHOR,
    deleted_at: null,
    staff_hidden_at: null,
    moderation_version: 0,
    ...overrides,
  };
}

function harness(locked = row()) {
  const tx = {
    $queryRaw: jest.fn()
      .mockResolvedValueOnce([{ id: STAFF, status: 'active', role: 'operator', linked_product_user_id: null }])
      .mockResolvedValueOnce([locked]),
    post: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    postComment: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    staffAuditEvent: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    notification: { create: jest.fn().mockResolvedValue({ id: 'note-1' }) },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx)),
    staffAuditEvent: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { service: new ContentModerationService(prisma as never), tx, prisma };
}

const actor = { issuer: 'https://staff.example', subjectId: ACTOR };
const hide = { hidden: true, expectedVersion: 0, reason: '  Harassment in the caption.  ' };

describe('ContentModerationService', () => {
  it('hides a post, audits it, and notifies the author without the reason', async () => {
    const { service, tx } = harness();
    const result = await service.changePost(actor, POST, hide);
    expect(result).toMatchObject({ outcome: 'changed', hidden: true, version: 1 });
    expect(tx.staffAuditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'post_hidden',
        targetSubjectId: POST,
        targetPostId: POST,
        targetCommentId: null,
        reason: 'Harassment in the caption.',
      }),
    });
    const audit = tx.staffAuditEvent.create.mock.calls[0][0].data as Record<string, unknown>;
    expect(audit.targetAccountId).toBeUndefined();
    expect(audit.targetReportId).toBeUndefined();
    const note = tx.notification.create.mock.calls[0][0].data as {
      body: string;
      actorId: null;
      payload: { params: Record<string, unknown> };
    };
    expect(note.actorId).toBeNull();
    expect(note.body).toBe('Mawahib hid one of your posts.');
    expect(JSON.stringify(note.payload)).not.toContain('Harassment');
    expect(JSON.stringify(note.payload)).not.toContain('reporter');
  });

  it('does not notify or audit when the post is already hidden', async () => {
    const { service, tx } = harness(row({ staff_hidden_at: new Date('2026-11-08T00:00:00.000Z'), moderation_version: 4 }));
    const result = await service.changePost(actor, POST, { ...hide, expectedVersion: 0 });
    expect(result).toMatchObject({ outcome: 'unchanged', hidden: true, version: 4 });
    expect(tx.staffAuditEvent.create).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
    expect(tx.post.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a stale version after a hide and restore cycle', async () => {
    const { service, tx } = harness(row({ moderation_version: 2 }));
    await expect(service.changePost(actor, POST, hide)).rejects.toBeInstanceOf(ConflictException);
    expect(tx.post.updateMany).not.toHaveBeenCalled();
    expect(tx.staffAuditEvent.create).not.toHaveBeenCalled();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('restores deleted content without clearing deletion or notifying', async () => {
    const { service, tx } = harness(row({
      staff_hidden_at: new Date('2026-11-08T00:00:00.000Z'),
      deleted_at: new Date('2026-11-08T01:00:00.000Z'),
      moderation_version: 1,
    }));
    const result = await service.changePost(actor, POST, { hidden: false, expectedVersion: 1, reason: 'Mistake.' });
    expect(result).toMatchObject({ outcome: 'changed', hidden: false, version: 2 });
    const data = tx.post.updateMany.mock.calls[0][0].data as Record<string, unknown>;
    expect(data.deletedAt).toBeUndefined();
    expect(data.staffHiddenAt).toBeNull();
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('refuses to hide deleted content', async () => {
    const { service, tx } = harness(row({ deleted_at: new Date() }));
    await expect(service.changePost(actor, POST, hide)).rejects.toMatchObject({ response: { code: 'CONTENT_DELETED' } });
    expect(tx.staffAuditEvent.create).not.toHaveBeenCalled();
  });

  it('rolls the change back when the notification insert fails', async () => {
    const { service, tx } = harness();
    tx.notification.create.mockRejectedValue(new Error('notification down'));
    await expect(service.changePost(actor, POST, hide)).rejects.toThrow('notification down');
  });

  it('rolls the change back when the audit insert fails', async () => {
    const { service, tx } = harness();
    tx.staffAuditEvent.create.mockRejectedValue(new Error('audit down'));
    await expect(service.changePost(actor, POST, hide)).rejects.toThrow('audit down');
    expect(tx.notification.create).not.toHaveBeenCalled();
  });

  it('rejects the operator’s own linked content and an inactive membership', async () => {
    const own = harness();
    own.tx.$queryRaw.mockReset();
    own.tx.$queryRaw
      .mockResolvedValueOnce([{ id: STAFF, status: 'active', role: 'operator', linked_product_user_id: AUTHOR }])
      .mockResolvedValueOnce([row()]);
    await expect(own.service.changePost(actor, POST, hide)).rejects.toBeInstanceOf(ForbiddenException);

    const inactive = harness();
    inactive.tx.$queryRaw.mockReset();
    inactive.tx.$queryRaw.mockResolvedValueOnce([{ id: STAFF, status: 'inactive', role: 'operator', linked_product_user_id: null }]);
    await expect(inactive.service.changePost(actor, POST, hide)).rejects.toBeInstanceOf(ForbiddenException);
    expect(inactive.tx.post.updateMany).not.toHaveBeenCalled();
  });

  it('scopes content history to the requested comment', async () => {
    const { service, prisma } = harness();
    await service.list({ commentId: POST });
    expect(prisma.staffAuditEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        targetCommentId: POST,
        action: { in: ['comment_hidden', 'comment_restored'] },
      }),
    }));
  });
});
