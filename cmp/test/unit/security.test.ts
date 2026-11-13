import { describe, expect, test } from 'vitest'

import { BASELINE_CSP, checkOrigin, cspHash, securityHeaders, staticSecurityHeaders, withSecurityHeaders } from '../../src/server/security'

/** The headers every response carries, with their exact values (Global Constraints). */
const EXPECTED = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
}

const EXPECTED_BASELINE_CSP =
  "default-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; " +
  "form-action 'self'; object-src 'none'; upgrade-insecure-requests; script-src 'self' 'strict-dynamic'; style-src 'self'"

describe('securityHeaders', () => {
  test('every header with its exact value, and the baseline CSP', () => {
    const headers = securityHeaders()
    for (const [name, value] of Object.entries(EXPECTED)) expect(headers.get(name), name).toBe(value)
    expect(headers.get('content-security-policy')).toBe(EXPECTED_BASELINE_CSP)
    expect(BASELINE_CSP).toBe(EXPECTED_BASELINE_CSP)
    expect([...headers.keys()]).toHaveLength(Object.keys(EXPECTED).length + 1)
  })

  test('the CSP never allows inline or eval', () => {
    expect(BASELINE_CSP).not.toMatch(/unsafe-inline|unsafe-eval|unsafe-hashes/)
  })
})

describe('cspHash', () => {
  test('a CSP source expression: sha256 of the exact text, base64', () => {
    expect(cspHash('')).toBe('sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=')
    expect(cspHash('a')).not.toBe(cspHash('a '))
  })
})

describe('withSecurityHeaders', () => {
  test('adds every header to a response', () => {
    const res = withSecurityHeaders(new Response('x', { status: 201, headers: { 'Content-Type': 'text/plain' } }))
    expect(res.status).toBe(201)
    expect(res.headers.get('content-type')).toBe('text/plain')
    for (const [name, value] of Object.entries(EXPECTED)) expect(res.headers.get(name), name).toBe(value)
    expect(res.headers.get('content-security-policy')).toBe(BASELINE_CSP)
  })

  test("keeps the page's own hashed CSP (set by Astro)", () => {
    const pageCsp = "default-src 'self'; script-src 'self' 'sha256-abc' 'strict-dynamic'"
    const res = withSecurityHeaders(new Response('', { headers: { 'Content-Security-Policy': pageCsp } }))
    expect(res.headers.get('content-security-policy')).toBe(pageCsp)
  })

  test('works on an immutable response (Response.redirect), keeping status and location', () => {
    const res = withSecurityHeaders(Response.redirect('https://consent.example/next', 302))
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('https://consent.example/next')
    expect(res.headers.get('x-frame-options')).toBe('DENY')
  })
})

describe('staticSecurityHeaders (files the node adapter serves before the app)', () => {
  const pages = [
    { pathname: '/', headers: [{ key: 'Content-Security-Policy', value: 'home-policy' }] },
    { pathname: '/sk', headers: [{ key: 'Content-Security-Policy', value: 'sk-policy' }] },
  ]
  const serve = (url: string, setHeaders = staticSecurityHeaders(pages)) => {
    const set = new Map<string, string>()
    setHeaders({ url }, { setHeader: (name: string, value: string) => set.set(name.toLowerCase(), value) })
    return set
  }

  test('every header with its exact value; the baseline CSP on any other file', () => {
    const set = serve('/_astro/app.css')
    for (const [name, value] of Object.entries(EXPECTED)) expect(set.get(name), name).toBe(value)
    expect(set.get('content-security-policy')).toBe(BASELINE_CSP)
    expect(serve('/', staticSecurityHeaders()).get('content-security-policy')).toBe(BASELINE_CSP)
  })

  test("a prerendered page gets its own hashed CSP, matched by exact path (with or without the trailing slash, any query)", () => {
    expect(serve('/').get('content-security-policy')).toBe('home-policy')
    expect(serve('/?x=1').get('content-security-policy')).toBe('home-policy')
    expect(serve('/sk').get('content-security-policy')).toBe('sk-policy')
    expect(serve('/sk/').get('content-security-policy')).toBe('sk-policy')
    expect(serve('/s%6b/').get('content-security-policy')).toBe('sk-policy')
    for (const other of ['/s', '/sk/x', '/skx', '/x/sk', '/%E0%A4%A', '/sk.html', '/skindex.html', '/sk/index.htm']) {
      expect(serve(other).get('content-security-policy'), other).toBe(BASELINE_CSP)
    }
  })

  test('a direct /index.html URL is the same page, under its own policy', () => {
    expect(serve('/index.html').get('content-security-policy')).toBe('home-policy')
    expect(serve('/sk/index.html').get('content-security-policy')).toBe('sk-policy')
    expect(serve('/sk/index.html?x=1').get('content-security-policy')).toBe('sk-policy')
  })

  test('the server does not start when there are prerendered pages but no policy for them', () => {
    for (const missing of [undefined, [], [{ pathname: '/', headers: [] }]]) {
      expect(() => staticSecurityHeaders(missing, true)).toThrow(/_headers\.json/)
    }
    expect(() => staticSecurityHeaders(pages, true)).not.toThrow()
    expect(() => staticSecurityHeaders(undefined, false)).not.toThrow() // no prerendered page, nothing to find
  })
})

describe('checkOrigin', () => {
  const origin = 'https://consent.example'
  const req = (method: string, headers: Record<string, string> = {}) => new Request('http://internal:4321/api/x', { method, headers })

  test('safe methods pass whatever their origin', () => {
    expect(checkOrigin(req('GET', { Origin: 'https://evil.test' }), origin)).toBe(true)
    expect(checkOrigin(req('HEAD'), origin)).toBe(true)
  })

  test('a state-changing request passes only with Origin exactly the public origin', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(checkOrigin(req(method, { Origin: origin }), origin), method).toBe(true)
      expect(checkOrigin(req(method, { Origin: 'https://evil.test' }), origin), method).toBe(false)
    }
    // the public origin may be given with a trailing slash (as PUBLIC_ORIGIN can be)
    expect(checkOrigin(req('POST', { Origin: origin }), `${origin}/`)).toBe(true)
  })

  test('fails closed: no Origin, "null", another scheme, port or subdomain', () => {
    for (const value of [undefined, 'null', 'http://consent.example', 'https://consent.example:8443', 'https://evil.consent.example', 'https://consent.example.evil.test', '']) {
      const headers: Record<string, string> = value === undefined ? {} : { Origin: value }
      expect(checkOrigin(req('POST', headers), origin), String(value)).toBe(false)
    }
    // the request's own URL (behind a proxy, the internal address) is never trusted
    expect(checkOrigin(req('POST', { Origin: 'http://internal:4321' }), origin)).toBe(false)
    expect(checkOrigin(req('OPTIONS', { Origin: 'https://evil.test' }), origin)).toBe(false)
  })
})
