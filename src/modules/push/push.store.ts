export type PushDeviceRow = {
  id: string;
  userId: string;
  installationId: string;
  expoPushToken: string;
  platform: 'ios' | 'android';
  viewingConversationId: string | null;
  viewingExpiresAt: Date | null;
  invalidatedAt: Date | null;
  registrationGeneration: number;
  detachSecretHash: string | null;
};

export type PushEpisodeRow = {
  id: string;
  deviceId: string;
  recipientUserId: string;
  conversationId: string;
  openingMessageId: string;
  openingSequence: number;
  status: 'OPEN' | 'CLOSED';
  openKey: string | null;
  closeReason: string | null;
};

export type PushDeliveryRow = {
  id: string;
  episodeId: string;
  state: 'PENDING' | 'SENDING' | 'SENT' | 'RECEIPT_OK' | 'FAILED' | 'CANCELLED' | 'EXPIRED' | 'UNKNOWN';
  claimToken: string | null;
  claimedAt: Date | null;
  attempts: number;
  nextAttemptAt: Date;
  expiresAt: Date;
  ticketId: string | null;
  receiptCheckAt: Date | null;
  lastError: string | null;
  sentAt: Date | null;
};

export type PushSendContext = {
  delivery: PushDeliveryRow;
  episode: PushEpisodeRow;
  device: PushDeviceRow;
  recipientSuspended: boolean;
  recipientDeleted: boolean;
  participant: boolean;
  participantDeleted: boolean;
  readThroughSequence: number | null;
  conversationArchived: boolean;
  messageIsUser: boolean;
  senderDisplayName: string | null;
  senderDeleted: boolean;
};

export interface PushStore {
  findDeviceByInstallation(installationId: string): Promise<PushDeviceRow | null>;
  findDeviceByToken(token: string): Promise<PushDeviceRow | null>;
  saveDevice(device: PushDeviceRow): Promise<void>;
  listActiveDevices(userId: string): Promise<PushDeviceRow[]>;
  findOpenEpisode(deviceId: string, conversationId: string): Promise<PushEpisodeRow | null>;
  insertEpisode(episode: PushEpisodeRow): Promise<'inserted' | 'exists'>;
  insertDelivery(delivery: PushDeliveryRow): Promise<void>;
  closeOpenEpisodes(input: {
    deviceId?: string;
    recipientUserId?: string;
    conversationId?: string;
    readThroughSequence?: number;
    reason: string;
  }): Promise<string[]>;
  cancelPending(episodeIds: string[], reason: string): Promise<void>;
  claimPending(now: Date, claimToken: string): Promise<string | null>;
  loadContext(deliveryId: string): Promise<PushSendContext | null>;
  saveDelivery(delivery: PushDeliveryRow): Promise<void>;
  saveEpisode(episode: PushEpisodeRow): Promise<void>;
  listReceiptDue(now: Date): Promise<PushDeliveryRow[]>;
  closeEpisodes(episodeIds: string[], reason: string): Promise<void>;
  finishDelivery(delivery: PushDeliveryRow, episode: PushEpisodeRow): Promise<void>;
  sweepStaleSending(before: Date): Promise<string[]>;
  insertOutbox(input: {
    id: string;
    messageId: string;
    conversationId: string;
    senderId: string;
    messageCreatedAt: Date;
  }): Promise<'inserted' | 'exists'>;
  claimOutbox(now: Date, claimToken: string): Promise<string | null>;
  loadOutbox(id: string): Promise<{
    id: string;
    messageId: string;
    conversationId: string;
    senderId: string;
    messageCreatedAt: Date;
    sequence: number;
    recipientIds: string[];
    claimToken: string | null;
  } | null>;
  completeOutbox(id: string, claimToken: string, status: 'done' | 'skipped', error?: string | null): Promise<void>;
  detachIfCurrent(input: {
    installationId: string;
    registrationGeneration: number;
    detachSecretHash: string;
    now: Date;
  }): Promise<boolean>;
}

export const PUSH_STORE = Symbol('PUSH_STORE');
