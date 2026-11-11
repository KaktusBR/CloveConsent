import { hasOwn } from './has-own'
import { installAutoBlocking, type AutoBlocking } from './autoblock'
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
  /** Where reports of unconfigured trackers and unknown marked ids go (hosted CMP only). */
  reportUrl?: string
}

/**
 * What a report is about: `unconfigured`, a known tracker host no configured service covers (auto-blocking); `unknown`, a
 * marked tag naming a service id the configuration does not have. Either stays blocked.
 */
export type ReportKind = 'unconfigured' | 'unknown'

// one boot per document and page view; a failed boot (null) is not retried
const booted = new WeakMap<Document, Consent | null>()

/**
 * Sends one report per kind, service id and page view to `url` with `sendBeacon`: the kind, the site key, the service id, the
 * page path (no query, no hash) and the time. Nothing about the visitor. Without a usable URL or `sendBeacon`, nothing is sent.
 */
function blockedReporter(url: string | undefined, site: string, win: Window | null): (kind: ReportKind, serviceId: string) => void {
  if (!url || !win) return () => {}
  const problem = endpointProblem(url, win.location)
  if (problem) {
    console.error(`[consent] reportUrl ${problem}; blocked trackers are not reported`)
    return () => {}
  }
  const sent = new Set<string>()
  return (kind, serviceId) => {
    const key = `${kind}:${serviceId}`
    if (sent.has(key)) return
    sent.add(key)
    try {
      const nav = win.navigator
      if (typeof nav.sendBeacon !== 'function') return
      nav.sendBeacon(url, JSON.stringify({ kind, site, service: serviceId, path: win.location.pathname, timestamp: new Date().toISOString() }))
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
  // never throws into the host page
  try {
    return bootIn(bundle, doc)
  } catch (err) {
    console.error('[consent] runtime not started', err)
    return booted.get(doc) ?? null
  }
}

function bootIn(bundle: StandaloneBundle, doc: Document): Consent | null {
  const win = doc.defaultView
  const report = blockedReporter(bundle.reportUrl, bundle.site, win)
  // a marked tag naming a service id the configuration lacks stays blocked: one warning per id for the site owner (in every
  // build, not only in development), and a report
  const warnedUnknown = new Set<string>()
  // trackers auto-blocking held as unconfigured: they become marked tags under a catalog id the configuration lacks, and are
  // already reported as unconfigured, so marked-tag sync must not report them again as unknown
  const heldUnconfigured = new WeakSet<Element>()
  const onUnknown = (serviceId: string, el: Element) => {
    if (heldUnconfigured.has(el)) return
    if (!warnedUnknown.has(serviceId)) {
      warnedUnknown.add(serviceId)
      console.warn(`[consent] marked element names unknown service "${serviceId}"; it stays blocked`)
    }
    report('unknown', serviceId)
  }
  // set once the configuration has been parsed: until then, and for good when it cannot be, nothing is reported as unconfigured
  // (a configured service's host would look unconfigured)
  let consent: Consent | null = null
  let markedBound = false

  let blocking: AutoBlocking | null = null
  try {
    blocking = installAutoBlocking(doc, {
      // configured services only: auto-blocking itself knows the trackers no configured service covers (they never pass)
      serviceForHost: (host) => consent?.config.services.find((s) => s.kind === 'client' && s.origins.includes(host))?.id ?? null,
      // persisted consent only; a one-time allowance comes through release()
      isAllowed: (id) => !!consent
        && (consent.acceptedServices().includes(id) || consent.config.services.some((s) => s.id === id && s.category === 'necessary')),
      onBlocked: (id, el, configured) => {
        const c = consent
        if (!configured) {
          heldUnconfigured.add(el)
          if (c) report('unconfigured', id)
        }
        // a neutralized iframe gets its placeholder once it is in the page (the "not available" one when unconfigured)
        if (c && markedBound && el.localName === 'iframe') queueMicrotask(() => syncMarked(c, doc, { onUnknown }))
      },
    })
  } catch (err) {
    // marked tags still hold their trackers: they never depend on auto-blocking
    console.error('[consent] auto-blocking not installed', err)
  }

  try {
    const nav = win?.navigator
    const preferred = nav?.languages?.length ? nav.languages : nav?.language ? [nav.language] : []
    const locale = pickLocale(Object.keys(bundle.configs), doc.documentElement?.getAttribute('lang') ?? null, preferred, bundle.defaultLocale)
    const json = hasOwn(bundle.configs, locale) ? bundle.configs[locale] : undefined
    if (typeof json !== 'string') throw new Error(`no configuration for ${locale}`)
    consent = createConsent(fromPublicJson(json), { driver: createVccDriver(), doc, locale })
  } catch (err) {
    console.error('[consent] invalid configuration, banner not started', err)
    return null
  }

  const c = consent
  booted.set(doc, c)
  // before bindMarked: a released iframe must pass auto-blocking when marked-tag activation sets its src
  c.on('once', (id) => blocking?.release(id))
  sendRecords(c, bundle.site, win)
  applyThemeSafely(c, doc)
  try { adoptStyles(doc) } catch (err) { console.error('[consent] styles not adopted', err) }

  const bind = () => {
    try {
      c.init()
      bindDom(c, doc)
      bindMarked(c, doc, { onUnknown })
      markedBound = true
    } catch (err) {
      console.error('[consent] runtime not started', err)
      return
    }
    doc.querySelectorAll<HTMLElement>('[data-cloveconsent-settings]').forEach((root) => {
      try { bindSettings(c, root) } catch (err) { console.error('[consent] settings panel not bound', err) }
    })
  }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', bind, { once: true })
  else bind()
  return c
}
