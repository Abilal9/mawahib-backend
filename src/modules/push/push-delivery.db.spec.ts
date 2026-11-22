import { PrismaClient } from '@prisma/client';
import { PrismaPushStore } from './prisma-push.store';
import { PUSH_FLAG } from './push-policy';
import { ChatPushSender, PushService } from './push.service';

const databaseUrl = localPushDatabaseUrl(process.env.PUSH_DELIVERY_DATABASE_URL);

function localPushDatabaseUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  let hostname = '';
  try {
    hostname = new URL(value).hostname;
  } catch {
    throw new Error('PUSH_DELIVERY_DATABASE_URL is not a valid database URL.');
  }
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
    throw new Error('PUSH_DELIVERY_DATABASE_URL must point at a local disposable database.');
  }
  return value;
}

describe('chat push delivery on disposable postgres', () => {
  if (!databaseUrl) {
    it.skip('requires PUSH_DELIVERY_DATABASE_URL', () => undefined);
    return;
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const other = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const store = new PrismaPushStore(prisma as never);
  const rival = new PrismaPushStore(other as never);

  beforeAll(async () => {
    process.env[PUSH_FLAG] = 'true';
    await prisma.$connect();
    await other.$connect();
  });

  beforeEach(async () => {
    await prisma.pushDelivery.deleteMany();
    await prisma.pushEpisode.deleteMany();
    await prisma.pushDevice.deleteMany();
  });

  afterAll(async () => {
    delete process.env[PUSH_FLAG];
    await prisma.$disconnect();
    await other.$disconnect();
  });

  async function scene() {
    const sender = await person('Ada');
    const recipient = await person('Bea');
    const conversation = await prisma.conversation.create({
      data: { id: crypto.randomUUID(), type: 'connection' },
    });
    await prisma.conversationParticipant.create({
      data: {
        id: crypto.randomUUID(),
        conversationId: conversation.id,
        userId: recipient.id,
      },
    });
    const message = await prisma.message.create({
      data: {
        id: crypto.randomUUID(),
        conversationId: conversation.id,
        senderId: sender.id,
        kind: 'user',
        body: 'private text that must not be pushed',
        sequence: 1,
      },
    });
    const service = new PushService(store);
    await service.register({
      userId: recipient.id,
      installationId: crypto.randomUUID(),
      expoPushToken: `ExponentPushToken[${crypto.randomUUID().replaceAll('-', '')}]`,
      platform: 'ios',
    });
    return { sender, recipient, conversation, message, service };
  }

  async function person(name: string) {
    const id = crypto.randomUUID();
    return prisma.user.create({
      data: {
        id,
        email: `synthetic-${id}@example.test`,
        accountType: 'talent',
        displayName: name,
        username: `u${id.replaceAll('-', '').slice(0, 20)}`,
      },
    });
  }

  function provider(outcome: 'accepted' | 'retry' | 'unknown' = 'accepted'): ChatPushSender & { bodies: string[] } {
    const bodies: string[] = [];
    return {
      bodies,
      send: async (input) => {
        bodies.push(input.body);
        if (outcome === 'accepted') return { outcome: 'accepted', ticketId: `ticket-${bodies.length}` };
        if (outcome === 'retry') return { outcome: 'retry' };
        return { outcome: 'unknown' };
      },
      receipts: async () => ({}),
    };
  }

  it('keeps one open episode when two messages arrive together', async () => {
    const { sender, recipient, conversation, message, service } = await scene();
    const second = await prisma.message.create({
      data: {
        id: crypto.randomUUID(),
        conversationId: conversation.id,
        senderId: sender.id,
        kind: 'user',
        body: 'second private text',
        sequence: 2,
      },
    });
    const otherService = new PushService(rival);
    await Promise.all([
      service.recordUserMessage({
        conversationId: conversation.id,
        messageId: message.id,
        sequence: 1,
        senderId: sender.id,
        createdAt: message.createdAt,
        recipientIds: [recipient.id],
      }),
      otherService.recordUserMessage({
        conversationId: conversation.id,
        messageId: second.id,
        sequence: 2,
        senderId: sender.id,
        createdAt: second.createdAt,
        recipientIds: [recipient.id],
      }),
    ]);
    const open = await prisma.pushEpisode.count({
      where: { conversationId: conversation.id, status: 'OPEN' },
    });
    const deliveries = await prisma.pushDelivery.count({
      where: { episode: { conversationId: conversation.id } },
    });
    expect(open).toBe(1);
    expect(deliveries).toBe(1);
  });

  it('lets only one worker claim a delivery and recovers a claim after interruption', async () => {
    const { sender, recipient, conversation, message, service } = await scene();
    await service.recordUserMessage({
      conversationId: conversation.id,
      messageId: message.id,
      sequence: 1,
      senderId: sender.id,
      createdAt: message.createdAt,
      recipientIds: [recipient.id],
    });
    const now = new Date();
    const [first, second] = await Promise.all([
      store.claimPending(now, crypto.randomUUID()),
      rival.claimPending(now, crypto.randomUUID()),
    ]);
    const claimed = [first, second].filter((id): id is string => Boolean(id));
    expect(claimed).toHaveLength(1);
    await prisma.pushDelivery.update({
      where: { id: claimed[0] },
      data: { claimToken: crypto.randomUUID(), claimedAt: new Date(now.getTime() - 3 * 60_000), state: 'PENDING' },
    });
    const send = provider();
    await service.processOne(send, now);
    expect(send.bodies).toEqual(['Ada sent you a message.']);
    expect(send.bodies.join(' ')).not.toContain('private');
    const delivery = await prisma.pushDelivery.findUnique({ where: { id: claimed[0] } });
    expect(delivery?.state).toBe('SENT');
    expect(delivery?.ticketId).toBe('ticket-1');
  });

  it('cancels a claimed send when the account reads or the device moves', async () => {
    const readScene = await scene();
    await readScene.service.recordUserMessage({
      conversationId: readScene.conversation.id,
      messageId: readScene.message.id,
      sequence: 1,
      senderId: readScene.sender.id,
      createdAt: readScene.message.createdAt,
      recipientIds: [readScene.recipient.id],
    });
    await prisma.conversationParticipant.updateMany({
      where: { conversationId: readScene.conversation.id, userId: readScene.recipient.id },
      data: { lastReadSequence: 1 },
    });
    const readSender = provider();
    await readScene.service.processOne(readSender);
    expect(readSender.bodies).toEqual([]);
    const readEpisode = await prisma.pushEpisode.findFirst({
      where: { conversationId: readScene.conversation.id },
    });
    expect(readEpisode?.status).toBe('CLOSED');
    expect(readEpisode?.closeReason).toBe('read');

    const moveScene = await scene();
    await moveScene.service.recordUserMessage({
      conversationId: moveScene.conversation.id,
      messageId: moveScene.message.id,
      sequence: 1,
      senderId: moveScene.sender.id,
      createdAt: moveScene.message.createdAt,
      recipientIds: [moveScene.recipient.id],
    });
    const device = await prisma.pushDevice.findFirst({ where: { userId: moveScene.recipient.id } });
    const nextUser = await person('Cleo');
    await moveScene.service.register({
      userId: nextUser.id,
      installationId: device!.installationId,
      expoPushToken: device!.expoPushToken,
      platform: 'ios',
    });
    const moveSender = provider();
    await moveScene.service.processOne(moveSender);
    expect(moveSender.bodies).toEqual([]);
    const moved = await prisma.pushEpisode.findFirst({
      where: { conversationId: moveScene.conversation.id },
    });
    expect(moved?.status).toBe('CLOSED');
  });

  it('stops retrying at the limit, expires old work, and records a receipt', async () => {
    const { sender, recipient, conversation, message, service } = await scene();
    const createdAt = new Date(Date.now() - 20 * 60_000);
    await service.recordUserMessage({
      conversationId: conversation.id,
      messageId: message.id,
      sequence: 1,
      senderId: sender.id,
      createdAt,
      recipientIds: [recipient.id],
      now: new Date(),
    });
    const retry = provider('retry');
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const due = new Date(Date.now() + attempt * 5 * 60_000);
      await prisma.pushDelivery.updateMany({
        where: { episode: { conversationId: conversation.id }, state: 'PENDING' },
        data: { nextAttemptAt: due, expiresAt: new Date(due.getTime() + 60_000) },
      });
      await service.processOne(retry, new Date(due.getTime() + 1000));
    }
    const finished = await prisma.pushDelivery.findFirst({
      where: { episode: { conversationId: conversation.id } },
    });
    expect(finished?.state).toBe('FAILED');
    expect(finished?.attempts).toBeLessThanOrEqual(5);
    const closed = await prisma.pushEpisode.findFirst({
      where: { conversationId: conversation.id },
    });
    expect(closed?.status).toBe('CLOSED');

    const later = await prisma.message.create({
      data: {
        id: crypto.randomUUID(),
        conversationId: conversation.id,
        senderId: sender.id,
        kind: 'user',
        body: 'later private text',
        sequence: 8,
      },
    });
    await service.recordUserMessage({
      conversationId: conversation.id,
      messageId: later.id,
      sequence: 8,
      senderId: sender.id,
      createdAt: new Date(),
      recipientIds: [recipient.id],
    });
    expect(
      await prisma.pushEpisode.count({ where: { conversationId: conversation.id, status: 'OPEN' } }),
    ).toBe(1);

    const expired = await scene();
    await expired.service.recordUserMessage({
      conversationId: expired.conversation.id,
      messageId: expired.message.id,
      sequence: 1,
      senderId: expired.sender.id,
      createdAt: new Date(Date.now() - 31 * 60_000),
      recipientIds: [expired.recipient.id],
      now: new Date(Date.now() - 31 * 60_000),
    });
    await prisma.pushDelivery.updateMany({
      where: { episode: { conversationId: expired.conversation.id } },
      data: { expiresAt: new Date(Date.now() - 1000), nextAttemptAt: new Date(Date.now() - 1000) },
    });
    await expired.service.processOne(provider());
    expect(
      (await prisma.pushDelivery.findFirst({ where: { episode: { conversationId: expired.conversation.id } } }))
        ?.state,
    ).toBe('EXPIRED');

    const receiptScene = await scene();
    await receiptScene.service.recordUserMessage({
      conversationId: receiptScene.conversation.id,
      messageId: receiptScene.message.id,
      sequence: 1,
      senderId: receiptScene.sender.id,
      createdAt: receiptScene.message.createdAt,
      recipientIds: [receiptScene.recipient.id],
    });
    const accepted = provider();
    await prisma.pushDelivery.updateMany({
      where: {
        state: 'PENDING',
        episode: { conversationId: { not: receiptScene.conversation.id } },
      },
      data: { nextAttemptAt: new Date(Date.now() + 24 * 60 * 60_000) },
    });
    await receiptScene.service.processOne(accepted);
    await prisma.pushDelivery.updateMany({
      where: { episode: { conversationId: receiptScene.conversation.id } },
      data: { receiptCheckAt: new Date(Date.now() - 1000) },
    });
    await receiptScene.service.processReceipts({
      send: accepted.send,
      receipts: async (ids) => Object.fromEntries(ids.map((id) => [id, { status: 'ok' as const }])),
    });
    expect(
      (await prisma.pushDelivery.findFirst({ where: { episode: { conversationId: receiptScene.conversation.id } } }))
        ?.state,
    ).toBe('RECEIPT_OK');
    expect(
      (await prisma.pushEpisode.findFirst({ where: { conversationId: receiptScene.conversation.id } }))?.status,
    ).toBe('OPEN');
  });

  it('keeps the message when creating the push job fails', async () => {
    const { sender, recipient, conversation, message } = await scene();
    const before = await prisma.message.count({ where: { id: message.id } });
    const service = new PushService(store);
    await service.recordUserMessage({
      conversationId: conversation.id,
      messageId: crypto.randomUUID(),
      sequence: 4,
      senderId: sender.id,
      createdAt: new Date(),
      recipientIds: [recipient.id],
    });
    expect(await prisma.message.count({ where: { id: message.id } })).toBe(before);
    expect(await prisma.message.findUnique({ where: { id: message.id } })).toMatchObject({
      body: 'private text that must not be pushed',
    });
  });
});
