import { MessageKind } from '@prisma/client';
import { computeMessageReceiptStatus } from './message-receipts';

describe('computeMessageReceiptStatus', () => {
  const createdAt = new Date('2026-08-17T12:00:00.000Z');

  it('returns null for system or incoming messages', () => {
    expect(
      computeMessageReceiptStatus({
        kind: MessageKind.system,
        senderId: null,
        createdAt,
        viewerId: 'u1',
        peerLastDeliveredAt: new Date(),
        peerLastReadAt: new Date(),
      }),
    ).toBeNull();

    expect(
      computeMessageReceiptStatus({
        kind: MessageKind.user,
        senderId: 'u2',
        createdAt,
        viewerId: 'u1',
        peerLastDeliveredAt: new Date(),
        peerLastReadAt: new Date(),
      }),
    ).toBeNull();
  });

  it('transitions sent → delivered → read via peer watermarks', () => {
    expect(
      computeMessageReceiptStatus({
        kind: MessageKind.user,
        senderId: 'u1',
        createdAt,
        viewerId: 'u1',
        peerLastDeliveredAt: null,
        peerLastReadAt: null,
      }),
    ).toBe('sent');

    expect(
      computeMessageReceiptStatus({
        kind: MessageKind.user,
        senderId: 'u1',
        createdAt,
        viewerId: 'u1',
        peerLastDeliveredAt: new Date('2026-08-17T12:00:01.000Z'),
        peerLastReadAt: null,
      }),
    ).toBe('delivered');

    expect(
      computeMessageReceiptStatus({
        kind: MessageKind.user,
        senderId: 'u1',
        createdAt,
        viewerId: 'u1',
        peerLastDeliveredAt: new Date('2026-08-17T12:00:01.000Z'),
        peerLastReadAt: new Date('2026-08-17T12:00:02.000Z'),
      }),
    ).toBe('read');
  });

  it('treats read as sufficient even without delivered watermark', () => {
    expect(
      computeMessageReceiptStatus({
        kind: MessageKind.user,
        senderId: 'u1',
        createdAt,
        viewerId: 'u1',
        peerLastDeliveredAt: null,
        peerLastReadAt: new Date('2026-08-17T12:00:02.000Z'),
      }),
    ).toBe('read');
  });

  it('stays sent when peer watermarks are older than the message', () => {
    expect(
      computeMessageReceiptStatus({
        kind: MessageKind.user,
        senderId: 'u1',
        createdAt,
        viewerId: 'u1',
        peerLastDeliveredAt: new Date('2026-08-17T11:59:00.000Z'),
        peerLastReadAt: new Date('2026-08-17T11:59:00.000Z'),
      }),
    ).toBe('sent');
  });
});
