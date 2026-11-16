import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Locks each asset and refuses one that closure has already marked deleted. */
export async function assertAssetAttachable(
  tx: Prisma.TransactionClient,
  assetIds: string[],
): Promise<void> {
  for (const assetId of [...new Set(assetIds)].sort()) {
    const rows = await tx.$queryRaw<Array<{ deleted_at: Date | null }>>`
      SELECT deleted_at FROM media_assets WHERE id = ${assetId}::uuid FOR UPDATE
    `;
    if (!rows[0] || rows[0].deleted_at) {
      throw new ConflictException({
        statusCode: 409,
        code: 'FILE_UNAVAILABLE',
        message: 'This file is no longer available.',
      });
    }
  }
}
