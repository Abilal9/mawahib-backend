import {
  JobApplicationStatus,
  JobListingStatus,
  WorkEngagementStatus,
  WorkRequestStatus,
} from '@prisma/client';
import { BadRequestException } from '@nestjs/common';

const LISTING_TRANSITIONS: Record<JobListingStatus, JobListingStatus[]> = {
  [JobListingStatus.draft]: [JobListingStatus.open],
  [JobListingStatus.open]: [
    JobListingStatus.archived,
    JobListingStatus.closed,
    JobListingStatus.in_progress,
    JobListingStatus.expired,
  ],
  [JobListingStatus.archived]: [JobListingStatus.open],
  [JobListingStatus.closed]: [JobListingStatus.open],
  [JobListingStatus.in_progress]: [
    JobListingStatus.completed,
    JobListingStatus.closed,
  ],
  [JobListingStatus.completed]: [],
  [JobListingStatus.expired]: [JobListingStatus.open],
};

const APPLICATION_TRANSITIONS: Record<
  JobApplicationStatus,
  JobApplicationStatus[]
> = {
  [JobApplicationStatus.submitted]: [
    JobApplicationStatus.under_review,
    JobApplicationStatus.accepted,
    JobApplicationStatus.rejected,
    JobApplicationStatus.withdrawn,
  ],
  [JobApplicationStatus.under_review]: [
    JobApplicationStatus.accepted,
    JobApplicationStatus.rejected,
    JobApplicationStatus.withdrawn,
  ],
  [JobApplicationStatus.accepted]: [],
  [JobApplicationStatus.rejected]: [],
  [JobApplicationStatus.withdrawn]: [],
};

const ENGAGEMENT_TRANSITIONS: Record<
  WorkEngagementStatus,
  WorkEngagementStatus[]
> = {
  [WorkEngagementStatus.requested]: [
    WorkEngagementStatus.accepted,
    WorkEngagementStatus.declined,
    WorkEngagementStatus.cancelled,
  ],
  [WorkEngagementStatus.accepted]: [
    WorkEngagementStatus.pending_payment,
    WorkEngagementStatus.in_progress,
    WorkEngagementStatus.cancelled,
  ],
  [WorkEngagementStatus.declined]: [],
  [WorkEngagementStatus.cancelled]: [],
  [WorkEngagementStatus.pending_payment]: [
    WorkEngagementStatus.in_progress,
    WorkEngagementStatus.cancelled,
    WorkEngagementStatus.payment_failed,
  ],
  [WorkEngagementStatus.payment_failed]: [
    WorkEngagementStatus.pending_payment,
    WorkEngagementStatus.cancelled,
  ],
  [WorkEngagementStatus.in_progress]: [
    WorkEngagementStatus.delivered,
    WorkEngagementStatus.cancelled,
  ],
  [WorkEngagementStatus.delivered]: [
    WorkEngagementStatus.completed,
    WorkEngagementStatus.disputed,
  ],
  [WorkEngagementStatus.disputed]: [
    WorkEngagementStatus.completed,
    WorkEngagementStatus.cancelled,
  ],
  [WorkEngagementStatus.completed]: [],
};

/**
 * Work request negotiation. `pending_payment` is the accepted terminal state —
 * money is Phase 5, so nothing here moves an engagement into active work.
 *
 * `changes_declined` is NOT terminal: the sender declined a proposal and the
 * recipient can accept original terms, propose again, or reject the request.
 */
const WORK_REQUEST_TRANSITIONS: Record<WorkRequestStatus, WorkRequestStatus[]> =
  {
    [WorkRequestStatus.pending]: [
      WorkRequestStatus.changes_requested,
      WorkRequestStatus.pending_payment,
      WorkRequestStatus.rejected,
      WorkRequestStatus.withdrawn,
    ],
    [WorkRequestStatus.changes_requested]: [
      WorkRequestStatus.pending_payment,
      WorkRequestStatus.changes_declined,
      // Proposer cancels their own outstanding proposal → prior open state.
      WorkRequestStatus.pending,
      WorkRequestStatus.rejected,
      WorkRequestStatus.withdrawn,
    ],
    [WorkRequestStatus.changes_declined]: [
      WorkRequestStatus.changes_requested,
      WorkRequestStatus.pending_payment,
      WorkRequestStatus.rejected,
      WorkRequestStatus.withdrawn,
    ],
    [WorkRequestStatus.pending_payment]: [],
    [WorkRequestStatus.rejected]: [],
    [WorkRequestStatus.withdrawn]: [],
  };

export function assertListingTransition(
  from: JobListingStatus,
  to: JobListingStatus,
): void {
  if (!LISTING_TRANSITIONS[from]?.includes(to)) {
    throw new BadRequestException(
      `Invalid listing transition: ${from} → ${to}`,
    );
  }
}

export function assertApplicationTransition(
  from: JobApplicationStatus,
  to: JobApplicationStatus,
): void {
  if (!APPLICATION_TRANSITIONS[from]?.includes(to)) {
    throw new BadRequestException(
      `Invalid application transition: ${from} → ${to}`,
    );
  }
}

export function assertEngagementTransition(
  from: WorkEngagementStatus,
  to: WorkEngagementStatus,
): void {
  if (!ENGAGEMENT_TRANSITIONS[from]?.includes(to)) {
    throw new BadRequestException(
      `Invalid engagement transition: ${from} → ${to}`,
    );
  }
}

/**
 * Party-callable engagement transitions (JWT user API).
 * Payment settle / fail / dispute / start-work are server-only (Phase 5+).
 *
 * - Provider: deliver in-progress work
 * - Client: confirm completion; cancel only before work starts
 */
const CLIENT_ENGAGEMENT_TRANSITIONS: Partial<
  Record<WorkEngagementStatus, WorkEngagementStatus[]>
> = {
  [WorkEngagementStatus.requested]: [WorkEngagementStatus.cancelled],
  [WorkEngagementStatus.accepted]: [WorkEngagementStatus.cancelled],
  [WorkEngagementStatus.pending_payment]: [WorkEngagementStatus.cancelled],
  [WorkEngagementStatus.payment_failed]: [WorkEngagementStatus.cancelled],
  [WorkEngagementStatus.delivered]: [WorkEngagementStatus.completed],
};

const PROVIDER_ENGAGEMENT_TRANSITIONS: Partial<
  Record<WorkEngagementStatus, WorkEngagementStatus[]>
> = {
  [WorkEngagementStatus.in_progress]: [WorkEngagementStatus.delivered],
};

export function engagementPartyMayTransition(
  from: WorkEngagementStatus,
  to: WorkEngagementStatus,
  role: 'client' | 'provider',
): boolean {
  const allowed =
    role === 'client'
      ? CLIENT_ENGAGEMENT_TRANSITIONS[from]
      : PROVIDER_ENGAGEMENT_TRANSITIONS[from];
  return allowed?.includes(to) ?? false;
}

export function assertEngagementPartyTransition(
  from: WorkEngagementStatus,
  to: WorkEngagementStatus,
  isClient: boolean,
  isProvider: boolean,
): void {
  assertEngagementTransition(from, to);
  const allowed =
    (isClient && engagementPartyMayTransition(from, to, 'client')) ||
    (isProvider && engagementPartyMayTransition(from, to, 'provider'));
  if (!allowed) {
    throw new BadRequestException(
      `You are not allowed to move this engagement from ${from} to ${to}`,
    );
  }
}

export function assertWorkRequestTransition(
  from: WorkRequestStatus,
  to: WorkRequestStatus,
): void {
  if (!WORK_REQUEST_TRANSITIONS[from]?.includes(to)) {
    throw new BadRequestException(
      `Invalid work request transition: ${from} → ${to}`,
    );
  }
}

export const OPEN_APPLICATION_STATUSES: JobApplicationStatus[] = [
  JobApplicationStatus.submitted,
  JobApplicationStatus.under_review,
];

/** Work request states that can still be negotiated. */
export const OPEN_WORK_REQUEST_STATUSES: WorkRequestStatus[] = [
  WorkRequestStatus.pending,
  WorkRequestStatus.changes_requested,
  WorkRequestStatus.changes_declined,
];
