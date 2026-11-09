import { PrismaMessagingRepository } from './repositories/prisma-messaging.repository';

describe('message read marker SQL', () => {
  function sqlOf(query: TemplateStringsArray): string {
    return Array.from(query).join(' ');
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
});
