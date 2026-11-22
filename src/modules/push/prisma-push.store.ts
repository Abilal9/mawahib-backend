import { Injectable } from '@nestjs/common';
import { PushDeliveryState, PushEpisodeStatus, PushPlatform } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
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
      },
      update: {
        userId: device.userId,
        expoPushToken: device.expoPushToken,
        platform: device.platform as PushPlatform,
        viewingConversationId: device.viewingConversationId,
        viewingExpiresAt: device.viewingExpiresAt,
        invalidatedAt: device.invalidatedAt,
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
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "push_deliveries" AS delivery
      SET "claim_token" = ${claimToken}::uuid, "claimed_at" = ${now}
      WHERE delivery."id" = (
        SELECT "id" FROM "push_deliveries"
        WHERE "state" = 'PENDING'
          AND "next_attempt_at" <= ${now}
          AND "expires_at" > ${now}
          AND "claim_token" IS NULL
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

  async sweepStaleSending(before: Date) {
    const result = await this.prisma.pushDelivery.updateMany({
      where: { state: 'SENDING', claimedAt: { lt: before } },
      data: { state: 'UNKNOWN', lastError: 'stale_send', claimToken: null },
    });
    return result.count;
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

  private isUnique(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code: string }).code === 'P2002'
    );
  }
}
