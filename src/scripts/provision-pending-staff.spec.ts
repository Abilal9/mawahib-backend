const {
  describeDatabaseTarget,
  runProvisionPendingStaff,
} = require('../../scripts/provision-pending-staff');

describe('pending staff provisioning command', () => {
  const subjectId = '44444444-4444-4444-8444-444444444444';

  it('refuses to provision before an issuer-aware membership exists', async () => {
    const provisionPending = jest.fn();
    await expect(
      runProvisionPendingStaff({
        env: {
          ALLOW_STAFF_PROVISION: 'true',
          STAFF_SUBJECT_ID: subjectId,
          STAFF_PROVISION_TARGET: 'exampleproject',
          DATABASE_URL:
            'postgresql://postgres.exampleproject:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
          USER: 'operator-box',
        },
        staff: { provisionPending },
      }),
    ).rejects.toThrow(/include an issuer/);
    expect(provisionPending).not.toHaveBeenCalled();
  });

  it('refuses even when the allow flag is missing', async () => {
    await expect(
      runProvisionPendingStaff({
        env: { STAFF_SUBJECT_ID: subjectId },
        staff: { provisionPending: jest.fn() },
      }),
    ).rejects.toThrow(/include an issuer/);
  });

  it('does not treat the caller-supplied name as empty when unset', () => {
    const described = describeDatabaseTarget(undefined);
    expect(described).toEqual({ configured: false });
  });
});
