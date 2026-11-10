import { createConsent, getConsent, type Consent } from './client'
import { fromPublicJson } from './config'
import { createEmbed } from './gating'
import { createVccDriver } from './driver-vcc'
import { applyTheme, bindSettingsFromDom } from './panel'
import type { ConsentDriver } from './driver'
import type { ClientEntry, Locale } from './schema'

const placeholders = new WeakMap<Element, Element>()

function syncEmbeds(consent: Consent, doc: Document): void {
  doc.querySelectorAll<HTMLElement>('[data-consent-embed]').forEach((box) => {
    const id = box.dataset.consentService ?? ''
    const entry = consent.config.services.find((s) => s.id === id)
    if (!entry || entry.kind !== 'client') return
    const hasFrame = box.querySelector('iframe') !== null
    if (consent.isAllowed(id) && !hasFrame) {
      try {
        const frame = createEmbed(doc, entry as ClientEntry, box.dataset.consentSrc ?? '', box.dataset.consentTitle ?? entry.messages.title[consent.locale] ?? entry.messages.title.en)
        const ph = box.querySelector('[data-consent-placeholder]')
        if (ph) placeholders.set(box, ph)
        box.replaceChildren(frame)
      } catch (err) { /* disallowed src: keep the placeholder */ void err }
    } else if (!consent.isAllowed(id)) {
      // unloadService may already have removed the iframe; only touch boxes we swapped ourselves
      const ph = placeholders.get(box)
      const frame = box.querySelector('iframe')
      if (frame) frame.remove()
      if (ph && !box.contains(ph)) box.replaceChildren(ph)
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
  doc.addEventListener('click', (ev) => {
    if (!(ev.target instanceof Element)) return
    const t = ev.target.closest<HTMLElement>('[data-consent-open],[data-consent-action]')
    if (!t) return
    if (t.hasAttribute('data-consent-open')) { consent.open(); return }
    const box = t.closest<HTMLElement>('[data-consent-embed]')
    const entry = consent.config.services.find((s) => s.id === box?.dataset.consentService)
    if (!entry) return
    if (t.dataset.consentAction === 'once') consent.allowOnce(entry.id)
    else if (t.dataset.consentAction === 'accept') consent.acceptService(entry.id)
  })
  const sync = () => syncEmbeds(consent, doc)
  consent.on('ready', sync); consent.on('decision', sync); consent.on('once', sync)
  // Astro view transitions swap the page without a reload: embeds on the new page must be checked again
  doc.addEventListener('astro:page-load', sync)
  sync()
}

export function bootFromDom(doc: Document = document, driver?: ConsentDriver): Consent | null {
  // a second call (e.g. the component rendered twice) must not start a second client
  const existing = getConsent()
  if (existing) return existing
  const el = doc.getElementById('consent-config')
  if (!el?.textContent) return null
  try {
    const config = fromPublicJson(el.textContent)
    const want = el.getAttribute('data-locale') as Locale | null
    const consent = createConsent(config, { driver: driver ?? createVccDriver(), doc, locale: want ?? undefined })
    consent.init()
    bindDom(consent, doc)
    // the overrides sit on the document root: an ancestor of both the engine's #cc-main and the settings panel
    if (doc.documentElement) applyTheme(doc.documentElement, config.ui.theme.tokens)
    bindSettingsFromDom(doc)
    return consent
  } catch (err) {
    console.error('[consent] invalid configuration, banner not started', err)
    return null
  }
}
