import { Injectable } from '@nestjs/common';
import { PushDeliveryState, PushEpisodeStatus, PushPlatform } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { STALE_SEND_MS } from './push-policy';
import {
  PushDeliveryRow,
  PushDeviceRow,
  PushEpisodeRow,
  PushSendContext,
  PushStore,
} from './push.store';

@Injectable()
export class PrismaPushStore implements PushStore {
  constructor(private readonly prisma: PrismaService) {}

  async findDeviceByInstallation(installationId: string) {
    const row = await this.prisma.pushDevice.findUnique({ where: { installationId } });
    return row ? this.device(row) : null;
  }

  async findDeviceByToken(token: string) {
    const row = await this.prisma.pushDevice.findUnique({ where: { expoPushToken: token } });
    return row ? this.device(row) : null;
  }

  async saveDevice(device: PushDeviceRow) {
    await this.prisma.pushDevice.upsert({
      where: { id: device.id },
      create: {
        id: device.id,
        userId: device.userId,
        installationId: device.installationId,
        expoPushToken: device.expoPushToken,
        platform: device.platform as PushPlatform,
        viewingConversationId: device.viewingConversationId,
        viewingExpiresAt: device.viewingExpiresAt,
        invalidatedAt: device.invalidatedAt,
        registrationGeneration: device.registrationGeneration,
        detachSecretHash: device.detachSecretHash,
      },
      update: {
        userId: device.userId,
        expoPushToken: device.expoPushToken,
        platform: device.platform as PushPlatform,
        viewingConversationId: device.viewingConversationId,
        viewingExpiresAt: device.viewingExpiresAt,
        invalidatedAt: device.invalidatedAt,
        registrationGeneration: device.registrationGeneration,
        detachSecretHash: device.detachSecretHash,
      },
    });
  }

  async listActiveDevices(userId: string) {
    const rows = await this.prisma.pushDevice.findMany({
      where: { userId, invalidatedAt: null },
    });
    return rows.map((row) => this.device(row));
  }

  async findOpenEpisode(deviceId: string, conversationId: string) {
    const row = await this.prisma.pushEpisode.findFirst({
      where: { deviceId, conversationId, status: 'OPEN' },
    });
    return row ? this.episode(row) : null;
  }

  async insertEpisode(episode: PushEpisodeRow) {
    try {
      await this.prisma.pushEpisode.create({
        data: {
          id: episode.id,
          deviceId: episode.deviceId,
          recipientUserId: episode.recipientUserId,
          conversationId: episode.conversationId,
          openingMessageId: episode.openingMessageId,
          openingSequence: episode.openingSequence,
          status: 'OPEN',
          openKey: episode.openKey,
        },
      });
      return 'inserted' as const;
    } catch (error) {
      if (this.isUnique(error)) return 'exists' as const;
      throw error;
    }
  }

  async insertDelivery(delivery: PushDeliveryRow) {
    await this.prisma.pushDelivery.create({
      data: {
        id: delivery.id,
        episodeId: delivery.episodeId,
        state: delivery.state as PushDeliveryState,
        attempts: delivery.attempts,
        nextAttemptAt: delivery.nextAttemptAt,
        expiresAt: delivery.expiresAt,
      },
    });
  }

  async closeOpenEpisodes(input: {
    deviceId?: string;
    recipientUserId?: string;
    conversationId?: string;
    readThroughSequence?: number;
    reason: string;
  }) {
    const rows = await this.prisma.pushEpisode.findMany({
      where: {
        status: 'OPEN',
        ...(input.deviceId ? { deviceId: input.deviceId } : {}),
        ...(input.recipientUserId ? { recipientUserId: input.recipientUserId } : {}),
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.readThroughSequence != null
          ? { openingSequence: { lte: input.readThroughSequence } }
          : {}),
      },
      select: { id: true },
    });
    if (rows.length === 0) return [];
    await this.prisma.pushEpisode.updateMany({
      where: { id: { in: rows.map((row) => row.id) } },
      data: { status: 'CLOSED', openKey: null, closedAt: new Date(), closeReason: input.reason },
    });
    return rows.map((row) => row.id);
  }

  async cancelPending(episodeIds: string[], reason: string) {
    if (episodeIds.length === 0) return;
    await this.prisma.pushDelivery.updateMany({
      where: { episodeId: { in: episodeIds }, state: 'PENDING' },
      data: { state: 'CANCELLED', lastError: reason, claimToken: null },
    });
  }

  async claimPending(now: Date, claimToken: string) {
    const stale = new Date(now.getTime() - STALE_SEND_MS);
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "push_deliveries" AS delivery
      SET "claim_token" = ${claimToken}::uuid, "claimed_at" = ${now}
      WHERE delivery."id" = (
        SELECT "id" FROM "push_deliveries"
        WHERE "state" = 'PENDING'
          AND "next_attempt_at" <= ${now}
          AND ("claim_token" IS NULL OR "claimed_at" < ${stale})
        ORDER BY "next_attempt_at" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING delivery."id"::text AS id
    `;
    return rows[0]?.id ?? null;
  }

  async loadContext(deliveryId: string): Promise<PushSendContext | null> {
    const delivery = await this.prisma.pushDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        episode: {
          include: {
            device: true,
            conversation: { select: { archivedAt: true } },
            openingMessage: {
              select: {
                kind: true,
                sender: { select: { displayName: true, deletedAt: true } },
              },
            },
          },
        },
      },
    });
    if (!delivery) return null;
    const recipient = await this.prisma.user.findUnique({
      where: { id: delivery.episode.recipientUserId },
      select: { accountStatus: true, deletedAt: true },
    });
    const participant = await this.prisma.conversationParticipant.findUnique({
      where: {
        conversationId_userId: {
          conversationId: delivery.episode.conversationId,
          userId: delivery.episode.recipientUserId,
        },
      },
      select: { deletedAt: true, lastReadSequence: true },
    });
    return {
      delivery: this.delivery(delivery),
      episode: this.episode(delivery.episode),
      device: this.device(delivery.episode.device),
      recipientSuspended: recipient?.accountStatus === 'SUSPENDED',
      recipientDeleted: recipient?.deletedAt != null,
      participant: participant != null,
      participantDeleted: participant?.deletedAt != null,
      readThroughSequence: participant?.lastReadSequence ?? null,
      conversationArchived: delivery.episode.conversation.archivedAt != null,
      messageIsUser: delivery.episode.openingMessage.kind === 'user',
      senderDisplayName: delivery.episode.openingMessage.sender?.displayName ?? null,
      senderDeleted: delivery.episode.openingMessage.sender?.deletedAt != null,
    };
  }

  async saveDelivery(delivery: PushDeliveryRow) {
    await this.prisma.pushDelivery.update({
      where: { id: delivery.id },
      data: {
        state: delivery.state as PushDeliveryState,
        claimToken: delivery.claimToken,
        claimedAt: delivery.claimedAt,
        attempts: delivery.attempts,
        nextAttemptAt: delivery.nextAttemptAt,
        expiresAt: delivery.expiresAt,
        ticketId: delivery.ticketId,
        receiptCheckAt: delivery.receiptCheckAt,
        lastError: delivery.lastError,
        sentAt: delivery.sentAt,
      },
    });
  }

  async saveEpisode(episode: PushEpisodeRow) {
    await this.prisma.pushEpisode.update({
      where: { id: episode.id },
      data: {
        status: episode.status as PushEpisodeStatus,
        openKey: episode.openKey,
        closeReason: episode.closeReason,
        closedAt: episode.status === 'CLOSED' ? new Date() : null,
      },
    });
  }

  async listReceiptDue(now: Date) {
    const rows = await this.prisma.pushDelivery.findMany({
      where: {
        state: 'SENT',
        ticketId: { not: null },
        receiptCheckAt: { lte: now },
      },
      take: 100,
    });
    return rows.map((row) => this.delivery(row));
  }

  async finishDelivery(delivery: PushDeliveryRow, episode: PushEpisodeRow) {
    await this.prisma.$transaction([
      this.prisma.pushDelivery.update({
        where: { id: delivery.id },
        data: {
          state: delivery.state as PushDeliveryState,
          claimToken: delivery.claimToken,
          claimedAt: delivery.claimedAt,
          attempts: delivery.attempts,
          nextAttemptAt: delivery.nextAttemptAt,
          expiresAt: delivery.expiresAt,
          ticketId: delivery.ticketId,
          receiptCheckAt: delivery.receiptCheckAt,
          lastError: delivery.lastError,
          sentAt: delivery.sentAt,
        },
      }),
      this.prisma.pushEpisode.update({
        where: { id: episode.id },
        data: {
          status: episode.status as PushEpisodeStatus,
          openKey: episode.openKey,
          closeReason: episode.closeReason,
          closedAt: episode.status === 'CLOSED' ? new Date() : null,
        },
      }),
    ]);
  }

  async closeEpisodes(episodeIds: string[], reason: string) {
    if (episodeIds.length === 0) return;
    await this.prisma.pushEpisode.updateMany({
      where: { id: { in: episodeIds }, status: 'OPEN' },
      data: { status: 'CLOSED', openKey: null, closedAt: new Date(), closeReason: reason },
    });
  }

  async sweepStaleSending(before: Date) {
    const rows = await this.prisma.pushDelivery.findMany({
      where: { state: 'SENDING', claimedAt: { lt: before } },
      select: { id: true, episodeId: true },
    });
    if (rows.length === 0) return [];
    const episodeIds = rows.map((row) => row.episodeId);
    await this.prisma.$transaction([
      this.prisma.pushDelivery.updateMany({
        where: { id: { in: rows.map((row) => row.id) }, state: 'SENDING' },
        data: { state: 'UNKNOWN', lastError: 'stale_send', claimToken: null },
      }),
      this.prisma.pushEpisode.updateMany({
        where: { id: { in: episodeIds }, status: 'OPEN' },
        data: {
          status: 'CLOSED',
          openKey: null,
          closedAt: new Date(),
          closeReason: 'interrupted_send',
        },
      }),
    ]);
    return episodeIds;
  }

  private device(row: {
    id: string;
    userId: string;
    installationId: string;
    expoPushToken: string;
    platform: PushPlatform;
    viewingConversationId: string | null;
    viewingExpiresAt: Date | null;
    invalidatedAt: Date | null;
    registrationGeneration: number;
    detachSecretHash: string | null;
  }): PushDeviceRow {
    return {
      id: row.id,
      userId: row.userId,
      installationId: row.installationId,
      expoPushToken: row.expoPushToken,
      platform: row.platform,
      viewingConversationId: row.viewingConversationId,
      viewingExpiresAt: row.viewingExpiresAt,
      invalidatedAt: row.invalidatedAt,
      registrationGeneration: row.registrationGeneration,
      detachSecretHash: row.detachSecretHash,
    };
  }

  private episode(row: {
    id: string;
    deviceId: string;
    recipientUserId: string;
    conversationId: string;
    openingMessageId: string;
    openingSequence: number;
    status: PushEpisodeStatus;
    openKey: string | null;
    closeReason: string | null;
  }): PushEpisodeRow {
    return {
      id: row.id,
      deviceId: row.deviceId,
      recipientUserId: row.recipientUserId,
      conversationId: row.conversationId,
      openingMessageId: row.openingMessageId,
      openingSequence: row.openingSequence,
      status: row.status,
      openKey: row.openKey,
      closeReason: row.closeReason,
    };
  }

  private delivery(row: {
    id: string;
    episodeId: string;
    state: PushDeliveryState;
    claimToken: string | null;
    claimedAt: Date | null;
    attempts: number;
    nextAttemptAt: Date;
    expiresAt: Date;
    ticketId: string | null;
    receiptCheckAt: Date | null;
    lastError: string | null;
    sentAt: Date | null;
  }): PushDeliveryRow {
    return { ...row, state: row.state };
  }

  async insertOutbox(input: {
    id: string;
    messageId: string;
    conversationId: string;
    senderId: string;
    messageCreatedAt: Date;
  }) {
    try {
      await this.prisma.pushOutbox.create({
        data: {
          id: input.id,
          messageId: input.messageId,
          conversationId: input.conversationId,
          senderId: input.senderId,
          messageCreatedAt: input.messageCreatedAt,
          status: 'pending',
          nextAttemptAt: input.messageCreatedAt,
        },
      });
      return 'inserted' as const;
    } catch (error) {
      if (this.isUnique(error)) return 'exists' as const;
      throw error;
    }
  }

  async claimOutbox(now: Date, claimToken: string) {
    const stale = new Date(now.getTime() - STALE_SEND_MS);
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "push_outbox" AS item
      SET "claim_token" = ${claimToken}::uuid, "claimed_at" = ${now}, "attempts" = item."attempts" + 1
      WHERE item."id" = (
        SELECT "id" FROM "push_outbox"
        WHERE "status" = 'pending'
          AND "next_attempt_at" <= ${now}
          AND ("claim_token" IS NULL OR "claimed_at" < ${stale})
        ORDER BY "next_attempt_at" ASC, "id" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING item."id"::text AS id
    `;
    return rows[0]?.id ?? null;
  }

  async loadOutbox(id: string) {
    const row = await this.prisma.pushOutbox.findUnique({
      where: { id },
      include: {
        message: {
          select: {
            sequence: true,
            conversation: { select: { participants: { select: { userId: true } } } },
          },
        },
      },
    });
    if (!row) return null;
    return {
      id: row.id,
      messageId: row.messageId,
      conversationId: row.conversationId,
      senderId: row.senderId,
      messageCreatedAt: row.messageCreatedAt,
      sequence: row.message.sequence,
      recipientIds: row.message.conversation.participants.map((participant) => participant.userId),
      claimToken: row.claimToken,
    };
  }

  async completeOutbox(
    id: string,
    claimToken: string,
    status: 'done' | 'skipped',
    error?: string | null,
  ) {
    await this.prisma.pushOutbox.updateMany({
      where: { id, claimToken },
      data: { status, claimToken: null, lastError: error ?? null },
    });
  }

  async detachIfCurrent(input: {
    installationId: string;
    registrationGeneration: number;
    detachSecretHash: string;
    now: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.pushDevice.updateMany({
        where: {
          installationId: input.installationId,
          registrationGeneration: input.registrationGeneration,
          detachSecretHash: input.detachSecretHash,
          invalidatedAt: null,
        },
        data: {
          invalidatedAt: input.now,
          detachSecretHash: null,
          viewingConversationId: null,
          viewingExpiresAt: null,
        },
      });
      if (updated.count !== 1) return false;
      const device = await tx.pushDevice.findUnique({
        where: { installationId: input.installationId },
        select: { id: true },
      });
      if (!device) return false;
      const episodes = await tx.pushEpisode.findMany({
        where: { deviceId: device.id, status: 'OPEN' },
        select: { id: true },
      });
      if (episodes.length > 0) {
        await tx.pushEpisode.updateMany({
          where: { id: { in: episodes.map((episode) => episode.id) } },
          data: {
            status: 'CLOSED',
            openKey: null,
            closedAt: input.now,
            closeReason: 'signed_out',
          },
        });
        await tx.pushDelivery.updateMany({
          where: { episodeId: { in: episodes.map((episode) => episode.id) }, state: 'PENDING' },
          data: { state: 'CANCELLED', lastError: 'signed_out', claimToken: null },
        });
      }
      return true;
    });
  }

  private isUnique(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === 'P2002'
    );
  }
}
