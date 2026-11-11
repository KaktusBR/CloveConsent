import type { Consent } from './client'
import { escapeHtml } from './html'
import { format } from './messages'
import type { View } from './view'

export interface PlaceholderSize { width: string; height: string }

/**
 * Markup for one blocked visual element. The only place a placeholder is written: the Astro GatedEmbed, the DOM sync and the
 * standalone runtime all use it. The "once" button is offered only for services that load in an iframe (a script's side effects
 * cannot be undone). `label` replaces the service title in the texts, for example a per-embed title.
 */
export function renderPlaceholder(view: View, serviceId: string, label?: string): string {
  let service = null
  let category = null
  for (const c of view.categories) {
    const s = c.services.find((x) => x.id === serviceId)
    if (s) { service = s; category = c; break }
  }
  if (!service || !category) throw new Error(`[consent] renderPlaceholder: unknown service "${serviceId}"`)
  const m = view.m
  const name = label ?? service.title
  // `provider`: the placeholder of phase 1, kept for sites that override embedBlocked with it
  const text = `${format(m.embedBlocked, { service: name, provider: service.provider ?? name })} ${format(m.embedHint, { category: category.title })}`
  const once = service.iframe
    ? `<button type="button" class="consent-btn consent-btn--secondary" data-consent-action="once">${escapeHtml(m.embedLoadOnce)}</button>`
    : ''
  return `<div class="consent-placeholder" data-consent-placeholder-for="${escapeHtml(serviceId)}">`
    + `<p class="consent-placeholder__text">${escapeHtml(text)}</p>`
    + once
    + `<button type="button" class="consent-btn consent-btn--primary" data-consent-action="accept">${escapeHtml(format(m.embedAllow, { service: name }))}</button>`
    + `<button type="button" class="consent-btn consent-btn--link" data-consent-open>${escapeHtml(m.reopen)}</button>`
    + `</div>`
}

/**
 * Markup for a blocked visual element that can never load on this site: a service id the configuration does not have, a tracker
 * no configured service covers, or a source outside its service's origins. Nothing to allow, so no "Allow" or "Load once"; the
 * settings link stays. Works for any id, also one the view does not have.
 */
export function renderUnavailable(view: View, serviceId: string): string {
  return `<div class="consent-placeholder" data-consent-placeholder-for="${escapeHtml(serviceId)}" data-consent-unavailable>`
    + `<p class="consent-placeholder__text">${escapeHtml(view.m.embedUnavailable)}</p>`
    + `<button type="button" class="consent-btn consent-btn--link" data-consent-open>${escapeHtml(view.m.reopen)}</button>`
    + `</div>`
}

/**
 * Placeholders the runtime itself put in the page: the only ones whose buttons act. Markup that merely looks like one (injected
 * CMS content or comments keep data-* attributes; a copy of a real one) grants nothing.
 */
const mounted = new WeakSet<Element>()

function place(target: Element, html: string): HTMLElement {
  const tpl = target.ownerDocument.createElement('template')
  tpl.innerHTML = html
  const ph = tpl.content.firstElementChild as HTMLElement
  target.replaceWith(ph)
  mounted.add(ph)
  return ph
}

/** Replaces `target` with the placeholder built from `html`. A known size is kept; otherwise the minimum-size class applies. */
export function mountPlaceholder(target: HTMLElement, html: string, size: PlaceholderSize | null): HTMLElement {
  const ph = place(target, html)
  if (size) { ph.style.inlineSize = size.width; ph.style.blockSize = size.height }
  else ph.classList.add('consent-placeholder--min')
  return ph
}

/**
 * Replaces a placeholder the runtime did not mount (the server-rendered one of an embed box) with the one `html` builds, as it is
 * (it fills its box, as the server-rendered one did). Does nothing to one the runtime mounted. Returns the placeholder in place.
 */
export function renewPlaceholder(old: Element, html: () => string): Element {
  return mounted.has(old) ? old : place(old, html())
}

const ATTR_LENGTH = /^\d+(\.\d+)?%?$/

/**
 * One side of the size: a percentage attribute as written (it follows its container), else the rendered box (a pixel attribute
 * sizes the content box only, so borders and padding would be lost), else a pixel attribute (an element not laid out).
 */
function side(el: HTMLElement, attr: 'width' | 'height', rendered: number): string | null {
  const a = el.getAttribute(attr)?.trim() ?? ''
  const usable = ATTR_LENGTH.test(a) && parseFloat(a) > 0
  if (usable && a.endsWith('%')) return a
  if (rendered > 0) return `${rendered}px`
  return usable ? `${a}px` : null
}

/**
 * The size a blocked element should keep: its laid-out border box (the placeholder is border-box), with percentage width/height
 * attributes kept as written; its width/height attributes when it is not laid out. Null when it has none (0 by 0). The offset
 * size, not the bounding rectangle: a CSS transform on the element also applies to the placeholder, and must not count twice.
 */
export function measure(el: HTMLElement): PlaceholderSize | null {
  const width = side(el, 'width', el.offsetWidth)
  const height = side(el, 'height', el.offsetHeight)
  return width && height ? { width, height } : null
}

interface ActionBinding { users: number; release(): void }
const actionBindings = new WeakMap<Document, WeakMap<Consent, ActionBinding>>()

/**
 * The one delegated click listener for placeholder buttons and `[data-consent-open]` links, shared by everything that shows
 * placeholders (embed boxes, marked iframes, widget containers): bound once per document and client however many callers ask,
 * so a click is handled once. A button acts for the service of its placeholder (`data-consent-placeholder-for`), and only in a
 * placeholder the runtime mounted (see `mounted`). Returns a release; the listener goes when its last user releases it.
 */
export function bindPlaceholderActions(consent: Consent, doc: Document): () => void {
  const perDoc = actionBindings.get(doc) ?? new WeakMap<Consent, ActionBinding>()
  actionBindings.set(doc, perDoc)
  let binding = perDoc.get(consent)
  if (!binding) {
    const onClick = (ev: Event) => {
      if (!(ev.target instanceof Element)) return
      const t = ev.target.closest<HTMLElement>('[data-consent-open],[data-consent-action]')
      if (!t) return
      if (t.hasAttribute('data-consent-open')) { consent.open(); return }
      const ph = t.closest('[data-consent-placeholder-for]')
      if (!ph || !mounted.has(ph)) return
      const id = ph.getAttribute('data-consent-placeholder-for')
      const entry = consent.config.services.find((s) => s.id === id)
      if (!entry) return
      if (t.dataset.consentAction === 'once') consent.allowOnce(entry.id)
      else if (t.dataset.consentAction === 'accept') consent.acceptService(entry.id)
    }
    doc.addEventListener('click', onClick)
    const created: ActionBinding = { users: 0, release: () => { doc.removeEventListener('click', onClick); perDoc.delete(consent) } }
    perDoc.set(consent, (binding = created))
  }
  const b = binding
  b.users++
  let released = false
  return () => {
    if (released) return
    released = true
    if (--b.users === 0) b.release()
  }
}
