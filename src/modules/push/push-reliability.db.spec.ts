import { PrismaClient } from '@prisma/client';
import { PrismaMessagingRepository } from '../messaging/repositories/prisma-messaging.repository';
import { PrismaPushStore } from './prisma-push.store';
import { PUSH_FLAG, DELIVERY_TTL_MS } from './push-policy';
import { PushService } from './push.service';

const databaseUrl = localUrl(process.env.PUSH_DELIVERY_DATABASE_URL);

function localUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const hostname = new URL(value).hostname;
  if (hostname !== '127.0.0.1' && hostname !== 'localhost') {
    throw new Error('PUSH_DELIVERY_DATABASE_URL must point at a local disposable database.');
  }
  return value;
}

describe('chat push outbox and detach on disposable postgres', () => {
  if (!databaseUrl) {
    it.skip('requires PUSH_DELIVERY_DATABASE_URL', () => undefined);
    return;
  }

  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const other = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  const repo = new PrismaMessagingRepository(prisma as never);
  const store = new PrismaPushStore(prisma as never);
  const rival = new PrismaPushStore(other as never);
  const service = new PushService(store);

  beforeAll(async () => {
    process.env[PUSH_FLAG] = 'true';
    await prisma.$connect();
    await other.$connect();
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION push_outbox_fail() RETURNS trigger AS $$
      BEGIN
        IF NEW.sender_id = '00000000-0000-4000-8000-000000000099' THEN
          RAISE EXCEPTION 'outbox failed';
        END IF;
        RETURN NEW;
      END $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS push_outbox_fail ON push_outbox`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER push_outbox_fail
      BEFORE INSERT ON push_outbox
      FOR EACH ROW EXECUTE FUNCTION push_outbox_fail()
    `);
  });

  afterAll(async () => {
    delete process.env[PUSH_FLAG];
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS push_outbox_fail ON push_outbox`);
    await prisma.$disconnect();
    await other.$disconnect();
  });

  beforeEach(async () => {
    await prisma.pushDelivery.deleteMany();
    await prisma.pushEpisode.deleteMany();
    await prisma.pushOutbox.deleteMany();
    await prisma.pushDevice.deleteMany();
  });

  async function person(name: string, id = crypto.randomUUID()) {
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

  it('commits the message and outbox together and rolls both back when the outbox insert fails', async () => {
    const sender = await person('Ada');
    const conversation = await prisma.conversation.create({
      data: { id: crypto.randomUUID(), type: 'connection' },
    });
    const message = await repo.createMessage(
      {
        id: crypto.randomUUID(),
        conversationId: conversation.id,
        senderId: sender.id,
        kind: 'user',
        body: 'private text',
        clientMessageId: 'client-1',
      },
      { id: crypto.randomUUID() },
    );
    expect(await prisma.pushOutbox.findUnique({ where: { messageId: message.id } })).toMatchObject({
      messageCreatedAt: message.createdAt,
      status: 'pending',
    });

    const failingSender = await person('Fail', '00000000-0000-4000-8000-000000000099');
    const failingConversation = await prisma.conversation.create({
      data: { id: crypto.randomUUID(), type: 'connection' },
    });
    const failingId = crypto.randomUUID();
    await expect(
      repo.createMessage(
        {
          id: failingId,
          conversationId: failingConversation.id,
          senderId: failingSender.id,
          kind: 'user',
          body: 'should roll back',
          clientMessageId: 'client-fail',
        },
        { id: crypto.randomUUID() },
      ),
    ).rejects.toThrow('outbox failed');
    expect(await prisma.message.findUnique({ where: { id: failingId } })).toBeNull();
  });

  it('repairs one fresh missing outbox row and skips a stale one', async () => {
    const sender = await person('Ada');
    const conversation = await prisma.conversation.create({
      data: { id: crypto.randomUUID(), type: 'connection' },
    });
    const fresh = await repo.createMessage({
      id: crypto.randomUUID(),
      conversationId: conversation.id,
      senderId: sender.id,
      kind: 'user',
      body: 'private',
      clientMessageId: 'fresh',
    });
    await service.repairOutbox({
      callerId: sender.id,
      messageId: fresh.id,
      conversationId: conversation.id,
      senderId: sender.id,
      messageCreatedAt: fresh.createdAt,
    });
    expect(await prisma.pushOutbox.count({ where: { messageId: fresh.id } })).toBe(1);
    await service.repairOutbox({
      callerId: sender.id,
      messageId: fresh.id,
      conversationId: conversation.id,
      senderId: sender.id,
      messageCreatedAt: fresh.createdAt,
    });
    expect(await prisma.pushOutbox.count({ where: { messageId: fresh.id } })).toBe(1);

    const otherConversation = await prisma.conversation.create({
      data: { id: crypto.randomUUID(), type: 'connection' },
    });
    const stale = await repo.createMessage({
      id: crypto.randomUUID(),
      conversationId: otherConversation.id,
      senderId: sender.id,
      kind: 'user',
      body: 'old',
      clientMessageId: 'stale',
    });
    await service.repairOutbox({
      callerId: 'someone-else',
      messageId: stale.id,
      conversationId: otherConversation.id,
      senderId: sender.id,
      messageCreatedAt: stale.createdAt,
    });
    await service.repairOutbox({
      callerId: sender.id,
      messageId: stale.id,
      conversationId: otherConversation.id,
      senderId: sender.id,
      messageCreatedAt: new Date(Date.now() - DELIVERY_TTL_MS - 1000),
    });
    expect(await prisma.pushOutbox.count({ where: { messageId: stale.id } })).toBe(0);
  });

  it('recovers one outbox claim and skips an expired message without restarting the clock', async () => {
    const sender = await person('Ada');
    const recipient = await person('Bea');
    const conversation = await prisma.conversation.create({
      data: { id: crypto.randomUUID(), type: 'connection' },
    });
    await prisma.conversationParticipant.create({
      data: { id: crypto.randomUUID(), conversationId: conversation.id, userId: recipient.id },
    });
    const createdAt = new Date(Date.now() - 31 * 60_000);
    const message = await prisma.message.create({
      data: {
        id: crypto.randomUUID(),
        conversationId: conversation.id,
        senderId: sender.id,
        kind: 'user',
        body: 'private',
        sequence: 1,
        createdAt,
      },
    });
    await prisma.pushOutbox.create({
      data: {
        id: crypto.randomUUID(),
        messageId: message.id,
        conversationId: conversation.id,
        senderId: sender.id,
        messageCreatedAt: createdAt,
        nextAttemptAt: createdAt,
      },
    });
    await service.register({
      userId: recipient.id,
      installationId: crypto.randomUUID(),
      expoPushToken: `ExponentPushToken[${crypto.randomUUID().replaceAll('-', '')}]`,
      platform: 'ios',
    });
    expect(await service.processOutbox(new Date())).toBe('handled');
    expect(await prisma.pushOutbox.findFirst({ where: { messageId: message.id } })).toMatchObject({
      status: 'skipped',
    });
    expect(await prisma.pushDelivery.count()).toBe(0);

    const liveAt = new Date();
    const live = await prisma.message.create({
      data: {
        id: crypto.randomUUID(),
        conversationId: conversation.id,
        senderId: sender.id,
        kind: 'user',
        body: 'live private',
        sequence: 2,
        createdAt: liveAt,
      },
    });
    await prisma.pushOutbox.create({
      data: {
        id: crypto.randomUUID(),
        messageId: live.id,
        conversationId: conversation.id,
        senderId: sender.id,
        messageCreatedAt: liveAt,
        nextAttemptAt: liveAt,
      },
    });
    const [first, second] = await Promise.all([
      store.claimOutbox(new Date(), crypto.randomUUID()),
      rival.claimOutbox(new Date(), crypto.randomUUID()),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
    await prisma.pushOutbox.updateMany({
      where: { messageId: live.id },
      data: { claimToken: null, claimedAt: null, status: 'pending' },
    });
    expect(await service.processOutbox(new Date())).toBe('handled');
    const delivery = await prisma.pushDelivery.findFirst({
      where: { episode: { openingMessageId: live.id } },
    });
    expect(delivery?.expiresAt.getTime()).toBe(liveAt.getTime() + DELIVERY_TTL_MS);
    expect(await prisma.message.findUnique({ where: { id: live.id } })).toMatchObject({
      body: 'live private',
    });
  });

  it('rejects a forged or stale detach and keeps a newer registration', async () => {
    const first = await person('Ada');
    const second = await person('Bea');
    const installationId = crypto.randomUUID();
    const token = `ExponentPushToken[${crypto.randomUUID().replaceAll('-', '')}]`;
    const original = await service.register({
      userId: first.id,
      installationId,
      expoPushToken: token,
      platform: 'ios',
    });
    await service.detach({
      installationId,
      registrationGeneration: original.registrationGeneration,
      detachSecret: 'not-the-secret',
    });
    expect((await prisma.pushDevice.findUnique({ where: { installationId } }))?.invalidatedAt).toBeNull();

    const replacement = await service.register({
      userId: second.id,
      installationId,
      expoPushToken: token,
      platform: 'ios',
    });
    await service.detach({
      installationId,
      registrationGeneration: original.registrationGeneration,
      detachSecret: original.detachSecret,
    });
    const device = await prisma.pushDevice.findUnique({ where: { installationId } });
    expect(device?.userId).toBe(second.id);
    expect(device?.invalidatedAt).toBeNull();
    expect(device?.registrationGeneration).toBe(replacement.registrationGeneration);

    await service.detach({
      installationId,
      registrationGeneration: replacement.registrationGeneration,
      detachSecret: replacement.detachSecret,
    });
    expect((await prisma.pushDevice.findUnique({ where: { installationId } }))?.invalidatedAt).toBeTruthy();
    await service.detach({
      installationId,
      registrationGeneration: replacement.registrationGeneration,
      detachSecret: replacement.detachSecret,
    });
    expect(await prisma.pushDevice.count({ where: { installationId } })).toBe(1);
  });
});
