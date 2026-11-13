import { expect, test, type APIResponse } from '@playwright/test'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { expectAccessible } from './axe'
import { expectNoCspViolations, watchCsp } from './csp'

/** The headers every response carries, with their exact values (Global Constraints). */
const HEADERS = {
  'strict-transport-security': 'max-age=63072000; includeSubDomains; preload',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'x-frame-options': 'DENY',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
}

/** The CSP's fixed directives; script-src and style-src are checked apart (they carry hashes). */
const DIRECTIVES = {
  'default-src': "'self'",
  'img-src': "'self' data:",
  'font-src': "'self'",
  'connect-src': "'self'",
  'frame-ancestors': "'none'",
  'base-uri': "'none'",
  'form-action': "'self'",
  'object-src': "'none'",
  'upgrade-insecure-requests': '',
}

const HASH = /^'sha256-[A-Za-z0-9+/]+={0,2}'$/

function parseCsp(value: string): Map<string, string[]> {
  const directives = new Map<string, string[]>()
  for (const part of value.split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/).filter(Boolean)
    if (!name) continue
    expect(directives.has(name), `${name} given twice`).toBe(false)
    directives.set(name, sources)
  }
  return directives
}

/** Every header with its exact value, and a strict CSP: the fixed directives, then hashes only. */
function expectSecurityHeaders(res: APIResponse, what: string): { scriptSrc: string[]; styleSrc: string[] } {
  const headers = res.headers()
  for (const [name, value] of Object.entries(HEADERS)) expect(headers[name], `${what}: ${name}`).toBe(value)
  const csp = headers['content-security-policy']
  expect(csp, `${what}: content-security-policy`).toBeTruthy()
  expect(csp).not.toMatch(/unsafe-inline|unsafe-eval|unsafe-hashes|nonce-/)
  const directives = parseCsp(csp ?? '')
  expect([...directives.keys()].sort(), `${what}: directives`).toEqual([...Object.keys(DIRECTIVES), 'script-src', 'style-src'].sort())
  for (const [name, value] of Object.entries(DIRECTIVES)) expect(directives.get(name)?.join(' '), `${what}: ${name}`).toBe(value)

  const scriptSrc = directives.get('script-src') ?? []
  expect(scriptSrc[0], `${what}: script-src`).toBe("'self'")
  expect(scriptSrc.at(-1), `${what}: script-src`).toBe("'strict-dynamic'")
  for (const source of scriptSrc.slice(1, -1)) expect(source, `${what}: script-src`).toMatch(HASH)
  const styleSrc = directives.get('style-src') ?? []
  expect(styleSrc[0], `${what}: style-src`).toBe("'self'")
  for (const source of styleSrc.slice(1)) expect(source, `${what}: style-src`).toMatch(HASH)
  return { scriptSrc, styleSrc }
}

const sha256 = (text: string) => `'sha256-${createHash('sha256').update(text).digest('base64')}'`

/** Every inline <script> and <style> of the page is allowed by the CSP header's hashes. */
function expectInlineContentHashed(html: string, csp: { scriptSrc: string[]; styleSrc: string[] }, what: string) {
  const scripts = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '')
  const styles = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1] ?? '')
  expect(scripts.length, `${what}: the theme script at least`).toBeGreaterThan(0)
  for (const script of scripts) expect(csp.scriptSrc, `${what}: ${script.slice(0, 60)}`).toContain(sha256(script))
  for (const style of styles) expect(csp.styleSrc, `${what}: ${style.slice(0, 60)}`).toContain(sha256(style))
  expect(html, `${what}: the CSP is a header, not a meta tag (frame-ancestors is ignored in meta)`).not.toMatch(/http-equiv="content-security-policy"/i)
}

test('a server-rendered page: every security header, its inline content hashed', async ({ request }) => {
  for (const path of ['/sign-in', '/sk/sign-in']) {
    const res = await request.get(path)
    expect(res.status()).toBe(200)
    expect(res.headers()['x-request-id']).toBeTruthy() // rendered per request
    expectInlineContentHashed(await res.text(), expectSecurityHeaders(res, path), path)
  }
})

test('a prerendered page (served as a file, before the middleware): every header, a hash-based CSP header', async ({ request }) => {
  expect(readFileSync('dist/client/index.html', 'utf8')).toContain('<html') // it is a file, not rendered per request
  for (const path of ['/', '/sk/', '/sk']) {
    const res = await request.get(path)
    expect(res.status(), path).toBe(200)
    expect(res.headers()['x-request-id'], `${path} is served as a file`).toBeUndefined()
    expectInlineContentHashed(await res.text(), expectSecurityHeaders(res, path), path)
  }
})

test('an API route, a redirect, the 404 page, a static asset and the probes carry every header', async ({ request }) => {
  const api = await request.get('/api/locale?to=en&next=%2F', { maxRedirects: 0 })
  expect(api.status()).toBe(303)
  expectSecurityHeaders(api, 'api redirect')
  const bad = await request.get('/api/locale?to=xx', { maxRedirects: 0 })
  expect(bad.status()).toBe(400)
  expectSecurityHeaders(bad, 'api 400')

  const missing = await request.get('/no-such-page')
  expect(missing.status()).toBe(404)
  expectInlineContentHashed(await missing.text(), expectSecurityHeaders(missing, '404'), '404')

  const home = await (await request.get('/')).text()
  const asset = home.match(/(?:href|src)="(\/_astro\/[^"]+)"/)?.[1]
  expect(asset, 'a bundled asset linked from the home page').toBeTruthy()
  const file = await request.get(asset ?? '')
  expect(file.status()).toBe(200)
  expectSecurityHeaders(file, asset ?? 'asset')

  for (const probe of ['/healthz', '/readyz']) expectSecurityHeaders(await request.get(probe), probe)
})

test.describe('state-changing requests from another origin are refused (CSRF)', () => {
  test('a POST with a foreign Origin gets 403, whatever its content type', async ({ request }) => {
    for (const headers of [
      { Origin: 'https://evil.test', 'Content-Type': 'application/x-www-form-urlencoded' },
      { Origin: 'https://evil.test', 'Content-Type': 'application/json' },
      { Origin: 'null', 'Content-Type': 'application/json' },
      { 'Content-Type': 'application/json' }, // no Origin: fails closed
    ]) {
      for (const path of ['/api/locale', '/sign-in', '/no-such-page']) {
        const res = await request.post(path, { headers, data: '{}', maxRedirects: 0 })
        expect(res.status(), `${path} ${JSON.stringify(headers)}`).toBe(403)
        expectSecurityHeaders(res, `403 ${path}`)
      }
    }
    for (const method of ['put', 'patch', 'delete'] as const) {
      const res = await request[method]('/api/locale', { headers: { Origin: 'https://evil.test' }, maxRedirects: 0 })
      expect(res.status(), method).toBe(403)
    }
  })

  test('the same POST from this origin is not refused as cross-origin', async ({ request, baseURL }) => {
    const res = await request.post('/api/locale', { headers: { Origin: baseURL ?? '', 'Content-Type': 'application/json' }, data: '{}', maxRedirects: 0 })
    expect(res.status()).not.toBe(403)
    expectSecurityHeaders(res, 'same-origin POST')
  })
})

test.describe('under the CSP', () => {
  for (const path of ['/', '/sign-in']) {
    test(`${path}: the theme toggle (a React island) and the theme script work, with no CSP violation`, async ({ page }) => {
      await watchCsp(page)
      await page.emulateMedia({ colorScheme: 'light' })
      await page.goto(path)
      await page.waitForLoadState('networkidle')
      const html = page.locator('html')
      await expect(html).not.toHaveClass(/\bdark\b/)

      const toggle = page.locator('header button[aria-pressed]')
      await expect(toggle).toHaveAttribute('aria-pressed', 'false')
      await toggle.click() // works only if the island hydrated
      await expect(html).toHaveClass(/\bdark\b/)
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')

      // the inline theme script applies the stored choice before paint, against the system preference
      await page.reload()
      await page.waitForLoadState('networkidle')
      await expect(html).toHaveClass(/\bdark\b/)
      await expect(toggle).toHaveAttribute('aria-pressed', 'true')
      await toggle.press('Enter') // keyboard
      await expect(html).not.toHaveClass(/\bdark\b/)
      await expectNoCspViolations(page)
    })
  }

  test('the pages pass axe and report no CSP violation', async ({ page }) => {
    for (const path of ['/', '/sk/', '/sign-in', '/no-such-page']) {
      await page.goto(path)
      await expectAccessible(page)
    }
  })
})
