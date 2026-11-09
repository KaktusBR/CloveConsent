import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defineConsent } from '../src/config'
import { createConsent } from '../src/client'
import type { DriverHooks } from '../src/driver'
import { theme, turnstile, youtube } from '../src/catalog'

const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o))
const cookie = (categories: string[], data: object = { siteRevision: 1, revisions: { 'cloudflare-turnstile': 1, theme: 1, youtube: 1 } }) =>
  enc({ consentId: 'abc-12345678', categories, lastConsentTimestamp: '2026-10-14T10:00:00.000Z', data })
function fakeDriver(initial: string | null = null) {
  let raw = initial; let hooks!: DriverHooks
  const d = {
    init: vi.fn((_v: unknown, h: DriverHooks) => { hooks = h }),
    readRaw: () => raw, writeData: vi.fn(), showBanner: vi.fn(), open: vi.fn(), acceptAll: vi.fn(), rejectAll: vi.fn(), acceptCategories: vi.fn(), acceptServices: vi.fn(),
    set(r: string | null) { raw = r }, get hooks() { return hooks },
  }
  return d
}
const cfg = (hooks = {}) => defineConsent({ locales: ['en'], defaultLocale: 'en', revision: 1, services: [turnstile(), theme(), youtube()], hooks })
beforeEach(() => { document.body.innerHTML = ''; localStorage.clear() })

describe('decision and ready', () => {
  test('a first decision emits decision(first) then ready', () => {
    const d = fakeDriver(); const c = createConsent(cfg(), { driver: d as never }); c.init()
    const seen: string[] = []
    c.on('decision', (i) => seen.push(`decision:${i.kind}:${i.changed.join(',')}`)); c.on('ready', () => seen.push('ready'))
    d.set(cookie(['necessary', 'functional'])); d.hooks.onFirstConsent(); d.hooks.onConsent()
    expect(seen).toEqual(['decision:first:functional', 'ready'])
  })
  test('a change emits decision(change) with the changed categories', () => {
    const d = fakeDriver(cookie(['necessary', 'functional'])); const c = createConsent(cfg(), { driver: d as never }); c.init()
    const fn = vi.fn(); c.on('decision', fn)
    d.set(cookie(['necessary'])); d.hooks.onChange(['functional'], ['theme'])
    expect(fn).toHaveBeenCalledWith({ kind: 'change', changed: ['functional'], changedServices: ['theme'], locale: 'en' })
  })
  test('re-confirming a stale banner emits exactly one decision(reconfirm) and a ready (Review Focus 5)', () => {
    const d = fakeDriver(cookie(['necessary'], { siteRevision: 1, revisions: { theme: 1 } })); const c = createConsent(cfg(), { driver: d as never }); c.init()
    const dec = vi.fn(); const ready = vi.fn(); c.on('decision', dec); c.on('ready', ready)
    d.hooks.onDecision()
    expect(dec).toHaveBeenCalledTimes(1)
    expect(dec).toHaveBeenCalledWith({ kind: 'reconfirm', changed: [], changedServices: [], locale: 'en' })
    expect(ready).toHaveBeenCalledTimes(1)
  })
  test('closing without a re-prompt pending emits nothing', () => {
    const d = fakeDriver(cookie(['necessary'])); const c = createConsent(cfg(), { driver: d as never }); c.init()
    const fn = vi.fn(); c.on('decision', fn); d.hooks.onDecision()
    expect(fn).not.toHaveBeenCalled()
  })
  test('ready fires with the stored state on every load that has a decision', () => {
    const d = fakeDriver(cookie(['necessary', 'media'])); const c = createConsent(cfg(), { driver: d as never }); c.init()
    const fn = vi.fn(); c.on('ready', fn); d.hooks.onConsent()
    expect(fn.mock.calls[0]![0].categories).toContain('media')
  })
  test('config hooks onReady and onDecision receive the state and the info', () => {
    const hooks = { onReady: vi.fn(), onDecision: vi.fn() }
    const d = fakeDriver(); const c = createConsent(cfg(hooks), { driver: d as never }); c.init()
    d.set(cookie(['necessary', 'functional'])); d.hooks.onFirstConsent(); d.hooks.onConsent()
    expect(hooks.onDecision).toHaveBeenCalledWith(expect.objectContaining({ consentId: 'abc-12345678' }), { kind: 'first', changed: ['functional'], changedServices: ['theme'], locale: 'en' })
    expect(hooks.onReady).toHaveBeenCalledTimes(1)
  })
  test('a throwing listener does not stop the others', () => {
    const d = fakeDriver(); const c = createConsent(cfg(), { driver: d as never }); c.init()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    c.on('decision', () => { throw new Error('boom') }); const ok = vi.fn(); c.on('decision', ok)
    d.set(cookie(['necessary'])); d.hooks.onFirstConsent()
    warn.mockRestore()
    expect(ok).toHaveBeenCalled()
  })
})

describe('decision info carries what a consent record needs', () => {
  test('a first decision lists the services the visitor accepted and the language they saw', () => {
    const d = fakeDriver(); const c = createConsent(cfg(), { driver: d as never }); c.init()
    const fn = vi.fn(); c.on('decision', fn)
    d.set(enc({ consentId: 'abc-12345678', categories: ['necessary', 'media', 'functional'], data: {}, services: { media: ['youtube'], functional: [] } }))
    d.hooks.onFirstConsent()
    expect(fn).toHaveBeenCalledWith({ kind: 'first', changed: ['media', 'functional'], changedServices: ['youtube'], locale: 'en' })
  })
  test('changedServices from the driver reach the decision', () => {
    const d = fakeDriver(cookie(['necessary', 'media'])); const c = createConsent(cfg(), { driver: d as never }); c.init()
    const fn = vi.fn(); c.on('decision', fn)
    d.hooks.onChange([], ['youtube'])
    expect(fn.mock.calls[0]![0]).toMatchObject({ kind: 'change', changed: [], changedServices: ['youtube'] })
  })
})
describe('allowOnce', () => {
  test('works for an iframe embed and emits once', () => {
    const c = createConsent(cfg(), { driver: fakeDriver() as never }); c.init()
    const fn = vi.fn(); c.on('once', fn); c.allowOnce('youtube')
    expect(c.isAllowed('youtube')).toBe(true); expect(fn).toHaveBeenCalledWith('youtube')
  })
  test('is refused for anything that is not an embed', () => {
    const c = createConsent(cfg(), { driver: fakeDriver() as never }); c.init()
    expect(() => c.allowOnce('theme')).toThrow(/only works for embeds/)
    expect(() => c.allowOnce('cloudflare-turnstile')).toThrow(/only works for embeds/)
    expect(() => c.allowOnce('nope')).toThrow(/unknown service/)
  })
})

describe('leftovers', () => {
  test('are listed once per type and name', () => {
    document.cookie = 'stubborn=1; Path=/'
    const entry = { ...youtube(), id: 'tracker', category: 'marketing' as const, storage: [{ name: 'stubborn', type: 'cookie' as const, expiry: { en: 'x' }, purpose: { en: 'y' } }] }
    const c0 = defineConsent({ locales: ['en'], defaultLocale: 'en', revision: 1, services: [entry as never] })
    const cookieSpy = vi.spyOn(document, 'cookie', 'get').mockReturnValue('stubborn=1')
    const d = fakeDriver(enc({ consentId: 'abc-12345678', categories: ['necessary', 'marketing'], data: { siteRevision: 1, revisions: { tracker: 1 } } }))
    const c = createConsent(c0, { driver: d as never }); c.init()
    d.set(enc({ consentId: 'abc-12345678', categories: ['necessary'], data: { siteRevision: 1, revisions: { tracker: 1 } } }))
    d.hooks.onChange(['marketing'], []); d.hooks.onChange(['marketing'], [])
    cookieSpy.mockRestore()
    expect(c.leftovers.filter((l) => l.name === 'stubborn')).toHaveLength(1)
  })
})
