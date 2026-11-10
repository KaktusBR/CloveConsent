import { CATEGORIES, type ConsentConfig, type ConsentState, type DecisionInfo } from './schema'
import { serviceAccepted } from './state'
import { endpointProblem } from './validate'

export interface LoggerOptions {
  endpoint: string
  siteSlug?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  location?: { origin: string; hostname: string }
}

export function createConsentLogger(opts: LoggerOptions) {
  const loc = opts.location ?? (typeof location !== 'undefined' ? location : { origin: '', hostname: '' })
  const { endpoint } = opts
  const problem = endpointProblem(endpoint, loc)
  if (problem) throw new Error(`[consent] logger endpoint ${problem}`)
  const timeoutMs = opts.timeoutMs ?? 5000
  const doFetch = opts.fetchImpl ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined)

  /**
   * Posts one consent record. `categories` says whether a category is accepted at all; `services` lists the optional services the
   * stored choice accepts, which is what consent was given for (a category can be accepted for only some of its services). Pass the
   * `DecisionInfo` of the `decision` event so the record says what kind of decision it was (a withdrawal is not a refusal).
   */
  return async (state: ConsentState | null, config: ConsentConfig, info?: DecisionInfo): Promise<void> => {
    if (!state || !doFetch) return
    const categories = Object.fromEntries(CATEGORIES.map((c) => [c, state.categories.includes(c)]))
    const perService = config.ui.manager.serviceToggles
    const services = config.services.filter((s) => s.category !== 'necessary' && serviceAccepted(state, s, perService)).map((s) => s.id)
    const body = JSON.stringify({
      ...(opts.siteSlug ? { siteSlug: opts.siteSlug } : {}),
      consentId: state.consentId, siteRevision: state.siteRevision ?? config.revision,
      revisions: state.revisions, timestamp: state.timestamp, categories, services,
      ...(info ? { kind: info.kind, changed: info.changed, changedServices: info.changedServices, locale: info.locale } : {}),
    })
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeoutMs)
    try {
      await doFetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, credentials: 'omit', keepalive: true, redirect: 'error', signal: ctl.signal })
    } catch { /* never block the UI */ } finally { clearTimeout(timer) }
  }
}
