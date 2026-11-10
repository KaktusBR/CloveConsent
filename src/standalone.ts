import { installAutoBlocking } from './autoblock'
import { createConsent, type Consent } from './client'
import { fromPublicJson } from './config'
import { createVccDriver } from './driver-vcc'
import { pickLocale } from './locale-pick'
import { createConsentLogger } from './log'
import { bindMarked, syncMarked } from './marked'
import { bindSettings } from './panel'
import { adoptStyles } from './styles'
import { applyThemeSafely, bindDom } from './ui'
import { endpointProblem } from './validate'

export interface StandaloneBundle {
  /** Site key, sent with records. */
  site: string
  defaultLocale: string
  /** locale -> `toPublicJson` output */
  configs: Record<string, string>
  /** Where unconfigured-tracker reports go (hosted CMP only). */
  reportUrl?: string
}

// one boot per document and page view; a failed boot (null) is not retried
const booted = new WeakMap<Document, Consent | null>()

/**
 * Sends one report per unconfigured tracker service and page view to `url` with `sendBeacon`: the service id, the page path
 * (no query, no hash) and the time. Nothing about the visitor. Without a usable URL or `sendBeacon`, nothing is sent.
 */
function unconfiguredReporter(url: string | undefined, win: Window | null): (serviceId: string) => void {
  if (!url || !win) return () => {}
  const problem = endpointProblem(url, win.location)
  if (problem) {
    console.error(`[consent] reportUrl ${problem}; unconfigured trackers are not reported`)
    return () => {}
  }
  const sent = new Set<string>()
  return (serviceId) => {
    if (sent.has(serviceId)) return
    sent.add(serviceId)
    try {
      const nav = win.navigator
      if (typeof nav.sendBeacon !== 'function') return
      nav.sendBeacon(url, JSON.stringify({ service: serviceId, path: win.location.pathname, timestamp: new Date().toISOString() }))
    } catch { /* reporting never disturbs the page */ }
  }
}

/** Posts a consent record (with the site key) for each decision, when the configuration has `records.url`. */
function sendRecords(consent: Consent, site: string, win: Window | null): void {
  const url = consent.config.records?.url
  if (!url) return
  let send: ReturnType<typeof createConsentLogger>
  try {
    send = createConsentLogger({ endpoint: url, siteSlug: site, location: win?.location })
  } catch (err) {
    // a URL that passed validation can still be unusable from this page (plain http on localhost, seen from a public site)
    console.error('[consent] consent records are not sent', err)
    return
  }
  consent.on('decision', (info) => { void send(consent.getState(), consent.config, info) })
}

/**
 * Starts the runtime from one bundle; meant to run as the first script in `<head>`. Auto-blocking is installed first and
 * synchronously, before anything else can add a tracker; it holds every tracker until the configuration is parsed and the visitor
 * has consented, and keeps holding the known ones when the configuration is unusable. Then: the locale from `<html lang>` and the
 * visitor's languages, that locale's configuration, the client, styles and theme; once the document is parsed, the embeds, marked
 * tags, placeholders and every `[data-cloveconsent-settings]` panel. Returns the client, the same one on every later call, or null
 * when the configuration cannot be used (logged once; marked tags stay blocked).
 */
export function boot(bundle: StandaloneBundle, doc: Document = document): Consent | null {
  if (booted.has(doc)) return booted.get(doc) ?? null
  booted.set(doc, null)
  const win = doc.defaultView
  const report = unconfiguredReporter(bundle.reportUrl, win)
  let consent: Consent | null = null
  let markedBound = false

  const blocking = installAutoBlocking(doc, {
    // configured services only: auto-blocking itself knows the trackers no configured service covers (they never pass)
    serviceForHost: (host) => consent?.config.services.find((s) => s.kind === 'client' && s.origins.includes(host))?.id ?? null,
    // persisted consent only; a one-time allowance comes through release()
    isAllowed: (id) => !!consent
      && (consent.acceptedServices().includes(id) || consent.config.services.some((s) => s.id === id && s.category === 'necessary')),
    onBlocked: (id, el, configured) => {
      if (!configured) { report(id); return }
      // a neutralized iframe gets its placeholder once it is in the page
      const c = consent
      if (c && markedBound && el.localName === 'iframe') queueMicrotask(() => syncMarked(c, doc))
    },
  })

  try {
    const nav = win?.navigator
    const preferred = nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : []
    const locale = pickLocale(Object.keys(bundle.configs), doc.documentElement?.getAttribute('lang') ?? null, preferred, bundle.defaultLocale)
    const json = Object.hasOwn(bundle.configs, locale) ? bundle.configs[locale] : undefined
    if (typeof json !== 'string') throw new Error(`no configuration for ${locale}`)
    consent = createConsent(fromPublicJson(json), { driver: createVccDriver(), doc, locale })
  } catch (err) {
    console.error('[consent] invalid configuration, banner not started', err)
    return null
  }

  const c = consent
  booted.set(doc, c)
  // before bindMarked: a released iframe must pass auto-blocking when marked-tag activation sets its src
  c.on('once', (id) => blocking.release(id))
  sendRecords(c, bundle.site, win)
  applyThemeSafely(c, doc)
  try { adoptStyles(doc) } catch (err) { console.error('[consent] styles not adopted', err) }

  const start = () => {
    try {
      c.init()
      bindDom(c, doc)
      bindMarked(c, doc)
      markedBound = true
    } catch (err) {
      console.error('[consent] runtime not started', err)
      return
    }
    doc.querySelectorAll<HTMLElement>('[data-cloveconsent-settings]').forEach((root) => {
      try { bindSettings(c, root) } catch (err) { console.error('[consent] settings panel not bound', err) }
    })
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', start, { once: true })
  else start()
  return c
}
