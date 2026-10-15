import { describe, expect, test, vi } from 'vitest'
import { createConsentLogger } from '../src/log'
import { defineConsent } from '../src/config'
import { theme } from '../src/catalog'
import sk from '../src/locales/sk'
import { parseConsent } from '../src/state'

const config = defineConsent({ locales: ['sk'], defaultLocale: 'sk', packs: [sk], revision: 1, services: [theme()] })
const state = parseConsent(encodeURIComponent(JSON.stringify({ consentId: 'abc-12345678', categories: ['necessary', 'functional'], data: { siteRevision: 1, revisions: { theme: 1 } } })))!
const loc = { origin: 'https://example.com', hostname: 'example.com' }

describe('endpoint rules', () => {
  test.each(['/api/consent', 'https://logs.example.com/c'])('accepts %s', (e) => {
    expect(() => createConsentLogger({ endpoint: e, location: loc })).not.toThrow()
  })
  test.each(['http://logs.example.com/c', 'javascript:x', '//evil.com/c', 'ftp://x.com'])('rejects %s', (e) => {
    expect(() => createConsentLogger({ endpoint: e, location: loc })).toThrow()
  })
  test.each(['/\t/evil.com', '/\n/evil.com', '/\r/evil.com', ' /api/consent', '/api/consent ', '/\\evil.com', 'https://user:pw@logs.example.com/c', 'not a url'])('rejects bypass vector %j', (e) => {
    expect(() => createConsentLogger({ endpoint: e, location: loc })).toThrow()
  })
  test.each(['http://localhost.evil.com/c', 'http://127.0.0.1.evil.com/c'])('rejects lookalike host %s on localhost', (e) => {
    expect(() => createConsentLogger({ endpoint: e, location: { origin: 'http://localhost:4321', hostname: 'localhost' } })).toThrow()
  })
  test('accepts http://[::1] when running on [::1]', () => {
    expect(() => createConsentLogger({ endpoint: 'http://[::1]:8787/c', location: { origin: 'http://[::1]:4321', hostname: '[::1]' } })).not.toThrow()
  })
  test('http://localhost allowed only when running on localhost', () => {
    expect(() => createConsentLogger({ endpoint: 'http://localhost:8787/c', location: loc })).toThrow()
    expect(() => createConsentLogger({ endpoint: 'http://localhost:8787/c', location: { origin: 'http://localhost:4321', hostname: 'localhost' } })).not.toThrow()
  })
})

describe('request', () => {
  test('posts the fixed payload only, without credentials', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true })
    await createConsentLogger({ endpoint: '/api/consent', siteSlug: 'my-site', fetchImpl: f as any, location: loc })(state, config)
    const [url, init] = f.mock.calls[0]!
    expect(url).toBe('/api/consent')
    expect(init.method).toBe('POST'); expect(init.credentials).toBe('omit')
    expect(JSON.parse(init.body)).toEqual({
      siteSlug: 'my-site', consentId: 'abc-12345678', siteRevision: 1, revisions: { theme: 1 },
      categories: { necessary: true, functional: true, media: false, social: false, analytics: false, marketing: false },
    })
  })
  test('does not follow redirects and uses keepalive', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true })
    await createConsentLogger({ endpoint: '/api/consent', fetchImpl: f as any, location: loc })(state, config)
    const init = f.mock.calls[0]![1]
    expect(init.redirect).toBe('error'); expect(init.keepalive).toBe(true)
  })
  test('does nothing without a state', async () => {
    const f = vi.fn(); await createConsentLogger({ endpoint: '/x', fetchImpl: f as any, location: loc })(null, config)
    expect(f).not.toHaveBeenCalled()
  })
  test('swallows network errors', async () => {
    const f = vi.fn().mockRejectedValue(new Error('offline'))
    await expect(createConsentLogger({ endpoint: '/x', fetchImpl: f as any, location: loc })(state, config)).resolves.toBeUndefined()
  })
  test('aborts after the timeout', async () => {
    vi.useFakeTimers()
    const f = vi.fn((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted')))))
    const p = createConsentLogger({ endpoint: '/x', timeoutMs: 5000, fetchImpl: f as any, location: loc })(state, config)
    await vi.advanceTimersByTimeAsync(5001)
    await expect(p).resolves.toBeUndefined()
    vi.useRealTimers()
  })
})
