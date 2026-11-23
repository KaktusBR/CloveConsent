// The access rules every request goes through, after the middleware has read who it comes from
// (src/server/auth/guard.ts, requestAccess). Pure: the facts in, a decision out.
//
// 1. Impersonation is read-only: a request other than GET or HEAD is refused (403), except the one that
//    stops it. (Better Auth's endpoints, which the middleware does not read, refuse it themselves:
//    src/server/auth/auth.ts.)
// 2. The super-admin console (/admin/*, /api/admin/*) exists for super-admins only: anyone else gets a
//    404, never a 403. A listed person without two-factor authentication is sent to set it up.
// 3. Paid access (Review Focus 3): an account whose entitlement does not allow the admin gets the paywall
//    (pages) or 402 (endpoints) for every route except those listed as open below: the paywall, account
//    settings, signing in, public pages. Deny by default: a new route is behind the paywall.
import { localeOfPath, localizedPath, splitLocalePrefix } from '../../i18n/locale'
import type { EntitlementState } from '../data/entitlements'
import type { SuperAdminStatus } from './super-admin'

/** The one write an impersonating session may make. */
export const IMPERSONATION_STOP_PATH = '/api/impersonation/stop'

export interface RequestFacts {
  method: string
  /** The request's path, with its language prefix. */
  pathname: string
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

/** Pages (without the language prefix) an account that has not paid may still use. */
const OPEN_PAGES = new Set([
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
])
/** Their sub-paths too (an invitation's link). */
const OPEN_PAGE_PREFIXES = ['/invite/']
/** Endpoints an account that has not paid may still use: signing in, account settings, the language. */
const OPEN_ENDPOINTS = new Set(['/api/locale', '/api/accounts/create', '/api/account/members', '/api/account/switch', '/api/account/revoke-session', IMPERSONATION_STOP_PATH, '/healthz', '/readyz'])
const OPEN_ENDPOINT_PREFIXES = ['/api/auth/']

const isEndpoint = (pathname: string) => pathname === '/api' || pathname.startsWith('/api/') || pathname === '/healthz' || pathname === '/readyz'
const under = (path: string, base: string) => path === base || path.startsWith(`${base}/`)

/** The console: its pages in any language, and its endpoints. */
function isConsole(pathname: string): boolean {
  return under(splitLocalePrefix(pathname).path, '/admin') || under(pathname, '/api/admin')
}

/** May an account that has not paid use this path? */
function openWhileUnpaid(pathname: string): boolean {
  if (isEndpoint(pathname)) return OPEN_ENDPOINTS.has(pathname) || OPEN_ENDPOINT_PREFIXES.some((p) => pathname.startsWith(p))
  const { path } = splitLocalePrefix(pathname)
  return OPEN_PAGES.has(path) || OPEN_PAGE_PREFIXES.some((p) => path.startsWith(p))
}

/** What happens to a request with these facts. */
export function accessFor(facts: RequestFacts): Access {
  const { pathname } = facts
  const method = facts.method.toUpperCase()
  if (facts.impersonating && !SAFE_METHODS.has(method) && pathname !== IMPERSONATION_STOP_PATH) {
    return { kind: 'refuse', status: 403, code: 'IMPERSONATION_READ_ONLY' }
  }
  if (isConsole(pathname)) {
    if (facts.superAdmin === 'super-admin') return { kind: 'pass' }
    if (facts.superAdmin === 'needs-two-factor' && !isEndpoint(pathname)) {
      return { kind: 'see-other', location: localizedPath('/account/security', localeOfPath(pathname)) }
    }
    return { kind: 'not-found' }
  }
  if (facts.entitlement !== null && !usesTheAdmin(facts.entitlement) && !openWhileUnpaid(pathname)) {
    return isEndpoint(pathname)
      ? { kind: 'refuse', status: 402, code: 'PAYMENT_REQUIRED' }
      : { kind: 'see-other', location: localizedPath('/paywall', localeOfPath(pathname)) }
  }
  return { kind: 'pass' }
}
