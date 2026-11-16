import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { SupabaseService } from '../../infrastructure/supabase/supabase.service';
import { completionMailerFromEnv, type CompletionMailer, type CompletionMailResult } from './completion-mail';

const CLAIM_STALE_MS = 2 * 60 * 1000;
const EMAIL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const POLL_MS = 20_000;

type CleanupClient = {
  deleteAuthUser(userId: string): Promise<'deleted' | 'missing' | 'unavailable'>;
  removeStoredObject(bucket: string, objectKey: string): Promise<'removed' | 'missing' | 'unavailable'>;
};

@Injectable()
export class DeletionCleanupRunner implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DeletionCleanupRunner.name);
  private timer: NodeJS.Timeout | null = null;

  private readonly mailer: CompletionMailer | undefined;

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabase: SupabaseService,
  ) {
    this.mailer = completionMailerFromEnv();
  }

  onModuleInit() {
    if (process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => {
      void this.runOnce().catch((error: unknown) => {
        this.logger.warn(
          `Deletion cleanup pass failed: ${error instanceof Error ? error.name : 'unknown'}`,
        );
      });
    }, POLL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(client: CleanupClient = this.supabase, mailer: CompletionMailer | undefined = this.mailer): Promise<void> {
    const task = await this.claimNext();
    if (!task) return;
    try {
      await this.perform(task, client, mailer);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'cleanup_failed';
      await this.defer(task.id, message.slice(0, 500), task.attempts);
    }
  }

  async statusFor(userId: string) {
    const request = await this.prisma.accountDeletionRequest.findFirst({
      where: { userId, status: 'closed' },
      orderBy: { closedAt: 'desc' },
      select: {
        id: true,
        closedAt: true,
        completionEmail: true,
        completionEmailExpiresAt: true,
      },
    });
    if (!request) return { status: 'none' as const, closureEnabled: process.env.ACCOUNT_DELETION_CLOSURE_ENABLED === 'true' };
    const tasks = await this.prisma.accountDeletionCleanupTask.findMany({
      where: { requestId: request.id },
      orderBy: { createdAt: 'asc' },
    });
    const required = tasks.filter((task) => task.kind !== 'completion_email');
    const cleanupComplete = required.length > 0 && required.every((task) => task.status === 'succeeded');
    return {
      status: cleanupComplete ? ('cleanup_complete' as const) : ('processing' as const),
      closureEnabled: process.env.ACCOUNT_DELETION_CLOSURE_ENABLED === 'true',
      closedAt: request.closedAt?.toISOString() ?? null,
      hasCompletionDestination: request.completionEmail != null,
      completionEmailExpiresAt: request.completionEmailExpiresAt?.toISOString() ?? null,
      tasks: tasks.map((task) => ({
        id: task.id,
        kind: task.kind,
        status: task.status,
        attempts: task.attempts,
        lastError: task.lastError,
        nextAttemptAt: task.nextAttemptAt?.toISOString() ?? null,
        completedAt: task.completedAt?.toISOString() ?? null,
        bucket: task.bucket,
        objectKey: task.objectKey,
      })),
    };
  }

  async retry(userId: string, taskId: string) {
    const task = await this.prisma.accountDeletionCleanupTask.findFirst({
      where: { id: taskId, userId, status: 'pending' },
    });
    if (!task) return { outcome: 'unchanged' as const };
    await this.prisma.accountDeletionCleanupTask.update({
      where: { id: task.id },
      data: { nextAttemptAt: new Date(), claimedAt: null, claimToken: null },
    });
    return { outcome: 'queued' as const };
  }

  private async claimNext() {
    const now = new Date();
    const stale = new Date(now.getTime() - CLAIM_STALE_MS);
    const candidate = await this.prisma.accountDeletionCleanupTask.findFirst({
      where: {
        status: 'pending',
        AND: [
          { OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] },
          { OR: [{ claimedAt: null }, { claimedAt: { lt: stale } }] },
        ],
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!candidate) return null;
    const token = randomUUID();
    const claimed = await this.prisma.accountDeletionCleanupTask.updateMany({
      where: {
        id: candidate.id,
        status: 'pending',
        OR: [{ claimToken: candidate.claimToken }, { claimToken: null }],
      },
      data: { claimToken: token, claimedAt: now, attempts: { increment: 1 } },
    });
    if (claimed.count !== 1) return null;
    return this.prisma.accountDeletionCleanupTask.findUnique({ where: { id: candidate.id } });
  }

  private async perform(
    task: NonNullable<Awaited<ReturnType<DeletionCleanupRunner['claimNext']>>>,
    client: CleanupClient,
    mailer?: CompletionMailer,
  ) {
    if (task.kind === 'completion_email') {
      await this.performEmail(task, mailer);
      return;
    }
    if (task.kind === 'auth_user') {
      const result = await client.deleteAuthUser(task.userId);
      if (result === 'unavailable') {
        await this.defer(task.id, 'auth_admin_unavailable', task.attempts);
        return;
      }
      await this.succeed(task.id, result === 'missing' ? 'not_found' : null);
      return;
    }
    if (!task.bucket || !task.objectKey) {
      await this.defer(task.id, 'storage_key_missing', task.attempts);
      return;
    }
    const decision = await this.reserveUnreferenced(task.bucket, task.objectKey);
    if (decision !== 'clear') {
      await this.succeed(task.id, decision === 'missing' ? 'not_found' : 'reference_retained');
      return;
    }
    const result = await client.removeStoredObject(task.bucket, task.objectKey);
    if (result === 'unavailable') {
      await this.defer(task.id, 'storage_unavailable', task.attempts);
      return;
    }
    await this.succeed(task.id, result === 'missing' ? 'not_found' : null);
  }

  private async reserveUnreferenced(bucket: string, objectKey: string) {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id::text AS id FROM media_assets
        WHERE bucket = ${bucket} AND object_key = ${objectKey}
        FOR UPDATE
      `;
      const asset = rows[0];
      if (!asset) return 'missing' as const;
      const [invoice, message, workFile, review, service, post, portfolio] = await Promise.all([
        tx.invoice.findFirst({ where: { documentMediaAssetId: asset.id }, select: { id: true } }),
        tx.messageAttachment.findFirst({ where: { mediaAssetId: asset.id }, select: { id: true } }),
        tx.workRequestAttachment.findFirst({ where: { mediaAssetId: asset.id }, select: { id: true } }),
        tx.engagementReviewMedia.findFirst({ where: { mediaAssetId: asset.id }, select: { id: true } }),
        tx.serviceMedia.findFirst({ where: { mediaAssetId: asset.id }, select: { id: true } }),
        tx.postMedia.findFirst({ where: { mediaAssetId: asset.id }, select: { id: true } }),
        tx.portfolioMedia.findFirst({ where: { mediaAssetId: asset.id }, select: { id: true } }),
      ]);
      if (invoice || message || workFile || review || service || post || portfolio) {
        await tx.mediaAsset.update({ where: { id: asset.id }, data: { deletedAt: null } });
        return 'referenced' as const;
      }
      await tx.mediaAsset.update({
        where: { id: asset.id },
        data: { deletedAt: new Date() },
      });
      return 'clear' as const;
    });
  }

  private async performEmail(
    task: { id: string; requestId: string; attempts: number },
    mailer?: CompletionMailer,
  ) {
    const pendingRequired = await this.prisma.accountDeletionCleanupTask.count({
      where: { requestId: task.requestId, kind: { not: 'completion_email' }, status: 'pending' },
    });
    if (pendingRequired > 0) {
      await this.defer(task.id, 'waiting_for_cleanup', task.attempts, 60_000);
      return;
    }
    const request = await this.prisma.accountDeletionRequest.findUnique({
      where: { id: task.requestId },
    });
    if (!request) {
      await this.succeed(task.id, 'request_missing');
      return;
    }
    if (!mailer) {
      await this.defer(task.id, 'mail_transport_not_configured', task.attempts, 60 * 60 * 1000);
      return;
    }
    if (!request.completionEmail) {
      await this.succeed(task.id, 'destination_removed');
      return;
    }
    const now = new Date();
    let expires = request.completionEmailExpiresAt;
    if (!expires) {
      expires = new Date(now.getTime() + EMAIL_WINDOW_MS);
      await this.prisma.accountDeletionRequest.update({
        where: { id: request.id },
        data: { completionEmailExpiresAt: expires },
      });
    }
    if (now.getTime() >= expires.getTime()) {
      await this.prisma.accountDeletionRequest.update({
        where: { id: request.id },
        data: { completionEmail: null },
      });
      await this.succeed(task.id, 'window_elapsed_unsent');
      return;
    }
    let result: CompletionMailResult;
    try {
      result = await mailer.send({ to: request.completionEmail, idempotencyKey: task.id });
    } catch {
      result = 'uncertain';
    }
    if (result === 'accepted') {
      await this.prisma.accountDeletionRequest.update({
        where: { id: request.id },
        data: { completionEmail: null },
      });
      await this.succeed(task.id, 'provider_accepted');
      return;
    }
    await this.defer(
      task.id,
      result === 'uncertain' ? 'mail_response_uncertain' : 'mail_delivery_failed',
      task.attempts,
      60 * 60 * 1000,
    );
  }

  private async succeed(id: string, lastError: string | null) {
    await this.prisma.accountDeletionCleanupTask.update({
      where: { id },
      data: {
        status: 'succeeded',
        completedAt: new Date(),
        lastError,
        claimToken: null,
        nextAttemptAt: null,
      },
    });
  }

  private async defer(id: string, lastError: string, attempts: number, delayMs?: number) {
    const wait = delayMs ?? Math.min(6 * 60 * 60 * 1000, Math.max(60_000, attempts * 15 * 60 * 1000));
    await this.prisma.accountDeletionCleanupTask.update({
      where: { id },
      data: {
        lastError: lastError.slice(0, 500),
        nextAttemptAt: new Date(Date.now() + wait),
        claimToken: null,
        claimedAt: null,
      },
    });
  }
}
