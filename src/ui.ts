import { createConsent, getConsent, type Consent } from './client'
import { fromPublicJson } from './config'
import { createEmbed, hostAllowed } from './gating'
import { bindPlaceholderActions, measure, mountPlaceholder, renderPlaceholder, renderUnavailable, renewPlaceholder } from './placeholder'
import { buildView, type View } from './view'
import { createVccDriver } from './driver-vcc'
import { applyTheme, bindSettingsFromDom } from './panel'
import type { ConsentDriver } from './driver'
import type { ClientEntry, Locale } from './schema'

const placeholders = new WeakMap<Element, Element>()

function syncEmbeds(consent: Consent, doc: Document): void {
  let cached: View | null = null
  const view = () => (cached ??= buildView(consent.config, consent.locale))
  doc.querySelectorAll<HTMLElement>('[data-consent-embed]').forEach((box) => {
    const id = box.dataset.consentService ?? ''
    const entry = consent.config.services.find((s) => s.id === id)
    if (!entry || entry.kind !== 'client') return
    const label = box.dataset.consentTitle ?? entry.messages.title[consent.locale] ?? entry.messages.title.en
    // the box's own placeholder (server-rendered by GatedEmbed, or anything put there) never acts: the runtime puts its own in
    // its place, from the configuration; one whose source can never load shows the "not available" state
    const shown = box.querySelector('[data-consent-placeholder-for]')
    if (shown) {
      renewPlaceholder(shown, () => hostAllowed(entry, box.dataset.consentSrc ?? '') ? renderPlaceholder(view(), id, label) : renderUnavailable(view(), id))
    }
    const hasFrame = box.querySelector('iframe') !== null
    if (consent.isAllowed(id) && !hasFrame) {
      try {
        const frame = createEmbed(doc, entry as ClientEntry, box.dataset.consentSrc ?? '', label)
        const ph = box.querySelector('[data-consent-placeholder-for]')
        if (ph) placeholders.set(box, ph)
        box.replaceChildren(frame)
      } catch (err) { /* disallowed src: keep the placeholder */ void err }
    } else if (!consent.isAllowed(id)) {
      // unloadService may already have removed the iframe; only touch boxes we swapped ourselves
      const ph = placeholders.get(box)
      const frame = box.querySelector('iframe')
      if (ph) {
        frame?.remove()
        if (!box.contains(ph)) box.replaceChildren(ph)
      } else if (frame) {
        // an iframe the page put there itself: give it the same placeholder, at the same size
        mountPlaceholder(frame, renderPlaceholder(view(), id, label), measure(frame))
      }
      placeholders.delete(box)
    }
  })
}

const bound = new WeakMap<Document, WeakSet<Consent>>()

export function bindDom(consent: Consent, doc: Document = document): void {
  let set = bound.get(doc)
  if (!set) { set = new WeakSet(); bound.set(doc, set) }
  if (set.has(consent)) return
  set.add(consent)
  bindPlaceholderActions(consent, doc)
  const sync = () => syncEmbeds(consent, doc)
  consent.on('ready', sync); consent.on('decision', sync); consent.on('once', sync)
  // Astro view transitions swap the page without a reload: embeds on the new page must be checked again
  doc.addEventListener('astro:page-load', sync)
  sync()
}

const themed = new WeakSet<Document>()

/**
 * Puts the theme overrides on the document root (an ancestor of both the engine's #cc-main and the settings panel) and keeps them
 * there: Astro view transitions swap the root's attributes, which can wipe the inline style, so they are applied again on every
 * `astro:page-load`. A failure is logged and never reaches the caller: the banner is already running.
 */
export function applyThemeSafely(consent: Consent, doc: Document): void {
  try {
    if (doc.documentElement) applyTheme(doc.documentElement, consent.config.ui.theme.tokens)
  } catch (err) {
    console.error('[consent] theme overrides not applied', err)
  }
  if (themed.has(doc)) return
  themed.add(doc)
  doc.addEventListener('astro:page-load', () => {
    const current = getConsent()
    if (current) applyThemeSafely(current, doc)
  })
}

export function bootFromDom(doc: Document = document, driver?: ConsentDriver): Consent | null {
  // a second call (e.g. the component rendered twice) must not start a second client
  const existing = getConsent()
  if (existing) { applyThemeSafely(existing, doc); return existing }
  const el = doc.getElementById('consent-config')
  if (!el?.textContent) return null
  try {
    const config = fromPublicJson(el.textContent)
    const want = el.getAttribute('data-locale') as Locale | null
    const consent = createConsent(config, { driver: driver ?? createVccDriver(), doc, locale: want ?? undefined })
    consent.init()
    bindDom(consent, doc)
    applyThemeSafely(consent, doc)
    try {
      bindSettingsFromDom(doc)
    } catch (err) {
      console.error('[consent] settings panel not bound', err)
    }
    return consent
  } catch (err) {
    console.error('[consent] invalid configuration, banner not started', err)
    return null
  }
}
