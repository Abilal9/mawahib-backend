import { createHash, randomBytes, timingSafeEqual } from 'crypto';

export type PushRegistrationCredential = {
  registrationGeneration: number;
  detachSecret: string;
};

export function createDetachSecret(): { secret: string; hash: string } {
  const secret = randomBytes(32).toString('base64url');
  return { secret, hash: detachSecretHash(secret) };
}

export function detachSecretHash(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

export function sameSecretHash(stored: string | null, presented: string): boolean {
  const actual = Buffer.from(stored ?? detachSecretHash('missing-registration'), 'hex');
  const given = Buffer.from(detachSecretHash(presented), 'hex');
  if (actual.length !== given.length) return false;
  return timingSafeEqual(actual, given) && stored != null;
}
