import { hasOwn } from './has-own'
import type { Category, ClientEntry, ConsentConfig, ConsentState, DecisionInfo, Locale, ServiceEntry, StorageItem } from './schema'
import type { ConsentDriver } from './driver'
import { loadScript, unloadService } from './gating'
import { buildStoredData, needsPrompt, parseConsent, serviceAccepted } from './state'
import { buildView } from './view'
import { isDev } from './dev'

export type ConsentEvent = 'ready' | 'decision' | 'once'
export interface Consent {
  readonly config: ConsentConfig
  readonly locale: Locale
  readonly leftovers: StorageItem[]
  init(): void
  getState(): ConsentState | null
  isAllowed(id: string): boolean
  acceptAll(): void
  rejectAll(): void
  open(): void
  /**
   * Accept every service of this category, keeping the services already accepted (stored and current, as `acceptedServices`).
   * A service held back by re-consent is not re-granted by this call.
   */
  acceptCategory(c: Category): void
  /** Exactly these optional services are accepted afterwards (an empty list accepts none). Throws for an unknown id; ids of necessary services are ignored. */
  setServices(ids: string[]): void
  /**
   * Ids of the optional services whose consent is stored and current: the persisted part of `isAllowed`. A one-time allowance
   * (`allowOnce`) is not included, nor are necessary services, nor a service held back by re-consent (new service, bumped
   * `catalogRevision` or site `revision`). Use it to show what the visitor has actually chosen.
   */
  acceptedServices(): string[]
  /**
   * Accept one more service, keeping the ones already accepted (stored and current, as `acceptedServices`). A service held back
   * by re-consent is not carried over: it is recorded as not accepted and stays blocked until the visitor turns it on.
   */
  acceptService(id: string): void
  /** Withdraw all consent. Reported as a decision of kind `withdraw`. */
  withdraw(): void
  /** Allow one embed for this page view only. Not available for scripts: their side effects cannot be undone. */
  allowOnce(id: string): void
  /** Fires on every page load that has a stored decision, and after each decision. */
  on(event: 'ready', fn: (state: ConsentState | null) => void): () => void
  /** Fires exactly once per decision the visitor makes. */
  on(event: 'decision', fn: (info: DecisionInfo) => void): () => void
  on(event: 'once', fn: (id: string) => void): () => void
}

let current: Consent | null = null
export const getConsent = (): Consent | null => current

function dev(msg: string, e?: unknown): void {
  if (isDev()) console.warn(`[consent] ${msg}`, e ?? '')
}

export function createConsent(config: ConsentConfig, deps: { driver: ConsentDriver; doc?: Document; locale?: Locale }): Consent {
  const doc = deps.doc ?? document
  const locale: Locale = deps.locale && config.locales.includes(deps.locale) ? deps.locale : config.defaultLocale
  const { driver } = deps
  const listeners: Record<ConsentEvent, Set<(arg: any) => void>> = { ready: new Set(), decision: new Set(), once: new Set() }
  const once = new Set<string>()
  const leftovers: StorageItem[] = []
  let started = false
  // set by withdraw() (with the services accepted at that moment) and consumed by the next change, which is then a withdrawal
  let withdrawing: string[] | null = null
  // optional services the visitor had accepted after the last decision: what to unload when one of them is switched off
  let lastAccepted: string[] = []

  const emit = (e: ConsentEvent, arg?: unknown) => {
    for (const fn of [...listeners[e]]) { try { fn(arg) } catch (err) { dev(`listener for ${e} threw`, err) } }
  }
  const hook = (fn: () => void) => { try { fn() } catch (err) { dev('hook threw', err) } }
  // without per-service toggles the engine knows no services: choices are made, stored and read per category
  const perService = config.ui.manager.serviceToggles
  const state = (): ConsentState | null => { try { return parseConsent(driver.readRaw()) } catch { return null } }
  const find = (id: string): ServiceEntry | undefined => config.services.find((s) => s.id === id)
  const persist = () => { try { driver.writeData(buildStoredData(config)) } catch (err) { dev('could not store revisions', err) } }
  const noteLeftovers = (items: StorageItem[]) => {
    for (const it of items) if (!leftovers.some((l) => l.type === it.type && l.name === it.name)) leftovers.push(it)
  }

  const ready = () => { const s = state(); emit('ready', s); if (s) hook(() => config.hooks.onReady?.(s)) }
  const decided = (info: Omit<DecisionInfo, 'locale'>) => {
    const full: DecisionInfo = { ...info, locale }
    emit('decision', full); const s = state(); if (s) hook(() => config.hooks.onDecision?.(s, full))
  }
  const accepted = (): Category[] => (state()?.categories ?? []).filter((c) => c !== 'necessary')
  // optional services the visitor has accepted, by the stored choice alone (re-consent gates are applied by isAllowed)
  const acceptedIds = (): string[] => {
    const st = state()
    return st ? config.services.filter((s) => s.category !== 'necessary' && serviceAccepted(st, s, perService)).map((s) => s.id) : []
  }
  const optionalCategories = (): Category[] => [...new Set(config.services.map((s) => s.category).filter((c) => c !== 'necessary'))]

  // an optional service whose revision the visitor has not seen (new service, bumped catalogRevision, or bumped
  // site revision) stays blocked until the visitor answers the re-consent banner
  const storedConsent = (st: ConsentState | null, s: ServiceEntry): boolean => {
    if (!st || st.siteRevision !== config.revision) return false
    const seen = hasOwn(st.revisions, s.id) ? st.revisions[s.id] : undefined
    if (seen === undefined || seen < s.catalogRevision) return false
    return serviceAccepted(st, s, perService)
  }
  const isAllowed = (id: string): boolean => {
    const s = find(id)
    if (!s) return false
    if (s.category === 'necessary' || once.has(id)) return true
    return storedConsent(state(), s)
  }
  const acceptedServices = (): string[] => {
    const st = state()
    return config.services.filter((s) => s.category !== 'necessary' && storedConsent(st, s)).map((s) => s.id)
  }
  const applyScripts = () => {
    for (const s of config.services) {
      if (s.kind === 'client' && s.gating.type === 'script' && isAllowed(s.id)) {
        try { loadScript(doc, s as ClientEntry) } catch (err) { dev(`could not load ${s.id}`, err) }
      }
    }
  }
  // unload every service that is no longer allowed: those of changed categories, and those the visitor switched off
  // inside a category that stays accepted
  const unload = (changed: Category[]) => {
    for (const s of config.services) {
      if ((changed.includes(s.category) || lastAccepted.includes(s.id)) && !isAllowed(s.id)) noteLeftovers(unloadService(doc, s))
    }
    lastAccepted = acceptedIds()
  }
  /**
   * What a decision about one service or category keeps of the earlier choice: only consent that is stored and current. A service
   * held back by re-consent (new, revised, or a bumped site revision) is not carried, so answering for another service can never
   * re-grant it. Without service toggles the unit of consent is the category: a category is kept only when every service the
   * stored choice accepts in it is still current; one revised service holds back the whole category, as it does in `isAllowed`.
   */
  const carryOver = (): string[] => {
    const current = acceptedServices()
    if (perService) return current
    const raw = acceptedIds()
    const out: string[] = []
    for (const c of optionalCategories()) {
      const inRaw = raw.filter((id) => find(id)!.category === c)
      const inCurrent = current.filter((id) => find(id)!.category === c)
      if (inCurrent.length > 0 && inCurrent.length === inRaw.length) out.push(...inCurrent)
    }
    return out
  }
  const select = (ids: string[]) => {
    const selection: Record<string, string[]> = Object.fromEntries(optionalCategories().map((c) => [c, [] as string[]]))
    for (const id of new Set(ids)) selection[find(id)!.category]!.push(id)
    driver.acceptServices(selection)
  }

  const api: Consent = {
    config, locale, leftovers,
    init() {
      if (started) return
      started = true
      const st = state()
      const prompt = needsPrompt(st, config)
      try {
        driver.init(buildView(config, locale), {
          onFirstConsent: () => {
            withdrawing = null; once.clear(); persist(); applyScripts(); lastAccepted = acceptedIds()
            decided({ kind: 'first', changed: accepted(), changedServices: lastAccepted })
          },
          onConsent: () => { applyScripts(); lastAccepted = acceptedIds(); ready() },
          onChange: (changed, changedServices) => {
            const before = withdrawing; withdrawing = null
            once.clear(); persist(); unload(changed); applyScripts()
            decided(before
              ? { kind: 'withdraw', changed, changedServices: [...new Set([...before, ...changedServices])] }
              : { kind: 'change', changed, changedServices })
          },
          // the visitor answered the re-consent banner without changing categories: record the revisions they have
          // now seen and load what the re-consent gate was holding back
          onDecision: () => {
            const before = state()
            if (!before || !needsPrompt(before, config)) return
            persist(); applyScripts(); lastAccepted = acceptedIds(); decided({ kind: 'reconfirm', changed: [], changedServices: [] }); ready()
          },
        })
        if (st && prompt) driver.showBanner()
      } catch (err) { dev('driver failed to start', err) }
      applyScripts()
      lastAccepted = acceptedIds()
      current = api
      ;(window as unknown as Record<string, unknown>).CookieConsent = Object.freeze({
        acceptAll: () => api.acceptAll(), rejectAll: () => api.rejectAll(), getState: () => api.getState(),
      })
    },
    getState: state,
    isAllowed,
    acceptedServices,
    acceptAll: () => driver.acceptAll(),
    rejectAll: () => driver.rejectAll(),
    withdraw() {
      // the driver reports the change synchronously from rejectAll; when it reports none (nothing accepted, or a category the
      // engine does not know) the flag must not survive to label the next, unrelated change as a withdrawal
      withdrawing = acceptedIds()
      try { driver.rejectAll() } finally { withdrawing = null }
    },
    open: () => driver.open(),
    acceptCategory(c) {
      // through the per-service path: the engine's own acceptCategory would enable every service of every category listed
      api.setServices([...carryOver(), ...config.services.filter((s) => s.category === c).map((s) => s.id)])
    },
    setServices(ids) {
      for (const id of ids) if (!find(id)) throw new Error(`[consent] unknown service ${id}`)
      select(ids.filter((id) => find(id)!.category !== 'necessary'))
    },
    acceptService(id) {
      const s = find(id)
      if (!s) throw new Error(`[consent] unknown service ${id}`)
      if (s.category === 'necessary') return
      api.setServices([...carryOver(), id])
    },
    allowOnce(id) {
      const s = find(id)
      if (!s) throw new Error(`[consent] unknown service ${id}`)
      if (s.kind !== 'client' || s.gating.type !== 'iframe') {
        throw new Error(`[consent] allowOnce only works for embeds; "${id}" is not an iframe service`)
      }
      once.add(id); emit('once', id)
    },
    on(event: ConsentEvent, fn: (arg: any) => void) { listeners[event].add(fn); return () => { listeners[event].delete(fn) } },
  }
  return api
}
