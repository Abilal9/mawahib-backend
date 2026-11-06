import { StaffMembershipNotReadyError, StaffMembershipService } from './staff-membership.service';

describe('staff membership writes', () => {
  const service = new StaffMembershipService({} as never);
  const actor = { unverifiedProcessUser: 'local-tester' };

  it('does not reserve a product subject', async () => {
    await expect(service.holdProductSubject('33333333-3333-4333-8333-333333333333')).rejects.toBeInstanceOf(
      StaffMembershipNotReadyError,
    );
  });

  it('does not record a subject-only pending membership', async () => {
    await expect(
      service.provisionPending('33333333-3333-4333-8333-333333333333', actor),
    ).rejects.toBeInstanceOf(StaffMembershipNotReadyError);
  });

  it('does not look up staff by subject alone', async () => {
    await expect(service.findBySubject('33333333-3333-4333-8333-333333333333')).rejects.toBeInstanceOf(
      StaffMembershipNotReadyError,
    );
  });
});
