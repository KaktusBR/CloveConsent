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

describe('marked tags and non-JavaScript scripts built by code', () => {
  test('a marked script the site builds itself keeps its marking and is not reported', () => {
    install()
    const s = document.createElement('script')
    s.type = 'text/plain'
    s.dataset.consent = 'chat'
    s.src = TRACKER
    const t = document.createElement('script')
    t.setAttribute('data-consent', 'chat')
    t.setAttribute('type', 'text/plain')
    t.setAttribute('src', TRACKER)
    document.body.append(s, t)
    for (const el of [s, t]) {
      expect(el.getAttribute('type')).toBe('text/plain')
      expect(el.getAttribute('data-consent')).toBe('chat')
      expect(el.hasAttribute('data-type')).toBe(false)
      expect(el.hasAttribute('data-consent-auto')).toBe(false)
      expect(el.getAttribute('src')).toBe(TRACKER)
    }
    expect(blocked).toEqual([])
  })
  test('data-consent alone grants nothing: a script of a JavaScript type with a tracker src is blocked', () => {
    install()
    const s = document.createElement('script')
    s.dataset.consent = 'x'
    s.src = TRACKER
    document.head.appendChild(s)
    neutralizedScript(s)
    expect(blocked).toEqual([{ id: 'tracker', el: s, configured: true }])
  })
  test('a marked script switched to a JavaScript type before insertion is blocked', () => {
    install()
    const byProp = document.createElement('script')
    byProp.type = 'text/plain'
    byProp.dataset.consent = 'x'
    byProp.src = TRACKER
    byProp.type = 'text/javascript'
    const byRemoval = document.createElement('script')
    byRemoval.setAttribute('type', 'text/plain')
    byRemoval.setAttribute('data-consent', 'x')
    byRemoval.setAttribute('src', TRACKER)
    byRemoval.removeAttribute('type')
    document.head.append(byProp, byRemoval)
    neutralizedScript(byProp)
    expect(byProp.getAttribute('data-type')).toBe('text/javascript')
    neutralizedScript(byRemoval)
  })
  test('an iframe with data-consent and a tracker src of its own is blocked', () => {
    install()
    const byProp = document.createElement('iframe')
    byProp.dataset.consent = 'x'
    byProp.src = FRAME
    const byAttr = document.createElement('iframe')
    byAttr.setAttribute('data-consent', 'x')
    byAttr.setAttribute('src', FRAME)
    document.body.append(byProp, byAttr)
    for (const f of [byProp, byAttr]) {
      expect(f.hasAttribute('src')).toBe(false)
      expect(f.getAttribute('data-consent-src')).toBe(FRAME)
      expect(f.getAttribute('data-consent')).toBe('tracker')
    }
  })
  test('markup: data-consent on a runnable script or on an iframe with a src does not escape', async () => {
    install()
    const box = document.createElement('div')
    document.body.appendChild(box)
    box.innerHTML = `<iframe data-consent="x" src="${FRAME}"></iframe>`
    expect(box.querySelector('iframe')!.hasAttribute('src')).toBe(false)
    box.insertAdjacentHTML('beforeend', `<script data-consent="x" src="${TRACKER}"></script><script data-consent="x" type="module" src="${TRACKER}"></script>`)
    await flush()
    const [a, b] = Array.from(box.querySelectorAll('script'))
    neutralizedScript(a!)
    neutralizedScript(b!)
    expect(b!.getAttribute('data-type')).toBe('module')
  })
  test('a marked iframe the site builds itself is left as written', () => {
    install()
    const f = document.createElement('iframe')
    f.setAttribute('data-consent', 'chat')
    f.setAttribute('data-consent-src', FRAME)
    document.body.appendChild(f)
    expect(f.getAttribute('data-consent')).toBe('chat')
    expect(f.hasAttribute('data-consent-auto')).toBe(false)
    expect(blocked).toEqual([])
  })
  test('a script of a non-JavaScript type is data and left alone, until its type makes it runnable', () => {
    install()
    const json = document.createElement('script')
    json.type = 'application/ld+json'
    json.src = TRACKER
    document.body.appendChild(json)
    expect(json.getAttribute('type')).toBe('application/ld+json')
    expect(json.hasAttribute('data-consent')).toBe(false)
    const byProp = document.createElement('script')
    byProp.type = 'text/x-template'
    byProp.src = TRACKER
    byProp.type = 'text/javascript'
    const byAttr = document.createElement('script')
    byAttr.setAttribute('type', 'text/x-template')
    byAttr.setAttribute('src', TRACKER)
    byAttr.setAttribute('type', 'module')
    const byRemoval = document.createElement('script')
    byRemoval.type = 'text/x-template'
    byRemoval.src = TRACKER
    byRemoval.removeAttribute('type')
    document.body.append(byProp, byAttr, byRemoval)
    neutralizedScript(byProp)
    expect(byProp.getAttribute('data-type')).toBe('text/javascript')
    neutralizedScript(byAttr)
    expect(byAttr.getAttribute('data-type')).toBe('module')
    neutralizedScript(byRemoval)
    expect(byRemoval.hasAttribute('data-type')).toBe(false)
  })
  test('JavaScript types with parameters or odd case are still scripts', () => {
    install()
    const s = document.createElement('script')
    s.type = ' Text/JavaScript; charset=utf-8'
    s.src = TRACKER
    document.body.appendChild(s)
    neutralizedScript(s)
  })
  test('markup: a marked or non-JavaScript script is not touched by the observer', async () => {
    install()
    document.body.innerHTML = `<script type="application/ld+json" src="${TRACKER}"></script>`
    await flush()
    expect(document.querySelector('script')!.getAttribute('type')).toBe('application/ld+json')
    expect(blocked).toEqual([])
  })
})

describe('known hosts the configuration does not cover', () => {
  test('stay blocked even when a configured service with the same id is allowed or released', () => {
    allowed.add('youtube').add('meta-pixel')
    const h = install()
    h.release('youtube')
    const f = document.createElement('iframe')
    f.src = 'https://www.youtube.com/embed/x'
    const s = document.createElement('script')
    s.src = 'https://connect.facebook.net/en_US/fbevents.js'
    document.body.append(f, s)
    expect(f.hasAttribute('src')).toBe(false)
    expect(f.getAttribute('data-consent')).toBe('youtube')
    neutralizedScript(s, 'meta-pixel')
    expect(blocked.map((b) => [b.id, b.configured])).toEqual([['youtube', false], ['meta-pixel', false]])
  })
  test('markup with such an iframe is held too', () => {
    allowed.add('youtube')
    install()
    document.body.innerHTML = '<iframe src="https://www.youtube.com/embed/x"></iframe>'
    expect(document.querySelector('iframe')!.hasAttribute('src')).toBe(false)
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

// I1: a lazy loader sets the source later on an element it did not build with document.createElement
describe('a source set later on an element from the HTML or from markup', () => {
  const fromMarkup = <T extends Element>(html: string): T => {
    const box = document.createElement('div')
    document.body.appendChild(box)
    box.innerHTML = html
    return box.firstElementChild as T
  }
  test('an iframe: src by property, by setAttribute (any case) and by setAttributeNS is held before it can load', () => {
    install()
    const byProp = fromMarkup<HTMLIFrameElement>('<iframe width="320" height="180"></iframe>')
    const byAttr = fromMarkup<HTMLIFrameElement>('<iframe></iframe>')
    const byNS = fromMarkup<HTMLIFrameElement>('<iframe></iframe>')
    byProp.src = FRAME
    byAttr.setAttribute('SRC', FRAME)
    byNS.setAttributeNS(null, 'src', FRAME)
    for (const f of [byProp, byAttr, byNS]) {
      expect(f.hasAttribute('src')).toBe(false)
      expect(f.getAttribute('data-consent-src')).toBe(FRAME)
      expect(f.getAttribute('data-consent')).toBe('tracker')
      expect(f.hasAttribute('data-consent-auto')).toBe(true)
    }
    expect(byProp.src).toBe(FRAME)
    expect(blocked.map((b) => b.el)).toEqual([byProp, byAttr, byNS])
  })
  test('an iframe the parser created (in the page before installing) is held the same way', () => {
    document.body.innerHTML = '<iframe id="lazy"></iframe>'
    install()
    const f = document.getElementById('lazy') as HTMLIFrameElement
    f.src = FRAME
    expect(f.hasAttribute('src')).toBe(false)
    f.setAttribute('src', `${FRAME}#2`)
    expect(f.hasAttribute('src')).toBe(false)
    expect(f.getAttribute('data-consent-src')).toBe(`${FRAME}#2`)
  })
  test('a script from markup that gets a tracker src later is neutralized; its type is routed as for built ones', () => {
    install()
    const s = fromMarkup<HTMLScriptElement>('<script></script>')
    s.src = TRACKER
    neutralizedScript(s)
    s.type = 'module'
    expect(s.getAttribute('type')).toBe('text/plain')
    expect(s.getAttribute('data-type')).toBe('module')
    const t = fromMarkup<HTMLScriptElement>('<script type="text/x-template"></script>')
    t.setAttribute('src', TRACKER)
    expect(t.getAttribute('type')).toBe('text/x-template')
    t.removeAttribute('type')
    neutralizedScript(t)
  })
  test('an element of another document of this window is held too (moved into the page later)', () => {
    install()
    const other = document.implementation.createHTMLDocument('')
    const s = other.createElement('script')
    s.src = TRACKER
    const f = other.createElement('iframe')
    f.setAttribute('src', FRAME)
    neutralizedScript(s)
    expect(f.hasAttribute('src')).toBe(false)
  })
  test('allowed, non-tracker and marked elements keep their native behaviour', () => {
    allowed.add('tracker')
    install()
    const ok = fromMarkup<HTMLIFrameElement>('<iframe></iframe>')
    ok.src = FRAME
    expect(ok.getAttribute('src')).toBe(FRAME)
    const other = fromMarkup<HTMLIFrameElement>('<iframe></iframe>')
    other.setAttribute('src', 'https://video.example.org/e')
    expect(other.getAttribute('src')).toBe('https://video.example.org/e')
    const marked = fromMarkup<HTMLScriptElement>('<script type="text/plain" data-consent="chat"></script>')
    marked.src = 'https://connect.facebook.net/en_US/fbevents.js'
    expect(marked.hasAttribute('data-consent-auto')).toBe(false)
    expect(Object.hasOwn(ok, 'src')).toBe(false)
    expect(blocked).toEqual([])
  })
  test('a src set through a path no setter covers (an attribute node) is caught by the observer: held and reported', async () => {
    install()
    const f = fromMarkup<HTMLIFrameElement>('<iframe></iframe>')
    // the insertion has been observed: only the attribute change is left to see
    await flush()
    const a = document.createAttribute('src')
    a.value = FRAME
    f.setAttributeNode(a)
    await flush()
    expect(f.hasAttribute('src')).toBe(false)
    expect(f.getAttribute('data-consent-src')).toBe(FRAME)
    expect(blocked.map((b) => b.el)).toEqual([f])
  })
  test('the patched members behave natively for wrong receivers and arguments', () => {
    const outcome = (fn: () => unknown) => { try { fn(); return 'ok' } catch (e) { return (e as Error).name } }
    const calls = () => [
      outcome(() => Element.prototype.setAttribute.call({} as Element, 'src', TRACKER)),
      outcome(() => Element.prototype.setAttribute.call(null as unknown as Element, 'src', TRACKER)),
      outcome(() => (Element.prototype.setAttributeNS as (...a: unknown[]) => void).call(document.createElement('iframe'), null, 'src')),
      outcome(() => (document.createElement('iframe').setAttribute as (...a: unknown[]) => void)('src')),
      outcome(() => (Element.prototype.removeAttribute as (...a: unknown[]) => void).call(document.createElement('script'))),
      outcome(() => document.createElement('iframe').setAttribute('1 bad', 'x')),
      outcome(() => Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'src')!.set!.call({}, FRAME)),
      outcome(() => Object.getOwnPropertyDescriptor(HTMLScriptElement.prototype, 'type')!.get!.call({})),
    ]
    const native = calls()
    install()
    expect(calls()).toEqual(native)
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
  test('a missing src or type descriptor skips that patch only: installing does not throw and setAttribute still blocks', async () => {
    const protos = [HTMLScriptElement.prototype, HTMLIFrameElement.prototype] as object[]
    const saved = protos.map((p) => [Object.getOwnPropertyDescriptor(p, 'src')!, Object.getOwnPropertyDescriptor(p, 'type')] as const)
    protos.forEach((p) => { delete (p as Record<string, unknown>).src; delete (p as Record<string, unknown>).type })
    try {
      expect(() => install()).not.toThrow()
      const s = document.createElement('script')
      s.setAttribute('src', TRACKER)
      document.body.appendChild(s)
      neutralizedScript(s)
      // the properties behave as the page has them (plain properties here), never throwing
      expect(() => { void s.src; void s.type; s.type = 'module' }).not.toThrow()
      const f = document.createElement('iframe')
      f.setAttribute('src', FRAME)
      expect(f.hasAttribute('src')).toBe(false)
      document.body.insertAdjacentHTML('beforeend', `<script src="${TRACKER}"></script>`)
      await flush()
      neutralizedScript(document.body.lastElementChild!)
    } finally {
      handle?.stop(); handle = undefined
      protos.forEach((p, i) => {
        Object.defineProperty(p, 'src', saved[i]![0])
        if (saved[i]![1]) Object.defineProperty(p, 'type', saved[i]![1])
      })
    }
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
  test('restores the src, type and attribute members it patched and leaves earlier elements native', () => {
    const members = [
      [HTMLScriptElement.prototype, 'src'], [HTMLScriptElement.prototype, 'type'], [HTMLIFrameElement.prototype, 'src'],
      [Element.prototype, 'setAttribute'], [Element.prototype, 'setAttributeNS'], [Element.prototype, 'removeAttribute'],
    ] as const
    const before = members.map(([p, k]) => Object.getOwnPropertyDescriptor(p, k))
    const native = document.createElement
    install()
    members.forEach(([p, k], i) => expect(Object.getOwnPropertyDescriptor(p, k), k).not.toEqual(before[i]))
    const s = document.createElement('script')
    handle!.stop()
    handle = undefined
    expect(members.map(([p, k]) => Object.getOwnPropertyDescriptor(p, k))).toEqual(before)
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
  const consented = () => encodeURIComponent(JSON.stringify({ consentId: 'abc-12345678', categories: ['necessary', 'analytics'], data: { siteRevision: 1, revisions: { tracker: 1 } } }))
  test('a marked script the site builds by code activates as a runnable script after consent', () => {
    let raw: string | null = null
    const driver = {
      init() {}, readRaw: () => raw, writeData() {}, showBanner() {}, open() {}, acceptAll() {}, rejectAll() {},
      acceptCategories() {}, acceptServices() {},
    }
    const c = createConsent(config, { driver: driver as never })
    c.init()
    install({ isAllowed: (id) => c.acceptedServices().includes(id) })
    const s = document.createElement('script')
    s.type = 'text/plain'
    s.dataset.consent = 'tracker'
    s.src = TRACKER
    document.head.appendChild(s)
    raw = consented()
    const unbind = bindMarked(c, document)
    const active = document.head.querySelector('script')!
    expect(active).not.toBe(s)
    expect(active.hasAttribute('type')).toBe(false)
    expect(active.getAttribute('src')).toBe(TRACKER)
    unbind()
  })
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
  test('www.facebook.com serves page-plugin and social embeds, not the Meta Pixel (connect.facebook.net)', () => {
    expect(KNOWN_HOSTS['www.facebook.com']).toBe('facebook-embed')
    expect(Object.entries(KNOWN_HOSTS).filter(([, id]) => id === 'meta-pixel').map(([h]) => h)).toEqual(['connect.facebook.net'])
  })
})
