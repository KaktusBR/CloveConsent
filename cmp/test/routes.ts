// Every route the app serves, read from the files in src/pages (what Astro builds its routes from), each
// with a sample request path. Shared by the access rules' unit sweep and the database tests of the
// entitlement gate, so a new page or endpoint is in both without anyone listing it.
import { readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const PAGES = join(import.meta.dirname, '..', 'src', 'pages')

export interface Route {
  /** The route as its file names it, without `[...locale]/`: `/account/members`, `/invite/[token]`. */
  route: string
  /** A request path for it: the parameters filled with samples. */
  path: string
  /** An endpoint (`.ts`) rather than a page. */
  endpoint: boolean
  /** A page under `[...locale]/`: also served as `/sk/...`. */
  localized: boolean
}

// How each route is classified by the access rules (src/server/auth/access.ts). Every route must be in
// exactly one list (test/unit/access.test.ts checks it), so a new route is classified on purpose.

/** Usable by an account that has not paid: the paywall, account settings, signing in, public pages. */
export const OPEN = [
  '/',
  '/404',
  '/account',
  '/account/members',
  '/account/security',
  '/accounts/new',
  '/api/account/members',
  '/api/account/revoke-session',
  '/api/account/switch',
  '/api/accounts/create',
  '/api/auth/[...all]',
  '/api/impersonation/stop',
  '/api/locale',
  '/forgot-password',
  '/healthz',
  '/invite/[token]',
  '/paywall',
  '/readyz',
  '/reset-password',
  '/sign-in',
  '/sign-up',
  '/two-factor',
  '/verify-email',
]
/** The super-admin console: a 404 for everyone else, whatever their account has paid. */
export const CONSOLE = ['/admin/accounts', '/admin/accounts/[id]', '/admin/audit', '/api/admin/entitlement', '/api/admin/impersonate']
/** The product: only for an account that has paid (or is in its grace period). */
export const PAID = ['/sites']

const SAMPLE_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? files(path) : [path]
  })
}

/** Every route of src/pages, sorted. */
export function appRoutes(): Route[] {
  return files(PAGES)
    .map((file) => {
      const parts = relative(PAGES, file).split(sep)
      const localized = parts[0] === '[...locale]'
      const segments = (localized ? parts.slice(1) : parts).map((s) => s.replace(/\.(astro|ts)$/, ''))
      if (segments.at(-1) === 'index') segments.pop()
      const route = `/${segments.join('/')}`
      const path = `/${segments.map((s) => (s === '[id]' ? SAMPLE_ID : s.startsWith('[') ? 'sample' : s)).join('/')}`
      return { route, path, endpoint: file.endsWith('.ts'), localized }
    })
    .sort((a, b) => a.route.localeCompare(b.route))
}

/** The request paths of a route: `/x`, and `/sk/x` for a localized page. */
export const pathsOf = (r: Route): string[] => (r.localized ? [r.path, r.path === '/' ? '/sk/' : `/sk${r.path}`] : [r.path])
