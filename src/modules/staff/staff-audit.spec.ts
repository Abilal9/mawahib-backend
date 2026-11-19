import { StaffAuditAction } from '@prisma/client';
import { auditActor, auditTarget } from './staff-audit';

describe('staff audit attribution and targets', () => {
  it('names recorded staff, confirmed commands, and unknown actors differently', () => {
    expect(auditActor({
      actor: { invitedEmail: 'operator@example.com', status: 'inactive' },
      commandRecorded: true,
    })).toEqual({ kind: 'staff', label: 'operator@example.com', membershipStatus: 'inactive' });
    expect(auditActor({ actor: null, commandRecorded: true }).label).toBe('Operator command');
    expect(auditActor({ actor: null, commandRecorded: false })).toEqual({
      kind: 'unknown',
      label: 'Actor unavailable',
    });
    expect(auditActor({
      actor: { invitedEmail: '  ', status: 'active' },
      commandRecorded: true,
    })).toEqual({ kind: 'staff', label: null, membershipStatus: 'active' });
  });

  it('keeps a deleted job linkable and leaves reviews without a detail screen', () => {
    const job = auditTarget({
      action: StaffAuditAction.job_hidden,
      targetSubjectId: 'job-1',
      targetAccountId: null,
      targetReportId: null,
      targetPostId: null,
      targetCommentId: null,
      targetReviewId: null,
      targetJobListingId: 'job-1',
      targetServiceOfferingId: null,
      targetInvoiceId: null,
    });
    expect(job).toMatchObject({ kind: 'job', hasDetailScreen: true });
    const review = auditTarget({
      action: StaffAuditAction.review_hidden,
      targetSubjectId: 'review-1',
      targetAccountId: null,
      targetReportId: null,
      targetPostId: null,
      targetCommentId: null,
      targetReviewId: 'review-1',
      targetJobListingId: null,
      targetServiceOfferingId: null,
      targetInvoiceId: null,
    });
    expect(review.hasDetailScreen).toBe(false);
  });
});
