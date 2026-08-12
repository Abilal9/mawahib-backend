import { createHash } from 'crypto';

/** Deterministic UUIDv4-shaped id for idempotent seed rows. */
export function seedId(label: string): string {
  const hash = createHash('sha256')
    .update(`mawahib.dev.seed.v2:${label}`)
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
