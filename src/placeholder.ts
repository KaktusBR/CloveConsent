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
  const text = `${format(m.embedBlocked, { service: name })} ${format(m.embedHint, { category: category.title })}`
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

/** Replaces `target` with the placeholder built from `html`. A known size is kept; otherwise the minimum-size class applies. */
export function mountPlaceholder(target: HTMLElement, html: string, size: PlaceholderSize | null): HTMLElement {
  const tpl = target.ownerDocument.createElement('template')
  tpl.innerHTML = html
  const ph = tpl.content.firstElementChild as HTMLElement
  if (size) { ph.style.inlineSize = size.width; ph.style.blockSize = size.height }
  else ph.classList.add('consent-placeholder--min')
  target.replaceWith(ph)
  return ph
}

const ATTR_LENGTH = /^\d+(\.\d+)?%?$/

function side(el: HTMLElement, attr: 'width' | 'height', rendered: number): string | null {
  const a = el.getAttribute(attr)?.trim() ?? ''
  if (ATTR_LENGTH.test(a) && parseFloat(a) > 0) return a.endsWith('%') ? a : `${a}px`
  return rendered > 0 ? `${rendered}px` : null
}

/** The size a blocked element should keep: its width/height attributes, else its rendered box. Null when it has none (0 by 0). */
export function measure(el: HTMLElement): PlaceholderSize | null {
  const box = el.getBoundingClientRect()
  const width = side(el, 'width', box.width)
  const height = side(el, 'height', box.height)
  return width && height ? { width, height } : null
}
