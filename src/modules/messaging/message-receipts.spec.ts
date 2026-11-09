import { MessageKind } from '@prisma/client';
import { computeMessageReceiptStatus, deliveryWatermarkIsCurrent } from './message-receipts';

describe('computeMessageReceiptStatus', () => {
  const createdAt = new Date('2026-08-17T12:00:00.000Z');

  it('returns null for system or incoming messages', () => {
    expect(
      computeMessageReceiptStatus({
        kind: MessageKind.system,
        senderId: null,
        sequence: 1,
        createdAt,
        viewerId: 'u1',
        peerLastDeliveredAt: new Date(),
        peerLastReadSequence: 1,
      }),
    ).toBeNull();

    expect(
      computeMessageReceiptStatus({
        kind: MessageKind.user,
        senderId: 'u2',
        sequence: 1,
        createdAt,
        viewerId: 'u1',
        peerLastDeliveredAt: new Date(),
        peerLastReadSequence: 1,
      }),
    ).toBeNull();
  });

  it('transitions sent → delivered → read via peer watermarks', () => {
    expect(
      computeMessageReceiptStatus({
        kind: MessageKind.user,
        senderId: 'u1',
        sequence: 1,
        createdAt,
        viewerId: 'u1',
        peerLastDeliveredAt: null,
        peerLastReadSequence: null,
      }),
    ).toBe('sent');

    expect(
      computeMessageReceiptStatus({
        kind: MessageKind.user,
        senderId: 'u1',
        sequence: 1,
        createdAt,
        viewerId: 'u1',
        peerLastDeliveredAt: new Date('2026-08-17T12:00:01.000Z'),
        peerLastReadSequence: null,
      }),
    ).toBe('delivered');

    expect(
      computeMessageReceiptStatus({
        kind: MessageKind.user,
        senderId: 'u1',
        sequence: 1,
        createdAt,
        viewerId: 'u1',
        peerLastDeliveredAt: new Date('2026-08-17T12:00:01.000Z'),
        peerLastReadSequence: 1,
      }),
    ).toBe('read');
  });

  it('treats read as sufficient even without delivered watermark', () => {
    expect(
      computeMessageReceiptStatus({
        kind: MessageKind.user,
        senderId: 'u1',
        sequence: 1,
        createdAt,
        viewerId: 'u1',
        peerLastDeliveredAt: null,
        peerLastReadSequence: 1,
      }),
    ).toBe('read');
  });

  it('does not mark a later message read when it shares a timestamp', () => {
    expect(
      computeMessageReceiptStatus({
        kind: MessageKind.user,
        senderId: 'u1',
        sequence: 2,
        createdAt,
        viewerId: 'u1',
        peerLastDeliveredAt: createdAt,
        peerLastReadSequence: 1,
      }),
    ).toBe('delivered');
  });

  it('stays sent when peer watermarks are older than the message', () => {
    expect(
      computeMessageReceiptStatus({
        kind: MessageKind.user,
        senderId: 'u1',
        sequence: 2,
        createdAt,
        viewerId: 'u1',
        peerLastDeliveredAt: new Date('2026-08-17T11:59:00.000Z'),
        peerLastReadSequence: 1,
      }),
    ).toBe('sent');
  });
});

describe('deliveryWatermarkIsCurrent', () => {
  const target = new Date('2026-08-17T12:00:00.000Z');

  it('is current only when the stored time already covers the target', () => {
    expect(deliveryWatermarkIsCurrent(null, target)).toBe(false);
    expect(deliveryWatermarkIsCurrent(undefined, target)).toBe(false);
    expect(
      deliveryWatermarkIsCurrent(new Date('2026-08-17T11:59:00.000Z'), target),
    ).toBe(false);
    expect(deliveryWatermarkIsCurrent(target, target)).toBe(true);
    expect(
      deliveryWatermarkIsCurrent(new Date('2026-08-17T12:00:01.000Z'), target),
    ).toBe(true);
  });
});
