import { ConnectionRequestStatus } from '@prisma/client';
import {
  activeConnectionWhere,
  activePeers,
  mutualPeerIds,
  planAccept,
  planCreateRequest,
  planTerminal,
  relationshipBetween,
  type EdgeSnap,
  type RequestSnap,
} from './connection-lifecycle';

const A = 'user-a';
const B = 'user-b';

type Edge = EdgeSnap & { userLowId: string; userHighId: string };
type Request = RequestSnap;

function pair(a: string, b: string) {
  return a < b
    ? { userLowId: a, userHighId: b }
    : { userLowId: b, userHighId: a };
}

function graph() {
  const requests: Request[] = [];
  const edges: Edge[] = [];
  let seq = 0;

  const same = (from: string, to: string) =>
    requests.find((row) => row.fromUserId === from && row.toUserId === to) ??
    null;
  const edge = () => {
    const ordered = pair(A, B);
    return (
      edges.find(
        (row) =>
          row.userLowId === ordered.userLowId &&
          row.userHighId === ordered.userHighId,
      ) ?? null
    );
  };

  return {
    requests,
    edges,
    request(from: string, to: string) {
      const plan = planCreateRequest({
        activeConnection: Boolean(edge() && edge()!.endedAt == null),
        reversePending: requests.some(
          (row) =>
            row.fromUserId === to &&
            row.toUserId === from &&
            row.status === ConnectionRequestStatus.pending,
        ),
        sameDirection: same(from, to),
      });
      if (plan.type === 'conflict') return plan;
      if (plan.type === 'reopen') {
        const row = requests.find((item) => item.id === plan.requestId)!;
        row.status = ConnectionRequestStatus.pending;
        return { type: 'ok' as const, id: row.id };
      }
      const row: Request = {
        id: `req-${++seq}`,
        fromUserId: from,
        toUserId: to,
        status: ConnectionRequestStatus.pending,
      };
      requests.push(row);
      return { type: 'ok' as const, id: row.id };
    },
    accept(actorId: string, requestId: string) {
      const request = requests.find((row) => row.id === requestId) ?? null;
      const plan = planAccept({
        actorId,
        request,
        connection: edge(),
      });
      if (plan.type === 'conflict' || plan.type === 'forbidden' || plan.type === 'not_found') {
        return plan;
      }
      if (plan.type === 'idempotent') return { type: 'ok' as const, notify: false, id: plan.connectionId };
      if (request && request.status === ConnectionRequestStatus.pending) {
        request.status = ConnectionRequestStatus.accepted;
        for (const reverse of requests) {
          if (
            reverse.fromUserId === request.toUserId &&
            reverse.toUserId === request.fromUserId &&
            reverse.status === ConnectionRequestStatus.pending
          ) {
            reverse.status = ConnectionRequestStatus.cancelled;
          }
        }
      }
      if (plan.type === 'use_existing') {
        return { type: 'ok' as const, notify: false, id: plan.connectionId };
      }
      if (plan.type === 'reactivate') {
        edge()!.endedAt = null;
        return { type: 'ok' as const, notify: true, id: plan.connectionId };
      }
      const ordered = pair(request!.fromUserId, request!.toUserId);
      const created: Edge = {
        id: `edge-${++seq}`,
        ...ordered,
        endedAt: null,
      };
      edges.push(created);
      return { type: 'ok' as const, notify: true, id: created.id };
    },
    end() {
      const current = edge();
      if (!current || current.endedAt) return 'missing' as const;
      current.endedAt = new Date();
      return 'ended' as const;
    },
  };
}

describe('connection lifecycle', () => {
  it('counts active edges for both users and ignores followersCount', () => {
    const followersCount = { [A]: 0, [B]: 0 };
    const state = graph();
    expect(activePeers(A, state.edges)).toEqual([]);
    expect(activePeers(B, state.edges)).toEqual([]);

    const sent = state.request(A, B);
    expect(sent.type).toBe('ok');
    expect(relationshipBetween(A, B, state.edges, state.requests)).toBe('outgoing');
    expect(relationshipBetween(B, A, state.edges, state.requests)).toBe('incoming');
    expect(activePeers(A, state.edges)).toHaveLength(0);

    const accepted = state.accept(B, (sent as { id: string }).id);
    expect(accepted.type).toBe('ok');
    expect(state.edges.filter((edge) => edge.endedAt == null)).toHaveLength(1);
    expect(activePeers(A, state.edges)).toEqual([B]);
    expect(activePeers(B, state.edges)).toEqual([A]);
    expect(relationshipBetween(A, B, state.edges, state.requests)).toBe('connected');
    expect(relationshipBetween(B, A, state.edges, state.requests)).toBe('connected');
    expect(followersCount[A]).toBe(0);
    expect(followersCount[B]).toBe(0);

    const again = state.accept(B, (sent as { id: string }).id);
    expect(again).toMatchObject({ type: 'ok', notify: false });
    expect(state.edges).toHaveLength(1);
  });

  it('reconnects in either direction by reopening the request and the ended edge', () => {
    const state = graph();
    const first = state.request(A, B) as { id: string };
    state.accept(B, first.id);
    expect(state.end()).toBe('ended');
    expect(activePeers(A, state.edges)).toEqual([]);
    expect(relationshipBetween(A, B, state.edges, state.requests)).toBe('none');

    const sameDirection = state.request(A, B) as { id: string };
    expect(state.requests.filter((row) => row.fromUserId === A)).toHaveLength(1);
    state.accept(B, sameDirection.id);
    expect(state.edges).toHaveLength(1);
    expect(state.edges[0].endedAt).toBeNull();
    expect(activePeers(A, state.edges)).toEqual([B]);
    expect(activePeers(B, state.edges)).toEqual([A]);

    expect(state.end()).toBe('ended');
    const reverse = state.request(B, A) as { id: string };
    expect(state.requests).toHaveLength(2);
    state.accept(A, reverse.id);
    expect(state.edges.filter((edge) => edge.endedAt == null)).toHaveLength(1);
    expect(relationshipBetween(B, A, state.edges, state.requests)).toBe('connected');
    expect(relationshipBetween(A, B, state.edges, state.requests)).toBe('connected');
  });

  it('lets a rejected or cancelled request be sent again', () => {
    const rejected: RequestSnap = {
      id: 'r1',
      fromUserId: A,
      toUserId: B,
      status: ConnectionRequestStatus.rejected,
    };
    expect(
      planCreateRequest({
        activeConnection: false,
        reversePending: false,
        sameDirection: rejected,
      }),
    ).toEqual({ type: 'reopen', requestId: 'r1' });

    const cancelled: RequestSnap = {
      ...rejected,
      status: ConnectionRequestStatus.cancelled,
    };
    expect(
      planCreateRequest({
        activeConnection: false,
        reversePending: false,
        sameDirection: cancelled,
      }).type,
    ).toBe('reopen');
  });

  it('blocks a second pending request and an active connection', () => {
    expect(
      planCreateRequest({
        activeConnection: true,
        reversePending: false,
        sameDirection: null,
      }).type,
    ).toBe('conflict');
    expect(
      planCreateRequest({
        activeConnection: false,
        reversePending: true,
        sameDirection: null,
      }).message,
    ).toMatch(/accept that instead/);
    expect(
      planTerminal({
        actorId: A,
        role: 'recipient',
        request: {
          id: 'r',
          fromUserId: A,
          toUserId: B,
          status: ConnectionRequestStatus.pending,
        },
      }).type,
    ).toBe('forbidden');
  });

  it('returns only active mutual peers and hides everyone else', () => {
    const C = 'user-c';
    const D = 'user-d';
    const E = 'user-e';
    const edge = (
      left: string,
      right: string,
      endedAt: Date | null = null,
    ) => {
      const ordered = pair(left, right);
      return { ...ordered, endedAt };
    };
    const viewerEdges = [edge(A, C), edge(A, D), edge(A, E, new Date())];
    const targetEdges = [edge(B, C), edge(B, E)];
    const mutual = mutualPeerIds(
      A,
      B,
      activePeers(A, viewerEdges),
      activePeers(B, targetEdges),
    );
    expect(mutual).toEqual([C]);
    expect(mutual).not.toContain(D);
    expect(mutual).not.toContain(E);
    expect(mutual).not.toContain(A);
    expect(mutual).not.toContain(B);

    const none = mutualPeerIds(
      A,
      B,
      activePeers(A, [edge(A, C)]),
      activePeers(B, [edge(B, D)]),
    );
    expect(none).toEqual([]);

    const reverse = mutualPeerIds(
      B,
      A,
      activePeers(B, targetEdges),
      activePeers(A, viewerEdges),
    );
    expect(new Set(reverse)).toEqual(new Set(mutual));

    const pendingOnly = mutualPeerIds(A, B, activePeers(A, [edge(A, C)]), []);
    expect(pendingOnly).toEqual([]);
  });

  it('queries both sides of an active edge', () => {
    expect(activeConnectionWhere(A)).toEqual({
      endedAt: null,
      OR: [{ userLowId: A }, { userHighId: A }],
    });
  });
});
