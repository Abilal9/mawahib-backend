/** Canonical default for Profile.title when none is provided. */
export const DEFAULT_PROFILE_TITLE = 'Creative Professional';

/**
 * Normalize a profile title for persistence.
 * Empty / whitespace / null → canonical default.
 */
export function normalizeProfileTitle(
  title: string | null | undefined,
): string {
  const trimmed = title?.trim();
  return trimmed ? trimmed : DEFAULT_PROFILE_TITLE;
}
