import { STALE_SEND_MS, openKey } from './push-policy';
import {
  PushDeliveryRow,
  PushDeviceRow,
  PushEpisodeRow,
  PushSendContext,
  PushStore,
} from './push.store';

export type MemoryAccess = {
  suspended: boolean;
  deleted: boolean;
  participant: boolean;
  participantDeleted: boolean;
  readThroughSequence: number | null;
  conversationArchived: boolean;
  messageIsUser: boolean;
  senderDisplayName: string | null;
  senderDeleted: boolean;
};

export class MemoryPushStore implements PushStore {
  devices: PushDeviceRow[] = [];
  episodes: PushEpisodeRow[] = [];
  deliveries: PushDeliveryRow[] = [];
  access = new Map<string, MemoryAccess>();

  async findDeviceByInstallation(installationId: string) {
    return this.devices.find((device) => device.installationId === installationId) ?? null;
  }

  async findDeviceByToken(token: string) {
    return this.devices.find((device) => device.expoPushToken === token) ?? null;
  }

  async saveDevice(device: PushDeviceRow) {
    const index = this.devices.findIndex((row) => row.id === device.id);
    if (index >= 0) this.devices[index] = device;
    else this.devices.push(device);
  }

  async listActiveDevices(userId: string) {
    return this.devices.filter((device) => device.userId === userId && device.invalidatedAt == null);
  }

  async findOpenEpisode(deviceId: string, conversationId: string) {
    return (
      this.episodes.find(
        (episode) =>
          episode.deviceId === deviceId &&
          episode.conversationId === conversationId &&
          episode.status === 'OPEN',
      ) ?? null
    );
  }

  async insertEpisode(episode: PushEpisodeRow) {
    if (this.episodes.some((row) => row.openKey && row.openKey === episode.openKey)) return 'exists';
    this.episodes.push(episode);
    return 'inserted';
  }

  async insertDelivery(delivery: PushDeliveryRow) {
    if (this.deliveries.some((row) => row.episodeId === delivery.episodeId)) return;
    this.deliveries.push(delivery);
  }

  async closeOpenEpisodes(input: {
    deviceId?: string;
    recipientUserId?: string;
    conversationId?: string;
    readThroughSequence?: number;
    reason: string;
  }) {
    const closed: string[] = [];
    for (const episode of this.episodes) {
      if (episode.status !== 'OPEN') continue;
      if (input.deviceId && episode.deviceId !== input.deviceId) continue;
      if (input.recipientUserId && episode.recipientUserId !== input.recipientUserId) continue;
      if (input.conversationId && episode.conversationId !== input.conversationId) continue;
      if (
        input.readThroughSequence != null &&
        input.readThroughSequence < episode.openingSequence
      ) {
        continue;
      }
      episode.status = 'CLOSED';
      episode.openKey = null;
      episode.closeReason = input.reason;
      closed.push(episode.id);
    }
    return closed;
  }

  async cancelPending(episodeIds: string[], reason: string) {
    for (const delivery of this.deliveries) {
      if (!episodeIds.includes(delivery.episodeId) || delivery.state !== 'PENDING') continue;
      delivery.state = 'CANCELLED';
      delivery.lastError = reason;
      delivery.claimToken = null;
    }
  }

  async claimPending(now: Date, claimToken: string) {
    const delivery = this.deliveries
      .filter(
        (row) =>
          row.state === 'PENDING' &&
          row.nextAttemptAt.getTime() <= now.getTime() &&
          (row.claimToken == null ||
            (row.claimedAt != null && row.claimedAt.getTime() < now.getTime() - STALE_SEND_MS)),
      )
      .sort((a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime())[0];
    if (!delivery) return null;
    delivery.claimToken = claimToken;
    delivery.claimedAt = now;
    return delivery.id;
  }

  async loadContext(deliveryId: string): Promise<PushSendContext | null> {
    const delivery = this.deliveries.find((row) => row.id === deliveryId);
    if (!delivery) return null;
    const episode = this.episodes.find((row) => row.id === delivery.episodeId);
    if (!episode) return null;
    const device = this.devices.find((row) => row.id === episode.deviceId);
    if (!device) return null;
    const access = this.access.get(`${episode.recipientUserId}:${episode.conversationId}`) ?? {
      suspended: false,
      deleted: false,
      participant: true,
      participantDeleted: false,
      readThroughSequence: null,
      conversationArchived: false,
      messageIsUser: true,
      senderDisplayName: 'Someone',
      senderDeleted: false,
    };
    return {
      delivery,
      episode,
      device,
      recipientSuspended: access.suspended,
      recipientDeleted: access.deleted,
      participant: access.participant,
      participantDeleted: access.participantDeleted,
      readThroughSequence: access.readThroughSequence,
      conversationArchived: access.conversationArchived,
      messageIsUser: access.messageIsUser,
      senderDisplayName: access.senderDisplayName,
      senderDeleted: access.senderDeleted,
    };
  }

  async saveDelivery(delivery: PushDeliveryRow) {
    const index = this.deliveries.findIndex((row) => row.id === delivery.id);
    if (index >= 0) this.deliveries[index] = delivery;
  }

  async saveEpisode(episode: PushEpisodeRow) {
    const index = this.episodes.findIndex((row) => row.id === episode.id);
    if (index >= 0) this.episodes[index] = episode;
  }

  async listReceiptDue(now: Date) {
    return this.deliveries.filter(
      (row) =>
        row.state === 'SENT' &&
        row.receiptCheckAt != null &&
        row.receiptCheckAt.getTime() <= now.getTime() &&
        row.ticketId != null,
    );
  }

  async finishDelivery(delivery: PushDeliveryRow, episode: PushEpisodeRow) {
    await this.saveDelivery(delivery);
    await this.saveEpisode(episode);
  }

  async detachIfCurrent(input: {
    installationId: string;
    registrationGeneration: number;
    detachSecretHash: string;
    now: Date;
  }) {
    const device = this.devices.find((row) => row.installationId === input.installationId);
    if (
      !device ||
      device.invalidatedAt ||
      device.registrationGeneration !== input.registrationGeneration ||
      device.detachSecretHash !== input.detachSecretHash
    ) {
      return false;
    }
    device.invalidatedAt = input.now;
    device.detachSecretHash = null;
    device.viewingConversationId = null;
    device.viewingExpiresAt = null;
    const closed = await this.closeOpenEpisodes({ deviceId: device.id, reason: 'signed_out' });
    await this.cancelPending(closed, 'signed_out');
    return true;
  }

  async insertOutbox() {
    return 'inserted' as const;
  }

  async claimOutbox() {
    return null;
  }

  async loadOutbox() {
    return null;
  }

  async completeOutbox() {
    return undefined;
  }

  async closeEpisodes(episodeIds: string[], reason: string) {
    for (const episode of this.episodes) {
      if (!episodeIds.includes(episode.id) || episode.status !== 'OPEN') continue;
      episode.status = 'CLOSED';
      episode.openKey = null;
      episode.closeReason = reason;
    }
  }

  async sweepStaleSending(before: Date) {
    const episodeIds: string[] = [];
    for (const delivery of this.deliveries) {
      if (delivery.state !== 'SENDING' || !delivery.claimedAt || delivery.claimedAt >= before) continue;
      delivery.state = 'UNKNOWN';
      delivery.lastError = 'stale_send';
      delivery.claimToken = null;
      const episode = this.episodes.find((row) => row.id === delivery.episodeId);
      if (episode && episode.status === 'OPEN') {
        episode.status = 'CLOSED';
        episode.openKey = null;
        episode.closeReason = 'interrupted_send';
      }
      episodeIds.push(delivery.episodeId);
    }
    return episodeIds;
  }
}

export function deviceOpenKey(deviceId: string, conversationId: string): string {
  return openKey(deviceId, conversationId);
}
