import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, StaffMembershipStatus, StaffRole } from '@prisma/client';
import { SELF_ACTION_FORBIDDEN, STAFF_ACCESS_DENIED } from '../../common/auth/admission.codes';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { DeletionEligibilityService } from './deletion-eligibility.service';
import { hasRecentAuthentication } from './recent-auth';

const CONFIRMATION = 'Delete this account';

export function closureEnabled(): boolean {
  return process.env.ACCOUNT_DELETION_CLOSURE_ENABLED === 'true';
}

type StaffActor = { issuer: string; subjectId: string };

@Injectable()
export class DeletionClosureService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eligibility: DeletionEligibilityService,
  ) {}

  confirmSelf(
    userId: string,
    idempotencyKey: string,
    issuedAtSeconds: number | undefined,
    confirmation: string,
  ) {
    this.requireEnabled();
    if (confirmation !== CONFIRMATION) {
      throw new ConflictException({
        statusCode: 409,
        code: 'CONFIRMATION_REQUIRED',
        message: 'Type the confirmation exactly.',
      });
    }
    if (!hasRecentAuthentication(issuedAtSeconds)) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'RECENT_AUTH_REQUIRED',
        message: 'Sign in again before deleting this account.',
      });
    }
    return this.close(userId, {
      origin: 'self',
      idempotencyKey: cleanKey(idempotencyKey),
    });
  }

  confirmStaff(
    actor: StaffActor,
    userId: string,
    body: { reason: string; confirmedEmail: string; idempotencyKey: string },
  ) {
    this.requireEnabled();
    const reason = body.reason.trim();
    if (reason.length < 3 || reason.length > 500) {
      throw new ConflictException({
        statusCode: 409,
        code: 'REASON_REQUIRED',
        message: 'A staff reason is required.',
      });
    }
    return this.close(userId, {
      origin: 'staff',
      idempotencyKey: cleanKey(body.idempotencyKey),
      actor,
      reason,
      confirmedEmail: body.confirmedEmail.trim().toLowerCase(),
    });
  }

  private requireEnabled() {
    if (!closureEnabled()) {
      throw new ConflictException({
        statusCode: 409,
        code: 'CLOSURE_NOT_ENABLED',
        message: 'Final deletion is not available yet.',
      });
    }
  }

  private async close(
    userId: string,
    input: {
      origin: 'self' | 'staff';
      idempotencyKey: string;
      actor?: StaffActor;
      reason?: string;
      confirmedEmail?: string;
    },
  ) {
    return this.prisma.$transaction(async (tx) => {
      const replay = await tx.accountDeletionRequest.findFirst({
        where: { userId, closureIdempotencyKey: input.idempotencyKey, status: 'closed' },
      });
      if (replay) return { outcome: 'replayed' as const, status: 'processing' as const };

      let staffMemberId: string | null = null;
      if (input.origin === 'staff' && input.actor) {
        const member = await lockStaff(tx, input.actor.issuer, input.actor.subjectId);
        if (
          !member ||
          member.status !== StaffMembershipStatus.active ||
          member.role !== StaffRole.operator
        ) {
          throw new ForbiddenException({
            statusCode: 403,
            code: STAFF_ACCESS_DENIED,
            message: 'Staff access is required.',
          });
        }
        if (member.linkedProductUserId === userId) {
          throw new ForbiddenException({
            statusCode: 403,
            code: SELF_ACTION_FORBIDDEN,
            message: 'An operator cannot delete the linked product account from this session.',
          });
        }
        staffMemberId = member.id;
      }

      await tx.$queryRaw`
        SELECT id FROM work_engagements
        WHERE deleted_at IS NULL
          AND (client_id = ${userId}::uuid OR provider_id = ${userId}::uuid)
        ORDER BY id
        FOR UPDATE
      `;
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({
        where: { id: userId },
        include: { profile: true },
      });
      const closedAgain = await tx.accountDeletionRequest.findFirst({
        where: { userId, closureIdempotencyKey: input.idempotencyKey, status: 'closed' },
      });
      if (closedAgain) return { outcome: 'replayed' as const, status: 'processing' as const };
      if (!user || user.deletedAt) {
        throw new UnauthorizedException({
          statusCode: 401,
          code: 'ACCOUNT_UNAVAILABLE',
          message: 'This account is unavailable.',
        });
      }
      if (input.origin === 'staff' && input.confirmedEmail !== user.email.toLowerCase()) {
        throw new ConflictException({
          statusCode: 409,
          code: 'CONFIRMATION_REQUIRED',
          message: 'Confirm the exact account email.',
        });
      }

      const decision = await this.eligibility.evaluateInTransaction(tx, userId);
      if (decision.status !== 'eligible') {
        throw new ConflictException({
          statusCode: 409,
          code: decision.status === 'unavailable' ? 'ELIGIBILITY_UNAVAILABLE' : 'DELETION_BLOCKED',
          message: 'Deletion cannot proceed.',
          blockers: decision.status === 'blocked' ? decision.blockers : [],
        });
      }
      await requireInvoiceSnapshots(tx, userId);

      const request = await ensureOrigin(tx, userId, input, staffMemberId);
      const reviewAssetIds = await reviewAssetIdsFor(tx, userId);
      await removePersonalContent(tx, userId, user.displayName, user.username);
      const fileKeys = await deletableFileKeys(tx, userId, reviewAssetIds);
      const now = new Date();
      await tx.user.update({
        where: { id: userId },
        data: {
          deletedAt: now,
          email: `deleted+${userId}@invalid.mawahib`,
          username: `deleted_${userId.replaceAll('-', '').slice(0, 24)}`,
          displayName: 'Deleted user',
          isVerified: false,
        },
      });
      if (user.profile) {
        await tx.profile.update({
          where: { userId },
          data: {
            bio: '',
            title: null,
            avatarUrl: null,
            coverUrl: null,
            phoneE164: null,
            phoneVerified: false,
            aboutJson: Prisma.JsonNull,
            locationCity: null,
            locationCountry: null,
            countryCode: null,
            locationCode: null,
          },
        });
      }
      await tx.userSkill.deleteMany({ where: { userId } });
      await tx.accountDeletionRequest.update({
        where: { id: request.id },
        data: {
          status: 'closed',
          closedAt: now,
          closureIdempotencyKey: input.idempotencyKey,
          completionEmail: user.email,
        },
      });
      await tx.accountDeletionCleanupTask.create({
        data: { requestId: request.id, userId, kind: 'auth_user' },
      });
      if (fileKeys.length) {
        await tx.accountDeletionCleanupTask.createMany({
          data: fileKeys.map((file) => ({
            requestId: request.id,
            userId,
            kind: 'storage_object' as const,
            bucket: file.bucket,
            objectKey: file.objectKey,
          })),
        });
      }
      await tx.accountDeletionCleanupTask.create({
        data: { requestId: request.id, userId, kind: 'completion_email' },
      });
      if (fileKeys.length) {
        for (const file of fileKeys) {
          await tx.mediaAsset.updateMany({
            where: { bucket: file.bucket, objectKey: file.objectKey },
            data: { deletedAt: now },
          });
        }
      }
      if (input.origin === 'staff' && staffMemberId && input.actor && input.reason) {
        await tx.staffAuditEvent.create({
          data: {
            action: 'account_deleted',
            targetSubjectId: userId,
            targetAccountId: userId,
            actorSubjectId: input.actor.subjectId,
            actorStaffMemberId: staffMemberId,
            reason: input.reason,
          },
        });
      }
      return { outcome: 'closed' as const, status: 'processing' as const };
    });
  }
}

function cleanKey(value: string): string {
  const key = value.trim();
  if (!key || key.length > 128) {
    throw new ConflictException({
      statusCode: 409,
      code: 'REQUEST_KEY_REQUIRED',
      message: 'A request key is required.',
    });
  }
  return key;
}

async function lockStaff(
  tx: Prisma.TransactionClient,
  issuer: string,
  subjectId: string,
) {
  const rows = await tx.$queryRaw<
    Array<{
      id: string;
      status: StaffMembershipStatus;
      role: StaffRole;
      linked_product_user_id: string | null;
    }>
  >`
    SELECT id::text AS id,
           status::text AS status,
           role::text AS role,
           linked_product_user_id::text AS linked_product_user_id
    FROM staff_members
    WHERE issuer = ${issuer}
      AND subject_id = CAST(${subjectId} AS uuid)
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    role: row.role,
    linkedProductUserId: row.linked_product_user_id,
  };
}

async function ensureOrigin(
  tx: Prisma.TransactionClient,
  userId: string,
  input: {
    origin: 'self' | 'staff';
    reason?: string;
    actor?: StaffActor;
  },
  staffMemberId: string | null,
) {
  const pending = await tx.accountDeletionRequest.findFirst({
    where: { userId, status: 'pending' },
  });
  if (input.origin === 'self') {
    if (!pending?.selfRequestedAt) {
      throw new ConflictException({
        statusCode: 409,
        code: 'DELETION_ORIGIN_REQUIRED',
        message: 'Confirm deletion from your own request.',
      });
    }
    return pending;
  }
  if (!staffMemberId) {
    throw new ForbiddenException({
      statusCode: 403,
      code: STAFF_ACCESS_DENIED,
      message: 'Staff access is required.',
    });
  }
  const now = new Date();
  if (!pending) {
    return tx.accountDeletionRequest.create({
      data: {
        userId,
        status: 'pending',
        staffRequestedAt: now,
        staffMemberId,
        staffReason: input.reason,
      },
    });
  }
  if (pending.staffMemberId && pending.staffMemberId !== staffMemberId) {
    throw new ConflictException({
      statusCode: 409,
      code: 'DELETION_ORIGIN_REQUIRED',
      message: 'Another staff request is already active for this account.',
    });
  }
  if (!pending.staffRequestedAt) {
    return tx.accountDeletionRequest.update({
      where: { id: pending.id },
      data: {
        staffRequestedAt: now,
        staffMemberId,
        staffReason: input.reason,
      },
    });
  }
  return pending;
}

async function requireInvoiceSnapshots(tx: Prisma.TransactionClient, userId: string) {
  const payments = await tx.payment.findMany({
    where: {
      status: 'succeeded',
      OR: [{ payerUserId: userId }, { payeeUserId: userId }],
    },
    include: { invoice: { select: { payerDisplayName: true, payeeDisplayName: true, description: true } } },
  });
  for (const payment of payments) {
    const snapshot = payment.invoice;
    if (
      snapshot?.payerDisplayName &&
      snapshot.payeeDisplayName &&
      snapshot.description != null
    ) {
      continue;
    }
    throw new ConflictException({
      statusCode: 409,
      code: 'INVOICE_SNAPSHOT_UNAVAILABLE',
      message:
        'A succeeded payment has no truthful invoice snapshot. Deletion will not invent historical names.',
      paymentId: payment.id,
    });
  }
}

async function reviewAssetIdsFor(tx: Prisma.TransactionClient, userId: string) {
  const media = await tx.engagementReviewMedia.findMany({
    where: { review: { OR: [{ reviewerId: userId }, { revieweeId: userId }] } },
    select: { mediaAssetId: true },
  });
  return media.map((row) => row.mediaAssetId);
}

function scrubName(value: string, displayName: string, username: string): string {
  let next = value;
  if (displayName.trim()) next = next.split(displayName).join('Deleted user');
  if (username.trim()) next = next.split(username).join('Deleted user');
  return next;
}

async function removePersonalContent(
  tx: Prisma.TransactionClient,
  userId: string,
  displayName: string,
  username: string,
) {
  const now = new Date();
  await tx.conversation.updateMany({
    where: { participants: { some: { userId } } },
    data: { archivedAt: now },
  });
  await tx.connection.updateMany({
    where: { OR: [{ userLowId: userId }, { userHighId: userId }], endedAt: null },
    data: { endedAt: now },
  });
  await tx.connectionRequest.deleteMany({
    where: { OR: [{ fromUserId: userId }, { toUserId: userId }] },
  });
  await tx.jobListing.updateMany({
    where: { posterId: userId, status: { in: ['draft', 'open'] } },
    data: { status: 'closed' },
  });
  await tx.serviceOffering.updateMany({
    where: { userId, status: { in: ['draft', 'published'] } },
    data: { status: 'archived' },
  });
  await tx.workRequest.updateMany({
    where: {
      status: { in: ['pending', 'changes_requested', 'changes_declined'] },
      OR: [{ senderUserId: userId }, { recipientUserId: userId }],
    },
    data: { status: 'withdrawn' },
  });
  await tx.jobApplication.updateMany({
    where: { applicantId: userId, status: { in: ['submitted', 'under_review'] } },
    data: { status: 'withdrawn', coverLetter: '' },
  });
  await tx.jobApplication.updateMany({
    where: { applicantId: userId },
    data: { coverLetter: '' },
  });
  const reviews = await tx.engagementReview.findMany({
    where: { OR: [{ reviewerId: userId }, { revieweeId: userId }] },
    select: { id: true },
  });
  const reviewIds = reviews.map((row) => row.id);
  if (reviewIds.length) {
    await tx.engagementReviewMedia.deleteMany({ where: { reviewId: { in: reviewIds } } });
    await tx.engagementReview.deleteMany({ where: { id: { in: reviewIds } } });
  }
  await tx.postLike.deleteMany({ where: { userId } });
  await tx.postSave.deleteMany({ where: { userId } });
  await tx.postComment.deleteMany({ where: { authorId: userId } });
  const posts = await tx.post.findMany({ where: { authorId: userId }, select: { id: true } });
  if (posts.length) {
    await tx.post.deleteMany({ where: { id: { in: posts.map((row) => row.id) } } });
  }
  await tx.portfolioProject.deleteMany({ where: { userId } });
  const notes = await tx.notification.findMany({ where: { actorId: userId } });
  for (const note of notes) {
    await tx.notification.update({
      where: { id: note.id },
      data: {
        title: scrubName(note.title, displayName, username),
        body: scrubName(note.body, displayName, username),
      },
    });
  }
  await tx.notification.deleteMany({ where: { recipientId: userId } });
}

async function deletableFileKeys(
  tx: Prisma.TransactionClient,
  userId: string,
  reviewAssetIds: string[],
) {
  const owned = await tx.mediaAsset.findMany({
    where: { ownerId: userId, deletedAt: null },
    select: { id: true, bucket: true, objectKey: true },
  });
  const extra = reviewAssetIds.length
    ? await tx.mediaAsset.findMany({
        where: { id: { in: reviewAssetIds }, deletedAt: null },
        select: { id: true, bucket: true, objectKey: true },
      })
    : [];
  const candidates = new Map<string, { id: string; bucket: string; objectKey: string }>();
  for (const row of [...owned, ...extra]) candidates.set(row.id, row);
  const ids = [...candidates.keys()];
  if (!ids.length) return [];
  const kept = new Set<string>();
  const [invoices, messages, workFiles, reviews, services, posts, portfolio] = await Promise.all([
    tx.invoice.findMany({
      where: { documentMediaAssetId: { in: ids } },
      select: { documentMediaAssetId: true },
    }),
    tx.messageAttachment.findMany({
      where: { mediaAssetId: { in: ids } },
      select: { mediaAssetId: true },
    }),
    tx.workRequestAttachment.findMany({
      where: { mediaAssetId: { in: ids } },
      select: { mediaAssetId: true },
    }),
    tx.engagementReviewMedia.findMany({
      where: { mediaAssetId: { in: ids } },
      select: { mediaAssetId: true },
    }),
    tx.serviceMedia.findMany({
      where: { mediaAssetId: { in: ids } },
      select: { mediaAssetId: true },
    }),
    tx.postMedia.findMany({
      where: { mediaAssetId: { in: ids } },
      select: { mediaAssetId: true },
    }),
    tx.portfolioMedia.findMany({
      where: { mediaAssetId: { in: ids } },
      select: { mediaAssetId: true },
    }),
  ]);
  for (const row of invoices) if (row.documentMediaAssetId) kept.add(row.documentMediaAssetId);
  for (const row of messages) kept.add(row.mediaAssetId);
  for (const row of workFiles) kept.add(row.mediaAssetId);
  for (const row of reviews) kept.add(row.mediaAssetId);
  for (const row of services) kept.add(row.mediaAssetId);
  for (const row of posts) kept.add(row.mediaAssetId);
  for (const row of portfolio) kept.add(row.mediaAssetId);
  return [...candidates.values()]
    .filter((row) => !kept.has(row.id))
    .map((row) => ({ bucket: row.bucket, objectKey: row.objectKey }));
}
