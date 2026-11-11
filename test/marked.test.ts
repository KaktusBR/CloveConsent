import { createRequire } from 'node:module'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defineConsent } from '../src/config'
import { createConsent } from '../src/client'
import type { DriverHooks } from '../src/driver'
import { youtube } from '../src/catalog'
import { bindMarked, syncMarked } from '../src/marked'
import { bindDom } from '../src/ui'
import { installAutoBlocking, type AutoBlocking } from '../src/autoblock'
import type { ClientEntry } from '../src/schema'

const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o))
const cookie = (categories: string[]) =>
  enc({ consentId: 'abc-12345678', categories, data: { siteRevision: 1, revisions: { youtube: 1, chat: 1, helper: 1 } } })
function fakeDriver(initial: string | null = null) {
  let raw = initial; let hooks!: DriverHooks
  return {
    init: (_v: unknown, h: DriverHooks) => { hooks = h },
    readRaw: () => raw, writeData() {}, showBanner() {}, open: vi.fn(), acceptAll() {}, rejectAll() {}, acceptCategories: vi.fn(), acceptServices: vi.fn(),
    set(r: string | null) { raw = r }, get hooks() { return hooks },
  }
}
// a widget service: its own script renders into a container; it sets a cookie that cannot always be cleared
const chat: ClientEntry = {
  ...youtube(), id: 'chat', category: 'functional', gating: { type: 'none' }, origins: ['widget.example.com'],
  storage: [{ name: 'stubborn', type: 'cookie', expiry: { en: 'x' }, purpose: { en: 'y' } }],
  messages: { title: { en: 'Chat' }, description: { en: 'Chat widget' } },
}
// a library another service's script uses, accepted in the same category
const helper: ClientEntry = { ...chat, id: 'helper', origins: ['lib.example'], storage: [], messages: { title: { en: 'Helper' }, description: { en: 'Library' } } }
const config = defineConsent({ locales: ['en'], defaultLocale: 'en', revision: 1, services: [youtube(), chat, helper] })
const start = (raw: string | null = null, doc: Document = document) => {
  const d = fakeDriver(raw); const c = createConsent(config, { driver: d as never, doc }); c.init()
  return { d, c }
}
// the test environment's document does not run scripts: a page that does, to see an activated script actually run
// external scripts are served from `files` (a status number makes the load fail); nothing reaches the network
const jsdom = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, o: object) => { window: Window }
  VirtualConsole: new () => object
  requestInterceptor(fn: (req: Request) => Response | undefined): unknown
}
const runnable = (body: string, files: Record<string, string | number> = {}) => {
  const resources = {
    interceptors: [jsdom.requestInterceptor((req) => {
      const f = files[req.url]
      return typeof f === 'string'
        ? new Response(f, { headers: { 'Content-Type': 'application/javascript' } })
        : new Response('', { status: f ?? 404 })
    })],
  }
  const win = new jsdom.JSDOM(`<!DOCTYPE html><html><head></head><body>${body}</body></html>`,
    { runScripts: 'dangerously', resources, url: 'https://site.example/', virtualConsole: new jsdom.VirtualConsole() }).window
  return { doc: win.document, ran: () => (win as unknown as Record<string, unknown>).__marked }
}
let unbind: (() => void) | undefined
/** The "not available on this site" state: its text and the settings link, no button that would allow anything. */
const expectUnavailable = (ph: HTMLElement, size: { width: string; height: string } | null) => {
  expect(ph.hasAttribute('data-consent-unavailable')).toBe(true)
  expect(ph.querySelector('.consent-placeholder__text')!.textContent).toBe('This content is not available on this site.')
  expect(ph.querySelectorAll('[data-consent-action]')).toHaveLength(0)
  expect(ph.querySelector('[data-consent-open]')).not.toBeNull()
  if (size) { expect(ph.style.inlineSize).toBe(size.width); expect(ph.style.blockSize).toBe(size.height) }
  else expect(ph.classList.contains('consent-placeholder--min')).toBe(true)
}
beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = '' })
afterEach(() => { unbind?.(); unbind = undefined; vi.restoreAllMocks() })

describe('marked scripts', () => {
  test('an allowed external script is replaced by a new script with the original attributes and its src', () => {
    document.body.innerHTML = '<script type="text/plain" data-consent="chat" data-type="module" src="https://widget.example.com/w.js" id="w" data-site="42" nonce="n1"></script>'
    const original = document.querySelector('script')!
    const { c } = start(cookie(['necessary', 'functional'])); unbind = bindMarked(c, document)
    const s = document.querySelector('script')!
    expect(s).not.toBe(original)
    expect(original.isConnected).toBe(false)
    expect(s.getAttribute('type')).toBe('module')
    expect(s.getAttribute('src')).toBe('https://widget.example.com/w.js')
    expect(s.id).toBe('w')
    expect(s.getAttribute('data-site')).toBe('42')
    expect(s.hasAttribute('data-consent')).toBe(false)
    expect(s.hasAttribute('data-type')).toBe(false)
  })
  test('without data-type the activated script has no type attribute', () => {
    document.body.innerHTML = '<script type="text/plain" data-consent="chat" src="https://widget.example.com/w.js"></script>'
    const { c } = start(cookie(['necessary', 'functional'])); unbind = bindMarked(c, document)
    const s = document.querySelector('script')!
    expect(s.hasAttribute('type')).toBe(false)
    expect(s.getAttribute('src')).toBe('https://widget.example.com/w.js')
  })
  test('a script stays blocked until its service is allowed', () => {
    const { doc, ran } = runnable('<script type="text/plain" data-consent="chat">window.__marked = (window.__marked || 0) + 1</script>')
    const { d, c } = start(null, doc); unbind = bindMarked(c, doc)
    expect(doc.querySelector('script')!.getAttribute('type')).toBe('text/plain')
    expect(ran()).toBeUndefined()
    d.set(cookie(['necessary', 'functional'])); d.hooks.onFirstConsent()
    expect(ran()).toBe(1)
  })
  test('a src whose host is not in the service origins stays blocked, with a dev warning and no onUnknown', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    document.body.innerHTML = '<script type="text/plain" data-consent="chat" src="https://evil.example.org/x.js"></script>'
    const onUnknown = vi.fn()
    const { c } = start(cookie(['necessary', 'functional'])); unbind = bindMarked(c, document, { onUnknown })
    const s = document.querySelector('script')!
    expect(s.getAttribute('type')).toBe('text/plain')
    expect(s.hasAttribute('data-consent')).toBe(true)
    expect(onUnknown).not.toHaveBeenCalled()
    expect(warn.mock.calls.some((a) => String(a[0]).includes('evil.example.org'))).toBe(true)
  })
  test('a src over plain http is not activated either', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    document.body.innerHTML = '<script type="text/plain" data-consent="chat" src="http://widget.example.com/w.js"></script>'
    const { c } = start(cookie(['necessary', 'functional'])); unbind = bindMarked(c, document)
    expect(document.querySelector('script')!.getAttribute('type')).toBe('text/plain')
  })
  test('an unknown service id stays blocked and is reported through onUnknown (Review Focus 1)', () => {
    const { doc, ran } = runnable('<script type="text/plain" data-consent="nope">window.__marked = 1</script>')
    const onUnknown = vi.fn()
    const { d, c } = start(cookie(['necessary', 'functional', 'media']), doc); unbind = bindMarked(c, doc, { onUnknown })
    const el = doc.querySelector('script')!
    expect(onUnknown).toHaveBeenCalledWith('nope', el)
    d.hooks.onConsent(); syncMarked(c, doc, { onUnknown })
    expect(ran()).toBeUndefined()
    expect(el.isConnected).toBe(true)
    expect(el.getAttribute('type')).toBe('text/plain')
    expect(onUnknown).toHaveBeenCalledTimes(1)
  })
  test('an allowed inline script is activated with its text', () => {
    const { doc, ran } = runnable('<script type="text/plain" data-consent="chat">window.__marked = (window.__marked || 0) + 1</script>')
    const { c } = start(cookie(['necessary', 'functional']), doc); unbind = bindMarked(c, doc)
    const s = doc.querySelector('script')!
    expect(s.text).toBe('window.__marked = (window.__marked || 0) + 1')
    expect(s.hasAttribute('type')).toBe(false)
    expect(ran()).toBe(1)
  })
  test('each script is activated at most once, across syncs, decisions and re-allowing', () => {
    const { doc, ran } = runnable('<script type="text/plain" data-consent="chat">window.__marked = (window.__marked || 0) + 1</script>')
    const { d, c } = start(cookie(['necessary', 'functional']), doc); unbind = bindMarked(c, doc)
    syncMarked(c, doc); syncMarked(c, doc)
    d.hooks.onConsent(); doc.dispatchEvent(new doc.defaultView!.Event('astro:page-load'))
    d.set(cookie(['necessary'])); d.hooks.onChange(['functional'], [])
    d.set(cookie(['necessary', 'functional'])); d.hooks.onChange(['functional'], [])
    expect(ran()).toBe(1)
  })
})

describe('script order', () => {
  const page = '<script type="text/plain" data-consent="helper" src="https://lib.example/lib.js"></script>'
    + '<script type="text/plain" data-consent="chat">window.__marked = window.lib</script>'
  test('an inline script after an external one waits until it has loaded, across services', async () => {
    const { doc, ran } = runnable(page, { 'https://lib.example/lib.js': 'window.lib = "ready"' })
    const { d, c } = start(null, doc); unbind = bindMarked(c, doc)
    d.set(cookie(['necessary', 'functional'])); d.hooks.onFirstConsent()
    // the inline script is still waiting, even through another sync
    syncMarked(c, doc)
    expect(doc.querySelector('script[data-consent="chat"]')!.getAttribute('type')).toBe('text/plain')
    await vi.waitFor(() => expect(ran()).toBe('ready'))
  })
  test('a failed load does not stall the scripts after it', async () => {
    const { doc, ran } = runnable(page, { 'https://lib.example/lib.js': 404 })
    const { c } = start(cookie(['necessary', 'functional']), doc); unbind = bindMarked(c, doc)
    await vi.waitFor(() => expect(doc.querySelector('script[data-consent]')).toBeNull())
    expect(ran()).toBeUndefined()
  })
  test('an external script that throws does not stall the scripts after it', async () => {
    const { doc, ran } = runnable(page.replace('window.lib', '"after"'), { 'https://lib.example/lib.js': 'throw new Error("broken")' })
    const { c } = start(cookie(['necessary', 'functional']), doc); unbind = bindMarked(c, doc)
    await vi.waitFor(() => expect(ran()).toBe('after'))
  })
})

describe('one-time allowance', () => {
  test('"load once" loads the iframe but never a script of the same service', () => {
    const { doc, ran } = runnable('<iframe data-consent="youtube" data-consent-src="https://www.youtube-nocookie.com/embed/abc"></iframe>'
      + '<script type="text/plain" data-consent="youtube">window.__marked = 1</script>')
    const { c } = start(null, doc); unbind = bindMarked(c, doc)
    c.allowOnce('youtube')
    expect(doc.querySelector('iframe')!.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/abc')
    expect(doc.querySelector('script')!.getAttribute('type')).toBe('text/plain')
    expect(ran()).toBeUndefined()
  })
})

describe('marked iframes', () => {
  const frame = '<p>before</p><iframe data-consent="youtube" data-consent-src="https://www.youtube-nocookie.com/embed/abc" width="560" height="315" title="Clip"></iframe><p>after</p>'
  test('a blocked iframe shows the placeholder in its place, at its size, and loads nothing', () => {
    document.body.innerHTML = frame
    const { c } = start(); unbind = bindMarked(c, document)
    expect(document.querySelector('iframe')).toBeNull()
    const ph = document.querySelector<HTMLElement>('[data-consent-placeholder-for="youtube"]')!
    expect(ph.previousElementSibling!.textContent).toBe('before')
    expect(ph.style.inlineSize).toBe('560px')
    expect(ph.style.blockSize).toBe('315px')
  })
  test('once allowed, the iframe is restored in place with src from data-consent-src', () => {
    document.body.innerHTML = frame
    const { d, c } = start(); unbind = bindMarked(c, document)
    d.set(cookie(['necessary', 'media'])); d.hooks.onFirstConsent()
    const f = document.querySelector('iframe')!
    expect(f.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/abc')
    expect(f.getAttribute('title')).toBe('Clip')
    expect(f.previousElementSibling!.textContent).toBe('before')
    expect(document.querySelector('[data-consent-placeholder-for]')).toBeNull()
  })
  test('a data-consent-src outside the service origins keeps the placeholder', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    document.body.innerHTML = '<iframe data-consent="youtube" data-consent-src="https://evil.example.org/x"></iframe>'
    const { c } = start(cookie(['necessary', 'media'])); unbind = bindMarked(c, document)
    expect(document.querySelector('iframe')).toBeNull()
    expect(document.querySelector('[data-consent-placeholder-for="youtube"]')).not.toBeNull()
  })
  // I2: a source that can never load shows the "not available on this site" state: no Allow or Load once that would do nothing
  test.each([['allowed', cookie(['necessary', 'media'])], ['not allowed', null]])(
    'a data-consent-src outside the service origins (%s) shows the unavailable placeholder, at its size', (_name, raw) => {
      vi.spyOn(console, 'warn').mockImplementation(() => {})
      document.body.innerHTML = '<iframe data-consent="youtube" data-consent-src="https://www.youtube.com/embed/abc" width="560" height="315"></iframe>'
      const { c } = start(raw); unbind = bindMarked(c, document)
      expect(document.querySelector('iframe')).toBeNull()
      expectUnavailable(document.querySelector<HTMLElement>('[data-consent-placeholder-for="youtube"]')!, { width: '560px', height: '315px' })
    })
  test('withdrawing turns an activated iframe back into a placeholder without a reload (Review Focus 4)', () => {
    document.body.innerHTML = frame
    const { d, c } = start(cookie(['necessary', 'media'])); unbind = bindMarked(c, document)
    expect(document.querySelector('iframe')).not.toBeNull()
    d.set(cookie(['necessary'])); d.hooks.onChange(['media'], [])
    expect(document.querySelector('iframe')).toBeNull()
    const ph = document.querySelector('[data-consent-placeholder-for="youtube"]')!
    expect(ph.previousElementSibling!.textContent).toBe('before')
    d.set(cookie(['necessary', 'media'])); d.hooks.onChange(['media'], [])
    expect(document.querySelector('iframe')!.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/abc')
  })
  test('an unknown service iframe stays blocked and is reported', () => {
    document.body.innerHTML = '<iframe data-consent="nope" data-consent-src="https://www.youtube-nocookie.com/embed/abc" width="320" height="180"></iframe>'
    const f = document.querySelector('iframe')!
    const onUnknown = vi.fn()
    const { c, d } = start(cookie(['necessary', 'media'])); unbind = bindMarked(c, document, { onUnknown })
    expect(f.hasAttribute('src')).toBe(false)
    expect(onUnknown).toHaveBeenCalledWith('nope', f)
    // never blank space: the "not available" state, sized like the iframe, and it stays through later decisions
    expect(f.isConnected).toBe(false)
    expectUnavailable(document.querySelector<HTMLElement>('[data-consent-placeholder-for="nope"]')!, { width: '320px', height: '180px' })
    d.set(cookie(['necessary'])); d.hooks.onChange(['media'], [])
    expect(document.querySelectorAll('[data-consent-unavailable]')).toHaveLength(1)
    expect(onUnknown).toHaveBeenCalledTimes(1)
  })
})

describe('widget containers', () => {
  test('show the placeholder until allowed, then become empty for the widget script', () => {
    const { doc, ran } = runnable('<div id="box" data-consent-placeholder="chat"></div><script type="text/plain" data-consent="chat">window.__marked = document.getElementById("box").childElementCount</script>')
    const { d, c } = start(null, doc); unbind = bindMarked(c, doc)
    const box = doc.getElementById('box')!
    expect(box.querySelector('[data-consent-placeholder-for="chat"]')).not.toBeNull()
    d.set(cookie(['necessary', 'functional'])); d.hooks.onFirstConsent()
    expect(box.childElementCount).toBe(0)
    // the widget script ran after its container was emptied
    expect(ran()).toBe(0)
  })
  test('withdrawing shows the placeholder again and reports storage that cannot be cleared (Review Focus 4)', () => {
    document.body.innerHTML = '<div id="box" data-consent-placeholder="chat"></div><script type="text/plain" data-consent="chat" src="https://widget.example.com/w.js"></script>'
    const { d, c } = start(cookie(['necessary', 'functional'])); unbind = bindMarked(c, document)
    const box = document.getElementById('box')!
    box.innerHTML = '<p>widget</p>'
    expect(document.querySelector('script[src="https://widget.example.com/w.js"]')).not.toBeNull()
    const jar = vi.spyOn(document, 'cookie', 'get').mockReturnValue('stubborn=1')
    d.set(cookie(['necessary'])); d.hooks.onChange(['functional'], [])
    jar.mockRestore()
    expect(document.querySelector('script[src="https://widget.example.com/w.js"]')).toBeNull()
    expect(c.leftovers.map((l) => l.name)).toEqual(['stubborn'])
    expect(box.querySelector('[data-consent-placeholder-for="chat"]')).not.toBeNull()
    expect(box.textContent).not.toContain('widget')
  })
})

test('a widget container naming an unknown service shows the unavailable placeholder', () => {
  document.body.innerHTML = '<div id="box" data-consent-placeholder="nope"><p>old</p></div>'
  const { c } = start(); unbind = bindMarked(c, document, { onUnknown: () => {} })
  const box = document.getElementById('box')!
  expectUnavailable(box.querySelector<HTMLElement>('[data-consent-placeholder-for="nope"]')!, null)
  expect(box.children).toHaveLength(1)
  syncMarked(c, document, { onUnknown: () => {} })
  expect(box.querySelectorAll('[data-consent-unavailable]')).toHaveLength(1)
})

describe('placeholder buttons', () => {
  const page = '<iframe data-consent="youtube" data-consent-src="https://www.youtube-nocookie.com/embed/abc"></iframe><div data-consent-placeholder="chat"></div>'
  test('"load once" allows only that element\'s service for this page view', () => {
    document.body.innerHTML = page
    const { d, c } = start(); unbind = bindMarked(c, document)
    document.querySelector<HTMLElement>('[data-consent-placeholder-for="youtube"] [data-consent-action="once"]')!.click()
    expect(document.querySelector('iframe')!.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/abc')
    expect(c.isAllowed('chat')).toBe(false)
    expect(document.querySelector('[data-consent-placeholder-for="chat"]')).not.toBeNull()
    expect(d.acceptServices).not.toHaveBeenCalled()
  })
  test('"allow" accepts that element\'s service', () => {
    document.body.innerHTML = page
    const { d, c } = start(); unbind = bindMarked(c, document)
    document.querySelector<HTMLElement>('[data-consent-placeholder-for="chat"] [data-consent-action="accept"]')!.click()
    expect(d.acceptServices).toHaveBeenCalledWith({ functional: ['chat'], media: [] })
  })
  test('the settings link opens the preferences', () => {
    document.body.innerHTML = page
    const { d, c } = start(); unbind = bindMarked(c, document)
    document.querySelector<HTMLElement>('[data-consent-placeholder-for="chat"] [data-consent-open]')!.click()
    expect(d.open).toHaveBeenCalledTimes(1)
  })
  test('a click is handled once when both bindDom and bindMarked are bound', () => {
    document.body.innerHTML = page
    const { d, c } = start(); bindDom(c, document); unbind = bindMarked(c, document)
    document.querySelector<HTMLElement>('[data-consent-placeholder-for="chat"] [data-consent-action="accept"]')!.click()
    document.querySelector<HTMLElement>('[data-consent-placeholder-for="chat"] [data-consent-open]')!.click()
    expect(d.acceptServices).toHaveBeenCalledTimes(1)
    expect(d.open).toHaveBeenCalledTimes(1)
  })
})

describe('with auto-blocking installed', () => {
  let blocking: AutoBlocking | undefined
  // stopped after each test: auto-blocking patches this window's document factories and markup setters
  afterEach(() => { blocking?.stop(); blocking = undefined })
  const setup = () => {
    const { d, c } = start()
    const b = (blocking = installAutoBlocking(document, {
      serviceForHost: (host) => config.services.find((s) => s.kind === 'client' && s.origins.includes(host))?.id ?? null,
      isAllowed: (id) => c.acceptedServices().includes(id),
    }))
    // registered before bindMarked, so the iframe's src passes when marked-tag activation sets it
    c.on('once', (id) => b.release(id))
    // a marked iframe the site builds by code: its setAttribute goes through auto-blocking
    const f = document.createElement('iframe')
    f.setAttribute('data-consent', 'youtube')
    f.setAttribute('data-consent-src', 'https://www.youtube-nocookie.com/embed/abc')
    document.body.append(f)
    unbind = bindMarked(c, document)
    return { d, c, f }
  }

  test('a code-built marked iframe is activated after consent', () => {
    const { d, f } = setup()
    expect(f.isConnected).toBe(false)
    expect(document.querySelector('[data-consent-placeholder-for="youtube"]')).not.toBeNull()
    d.set(enc({ consentId: 'abc-12345678', categories: ['necessary', 'media'], data: { siteRevision: 1, revisions: { youtube: 1 } } }))
    d.hooks.onFirstConsent()
    expect(f.isConnected).toBe(true)
    expect(f.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/abc')
  })
  test('a code-built marked iframe loads through "load once"', () => {
    const { f } = setup()
    document.querySelector<HTMLElement>('[data-consent-placeholder-for="youtube"] [data-consent-action="once"]')!.click()
    expect(f.isConnected).toBe(true)
    expect(f.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/abc')
    expect(f.hasAttribute('data-consent-auto')).toBe(false)
  })
})

describe('unbinding', () => {
  test('stops reacting to decisions', () => {
    const { doc, ran } = runnable('<script type="text/plain" data-consent="chat">window.__marked = 1</script>')
    const { d, c } = start(null, doc); bindMarked(c, doc)()
    d.set(cookie(['necessary', 'functional'])); d.hooks.onFirstConsent()
    expect(ran()).toBeUndefined()
    expect(doc.querySelector('script')!.getAttribute('type')).toBe('text/plain')
  })
})
