import { MemoryPushStore } from './push-memory.store';
import { PUSH_FLAG } from './push-policy';
import { ChatPushSender, PushService } from './push.service';

const now = new Date('2026-11-22T18:00:00.000Z');
const installation = '11111111-1111-4111-8111-111111111111';
const token = 'ExponentPushToken[abcDEF123]';

function world() {
  const store = new MemoryPushStore();
  const service = new PushService(store);
  return { store, service };
}

function sender(impl: ChatPushSender['send']): ChatPushSender {
  return { send: impl, receipts: async () => ({}) };
}

describe('chat push episodes', () => {
  const previous = process.env[PUSH_FLAG];

  beforeEach(() => {
    process.env[PUSH_FLAG] = 'true';
  });

  afterAll(() => {
    if (previous === undefined) delete process.env[PUSH_FLAG];
    else process.env[PUSH_FLAG] = previous;
  });

  it('does not queue while sending is disabled', async () => {
    process.env[PUSH_FLAG] = 'false';
    const { store, service } = world();
    await service.register({ userId: 'recipient', installationId: installation, expoPushToken: token, platform: 'ios' });
    await service.recordUserMessage({
      conversationId: 'conversation',
      messageId: 'message',
      sequence: 1,
      senderId: 'sender',
      createdAt: now,
      recipientIds: ['recipient'],
      now,
    });
    expect(store.episodes).toHaveLength(0);
  });

  it('opens one episode per device and ignores a second message', async () => {
    const { store, service } = world();
    await service.register({ userId: 'recipient', installationId: installation, expoPushToken: token, platform: 'ios' });
    const other = '22222222-2222-4222-8222-222222222222';
    await service.register({
      userId: 'recipient',
      installationId: other,
      expoPushToken: 'ExponentPushToken[otherdevice]',
      platform: 'android',
    });
    await service.recordUserMessage({
      conversationId: 'conversation',
      messageId: 'message-1',
      sequence: 3,
      senderId: 'sender',
      createdAt: now,
      recipientIds: ['recipient'],
      now,
    });
    await service.recordUserMessage({
      conversationId: 'conversation',
      messageId: 'message-2',
      sequence: 4,
      senderId: 'sender',
      createdAt: now,
      recipientIds: ['recipient'],
      now,
    });
    expect(store.episodes).toHaveLength(2);
    expect(store.deliveries).toHaveLength(2);
    expect(store.episodes.every((episode) => episode.openingMessageId === 'message-1')).toBe(true);
  });

  it('moves an installation to the signed-in account and stops the previous account', async () => {
    const { store, service } = world();
    await service.register({ userId: 'first', installationId: installation, expoPushToken: token, platform: 'ios' });
    await service.recordUserMessage({
      conversationId: 'conversation',
      messageId: 'message-1',
      sequence: 1,
      senderId: 'sender',
      createdAt: now,
      recipientIds: ['first'],
      now,
    });
    await service.register({ userId: 'second', installationId: installation, expoPushToken: token, platform: 'ios' });
    expect(store.devices.filter((device) => device.invalidatedAt == null)).toHaveLength(1);
    expect(store.devices.find((device) => device.invalidatedAt == null)?.userId).toBe('second');
    expect(store.episodes[0]?.status).toBe('CLOSED');
    expect(store.deliveries[0]?.state).toBe('CANCELLED');
  });

  it('sign-out invalidates the device', async () => {
    const { store, service } = world();
    await service.register({ userId: 'recipient', installationId: installation, expoPushToken: token, platform: 'ios' });
    await service.unregister('recipient', installation);
    expect(store.devices[0]?.invalidatedAt).toBeTruthy();
    await service.recordUserMessage({
      conversationId: 'conversation',
      messageId: 'message-1',
      sequence: 1,
      senderId: 'sender',
      createdAt: now,
      recipientIds: ['recipient'],
      now,
    });
    expect(store.episodes).toHaveLength(0);
  });

  it('defers while the device is viewing and sends after the signal expires', async () => {
    const { store, service } = world();
    await service.register({ userId: 'recipient', installationId: installation, expoPushToken: token, platform: 'ios' });
    await service.setViewing({
      userId: 'recipient',
      installationId: installation,
      conversationId: 'conversation',
      now,
      allowed: true,
    });
    await service.recordUserMessage({
      conversationId: 'conversation',
      messageId: 'message-1',
      sequence: 2,
      senderId: 'sender',
      createdAt: now,
      recipientIds: ['recipient'],
      now,
    });
    const sends: string[] = [];
    const provider = sender(async (input) => {
      sends.push(input.body);
      expect(input.body).toBe('Ada sent you a message.');
      expect(input.data).toEqual({
        v: '1',
        type: 'chat_message',
        conversationId: 'conversation',
        recipientUserId: 'recipient',
      });
      return { outcome: 'accepted', ticketId: 'ticket-1' };
    });
    store.access.set('recipient:conversation', {
      suspended: false,
      deleted: false,
      participant: true,
      participantDeleted: false,
      readThroughSequence: null,
      conversationArchived: false,
      messageIsUser: true,
      senderDisplayName: 'Ada',
      senderDeleted: false,
    });
    expect(await service.processOne(provider, now)).toBe('idle');
    expect(sends).toHaveLength(0);
    const later = new Date(now.getTime() + 46_000);
    expect(await service.processOne(provider, later)).toBe('handled');
    expect(sends).toEqual(['Ada sent you a message.']);
    expect(store.deliveries[0]?.state).toBe('SENT');
    expect(store.deliveries[0]?.ticketId).toBe('ticket-1');
  });

  it('cancels a pending send when the account reads, and does not retry an uncertain send', async () => {
    const { store, service } = world();
    await service.register({ userId: 'recipient', installationId: installation, expoPushToken: token, platform: 'ios' });
    await service.recordUserMessage({
      conversationId: 'conversation',
      messageId: 'message-1',
      sequence: 5,
      senderId: 'sender',
      createdAt: now,
      recipientIds: ['recipient'],
      now,
    });
    await service.closeRead({ userId: 'recipient', conversationId: 'conversation', sequence: 5 });
    expect(store.episodes[0]?.status).toBe('CLOSED');
    expect(store.deliveries[0]?.state).toBe('CANCELLED');

    store.episodes[0]!.status = 'OPEN';
    store.episodes[0]!.openKey = `${store.devices[0]!.id}:conversation`;
    store.deliveries[0]!.state = 'PENDING';
    store.deliveries[0]!.claimToken = null;
    store.access.set('recipient:conversation', {
      suspended: false,
      deleted: false,
      participant: true,
      participantDeleted: false,
      readThroughSequence: null,
      conversationArchived: false,
      messageIsUser: true,
      senderDisplayName: 'Ada',
      senderDeleted: false,
    });
    await service.processOne(
      sender(async () => {
        throw new Error('timeout');
      }),
      now,
    );
    expect(store.deliveries[0]?.state).toBe('UNKNOWN');
    expect(await service.processOne(sender(async () => ({ outcome: 'accepted', ticketId: 'again' })), now)).toBe('idle');
  });

  it('moves a token onto a new installation and retires the previous account', async () => {
    const { store, service } = world();
    await service.register({ userId: 'first', installationId: installation, expoPushToken: token, platform: 'ios' });
    await service.recordUserMessage({
      conversationId: 'conversation',
      messageId: 'message-1',
      sequence: 1,
      senderId: 'sender',
      createdAt: now,
      recipientIds: ['first'],
      now,
    });
    const nextInstallation = '33333333-3333-4333-8333-333333333333';
    await service.register({
      userId: 'second',
      installationId: nextInstallation,
      expoPushToken: token,
      platform: 'ios',
    });
    const active = store.devices.filter((device) => device.invalidatedAt == null);
    expect(active).toHaveLength(1);
    expect(active[0]?.userId).toBe('second');
    expect(active[0]?.expoPushToken).toBe(token);
    expect(store.episodes[0]?.status).toBe('CLOSED');
    expect(store.deliveries[0]?.state).toBe('CANCELLED');
  });

  it('does not call the provider after the device changes owner while claimed', async () => {
    const { store, service } = world();
    await service.register({ userId: 'recipient', installationId: installation, expoPushToken: token, platform: 'ios' });
    await service.recordUserMessage({
      conversationId: 'conversation',
      messageId: 'message-1',
      sequence: 1,
      senderId: 'sender',
      createdAt: now,
      recipientIds: ['recipient'],
      now,
    });
    store.access.set('recipient:conversation', {
      suspended: false,
      deleted: false,
      participant: true,
      participantDeleted: false,
      readThroughSequence: null,
      conversationArchived: false,
      messageIsUser: true,
      senderDisplayName: 'Ada',
      senderDeleted: false,
    });
    const original = store.saveDelivery.bind(store);
    store.saveDelivery = async (delivery) => {
      await original(delivery);
      if (delivery.state === 'SENDING') store.devices[0]!.userId = 'other';
    };
    let called = false;
    await service.processOne(
      sender(async () => {
        called = true;
        return { outcome: 'accepted', ticketId: 'nope' };
      }),
      now,
    );
    expect(called).toBe(false);
    expect(store.deliveries[0]?.state).toBe('CANCELLED');
  });

  it('disables an unregistered token and retries a transient failure on the same delivery', async () => {
    const { store, service } = world();
    await service.register({ userId: 'recipient', installationId: installation, expoPushToken: token, platform: 'ios' });
    await service.recordUserMessage({
      conversationId: 'conversation',
      messageId: 'message-1',
      sequence: 1,
      senderId: 'sender',
      createdAt: now,
      recipientIds: ['recipient'],
      now,
    });
    store.access.set('recipient:conversation', {
      suspended: false,
      deleted: false,
      participant: true,
      participantDeleted: false,
      readThroughSequence: null,
      conversationArchived: false,
      messageIsUser: true,
      senderDisplayName: 'Ada',
      senderDeleted: false,
    });
    await service.processOne(sender(async () => ({ outcome: 'retry' })), now);
    expect(store.deliveries).toHaveLength(1);
    expect(store.deliveries[0]?.state).toBe('PENDING');
    expect(store.deliveries[0]?.attempts).toBe(1);
    store.deliveries[0]!.nextAttemptAt = now;
    await service.processOne(sender(async () => ({ outcome: 'device_not_registered' })), now);
    expect(store.devices[0]?.invalidatedAt).toBeTruthy();
    expect(store.episodes[0]?.status).toBe('CLOSED');
  });
});
