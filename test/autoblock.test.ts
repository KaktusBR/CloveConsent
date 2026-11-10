import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { installAutoBlocking, type AutoBlockOptions } from '../src/autoblock'
import { KNOWN_HOSTS } from '../src/known-hosts'
import { defineConsent } from '../src/config'
import { createConsent } from '../src/client'
import { bindMarked } from '../src/marked'
import { youtube } from '../src/catalog'
import type { ClientEntry } from '../src/schema'

const TRACKER = 'https://tracker.example.com/t.js'
const FRAME = 'https://tracker.example.com/frame.html'
const configured: Record<string, string> = { 'tracker.example.com': 'tracker' }
const flush = () => new Promise((r) => setTimeout(r, 0))

let handle: ReturnType<typeof installAutoBlocking> | undefined
let allowed: Set<string>
let blocked: Array<{ id: string; el: Element; configured: boolean }>
const install = (over: Partial<AutoBlockOptions> = {}) => {
  handle = installAutoBlocking(document, {
    serviceForHost: (h) => configured[h] ?? null,
    isAllowed: (id) => allowed.has(id),
    onBlocked: (id, el, c) => { blocked.push({ id, el, configured: c }) },
    ...over,
  })
  return handle
}
const neutralizedScript = (s: Element, id = 'tracker') => {
  expect(s.getAttribute('type')).toBe('text/plain')
  expect(s.getAttribute('data-consent')).toBe(id)
  expect(s.hasAttribute('data-consent-auto')).toBe(true)
}

beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; allowed = new Set(); blocked = [] })
afterEach(() => { handle?.stop(); handle = undefined; vi.restoreAllMocks() })

describe('scripts created through document.createElement', () => {
  test('src set by property: the inserted script is a marked, inert tag that keeps its src', () => {
    install()
    const s = document.createElement('script')
    s.src = TRACKER
    document.head.appendChild(s)
    neutralizedScript(s)
    expect(s.getAttribute('src')).toBe(TRACKER)
    expect(s.src).toBe(TRACKER)
    expect(blocked).toEqual([{ id: 'tracker', el: s, configured: true }])
  })
  test('src set by setAttribute (any case) is caught the same way', () => {
    install()
    const s = document.createElement('script')
    s.setAttribute('SRC', TRACKER)
    document.body.appendChild(s)
    neutralizedScript(s)
    expect(s.getAttribute('src')).toBe(TRACKER)
  })
  test('src set by setAttributeNS without a namespace is caught', () => {
    install()
    const s = document.createElement('script')
    s.setAttributeNS(null, 'src', TRACKER)
    document.body.appendChild(s)
    neutralizedScript(s)
  })
  test('a type set before or after the src is kept in data-type, so activation restores it', () => {
    install()
    const before = document.createElement('script')
    before.type = 'module'
    before.src = TRACKER
    const after = document.createElement('script')
    after.src = TRACKER
    after.type = 'module'
    const attr = document.createElement('script')
    attr.src = TRACKER
    attr.setAttribute('type', 'text/javascript')
    document.body.append(before, after, attr)
    for (const s of [before, after, attr]) neutralizedScript(s)
    expect(before.getAttribute('data-type')).toBe('module')
    expect(after.getAttribute('data-type')).toBe('module')
    expect(after.type).toBe('module')
    expect(attr.getAttribute('data-type')).toBe('text/javascript')
  })
  test('removing the type of a neutralized script does not make it executable', () => {
    install()
    const s = document.createElement('script')
    s.type = 'module'
    s.src = TRACKER
    s.removeAttribute('type')
    document.body.appendChild(s)
    neutralizedScript(s)
    expect(s.hasAttribute('data-type')).toBe(false)
  })
  test('a protocol-relative tracker src is caught', () => {
    install()
    const s = document.createElement('script')
    s.src = '//tracker.example.com/t.js'
    document.body.appendChild(s)
    neutralizedScript(s)
  })
  test('non-tracker hosts, relative URLs and non-http sources are untouched', () => {
    install()
    const els = ['https://cdn.example.org/lib.js', '/local.js', 'data:text/javascript,1', 'blob:https://x/1'].map((src) => {
      const s = document.createElement('script')
      s.src = src
      document.body.appendChild(s)
      return s
    })
    for (const s of els) {
      expect(s.hasAttribute('type')).toBe(false)
      expect(s.hasAttribute('data-consent')).toBe(false)
    }
    expect(blocked).toEqual([])
  })
  test('an allowed service passes through untouched', () => {
    allowed.add('tracker')
    install()
    const s = document.createElement('script')
    s.src = TRACKER
    s.type = 'module'
    document.body.appendChild(s)
    expect(s.getAttribute('type')).toBe('module')
    expect(s.hasAttribute('data-consent')).toBe(false)
    expect(blocked).toEqual([])
  })
  test('other elements and other methods keep their native behaviour', () => {
    install()
    const img = document.createElement('img')
    img.src = TRACKER
    expect(img.getAttribute('src')).toBe(TRACKER)
    expect(Object.hasOwn(img, 'src')).toBe(false)
    const div = document.createElement('div', undefined)
    div.setAttribute('src', TRACKER)
    expect(div.getAttribute('src')).toBe(TRACKER)
    const s = document.createElement('script')
    s.setAttribute('async', '')
    s.text = 'void 0'
    expect(s.getAttribute('async')).toBe('')
    expect(s.text).toBe('void 0')
  })
})

describe('iframes created through document.createElement', () => {
  test('src is held in data-consent-src: the frame has no src and cannot load', () => {
    install()
    const f = document.createElement('iframe')
    f.src = FRAME
    document.body.appendChild(f)
    expect(f.hasAttribute('src')).toBe(false)
    expect(f.getAttribute('data-consent-src')).toBe(FRAME)
    expect(f.getAttribute('data-consent')).toBe('tracker')
    expect(f.hasAttribute('data-consent-auto')).toBe(true)
    // host code reading back what it set is not confused
    expect(f.src).toBe(FRAME)
  })
  test('setAttribute("src") on an iframe is held the same way', () => {
    install()
    const f = document.createElement('iframe')
    f.setAttribute('src', FRAME)
    document.body.appendChild(f)
    expect(f.hasAttribute('src')).toBe(false)
    expect(f.getAttribute('data-consent-src')).toBe(FRAME)
  })
  test('release() lets the iframes of a service through for this page view, but never its scripts', () => {
    const h = install()
    h.release('tracker')
    const f = document.createElement('iframe')
    f.src = FRAME
    const s = document.createElement('script')
    s.src = TRACKER
    document.body.append(f, s)
    expect(f.getAttribute('src')).toBe(FRAME)
    expect(f.hasAttribute('data-consent')).toBe(false)
    neutralizedScript(s)
  })
})

describe('elements inserted as markup', () => {
  test('scripts and iframes inserted by innerHTML and insertAdjacentHTML are neutralized', async () => {
    install()
    const box = document.createElement('div')
    document.body.appendChild(box)
    box.innerHTML = `<p><script src="${TRACKER}" type="module"></script></p><iframe src="${FRAME}"></iframe>`
    box.insertAdjacentHTML('beforeend', `<script src="${TRACKER}"></script>`)
    await flush()
    const [a, b] = Array.from(box.querySelectorAll('script'))
    neutralizedScript(a!)
    expect(a!.getAttribute('data-type')).toBe('module')
    neutralizedScript(b!)
    const f = box.querySelector('iframe')!
    expect(f.hasAttribute('src')).toBe(false)
    expect(f.getAttribute('data-consent-src')).toBe(FRAME)
    expect(blocked).toHaveLength(3)
    expect(new Set(blocked.map((x) => x.el))).toEqual(new Set([a, b, f]))
  })
  test('a tracker iframe in markup is held inside the inserting call, before it could start loading', () => {
    install()
    const box = document.createElement('div')
    document.body.appendChild(box)
    box.innerHTML = `<p>a</p><iframe src="${FRAME}" title="t"></iframe>`
    const f1 = box.querySelector('iframe')!
    expect(f1.hasAttribute('src')).toBe(false)
    expect(f1.getAttribute('data-consent-src')).toBe(FRAME)
    expect(f1.getAttribute('title')).toBe('t')
    expect(box.firstElementChild!.outerHTML).toBe('<p>a</p>')
    box.insertAdjacentHTML('afterbegin', `<iframe src="${FRAME}#2"></iframe>`)
    expect(box.firstElementChild!.getAttribute('data-consent-src')).toBe(`${FRAME}#2`)
    box.insertAdjacentHTML('afterend', `<iframe src="${FRAME}#3"></iframe>`)
    expect(box.nextElementSibling!.getAttribute('data-consent-src')).toBe(`${FRAME}#3`)
    const p = box.querySelector('p')!
    p.outerHTML = `<iframe src="${FRAME}#4"></iframe>`
    expect(box.querySelector(`[data-consent-src="${FRAME}#4"]`)!.hasAttribute('src')).toBe(false)
    expect(document.querySelectorAll('iframe[src]')).toHaveLength(0)
  })
  test('markup without a tracker iframe goes through the native call unchanged', () => {
    install()
    const box = document.createElement('div')
    document.body.appendChild(box)
    box.innerHTML = '<iframe src="https://video.example.org/e"></iframe><table><td>x</td></table>'
    expect(box.innerHTML).toBe('<iframe src="https://video.example.org/e"></iframe><table><tbody><tr><td>x</td></tr></tbody></table>')
    box.insertAdjacentHTML('beforeend', '<b>y</b>')
    expect(box.lastElementChild!.outerHTML).toBe('<b>y</b>')
    const ta = document.createElement('textarea')
    ta.innerHTML = `<iframe src="${FRAME}"></iframe>`
    expect(ta.value).toBe(`<iframe src="${FRAME}"></iframe>`)
    expect(() => box.insertAdjacentHTML('nowhere' as InsertPosition, `<iframe src="${FRAME}"></iframe>`)).toThrow()
  })
  test('marked tags written by the site are left alone', async () => {
    install()
    document.body.innerHTML = `<script type="text/plain" data-consent="tracker" src="${TRACKER}"></script><iframe data-consent="tracker" data-consent-src="${FRAME}"></iframe>`
    await flush()
    expect(document.querySelector('script')!.hasAttribute('data-consent-auto')).toBe(false)
    expect(document.querySelector('iframe')!.hasAttribute('data-consent-auto')).toBe(false)
    expect(blocked).toEqual([])
  })
})

describe('reporting', () => {
  test('a known tracker host the configuration does not have is blocked and reported as unconfigured', () => {
    install()
    const s = document.createElement('script')
    s.src = 'https://connect.facebook.net/en_US/fbevents.js'
    document.body.appendChild(s)
    neutralizedScript(s, 'meta-pixel')
    expect(blocked).toEqual([{ id: 'meta-pixel', el: s, configured: false }])
  })
  test('each element is reported once', async () => {
    install()
    const s = document.createElement('script')
    s.src = TRACKER
    s.src = TRACKER
    document.body.appendChild(s)
    await flush()
    expect(blocked).toHaveLength(1)
  })
})

describe('never throws into host code', () => {
  test('a throwing isAllowed blocks; a throwing onBlocked is swallowed', () => {
    install({ isAllowed: () => { throw new Error('x') }, onBlocked: () => { throw new Error('y') } })
    const s = document.createElement('script')
    expect(() => { s.src = TRACKER }).not.toThrow()
    document.body.appendChild(s)
    neutralizedScript(s)
  })
  test('a throwing serviceForHost still blocks known hosts and leaves the rest native', () => {
    install({ serviceForHost: () => { throw new Error('x') } })
    const s = document.createElement('script')
    const t = document.createElement('script')
    expect(() => { s.src = 'https://www.googletagmanager.com/gtm.js?id=GTM-ABCD'; t.src = TRACKER }).not.toThrow()
    neutralizedScript(s, 'google-tag-manager')
    expect(t.hasAttribute('type')).toBe(false)
  })
  test('invalid URLs and invalid tag names behave natively', () => {
    install()
    const s = document.createElement('script')
    expect(() => { s.src = 'http://[bad' }).not.toThrow()
    expect(s.hasAttribute('type')).toBe(false)
    expect(() => document.createElement('1bad')).toThrow()
  })
})

describe('stop', () => {
  test('restores document.createElement and leaves earlier elements native', () => {
    const native = document.createElement
    install()
    expect(document.createElement).not.toBe(native)
    const s = document.createElement('script')
    handle!.stop()
    handle = undefined
    expect(document.createElement).toBe(native)
    s.src = TRACKER
    document.body.appendChild(s)
    expect(s.hasAttribute('type')).toBe(false)
  })
  test('restores the markup setters of Element.prototype', () => {
    const before = ['innerHTML', 'outerHTML', 'insertAdjacentHTML'].map((k) => Object.getOwnPropertyDescriptor(Element.prototype, k))
    install()
    expect(Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML')).not.toEqual(before[0])
    handle!.stop()
    handle = undefined
    const after = ['innerHTML', 'outerHTML', 'insertAdjacentHTML'].map((k) => Object.getOwnPropertyDescriptor(Element.prototype, k))
    expect(after).toEqual(before)
  })
})

describe('the neutralized format is what bindMarked activates', () => {
  const tracker: ClientEntry = {
    ...youtube(), id: 'tracker', category: 'analytics', gating: { type: 'none' }, origins: ['tracker.example.com'],
    messages: { title: { en: 'Tracker' }, description: { en: 'Tracker' } },
  }
  const config = defineConsent({ locales: ['en'], defaultLocale: 'en', revision: 1, services: [tracker] })
  test('after consent the neutralized script is replaced by a runnable one with its type and src', () => {
    let raw: string | null = null
    const driver = {
      init() {}, readRaw: () => raw, writeData() {}, showBanner() {}, open() {}, acceptAll() {}, rejectAll() {},
      acceptCategories() {}, acceptServices() {},
    }
    const c = createConsent(config, { driver: driver as never })
    c.init()
    install({ isAllowed: (id) => c.acceptedServices().includes(id) })
    const s = document.createElement('script')
    s.type = 'module'
    s.src = TRACKER
    document.head.appendChild(s)
    neutralizedScript(s)
    raw = encodeURIComponent(JSON.stringify({ consentId: 'abc-12345678', categories: ['necessary', 'analytics'], data: { siteRevision: 1, revisions: { tracker: 1 } } }))
    const unbind = bindMarked(c, document)
    const active = document.head.querySelector('script')!
    expect(active).not.toBe(s)
    expect(active.getAttribute('type')).toBe('module')
    expect(active.getAttribute('src')).toBe(TRACKER)
    expect(active.hasAttribute('data-consent')).toBe(false)
    unbind()
  })
})

describe('KNOWN_HOSTS', () => {
  test('lists the host of every shipped catalog entry under its id, as lowercase plain hostnames', () => {
    const expected: Record<string, string> = {
      'www.googletagmanager.com': 'google-tag-manager',
      'connect.facebook.net': 'meta-pixel',
      'www.youtube-nocookie.com': 'youtube',
      'server.arcgisonline.com': 'esri-imagery',
      'tile.openstreetmap.org': 'openstreetmap',
      'challenges.cloudflare.com': 'cloudflare-turnstile',
    }
    for (const [host, id] of Object.entries(expected)) expect(KNOWN_HOSTS[host]).toBe(id)
    for (const host of Object.keys(KNOWN_HOSTS)) expect(host).toMatch(/^[a-z0-9.-]+$/)
    expect(Object.isFrozen(KNOWN_HOSTS)).toBe(true)
  })
})
