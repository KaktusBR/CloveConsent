// The access rules every request goes through, after the middleware has read who it comes from
// (src/server/auth/guard.ts, requestAccess). Pure: the facts in, a decision out.
//
// The rules decide by the route Astro serves the request with (`context.routePattern`, such as
// `/[...locale]/admin/audit`), not by the address. An address can be written many ways that reach the
// same route: percent-encoded (`/%61dmin/audit`), with a doubled slash, or with any word where the
// language goes (`/foo/admin/audit` is served by /[...locale]/admin/audit). Astro's authentication guide
// warns against authorizing on the pathname for this reason. The address is used only for the language
// of a redirect, and as a second way into the console rule (rule 2), never to let a request through.
//
// 1. Impersonation is read-only: a request other than GET or HEAD is refused (403), except the one that
//    stops it. (Better Auth's endpoints, which the middleware does not read, refuse it themselves:
//    src/server/auth/auth.ts.)
// 2. The super-admin console (/admin/*, /api/admin/*) exists for super-admins only: anyone else gets a
//    404, never a 403. A listed person without two-factor authentication is sent to set it up.
// 3. Paid access (Review Focus 3): an account whose entitlement does not allow the admin gets the paywall
//    (pages) or 402 (endpoints) for every route except those listed as open below: the paywall, account
//    settings, signing in, public pages. Deny by default: a new route, or an unknown one, is behind the
//    paywall.
import { localeOfPath, localizedPath, splitLocalePrefix } from '../../i18n/locale'
import type { EntitlementState } from '../data/entitlements'
import type { SuperAdminStatus } from './super-admin'

/** The one write an impersonating session may make: this route. */
export const IMPERSONATION_STOP_PATH = '/api/impersonation/stop'

export interface RequestFacts {
  method: string
  /** The request's path, with its language prefix: only for the language of a redirect. */
  pathname: string
  /** The pattern of the route Astro serves the request with (`context.routePattern`), e.g. `/[...locale]/sites`. */
  route: string
  /** The session is a super-admin's read-only view as one of the account's members. */
  impersonating: boolean
  superAdmin: SuperAdminStatus
  /** The state of the account the request works in; null when it works in none (signed out, no account). */
  entitlement: EntitlementState | null
}

export type Access =
  | { kind: 'pass' }
  | { kind: 'not-found' }
  | { kind: 'see-other'; location: string }
  | { kind: 'refuse'; status: 402; code: 'PAYMENT_REQUIRED' }
  | { kind: 'refuse'; status: 403; code: 'IMPERSONATION_READ_ONLY' }

const SAFE_METHODS = new Set(['GET', 'HEAD'])

/** May an account in `state` use the admin? `active` and `grace` may; `necessary-only` and `none` get the paywall. */
export const usesTheAdmin = (state: EntitlementState): boolean => state === 'active' || state === 'grace'

const LOCALIZED = '/[...locale]'

/** A route pattern without its language segment: `/[...locale]/account` → `/account`, `/[...locale]` → `/`. */
function routeOf(pattern: string): string {
  if (pattern === LOCALIZED) return '/'
  return pattern.startsWith(`${LOCALIZED}/`) ? pattern.slice(LOCALIZED.length) : pattern
}

/** Routes (patterns without the language segment) an account that has not paid may still use. Exact patterns only. */
const OPEN_ROUTES = new Set([
  // pages
  '/',
  '/404',
  '/paywall',
  '/account',
  '/account/members',
  '/account/security',
  '/accounts/new',
  '/sign-in',
  '/sign-up',
  '/forgot-password',
  '/reset-password',
  '/verify-email',
  '/two-factor',
  '/invite/[token]',
  // endpoints: signing in, account settings, the language, the probes
  '/api/auth/[...all]',
  '/api/locale',
  '/api/accounts/create',
  '/api/account/members',
  '/api/account/switch',
  '/api/account/revoke-session',
  IMPERSONATION_STOP_PATH,
  '/healthz',
  '/readyz',
])

/** Astro's image endpoint (an injected route, not in src/pages). */
const ASTRO_ENDPOINTS = new Set(['/_image'])
const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`)
const isEndpoint = (route: string) => under(route, '/api') || route === '/healthz' || route === '/readyz' || ASTRO_ENDPOINTS.has(route)

/**
 * The console: its routes in any language, and its endpoints. The address counts too, so that one that
 * merely looks like the console (and reaches the 404 page) is a 404 as well; it can only add refusals.
 */
function isConsole(route: string, pathname: string): boolean {
  const looksLike = (path: string) => under(path, '/admin') || under(path, '/api/admin')
  return looksLike(route) || looksLike(splitLocalePrefix(pathname).path)
}

/** What happens to a request with these facts. */
export function accessFor(facts: RequestFacts): Access {
  const { pathname } = facts
  const route = routeOf(facts.route)
  const method = facts.method.toUpperCase()
  if (facts.impersonating && !SAFE_METHODS.has(method) && route !== IMPERSONATION_STOP_PATH) {
    return { kind: 'refuse', status: 403, code: 'IMPERSONATION_READ_ONLY' }
  }
  if (isConsole(route, pathname)) {
    if (facts.superAdmin === 'super-admin') return { kind: 'pass' }
    if (facts.superAdmin === 'needs-two-factor' && !isEndpoint(route)) {
      return { kind: 'see-other', location: localizedPath('/account/security', localeOfPath(pathname)) }
    }
    return { kind: 'not-found' }
  }
  if (facts.entitlement !== null && !usesTheAdmin(facts.entitlement) && !OPEN_ROUTES.has(route)) {
    return isEndpoint(route)
      ? { kind: 'refuse', status: 402, code: 'PAYMENT_REQUIRED' }
      : { kind: 'see-other', location: localizedPath('/paywall', localeOfPath(pathname)) }
  }
  return { kind: 'pass' }
}
