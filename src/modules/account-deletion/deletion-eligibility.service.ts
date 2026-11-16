import { Injectable, Logger } from '@nestjs/common';
import { PaymentStatus, WorkEngagementStatus } from '@prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/** Engagement states that do not block deletion by themselves. */
const TERMINAL_ENGAGEMENT_STATUSES = new Set<WorkEngagementStatus>([
  WorkEngagementStatus.declined,
  WorkEngagementStatus.cancelled,
  WorkEngagementStatus.completed,
]);

const UNRESOLVED_PAYMENT_STATUSES = new Set<PaymentStatus>([
  PaymentStatus.pending,
  PaymentStatus.processing,
]);

export const DELETION_BLOCKER = {
  engagementUnresolved: 'engagement_unresolved',
  paymentUnresolved: 'payment_unresolved',
  financialFollowUpOutstanding: 'financial_follow_up_outstanding',
} as const;

export type DeletionBlockerCode =
  (typeof DELETION_BLOCKER)[keyof typeof DELETION_BLOCKER];

export type DeletionBlocker = {
  code: DeletionBlockerCode;
  explanation: string;
  engagementId: string;
  engagementTitle: string;
  engagementStatus: WorkEngagementStatus;
  paymentId: string | null;
};

export type DeletionEligibility =
  | { status: 'eligible'; blockers: [] }
  | { status: 'blocked'; blockers: DeletionBlocker[] }
  | { status: 'unavailable' };

const ENGAGEMENT_EXPLANATION: Partial<Record<WorkEngagementStatus, string>> = {
  [WorkEngagementStatus.pending_payment]:
    'Accepted unpaid work has not been cancelled.',
  [WorkEngagementStatus.in_progress]: 'Work is still in progress.',
  [WorkEngagementStatus.delivered]:
    'Delivered work is still awaiting resolution.',
  [WorkEngagementStatus.disputed]: 'Disputed work is still awaiting resolution.',
};

type EngagementRow = {
  id: string;
  title: string;
  status: WorkEngagementStatus;
  staffClosure: { followUpRequired: boolean; followUpOutcome: string | null } | null;
  payments: Array<{ id: string; status: PaymentStatus }>;
};

@Injectable()
export class DeletionEligibilityService {
  private readonly logger = new Logger(DeletionEligibilityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Read-only. A later confirmation must run its own transactional recheck.
   * A failed lookup is unavailable, never eligible.
   */
  async evaluate(userId: string): Promise<DeletionEligibility> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { id: true },
      });
      if (!user) return { status: 'unavailable' };
      const engagements = await this.prisma.workEngagement.findMany({
        where: {
          deletedAt: null,
          OR: [{ clientId: userId }, { providerId: userId }],
        },
        select: {
          id: true,
          title: true,
          status: true,
          staffClosure: {
            select: { followUpRequired: true, followUpOutcome: true },
          },
          payments: { select: { id: true, status: true } },
        },
      });
      const blockers = this.blockers(engagements);
      if (blockers.length === 0) return { status: 'eligible', blockers: [] };
      return { status: 'blocked', blockers };
    } catch (error) {
      this.logger.error(
        `Deletion eligibility lookup failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      return { status: 'unavailable' };
    }
  }

  private blockers(engagements: EngagementRow[]): DeletionBlocker[] {
    const blockers: DeletionBlocker[] = [];
    for (const engagement of engagements) {
      if (!TERMINAL_ENGAGEMENT_STATUSES.has(engagement.status)) {
        blockers.push({
          code: DELETION_BLOCKER.engagementUnresolved,
          explanation:
            ENGAGEMENT_EXPLANATION[engagement.status] ??
            'This work is not in a state that allows deletion.',
          engagementId: engagement.id,
          engagementTitle: engagement.title,
          engagementStatus: engagement.status,
          paymentId: null,
        });
      }
      if (
        engagement.staffClosure?.followUpRequired &&
        engagement.staffClosure.followUpOutcome == null
      ) {
        blockers.push({
          code: DELETION_BLOCKER.financialFollowUpOutstanding,
          explanation: 'Financial follow-up is still outstanding.',
          engagementId: engagement.id,
          engagementTitle: engagement.title,
          engagementStatus: engagement.status,
          paymentId: null,
        });
      }
      for (const payment of engagement.payments) {
        if (!UNRESOLVED_PAYMENT_STATUSES.has(payment.status)) continue;
        blockers.push({
          code: DELETION_BLOCKER.paymentUnresolved,
          explanation: 'A payment is still pending or processing.',
          engagementId: engagement.id,
          engagementTitle: engagement.title,
          engagementStatus: engagement.status,
          paymentId: payment.id,
        });
      }
    }
    return blockers.sort((a, b) =>
      `${a.engagementId}:${a.code}:${a.paymentId ?? ''}`.localeCompare(
        `${b.engagementId}:${b.code}:${b.paymentId ?? ''}`,
      ),
    );
  }
}
