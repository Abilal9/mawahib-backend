const STAFF_RESOLUTION_ACTIONS = new Set(['returned_for_client_review', 'further_work_agreed']);

export type BusinessDisputeEnd = {
  kind: 'staff_resolution' | 'participant' | 'unknown';
  actorLabel: string | null;
  by: 'client' | 'provider' | null;
  toStatus: string;
  at: string;
  closedThisCase: boolean;
};

type EngagementEvent = {
  fromStatus: string | null;
  toStatus: string;
  actorId: string | null;
  createdAt: Date;
};

type CaseEvent = {
  action: string;
  actorLabel: string;
  engagementResultingStatus: string | null;
  createdAt: Date;
};

/**
 * Staff attribution comes from the resolution audit on this case.
 * A missing engagement actor is not treated as staff.
 */
export function describeBusinessDisputeEnd(input: {
  caseOpenedAt: Date;
  clientId: string;
  providerId: string;
  engagementEvents: EngagementEvent[];
  caseEvents: CaseEvent[];
}): BusinessDisputeEnd | null {
  const staffResolution = input.caseEvents.find((event) => STAFF_RESOLUTION_ACTIONS.has(event.action));
  const leftDispute = input.engagementEvents.find(
    (event) => event.fromStatus === 'disputed' && event.createdAt >= input.caseOpenedAt,
  );
  if (staffResolution) {
    const toStatus = staffResolution.engagementResultingStatus ?? leftDispute?.toStatus ?? null;
    if (!toStatus) return null;
    return {
      kind: 'staff_resolution',
      actorLabel: staffResolution.actorLabel.trim() || null,
      by: null,
      toStatus,
      at: staffResolution.createdAt.toISOString(),
      closedThisCase: true,
    };
  }
  if (!leftDispute) return null;
  const by =
    leftDispute.actorId === input.clientId
      ? 'client'
      : leftDispute.actorId === input.providerId
        ? 'provider'
        : null;
  if (by) {
    return {
      kind: 'participant',
      actorLabel: null,
      by,
      toStatus: leftDispute.toStatus,
      at: leftDispute.createdAt.toISOString(),
      closedThisCase: false,
    };
  }
  return {
    kind: 'unknown',
    actorLabel: null,
    by: null,
    toStatus: leftDispute.toStatus,
    at: leftDispute.createdAt.toISOString(),
    closedThisCase: false,
  };
}
