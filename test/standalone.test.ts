// @vitest-environment-options {"url": "https://site.example/shop/item?id=5#reviews"}
// The standalone runtime against the real vanilla-cookieconsent in jsdom. One boot per page view: the tests share it, in order.
import { createRequire } from 'node:module'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import * as CC from 'vanilla-cookieconsent'
import { defineConsent, toPublicJson } from '../src/config'
import { googleTagManager, youtube } from '../src/catalog'
import sk from '../src/locales/sk'
import { boot, type StandaloneBundle } from '../src/standalone'
import type { Consent } from '../src/client'

const config = defineConsent({
  locales: ['en', 'sk'], defaultLocale: 'en', packs: [sk], revision: 1,
  services: [youtube(), googleTagManager({ containerId: 'GTM-ABC123' })],
  records: { url: 'https://records.example/consent' },
  ui: { theme: { tokens: { primary: '#123456' } } },
})
const bundle = (configs: Record<string, string>): StandaloneBundle => ({
  site: 'site-key-1', defaultLocale: 'en', configs, reportUrl: 'https://reports.example/unconfigured',
})
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)) }
const clearCookie = () => { document.cookie = 'cc_cookie=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT' }

const fetchMock = vi.fn(async (_url: unknown, _init?: unknown) => new Response(null, { status: 204 }))
const beacon = vi.fn((_url: string, _data?: unknown) => true)
let consent: Consent | null
const reportsOf = (kind: string) => beacon.mock.calls.map(([, data]) => JSON.parse(String(data))).filter((p) => p.kind === kind)
// what the boot itself reported and warned (mock calls do not outlive the hook that made them)
let bootUnknownReports: Record<string, string>[] = []
let bootWarnings: string[] = []

beforeAll(async () => {
  clearCookie()
  // jsdom has constructed sheets but no adoptedStyleSheets: give this document the property a browser has
  const adoptedSheets = new WeakMap<Document, CSSStyleSheet[]>()
  Object.defineProperty(Document.prototype, 'adoptedStyleSheets', {
    configurable: true,
    get(this: Document) { return adoptedSheets.get(this) ?? [] },
    set(this: Document, v: CSSStyleSheet[]) { adoptedSheets.set(this, v) },
  })
  vi.stubGlobal('fetch', fetchMock)
  Object.defineProperty(navigator, 'sendBeacon', { configurable: true, value: beacon })
  document.documentElement.lang = 'sk'
  document.body.innerHTML = '<div data-cloveconsent-settings id="panel"></div>'
    + '<script type="text/plain" data-consent="google-tag-manager" src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC123" id="marked"></script>'
    // marked tags naming services the configuration does not have: two elements for one id, one for another
    + '<iframe data-consent="vimeo" data-consent-src="https://player.vimeo.com/video/1" id="unknown-frame"></iframe>'
    + '<script type="text/plain" data-consent="chat-widget" src="https://chat.example/a.js" id="unknown-a"></script>'
    + '<script type="text/plain" data-consent="chat-widget" src="https://chat.example/b.js"></script>'
  const warn = vi.spyOn(console, 'warn')
  consent = boot(bundle({ en: toPublicJson(config, 'en'), sk: toPublicJson(config, 'sk') }))
  await flush()
  bootUnknownReports = reportsOf('unknown')
  bootWarnings = warn.mock.calls.map((c) => String(c[0]))
  warn.mockRestore()
})
afterAll(() => {
  CC.reset(false)
  clearCookie()
  vi.unstubAllGlobals()
  delete (navigator as unknown as Record<string, unknown>).sendBeacon
  delete (Document.prototype as unknown as Record<string, unknown>).adoptedStyleSheets
})

describe('boot', () => {
  test('picks the page language from the bundle', () => {
    expect(consent).not.toBeNull()
    expect(consent!.locale).toBe('sk')
  })

  test('adopts the styles without creating any <style> element', () => {
    expect(document.querySelectorAll('style')).toHaveLength(0)
    const sheets = (document as Document & { adoptedStyleSheets: CSSStyleSheet[] }).adoptedStyleSheets
    const text = sheets.flatMap((s) => [...s.cssRules].map((r) => r.cssText)).join('\n')
    expect(text).toContain('#cc-main')
    expect(text).toContain('.consent-settings')
  })

  test('applies the theme overrides to the document root', () => {
    expect(document.documentElement.style.getPropertyValue('--consent-override-primary')).toBe('#123456')
  })

  test('renders the settings panel into [data-cloveconsent-settings], in the page language', () => {
    const panel = document.getElementById('panel')!
    expect(panel.querySelector('[data-consent-action="accept-all"]')).not.toBeNull()
    expect(panel.textContent).toContain(sk.messages.settingsTitle)
  })

  test('marked tags stay blocked before consent', () => {
    expect(document.getElementById('marked')!.getAttribute('type')).toBe('text/plain')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('an unconfigured tracker is reported once to reportUrl, with the site key and no personal data', async () => {
    for (let i = 0; i < 2; i++) {
      const s = document.createElement('script')
      s.src = `https://static.hotjar.com/c/hotjar-${i}.js?sv=6`
      document.body.append(s)
    }
    const markup = document.createElement('div')
    markup.innerHTML = '<script src="https://static.hotjar.com/c/again.js"></script>'
    document.body.append(markup)
    await flush()
    const unconfigured = reportsOf('unconfigured')
    expect(unconfigured).toHaveLength(1)
    expect(beacon.mock.calls.every(([url]) => url === 'https://reports.example/unconfigured')).toBe(true)
    const payload = unconfigured[0]
    expect(Object.keys(payload).sort()).toEqual(['kind', 'path', 'service', 'site', 'timestamp'])
    expect(payload.site).toBe('site-key-1')
    expect(payload.service).toBe('hotjar')
    expect(payload.path).toBe('/shop/item')
    expect(Number.isNaN(Date.parse(payload.timestamp))).toBe(false)
    // and it stays blocked
    document.querySelectorAll('script[src*="hotjar"]').forEach((s) => expect(s.getAttribute('type')).toBe('text/plain'))
  })

  test('a marked tag naming an unknown service id stays blocked, is reported once per id and warned about once per id', () => {
    const unknown = bootUnknownReports
    expect(unknown.map((p) => p.service).sort()).toEqual(['chat-widget', 'vimeo'])
    for (const p of unknown) {
      expect(Object.keys(p).sort()).toEqual(['kind', 'path', 'service', 'site', 'timestamp'])
      expect(p.site).toBe('site-key-1')
      expect(p.path).toBe('/shop/item')
    }
    const warnings = bootWarnings.filter((m) => m.includes('unknown service'))
    expect(warnings).toHaveLength(2)
    expect(warnings.some((m) => m.includes('"chat-widget"'))).toBe(true)
    expect(warnings.some((m) => m.includes('"vimeo"'))).toBe(true)
    // blocked, and no placeholder for a service the configuration cannot describe
    expect(document.getElementById('unknown-frame')!.hasAttribute('src')).toBe(false)
    expect(document.getElementById('unknown-a')!.getAttribute('type')).toBe('text/plain')
    expect(document.querySelector('[data-consent-placeholder-for="vimeo"]')).toBeNull()
  })

  test('a decision in the panel posts one record to records.url with the site key, the consent reference and kind', async () => {
    document.querySelector<HTMLElement>('#panel [data-consent-action="accept-all"]')!.click()
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]! as [string, RequestInit]
    expect(url).toBe('https://records.example/consent')
    const body = JSON.parse(String(init.body))
    expect(body.siteSlug).toBe('site-key-1')
    expect(body.consentId).toBe(consent!.getState()!.consentId)
    expect(body.consentId).toBeTruthy()
    expect(body.kind).toBe('first')
    // the sync after the decision meets the held unconfigured trackers (marked tags naming a catalog id the configuration lacks):
    // already reported as unconfigured, they are not reported again as unknown
    expect(reportsOf('unknown')).toEqual([])
  })

  test('the accepted marked script is activated; an unconfigured tracker stays blocked, not reported again', async () => {
    const reports = beacon.mock.calls.length
    await flush()
    // replaced by an activated copy that keeps its id
    const gtm = document.getElementById('marked')!
    expect(gtm.hasAttribute('data-consent')).toBe(false)
    expect(gtm.hasAttribute('type')).toBe(false)
    expect(gtm.getAttribute('src')).toBe('https://www.googletagmanager.com/gtm.js?id=GTM-ABC123')
    const s = document.createElement('script')
    s.src = 'https://static.hotjar.com/c/after.js'
    document.body.append(s)
    expect(s.getAttribute('type')).toBe('text/plain')
    expect(beacon.mock.calls.length).toBe(reports)
  })

  test('a second boot returns the same client', () => {
    expect(boot(bundle({ en: '{}', sk: '{}' }))).toBe(consent)
  })
})

const jsdom = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string, o: object) => { window: Window & typeof globalThis } }
const markedPage = '<!DOCTYPE html><html lang="sk"><head></head><body>'
  + '<script type="text/plain" data-consent="google-tag-manager" src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC123"></script>'
  + '<iframe data-consent="youtube" data-consent-src="https://www.youtube-nocookie.com/embed/abc"></iframe>'
  + '<div data-cloveconsent-settings></div></body></html>'
/** A page of its own whose document is still being parsed: boot sets everything up but leaves the engine (global) alone. */
const parsingPage = (prepare: (win: Window & typeof globalThis) => void = () => {}) => {
  const win = new jsdom.JSDOM(markedPage, { url: 'https://other.example/' }).window
  Object.defineProperty(win.document, 'readyState', { configurable: true, value: 'loading' })
  prepare(win)
  return win
}

describe('boot with a malformed config', () => {
  test('returns null, logs once, and leaves every marked tag blocked', async () => {
    const win = new jsdom.JSDOM('<!DOCTYPE html><html lang="sk"><head></head><body>'
      + '<script type="text/plain" data-consent="google-tag-manager" src="https://www.googletagmanager.com/gtm.js?id=GTM-ABC123"></script>'
      + '<iframe data-consent="youtube" data-consent-src="https://www.youtube-nocookie.com/embed/abc"></iframe>'
      + '<div data-cloveconsent-settings></div></body></html>', { url: 'https://other.example/' }).window
    const doc = win.document
    const sent = vi.fn(() => true)
    Object.defineProperty(win.navigator, 'sendBeacon', { configurable: true, value: sent })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      expect(boot(bundle({ en: toPublicJson(config, 'en'), sk: '{"locales": ' }), doc)).toBeNull()
      expect(error).toHaveBeenCalledTimes(1)
      expect(boot(bundle({ en: toPublicJson(config, 'en'), sk: '{"locales": ' }), doc)).toBeNull()
      expect(error).toHaveBeenCalledTimes(1)
    } finally { error.mockRestore() }
    expect(doc.querySelector('script')!.getAttribute('type')).toBe('text/plain')
    expect(doc.querySelector('iframe')!.hasAttribute('src')).toBe(false)
    expect(doc.querySelector('[data-cloveconsent-settings]')!.childNodes).toHaveLength(0)
    // auto-blocking is still on: a known tracker added later stays blocked
    const s = doc.createElement('script')
    s.src = 'https://www.googletagmanager.com/gtm.js?id=GTM-ABC123'
    doc.body.append(s)
    expect(s.getAttribute('type')).toBe('text/plain')
    // without a parsed configuration nothing is reported as unconfigured: a configured service's host would look unconfigured
    await flush()
    expect(sent).not.toHaveBeenCalled()
  })
})

describe('boot never throws into the page', () => {
  test('auto-blocking that cannot be installed is logged once; the client still starts and marked tags stay blocked', () => {
    const win = parsingPage((w) => { w.MutationObserver = function () { throw new Error('no observers here') } as never })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    let c: Consent | null = null
    try {
      expect(() => { c = boot(bundle({ en: toPublicJson(config, 'en'), sk: toPublicJson(config, 'sk') }), win.document) }).not.toThrow()
      expect(error).toHaveBeenCalledTimes(1)
      expect(String(error.mock.calls[0]![0])).toContain('auto-blocking')
    } finally { error.mockRestore() }
    expect(c).not.toBeNull()
    expect(c!.locale).toBe('sk')
    expect(win.document.querySelector('script')!.getAttribute('type')).toBe('text/plain')
    expect(win.document.querySelector('iframe')!.hasAttribute('src')).toBe(false)
  })

  test('runs on a browser without Object.hasOwn and structuredClone (Safari before 15.4)', () => {
    const win = parsingPage()
    const saved = { hasOwn: Object.hasOwn, clone: globalThis.structuredClone }
    delete (Object as unknown as Record<string, unknown>).hasOwn
    delete (globalThis as unknown as Record<string, unknown>).structuredClone
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const c = boot(bundle({ en: toPublicJson(config, 'en'), sk: toPublicJson(config, 'sk') }), win.document)
      expect(error).not.toHaveBeenCalled()
      expect(c).not.toBeNull()
      expect(c!.locale).toBe('sk')
      // reads the stored revisions (the cookie of this test file's page)
      expect(() => c!.isAllowed('youtube')).not.toThrow()
      // auto-blocking looks hosts up too
      const s = win.document.createElement('script')
      s.src = 'https://static.hotjar.com/c/hotjar-1.js'
      expect(s.getAttribute('type')).toBe('text/plain')
    } finally {
      error.mockRestore()
      Object.defineProperty(Object, 'hasOwn', { configurable: true, writable: true, value: saved.hasOwn })
      ;(globalThis as unknown as Record<string, unknown>).structuredClone = saved.clone
    }
  })
})
