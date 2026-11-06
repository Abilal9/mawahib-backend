/**
 * Rejects a JWT only when an AMR entry is explicitly `recovery`.
 *
 * The observed signup verification and the observed six-digit recovery
 * code both carried method `otp`. Treating every `otp` token as recovery
 * would block legitimate signup, so this check does not do that. For an
 * active account, that hosted recovery OTP session is admitted to ordinary
 * private APIs. Account status, ownership, participation, and the other
 * authorization checks still apply.
 *
 * The frontend recovery lock keeps that app instance on the recovery flow
 * and blocks its own product calls. It is an app restriction, not a
 * server-enforced recovery-session boundary, and it does not stop a direct
 * request. No additional recovery classifier is introduced here.
 *
 * Accepted for the current feature scope: control of the recovery inbox
 * allows use of that session before the password is changed, while the
 * original password and other sessions may remain usable. Real payments,
 * payouts, bank-detail changes, account deletion, and other high-impact
 * capabilities need a separate step-up assessment before launch.
 */
export function isRecoveryJwt(payload: { amr?: unknown }): boolean {
  const amr = payload.amr;
  if (!Array.isArray(amr)) return false;
  return amr.some((entry) => {
    if (typeof entry === 'string') return entry === 'recovery';
    if (entry && typeof entry === 'object' && 'method' in entry) {
      return (entry as { method?: unknown }).method === 'recovery';
    }
    return false;
  });
}
