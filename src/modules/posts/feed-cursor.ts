import type { FeedCursorState, FeedPoolCursor } from './repositories/posts.repository';

export function encodeFeedCursor(state: FeedCursorState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
}

export function decodeFeedCursor(raw?: string | null): FeedCursorState {
  if (!raw) {
    return { version: 1, social: null, discovery: null };
  }
  try {
    const parsed = JSON.parse(
      Buffer.from(raw, 'base64url').toString('utf8'),
    ) as FeedCursorState;
    if (parsed?.version !== 1) {
      return { version: 1, social: null, discovery: null };
    }
    return {
      version: 1,
      social: normalizePool(parsed.social),
      discovery: normalizePool(parsed.discovery),
    };
  } catch {
    return { version: 1, social: null, discovery: null };
  }
}

function normalizePool(value: unknown): FeedPoolCursor | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as FeedPoolCursor;
  if (typeof v.createdAt !== 'string' || typeof v.id !== 'string') return null;
  return { createdAt: v.createdAt, id: v.id };
}

export function poolCursorFromPost(post: {
  createdAt: Date;
  id: string;
}): FeedPoolCursor {
  return { createdAt: post.createdAt.toISOString(), id: post.id };
}
