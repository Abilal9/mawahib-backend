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
}

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
