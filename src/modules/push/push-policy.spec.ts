import {
  chatPushBody,
  classifyReceipt,
  classifyTicket,
  deliveryWindow,
  pushNotificationsEnabled,
  recheckDelivery,
  retryDelayMs,
} from './push-policy';

const now = new Date('2026-11-22T18:00:00.000Z');

describe('chat push policy', () => {
  it('stays off unless the flag is exactly true', () => {
    expect(pushNotificationsEnabled({ PUSH_NOTIFICATIONS_ENABLED: 'true' })).toBe(true);
    expect(pushNotificationsEnabled({ PUSH_NOTIFICATIONS_ENABLED: 'false' })).toBe(false);
    expect(pushNotificationsEnabled({})).toBe(false);
  });

  it('uses the sender name and never a message body', () => {
    expect(chatPushBody('Ada', false)).toBe('Ada sent you a message.');
    expect(chatPushBody('  ', false)).toBe('Someone sent you a message.');
    expect(chatPushBody('Ada', true)).toBe('Deleted user sent you a message.');
  });

  it('defers a viewed conversation without extending the 30 minute expiry', () => {
    const viewingUntil = new Date(now.getTime() + 45_000);
    const window = deliveryWindow({
      now,
      messageCreatedAt: now,
      viewingThisConversationUntil: viewingUntil,
    });
    expect(window.nextAttemptAt).toEqual(viewingUntil);
    expect(window.expiresAt.getTime() - now.getTime()).toBe(30 * 60_000);
  });

  it('cancels when the account read marker has reached the opening message', () => {
    expect(
      recheckDelivery({
        now,
        flagOn: true,
        expired: false,
        episodeOpen: true,
        readThroughSequence: 4,
        openingSequence: 4,
        deviceOwnedByRecipient: true,
        deviceInvalidated: false,
        recipientSuspended: false,
        recipientDeleted: false,
        participant: true,
        participantDeleted: false,
        conversationArchived: false,
        messageIsUser: true,
        viewingUntil: null,
      }).action,
    ).toBe('cancel');
  });

  it('does not send to a suspended, deleted, archived, or foreign device', () => {
    const base = {
      now,
      flagOn: true,
      expired: false,
      episodeOpen: true,
      readThroughSequence: null,
      openingSequence: 2,
      deviceOwnedByRecipient: true,
      deviceInvalidated: false,
      recipientSuspended: false,
      recipientDeleted: false,
      participant: true,
      participantDeleted: false,
      conversationArchived: false,
      messageIsUser: true,
      viewingUntil: null,
    };
    expect(recheckDelivery({ ...base, recipientSuspended: true })).toMatchObject({ reason: 'suspended' });
    expect(recheckDelivery({ ...base, recipientDeleted: true })).toMatchObject({ reason: 'deleted' });
    expect(recheckDelivery({ ...base, conversationArchived: true })).toMatchObject({ reason: 'archived' });
    expect(recheckDelivery({ ...base, deviceOwnedByRecipient: false })).toMatchObject({
      reason: 'device_unavailable',
    });
    expect(recheckDelivery({ ...base, participantDeleted: true })).toMatchObject({
      reason: 'not_participant',
    });
  });

  it('classifies provider results without treating acceptance as delivery', () => {
    expect(
      classifyTicket({ httpStatus: 200, requestSent: true, ticketStatus: 'ok', ticketId: 't1' }),
    ).toEqual({ outcome: 'accepted', ticketId: 't1' });
    expect(
      classifyTicket({
        httpStatus: 200,
        requestSent: true,
        ticketStatus: 'error',
        errorCode: 'DeviceNotRegistered',
      }).outcome,
    ).toBe('device_not_registered');
    expect(classifyTicket({ httpStatus: 429, requestSent: true }).outcome).toBe('retry');
    expect(classifyTicket({ httpStatus: 503, requestSent: true }).outcome).toBe('unknown');
    expect(classifyTicket({ httpStatus: 0, requestSent: false }).outcome).toBe('unknown');
    expect(classifyReceipt({ ageMs: 25 * 60 * 60_000, found: true, status: 'ok' })).toBe('unknown');
    expect(retryDelayMs(5)).toBeNull();
    expect(retryDelayMs(1)).toBe(30_000);
  });
});
