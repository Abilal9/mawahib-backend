import {
  Connection,
  ConnectionRequest,
  ConnectionRequestStatus,
  Profile,
  User,
} from '@prisma/client';

export type UserSummary = User & { profile: Profile | null };

export type ConnectionRequestWithUsers = ConnectionRequest & {
  fromUser: UserSummary;
  toUser: UserSummary;
};

export type ConnectionWithUsers = Connection & {
  userLow: UserSummary;
  userHigh: UserSummary;
  conversation: { id: string } | null;
};

export interface CreateConnectionRequestInput {
  id: string;
  fromUserId: string;
  toUserId: string;
  message: string;
}

export interface CreateConnectionInput {
  id: string;
  userLowId: string;
  userHighId: string;
}

export interface ConnectionsRepository {
  createRequest(
    input: CreateConnectionRequestInput,
  ): Promise<ConnectionRequestWithUsers>;
  findRequestById(id: string): Promise<ConnectionRequestWithUsers | null>;
  findPendingBetween(
    fromUserId: string,
    toUserId: string,
  ): Promise<ConnectionRequest | null>;
  listRequestsForUser(
    userId: string,
    direction: 'incoming' | 'outgoing' | 'all',
  ): Promise<ConnectionRequestWithUsers[]>;
  updateRequestStatus(
    id: string,
    status: ConnectionRequestStatus,
  ): Promise<ConnectionRequestWithUsers>;
  cancelReversePending(fromUserId: string, toUserId: string): Promise<number>;
  findActiveConnection(
    userLowId: string,
    userHighId: string,
  ): Promise<Connection | null>;
  createConnection(input: CreateConnectionInput): Promise<ConnectionWithUsers>;
  listConnectionsForUser(userId: string): Promise<ConnectionWithUsers[]>;
  findConnectionBetween(
    userA: string,
    userB: string,
  ): Promise<ConnectionWithUsers | null>;
  endConnection(id: string, endedAt: Date): Promise<ConnectionWithUsers>;
  submitRequest(
    input: CreateConnectionRequestInput,
  ): Promise<SubmitRequestResult>;
  acceptPending(input: {
    requestId: string;
    actorId: string;
  }): Promise<AcceptPendingResult>;
  rejectPending(input: {
    requestId: string;
    actorId: string;
  }): Promise<TerminalRequestResult>;
  cancelPending(input: {
    requestId: string;
    actorId: string;
  }): Promise<TerminalRequestResult>;
  endActiveConnection(
    userId: string,
    peerUserId: string,
  ): Promise<'missing' | 'ended'>;
  /** Active peer ids only. Does not hydrate user rows. */
  listActivePeerIds(userId: string): Promise<string[]>;
  /**
   * Public connection cards for the given ids. Soft-deleted users are omitted.
   * Selects summary fields only — never email or phone.
   */
  listPublicConnectionUsers(ids: string[]): Promise<PublicConnectionUser[]>;
}

export type PublicConnectionUser = {
  id: string;
  displayName: string;
  username: string;
  isVerified: boolean;
  avatarUrl: string | null;
  title: string | null;
};

export type SubmitRequestResult =
  | { kind: 'conflict'; message: string }
  | { kind: 'ok'; request: ConnectionRequestWithUsers };

export type AcceptPendingResult =
  | { kind: 'not_found' }
  | { kind: 'forbidden' }
  | { kind: 'conflict'; message: string }
  | { kind: 'ok'; connection: ConnectionWithUsers; notify: boolean };

export type TerminalRequestResult =
  | { kind: 'not_found' }
  | { kind: 'forbidden' }
  | { kind: 'conflict'; message: string }
  | { kind: 'ok' };

export const CONNECTIONS_REPOSITORY = Symbol('CONNECTIONS_REPOSITORY');

/** Lexicographic UUID ordering for undirected Connection edges. */
export function orderedPair(
  a: string,
  b: string,
): { userLowId: string; userHighId: string } {
  return a < b
    ? { userLowId: a, userHighId: b }
    : { userLowId: b, userHighId: a };
}
