// Super-admins and their read-only impersonation.
//
// A super-admin is a person whose address is in SUPER_ADMIN_EMAILS, verified, with two-factor
// authentication on, on a complete session (the second factor passed) that is not itself an
// impersonation. Nothing else makes one: Better Auth's user `role` is not used. Everyone else gets a 404
// from every console page and endpoint (src/server/auth/access.ts), so the console never shows that it
// exists; a listed person without two-factor authentication is sent to set it up.
//
// Impersonation is the admin plugin's: a session of the member, marked with the super-admin
// (`impersonatedBy`), lasting IMPERSONATION_MINUTES, with the super-admin's own session kept aside in a
// signed cookie until they stop. It can write nothing (the middleware and a Better Auth hook refuse every
// request other than GET and HEAD, except stopping it), every page shows a banner, and its start and
// stop are in the account's audit log with the super-admin and their reason.
import { AsyncLocalStorage } from 'node:async_hooks'
import { clientAddress, trustedProxies } from '../client-address'
import { releaseInWindow, reserveInWindow } from '../data/auth-limits'
import { env } from '../env'
import { socketPeer } from '../socket-peer'
import type { AuthSession } from './auth'
import { isComplete } from './complete'

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

/** An impersonation being started by src/pages/api/admin/impersonate.ts, for the length of that call. */
export interface StartingImpersonation {
  superAdminId: string
  accountId: string
}
const starting = new AsyncLocalStorage<StartingImpersonation>()

/** Runs `fn` (the call to the admin plugin) as the start of `impersonation`, which the caller has checked. */
export const startingImpersonation = <T>(impersonation: StartingImpersonation, fn: () => Promise<T>): Promise<T> => starting.run(impersonation, fn)

/** The impersonation the current call is starting, if any (auth.ts gives the new session its account). */
export const impersonationBeingStarted = (): StartingImpersonation | undefined => starting.getStore()

/**
 * The admin plugin's `adminUserIds`, which its impersonation endpoint checks the caller against: only the
 * super-admin whose impersonation this app is starting right now, inside startingImpersonation. The
 * plugin's own permission check therefore passes for no one else, whatever calls it.
 */
export class SuperAdminStartingImpersonation extends Array<string> {
  override includes(id: string): boolean {
    return starting.getStore()?.superAdminId === id
  }
}

/** Rate limits of the console's endpoints, per super-admin and per client address. */
export const ADMIN_LIMITS = {
  change: { window: 10 * 60, max: 30 },
  impersonate: { window: 10 * 60, max: 10 },
} as const

const proxies = trustedProxies(env.TRUSTED_PROXIES)

/**
 * Takes a place in the super-admin's and the client address's window for `kind`; false when either is
 * full or the address is unknown (src/server/socket-peer.ts: never a header the client chose).
 */
export async function withinAdminLimit(request: Request, kind: keyof typeof ADMIN_LIMITS, userId: string): Promise<boolean> {
  const client = clientAddress(socketPeer(request), request.headers.get('x-forwarded-for'), proxies)
  if (client === null) return false
  const { window, max } = ADMIN_LIMITS[kind]
  const byUser = `super-admin:${kind}:user:${userId}`
  const user = await reserveInWindow(byUser, window, max)
  if (user === false) return false
  if ((await reserveInWindow(`super-admin:${kind}:client:${client}`, window, max)) === false) {
    await releaseInWindow(byUser, user)
    return false
  }
  return true
}
