const FROM = 'Mawahib <no-reply@mawahib.io>';
const TIMEOUT_MS = 10_000;

/** accepted: the provider took the message. That is not proof it was delivered or read. */
export type CompletionMailResult = 'accepted' | 'retry' | 'uncertain';

export type CompletionMailer = {
  send(input: { to: string; idempotencyKey: string }): Promise<CompletionMailResult>;
};

export function completionMailerFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = globalThis.fetch,
): CompletionMailer | undefined {
  const apiKey = env.RESEND_API_KEY?.trim();
  if (!apiKey) return undefined;
  return new ResendCompletionMailer(apiKey, fetchImpl);
}

export class ResendCompletionMailer implements CompletionMailer {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch,
  ) {}

  async send(input: { to: string; idempotencyKey: string }): Promise<CompletionMailResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'Idempotency-Key': `deletion-complete/${input.idempotencyKey}`,
        },
        body: JSON.stringify({
          from: FROM,
          to: [input.to],
          subject: 'Your Mawahib account has been deleted',
          text: completionText(),
        }),
      });
      if (response.ok) return 'accepted';
      if (response.status === 408 || response.status === 409 || response.status >= 500) return 'uncertain';
      return 'retry';
    } catch {
      return 'uncertain';
    } finally {
      clearTimeout(timer);
    }
  }
}

function completionText(): string {
  return [
    'Your Mawahib account deletion has completed.',
    'Your profile and personal content were removed, and this sign-in can no longer be used.',
    'Shared chats, invoices, payment records, and support records that other people or Mawahib still need were kept. Those retained messages, images, and records can still contain historical personal information.',
    'This message does not mean every copy of personal information was erased. Acceptance of this message by the mail provider is not proof that you received or read it.',
    'Questions: support@mawahib.io',
  ].join('\n\n');
}
