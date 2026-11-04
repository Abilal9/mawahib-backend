const {
  describeDatabaseTarget,
  runProvisionPendingStaff,
} = require('../../scripts/provision-pending-staff');

describe('pending staff provisioning command', () => {
  const subjectId = '44444444-4444-4444-8444-444444444444';

  it('refuses to run without the explicit flag', async () => {
    await expect(
      runProvisionPendingStaff({
        env: { STAFF_SUBJECT_ID: subjectId },
        staff: { provisionPending: jest.fn() },
      }),
    ).rejects.toThrow(/ALLOW_STAFF_PROVISION=true/);
  });

  it('refuses a subject that is not a UUID and does not call provisioning', async () => {
    const provisionPending = jest.fn();
    await expect(
      runProvisionPendingStaff({
        env: {
          ALLOW_STAFF_PROVISION: 'true',
          STAFF_SUBJECT_ID: 'not-a-uuid',
          DATABASE_URL: 'postgresql://user:secret@127.0.0.1:5432/postgres',
        },
        staff: { provisionPending },
      }),
    ).rejects.toThrow(/STAFF_SUBJECT_ID/);
    expect(provisionPending).not.toHaveBeenCalled();
  });

  it('describes the project reference without its secret and records an unverified process user', async () => {
    const provisionPending = jest.fn().mockResolvedValue({ created: true });
    const outcome = await runProvisionPendingStaff({
      env: {
        ALLOW_STAFF_PROVISION: 'true',
        STAFF_SUBJECT_ID: subjectId,
        STAFF_PROVISION_TARGET: 'exampleproject',
        DATABASE_URL:
          'postgresql://postgres.exampleproject:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
        USER: 'operator-box',
      },
      staff: { provisionPending },
    });
    expect(outcome.target).toEqual({
      configured: true,
      recognized: true,
      database: 'postgres',
      host: 'aws-0-ap-southeast-1.pooler.supabase.com',
      projectRef: 'exampleproject',
      identity: 'exampleproject',
    });
    expect(JSON.stringify(outcome.target)).not.toContain('secret');
    expect(JSON.stringify(outcome.target)).not.toContain('postgresql://');
    expect(provisionPending).toHaveBeenCalledWith(subjectId, {
      unverifiedProcessUser: 'operator-box',
    });
    expect(outcome.result).toEqual({ created: true });
  });

  it('refuses a target mismatch before provisioning', async () => {
    const provisionPending = jest.fn();
    await expect(
      runProvisionPendingStaff({
        env: {
          ALLOW_STAFF_PROVISION: 'true',
          STAFF_SUBJECT_ID: subjectId,
          STAFF_PROVISION_TARGET: 'other-project',
          DATABASE_URL:
            'postgresql://postgres.exampleproject:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
        },
        staff: { provisionPending },
      }),
    ).rejects.toThrow(/does not match/);
    expect(provisionPending).not.toHaveBeenCalled();
  });

  it('does not treat the caller-supplied name as empty when unset', () => {
    const described = describeDatabaseTarget(undefined);
    expect(described).toEqual({ configured: false });
  });
});
