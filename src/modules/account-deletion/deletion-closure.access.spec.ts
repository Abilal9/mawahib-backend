import { DeletionClosureService } from './deletion-closure.service';
import { closureEnabledFor } from './deletion-closure.service';

const allowed = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';

describe('closure allow-user restriction', () => {
  const previousSwitch = process.env.ACCOUNT_DELETION_CLOSURE_ENABLED;
  const previousAllow = process.env.ACCOUNT_DELETION_CLOSURE_ALLOW_USER_ID;
  const service = new DeletionClosureService({} as never, {} as never);

  afterEach(() => {
    restore('ACCOUNT_DELETION_CLOSURE_ENABLED', previousSwitch);
    restore('ACCOUNT_DELETION_CLOSURE_ALLOW_USER_ID', previousAllow);
  });

  function restore(key: string, value: string | undefined) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  it('keeps confirmation unavailable while the global switch is off', async () => {
    delete process.env.ACCOUNT_DELETION_CLOSURE_ENABLED;
    process.env.ACCOUNT_DELETION_CLOSURE_ALLOW_USER_ID = allowed;
    expect(closureEnabledFor(allowed)).toBe(false);
    expect(await rejectionCode(confirm(service, allowed))).toBe('CLOSURE_NOT_ENABLED');
    expect(await rejectionCode(confirmStaff(service, allowed))).toBe('CLOSURE_NOT_ENABLED');
  });

  it('allows only the configured target on both confirmation routes', async () => {
    process.env.ACCOUNT_DELETION_CLOSURE_ENABLED = 'true';
    process.env.ACCOUNT_DELETION_CLOSURE_ALLOW_USER_ID = allowed.toUpperCase();
    expect(closureEnabledFor(allowed)).toBe(true);
    expect(closureEnabledFor(other)).toBe(false);
    expect(await rejectionCode(confirm(service, allowed))).not.toBe('CLOSURE_NOT_ENABLED');
    expect(await rejectionCode(confirmStaff(service, allowed))).not.toBe('CLOSURE_NOT_ENABLED');
    expect(await rejectionCode(confirm(service, other))).toBe('CLOSURE_NOT_ENABLED');
    expect(await rejectionCode(confirmStaff(service, other))).toBe('CLOSURE_NOT_ENABLED');
  });

  it.each(['', '   ', 'not-a-user', '11111111-1111-4111-8111-11111111111'])(
    'refuses every target when the restriction is %j',
    async (value) => {
      process.env.ACCOUNT_DELETION_CLOSURE_ENABLED = 'true';
      process.env.ACCOUNT_DELETION_CLOSURE_ALLOW_USER_ID = value;
      expect(closureEnabledFor(allowed)).toBe(false);
      expect(closureEnabledFor(other)).toBe(false);
      expect(await rejectionCode(confirm(service, allowed))).toBe('CLOSURE_NOT_ENABLED');
      expect(await rejectionCode(confirmStaff(service, other))).toBe('CLOSURE_NOT_ENABLED');
    },
  );
});

async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return 'resolved';
  } catch (error) {
    if (error && typeof error === 'object' && 'getResponse' in error) {
      const body = (error as { getResponse: () => { code?: string } }).getResponse();
      if (body?.code) return body.code;
    }
    return error instanceof Error ? error.name : 'unknown';
  }
}

function confirm(service: DeletionClosureService, userId: string) {
  return Promise.resolve().then(() =>
    service.confirmSelf(userId, 'key-1', Date.now() / 1000, 'Delete this account'),
  );
}

function confirmStaff(service: DeletionClosureService, userId: string) {
  return Promise.resolve().then(() => service.confirmStaff(
    { issuer: 'https://staff.example', subjectId: '33333333-3333-4333-8333-333333333333' },
    userId,
    { reason: 'Controlled test', confirmedEmail: 'person@example.test', idempotencyKey: 'staff-key' },
  ));
}
