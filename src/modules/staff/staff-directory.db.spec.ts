import { PrismaClient } from '@prisma/client';
import { AdminReadService } from './admin-read.service';

const databaseUrl = process.env.STAFF_DIRECTORY_DATABASE_URL;

describe('staff directory and audit', () => {
  if (!databaseUrl) {
    it.skip('requires STAFF_DIRECTORY_DATABASE_URL', () => undefined);
    return;
  }
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const admin = new AdminReadService(prisma as never);
  const when = new Date('2026-11-18T09:00:00.000Z');

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('lists every membership state and hides command metadata', async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE staff_audit_events, content_reports, job_listings, staff_members, users CASCADE');
    const deletedId = crypto.randomUUID();
    await prisma.user.create({
      data: {
        id: deletedId,
        email: `${deletedId}@directory.test`,
        accountType: 'talent',
        displayName: 'Old personal name',
        username: `d${deletedId.slice(0, 12)}`,
        deletedAt: when,
      },
    });
    const states = ['pending', 'active', 'inactive', 'recovery'] as const;
    for (const status of states) {
      await prisma.staffMember.create({
        data: {
          issuer: 'https://staff.example/auth/v1',
          subjectId: crypto.randomUUID(),
          status,
          invitedEmail: `${status}@staff.example`,
          ...(status === 'active' ? { linkedProductUserId: deletedId } : {}),
        },
      });
    }
    const unnamedId = crypto.randomUUID();
    await prisma.staffMember.create({
      data: {
        id: unnamedId,
        issuer: 'https://staff.example/auth/v1',
        subjectId: crypto.randomUUID(),
        status: 'active',
        invitedEmail: null,
      },
    });
    const directory = await admin.listStaffDirectory({});
    expect(directory.total).toBe(5);
    expect([...new Set(directory.items.map((item) => item.status))].sort()).toEqual([...states].sort());
    expect(directory.items.some((item) => item.invitedEmail === null)).toBe(true);
    const linked = directory.items.find((item) => item.linkedAccount);
    expect(linked?.linkedAccount).toEqual({ id: deletedId, displayName: 'Deleted user', deleted: true });
    expect(JSON.stringify(directory)).not.toContain('Old personal name');
    expect(JSON.stringify(directory)).not.toContain('subjectId');

    const actor = await prisma.staffMember.findFirstOrThrow({ where: { status: 'inactive' } });
    const jobId = crypto.randomUUID();
    const poster = crypto.randomUUID();
    await prisma.user.create({
      data: { id: poster, email: `${poster}@poster.test`, accountType: 'business', displayName: 'Poster', username: `p${poster.slice(0, 12)}` },
    });
    await prisma.jobListing.create({
      data: { id: jobId, posterId: poster, title: 'Hidden job', location: 'Riyadh', employmentType: 'freelance', status: 'open', deletedAt: when },
    });
    const missingReview = crypto.randomUUID();
    await prisma.staffAuditEvent.create({
      data: {
        action: 'job_hidden',
        targetSubjectId: jobId,
        targetJobListingId: jobId,
        actorStaffMemberId: actor.id,
        actorSubjectId: actor.subjectId,
        reason: '<b>plain</b>',
        createdAt: when,
        unverifiedProcessUser: null,
      },
    });
    await prisma.staffAuditEvent.create({
      data: {
        action: 'membership_activated',
        targetSubjectId: actor.subjectId,
        unverifiedProcessUser: 'local-operator',
        reason: null,
        createdAt: when,
      },
    });
    await prisma.staffAuditEvent.create({
      data: {
        action: 'invoice_retried',
        targetSubjectId: crypto.randomUUID(),
        targetInvoiceId: crypto.randomUUID(),
        createdAt: when,
      },
    });
    await prisma.staffAuditEvent.create({
      data: {
        action: 'review_hidden',
        targetSubjectId: missingReview,
        targetReviewId: missingReview,
        actorStaffMemberId: actor.id,
        createdAt: new Date(when.getTime() - 1000),
      },
    });
    await prisma.staffAuditEvent.create({
      data: {
        action: 'account_suspended',
        targetSubjectId: deletedId,
        targetAccountId: deletedId,
        actorStaffMemberId: actor.id,
        reason: 'Kept for the record',
        createdAt: when,
      },
    });
    const reportId = crypto.randomUUID();
    await prisma.contentReport.create({
      data: { id: reportId, targetType: 'job_listing', targetId: jobId, reason: 'spam', reporterUserId: poster },
    });
    await prisma.staffAuditEvent.create({
      data: {
        action: 'report_resolved',
        targetSubjectId: reportId,
        targetReportId: reportId,
        actorStaffMemberId: actor.id,
        createdAt: when,
      },
    });
    const unnamed = await prisma.staffMember.findUniqueOrThrow({ where: { id: unnamedId } });
    await prisma.staffAuditEvent.create({
      data: {
        action: 'account_restored',
        targetSubjectId: poster,
        targetAccountId: poster,
        actorStaffMemberId: unnamed.id,
        unverifiedProcessUser: 'local-operator',
        reason: null,
        createdAt: when,
      },
    });
    await prisma.staffAuditEvent.create({
      data: {
        action: 'staff_work_closed',
        targetSubjectId: crypto.randomUUID(),
        actorStaffMemberId: actor.id,
        createdAt: when,
      },
    });

    const page = await admin.listStaffAudit({ limit: '2' });
    expect(page.total).toBe(8);
    expect(page.matchCount).toBe(8);
    expect(page.items).toHaveLength(2);
    expect(page.nextCursor).toBeTruthy();
    const rest = await admin.listStaffAudit({ limit: '2', cursor: page.nextCursor! });
    expect(rest.nextCursor).toBeTruthy();
    const last = await admin.listStaffAudit({ limit: '20', cursor: rest.nextCursor! });
    const all = [...page.items, ...rest.items, ...last.items];
    expect(all).toHaveLength(8);
    expect(new Set(all.map((item) => item.id)).size).toBe(8);
    const encoded = JSON.stringify(all);
    expect(encoded).not.toContain('local-operator');
    expect(encoded).not.toContain('Staff operator');
    expect(all.find((item) => item.action === 'account_restored')?.actor).toEqual({
      kind: 'staff',
      label: null,
      membershipStatus: 'active',
    });
    expect(encoded).not.toContain('unverifiedProcessUser');
    expect(all.find((item) => item.action === 'membership_activated')?.actor).toEqual({ kind: 'command', label: 'Operator command' });
    expect(all.find((item) => item.action === 'invoice_retried')?.actor.label).toBe('Actor unavailable');
    expect(all.find((item) => item.action === 'invoice_retried')?.reason).toBeNull();
    const job = all.find((item) => item.action === 'job_hidden');
    expect(job?.actor).toMatchObject({ kind: 'staff', membershipStatus: 'inactive' });
    expect(job?.reason).toBe('<b>plain</b>');
    expect(job?.target).toMatchObject({ kind: 'job', id: jobId, hasDetailScreen: true, presence: 'deleted' });
    expect(all.find((item) => item.action === 'review_hidden')?.target.presence).toBe('missing');
    expect(all.find((item) => item.action === 'account_suspended')?.target).toMatchObject({
      kind: 'account',
      id: deletedId,
      hasDetailScreen: true,
      presence: 'deleted',
    });

    const filtered = await admin.listStaffAudit({ group: 'moderation', q: 'inactive@staff.example' });
    expect(filtered.matchCount).toBe(2);
    expect(filtered.total).toBe(8);
    const byLabel = await admin.listStaffAudit({ q: 'Invoice retry' });
    expect(byLabel.matchCount).toBe(1);
    expect(byLabel.items[0]?.action).toBe('invoice_retried');
    expect(filtered.items.every((item) => item.actor.kind === 'staff')).toBe(true);
  });
});
