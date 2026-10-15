import type { Category, ClientEntry, ConsentConfig, ConsentState, DecisionInfo, Locale, ServiceEntry, StorageItem } from './schema'
import type { ConsentDriver } from './driver'
import { loadScript, unloadService } from './gating'
import { buildStoredData, needsPrompt, parseConsent } from './state'
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
  acceptCategory(c: Category): void
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

  const emit = (e: ConsentEvent, arg?: unknown) => {
    for (const fn of [...listeners[e]]) { try { fn(arg) } catch (err) { dev(`listener for ${e} threw`, err) } }
  }
  const hook = (fn: () => void) => { try { fn() } catch (err) { dev('hook threw', err) } }
  const state = (): ConsentState | null => { try { return parseConsent(driver.readRaw()) } catch { return null } }
  const find = (id: string): ServiceEntry | undefined => config.services.find((s) => s.id === id)
  const persist = () => { try { driver.writeData(buildStoredData(config)) } catch (err) { dev('could not store revisions', err) } }
  const noteLeftovers = (items: StorageItem[]) => {
    for (const it of items) if (!leftovers.some((l) => l.type === it.type && l.name === it.name)) leftovers.push(it)
  }

  const ready = () => { const s = state(); emit('ready', s); if (s) hook(() => config.hooks.onReady?.(s)) }
  const decided = (info: DecisionInfo) => { emit('decision', info); const s = state(); if (s) hook(() => config.hooks.onDecision?.(s, info)) }
  const accepted = (): Category[] => (state()?.categories ?? []).filter((c) => c !== 'necessary')

  // an optional service whose revision the visitor has not seen (new service, bumped catalogRevision, or bumped
  // site revision) stays blocked until the visitor answers the re-consent banner
  const isAllowed = (id: string): boolean => {
    const s = find(id)
    if (!s) return false
    if (s.category === 'necessary' || once.has(id)) return true
    const st = state()
    if (!st || st.siteRevision !== config.revision) return false
    const seen = Object.hasOwn(st.revisions, s.id) ? st.revisions[s.id] : undefined
    if (seen === undefined || seen < s.catalogRevision) return false
    return st.categories.includes(s.category)
  }
  const applyScripts = () => {
    for (const s of config.services) {
      if (s.kind === 'client' && s.gating.type === 'script' && isAllowed(s.id)) {
        try { loadScript(doc, s as ClientEntry) } catch (err) { dev(`could not load ${s.id}`, err) }
      }
    }
  }
  const withdraw = (changed: Category[]) => {
    for (const s of config.services) {
      if (changed.includes(s.category) && !isAllowed(s.id)) noteLeftovers(unloadService(doc, s))
    }
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
          onFirstConsent: () => { once.clear(); persist(); applyScripts(); decided({ kind: 'first', changed: accepted() }) },
          onConsent: () => { applyScripts(); ready() },
          onChange: (changed) => { once.clear(); persist(); withdraw(changed); applyScripts(); decided({ kind: 'change', changed }) },
          // the visitor answered the re-consent banner without changing categories: record the revisions they have
          // now seen and load what the re-consent gate was holding back
          onDecision: () => {
            const before = state()
            if (!before || !needsPrompt(before, config)) return
            persist(); applyScripts(); decided({ kind: 'reconfirm', changed: [] }); ready()
          },
        })
        if (st && prompt) driver.showBanner()
      } catch (err) { dev('driver failed to start', err) }
      applyScripts()
      current = api
      ;(window as unknown as Record<string, unknown>).CookieConsent = Object.freeze({
        acceptAll: () => api.acceptAll(), rejectAll: () => api.rejectAll(), getState: () => api.getState(),
      })
    },
    getState: state,
    isAllowed,
    acceptAll: () => driver.acceptAll(),
    rejectAll: () => driver.rejectAll(),
    open: () => driver.open(),
    acceptCategory(c) {
      const have = state()?.categories ?? ['necessary']
      driver.acceptCategories([...new Set<Category>([...have, c])])
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
