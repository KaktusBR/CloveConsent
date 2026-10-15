import type { Category, ClientEntry, ConsentConfig, ConsentState, Locale, ServiceEntry, StorageItem } from './schema'
import type { ConsentDriver } from './driver'
import { loadScript, unloadService } from './gating'
import { buildStoredData, needsPrompt, parseConsent } from './state'
import { buildView } from './view'
import { isDev } from './dev'

export type ConsentEvent = 'first-consent' | 'consent' | 'change' | 'once'
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
  allowOnce(id: string): void
  on(event: ConsentEvent, fn: (arg?: unknown) => void): () => void
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
  const listeners: Record<ConsentEvent, Set<(arg?: unknown) => void>> = {
    'first-consent': new Set(), consent: new Set(), change: new Set(), once: new Set(),
  }
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

  // spec section 6: an optional service whose revision the visitor has not seen (new service, bumped
  // catalogRevision, or bumped site revision) stays blocked until the visitor answers the re-consent banner
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
      if (changed.includes(s.category) && !isAllowed(s.id)) leftovers.push(...unloadService(doc, s))
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
          onFirstConsent: () => { once.clear(); persist(); applyScripts(); const s = state(); emit('first-consent', s); if (s) hook(() => config.hooks.onFirstConsent?.(s)) },
          onConsent: () => { applyScripts(); const s = state(); emit('consent', s); if (s) hook(() => config.hooks.onConsent?.(s)) },
          onChange: (changed) => { once.clear(); persist(); withdraw(changed); applyScripts(); const s = state(); emit('change', changed); if (s) hook(() => config.hooks.onChange?.(s, changed)) },
          // the visitor answered the banner without changing categories: record the revisions they have now
          // seen and load what the re-consent gate was holding back
          onDecision: () => {
            const before = state()
            if (!before || !needsPrompt(before, config)) return
            persist(); applyScripts(); emit('consent', state())
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
      if (!find(id)) throw new Error(`[consent] unknown service ${id}`)
      once.add(id); emit('once', id)
    },
    on(event, fn) { listeners[event].add(fn); return () => { listeners[event].delete(fn) } },
  }
  return api
}
