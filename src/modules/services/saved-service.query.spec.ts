import { ServiceOfferingStatus } from '@prisma/client';
import { canSaveService, savedServiceWhere } from './saved-service.query';

describe('saved service visibility', () => {
  it('allows a published offering with a live owner', () => {
    expect(
      canSaveService({
        status: ServiceOfferingStatus.published,
        deletedAt: null,
        ownerDeletedAt: null,
      }),
    ).toBe(true);
  });

  it.each([ServiceOfferingStatus.draft, ServiceOfferingStatus.archived])(
    'rejects %s',
    (status) => {
      expect(
        canSaveService({ status, deletedAt: null, ownerDeletedAt: null }),
      ).toBe(false);
    },
  );

  it('rejects a soft-deleted offering or owner', () => {
    expect(
      canSaveService({
        status: ServiceOfferingStatus.published,
        deletedAt: new Date(),
        ownerDeletedAt: null,
      }),
    ).toBe(false);
    expect(
      canSaveService({
        status: ServiceOfferingStatus.published,
        deletedAt: null,
        ownerDeletedAt: new Date(),
      }),
    ).toBe(false);
  });

  it('filters published live owners inside the paged query', () => {
    const where = savedServiceWhere('viewer', {
      createdAt: '2026-06-01T00:00:00.000Z',
      id: 'svc-b',
    });
    expect(where).toMatchObject({
      userId: 'viewer',
      service: {
        status: ServiceOfferingStatus.published,
        deletedAt: null,
        user: { deletedAt: null },
      },
    });
    expect(where.OR?.[1]).toMatchObject({ serviceId: { lt: 'svc-b' } });
  });
});
