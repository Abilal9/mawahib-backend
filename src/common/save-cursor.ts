export type SaveCursor = {
  createdAt: string;
  id: string;
};

export function encodeSaveCursor(createdAt: Date, id: string): string {
  return Buffer.from(
    JSON.stringify({ createdAt: createdAt.toISOString(), id }),
    'utf8',
  ).toString('base64url');
}

export function decodeSaveCursor(raw?: string | null): SaveCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as Partial<SaveCursor>;
    if (
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.id !== 'string'
    ) {
      return null;
    }
    const createdAt = new Date(parsed.createdAt);
    if (Number.isNaN(createdAt.getTime())) return null;
    return { createdAt: parsed.createdAt, id: parsed.id };
  } catch {
    return null;
  }
}

export function savePageLimit(limitRaw?: number): number {
  const limit = limitRaw ?? 20;
  if (!Number.isFinite(limit)) return 20;
  return Math.min(Math.max(Math.trunc(limit), 1), 50);
}

/** Keyset for createdAt DESC, entity id DESC. Ties on createdAt stay ordered. */
export function saveKeyset(
  idField: 'postId' | 'jobId' | 'serviceId',
  cursor: SaveCursor | null,
):
  | {
      OR: [
        { createdAt: { lt: Date } },
        { createdAt: Date; postId?: { lt: string }; jobId?: { lt: string }; serviceId?: { lt: string } },
      ];
    }
  | undefined {
  if (!cursor) return undefined;
  const createdAt = new Date(cursor.createdAt);
  return {
    OR: [
      { createdAt: { lt: createdAt } },
      { createdAt, [idField]: { lt: cursor.id } },
    ],
  };
}
