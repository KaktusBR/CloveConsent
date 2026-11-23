// The access rules every request goes through (src/server/auth/access.ts, applied by the middleware):
// the paid-access gate (Review Focus 3), the super-admin console that does not exist for anyone else,
// and read-only impersonation. The sweep covers every route in src/pages: a new one must be classified
// here, and is behind the paywall unless it is listed as open.
import { describe, expect, test } from 'vitest'
import { accessFor, IMPERSONATION_STOP_PATH, type RequestFacts } from '../../src/server/auth/access'
import { appRoutes, CONSOLE, OPEN, PAID, pathsOf } from '../routes'

const routes = appRoutes()
const WRITES = ['POST', 'PUT', 'PATCH', 'DELETE']

const facts = (pathname: string, more: Partial<RequestFacts> = {}): RequestFacts => ({
  method: 'GET',
  pathname,
  impersonating: false,
  superAdmin: 'none',
  entitlement: null,
  ...more,
})

describe('the route sweep', () => {
  test('every route in src/pages is classified, exactly once', () => {
    const listed = [...OPEN, ...CONSOLE, ...PAID]
    expect(new Set(listed).size).toBe(listed.length)
    expect(routes.map((r) => r.route).sort()).toEqual([...listed].sort())
  })
})

describe('paid access (Review Focus 3)', () => {
  for (const state of ['none', 'necessary-only'] as const) {
    test(`an account in state ${state} gets the paywall for every product route, and everything else that is open`, () => {
      for (const r of routes) {
        for (const pathname of pathsOf(r)) {
          for (const method of ['GET', 'POST']) {
            const access = accessFor(facts(pathname, { method, entitlement: state }))
            if (OPEN.includes(r.route)) expect(access, `${method} ${pathname}`).toEqual({ kind: 'pass' })
            else if (CONSOLE.includes(r.route)) expect(access, `${method} ${pathname}`).toEqual({ kind: 'not-found' })
            else if (r.endpoint) expect(access, `${method} ${pathname}`).toEqual({ kind: 'refuse', status: 402, code: 'PAYMENT_REQUIRED' })
            else expect(access, `${method} ${pathname}`).toEqual({ kind: 'see-other', location: pathname.startsWith('/sk/') ? '/sk/paywall' : '/paywall' })
          }
        }
      }
    })
  }

  test('an endpoint that is not listed as open is refused with 402 (deny by default)', () => {
    expect(accessFor(facts('/api/sites/new', { method: 'POST', entitlement: 'none' }))).toEqual({ kind: 'refuse', status: 402, code: 'PAYMENT_REQUIRED' })
    expect(accessFor(facts('/sk/sites/x/records', { entitlement: 'none' }))).toEqual({ kind: 'see-other', location: '/sk/paywall' })
    // a path that only starts like an open one is not open
    expect(accessFor(facts('/accountsx', { entitlement: 'none' }))).toEqual({ kind: 'see-other', location: '/paywall' })
    expect(accessFor(facts('/api/localex', { entitlement: 'none' }))).toEqual({ kind: 'refuse', status: 402, code: 'PAYMENT_REQUIRED' })
  })

  for (const state of ['active', 'grace'] as const) {
    test(`an account in state ${state} reaches every route but the console`, () => {
      for (const r of routes.filter((r) => !CONSOLE.includes(r.route))) {
        for (const pathname of pathsOf(r)) expect(accessFor(facts(pathname, { entitlement: state })), pathname).toEqual({ kind: 'pass' })
      }
    })
  }

  test('without an account (signed out, or in none) the gate does not apply: the page decides', () => {
    for (const r of routes.filter((r) => !CONSOLE.includes(r.route))) {
      for (const pathname of pathsOf(r)) expect(accessFor(facts(pathname)), pathname).toEqual({ kind: 'pass' })
    }
  })
})

describe('the super-admin console', () => {
  const consoleRoutes = routes.filter((r) => CONSOLE.includes(r.route))

  test('does not exist for anyone but a super-admin: 404, never 403, for every page and endpoint, any method', () => {
    for (const r of consoleRoutes) {
      for (const pathname of pathsOf(r)) {
        for (const method of ['GET', 'HEAD', ...WRITES]) {
          for (const entitlement of [null, 'none', 'active'] as const) {
            expect(accessFor(facts(pathname, { method, entitlement })), `${method} ${pathname}`).toEqual({ kind: 'not-found' })
          }
        }
      }
    }
    // also below and beside its routes
    for (const pathname of ['/admin', '/admin/', '/sk/admin', '/admin/unknown', '/api/admin/unknown', '/api/admin']) {
      expect(accessFor(facts(pathname)), pathname).toEqual({ kind: 'not-found' })
    }
  })

  test('a listed user without two-factor authentication is sent to set it up (pages), and gets 404 from its endpoints', () => {
    for (const r of consoleRoutes) {
      for (const pathname of pathsOf(r)) {
        const access = accessFor(facts(pathname, { superAdmin: 'needs-two-factor' }))
        if (r.endpoint) expect(access, pathname).toEqual({ kind: 'not-found' })
        else expect(access, pathname).toEqual({ kind: 'see-other', location: pathname.startsWith('/sk/') ? '/sk/account/security' : '/account/security' })
      }
    }
  })

  test('a super-admin reaches it whatever their own account has paid', () => {
    for (const r of consoleRoutes) {
      for (const pathname of pathsOf(r)) {
        for (const entitlement of [null, 'none', 'necessary-only', 'active'] as const) {
          expect(accessFor(facts(pathname, { superAdmin: 'super-admin', entitlement, method: r.endpoint ? 'POST' : 'GET' })), pathname).toEqual({ kind: 'pass' })
        }
      }
    }
  })
})

describe('impersonation is read-only', () => {
  test('no route accepts a write while impersonating, except stopping it', () => {
    for (const r of routes) {
      for (const pathname of pathsOf(r)) {
        for (const method of WRITES) {
          const access = accessFor(facts(pathname, { method, impersonating: true, entitlement: 'active' }))
          if (pathname === IMPERSONATION_STOP_PATH) expect(access, `${method} ${pathname}`).toEqual({ kind: 'pass' })
          else expect(access, `${method} ${pathname}`).toEqual({ kind: 'refuse', status: 403, code: 'IMPERSONATION_READ_ONLY' })
        }
      }
    }
    expect(IMPERSONATION_STOP_PATH).toBe('/api/impersonation/stop')
  })

  test('reading works as for the person impersonated (their paywall included)', () => {
    expect(accessFor(facts('/account', { impersonating: true, entitlement: 'active' }))).toEqual({ kind: 'pass' })
    expect(accessFor(facts('/sites', { method: 'HEAD', impersonating: true, entitlement: 'active' }))).toEqual({ kind: 'pass' })
    expect(accessFor(facts('/sites', { impersonating: true, entitlement: 'none' }))).toEqual({ kind: 'see-other', location: '/paywall' })
    expect(accessFor(facts('/admin/accounts', { impersonating: true, entitlement: 'active' }))).toEqual({ kind: 'not-found' })
  })
})
