// Every route the app serves, from Astro's route manifest (scripts/route-manifest.ts: the routes of
// src/pages and those Astro and the integrations inject, such as /_image), each with a sample request
// path. Shared by the access rules' unit sweep, the database tests of the entitlement gate and the
// tenant-isolation sweeps, so a new route, written or injected, is in all of them without anyone listing it.
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..')

export interface Route {
  /** The route's pattern without its `/[...locale]` prefix: `/account/members`, `/invite/[token]`, `/_image`. */
  route: string
  /** A request path for it: the parameters filled with samples. */
  path: string
  /** An endpoint rather than a page. */
  endpoint: boolean
  /** A page under `[...locale]/`: also served as `/sk/...`. */
  localized: boolean
  /** Written in src/pages (`project`), or injected by Astro or an integration (`internal`, `external`). */
  origin: string
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
/**
 * The product: only for an account that has paid (or is in its grace period). Astro's injected routes
 * (its image endpoint, server islands; the app uses neither) are not open either: deny by default.
 */
export const PAID = ['/_image', '/_server-islands/[name]', '/sites']

const SAMPLE_ID = '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b'

interface ManifestRoute {
  pattern: string
  type: string
  origin: string
}

let manifest: ManifestRoute[] | undefined
/** Astro's route manifest, read once per process (scripts/route-manifest.ts runs `astro sync`). */
function routeManifest(): ManifestRoute[] {
  if (!manifest) {
    const output = execFileSync(process.execPath, ['scripts/route-manifest.ts'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
    const at = output.lastIndexOf('ROUTES ')
    if (at === -1) throw new Error('scripts/route-manifest.ts printed no routes')
    manifest = JSON.parse(output.slice(at + 'ROUTES '.length)) as ManifestRoute[]
  }
  return manifest
}

/** Every route of the app's manifest, sorted. Redirects are not routes of their own. */
export function appRoutes(): Route[] {
  return routeManifest()
    .filter((r) => r.type === 'page' || r.type === 'endpoint')
    .map((r) => {
      const localized = r.pattern === '/[...locale]' || r.pattern.startsWith('/[...locale]/')
      const route = localized ? r.pattern.slice('/[...locale]'.length) || '/' : r.pattern
      const segments = route.split('/').filter(Boolean)
      const path = `/${segments.map((s) => (s === '[id]' ? SAMPLE_ID : s.startsWith('[') ? 'sample' : s)).join('/')}`
      return { route, path, endpoint: r.type === 'endpoint', localized, origin: r.origin }
    })
    .sort((a, b) => a.route.localeCompare(b.route))
}

/** The request paths of a route: `/x`, and `/sk/x` for a localized page. */
export const pathsOf = (r: Route): string[] => (r.localized ? [r.path, r.path === '/' ? '/sk/' : `/sk${r.path}`] : [r.path])
