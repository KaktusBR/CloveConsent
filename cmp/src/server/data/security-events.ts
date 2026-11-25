// A person's security changes in the audit log (ruling R27): password changed or reset, two-factor
// authentication turned on or off, a passkey added or removed. Events of the person, in no account
// (identity data, ruling R2), written by the system role with the person as the actor, after the change
// (Better Auth makes it on its own connection: src/server/auth/auth.ts records it from its hooks). Never a
// secret: no password, code, token or key, only which passkey.
import { appendAuditEvent } from './audit'
import { systemDatabase } from './client'

export type SecurityAction = 'user.password_change' | 'user.password_reset' | 'user.two_factor_enable' | 'user.two_factor_disable' | 'user.passkey_add' | 'user.passkey_remove'

/** Records `action` by `userId` on themselves; `passkey` names the passkey added or removed. */
export function recordSecurityEvent(userId: string, action: SecurityAction, details: { passkey?: string } = {}): Promise<void> {
  const meta = details.passkey === undefined ? {} : { passkey: details.passkey }
  return appendAuditEvent(systemDatabase, { action, target: `user:${userId}`, meta, actorUserId: userId, accountId: null })
}
