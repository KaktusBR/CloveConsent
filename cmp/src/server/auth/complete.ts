// When a session counts as signed in (src/server/auth/guard.ts and the account endpoints use this).

/**
 * A complete session: the email address is verified and, for a user with two-factor authentication on,
 * the session was created by its second step (TOTP or backup code) or by a passkey (or replaced one that
 * was). Anything else, including a sign-in still waiting for its code, is no session.
 */
export function isComplete(found: { user: { emailVerified: boolean; twoFactorEnabled?: boolean | null | undefined }; session: { secondFactor?: unknown } }): boolean {
  if (!found.user.emailVerified) return false
  return !found.user.twoFactorEnabled || found.session.secondFactor === true
}
