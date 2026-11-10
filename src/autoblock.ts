import { hasOwn } from './has-own'
import { KNOWN_HOSTS } from './known-hosts'

export interface AutoBlockOptions {
  /**
   * The configured service whose origins include this host, null if none. A host the configuration does not cover but
   * `KNOWN_HOSTS` lists is blocked all the same, under its catalog id, and reported as unconfigured; it never passes, whatever
   * is allowed (consent for a service covers that service's origins only).
   */
  serviceForHost(host: string): string | null
  /** Persisted consent for a service (necessary services count as allowed). Asked live, so a withdrawal blocks again. */
  isAllowed(serviceId: string): boolean
  /** A script or iframe was neutralized. `configured` is false for a known tracker host the configuration does not have. */
  onBlocked?(serviceId: string, el: Element, configured: boolean): void
}

export interface AutoBlocking {
  /**
   * A one-time allowance ("load once"): this service's iframes may load for the rest of the page view. Scripts are never
   * released this way, since their effects cannot be undone; they follow `isAllowed` only.
   */
  release(serviceId: string): void
  /** Stops intercepting. Elements already neutralized stay marked tags (marked-tag activation still handles them). */
  stop(): void
}

const HTML_NS = 'http://www.w3.org/1999/xhtml'
// the script types a browser runs (HTML "JavaScript MIME type essence match", plus module); anything else is data
const JS_TYPES = new Set([
  'module', 'application/ecmascript', 'application/javascript', 'application/x-ecmascript', 'application/x-javascript',
  'text/ecmascript', 'text/javascript', 'text/javascript1.0', 'text/javascript1.1', 'text/javascript1.2', 'text/javascript1.3',
  'text/javascript1.4', 'text/javascript1.5', 'text/jscript', 'text/livescript', 'text/x-ecmascript', 'text/x-javascript',
])
const isJsType = (type: string | null): boolean => {
  if (type === null) return true
  const t = type.trim().toLowerCase()
  return t === '' || JS_TYPES.has(t) || JS_TYPES.has(t.split(';')[0]!.trim())
}
const AUTO = 'data-consent-auto'
interface Tracker { id: string; configured: boolean }
type Target = HTMLScriptElement | HTMLIFrameElement

/**
 * Blocks tracker scripts and iframes added after it is installed, by turning them into marked tags (`type="text/plain"` scripts,
 * iframes with `data-consent-src`, all with `data-consent` and `data-consent-auto`) that marked-tag activation runs on consent.
 *
 * Three mechanisms, because none alone is in time for every path:
 * - a MutationObserver on the document: the parser runs pending observers before it runs a script it has just inserted, so a
 *   parser-inserted script can still be made inert; it also marks scripts inserted as markup (which the browser never runs);
 * - `document.createElement` / `createElementNS` hand out scripts and iframes whose `src`, `type`, `setAttribute`,
 *   `setAttributeNS` and `removeAttribute` are intercepted on that element only, so a source set by code is caught before the
 *   element is inserted (a script inserted by code fetches at once, before any observer runs);
 * - `innerHTML`, `outerHTML` and `insertAdjacentHTML` hold tracker iframes in markup before it is inserted (an iframe starts
 *   loading inside that call), see `installMarkupGuard`.
 *
 * Install it first, synchronously: tags placed before it are out of its reach. Limits, measured in Chromium: the browser's
 * preload scanner requests a `<script src>` written in the HTML before any script runs (it still never executes), and an
 * `<iframe src>` written in the HTML has sent its request before any observer runs (its load is stopped). What is replaced:
 * the document's two factory methods and the three markup members of `Element.prototype`; only scripts and iframes of this
 * document are affected, everything else keeps its native behaviour, and no interception throws into host code.
 */
export function installAutoBlocking(doc: Document, opts: AutoBlockOptions): AutoBlocking {
  const win = (doc.defaultView ?? globalThis) as Window & typeof globalThis
  const E = win.Element.prototype
  const nat = { set: E.setAttribute, setNS: E.setAttributeNS, remove: E.removeAttribute, get: E.getAttribute, has: E.hasAttribute }
  // an accessor this browser does not have (or has in another shape) is not patched: that path stays native
  const accessor = (proto: object | undefined, name: string): PropertyDescriptor | null => {
    const d = proto ? Object.getOwnPropertyDescriptor(proto, name) : undefined
    return d && typeof d.get === 'function' && typeof d.set === 'function' ? d : null
  }
  const scriptSrc = accessor(win.HTMLScriptElement?.prototype, 'src')
  const scriptType = accessor(win.HTMLScriptElement?.prototype, 'type')
  const frameSrc = accessor(win.HTMLIFrameElement?.prototype, 'src')
  const released = new Set<string>()
  const reported = new WeakSet<Element>()
  let stopped = false

  const attr = (el: Element, name: string) => nat.get.call(el, name)
  const setAttr = (el: Element, name: string, value: string) => nat.set.call(el, name, value)
  const isScript = (el: Element): el is HTMLScriptElement => el.localName === 'script' && el.namespaceURI === HTML_NS
  const isFrame = (el: Element): el is HTMLIFrameElement => el.localName === 'iframe' && el.namespaceURI === HTML_NS
  const neutralized = (el: Element) => !stopped && nat.has.call(el, AUTO)

  const trackerFor = (raw: string): Tracker | null => {
    let host: string
    try {
      const u = new URL(raw, doc.baseURI)
      if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
      host = u.hostname.toLowerCase()
    } catch { return null }
    let id: string | null = null
    try { id = opts.serviceForHost(host) } catch { /* treated as not configured */ }
    if (typeof id === 'string' && id) return { id, configured: true }
    const known = hasOwn(KNOWN_HOSTS, host) ? KNOWN_HOSTS[host] : undefined
    return known ? { id: known, configured: false } : null
  }
  const allowed = (el: Element, id: string): boolean => {
    if (isFrame(el) && released.has(id)) return true
    try { return opts.isAllowed(id) === true } catch { return false }
  }
  /**
   * The tracker an element with this source must be blocked for, or null when it may load. A host no configured service
   * covers never loads, whatever is allowed: consent for a service covers its origins only.
   */
  const blockFor = (el: Element, raw: string): Tracker | null => {
    if (stopped) return null
    const t = trackerFor(raw)
    return t && (!t.configured || !allowed(el, t.id)) ? t : null
  }
  /**
   * A script that would run: one of a JavaScript type. `data-consent` alone grants nothing; a marked tag is inert because of
   * its type (`text/plain`), and that is what leaves it alone. A marked iframe is inert because it has no `src` of its own
   * (the source waits in `data-consent-src`): any iframe whose `src` is a tracker is blocked, marked or not.
   */
  const runnable = (s: HTMLScriptElement) => isJsType(attr(s, 'type'))
  const report = (el: Element, t: Tracker) => {
    if (reported.has(el)) return
    reported.add(el)
    try { opts.onBlocked?.(t.id, el, t.configured) } catch { /* the host's handler must not undo the blocking */ }
  }
  const mark = (el: Element, t: Tracker) => {
    setAttr(el, 'data-consent', t.id)
    setAttr(el, AUTO, '')
  }

  const neutralizeScript = (s: HTMLScriptElement, t: Tracker) => {
    if (!nat.has.call(s, AUTO)) {
      const type = attr(s, 'type')
      if (type !== null) setAttr(s, 'data-type', type)
      setAttr(s, 'type', 'text/plain')
      mark(s, t)
    }
    report(s, t)
  }
  const neutralizeFrame = (f: HTMLIFrameElement, raw: string, t: Tracker) => {
    setAttr(f, 'data-consent-src', raw)
    mark(f, t)
    if (nat.has.call(f, 'src')) {
      nat.remove.call(f, 'src')
      // removing src does not stop a load that has started: taking the frame out of the page does. Put back, it is blank.
      const parent = f.parentNode
      if (parent) {
        const next = f.nextSibling
        f.remove()
        parent.insertBefore(f, next)
      }
    }
    report(f, t)
  }

  /** A source being set by code on an element from the patched factories; true when it was held back. */
  const intercept = (el: Target, raw: string): boolean => {
    try {
      // a script that never runs (a marked tag the site built itself, or data) is left as written
      if (isScript(el) && !nat.has.call(el, AUTO) && !runnable(el)) return false
      const t = blockFor(el, raw)
      if (!t) return false
      if (isScript(el)) {
        neutralizeScript(el, t)
        // inert while its type is text/plain; kept so activation knows what to load
        setAttr(el, 'src', raw)
      } else {
        neutralizeFrame(el, raw, t)
      }
      return true
    } catch {
      return false
    }
  }

  /** A script whose type was set or removed: one that has become runnable with a tracker source is neutralized now. */
  const recheck = (s: HTMLScriptElement) => {
    try {
      const raw = attr(s, 'src')
      if (raw === null || nat.has.call(s, AUTO) || !runnable(s)) return
      const t = blockFor(s, raw)
      if (t) neutralizeScript(s, t)
    } catch { /* never into host code */ }
  }

  const patch = (el: Target) => {
    const script = isScript(el)
    const src = script ? scriptSrc : frameSrc
    if (src) {
      Object.defineProperty(el, 'src', {
        configurable: true, enumerable: true,
        get() {
          if (!script && neutralized(el) && !nat.has.call(el, 'src')) {
            const held = attr(el, 'data-consent-src') ?? ''
            try { return new URL(held, doc.baseURI).href } catch { return held }
          }
          return src.get!.call(el)
        },
        set(v: unknown) { if (!intercept(el, String(v))) src.set!.call(el, v) },
      })
    }
    if (script && scriptType) {
      Object.defineProperty(el, 'type', {
        configurable: true, enumerable: true,
        get() { return neutralized(el) ? attr(el, 'data-type') ?? '' : scriptType.get!.call(el) },
        set(v: unknown) {
          if (neutralized(el)) { setAttr(el, 'data-type', String(v)); return }
          scriptType.set!.call(el, v)
          recheck(el as HTMLScriptElement)
        },
      })
    }
    // the same rules for the attribute forms; the type of a neutralized script goes to data-type
    const routed = (name: string, value: string): boolean => {
      if (name === 'src') return intercept(el, value)
      if (name === 'type' && script && neutralized(el)) { setAttr(el, 'data-type', value); return true }
      return false
    }
    const after = (name: string) => { if (script && name === 'type') recheck(el as HTMLScriptElement) }
    Object.defineProperty(el, 'setAttribute', {
      configurable: true, writable: true,
      value(this: Element, name: string, value: string) {
        const n = String(name).toLowerCase()
        if (!routed(n, String(value))) { nat.set.call(this, name, value); after(n) }
      },
    })
    Object.defineProperty(el, 'setAttributeNS', {
      configurable: true, writable: true,
      value(this: Element, ns: string | null, name: string, value: string) {
        const n = String(name).toLowerCase()
        if (ns || !routed(n, String(value))) { nat.setNS.call(this, ns, name, value); if (!ns) after(n) }
      },
    })
    Object.defineProperty(el, 'removeAttribute', {
      configurable: true, writable: true,
      value(this: Element, name: string) {
        const n = String(name).toLowerCase()
        if (script && n === 'type' && neutralized(el)) nat.remove.call(this, 'data-type')
        else { nat.remove.call(this, name); after(n) }
      },
    })
  }
  const watch = (el: unknown) => {
    if (stopped || !(el instanceof win.Element)) return
    try { if (isScript(el) || isFrame(el)) patch(el) } catch { /* left native */ }
  }

  // elements the parser or markup insertion put in the page
  const check = (el: Element) => {
    const raw = attr(el, 'src')
    if (raw === null) return
    if (isScript(el)) {
      if (!runnable(el)) return
      const t = blockFor(el, raw)
      if (t) neutralizeScript(el, t)
    } else if (isFrame(el)) {
      const t = blockFor(el, raw)
      if (t) neutralizeFrame(el, raw, t)
    }
  }
  const observer = new win.MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return
        const el = n as Element
        try {
          check(el)
          if (el.firstElementChild) el.querySelectorAll('script[src],iframe[src]').forEach(check)
        } catch { /* never into host code */ }
      })
    }
  })
  observer.observe(doc, { childList: true, subtree: true })

  // the factories: wrapped on this document only, the native behaviour kept for everything else
  const origCreate = doc.createElement
  const origCreateNS = doc.createElementNS
  const hadOwn = { create: hasOwn(doc, 'createElement'), createNS: hasOwn(doc, 'createElementNS') }
  const createElement = function (this: Document, ...args: Parameters<Document['createElement']>) {
    const el = Reflect.apply(origCreate, this, args)
    watch(el)
    return el
  }
  const createElementNS = function (this: Document, ...args: unknown[]) {
    const el = Reflect.apply(origCreateNS, this, args)
    watch(el)
    return el
  }
  try {
    Object.defineProperty(doc, 'createElement', { configurable: true, writable: true, value: createElement })
    Object.defineProperty(doc, 'createElementNS', { configurable: true, writable: true, value: createElementNS })
  } catch { /* a frozen document: the observer still covers parser-inserted tags */ }

  const restore = (name: 'createElement' | 'createElementNS', ours: unknown, orig: unknown, own: boolean) => {
    // someone wrapped ours since: leave their wrapper; ours passes through once stopped
    if (doc[name] !== ours) return
    if (own) Object.defineProperty(doc, name, { configurable: true, writable: true, value: orig })
    else delete (doc as unknown as Record<string, unknown>)[name]
  }
  const restoreMarkup = installMarkupGuard(doc, win, () => stopped, (root) => {
    let held = false
    root.querySelectorAll('iframe[src]').forEach((f) => {
      if (!isFrame(f)) return
      const raw = attr(f, 'src')!
      const t = blockFor(f, raw)
      if (t) { neutralizeFrame(f, raw, t); held = true }
    })
    return held
  })

  return {
    release(serviceId: string) { released.add(serviceId) },
    stop() {
      if (stopped) return
      stopped = true
      observer.disconnect()
      try {
        restore('createElement', createElement, origCreate, hadOwn.create)
        restore('createElementNS', createElementNS, origCreateNS, hadOwn.createNS)
        restoreMarkup()
      } catch { /* left in place, passing through */ }
    },
  }
}

// elements whose content is raw text or inert: markup set on them never creates a loading iframe
const NO_FRAMES = new Set(['script', 'style', 'textarea', 'title', 'xmp', 'iframe', 'noembed', 'noframes', 'noscript', 'plaintext', 'template'])
const MAY_HOLD_FRAME = /<iframe/i

/**
 * An iframe created by markup insertion (`innerHTML`, `outerHTML`, `insertAdjacentHTML`) starts loading inside that call,
 * before any observer can see it. For markup that contains an iframe, these three are routed through a detached element of the
 * same kind (the same parsing context, where nothing loads); when `holdFrames` neutralized a tracker iframe there, the parsed
 * nodes are inserted in place of the native call, otherwise the native call runs unchanged. Scripts need nothing here: the
 * browser never runs scripts inserted as markup, and the observer marks them. Applies to elements of `doc` only.
 * Returns a restore.
 */
function installMarkupGuard(
  doc: Document, win: Window & typeof globalThis, stopped: () => boolean, holdFrames: (root: Element) => boolean,
): () => void {
  const E = win.Element.prototype
  const inner = Object.getOwnPropertyDescriptor(E, 'innerHTML')
  const outer = Object.getOwnPropertyDescriptor(E, 'outerHTML')
  const adjacentDesc = Object.getOwnPropertyDescriptor(E, 'insertAdjacentHTML')
  const adjacent = E.insertAdjacentHTML
  const createNS = win.Document.prototype.createElementNS
  if (!inner?.set || !outer?.set || !adjacentDesc) return () => {}
  const setInner = inner.set

  /** Parses `markup` as children of a detached element like `context`; the staging element when a tracker iframe was held. */
  const stage = (context: Element | null, markup: unknown): Element | null => {
    if (stopped() || !context || context.ownerDocument !== doc || NO_FRAMES.has(context.localName)) return null
    if (!MAY_HOLD_FRAME.test(String(markup))) return null
    try {
      const staging = createNS.call(doc, context.namespaceURI, context.localName)
      setInner.call(staging, markup)
      return holdFrames(staging) ? staging : null
    } catch { return null }
  }
  const nodes = (staging: Element) => Array.from(staging.childNodes)
  // where the parsed nodes cannot be inserted, the native call runs (and reports its own error, as it would have)
  const insert = (fn: () => void): boolean => { try { fn(); return true } catch { return false } }

  const ours = {
    inner: {
      ...inner,
      set(this: Element, v: unknown) {
        const staging = stage(this, v)
        if (!staging || !insert(() => this.replaceChildren(...nodes(staging)))) setInner.call(this, v)
      },
    },
    outer: {
      ...outer,
      set(this: Element, v: unknown) {
        const parent = this.parentNode
        const staging = parent instanceof win.Element ? stage(parent, v) : null
        if (!staging || !insert(() => this.replaceWith(...nodes(staging)))) outer.set!.call(this, v)
      },
    },
    adjacent: function insertAdjacentHTML(this: Element, position: InsertPosition, text: string) {
      const where = String(position).toLowerCase()
      const inside = where === 'afterbegin' || where === 'beforeend'
      const outside = where === 'beforebegin' || where === 'afterend'
      const context = inside ? this : outside && this.parentNode instanceof win.Element ? this.parentNode : null
      const staging = stage(context, text)
      if (!staging) return adjacent.call(this, position, text)
      const parsed = nodes(staging)
      const done = insert(() => {
        if (where === 'afterbegin') this.prepend(...parsed)
        else if (where === 'beforeend') this.append(...parsed)
        else if (where === 'beforebegin') this.before(...parsed)
        else this.after(...parsed)
      })
      if (!done) adjacent.call(this, position, text)
    },
  }
  try {
    Object.defineProperty(E, 'innerHTML', ours.inner)
    Object.defineProperty(E, 'outerHTML', ours.outer)
    Object.defineProperty(E, 'insertAdjacentHTML', { ...adjacentDesc, value: ours.adjacent })
  } catch { /* not patchable here: the observer still neutralizes the iframe, after its load has started */ }

  return () => {
    // only what is still ours: a wrapper someone installed over it stays, and ours passes through once stopped
    if (Object.getOwnPropertyDescriptor(E, 'innerHTML')?.set === ours.inner.set) Object.defineProperty(E, 'innerHTML', inner)
    if (Object.getOwnPropertyDescriptor(E, 'outerHTML')?.set === ours.outer.set) Object.defineProperty(E, 'outerHTML', outer)
    if (E.insertAdjacentHTML === ours.adjacent) Object.defineProperty(E, 'insertAdjacentHTML', adjacentDesc)
  }
}
