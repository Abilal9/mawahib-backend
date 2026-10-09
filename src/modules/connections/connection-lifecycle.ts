import { ConnectionRequestStatus, Prisma } from '@prisma/client';

/** Active undirected edges for a user. Not `followersCount`. */
export function activeConnectionWhere(
  userId: string,
): Prisma.ConnectionWhereInput {
  return {
    endedAt: null,
    OR: [{ userLowId: userId }, { userHighId: userId }],
  };
}

export function peerUserId(
  edge: { userLowId: string; userHighId: string },
  viewerId: string,
): string {
  return edge.userLowId === viewerId ? edge.userHighId : edge.userLowId;
}

export type RequestSnap = {
  id: string;
  fromUserId: string;
  toUserId: string;
  status: ConnectionRequestStatus;
};

export type EdgeSnap = {
  id: string;
  endedAt: Date | null;
};

export type CreatePlan =
  | { type: 'conflict'; message: string }
  | { type: 'create' }
  | { type: 'reopen'; requestId: string };

export function planCreateRequest(input: {
  activeConnection: boolean;
  reversePending: boolean;
  sameDirection: RequestSnap | null;
}): CreatePlan {
  if (input.activeConnection) {
    return { type: 'conflict', message: 'Already connected' };
  }
  if (input.reversePending) {
    return {
      type: 'conflict',
      message:
        'A reverse connection request is already pending — accept that instead',
    };
  }
  if (!input.sameDirection) return { type: 'create' };
  if (input.sameDirection.status === ConnectionRequestStatus.pending) {
    return { type: 'conflict', message: 'Connection request already pending' };
  }
  return { type: 'reopen', requestId: input.sameDirection.id };
}

export type AcceptPlan =
  | { type: 'not_found' }
  | { type: 'forbidden' }
  | { type: 'conflict'; message: string }
  | { type: 'idempotent'; connectionId: string }
  | { type: 'use_existing'; connectionId: string }
  | { type: 'create' }
  | { type: 'reactivate'; connectionId: string };

/**
 * Accept is idempotent when this request is already accepted and the edge is
 * active. A second tap returns the same edge and must not notify again.
 */
export function planAccept(input: {
  actorId: string;
  request: RequestSnap | null;
  connection: EdgeSnap | null;
}): AcceptPlan {
  if (!input.request) return { type: 'not_found' };
  if (input.request.toUserId !== input.actorId) return { type: 'forbidden' };

  const active = Boolean(input.connection && input.connection.endedAt == null);
  if (
    input.request.status === ConnectionRequestStatus.accepted &&
    active &&
    input.connection
  ) {
    return { type: 'idempotent', connectionId: input.connection.id };
  }
  if (input.request.status !== ConnectionRequestStatus.pending) {
    return { type: 'conflict', message: 'Request is no longer pending' };
  }
  if (active && input.connection) {
    return { type: 'use_existing', connectionId: input.connection.id };
  }
  if (input.connection) {
    return { type: 'reactivate', connectionId: input.connection.id };
  }
  return { type: 'create' };
}

export function planTerminal(input: {
  actorId: string;
  role: 'recipient' | 'sender';
  request: RequestSnap | null;
}):
  | { type: 'not_found' }
  | { type: 'forbidden' }
  | { type: 'conflict'; message: string }
  | { type: 'ok' } {
  if (!input.request) return { type: 'not_found' };
  const owner =
    input.role === 'recipient'
      ? input.request.toUserId
      : input.request.fromUserId;
  if (owner !== input.actorId) return { type: 'forbidden' };
  if (input.request.status !== ConnectionRequestStatus.pending) {
    return { type: 'conflict', message: 'Request is no longer pending' };
  }
  return { type: 'ok' };
}

export type RelationshipView = 'none' | 'outgoing' | 'incoming' | 'connected';

export function relationshipBetween(
  viewerId: string,
  otherId: string,
  edges: Array<{ userLowId: string; userHighId: string; endedAt: Date | null }>,
  requests: Array<{
    fromUserId: string;
    toUserId: string;
    status: ConnectionRequestStatus;
  }>,
): RelationshipView {
  const active = edges.some(
    (edge) =>
      edge.endedAt == null &&
      ((edge.userLowId === viewerId && edge.userHighId === otherId) ||
        (edge.userLowId === otherId && edge.userHighId === viewerId)),
  );
  if (active) return 'connected';
  const pending = requests.filter(
    (request) => request.status === ConnectionRequestStatus.pending,
  );
  if (
    pending.some(
      (request) =>
        request.fromUserId === viewerId && request.toUserId === otherId,
    )
  ) {
    return 'outgoing';
  }
  if (
    pending.some(
      (request) =>
        request.fromUserId === otherId && request.toUserId === viewerId,
    )
  ) {
    return 'incoming';
  }
  return 'none';
}

export function activePeers(
  userId: string,
  edges: Array<{ userLowId: string; userHighId: string; endedAt: Date | null }>,
): string[] {
  return edges
    .filter(
      (edge) =>
        edge.endedAt == null &&
        (edge.userLowId === userId || edge.userHighId === userId),
    )
    .map((edge) => peerUserId(edge, userId));
}

/**
 * Active peers shared by the viewer and the profile being viewed.
 * Pending requests are not inputs: only active edge peer ids belong here.
 * The viewer and the target are never returned.
 */
export function mutualPeerIds(
  viewerId: string,
  targetId: string,
  viewerPeers: string[],
  targetPeers: string[],
): string[] {
  const target = new Set(targetPeers);
  const seen = new Set<string>();
  const mutual: string[] = [];
  for (const peerId of viewerPeers) {
    if (peerId === viewerId || peerId === targetId) continue;
    if (!target.has(peerId) || seen.has(peerId)) continue;
    seen.add(peerId);
    mutual.push(peerId);
  }
  return mutual;
}
