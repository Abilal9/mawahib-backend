import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

export const DELETION_REQUEST_PENDING = 'DELETION_REQUEST_PENDING';

const DEFAULT_MESSAGE =
  'A deletion request is pending. Cancel that request before starting new work. Emailing support does not resolve the work.';

export const PAYMENT_DELETION_MESSAGE =
  'A deletion request is pending. Cancel the deletion request, resolve this payment with the existing payment flow, then request deletion again. Emailing support does not resolve the payment.';

/** Locks the product users, then refuses when any of them has a pending deletion request. */
export async function refuseNewObligation(
  tx: Prisma.TransactionClient,
  userIds: string[],
  message = DEFAULT_MESSAGE,
): Promise<void> {
  const ids = [...new Set(userIds)].sort();
  for (const id of ids) {
    await tx.$queryRaw`
      SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE
    `;
  }
  if (ids.length === 0) return;
  const pending = await tx.accountDeletionRequest.findFirst({
    where: { userId: { in: ids }, status: 'pending' },
    select: { id: true },
  });
  if (pending) {
    throw new ConflictException({
      statusCode: 409,
      code: DELETION_REQUEST_PENDING,
      message,
    });
  }
}
