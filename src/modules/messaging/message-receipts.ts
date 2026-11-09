import { MessageKind } from '@prisma/client';

export const MESSAGE_BODY_MAX_LENGTH = 1000;

/**
 * Photos and PDFs attached to one message. Matches the send DTO and the
 * chat composer. This is the product maximum, not a native-picker maximum.
 */
export const MAX_MESSAGE_ATTACHMENTS = 10;

export type MessageReceiptStatus = 'sent' | 'delivered' | 'read';

/**
 * Derive Sent → Delivered → Read from the peer participant watermarks.
 * Read uses lastReadSequence, the same boundary as unread. A shared timestamp
 * does not make a later message read. Delivered still uses lastDeliveredAt.
 * Read implies delivered.
 */
export function computeMessageReceiptStatus(input: {
  kind: MessageKind;
  senderId: string | null;
  sequence: number;
  createdAt: Date;
  viewerId: string;
  peerLastDeliveredAt: Date | null | undefined;
  peerLastReadSequence: number | null | undefined;
}): MessageReceiptStatus | null {
  if (input.kind !== MessageKind.user || input.senderId !== input.viewerId) {
    return null;
  }

  const { createdAt, sequence, peerLastDeliveredAt, peerLastReadSequence } =
    input;

  if (peerLastReadSequence != null && peerLastReadSequence >= sequence) {
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
