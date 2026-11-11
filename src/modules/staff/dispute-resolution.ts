import { WorkEngagementStatus } from '@prisma/client';

export const RESOLUTION_ACTIONS = ['return_to_client_review', 'further_work', 'follow_up'] as const;
export type ResolutionAction = (typeof RESOLUTION_ACTIONS)[number];

export type ResolutionOption = { available: boolean; reason: string | null };

export type ResolutionState = {
  caseStatus: 'open' | 'in_review' | 'closed';
  isLatest: boolean;
  engagementStatus: string;
  engagementDeleted: boolean;
  openedFromStatus: string | null;
  hasDelivery: boolean;
  hasSucceededPayment: boolean;
};

const CLOSED = 'This case is closed. Reopening it does not change the engagement.';
const EARLIER = 'This is an earlier dispute. It cannot change the current episode.';
const DELETED = 'This engagement is deleted.';

export function resolutionOptions(state: ResolutionState): Record<ResolutionAction, ResolutionOption> {
  return {
    return_to_client_review: option(state, 'return_to_client_review'),
    further_work: option(state, 'further_work'),
    follow_up: option(state, 'follow_up'),
  };
}

export function resolutionTarget(action: Exclude<ResolutionAction, 'follow_up'>): WorkEngagementStatus {
  return action === 'return_to_client_review'
    ? WorkEngagementStatus.delivered
    : WorkEngagementStatus.in_progress;
}

export function resolutionRefusal(state: ResolutionState, action: ResolutionAction): { code: string; message: string } | null {
  const reason = blocker(state, action);
  if (!reason) return null;
  return { code: refusalCode(state, action), message: reason };
}

function refusalCode(state: ResolutionState, action: ResolutionAction): string {
  if (state.caseStatus === 'closed') return 'DISPUTE_CASE_CLOSED';
  if (!state.isLatest) return 'DISPUTE_CASE_NOT_LATEST';
  if (state.engagementDeleted) return 'ENGAGEMENT_DELETED';
  if (state.engagementStatus !== WorkEngagementStatus.disputed) return 'ENGAGEMENT_CHANGED';
  if (action !== 'follow_up' && !state.hasSucceededPayment && state.openedFromStatus === WorkEngagementStatus.delivered && state.hasDelivery) {
    return 'PAYMENT_PREREQUISITE';
  }
  return 'RESOLUTION_NOT_SUPPORTED';
}

function option(state: ResolutionState, action: ResolutionAction): ResolutionOption {
  const reason = blocker(state, action);
  return { available: reason == null, reason };
}

function blocker(state: ResolutionState, action: ResolutionAction): string | null {
  if (state.caseStatus === 'closed') return CLOSED;
  if (!state.isLatest) return EARLIER;
  if (state.engagementDeleted) return DELETED;
  if (state.engagementStatus !== WorkEngagementStatus.disputed) {
    return `The engagement is currently ${state.engagementStatus.replaceAll('_', ' ')}. A staff action cannot overwrite that.`;
  }
  if (action === 'follow_up') return null;
  if (state.openedFromStatus !== WorkEngagementStatus.delivered || !state.hasDelivery) {
    return action === 'return_to_client_review'
      ? 'This dispute did not start from a delivery, so it cannot be returned to client review.'
      : 'Further work is only available when this dispute started after a delivery.';
  }
  if (!state.hasSucceededPayment) {
    return 'A succeeded payment is still required. This action does not collect payment or create an invoice.';
  }
  return null;
}
