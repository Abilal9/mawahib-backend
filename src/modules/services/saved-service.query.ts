import { Prisma, ServiceOfferingStatus } from '@prisma/client';
import { SaveCursor, saveKeyset } from '../../common/save-cursor';

export function canSaveService(input: {
  status: ServiceOfferingStatus;
  deletedAt: Date | null;
  ownerDeletedAt: Date | null;
}): boolean {
  return (
    input.status === ServiceOfferingStatus.published &&
    input.deletedAt === null &&
    input.ownerDeletedAt === null
  );
}

export function savedServiceWhere(
  viewerId: string,
  cursor: SaveCursor | null,
): Prisma.ServiceSaveWhereInput {
  return {
    userId: viewerId,
    service: {
      status: ServiceOfferingStatus.published,
      deletedAt: null,
      user: { deletedAt: null },
    },
    ...saveKeyset('serviceId', cursor),
  };
}
