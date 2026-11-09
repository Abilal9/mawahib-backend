export function encodeMessageCursor(sequence: number): string {
  return Buffer.from(JSON.stringify({ v: 2, s: sequence }), 'utf8').toString(
    'base64url',
  );
}

export type DecodedMessageCursor =
  | { kind: 'sequence'; sequence: number }
  | { kind: 'legacy'; id: string };

/**
 * New cursors are `{ v: 2, s: sequence }`.
 * Older cursors are `{ createdAt, id }` and must be resolved to that message's
 * sequence. Media cursors use a different decoder and are not accepted here.
 */
export function decodeMessageCursor(cursor: string): DecodedMessageCursor | null {
  try {
    const raw = JSON.parse(
      Buffer.from(cursor, 'base64url').toString('utf8'),
    ) as { v?: unknown; s?: unknown; id?: unknown; createdAt?: unknown };
    if (raw.v === 2 && Number.isInteger(raw.s) && (raw.s as number) >= 0) {
      return { kind: 'sequence', sequence: raw.s as number };
    }
    if (
      raw.v == null &&
      typeof raw.id === 'string' &&
      raw.id.length > 0 &&
      typeof raw.createdAt === 'string'
    ) {
      return { kind: 'legacy', id: raw.id };
    }
    return null;
  } catch {
    return null;
  }
}
