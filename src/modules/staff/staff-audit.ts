import { StaffAuditAction } from '@prisma/client';

export const AUDIT_GROUPS = ['membership', 'accounts', 'reports', 'moderation', 'invoices', 'work'] as const;
export type AuditGroup = (typeof AUDIT_GROUPS)[number];

const GROUPED: Record<AuditGroup, readonly StaffAuditAction[]> = {
  membership: [
    StaffAuditAction.membership_pending_recorded,
    StaffAuditAction.membership_activated,
    StaffAuditAction.membership_deactivated,
    StaffAuditAction.membership_emergency_deactivated,
    StaffAuditAction.membership_factor_recovery_started,
    StaffAuditAction.membership_reenrollment_permitted,
    StaffAuditAction.membership_readmitted,
  ],
  accounts: [
    StaffAuditAction.account_suspended,
    StaffAuditAction.account_restored,
    StaffAuditAction.account_deleted,
  ],
  reports: [
    StaffAuditAction.report_resolved,
    StaffAuditAction.report_dismissed,
    StaffAuditAction.report_reopened,
  ],
  moderation: [
    StaffAuditAction.post_hidden,
    StaffAuditAction.post_restored,
    StaffAuditAction.comment_hidden,
    StaffAuditAction.comment_restored,
    StaffAuditAction.review_hidden,
    StaffAuditAction.review_restored,
    StaffAuditAction.job_hidden,
    StaffAuditAction.job_restored,
    StaffAuditAction.service_hidden,
    StaffAuditAction.service_restored,
  ],
  invoices: [StaffAuditAction.invoice_retried],
  work: [
    StaffAuditAction.staff_work_closed,
    StaffAuditAction.staff_financial_follow_up_recorded,
    StaffAuditAction.staff_unpaid_work_cancelled,
  ],
};

const LABELS: Record<StaffAuditAction, string> = {
  membership_pending_recorded: 'Invitation recorded',
  membership_activated: 'Membership activated',
  membership_deactivated: 'Membership deactivated',
  membership_emergency_deactivated: 'Emergency deactivation',
  membership_factor_recovery_started: 'Authenticator recovery started',
  membership_reenrollment_permitted: 'Re-enrollment permitted',
  membership_readmitted: 'Membership readmitted',
  account_suspended: 'Account suspended',
  account_restored: 'Account restored',
  account_deleted: 'Account deleted',
  report_resolved: 'Report resolved',
  report_dismissed: 'Report dismissed',
  report_reopened: 'Report reopened',
  post_hidden: 'Post hidden',
  post_restored: 'Post restored',
  comment_hidden: 'Comment hidden',
  comment_restored: 'Comment restored',
  review_hidden: 'Review hidden',
  review_restored: 'Review restored',
  job_hidden: 'Job hidden',
  job_restored: 'Job restored',
  service_hidden: 'Service hidden',
  service_restored: 'Service restored',
  invoice_retried: 'Invoice retry requested',
  staff_work_closed: 'Work closed by Mawahib',
  staff_financial_follow_up_recorded: 'Financial follow-up recorded',
  staff_unpaid_work_cancelled: 'Accepted unpaid work cancelled',
};

export function auditActionsFor(groups: AuditGroup[] | null): StaffAuditAction[] | null {
  if (!groups || groups.length === 0) return null;
  return groups.flatMap((group) => [...GROUPED[group]]);
}

export function auditActionLabel(action: StaffAuditAction): string {
  return LABELS[action];
}

export function actionsMatchingSearch(query: string): StaffAuditAction[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return (Object.keys(LABELS) as StaffAuditAction[]).filter((action) =>
    action.toLowerCase().includes(needle) || LABELS[action].toLowerCase().includes(needle),
  );
}

export type AuditActor =
  | { kind: 'staff'; label: string | null; membershipStatus: string }
  | { kind: 'command'; label: 'Operator command' }
  | { kind: 'unknown'; label: 'Actor unavailable' };

export function auditActor(input: {
  actor: { invitedEmail: string | null; status: string } | null;
  commandRecorded: boolean;
}): AuditActor {
  if (input.actor) {
    const email = input.actor.invitedEmail?.trim() ?? '';
    return {
      kind: 'staff',
      label: email.length > 0 ? email : null,
      membershipStatus: input.actor.status,
    };
  }
  if (input.commandRecorded) return { kind: 'command', label: 'Operator command' };
  return { kind: 'unknown', label: 'Actor unavailable' };
}

export type AuditTargetKind =
  | 'account'
  | 'report'
  | 'post'
  | 'comment'
  | 'review'
  | 'job'
  | 'service'
  | 'invoice'
  | 'engagement'
  | 'staff_membership';

const DETAIL_SCREENS = new Set<AuditTargetKind>(['account', 'report', 'job', 'service', 'engagement']);

export function auditTarget(row: {
  action: StaffAuditAction;
  targetSubjectId: string;
  targetAccountId: string | null;
  targetReportId: string | null;
  targetPostId: string | null;
  targetCommentId: string | null;
  targetReviewId: string | null;
  targetJobListingId: string | null;
  targetServiceOfferingId: string | null;
  targetInvoiceId: string | null;
}): { kind: AuditTargetKind; id: string; hasDetailScreen: boolean } {
  if (row.targetAccountId) return screen('account', row.targetAccountId);
  if (row.targetReportId) return screen('report', row.targetReportId);
  if (row.targetCommentId) return screen('comment', row.targetCommentId);
  if (row.targetPostId) return screen('post', row.targetPostId);
  if (row.targetReviewId) return screen('review', row.targetReviewId);
  if (row.targetJobListingId) return screen('job', row.targetJobListingId);
  if (row.targetServiceOfferingId) return screen('service', row.targetServiceOfferingId);
  if (row.targetInvoiceId) return screen('invoice', row.targetInvoiceId);
  if (GROUPED.membership.includes(row.action)) return screen('staff_membership', row.targetSubjectId);
  if (GROUPED.work.includes(row.action)) return screen('engagement', row.targetSubjectId);
  return screen('staff_membership', row.targetSubjectId);
}

function screen(kind: AuditTargetKind, id: string) {
  return { kind, id, hasDetailScreen: DETAIL_SCREENS.has(kind) };
}
