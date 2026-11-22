export const PUSH_FLAG = 'PUSH_NOTIFICATIONS_ENABLED';
export const VIEWING_TTL_MS = 45_000;
export const DELIVERY_TTL_MS = 30 * 60_000;
export const RECEIPT_DELAY_MS = 15 * 60_000;
export const RECEIPT_MAX_AGE_MS = 24 * 60 * 60_000;
export const MAX_SEND_ATTEMPTS = 5;
export const STALE_SEND_MS = 2 * 60_000;

const BACKOFF_MS = [30_000, 60_000, 120_000, 240_000];

export function pushNotificationsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env[PUSH_FLAG] === 'true';
}

export function chatPushBody(displayName: string | null | undefined, deleted: boolean): string {
  const name = deleted ? 'Deleted user' : displayName?.trim() || 'Someone';
  return `${name} sent you a message.`;
}

export function openKey(deviceId: string, conversationId: string): string {
  return `${deviceId}:${conversationId}`;
}

export function deliveryWindow(input: {
  now: Date;
  messageCreatedAt: Date;
  viewingThisConversationUntil: Date | null;
}): { nextAttemptAt: Date; expiresAt: Date } {
  const expiresAt = new Date(input.messageCreatedAt.getTime() + DELIVERY_TTL_MS);
  const viewingUntil = input.viewingThisConversationUntil;
  const nextAttemptAt =
    viewingUntil && viewingUntil.getTime() > input.now.getTime() ? viewingUntil : input.now;
  return { nextAttemptAt, expiresAt };
}

export type RecheckInput = {
  now: Date;
  flagOn: boolean;
  expired: boolean;
  episodeOpen: boolean;
  readThroughSequence: number | null;
  openingSequence: number;
  deviceOwnedByRecipient: boolean;
  deviceInvalidated: boolean;
  recipientSuspended: boolean;
  recipientDeleted: boolean;
  participant: boolean;
  participantDeleted: boolean;
  conversationArchived: boolean;
  messageIsUser: boolean;
  viewingUntil: Date | null;
};

export type RecheckDecision =
  | { action: 'defer'; until: Date }
  | { action: 'cancel'; reason: string }
  | { action: 'expire' }
  | { action: 'send' };

/** Account-wide read: any device that advanced lastReadSequence closes every device's episode. */
export function recheckDelivery(input: RecheckInput): RecheckDecision {
  if (!input.flagOn) return { action: 'cancel', reason: 'sending_disabled' };
  if (input.expired) return { action: 'expire' };
  if (
    !input.episodeOpen ||
    (input.readThroughSequence != null && input.readThroughSequence >= input.openingSequence)
  ) {
    return { action: 'cancel', reason: 'read' };
  }
  if (!input.deviceOwnedByRecipient || input.deviceInvalidated) {
    return { action: 'cancel', reason: 'device_unavailable' };
  }
  if (input.recipientSuspended) return { action: 'cancel', reason: 'suspended' };
  if (input.recipientDeleted) return { action: 'cancel', reason: 'deleted' };
  if (!input.participant || input.participantDeleted) {
    return { action: 'cancel', reason: 'not_participant' };
  }
  if (input.conversationArchived) return { action: 'cancel', reason: 'archived' };
  if (!input.messageIsUser) return { action: 'cancel', reason: 'not_user_message' };
  if (input.viewingUntil && input.viewingUntil.getTime() > input.now.getTime()) {
    return { action: 'defer', until: input.viewingUntil };
  }
  return { action: 'send' };
}

export function retryDelayMs(attemptsAfterFailure: number): number | null {
  if (attemptsAfterFailure >= MAX_SEND_ATTEMPTS) return null;
  return BACKOFF_MS[Math.min(attemptsAfterFailure - 1, BACKOFF_MS.length - 1)] ?? null;
}

export type ProviderTicket =
  | { outcome: 'accepted'; ticketId: string }
  | { outcome: 'device_not_registered' }
  | { outcome: 'retry' }
  | { outcome: 'rejected' }
  | { outcome: 'unknown' };

export function classifyTicket(input: {
  httpStatus: number;
  ticketStatus?: 'ok' | 'error';
  ticketId?: string | null;
  errorCode?: string | null;
  requestSent: boolean;
}): ProviderTicket {
  if (!input.requestSent || input.httpStatus === 0) return { outcome: 'unknown' };
  if (input.httpStatus === 429) return { outcome: 'retry' };
  if (input.httpStatus >= 500) return { outcome: 'unknown' };
  if (input.httpStatus >= 400) return { outcome: 'rejected' };
  if (input.ticketStatus === 'ok' && input.ticketId) {
    return { outcome: 'accepted', ticketId: input.ticketId };
  }
  if (input.ticketStatus === 'ok') return { outcome: 'unknown' };
  if (input.errorCode === 'DeviceNotRegistered') return { outcome: 'device_not_registered' };
  if (input.errorCode === 'MessageRateExceeded') return { outcome: 'retry' };
  return { outcome: 'rejected' };
}

export function classifyReceipt(input: {
  ageMs: number;
  found: boolean;
  status?: 'ok' | 'error';
  errorCode?: string | null;
}): 'ok' | 'device_not_registered' | 'retry' | 'failed' | 'unknown' {
  if (input.ageMs > RECEIPT_MAX_AGE_MS) return 'unknown';
  if (!input.found) return 'unknown';
  if (input.status === 'ok') return 'ok';
  if (input.errorCode === 'DeviceNotRegistered') return 'device_not_registered';
  if (input.errorCode === 'MessageRateExceeded') return 'retry';
  return 'failed';
}
