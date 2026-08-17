import { MessageKind } from '@prisma/client';

export const MESSAGE_BODY_MAX_LENGTH = 1000;

export type MessageReceiptStatus = 'sent' | 'delivered' | 'read';

/**
 * Derive Sent → Delivered → Read from the peer participant watermarks.
 * Read uses lastReadAt (same marker as unread). Delivered uses lastDeliveredAt
 * (advanced when the peer loads inbox/thread). Read implies delivered.
 */
export function computeMessageReceiptStatus(input: {
  kind: MessageKind;
  senderId: string | null;
  createdAt: Date;
  viewerId: string;
  peerLastDeliveredAt: Date | null | undefined;
  peerLastReadAt: Date | null | undefined;
}): MessageReceiptStatus | null {
  if (input.kind !== MessageKind.user || input.senderId !== input.viewerId) {
    return null;
  }

  const { createdAt, peerLastDeliveredAt, peerLastReadAt } = input;

  if (peerLastReadAt && peerLastReadAt.getTime() >= createdAt.getTime()) {
    return 'read';
  }
  if (
    peerLastDeliveredAt &&
    peerLastDeliveredAt.getTime() >= createdAt.getTime()
  ) {
    return 'delivered';
  }
  return 'sent';
}
