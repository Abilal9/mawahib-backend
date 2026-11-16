import { PrismaClient } from '@prisma/client';
import { DeletionCleanupRunner } from './deletion-cleanup.runner';
import { DeletionClosureService } from './deletion-closure.service';
import { DeletionEligibilityService } from './deletion-eligibility.service';
import { refuseNewObligation } from './deletion-obligation';

const databaseUrl = process.env.DELETION_CLOSURE_DATABASE_URL;

describe('account closure on disposable postgres', () => {
  if (!databaseUrl) {
    it.skip('requires DELETION_CLOSURE_DATABASE_URL', () => undefined);
    return;
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const eligibility = new DeletionEligibilityService(prisma as never);
  const closure = new DeletionClosureService(prisma as never, eligibility);
  const removed: string[] = [];
  const deletedAuth: string[] = [];
  const runner = new DeletionCleanupRunner(prisma as never, {
    deleteAuthUser: async (userId: string) => {
      deletedAuth.push(userId);
      return 'missing';
    },
    removeStoredObject: async (bucket: string, objectKey: string) => {
      removed.push(`${bucket}/${objectKey}`);
      return 'removed';
    },
  } as never);

  beforeAll(async () => {
    process.env.ACCOUNT_DELETION_CLOSURE_ENABLED = 'true';
    await prisma.$connect();
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION account_deletion_audit_fail() RETURNS trigger AS $$
      BEGIN
        IF NEW.reason = 'force-audit-fail' THEN
          RAISE EXCEPTION 'audit failed';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER account_deletion_audit_fail
      BEFORE INSERT ON staff_audit_events
      FOR EACH ROW EXECUTE FUNCTION account_deletion_audit_fail()
    `);
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS account_deletion_audit_fail ON staff_audit_events`);
    await prisma.$disconnect();
  });

  async function person(status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') {
    const id = crypto.randomUUID();
    const email = `synthetic-${id}@example.test`;
    await prisma.user.create({
      data: {
        id,
        email,
        accountType: 'talent',
        displayName: 'Synthetic Person',
        username: `u${id.replaceAll('-', '').slice(0, 20)}`,
        accountStatus: status,
        profile: { create: { bio: 'private bio', phoneE164: `+1555${id.replaceAll('-', '').slice(0, 7)}`, phoneVerified: true } },
      },
    });
    return { id, email };
  }

  async function staff(linkedProductUserId?: string) {
    const id = crypto.randomUUID();
    const subjectId = crypto.randomUUID();
    await prisma.staffMember.create({
      data: {
        id,
        issuer: 'https://staff.example',
        subjectId,
        status: 'active',
        role: 'operator',
        linkedProductUserId,
      },
    });
    return { id, subjectId, issuer: 'https://staff.example' };
  }

  it('closes an eligible account once, frees identity, and retries cleanup by the original id', async () => {
    const subject = await person();
    const other = await person();
    await prisma.userSkill.create({ data: { userId: subject.id, skill: 'Design' } });
    await prisma.post.create({ data: { authorId: subject.id, text: 'personal post' } });
    const engagement = await prisma.workEngagement.create({
      data: {
        clientId: other.id,
        providerId: subject.id,
        title: 'Finished work',
        status: 'completed',
        source: 'direct',
        completedAt: new Date(),
      },
    });
    const review = await prisma.engagementReview.create({
      data: {
        engagementId: engagement.id,
        reviewerId: other.id,
        revieweeId: subject.id,
        rating: 5,
        body: 'private review text',
      },
    });
    const conversation = await prisma.conversation.create({
      data: { type: 'work', workEngagementId: engagement.id },
    });
    await prisma.conversationParticipant.createMany({
      data: [
        { conversationId: conversation.id, userId: subject.id },
        { conversationId: conversation.id, userId: other.id },
      ],
    });
    const kept = await prisma.mediaAsset.create({
      data: {
        ownerId: subject.id,
        bucket: 'chat',
        objectKey: `${subject.id}/kept-chat.jpg`,
        mimeType: 'image/jpeg',
        byteSize: 10,
        purpose: 'message',
        status: 'ready',
      },
    });
    const personal = await prisma.mediaAsset.create({
      data: {
        ownerId: subject.id,
        bucket: 'avatars',
        objectKey: `${subject.id}/avatar.jpg`,
        mimeType: 'image/jpeg',
        byteSize: 10,
        purpose: 'avatar',
        status: 'ready',
      },
    });
    const message = await prisma.message.create({
      data: { conversationId: conversation.id, senderId: subject.id, body: 'kept message text' },
    });
    await prisma.messageAttachment.create({
      data: { messageId: message.id, mediaAssetId: kept.id },
    });
    await prisma.notification.create({
      data: {
        recipientId: other.id,
        actorId: subject.id,
        type: 'system',
        title: 'Synthetic Person sent a note',
        body: 'Synthetic Person is here',
      },
    });
    await prisma.accountDeletionRequest.create({
      data: { userId: subject.id, status: 'pending', selfRequestedAt: new Date(), selfIdempotencyKey: 'self' },
    });

    const key = `close-${subject.id}`;
    const first = await closure.confirmSelf(subject.id, key, Date.now() / 1000, 'Delete this account');
    const replay = await closure.confirmSelf(subject.id, key, Date.now() / 1000, 'Delete this account');
    expect(first.outcome).toBe('closed');
    expect(replay.outcome).toBe('replayed');

    const tombstone = await prisma.user.findUniqueOrThrow({ where: { id: subject.id }, include: { profile: true } });
    expect(tombstone.deletedAt).not.toBeNull();
    expect(tombstone.email).toBe(`deleted+${subject.id}@invalid.mawahib`);
    expect(tombstone.displayName).toBe('Deleted user');
    expect(tombstone.profile?.bio).toBe('');
    expect(tombstone.profile?.phoneE164).toBeNull();
    expect(await prisma.post.count({ where: { authorId: subject.id } })).toBe(0);
    expect(await prisma.engagementReview.count({ where: { id: review.id } })).toBe(0);
    expect(await prisma.userSkill.count({ where: { userId: subject.id } })).toBe(0);
    const archived = await prisma.conversation.findUniqueOrThrow({ where: { id: conversation.id } });
    expect(archived.archivedAt).not.toBeNull();
    expect((await prisma.message.findUniqueOrThrow({ where: { id: message.id } })).body).toBe('kept message text');
    const note = await prisma.notification.findFirstOrThrow({ where: { recipientId: other.id } });
    expect(note.title).not.toContain('Synthetic Person');
    const tasks = await prisma.accountDeletionCleanupTask.findMany({ where: { userId: subject.id } });
    expect(tasks.map((task) => task.kind).sort()).toEqual(['auth_user', 'completion_email', 'storage_object']);
    expect(tasks.find((task) => task.kind === 'storage_object')?.objectKey).toBe(personal.objectKey);
    expect(tasks.some((task) => task.objectKey === kept.objectKey)).toBe(false);
    const request = await prisma.accountDeletionRequest.findFirstOrThrow({ where: { userId: subject.id } });
    expect(request.completionEmail).toBe(subject.email);
    expect(request.status).toBe('closed');

    await expect(closure.confirmSelf(subject.id, 'close-2', Date.now() / 1000, 'Delete this account')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ACCOUNT_UNAVAILABLE' }) as object,
    });
    await expect(prisma.$transaction((tx) => refuseNewObligation(tx, [subject.id, other.id]))).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'ACCOUNT_UNAVAILABLE' }) as object,
    });

    const reborn = await prisma.user.create({
      data: {
        id: crypto.randomUUID(),
        email: subject.email,
        accountType: 'talent',
        displayName: 'New Person',
        username: `n${subject.id.replaceAll('-', '').slice(0, 20)}`,
      },
    });
    expect(reborn.id).not.toBe(subject.id);

    await runner.runOnce();
    await runner.runOnce();
    await runner.runOnce();
    expect(deletedAuth).toEqual([subject.id]);
    expect(removed).toEqual([`avatars/${subject.id}/avatar.jpg`]);
    const emailTask = await prisma.accountDeletionCleanupTask.findFirstOrThrow({
      where: { userId: subject.id, kind: 'completion_email' },
    });
    expect(emailTask.status).toBe('pending');
    expect(emailTask.lastError).toBe('mail_transport_unavailable');
    const retained = await prisma.accountDeletionRequest.findFirstOrThrow({ where: { userId: subject.id } });
    expect(retained.completionEmail).toBe(subject.email);
    expect(retained.completionEmailExpiresAt).not.toBeNull();
    expect(await prisma.user.findUnique({ where: { id: reborn.id } })).not.toBeNull();
  });

  it('refuses unresolved work and a succeeded payment without a snapshot, then keeps a real snapshot', async () => {
    const subject = await person();
    const other = await person();
    const blocked = await prisma.workEngagement.create({
      data: { clientId: other.id, providerId: subject.id, title: 'Open work', status: 'in_progress', source: 'direct' },
    });
    await prisma.accountDeletionRequest.create({
      data: { userId: subject.id, status: 'pending', selfRequestedAt: new Date() },
    });
    await expect(closure.confirmSelf(subject.id, `blocked-${subject.id}`, Date.now() / 1000, 'Delete this account')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'DELETION_BLOCKED' }) as object,
    });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: subject.id } })).deletedAt).toBeNull();
    await prisma.workEngagement.update({ where: { id: blocked.id }, data: { status: 'completed' } });
    await prisma.payment.create({
      data: {
        engagementId: blocked.id,
        payerUserId: other.id,
        payeeUserId: subject.id,
        amount: '25.00',
        currency: 'SAR',
        method: 'card',
        status: 'succeeded',
        idempotencyKey: `pay-${blocked.id}`,
      },
    });
    await expect(closure.confirmSelf(subject.id, `no-snapshot-${subject.id}`, Date.now() / 1000, 'Delete this account')).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DELETION_BLOCKED',
        blockers: [expect.objectContaining({ code: 'invoice_snapshot_unavailable' })],
      }) as object,
    });
    const payment = await prisma.payment.findFirstOrThrow({ where: { engagementId: blocked.id } });
    await prisma.invoice.create({
      data: {
        engagementId: blocked.id,
        paymentId: payment.id,
        invoiceNumber: `INV-${blocked.id}`,
        currency: 'SAR',
        subtotal: '25.00',
        total: '25.00',
        payerDisplayName: 'Other',
        payeeDisplayName: 'Synthetic Person',
        description: 'Finished work',
        paymentReference: '',
      },
    });
    await closure.confirmSelf(subject.id, `with-snapshot-${subject.id}`, Date.now() / 1000, 'Delete this account');
    expect(await prisma.invoice.count({ where: { paymentId: payment.id } })).toBe(1);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: other.id } })).deletedAt).toBeNull();
  });

  it('lets staff close a suspended account, rejects linked-self, and rolls back when the audit fails', async () => {
    const subject = await person('SUSPENDED');
    const operator = await staff();
    const linked = await staff(subject.id);
    await expect(
      closure.confirmStaff(linked, subject.id, {
        reason: 'Terms',
        confirmedEmail: subject.email,
        idempotencyKey: `linked-${subject.id}`,
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SELF_ACTION_FORBIDDEN' }) as object,
    });
    await expect(
      closure.confirmStaff(operator, subject.id, {
        reason: 'force-audit-fail',
        confirmedEmail: subject.email,
        idempotencyKey: `audit-fail-${subject.id}`,
      }),
    ).rejects.toThrow('audit failed');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: subject.id } })).deletedAt).toBeNull();
    expect(await prisma.accountDeletionRequest.count({ where: { userId: subject.id } })).toBe(0);
    await closure.confirmStaff(operator, subject.id, {
      reason: 'Terms violation',
      confirmedEmail: subject.email,
      idempotencyKey: `staff-close-${subject.id}`,
    });
    const closed = await prisma.user.findUniqueOrThrow({ where: { id: subject.id } });
    expect(closed.deletedAt).not.toBeNull();
    expect(closed.accountStatus).toBe('SUSPENDED');
    const audit = await prisma.staffAuditEvent.findFirstOrThrow({
      where: { targetAccountId: subject.id, action: 'account_deleted' },
    });
    expect(audit.actorStaffMemberId).toBe(operator.id);
    expect(await prisma.staffMember.count({ where: { id: operator.id } })).toBe(1);
  });

  it('does not delete a referenced object and drops an expired unsent address', async () => {
    const subject = await person();
    const request = await prisma.accountDeletionRequest.create({
      data: {
        userId: subject.id,
        status: 'closed',
        closedAt: new Date(),
        completionEmail: subject.email,
        completionEmailExpiresAt: new Date(Date.now() - 1000),
        closureIdempotencyKey: `expired-${subject.id}`,
      },
    });
    const asset = await prisma.mediaAsset.create({
      data: {
        ownerId: subject.id,
        bucket: 'invoices',
        objectKey: `${subject.id}/invoice.pdf`,
        mimeType: 'application/pdf',
        byteSize: 10,
        purpose: 'invoice',
        status: 'ready',
        deletedAt: new Date(),
      },
    });
    const engagement = await prisma.workEngagement.create({
      data: { clientId: subject.id, providerId: (await person()).id, title: 'Paid', status: 'completed', source: 'direct' },
    });
    const payment = await prisma.payment.create({
      data: {
        engagementId: engagement.id,
        payerUserId: subject.id,
        payeeUserId: engagement.providerId,
        amount: '10.00',
        currency: 'SAR',
        method: 'card',
        status: 'succeeded',
        idempotencyKey: `invoice-${subject.id}`,
      },
    });
    await prisma.invoice.create({
      data: {
        engagementId: engagement.id,
        paymentId: payment.id,
        invoiceNumber: `PDF-${subject.id}`,
        currency: 'SAR',
        subtotal: '10.00',
        total: '10.00',
        documentMediaAssetId: asset.id,
        payerDisplayName: 'Payer',
        payeeDisplayName: 'Payee',
        description: 'Paid',
        paymentReference: '',
      },
    });
    await prisma.accountDeletionCleanupTask.create({
      data: { requestId: request.id, userId: subject.id, kind: 'storage_object', bucket: 'invoices', objectKey: asset.objectKey },
    });
    await prisma.accountDeletionCleanupTask.create({
      data: { requestId: request.id, userId: subject.id, kind: 'completion_email' },
    });
    await prisma.accountDeletionCleanupTask.updateMany({
      where: { userId: { not: subject.id }, status: 'pending' },
      data: { nextAttemptAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
    });
    const before = removed.length;
    await runner.runOnce();
    await runner.runOnce();
    expect(removed.length).toBe(before);
    const storage = await prisma.accountDeletionCleanupTask.findFirstOrThrow({
      where: { userId: subject.id, kind: 'storage_object' },
    });
    expect(storage.status).toBe('succeeded');
    expect(storage.lastError).toBe('reference_retained');
    expect((await prisma.mediaAsset.findUniqueOrThrow({ where: { id: asset.id } })).deletedAt).toBeNull();
    const email = await prisma.accountDeletionCleanupTask.findFirstOrThrow({
      where: { userId: subject.id, kind: 'completion_email' },
    });
    expect(email.lastError).toBe('window_elapsed_unsent');
    expect((await prisma.accountDeletionRequest.findUniqueOrThrow({ where: { id: request.id } })).completionEmail).toBeNull();
  });
});
