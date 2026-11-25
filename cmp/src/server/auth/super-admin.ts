// Super-admins and their read-only impersonation.
//
// A super-admin is a person whose address is in SUPER_ADMIN_EMAILS, verified, with two-factor
// authentication on, on a complete session (the second factor passed) that is not itself an
// impersonation. Nothing else makes one (there are no user roles). Everyone else gets a 404
// from every console page and endpoint (src/server/auth/access.ts), so the console never shows that it
// exists; a listed person without two-factor authentication is sent to set it up.
//
// Impersonation (server-only endpoints of ours, src/server/auth/account-endpoints.ts): a session of the
// member in one account, marked with the super-admin (`impersonatedBy`), lasting IMPERSONATION_MINUTES
// from its creation and never extended, with the super-admin's own session kept aside in a signed cookie
// (IMPERSONATOR_COOKIE) until it ends. It can write nothing (the middleware and a Better Auth hook refuse
// every request other than GET and HEAD, except stopping it), every page shows a banner, and its start
// and end are in the account's audit log with the super-admin (the start with their reason), each
// written before the session changes. Past its time no endpoint serves it, and the next request ends it:
// the end is recorded and the super-admin's own session comes back.
import { env } from '../env'
import type { AuthSession } from './auth'
import { isComplete } from './complete'
import { withinLimit } from './request-limits'

export type SuperAdminStatus = 'super-admin' | 'needs-two-factor' | 'none'

/** How long a read-only view as a member lasts. */
export const IMPERSONATION_MINUTES = 30
export const IMPERSONATION_SECONDS = IMPERSONATION_MINUTES * 60

/** The super-admin viewing as the session's user, or null for a session of its own user. */
export function impersonatorOf(session: AuthSession | null | undefined): string | null {
  return (session?.session as { impersonatedBy?: string | null } | undefined)?.impersonatedBy ?? null
}

const listed = (email: string) => env.SUPER_ADMIN_EMAILS.includes(email.trim().toLowerCase())

/** Whether a (complete) session is a super-admin's, or a listed person's who must turn on 2FA first. */
export function superAdminStatus(session: AuthSession | null): SuperAdminStatus {
  if (!session || !isComplete(session) || impersonatorOf(session) !== null) return 'none'
  const { user } = session
  if (!user.emailVerified || !listed(user.email)) return 'none'
  return user.twoFactorEnabled ? 'super-admin' : 'needs-two-factor'
}

/** Is `email` a super-admin's address (they cannot be impersonated)? */
export const isListedSuperAdmin = (email: string): boolean => listed(email)

/** The prefix of every cookie of the app (Better Auth's `advanced.cookiePrefix`). */
export const COOKIE_PREFIX = 'cmp'

/** The signed cookie that keeps the super-admin's own session aside while they view as a member. */
export const IMPERSONATOR_COOKIE = 'impersonator'
const IMPERSONATOR_COOKIE_NAME = new RegExp(`(?:^|;)\\s*(?:__Secure-)?${COOKIE_PREFIX}\\.${IMPERSONATOR_COOKIE}=`)

/** Does a request carry the impersonator cookie (an impersonation to end, if its session is gone)? */
export const carriesImpersonatorCookie = (headers: Headers): boolean => IMPERSONATOR_COOKIE_NAME.test(headers.get('cookie') ?? '')

/** Is an impersonation session past its time (counted from its creation, whatever its expiry says)? */
export const impersonationOver = (session: { createdAt: Date | string }, now: number = Date.now()): boolean =>
  now - new Date(session.createdAt).getTime() >= IMPERSONATION_SECONDS * 1000

/** Rate limits of the console's endpoints, per super-admin and per client address. */
export const ADMIN_LIMITS = {
  change: { window: 10 * 60, max: 30 },
  impersonate: { window: 10 * 60, max: 10 },
} as const

/**
 * Takes a place in the super-admin's and the client address's window for `kind`; false when either is
 * full or the address is unknown (src/server/auth/request-limits.ts).
 */
export const withinAdminLimit = (request: Request, kind: keyof typeof ADMIN_LIMITS, userId: string): Promise<boolean> =>
  withinLimit(request, `super-admin:${kind}`, userId, ADMIN_LIMITS[kind])
