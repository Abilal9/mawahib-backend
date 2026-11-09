import { PrismaMessagingRepository } from './repositories/prisma-messaging.repository';

describe('message read marker SQL', () => {
  function sqlOf(query: TemplateStringsArray, values: unknown[] = []): string {
    const parts = Array.from(query);
    return parts
      .map((part, index) => part + flattenSql(values[index]))
      .join('');
  }

  function flattenSql(value: unknown): string {
    if (value == null) return '';
    if (typeof value === 'string' || typeof value === 'number') return '';
    if (Array.isArray(value)) return value.map(flattenSql).join(' ');
    if (typeof value === 'object' && value !== null && 'strings' in value) {
      const nested = value as { strings: string[]; values?: unknown[] };
      return nested.strings
        .map((part, index) => part + flattenSql(nested.values?.[index]))
        .join('');
    }
    return '';
  }

  it('advances only past the current sequence and never uses the current time', async () => {
    const executeRaw = jest.fn(
      (query: TemplateStringsArray, ..._values: unknown[]) => {
        void _values;
        return Promise.resolve(1);
      },
    );
    const repo = new PrismaMessagingRepository({
      $executeRaw: executeRaw,
    } as never);

    await repo.markParticipantRead('c1', 'u1', 'm-visible');

    const query = executeRaw.mock.calls[0][0] as TemplateStringsArray;
    const values = executeRaw.mock.calls[0].slice(1);
    const sql = sqlOf(query);
    expect(sql).toContain('GREATEST(cp.last_read_at, boundary.created_at)');
    expect(sql).toContain('cp.last_read_sequence < boundary.sequence');
    expect(sql).toContain('boundary.conversation_id');
    expect(sql.toLowerCase()).not.toContain('now()');
    expect(values).toEqual(['m-visible', 'c1', 'u1']);
  });

  it('counts conversations with a later incoming sequence, not individual messages', async () => {
    const queryRaw = jest.fn((query: TemplateStringsArray) => {
      void query;
      return Promise.resolve([{ count: 2 }]);
    });
    const repo = new PrismaMessagingRepository({
      $queryRaw: queryRaw,
    } as never);

    await expect(repo.countUnreadForUser('u1')).resolves.toBe(2);
    const sql = sqlOf(queryRaw.mock.calls[0][0] as TemplateStringsArray);
    expect(sql).toContain('COUNT(*)');
    expect(sql).toContain('m.sequence > cp.last_read_sequence');
    expect(sql).toContain("m.kind = 'user'");
    expect(sql).toContain('m.sender_id <> cp.user_id');
    expect(sql).not.toContain('created_at >');
  });

  it('advances inbox delivery only to the fetched timestamp for that participant', async () => {
    const executeRaw = jest.fn(
      (query: TemplateStringsArray, ..._values: unknown[]) => {
        void _values;
        return Promise.resolve(1);
      },
    );
    const repo = new PrismaMessagingRepository({
      $executeRaw: executeRaw,
    } as never);
    const at = new Date('2026-08-17T12:00:00.000Z');

    await repo.markInboxDelivered('u1', [{ conversationId: 'c1', at }]);

    const query = executeRaw.mock.calls[0][0] as TemplateStringsArray;
    const values = executeRaw.mock.calls[0].slice(1);
    const sql = sqlOf(query);
    expect(sql).toContain('cp.user_id = CAST(');
    expect(sql).toContain('cp.last_delivered_at < src.at');
    expect(sql).not.toContain('last_message_at');
    expect(sql.toLowerCase()).not.toContain('now()');
    const encoded = JSON.stringify(values);
    expect(encoded).toContain('c1');
    expect(encoded).toContain('u1');
    expect(encoded).toContain('2026-08-17');
  });

  it('loads an inbox and a conversation in one query without a clock write', async () => {
    const queryRaw = jest.fn(() => Promise.resolve([]));
    const repo = new PrismaMessagingRepository({
      $queryRaw: queryRaw,
    } as never);

    await repo.listConversationsForUser('u1', undefined, 'inbox');
    await repo.findConversationById('c1');

    const calls = queryRaw.mock.calls as unknown as Array<
      [TemplateStringsArray, ...unknown[]]
    >;
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      const sql = sqlOf(call[0], call.slice(1));
      expect(sql).toContain('last_read_sequence');
      expect(sql).toContain('engagement_reviews');
      expect(sql).toContain('engagement_details');
      expect(sql).toContain('work_requests');
      expect(sql.toLowerCase()).not.toContain('now()');
    }
    const listSql = sqlOf(calls[0][0], calls[0].slice(1));
    expect(listSql).toContain('viewer.archived_at IS NULL');
    const oneSql = sqlOf(calls[1][0], calls[1].slice(1));
    expect(oneSql).toContain('c.id = CAST(');
  });

  it('returns thread attachments in position order without a sender profile', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const repo = new PrismaMessagingRepository({
      message: { findMany },
    } as never);

    await repo.listMessages('c1', { limit: 30 });

    expect(findMany).toHaveBeenCalledWith({
      where: { conversationId: 'c1' },
      include: {
        attachments: {
          include: { mediaAsset: true },
          orderBy: { position: 'asc' },
        },
      },
      orderBy: { sequence: 'desc' },
      take: 30,
    });
  });
});
