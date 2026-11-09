import { beforeEach, describe, expect, test, vi } from 'vitest'
import { youtube, theme } from '../src/catalog'
import { clearStorage, createEmbed, hostAllowed, loadScript, runScriptInit, unloadService } from '../src/gating'
import type { ClientEntry, ScriptInit } from '../src/schema'

const yt = youtube()
const win = window as any
beforeEach(() => {
  document.head.innerHTML = ''; document.body.innerHTML = ''; localStorage.clear(); sessionStorage.clear()
  for (const k of Object.keys(win)) if (k.startsWith('ga-disable-')) delete win[k]
  for (const k of ['dataLayer', 'gtag', 'fbq', '_fbq']) delete win[k]
})

describe('hostAllowed (review focus 3)', () => {
  test('allows exact host over https', () => expect(hostAllowed(yt, 'https://www.youtube-nocookie.com/embed/abc')).toBe(true))
  test.each([
    'https://www.youtube-nocookie.com.evil.com/embed/abc',
    'https://www.youtube-nocookie.com@evil.com/',
    'https://evil.com/www.youtube-nocookie.com',
    'http://www.youtube-nocookie.com/embed/abc',
    'https://youtube-nocookie.com/embed/abc',
    'javascript:alert(1)', 'data:text/html,x', 'not a url', '',
  ])('rejects %s', (u) => expect(hostAllowed(yt, u)).toBe(false))
})

describe('createEmbed', () => {
  test('builds a locked-down iframe', () => {
    const f = createEmbed(document, yt, 'https://www.youtube-nocookie.com/embed/abc', 'Video')
    expect(f.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/abc')
    expect(f.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin')
    expect(f.getAttribute('loading')).toBe('lazy')
    expect(f.getAttribute('sandbox')).toContain('allow-scripts')
    expect(f.getAttribute('title')).toBe('Video')
  })
  test('throws for a disallowed origin', () => {
    expect(() => createEmbed(document, yt, 'https://evil.com/x', 'v')).toThrow(/not allowed/)
  })
  test('throws for an entry that is not an iframe entry', () => {
    const noIframe: ClientEntry = { ...yt, gating: { type: 'none' } }
    expect(() => createEmbed(document, noIframe, 'https://www.youtube-nocookie.com/embed/a', 'v')).toThrow()
  })
})

describe('loadScript', () => {
  const script: ClientEntry = { ...yt, id: 'plausible', origins: ['plausible.io'], gating: { type: 'script', src: 'https://plausible.io/js/s.js' } }
  test('adds one async script and is idempotent', () => {
    loadScript(document, script); loadScript(document, script)
    const found = document.querySelectorAll('script[data-consent-service="plausible"]')
    expect(found.length).toBe(1)
    expect(found[0]!.getAttribute('async')).not.toBeNull()
    expect(found[0]!.getAttribute('src')).toBe('https://plausible.io/js/s.js')
  })
  test('refuses when the src host is not in origins', () => {
    const bad: ClientEntry = { ...script, gating: { type: 'script', src: 'https://evil.com/a.js' } }
    expect(() => loadScript(document, bad)).toThrow(/not allowed/)
  })
  test('returns null for non-script entries', () => expect(loadScript(document, yt)).toBeNull())
})

describe('clearStorage / unloadService (review focus 5)', () => {
  test('removes local and session storage items', () => {
    localStorage.setItem('theme', 'dark')
    expect(clearStorage(document, theme())).toEqual([])
    expect(localStorage.getItem('theme')).toBeNull()
  })
  test('expires a cookie and reports nothing remaining', () => {
    document.cookie = '_ga=1; Path=/'
    const e: ClientEntry = { ...yt, storage: [{ name: '_ga', type: 'cookie', expiry: yt.messages.title, purpose: yt.messages.title }] }
    expect(clearStorage(document, e)).toEqual([])
    expect(document.cookie).not.toContain('_ga=')
  })
  test('reports items it could not remove', () => {
    const e: ClientEntry = { ...yt, storage: [{ name: 'stubborn', type: 'cookie', expiry: yt.messages.title, purpose: yt.messages.title }] }
    const realCookie = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!
    Object.defineProperty(document, 'cookie', { configurable: true, get: () => 'stubborn=1', set: () => {} })
    const left = clearStorage(document, e)
    Object.defineProperty(document, 'cookie', realCookie as PropertyDescriptor)
    delete (document as any).cookie
    expect(left.map((s) => s.name)).toEqual(['stubborn'])
  })
  test('unloadService removes its script and clears storage', () => {
    const script: ClientEntry = { ...yt, id: 'plausible', origins: ['plausible.io'], gating: { type: 'script', src: 'https://plausible.io/js/s.js' } }
    loadScript(document, script)
    unloadService(document, script)
    expect(document.querySelector('script[data-consent-service="plausible"]')).toBeNull()
  })
  test('skips storage names that are not safe tokens and never writes them', () => {
    const set = vi.spyOn(document, 'cookie', 'set')
    const e: ClientEntry = { ...yt, storage: [{ name: 'a;Domain=x', type: 'cookie', expiry: yt.messages.title, purpose: yt.messages.title }] }
    clearStorage(document, e)
    expect(set).not.toHaveBeenCalled()
    set.mockRestore()
  })
  test('http deletion strings do not include Secure', () => {
    const set = vi.spyOn(document, 'cookie', 'set')
    const e: ClientEntry = { ...yt, storage: [{ name: '_ga', type: 'cookie', expiry: yt.messages.title, purpose: yt.messages.title }] }
    clearStorage(document, e)
    expect(set.mock.calls.length).toBeGreaterThan(0)
    expect(set.mock.calls.every(([v]) => !String(v).includes('; Secure'))).toBe(true)
    set.mockRestore()
  })
  test('an id containing a selector-breaking sequence does not throw', () => {
    const weird: ClientEntry = { ...yt, id: 'x"] , [y', gating: { type: 'script', src: 'https://www.youtube-nocookie.com/a.js' } }
    expect(() => loadScript(document, weird)).not.toThrow()
    expect(() => unloadService(document, weird)).not.toThrow()
    expect(document.querySelectorAll('script').length).toBe(0)
  })
})

describe('runScriptInit', () => {
  test('gtag creates dataLayer and a gtag that pushes the arguments object', () => {
    runScriptInit(window, { kind: 'gtag', id: 'G-ABCD1234' })
    expect(Array.isArray(win.dataLayer)).toBe(true)
    expect(typeof win.gtag).toBe('function')
    const [first, second] = win.dataLayer
    expect(Object.prototype.toString.call(first)).toBe('[object Arguments]')
    expect(Array.from(first)).toEqual(['js', expect.any(Date)])
    expect(Object.prototype.toString.call(second)).toBe('[object Arguments]')
    expect(Array.from(second)).toEqual(['config', 'G-ABCD1234'])
    expect(win['ga-disable-G-ABCD1234']).toBe(false)
    win.gtag('event', 'x')
    expect(Object.prototype.toString.call(win.dataLayer[2])).toBe('[object Arguments]')
    expect(document.querySelectorAll('script:not([src])').length).toBe(0)
  })
  test('gtag keeps an existing dataLayer', () => {
    win.dataLayer = [{ before: true }]
    runScriptInit(window, { kind: 'gtag', id: 'G-ABCD1234' })
    expect(win.dataLayer[0]).toEqual({ before: true })
    expect(win.dataLayer.length).toBe(3)
  })
  test('gtm starts the container', () => {
    runScriptInit(window, { kind: 'gtm' })
    expect(win.dataLayer).toHaveLength(1)
    expect(win.dataLayer[0]).toEqual({ 'gtm.start': expect.any(Number), event: 'gtm.js' })
    expect(document.querySelectorAll('script:not([src])').length).toBe(0)
  })
  test('fbq is a queueing stub holding init then PageView', () => {
    runScriptInit(window, { kind: 'fbq', id: '123456789012345' })
    expect(typeof win.fbq).toBe('function')
    expect(win.fbq.loaded).toBe(true)
    expect(win.fbq.queue.map((a: unknown) => Array.from(a as ArrayLike<unknown>))).toEqual([['init', '123456789012345'], ['track', 'PageView']])
    expect(win._fbq).toBe(win.fbq)
    win.fbq('track', 'Lead')
    expect(win.fbq.queue).toHaveLength(3)
    expect(document.querySelectorAll('script:not([src])').length).toBe(0)
  })
  test('fbq hands calls to the real implementation once it sets callMethod', () => {
    runScriptInit(window, { kind: 'fbq', id: '12345' })
    const calls: unknown[][] = []
    win.fbq.callMethod = (...a: unknown[]) => { calls.push(a) }
    win.fbq('track', 'Lead')
    expect(calls).toEqual([['track', 'Lead']])
  })
  test('fbq does not replace an existing fbq', () => {
    const real = () => {}
    win.fbq = real
    runScriptInit(window, { kind: 'fbq', id: '12345' })
    expect(win.fbq).toBe(real)
  })
})

describe('script setup in loadScript and unloadService', () => {
  // The setup state is remembered per window for the whole file, so each test uses its own gtag id.
  const gaWith = (gid: string): ClientEntry => ({
    ...yt, id: 'ga', origins: ['www.googletagmanager.com'],
    gating: { type: 'script', src: `https://www.googletagmanager.com/gtag/js?id=${gid}`, init: { kind: 'gtag', id: gid } },
  })
  test('runs the setup once, before the script is added, and not again on a second call', () => {
    const ga = gaWith('G-ONCE0001')
    let atInsert: number | undefined
    const real = document.head.appendChild.bind(document.head)
    const spy = vi.spyOn(document.head, 'appendChild').mockImplementation(((n: Node) => { atInsert = win.dataLayer?.length; return real(n) }) as never)
    const first = loadScript(document, ga)
    spy.mockRestore()
    expect(atInsert).toBe(2)
    expect(win.dataLayer).toHaveLength(2)
    const second = loadScript(document, ga)
    expect(second).toBe(first)
    expect(win.dataLayer).toHaveLength(2)
    expect(document.querySelectorAll('script[data-consent-service="ga"]').length).toBe(1)
    expect(document.querySelectorAll('script:not([src])').length).toBe(0)
  })
  test('does not run the setup when the origin is refused', () => {
    const bad: ClientEntry = { ...gaWith('G-REFUSED1'), gating: { type: 'script', src: 'https://evil.com/a.js', init: { kind: 'gtag', id: 'G-REFUSED1' } } }
    expect(() => loadScript(document, bad)).toThrow(/not allowed/)
    expect(win.dataLayer).toBeUndefined()
  })
  test('unloadService for gtag sets the ga-disable switch', () => {
    const ga = gaWith('G-UNLOAD01')
    loadScript(document, ga)
    expect(win['ga-disable-G-UNLOAD01']).toBe(false)
    expect(document.querySelectorAll('script:not([src])').length).toBe(0)
    unloadService(document, ga)
    expect(win['ga-disable-G-UNLOAD01']).toBe(true)
    expect(document.querySelector('script[data-consent-service="ga"]')).toBeNull()
    expect(document.querySelectorAll('script:not([src])').length).toBe(0)
  })
  test('unloadService for a non-gtag entry sets nothing', () => {
    const gtm: ClientEntry = { ...gaWith('G-UNUSED01'), gating: { type: 'script', src: 'https://www.googletagmanager.com/gtm.js?id=GTM-X', init: { kind: 'gtm' } } }
    unloadService(document, gtm)
    expect(Object.keys(win).filter((k) => k.startsWith('ga-disable'))).toEqual([])
  })
})

describe('re-allowing a service after unloadService', () => {
  // The setup state is remembered per window for the whole file, so every test uses its own ids.
  const noInline = (d: Document = document) => expect(d.querySelectorAll('script:not([src])').length).toBe(0)
  const entry = (id: string, src: string, origin: string, init: ScriptInit): ClientEntry =>
    ({ ...yt, id, origins: [origin], gating: { type: 'script', src, init } })

  test('gtag: the second load does not repeat js/config; the opt-out switch follows load and unload', () => {
    const e = entry('ga-r', 'https://www.googletagmanager.com/gtag/js?id=G-REALLOW1', 'www.googletagmanager.com', { kind: 'gtag', id: 'G-REALLOW1' })
    loadScript(document, e)
    noInline()
    expect(win.dataLayer).toHaveLength(2)
    expect(win['ga-disable-G-REALLOW1']).toBe(false)
    unloadService(document, e)
    expect(win['ga-disable-G-REALLOW1']).toBe(true)
    expect(document.querySelector('script[data-consent-service="ga-r"]')).toBeNull()
    const again = loadScript(document, e)
    expect(again).not.toBeNull()
    expect(document.querySelectorAll('script[data-consent-service="ga-r"]').length).toBe(1)
    expect(win.dataLayer).toHaveLength(2)
    expect(win['ga-disable-G-REALLOW1']).toBe(false)
    noInline()
  })
  test('gtm: the second load does not push a second gtm.start', () => {
    const e = entry('gtm-r', 'https://www.googletagmanager.com/gtm.js?id=GTM-REALLOW', 'www.googletagmanager.com', { kind: 'gtm' })
    loadScript(document, e)
    noInline()
    unloadService(document, e)
    loadScript(document, e)
    expect(document.querySelectorAll('script[data-consent-service="gtm-r"]').length).toBe(1)
    expect(win.dataLayer).toHaveLength(1)
    expect(win.dataLayer[0]).toEqual({ 'gtm.start': expect.any(Number), event: 'gtm.js' })
    noInline()
  })
  test('fbq: the second load does not queue init and PageView again', () => {
    const e = entry('fb-r', 'https://connect.facebook.net/en_US/fbevents.js', 'connect.facebook.net', { kind: 'fbq', id: '987654321' })
    loadScript(document, e)
    noInline()
    unloadService(document, e)
    loadScript(document, e)
    expect(document.querySelectorAll('script[data-consent-service="fb-r"]').length).toBe(1)
    expect(win.fbq.queue.map((a: unknown) => Array.from(a as ArrayLike<unknown>))).toEqual([['init', '987654321'], ['track', 'PageView']])
    noInline()
  })
  test('a different window still gets its own setup', () => {
    const e = entry('ga-w', 'https://www.googletagmanager.com/gtag/js?id=G-WINDOW01', 'www.googletagmanager.com', { kind: 'gtag', id: 'G-WINDOW01' })
    const frame = document.createElement('iframe')
    document.body.appendChild(frame)
    const other = frame.contentWindow as any
    const otherDoc = frame.contentDocument!
    loadScript(document, e)
    loadScript(otherDoc, e)
    expect(win.dataLayer).toHaveLength(2)
    expect(other.dataLayer).toHaveLength(2)
    expect(other['ga-disable-G-WINDOW01']).toBe(false)
    noInline(); noInline(otherDoc)
  })
  test('runScriptInit alone creates no inline script', () => {
    runScriptInit(window, { kind: 'gtag', id: 'G-ABCD1234' })
    runScriptInit(window, { kind: 'gtm' })
    runScriptInit(window, { kind: 'fbq', id: '12345' })
    expect(document.querySelectorAll('script:not([src])').length).toBe(0)
  })
})
