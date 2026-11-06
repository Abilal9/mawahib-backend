import { StaffMembershipNotReadyError, StaffMembershipService } from './staff-membership.service';

describe('staff membership writes', () => {
  const actor = { unverifiedProcessUser: 'local-tester' };

  it('does not reserve a product subject or write a pending membership', async () => {
    const prisma = { staffMember: { findFirst: jest.fn() }, $queryRaw: jest.fn() };
    const service = new StaffMembershipService(prisma as never);
    await expect(service.holdProductSubject('33333333-3333-4333-8333-333333333333')).rejects.toBeInstanceOf(
      StaffMembershipNotReadyError,
    );
    await expect(
      service.provisionPending('33333333-3333-4333-8333-333333333333', actor),
    ).rejects.toBeInstanceOf(StaffMembershipNotReadyError);
    expect(prisma.staffMember.findFirst).not.toHaveBeenCalled();
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('looks up admission by issuer and subject together', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const service = new StaffMembershipService({ staffMember: { findFirst } } as never);
    await service.findForAdmission('https://staff.example/auth/v1', '33333333-3333-4333-8333-333333333333');
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        issuer: 'https://staff.example/auth/v1',
        subjectId: '33333333-3333-4333-8333-333333333333',
      },
      select: { id: true, issuer: true, subjectId: true, role: true, status: true },
    });
  });
});
