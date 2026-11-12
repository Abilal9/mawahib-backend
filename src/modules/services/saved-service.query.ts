import { Prisma, ServiceOfferingStatus } from '@prisma/client';
import { SaveCursor, saveKeyset } from '../../common/save-cursor';

export function canSaveService(input: {
  status: ServiceOfferingStatus;
  deletedAt: Date | null;
  ownerDeletedAt: Date | null;
  staffHiddenAt?: Date | null;
  ownerAccountStatus?: string | null;
}): boolean {
  return (
    input.status === ServiceOfferingStatus.published &&
    input.deletedAt === null &&
    input.ownerDeletedAt === null &&
    input.staffHiddenAt == null &&
    (input.ownerAccountStatus == null || input.ownerAccountStatus === 'ACTIVE')
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
      staffHiddenAt: null,
      user: { deletedAt: null, accountStatus: 'ACTIVE' },
    },
    ...saveKeyset('serviceId', cursor),
  };
}
