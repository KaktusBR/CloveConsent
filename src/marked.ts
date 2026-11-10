import type { Consent } from './client'
import { isDev } from './dev'
import { hostAllowed } from './gating'
import { bindPlaceholderActions, measure, mountPlaceholder, renderPlaceholder } from './placeholder'
import type { ServiceEntry } from './schema'
import { buildView, type View } from './view'

export interface MarkedOptions {
  /** A marked element names a service the configuration does not have. It stays blocked; reported once per element. */
  onUnknown?(serviceId: string, el: Element): void
}

// elements already reported (unknown service, or a source outside the service's origins): once per element, not on every sync
const reported = new WeakSet<Element>()
// placeholder shown in place of a blocked marked iframe -> that iframe, kept detached until it may load
const hiddenFrames = new WeakMap<Element, HTMLIFrameElement>()
// widget container -> the placeholder shown inside it
const containerPlaceholders = new WeakMap<Element, Element>()

function warnOnce(el: Element, msg: string): void {
  if (reported.has(el)) return
  reported.add(el)
  if (isDev()) console.warn(`[consent] ${msg}`)
}

function serviceOf(consent: Consent, el: Element, attr: string, opts: MarkedOptions): ServiceEntry | null {
  const id = el.getAttribute(attr) ?? ''
  const entry = consent.config.services.find((s) => s.id === id)
  if (entry) return entry
  if (!reported.has(el)) {
    reported.add(el)
    if (opts.onUnknown) opts.onUnknown(id, el)
    else if (isDev()) console.warn(`[consent] marked element names unknown service "${id}"; it stays blocked`)
  }
  return null
}

// a source may only load from a host in the service's origins, over https; a service without origins loads no source
const sourceAllowed = (entry: ServiceEntry, url: string): boolean => entry.kind === 'client' && hostAllowed(entry, url)

/**
 * Replaces a marked script with a new script element: one the parser created as text/plain never runs after its type changes.
 * The new element keeps the original attributes except the marking; its type comes from `data-type`. An inline script is the
 * site owner's own code and keeps its text. The replaced element is gone, so a script is activated at most once per page view.
 */
function activateScript(doc: Document, el: HTMLScriptElement, entry: ServiceEntry): void {
  const src = el.getAttribute('src')
  if (src !== null && !sourceAllowed(entry, src)) {
    warnOnce(el, `marked script for "${entry.id}" not activated: ${src} is not one of its origins`)
    return
  }
  const s = doc.createElement('script')
  for (const a of Array.from(el.attributes)) {
    if (a.name === 'type' || a.name === 'data-type' || a.name.startsWith('data-consent')) continue
    s.setAttribute(a.name, a.value)
  }
  // browsers hide a parsed nonce from the attribute; the property still has it
  if (el.nonce) s.nonce = el.nonce
  const type = el.getAttribute('data-type')
  if (type) s.setAttribute('type', type)
  if (src === null) s.text = el.text
  // inserted scripts are async by default: keep the page's order unless the tag asked for async
  else if (!el.hasAttribute('async')) s.async = false
  // lets unloadService find it when consent is withdrawn
  s.dataset.consentService = entry.id
  el.replaceWith(s)
}

function syncContainers(consent: Consent, doc: Document, view: () => View, opts: MarkedOptions): void {
  doc.querySelectorAll<HTMLElement>('[data-consent-placeholder]').forEach((box) => {
    const entry = serviceOf(consent, box, 'data-consent-placeholder', opts)
    if (!entry) return
    const ph = containerPlaceholders.get(box)
    if (consent.isAllowed(entry.id)) {
      // empty, so the widget's script renders into it
      if (ph) { ph.remove(); containerPlaceholders.delete(box) }
    } else if (!ph || !box.contains(ph)) {
      const size = measure(box)
      const slot = doc.createElement('div')
      box.replaceChildren(slot)
      containerPlaceholders.set(box, mountPlaceholder(slot, renderPlaceholder(view(), entry.id), size))
    }
  })
}

function syncFrames(consent: Consent, doc: Document, view: () => View, opts: MarkedOptions): void {
  const loadable = (frame: HTMLIFrameElement, entry: ServiceEntry): string | null => {
    if (!consent.isAllowed(entry.id)) return null
    const src = frame.getAttribute('data-consent-src') ?? ''
    if (sourceAllowed(entry, src)) return src
    warnOnce(frame, `marked iframe for "${entry.id}" not activated: ${src} is not one of its origins`)
    return null
  }
  // blocked iframes waiting behind a placeholder
  doc.querySelectorAll('[data-consent-placeholder-for]').forEach((ph) => {
    const frame = hiddenFrames.get(ph)
    if (!frame) return
    const entry = consent.config.services.find((s) => s.id === frame.getAttribute('data-consent'))
    const src = entry ? loadable(frame, entry) : null
    if (src === null) return
    // set before it is attached, so it navigates once
    frame.setAttribute('src', src)
    ph.replaceWith(frame)
    hiddenFrames.delete(ph)
  })
  // marked iframes in the page: load the allowed ones, put a placeholder in place of the others
  doc.querySelectorAll<HTMLIFrameElement>('iframe[data-consent]').forEach((frame) => {
    const entry = serviceOf(consent, frame, 'data-consent', opts)
    if (!entry) return
    const src = loadable(frame, entry)
    if (src !== null) {
      if (frame.getAttribute('src') !== src) frame.setAttribute('src', src)
      return
    }
    const ph = mountPlaceholder(frame, renderPlaceholder(view(), entry.id), measure(frame))
    frame.removeAttribute('src')
    hiddenFrames.set(ph, frame)
  })
}

/** Brings every marked element of the page in line with the current consent. Safe to call any number of times. */
export function syncMarked(consent: Consent, doc: Document, opts: MarkedOptions = {}): void {
  let cached: View | null = null
  const view = () => (cached ??= buildView(consent.config, consent.locale))
  // containers first: a widget script must find its container empty when it runs
  syncContainers(consent, doc, view, opts)
  syncFrames(consent, doc, view, opts)
  doc.querySelectorAll<HTMLScriptElement>('script[type="text/plain"][data-consent]').forEach((el) => {
    const entry = serviceOf(consent, el, 'data-consent', opts)
    if (entry && consent.isAllowed(entry.id)) activateScript(doc, el, entry)
  })
}

/**
 * Activates marked scripts, iframes and widget containers when their service is allowed, and keeps them in line with every later
 * decision, one-time allowance and Astro page swap. Withdrawing puts placeholders back; scripts that already ran are unloaded by
 * the client (`unloadService`), which reports storage it cannot clear in `consent.leftovers`. Returns an unbind.
 */
export function bindMarked(consent: Consent, doc: Document, opts: MarkedOptions = {}): () => void {
  const releaseActions = bindPlaceholderActions(consent, doc)
  const sync = () => syncMarked(consent, doc, opts)
  const offs = [consent.on('ready', sync), consent.on('decision', sync), consent.on('once', sync)]
  doc.addEventListener('astro:page-load', sync)
  sync()
  return () => {
    for (const off of offs) off()
    doc.removeEventListener('astro:page-load', sync)
    releaseActions()
  }
}
