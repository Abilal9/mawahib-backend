import { completionMailerFromEnv, ResendCompletionMailer } from './completion-mail';

describe('deletion completion mail', () => {
  it('stays unconfigured when no Resend key is present', () => {
    expect(completionMailerFromEnv({})).toBeUndefined();
  });

  it('sends once under a stable idempotency key and treats acceptance as provider acceptance', async () => {
    const calls: Array<{ url: string; idempotencyKey: string; authorization: string }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({
        url,
        idempotencyKey: headers.get('Idempotency-Key') ?? '',
        authorization: headers.get('Authorization') ? 'present' : 'missing',
      });
      return new Response(JSON.stringify({ id: 'email_1' }), { status: 200 });
    }) as typeof fetch;
    const mailer = new ResendCompletionMailer('secret-key', fetchImpl);
    await expect(mailer.send({ to: 'person@example.test', idempotencyKey: 'task-1' })).resolves.toBe('accepted');
    await expect(mailer.send({ to: 'person@example.test', idempotencyKey: 'task-1' })).resolves.toBe('accepted');
    expect(calls.map((call) => call.idempotencyKey)).toEqual([
      'deletion-complete/task-1',
      'deletion-complete/task-1',
    ]);
    expect(calls.every((call) => call.authorization === 'present')).toBe(true);
    expect(JSON.stringify(calls)).not.toContain('secret-key');
  });

  it('treats a timeout as uncertain', async () => {
    const fetchImpl = (async () => {
      throw new Error('The operation was aborted');
    }) as typeof fetch;
    const mailer = new ResendCompletionMailer('secret-key', fetchImpl);
    await expect(mailer.send({ to: 'person@example.test', idempotencyKey: 'task-2' })).resolves.toBe('uncertain');
  });
});
