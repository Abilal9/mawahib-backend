import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { isUniqueViolation } from '../../common/prisma-errors';
import {
  DeletionEligibility,
  DeletionEligibilityService,
} from './deletion-eligibility.service';
import { closureEnabled } from './deletion-closure.service';
import { hasRecentAuthentication } from './recent-auth';

const RECENT_AUTH_REQUIRED = 'RECENT_AUTH_REQUIRED';

export type DeletionRequestView = {
  selfOrigin: boolean;
  staffOrigin: boolean;
  restrictionsActive: boolean;
  eligibility: DeletionEligibility;
  closureEnabled: boolean;
};

@Injectable()
export class DeletionRequestService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: DeletionEligibilityService,
  ) {}

  async view(userId: string): Promise<DeletionRequestView> {
    const [eligibility, request] = await Promise.all([
      this.eligibility.evaluate(userId),
      this.prisma.accountDeletionRequest.findFirst({
        where: { userId, status: 'pending' },
        select: { selfRequestedAt: true, staffRequestedAt: true },
      }),
    ]);
    return present(request, eligibility);
  }

  async requestSelf(
    userId: string,
    idempotencyKey: string,
    issuedAtSeconds: number | undefined,
  ): Promise<DeletionRequestView> {
    const key = cleanKey(idempotencyKey);
    if (!hasRecentAuthentication(issuedAtSeconds)) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: RECENT_AUTH_REQUIRED,
        message: 'Sign in again before requesting account deletion.',
      });
    }
    await this.prisma.$transaction((tx) => this.requestInTransaction(tx, userId, key));
    return this.view(userId);
  }

  async cancelSelf(userId: string): Promise<DeletionRequestView> {
    await this.prisma.$transaction((tx) => this.cancelInTransaction(tx, userId));
    return this.view(userId);
  }

  private async requestInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    key: string,
  ) {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true, deletedAt: true } });
    if (!user || user.deletedAt) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'ACCOUNT_UNAVAILABLE',
        message: 'This account is unavailable.',
      });
    }
    const pending = await tx.accountDeletionRequest.findFirst({
      where: { userId, status: 'pending' },
    });
    if (!pending) {
      try {
        await tx.accountDeletionRequest.create({
          data: {
            userId,
            status: 'pending',
            selfRequestedAt: new Date(),
            selfIdempotencyKey: key,
          },
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
      }
      return;
    }
    if (pending.selfRequestedAt) return;
    await tx.accountDeletionRequest.update({
      where: { id: pending.id },
      data: { selfRequestedAt: new Date(), selfIdempotencyKey: key },
    });
  }

  private async cancelInTransaction(tx: Prisma.TransactionClient, userId: string) {
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
    const pending = await tx.accountDeletionRequest.findFirst({
      where: { userId, status: 'pending' },
    });
    if (!pending?.selfRequestedAt) return;
    const staffRemains = pending.staffRequestedAt != null;
    await tx.accountDeletionRequest.update({
      where: { id: pending.id },
      data: staffRemains
        ? { selfRequestedAt: null, selfIdempotencyKey: null }
        : {
            status: 'withdrawn',
            selfRequestedAt: null,
            selfIdempotencyKey: null,
            closedAt: new Date(),
          },
    });
  }
}

function present(
  request: { selfRequestedAt: Date | null; staffRequestedAt: Date | null } | null,
  eligibility: DeletionEligibility,
): DeletionRequestView {
  const selfOrigin = request?.selfRequestedAt != null;
  const staffOrigin = request?.staffRequestedAt != null;
  return {
    selfOrigin,
    staffOrigin,
    restrictionsActive: selfOrigin || staffOrigin,
    eligibility,
    closureEnabled: closureEnabled(),
  };
}

function cleanKey(value: unknown): string {
  const key = typeof value === 'string' ? value.trim() : '';
  if (!key || key.length > 128) {
    throw new BadRequestException('A request key is required.');
  }
  return key;
}
