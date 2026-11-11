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
 * - the `src` and `type` accessors of scripts and iframes and `Element.prototype.setAttribute`, `setAttributeNS` and
 *   `removeAttribute` are intercepted for every script and iframe of this window, whoever built it (code, the HTML parser,
 *   markup, another document): a tracker source is held before the browser can request it (a script inserted by code fetches
 *   at once, before any observer runs; a lazy loader sets `src` on an iframe that is already in the page);
 * - a MutationObserver on the document: the parser runs pending observers before it runs a script it has just inserted, so a
 *   parser-inserted script can still be made inert; it also marks scripts inserted as markup (which the browser never runs),
 *   and, as a net, neutralizes and reports a tracker `src` set on a script or iframe through a path no setter covers (an
 *   attribute node): a script may have started by then, an iframe's load is stopped;
 * - `innerHTML`, `outerHTML` and `insertAdjacentHTML` hold tracker iframes in markup before it is inserted (an iframe starts
 *   loading inside that call), see `installMarkupGuard`.
 *
 * Install it first, synchronously: tags placed before it are out of its reach. Limits, measured in Chromium: the browser's
 * preload scanner requests a `<script src>` written in the HTML before any script runs (it still never executes), and an
 * `<iframe src>` written in the HTML has sent its request before any observer runs (its load is stopped). What is replaced:
 * those members of the script, iframe and element prototypes and the three markup members of `Element.prototype`; only
 * scripts and iframes are affected, everything else keeps its native behaviour, and no interception throws into host code
 * (a wrong receiver or argument fails exactly as natively).
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
  const scriptProto = win.HTMLScriptElement?.prototype
  const frameProto = win.HTMLIFrameElement?.prototype
  const scriptSrc = accessor(scriptProto, 'src')
  const scriptType = accessor(scriptProto, 'type')
  const frameSrc = accessor(frameProto, 'src')
  const released = new Set<string>()
  const reported = new WeakSet<Element>()
  let stopped = false

  const attr = (el: Element, name: string) => nat.get.call(el, name)
  const setAttr = (el: Element, name: string, value: string) => nat.set.call(el, name, value)
  const isScript = (el: Element): el is HTMLScriptElement => el.localName === 'script' && el.namespaceURI === HTML_NS
  const isFrame = (el: Element): el is HTMLIFrameElement => el.localName === 'iframe' && el.namespaceURI === HTML_NS
  /** The receiver of an intercepted member when it is a script or iframe of this window; null for anything else. */
  const target = (el: unknown): Target | null => {
    try { return el instanceof win.Element && (isScript(el) || isFrame(el)) ? el : null } catch { return null }
  }
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

  /** A source being set by code on a script or iframe; true when it was held back. */
  const intercept = (el: Target, value: unknown): boolean => {
    try {
      // a script that never runs (a marked tag the site built itself, or data) is left as written
      if (isScript(el) && !nat.has.call(el, AUTO) && !runnable(el)) return false
      const raw = String(value)
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

  // the attribute forms follow the same rules; the type of a neutralized script goes to data-type
  const lower = (name: unknown): string | null => { try { return String(name).toLowerCase() } catch { return null } }
  const routed = (el: Target, name: string | null, value: unknown): boolean => {
    if (name === 'src') return intercept(el, value)
    if (name === 'type' && isScript(el) && neutralized(el)) {
      try { setAttr(el, 'data-type', String(value)); return true } catch { return false }
    }
    return false
  }
  const after = (el: Target, name: string | null) => { if (name === 'type' && isScript(el)) recheck(el) }

  /** [prototype, name, the original descriptor, ours]: what `stop` puts back. */
  const patched: Array<[object, string, PropertyDescriptor, PropertyDescriptor]> = []
  const patch = (proto: object | undefined, name: string, ours: PropertyDescriptor) => {
    const orig = proto && Object.getOwnPropertyDescriptor(proto, name)
    if (!proto || !orig) return
    const desc = { ...orig, ...ours }
    Object.defineProperty(proto, name, desc)
    patched.push([proto, name, orig, desc])
  }
  const method = (fn: (this: Element, ...args: never[]) => unknown): PropertyDescriptor => ({ value: fn })
  // the native call gets the receiver and the arguments exactly as given, so it fails exactly as it would have
  const native = (fn: (...args: never[]) => unknown, self: unknown, args: IArguments) => Reflect.apply(fn, self, args)

  try {
    if (frameSrc) {
      patch(frameProto, 'src', {
        get(this: unknown) {
          const el = target(this)
          if (el && neutralized(el) && !nat.has.call(el, 'src')) {
            const held = attr(el, 'data-consent-src') ?? ''
            try { return new URL(held, doc.baseURI).href } catch { return held }
          }
          return frameSrc.get!.call(this)
        },
        set(this: unknown, v: unknown) { const el = target(this); if (!el || !intercept(el, v)) frameSrc.set!.call(this, v) },
      })
    }
    if (scriptSrc) {
      patch(scriptProto, 'src', {
        set(this: unknown, v: unknown) { const el = target(this); if (!el || !intercept(el, v)) scriptSrc.set!.call(this, v) },
      })
    }
    if (scriptType) {
      patch(scriptProto, 'type', {
        get(this: unknown) {
          const el = target(this)
          return el && neutralized(el) ? attr(el, 'data-type') ?? '' : scriptType.get!.call(this)
        },
        set(this: unknown, v: unknown) {
          const el = target(this)
          if (el && routed(el, 'type', v)) return
          scriptType.set!.call(this, v)
          if (el) after(el, 'type')
        },
      })
    }
    patch(E, 'setAttribute', method(function setAttribute(this: Element, name: string, value: string) {
      const el = target(this)
      const n = el && arguments.length >= 2 ? lower(name) : null
      if (el && routed(el, n, value)) return
      native(nat.set, this, arguments)
      if (el) after(el, n)
    }))
    patch(E, 'setAttributeNS', method(function setAttributeNS(this: Element, ns: string | null, name: string, value: string) {
      const el = target(this)
      const n = el && !ns && arguments.length >= 3 ? lower(name) : null
      if (el && routed(el, n, value)) return
      native(nat.setNS, this, arguments)
      if (el) after(el, n)
    }))
    patch(E, 'removeAttribute', method(function removeAttribute(this: Element, name: string) {
      const el = target(this)
      const n = el && arguments.length >= 1 ? lower(name) : null
      if (el && n === 'type' && isScript(el) && neutralized(el)) { nat.remove.call(el, 'data-type'); return }
      native(nat.remove, this, arguments)
      if (el) after(el, n)
    }))
  } catch { /* what could not be patched stays native: the observer still neutralizes */ }

  // elements the parser or markup insertion put in the page, and tracker sources set through a path no setter covers
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
      try {
        if (r.type === 'attributes') { if (r.target.nodeType === 1) check(r.target as Element); continue }
      } catch { continue }
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
  observer.observe(doc, { childList: true, subtree: true, attributes: true, attributeFilter: ['src'] })

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
      // only what is still ours: a wrapper someone installed over it stays, and ours passes through once stopped
      const same = (a: PropertyDescriptor | undefined, b: PropertyDescriptor) => !!a && a.get === b.get && a.set === b.set && a.value === b.value
      for (const [proto, name, orig, ours] of patched) {
        try { if (same(Object.getOwnPropertyDescriptor(proto, name), ours)) Object.defineProperty(proto, name, orig) } catch { /* left, passing through */ }
      }
      try { restoreMarkup() } catch { /* left in place, passing through */ }
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
