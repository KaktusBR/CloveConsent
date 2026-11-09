import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defineConsent } from '../src/config'
import { createConsent } from '../src/client'
import type { ConsentDriver, DriverHooks } from '../src/driver'
import { openStreetMap, theme, turnstile, youtube } from '../src/catalog'
import sk from '../src/locales/sk'

const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o))
function fakeDriver(initial: string | null = null) {
  let raw = initial
  let hooks!: DriverHooks
  const d = {
    calls: [] as string[], written: [] as unknown[],
    init: vi.fn((_v: unknown, h: DriverHooks) => { hooks = h }),
    readRaw: (): string | null => raw,
    writeData: vi.fn((x: unknown) => { d.written.push(x) }),
    showBanner: vi.fn(), open: vi.fn(), acceptAll: vi.fn(), rejectAll: vi.fn(), acceptCategories: vi.fn(),
    set(r: string | null) { raw = r }, get hooks() { return hooks },
  }
  return d
}
const drv = (d: ReturnType<typeof fakeDriver>) => d as unknown as ConsentDriver
const cfg = (hooks = {}) => defineConsent({ locales: ['sk'], defaultLocale: 'sk', packs: [sk], revision: 1, services: [turnstile(), theme(), youtube()], hooks })
const cookie = (categories: string[], data: object = { siteRevision: 1, revisions: { 'cloudflare-turnstile': 1, theme: 1, youtube: 1 } }) =>
  enc({ consentId: 'abc-12345678', categories, lastConsentTimestamp: '2026-10-14T10:00:00.000Z', data })

beforeEach(() => { document.body.innerHTML = ''; localStorage.clear() })

describe('allowed / undecided', () => {
  test('undecided allows only necessary', () => {
    const c = createConsent(cfg(), { driver: drv(fakeDriver()) }); c.init()
    expect(c.isAllowed('cloudflare-turnstile')).toBe(true)
    expect(c.isAllowed('theme')).toBe(false)
    expect(c.isAllowed('youtube')).toBe(false)
    expect(c.getState()).toBeNull()
  })
  test('stored categories allow matching services', () => {
    const c = createConsent(cfg(), { driver: drv(fakeDriver(cookie(['necessary', 'media']))) }); c.init()
    expect(c.isAllowed('youtube')).toBe(true)
    expect(c.isAllowed('theme')).toBe(false)
  })
  test('allowOnce allows for this page view only and emits once', () => {
    const c = createConsent(cfg(), { driver: drv(fakeDriver()) }); c.init()
    const fn = vi.fn(); c.on('once', fn)
    c.allowOnce('youtube')
    expect(c.isAllowed('youtube')).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(createConsent(cfg(), { driver: drv(fakeDriver()) }).isAllowed('youtube')).toBe(false)
  })
  test('unknown ids are not allowed', () => {
    const c = createConsent(cfg(), { driver: drv(fakeDriver()) }); c.init()
    expect(c.isAllowed('nope')).toBe(false)
    expect(() => c.allowOnce('nope')).toThrow()
  })
})

describe('re-consent gates optional services until a decision (spec section 6)', () => {
  const all = ['necessary', 'functional', 'media']
  test('a service missing from stored revisions is not allowed; its category siblings with known revisions are', () => {
    const d = fakeDriver(cookie(all, { siteRevision: 1, revisions: { 'cloudflare-turnstile': 1, theme: 1 } }))
    const c = createConsent(cfg(), { driver: drv(d) }); c.init()
    expect(c.isAllowed('youtube')).toBe(false)
    expect(c.isAllowed('theme')).toBe(true)
    expect(c.isAllowed('cloudflare-turnstile')).toBe(true)
  })
  test('a service whose catalogRevision increased is not allowed', () => {
    const y = youtube(); y.catalogRevision = 2
    const conf = defineConsent({ locales: ['sk'], defaultLocale: 'sk', packs: [sk], revision: 1, services: [turnstile(), theme(), y] })
    const c = createConsent(conf, { driver: drv(fakeDriver(cookie(all))) }); c.init()
    expect(c.isAllowed('youtube')).toBe(false)
    expect(c.isAllowed('theme')).toBe(true)
  })
  test('a site revision bump blocks every optional service; necessary and allowOnce still work', () => {
    const conf = defineConsent({ locales: ['sk'], defaultLocale: 'sk', packs: [sk], revision: 2, services: [turnstile(), theme(), youtube()] })
    const c = createConsent(conf, { driver: drv(fakeDriver(cookie(all))) }); c.init()
    expect(c.isAllowed('theme')).toBe(false)
    expect(c.isAllowed('youtube')).toBe(false)
    expect(c.isAllowed('cloudflare-turnstile')).toBe(true)
    c.allowOnce('youtube')
    expect(c.isAllowed('youtube')).toBe(true)
  })
  test('a newly added script service in an accepted category is not loaded until a decision', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const plausible = { ...youtube(), id: 'plausible', origins: ['plausible.io'], gating: { type: 'script' as const, src: 'https://plausible.io/js/s.js' } }
    const conf = defineConsent({ locales: ['sk'], defaultLocale: 'sk', packs: [sk], revision: 1, services: [turnstile(), theme(), youtube(), plausible], allowFallback: true })
    warn.mockRestore()
    const d = fakeDriver(cookie(all))
    d.writeData.mockImplementation((x: any) => { d.written.push(x); d.set(cookie(all, x)) })
    createConsent(conf, { driver: drv(d) }).init()
    expect(document.querySelector('script[data-consent-service="plausible"]')).toBeNull()
    d.hooks.onDecision()
    expect(document.querySelector('script[data-consent-service="plausible"]')).not.toBeNull()
  })
  test('after a decision persists the revisions the service is allowed per category', () => {
    const d = fakeDriver(cookie(all, { siteRevision: 1, revisions: { theme: 1 } }))
    d.writeData.mockImplementation((x: any) => { d.written.push(x); d.set(cookie(all, x)) })
    const c = createConsent(cfg(), { driver: drv(d) }); c.init()
    expect(c.isAllowed('youtube')).toBe(false)
    const fn = vi.fn(); const dec = vi.fn(); c.on('ready', fn); c.on('decision', dec)
    d.hooks.onDecision()
    expect(d.writeData).toHaveBeenCalledTimes(1)
    expect(c.isAllowed('youtube')).toBe(true)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(dec).toHaveBeenCalledTimes(1)
    expect(dec).toHaveBeenCalledWith({ kind: 'reconfirm', changed: [] })
  })
  test('unchanged revisions allow per category', () => {
    const c = createConsent(cfg(), { driver: drv(fakeDriver(cookie(all))) }); c.init()
    expect(c.isAllowed('theme')).toBe(true)
    expect(c.isAllowed('youtube')).toBe(true)
  })
  test('a service id equal to an Object.prototype key is not treated as known', () => {
    const conf = defineConsent({ locales: ['sk'], defaultLocale: 'sk', packs: [sk], revision: 1, services: [{ ...theme(), id: 'constructor' }], allowFallback: true })
    const c = createConsent(conf, { driver: drv(fakeDriver(cookie(all, { siteRevision: 1, revisions: {} }))) }); c.init()
    expect(c.isAllowed('constructor')).toBe(false)
  })
})

describe('per-service consent', () => {
  const both = ['necessary', 'functional', 'media']
  const conf = (services = [turnstile(), theme(), youtube(), openStreetMap()]) =>
    defineConsent({ locales: ['sk'], defaultLocale: 'sk', packs: [sk], revision: 1, services })
  const rev = { siteRevision: 1, revisions: { 'cloudflare-turnstile': 1, theme: 1, youtube: 1, openstreetmap: 1 } }
  const withServices = (services: object, data: object = rev) =>
    enc({ consentId: 'abc-12345678', categories: both, lastConsentTimestamp: '2026-10-14T10:00:00.000Z', data, services })
  test('only the listed service of an accepted category is allowed', () => {
    const c = createConsent(conf(), { driver: drv(fakeDriver(withServices({ media: ['openstreetmap'], functional: ['theme'] }))) }); c.init()
    expect(c.isAllowed('openstreetmap')).toBe(true)
    expect(c.isAllowed('youtube')).toBe(false)
    expect(c.isAllowed('theme')).toBe(true)
    expect(c.isAllowed('cloudflare-turnstile')).toBe(true)
  })
  test('an old cookie with no services field allows every service of an accepted category (review focus 1)', () => {
    const c = createConsent(conf(), { driver: drv(fakeDriver(cookie(both, rev))) }); c.init()
    expect(c.getState()!.services).toBeNull()
    expect(c.isAllowed('openstreetmap')).toBe(true)
    expect(c.isAllowed('youtube')).toBe(true)
    expect(c.isAllowed('theme')).toBe(true)
  })
  test('a service with a higher catalogRevision stays blocked though its category and id are accepted (review focus 2)', () => {
    const y = youtube(); y.catalogRevision = 2
    const c = createConsent(conf([turnstile(), theme(), y, openStreetMap()]), { driver: drv(fakeDriver(withServices({ media: ['youtube', 'openstreetmap'], functional: ['theme'] }))) }); c.init()
    expect(c.isAllowed('youtube')).toBe(false)
    expect(c.isAllowed('openstreetmap')).toBe(true)
  })
})

describe('once supersession and idempotent init', () => {
  test('a persisted decision supersedes one-time allowance and clears storage', () => {
    const d = fakeDriver(cookie(['necessary'])); const c = createConsent(cfg(), { driver: drv(d) }); c.init()
    c.allowOnce('youtube'); localStorage.setItem('theme', 'dark')
    expect(c.isAllowed('youtube')).toBe(true)
    d.set(cookie(['necessary'])); d.hooks.onChange(['functional'])
    expect(c.isAllowed('youtube')).toBe(false)
    expect(localStorage.getItem('theme')).toBeNull()
  })
  test('first consent also clears one-time allowances', () => {
    const d = fakeDriver(); const c = createConsent(cfg(), { driver: drv(d) }); c.init()
    c.allowOnce('youtube'); d.set(cookie(['necessary'])); d.hooks.onFirstConsent()
    expect(c.isAllowed('youtube')).toBe(false)
  })
  test('second init is a no-op', () => {
    const d = fakeDriver(); const c = createConsent(cfg(), { driver: drv(d) }); c.init(); c.init()
    expect(d.init).toHaveBeenCalledTimes(1)
  })
})

describe('prompting', () => {
  test('existing valid consent does not re-show the banner', () => {
    const d = fakeDriver(cookie(['necessary'])); createConsent(cfg(), { driver: drv(d) }).init()
    expect(d.showBanner).not.toHaveBeenCalled()
  })
  test('existing consent with a stale revision re-shows the banner', () => {
    const d = fakeDriver(cookie(['necessary'], { siteRevision: 1, revisions: { theme: 1 } })); createConsent(cfg(), { driver: drv(d) }).init()
    expect(d.showBanner).toHaveBeenCalledTimes(1)
  })
})

describe('events and persistence', () => {
  test('first consent writes revisions and emits events and hooks', () => {
    const hook = { onDecision: vi.fn(), onReady: vi.fn() }
    const d = fakeDriver(); const c = createConsent(cfg(hook), { driver: drv(d) }); c.init()
    const seen: string[] = []; c.on('decision', (i) => { if (i.kind === 'first') seen.push('first') }); c.on('ready', () => seen.push('consent'))
    d.set(cookie(['necessary', 'functional'], {})); d.hooks.onFirstConsent(); d.hooks.onConsent()
    expect(d.written.at(-1)).toEqual({ siteRevision: 1, revisions: { 'cloudflare-turnstile': 1, theme: 1, youtube: 1 } })
    expect(seen).toEqual(['first', 'consent'])
    expect(hook.onDecision).toHaveBeenCalledTimes(1)
    expect(hook.onDecision.mock.calls[0]![1].kind).toBe('first')
    expect(hook.onReady).toHaveBeenCalledTimes(1)
  })
  test('change emits changed categories and unloads withdrawn services', () => {
    const d = fakeDriver(cookie(['necessary', 'functional'])); const c = createConsent(cfg(), { driver: drv(d) }); c.init()
    localStorage.setItem('theme', 'dark')
    const fn = vi.fn(); c.on('decision', (i) => { if (i.kind === 'change') fn(i.changed) })
    d.set(cookie(['necessary'])); d.hooks.onChange(['functional'])
    expect(fn).toHaveBeenCalledWith(['functional'])
    expect(localStorage.getItem('theme')).toBeNull()
  })
  test('onDecision persists only when a cookie with stale revisions exists', () => {
    const d = fakeDriver(); createConsent(cfg(), { driver: drv(d) }).init()
    d.hooks.onDecision(); expect(d.writeData).not.toHaveBeenCalled()
    d.set(cookie(['necessary'])); d.hooks.onDecision(); expect(d.writeData).not.toHaveBeenCalled()
    d.set(cookie(['necessary'], { siteRevision: 1, revisions: { theme: 1 } })); d.hooks.onDecision(); expect(d.writeData).toHaveBeenCalledTimes(1)
  })
  test('throwing hook does not break other listeners', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d = fakeDriver(); const c = createConsent(cfg({ onReady() { throw new Error('boom') } }), { driver: drv(d) }); c.init()
    const fn = vi.fn(); c.on('ready', fn)
    d.set(cookie(['necessary'])); expect(() => d.hooks.onConsent()).not.toThrow()
    expect(fn).toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})

describe('failure handling (review focus 4)', () => {
  test('driver.readRaw throwing means undecided, banner not blocked', () => {
    const d = fakeDriver(); d.readRaw = () => { throw new Error('blocked') }
    const c = createConsent(cfg(), { driver: drv(d) })
    expect(() => c.init()).not.toThrow()
    expect(c.getState()).toBeNull()
    expect(d.init).toHaveBeenCalled()
  })
  test('garbage cookie means undecided', () => {
    const c = createConsent(cfg(), { driver: drv(fakeDriver('{{{')) }); c.init()
    expect(c.getState()).toBeNull()
  })
})

describe('public handle', () => {
  test('window.CookieConsent exposes only acceptAll, rejectAll, getState', () => {
    const c = createConsent(cfg(), { driver: drv(fakeDriver()) }); c.init()
    expect(Object.keys((window as any).CookieConsent).sort()).toEqual(['acceptAll', 'getState', 'rejectAll'])
    expect(Object.isFrozen((window as any).CookieConsent)).toBe(true)
  })
})
