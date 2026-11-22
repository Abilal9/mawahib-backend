import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { createDetachSecret, detachSecretHash, type PushRegistrationCredential } from './push-credential';
import {
  DELIVERY_TTL_MS,
  RECEIPT_DELAY_MS,
  STALE_SEND_MS,
  chatPushBody,
  deliveryWindow,
  openKey,
  pushNotificationsEnabled,
  recheckDelivery,
  retryDelayMs,
} from './push-policy';
import { PUSH_STORE, type PushDeliveryRow, type PushEpisodeRow, type PushStore } from './push.store';

export type PushSendOutcome =
  | { outcome: 'accepted'; ticketId: string }
  | { outcome: 'device_not_registered' }
  | { outcome: 'retry' }
  | { outcome: 'rejected' }
  | { outcome: 'unknown' };

export interface ChatPushSender {
  send(input: {
    to: string;
    body: string;
    data: { v: '1'; type: 'chat_message'; conversationId: string; recipientUserId: string };
  }): Promise<PushSendOutcome>;
  receipts(
    ticketIds: string[],
  ): Promise<Record<string, { status: 'ok' } | { status: 'error'; code: string } | null>>;
}

export const CHAT_PUSH_RECORDER = Symbol('CHAT_PUSH_RECORDER');

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private gate: Promise<void> = Promise.resolve();

  constructor(@Inject(PUSH_STORE) private readonly store: PushStore) {}

  /** One API process. Ownership changes cannot pass a provider call already in this lock. */
  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.gate.then(work, work);
    this.gate = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async register(input: {
    userId: string;
    installationId: string;
    expoPushToken: string;
    platform: 'ios' | 'android';
  }): Promise<PushRegistrationCredential> {
    return this.exclusive(async () => {
    const byInstallation = await this.store.findDeviceByInstallation(input.installationId);
    const byToken = await this.store.findDeviceByToken(input.expoPushToken);
    const previousRows = [byInstallation, byToken].filter(
      (device, index, all): device is NonNullable<typeof device> =>
        device != null && all.findIndex((row) => row?.id === device.id) === index,
    );
    for (const previous of previousRows) {
      if (previous.userId === input.userId && previous.id === byInstallation?.id) continue;
      const closed = await this.store.closeOpenEpisodes({
        deviceId: previous.id,
        reason: 'device_reassigned',
      });
      await this.store.cancelPending(closed, 'device_reassigned');
    }
    if (byToken && byToken.id !== byInstallation?.id) {
      byToken.invalidatedAt = new Date();
      byToken.expoPushToken = `retired:${byToken.id}`;
      byToken.viewingConversationId = null;
      byToken.viewingExpiresAt = null;
      byToken.detachSecretHash = null;
      await this.store.saveDevice(byToken);
    }
    const credential = createDetachSecret();
    const device = byInstallation ?? {
      id: randomUUID(),
      userId: input.userId,
      installationId: input.installationId,
      expoPushToken: input.expoPushToken,
      platform: input.platform,
      viewingConversationId: null,
      viewingExpiresAt: null,
      invalidatedAt: null,
      registrationGeneration: 0,
      detachSecretHash: null,
    };
    device.userId = input.userId;
    device.expoPushToken = input.expoPushToken;
    device.platform = input.platform;
    device.invalidatedAt = null;
    device.viewingConversationId = null;
    device.viewingExpiresAt = null;
    device.registrationGeneration = (device.registrationGeneration ?? 0) + 1;
    device.detachSecretHash = credential.hash;
    await this.store.saveDevice(device);
    return {
      registrationGeneration: device.registrationGeneration,
      detachSecret: credential.secret,
    };
    });
  }

  async detach(input: {
    installationId: string;
    registrationGeneration: number;
    detachSecret: string;
    now?: Date;
  }): Promise<void> {
    await this.exclusive(async () => {
      await this.store.detachIfCurrent({
        installationId: input.installationId,
        registrationGeneration: input.registrationGeneration,
        detachSecretHash: detachSecretHash(input.detachSecret),
        now: input.now ?? new Date(),
      });
    });
  }

  async unregister(userId: string, installationId: string): Promise<void> {
    return this.exclusive(async () => {
    const device = await this.store.findDeviceByInstallation(installationId);
    if (!device || device.userId !== userId) return;
    device.invalidatedAt = new Date();
    device.viewingConversationId = null;
    device.viewingExpiresAt = null;
    await this.store.saveDevice(device);
    const closed = await this.store.closeOpenEpisodes({
      deviceId: device.id,
      reason: 'signed_out',
    });
    await this.store.cancelPending(closed, 'signed_out');
    });
  }

  async setViewing(input: {
    userId: string;
    installationId: string;
    conversationId: string;
    now: Date;
    allowed: boolean;
  }): Promise<void> {
    return this.exclusive(async () => {
    const device = await this.store.findDeviceByInstallation(input.installationId);
    if (!device || device.userId !== input.userId || device.invalidatedAt || !input.allowed) return;
    device.viewingConversationId = input.conversationId;
    device.viewingExpiresAt = new Date(input.now.getTime() + 45_000);
    await this.store.saveDevice(device);
    });
  }

  async clearViewing(userId: string, installationId: string): Promise<void> {
    return this.exclusive(async () => {
    const device = await this.store.findDeviceByInstallation(installationId);
    if (!device || device.userId !== userId) return;
    device.viewingConversationId = null;
    device.viewingExpiresAt = null;
    await this.store.saveDevice(device);
    });
  }

  async recordUserMessage(input: {
    conversationId: string;
    messageId: string;
    sequence: number;
    senderId: string;
    createdAt: Date;
    recipientIds: string[];
    now?: Date;
  }): Promise<void> {
    if (!pushNotificationsEnabled() || input.sequence < 1) return;
    const now = input.now ?? new Date();
    try {
      await this.exclusive(() => this.queueEpisodes(input, now));
    } catch (error) {
      this.logger.warn(
        `Chat push was not queued: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
  }

  async repairOutbox(input: {
    callerId: string;
    messageId: string;
    conversationId: string;
    senderId: string | null;
    messageCreatedAt: Date;
  }): Promise<void> {
    if (!pushNotificationsEnabled() || !input.senderId || input.callerId !== input.senderId) return;
    if (Date.now() >= input.messageCreatedAt.getTime() + DELIVERY_TTL_MS) return;
    await this.store.insertOutbox({
      id: randomUUID(),
      messageId: input.messageId,
      conversationId: input.conversationId,
      senderId: input.senderId,
      messageCreatedAt: input.messageCreatedAt,
    });
  }

  async processOutbox(now = new Date()): Promise<'idle' | 'handled'> {
    if (!pushNotificationsEnabled()) return 'idle';
    return this.exclusive(async () => {
      const claimToken = randomUUID();
      const id = await this.store.claimOutbox(now, claimToken);
      if (!id) return 'idle';
      const row = await this.store.loadOutbox(id);
      if (!row || row.claimToken !== claimToken) return 'handled';
      if (now.getTime() >= row.messageCreatedAt.getTime() + DELIVERY_TTL_MS || row.sequence < 1) {
        await this.store.completeOutbox(id, claimToken, 'skipped', 'stale');
        return 'handled';
      }
      await this.queueEpisodes(
        {
          conversationId: row.conversationId,
          messageId: row.messageId,
          sequence: row.sequence,
          senderId: row.senderId,
          createdAt: row.messageCreatedAt,
          recipientIds: row.recipientIds,
        },
        now,
      );
      await this.store.completeOutbox(id, claimToken, 'done');
      return 'handled';
    });
  }

  private async queueEpisodes(
    input: {
      conversationId: string;
      messageId: string;
      sequence: number;
      senderId: string;
      createdAt: Date;
      recipientIds: string[];
    },
    now: Date,
  ): Promise<void> {
      for (const recipientId of input.recipientIds) {
        if (recipientId === input.senderId) continue;
        const devices = await this.store.listActiveDevices(recipientId);
        for (const device of devices) {
          const viewing =
            device.viewingConversationId === input.conversationId ? device.viewingExpiresAt : null;
          const window = deliveryWindow({
            now,
            messageCreatedAt: input.createdAt,
            viewingThisConversationUntil: viewing,
          });
          if (window.expiresAt.getTime() <= now.getTime()) continue;
          const episodeId = randomUUID();
          const inserted = await this.store.insertEpisode({
            id: episodeId,
            deviceId: device.id,
            recipientUserId: recipientId,
            conversationId: input.conversationId,
            openingMessageId: input.messageId,
            openingSequence: input.sequence,
            status: 'OPEN',
            openKey: openKey(device.id, input.conversationId),
            closeReason: null,
          });
          if (inserted !== 'inserted') continue;
          try {
          await this.store.insertDelivery({
            id: randomUUID(),
            episodeId,
            state: 'PENDING',
            claimToken: null,
            claimedAt: null,
            attempts: 0,
            nextAttemptAt: window.nextAttemptAt,
            expiresAt: new Date(input.createdAt.getTime() + DELIVERY_TTL_MS),
            ticketId: null,
            receiptCheckAt: null,
            lastError: null,
            sentAt: null,
          });
          } catch (error) {
            await this.store.closeEpisodes([episodeId], 'not_queued');
            throw error;
          }
        }
      }
  }

  async closeRead(input: {
    userId: string;
    conversationId: string;
    sequence: number;
  }): Promise<void> {
    try {
      await this.exclusive(async () => {
      const closed = await this.store.closeOpenEpisodes({
        recipientUserId: input.userId,
        conversationId: input.conversationId,
        readThroughSequence: input.sequence,
        reason: 'read',
      });
      await this.store.cancelPending(closed, 'read');
      });
    } catch (error) {
      this.logger.warn(
        `Chat push read close failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
  }

  async processOne(sender: ChatPushSender, now = new Date()): Promise<'idle' | 'handled'> {
    if (!pushNotificationsEnabled()) return 'idle';
    return this.exclusive(() => this.processClaimed(sender, now));
  }

  private async processClaimed(sender: ChatPushSender, now: Date): Promise<'idle' | 'handled'> {
    await this.store.sweepStaleSending(new Date(now.getTime() - STALE_SEND_MS));
    const claimToken = randomUUID();
    const deliveryId = await this.store.claimPending(now, claimToken);
    if (!deliveryId) return 'idle';
    const context = await this.store.loadContext(deliveryId);
    if (!context || context.delivery.claimToken !== claimToken) return 'handled';
    const decision = recheckDelivery({
      now,
      flagOn: true,
      expired: context.delivery.expiresAt.getTime() <= now.getTime(),
      episodeOpen: context.episode.status === 'OPEN',
      readThroughSequence: context.readThroughSequence,
      openingSequence: context.episode.openingSequence,
      deviceOwnedByRecipient: context.device.userId === context.episode.recipientUserId,
      deviceInvalidated: context.device.invalidatedAt != null,
      recipientSuspended: context.recipientSuspended,
      recipientDeleted: context.recipientDeleted,
      participant: context.participant,
      participantDeleted: context.participantDeleted,
      conversationArchived: context.conversationArchived,
      messageIsUser: context.messageIsUser,
      viewingUntil:
        context.device.viewingConversationId === context.episode.conversationId
          ? context.device.viewingExpiresAt
          : null,
    });
    if (decision.action === 'defer') {
      context.delivery.claimToken = null;
      context.delivery.claimedAt = null;
      context.delivery.nextAttemptAt = decision.until;
      await this.store.saveDelivery(context.delivery);
      return 'handled';
    }
    if (decision.action !== 'send') {
      await this.finish(context, decision.action === 'expire' ? 'EXPIRED' : 'CANCELLED', decision.action === 'expire' ? 'expired' : decision.reason);
      return 'handled';
    }
    context.delivery.state = 'SENDING';
    context.delivery.attempts += 1;
    context.delivery.claimedAt = now;
    await this.store.saveDelivery(context.delivery);
    const fresh = await this.store.loadContext(context.delivery.id);
    if (
      !fresh ||
      fresh.device.userId !== fresh.episode.recipientUserId ||
      fresh.device.invalidatedAt != null ||
      fresh.episode.status !== 'OPEN' ||
      (fresh.readThroughSequence != null && fresh.readThroughSequence >= fresh.episode.openingSequence)
    ) {
      if (fresh) await this.finish(fresh, 'CANCELLED', 'ownership_changed');
      return 'handled';
    }
    let outcome: PushSendOutcome;
    try {
      outcome = await sender.send({
        to: fresh.device.expoPushToken,
        body: chatPushBody(context.senderDisplayName, context.senderDeleted),
        data: {
          v: '1',
          type: 'chat_message',
          conversationId: context.episode.conversationId,
          recipientUserId: context.episode.recipientUserId,
        },
      });
    } catch {
      outcome = { outcome: 'unknown' };
    }
    if (outcome.outcome === 'accepted') {
      context.delivery.state = 'SENT';
      context.delivery.ticketId = outcome.ticketId;
      context.delivery.sentAt = now;
      context.delivery.receiptCheckAt = new Date(now.getTime() + RECEIPT_DELAY_MS);
      context.delivery.claimToken = null;
      context.delivery.lastError = null;
      await this.store.saveDelivery(context.delivery);
      return 'handled';
    }
    if (outcome.outcome === 'device_not_registered') {
      context.device.invalidatedAt = now;
      await this.store.saveDevice(context.device);
      const closed = await this.store.closeOpenEpisodes({
        deviceId: context.device.id,
        reason: 'device_not_registered',
      });
      await this.finish(context, 'FAILED', 'device_not_registered');
      await this.store.cancelPending(closed.filter((id) => id !== context.episode.id), 'device_not_registered');
      return 'handled';
    }
    if (outcome.outcome === 'retry') {
      const delay = retryDelayMs(context.delivery.attempts);
      const next = delay == null ? null : new Date(now.getTime() + delay);
      if (!next || next.getTime() >= context.delivery.expiresAt.getTime()) {
        await this.finish(context, 'FAILED', 'retry_limit');
        return 'handled';
      }
      context.delivery.state = 'PENDING';
      context.delivery.claimToken = null;
      context.delivery.nextAttemptAt = next;
      context.delivery.lastError = 'retry';
      await this.store.saveDelivery(context.delivery);
      return 'handled';
    }
    if (outcome.outcome === 'unknown') {
      await this.finish(context, 'UNKNOWN', 'uncertain_send');
      return 'handled';
    }
    await this.finish(context, 'FAILED', 'rejected');
    return 'handled';
  }

  async processReceipts(
    sender: ChatPushSender,
    now = new Date(),
  ): Promise<void> {
    if (!pushNotificationsEnabled()) return;
    const due = await this.store.listReceiptDue(now);
    if (due.length === 0) return;
    const ids = due.map((row) => row.ticketId).filter((id): id is string => Boolean(id));
    let receipts: Awaited<ReturnType<ChatPushSender['receipts']>> = {};
    try {
      receipts = await sender.receipts(ids);
    } catch {
      return;
    }
    for (const delivery of due) {
      if (!delivery.ticketId || !delivery.sentAt) continue;
      const receipt = receipts[delivery.ticketId];
      const age = now.getTime() - delivery.sentAt.getTime();
      if (age > 24 * 60 * 60_000 || receipt == null) {
        delivery.state = 'UNKNOWN';
        delivery.lastError = 'receipt_unknown';
      } else if (receipt.status === 'ok') {
        delivery.state = 'RECEIPT_OK';
        delivery.lastError = null;
      } else if (receipt.code === 'DeviceNotRegistered') {
        delivery.state = 'FAILED';
        delivery.lastError = 'device_not_registered';
        const context = await this.store.loadContext(delivery.id);
        if (context) {
          context.device.invalidatedAt = now;
          await this.store.saveDevice(context.device);
          const closed = await this.store.closeOpenEpisodes({
            deviceId: context.device.id,
            reason: 'device_not_registered',
          });
          await this.store.cancelPending(closed, 'device_not_registered');
        }
      } else {
        delivery.state = 'FAILED';
        delivery.lastError = 'receipt_failed';
        const context = await this.store.loadContext(delivery.id);
        if (context) {
          context.delivery.state = 'FAILED';
          context.delivery.lastError = 'receipt_failed';
          context.delivery.claimToken = null;
          context.episode.status = 'CLOSED';
          context.episode.openKey = null;
          context.episode.closeReason = 'receipt_failed';
          await this.store.finishDelivery(context.delivery, context.episode);
          continue;
        }
      }
      await this.store.saveDelivery(delivery);
    }
  }

  private async finish(
    context: { delivery: PushDeliveryRow; episode: PushEpisodeRow },
    state: 'CANCELLED' | 'EXPIRED' | 'FAILED' | 'UNKNOWN',
    reason: string,
  ) {
    context.delivery.state = state;
    context.delivery.lastError = reason.slice(0, 80);
    context.delivery.claimToken = null;
    context.episode.status = 'CLOSED';
    context.episode.openKey = null;
    context.episode.closeReason = reason.slice(0, 80);
    await this.store.finishDelivery(context.delivery, context.episode);
  }
}
