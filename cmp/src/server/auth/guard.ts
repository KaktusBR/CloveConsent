// Route guards. A page or API that needs a signed-in person calls these; there is no other way to the
// session (Better Auth's own endpoints check it themselves).
import type { AstroGlobal } from 'astro'
import { isAPIError } from 'better-auth/api'
import { localeOfPath, localizedPath, sameSitePath, splitLocalePrefix, type Locale } from '../../i18n/locale'
import { auth, type AuthSession } from './auth'
import { accessFor, type Access } from './access'
import { isComplete } from './complete'
import { carriesImpersonatorCookie, impersonationOver, impersonatorOf, superAdminStatus, type SuperAdminStatus } from './super-admin'
import { scopeFor } from '../data/accounts'
import { entitlementOf, type Entitlement } from '../data/entitlements'
import type { AccountScope } from '../data/scope'

/**
 * The request's session, only when it is complete: the email address is verified and, for a user with
 * two-factor authentication on, the session was created by its second step (TOTP or backup code) or by a
 * passkey (or replaced one that was). Anything else, including a sign-in still waiting for its code, is
 * no session.
 *
 * Reading a session older than a day extends it (a sliding session) and renews its cookie: pass the
 * response's headers to receive that Set-Cookie, as requireUser does.
 */
export async function completeSession(headers: Headers, responseHeaders?: Headers): Promise<AuthSession | null> {
  const { headers: answer, response: found } = await auth.api.getSession({ headers, returnHeaders: true })
  if (!found || !isComplete(found)) return null
  // a super-admin's view as a member ends after its time, whatever the session row says
  if (impersonatorOf(found) !== null && impersonationOver(found.session)) return null
  if (responseHeaders) for (const cookie of answer.getSetCookie()) responseHeaders.append('Set-Cookie', cookie)
  return found
}

/**
 * Who a request comes from and the account it works in (what the middleware puts in `locals`): the
 * complete session, and the scope of its active account (else the person's oldest), both read from the
 * database now. A member removed from an account has lost it on their next request.
 */
export async function signedInScope(headers: Headers, responseHeaders?: Headers): Promise<{ session: AuthSession | null; scope: AccountScope | null }> {
  const session = await completeSession(headers, responseHeaders)
  const scope = session ? await scopeFor(session.user.id, session.session.activeOrganizationId) : null
  return { session, scope }
}

/** What the middleware knows about a request once it has read who it comes from, and what to do with it. */
export interface RequestAccess {
  session: AuthSession | null
  scope: AccountScope | null
  /** The entitlement of the scope's account (null without a scope). */
  entitlement: Entitlement | null
  superAdmin: SuperAdminStatus
  access: Access
}

/**
 * Reads who a request comes from (session, account scope, the account's entitlement), all from the
 * database now, and applies the access rules (src/server/auth/access.ts): a super-admin marking an
 * account paid, a suspension, a removed membership all count from the next request, with no new sign-in.
 */
export async function requestAccess(request: Request, responseHeaders?: Headers): Promise<RequestAccess> {
  const { session, scope } = await signedInScope(request.headers, responseHeaders)
  // a super-admin's view that has ended by its time (its session is gone, the impersonator cookie is
  // still here): record its end and give them their own session back, on the account's console page
  if (!session && carriesImpersonatorCookie(request.headers)) {
    const url = new URL(request.url)
    const ended = await endImpersonation(request, url, localeOfPath(url.pathname))
    if (ended) {
      if (responseHeaders) for (const cookie of ended.cookies) responseHeaders.append('Set-Cookie', cookie)
      return { session: null, scope: null, entitlement: null, superAdmin: 'none', access: { kind: 'see-other', location: ended.location } }
    }
  }
  const entitlement = scope ? await entitlementOf(scope.accountId) : null
  const superAdmin = superAdminStatus(session)
  const access = accessFor({
    method: request.method,
    pathname: new URL(request.url).pathname,
    impersonating: impersonatorOf(session) !== null,
    superAdmin,
    entitlement: entitlement?.state ?? null,
  })
  return { session, scope, entitlement, superAdmin, access }
}

/**
 * Ends the super-admin's view a request carries (src/server/auth/account-endpoints.ts, endImpersonation):
 * where to go next (the account's console page, or sign-in when their own session has ended too) and the
 * cookies to set; null when there is nothing to end.
 */
export async function endImpersonation(request: Request, url: URL, locale: Locale): Promise<{ location: string; cookies: string[] } | null> {
  try {
    const { headers, response } = await auth.api.endImpersonation({ headers: request.headers, returnHeaders: true })
    const console = localizedPath(`/admin/accounts/${response.accountId}`, locale)
    return { location: response.restored ? console : signInPath(new URL(console, url)), cookies: headers.getSetCookie() }
  } catch (err) {
    if (isAPIError(err)) return null
    throw err
  }
}

/** The sign-in page, in the page's language, with where to come back to (a path on this site only). */
export function signInPath(url: URL): string {
  const { locale } = splitLocalePrefix(url.pathname)
  const next = sameSitePath(url.pathname + url.search)
  const path = localizedPath('/sign-in', locale ?? 'en')
  return next ? `${path}?${new URLSearchParams({ next })}` : path
}

/**
 * For a page that needs a signed-in person: their user and session, or a redirect to the sign-in page
 * (then `return` it from the page). The page is never cached: it shows one person's data.
 *
 *   const signedIn = await requireUser(Astro)
 *   if (signedIn instanceof Response) return signedIn
 */
export async function requireUser(astro: AstroGlobal): Promise<AuthSession | Response> {
  astro.response.headers.set('Cache-Control', 'no-store')
  // the middleware has read it for this request (and forwards its renewed cookie)
  const found = astro.locals.session !== undefined ? astro.locals.session : await completeSession(astro.request.headers, astro.response.headers)
  return found ?? astro.redirect(signInPath(astro.url), 303)
}

/**
 * For a page of the account the person works in: their session and that account's scope (checked against
 * the memberships on this request), a redirect to sign in, or one to create an account when they belong
 * to none.
 *
 *   const here = await requireAccount(Astro)
 *   if (here instanceof Response) return here
 */
export async function requireAccount(astro: AstroGlobal): Promise<{ signedIn: AuthSession; scope: AccountScope } | Response> {
  const signedIn = await requireUser(astro)
  if (signedIn instanceof Response) return signedIn
  const scope = astro.locals.scope
  if (!scope || scope.userId !== signedIn.user.id) return astro.redirect(localizedPath('/accounts/new', astro.locals.locale), 303)
  return { signedIn, scope }
}

/**
 * For a page of the super-admin console: the super-admin's session, or the 404 page for anyone else (the
 * middleware has already answered so; this checks again). Never cached.
 *
 *   const root = await requireSuperAdmin(Astro)
 *   if (root instanceof Response) return root
 */
export async function requireSuperAdmin(astro: AstroGlobal): Promise<AuthSession | Response> {
  astro.response.headers.set('Cache-Control', 'no-store')
  const session = astro.locals.session ?? null
  return session && superAdminStatus(session) === 'super-admin' ? session : astro.rewrite('/404')
}
