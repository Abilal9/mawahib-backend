export const RECENT_AUTH_WINDOW_MS = 10 * 60 * 1000;

/** The verified token must have been issued recently. A missing time fails closed. */
export function hasRecentAuthentication(
  issuedAtSeconds: number | undefined,
  nowMs = Date.now(),
): boolean {
  if (typeof issuedAtSeconds !== 'number' || !Number.isFinite(issuedAtSeconds)) {
    return false;
  }
  const issuedAtMs = issuedAtSeconds * 1000;
  const age = nowMs - issuedAtMs;
  return age >= -60_000 && age <= RECENT_AUTH_WINDOW_MS;
}
