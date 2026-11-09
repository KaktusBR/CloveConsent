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
    showBanner: vi.fn(), open: vi.fn(), acceptAll: vi.fn(), rejectAll: vi.fn(), acceptCategories: vi.fn(), acceptServices: vi.fn(),
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
    expect(dec).toHaveBeenCalledWith({ kind: 'reconfirm', changed: [], changedServices: [], locale: 'sk' })
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
    d.set(cookie(['necessary'])); d.hooks.onChange(['functional'], [])
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
    d.set(cookie(['necessary'])); d.hooks.onChange(['functional'], [])
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

describe('per-service API', () => {
  const both = ['necessary', 'functional', 'media']
  const conf = () => defineConsent({ locales: ['sk'], defaultLocale: 'sk', packs: [sk], revision: 1, services: [turnstile(), theme(), youtube(), openStreetMap()] })
  const rev = { siteRevision: 1, revisions: { 'cloudflare-turnstile': 1, theme: 1, youtube: 1, openstreetmap: 1 } }
  const withServices = (services: object | undefined, categories = both) =>
    enc({ consentId: 'abc-12345678', categories, lastConsentTimestamp: '2026-10-14T10:00:00.000Z', data: rev, ...(services ? { services } : {}) })

  test('setServices selects exactly these services and empties the other optional categories', () => {
    const d = fakeDriver(); const c = createConsent(conf(), { driver: drv(d) }); c.init()
    c.setServices(['openstreetmap', 'youtube'])
    expect(d.acceptServices).toHaveBeenCalledTimes(1)
    expect(d.acceptServices).toHaveBeenCalledWith({ media: ['openstreetmap', 'youtube'], functional: [] })
  })
  test('setServices throws for an unknown id and ignores necessary services', () => {
    const d = fakeDriver(); const c = createConsent(conf(), { driver: drv(d) }); c.init()
    expect(() => c.setServices(['nope'])).toThrow('[consent] unknown service nope')
    expect(d.acceptServices).not.toHaveBeenCalled()
    c.setServices(['cloudflare-turnstile', 'theme'])
    expect(d.acceptServices).toHaveBeenCalledWith({ media: [], functional: ['theme'] })
  })
  test('setServices([]) accepts no optional service', () => {
    const d = fakeDriver(); const c = createConsent(conf(), { driver: drv(d) }); c.init()
    c.setServices([])
    expect(d.acceptServices).toHaveBeenCalledWith({ media: [], functional: [] })
  })
  test('acceptService keeps the services that are already accepted', () => {
    const d = fakeDriver(withServices({ media: ['openstreetmap'], functional: ['theme'] })); const c = createConsent(conf(), { driver: drv(d) }); c.init()
    c.acceptService('youtube')
    expect(d.acceptServices).toHaveBeenCalledWith({ media: ['openstreetmap', 'youtube'], functional: ['theme'] })
  })
  test('acceptService on an old cookie without services keeps every service of the accepted categories', () => {
    const d = fakeDriver(withServices(undefined, ['necessary', 'functional'])); const c = createConsent(conf(), { driver: drv(d) }); c.init()
    c.acceptService('youtube')
    expect(d.acceptServices).toHaveBeenCalledWith({ media: ['youtube'], functional: ['theme'] })
  })
  test('acceptService before any decision selects only that service; unknown id throws', () => {
    const d = fakeDriver(); const c = createConsent(conf(), { driver: drv(d) }); c.init()
    c.acceptService('youtube')
    expect(d.acceptServices).toHaveBeenCalledWith({ media: ['youtube'], functional: [] })
    expect(() => c.acceptService('nope')).toThrow('[consent] unknown service nope')
  })
})

describe('withdraw', () => {
  const both = ['necessary', 'functional', 'media']
  test('withdraw() rejects everything and the decision is a withdraw listing what was allowed before', () => {
    const d = fakeDriver(cookie(both)); const hook = { onDecision: vi.fn() }
    const c = createConsent(cfg(hook), { driver: drv(d) }); c.init()
    const fn = vi.fn(); c.on('decision', fn)
    c.withdraw()
    expect(d.rejectAll).toHaveBeenCalledTimes(1)
    d.set(cookie(['necessary'])); d.hooks.onChange(['functional', 'media'], ['theme', 'youtube'])
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn.mock.calls[0]![0]).toMatchObject({ kind: 'withdraw', changed: ['functional', 'media'], locale: 'sk' })
    expect(fn.mock.calls[0]![0].changedServices.sort()).toEqual(['theme', 'youtube'])
    expect(hook.onDecision.mock.calls[0]![1].kind).toBe('withdraw')
  })
  test('the withdraw flag is one-shot: the next change is a plain change', () => {
    const d = fakeDriver(cookie(both)); const c = createConsent(cfg(), { driver: drv(d) }); c.init()
    const fn = vi.fn(); c.on('decision', fn)
    c.withdraw()
    d.set(cookie(['necessary'])); d.hooks.onChange(['functional', 'media'], [])
    d.set(cookie(both)); d.hooks.onChange(['functional'], ['theme'])
    expect(fn.mock.calls.map((x) => x[0].kind)).toEqual(['withdraw', 'change'])
  })
  test('withdraw() with nothing accepted does not leave a flag behind', () => {
    const d = fakeDriver(cookie(['necessary'])); const c = createConsent(cfg(), { driver: drv(d) }); c.init()
    const fn = vi.fn(); c.on('decision', fn)
    c.withdraw()
    d.set(cookie(['necessary', 'media'])); d.hooks.onChange(['media'], ['youtube'])
    expect(fn.mock.calls[0]![0].kind).toBe('change')
  })
})

describe('turning a service off inside an accepted category', () => {
  const plausible = {
    ...youtube(), id: 'plausible', origins: ['plausible.io'], gating: { type: 'script' as const, src: 'https://plausible.io/js/s.js' },
    storage: [{ name: 'plausible_ignore', type: 'localStorage' as const, expiry: { en: 'x' }, purpose: { en: 'y' } }],
  }
  const conf = () => defineConsent({ locales: ['sk'], defaultLocale: 'sk', packs: [sk], revision: 1, services: [turnstile(), youtube(), plausible], allowFallback: true })
  const rev = { siteRevision: 1, revisions: { 'cloudflare-turnstile': 1, youtube: 1, plausible: 1 } }
  const withMedia = (ids: string[]) =>
    enc({ consentId: 'abc-12345678', categories: ['necessary', 'media'], data: rev, services: { media: ids } })

  test('the service script is removed and its storage cleared while the category stays accepted', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d = fakeDriver(withMedia(['youtube', 'plausible'])); const c = createConsent(conf(), { driver: drv(d) }); c.init()
    expect(document.querySelector('script[data-consent-service="plausible"]')).not.toBeNull()
    localStorage.setItem('plausible_ignore', '1')
    d.set(withMedia(['youtube'])); d.hooks.onChange([], ['plausible'])
    expect(document.querySelector('script[data-consent-service="plausible"]')).toBeNull()
    expect(localStorage.getItem('plausible_ignore')).toBeNull()
    expect(c.isAllowed('youtube')).toBe(true)
    expect(c.isAllowed('plausible')).toBe(false)
  })
  test('storage that cannot be cleared is reported in leftovers', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const entry = { ...plausible, storage: [{ name: 'stubborn', type: 'cookie' as const, expiry: { en: 'x' }, purpose: { en: 'y' } }] }
    const conf2 = defineConsent({ locales: ['sk'], defaultLocale: 'sk', packs: [sk], revision: 1, services: [turnstile(), youtube(), entry], allowFallback: true })
    const d = fakeDriver(withMedia(['youtube', 'plausible'])); const c = createConsent(conf2, { driver: drv(d) }); c.init()
    const spy = vi.spyOn(document, 'cookie', 'get').mockReturnValue('stubborn=1')
    d.set(withMedia(['youtube'])); d.hooks.onChange([], ['plausible'])
    spy.mockRestore()
    expect(c.leftovers.map((l) => l.name)).toEqual(['stubborn'])
  })
  test('a service that stays accepted is not unloaded', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d = fakeDriver(withMedia(['youtube', 'plausible'])); const c = createConsent(conf(), { driver: drv(d) }); c.init()
    d.set(withMedia(['plausible'])); d.hooks.onChange([], ['youtube'])
    expect(document.querySelector('script[data-consent-service="plausible"]')).not.toBeNull()
    expect(c.isAllowed('plausible')).toBe(true)
  })
})
