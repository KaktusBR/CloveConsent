// Opening and ending a super-admin's read-only view as a member (src/server/auth/super-admin.ts), inside
// Better Auth: the server-only endpoints of account-endpoints.ts and the sign-out hook of auth.ts use
// these.
//
// The impersonator cookie (signed) keeps the super-admin's own session aside, bound to one view: the
// view's id (the name its start and end rows carry) and its session's id. Ending a view is single-use:
// the database records one end per view (audit_log_impersonation_ends_once), and only the call that
// recorded it deletes the view's session and gives the super-admin's session back (or, on sign-out,
// deletes it). A parallel, replayed or stale copy of the cookie does nothing.
import type { GenericEndpointContext } from 'better-auth'
import { deleteSessionCookie, expireCookie, setSessionCookie } from 'better-auth/cookies'
import * as z from 'zod'
import { recordImpersonationEnd, type ImpersonationEnd } from '../data/admin'
import type { AuthSession } from './auth'
import { IMPERSONATION_SECONDS, IMPERSONATOR_COOKIE, impersonationOver, impersonatorOf } from './super-admin'

const Impersonator = z.object({
  /** The view's name (its start and end audit rows carry it). */
  impersonation: z.string(),
  /** The view's session id, and when it started (ms). */
  view: z.string(),
  started: z.number(),
  /** The super-admin, their own session's token, and whether that was "don't remember". */
  by: z.string(),
  token: z.string(),
  dontRemember: z.boolean(),
  /** The member viewed as, in which account. */
  userId: z.string(),
  accountId: z.string(),
})
export type Impersonator = z.infer<typeof Impersonator>

const encode = (value: Impersonator) => Buffer.from(JSON.stringify(value)).toString('base64url')
function decode(raw: string): Impersonator | null {
  try {
    const parsed = Impersonator.safeParse(JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')))
    return parsed.success ? parsed.data : null
  } catch {
    return null
  }
}

const cookieOf = (ctx: GenericEndpointContext) => ctx.context.createAuthCookie(IMPERSONATOR_COOKIE)

/** Sets the impersonator cookie for a view just opened (its session already created). */
export async function keepSuperAdminAside(ctx: GenericEndpointContext, kept: Impersonator): Promise<void> {
  await ctx.setSignedCookie(cookieOf(ctx).name, encode(kept), ctx.context.secret, { ...ctx.context.authCookies.sessionToken.attributes, maxAge: ctx.context.sessionConfig.expiresIn })
}

/**
 * Ends the view the request's impersonator cookie is bound to, once:
 * - `restore`: the view's session is deleted and the super-admin's own comes back (or the browser is
 *   signed out, if that has ended too);
 * - `sign-out`: the browser signs out (its session is already gone): the super-admin's own session is
 *   deleted too, so nobody is left signed in and no session is left behind.
 * The end is recorded first (stopped, expired or revoked by the member). Null, and nothing changed, when
 * there is no valid cookie, when the request's session is not the view the cookie is bound to, or when
 * the view has already ended.
 */
export async function endView(ctx: GenericEndpointContext, mode: 'restore' | 'sign-out'): Promise<{ restored: boolean; accountId: string } | null> {
  const cookie = cookieOf(ctx)
  const raw = await ctx.getSignedCookie(cookie.name, ctx.context.secret)
  const kept = raw ? decode(raw) : null
  if (!kept) return null
  const token = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret)
  const current = token ? await ctx.context.internalAdapter.findSession(token) : null
  const isTheView = current !== null && current.session.id === kept.view && impersonatorOf(current as unknown as AuthSession) === kept.by
  // someone's own session, or another view: this cookie is not for it
  if (current !== null && !isTheView) return null

  const ended: ImpersonationEnd =
    isTheView && !impersonationOver(current.session) ? 'stopped' : Date.now() - kept.started >= IMPERSONATION_SECONDS * 1000 ? 'expired' : 'revoked'
  const recorded = await recordImpersonationEnd(kept.by, kept.accountId, kept.userId, kept.impersonation, ended)
  expireCookie(ctx, cookie)
  if (!recorded) return null

  if (token && isTheView) await ctx.context.internalAdapter.deleteSession(token)
  const own = await ctx.context.internalAdapter.findSession(kept.token)
  const theirs = own !== null && own.user.id === kept.by
  if (mode === 'sign-out') {
    if (theirs) await ctx.context.internalAdapter.deleteSession(kept.token)
    return { restored: false, accountId: kept.accountId }
  }
  const restored = theirs && new Date(own.session.expiresAt).getTime() > Date.now()
  if (restored) await setSessionCookie(ctx, own, kept.dontRemember)
  else deleteSessionCookie(ctx)
  return { restored, accountId: kept.accountId }
}

/** A session as Better Auth's session list gives it, with what the member may see of a view. */
type Listed = Record<string, unknown>

/**
 * The member's list of their sessions (Better Auth's `/list-sessions`, also used by the Security page):
 * a view is marked `supportView`, without the super-admin's id, browser or address.
 */
export function redactViews(sessions: readonly Listed[]): Listed[] {
  return sessions.map((s) => {
    if (s.impersonatedBy == null) return { ...s, supportView: false }
    const { impersonatedBy: _by, userAgent: _agent, ipAddress: _address, ...rest } = s
    return { ...rest, userAgent: null, ipAddress: null, supportView: true }
  })
}
