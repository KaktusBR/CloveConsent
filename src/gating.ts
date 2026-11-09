import type { ClientEntry, ScriptInit, ServiceEntry, StorageItem } from './schema'

export function hostAllowed(entry: ClientEntry, rawUrl: string): boolean {
  let u: URL
  try { u = new URL(rawUrl) } catch { return false }
  return u.protocol === 'https:' && !u.username && !u.password && entry.origins.includes(u.hostname)
}

export function createEmbed(doc: Document, entry: ClientEntry, src: string, title: string): HTMLIFrameElement {
  if (entry.gating.type !== 'iframe') throw new Error(`[consent] ${entry.id} is not an iframe service`)
  if (!hostAllowed(entry, src)) throw new Error(`[consent] embed origin not allowed for ${entry.id}: ${src}`)
  const f = doc.createElement('iframe')
  f.setAttribute('src', src)
  f.setAttribute('title', title)
  f.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin')
  f.setAttribute('loading', 'lazy')
  f.setAttribute('allowfullscreen', '')
  if (entry.gating.sandbox) f.setAttribute('sandbox', entry.gating.sandbox)
  f.dataset.consentService = entry.id
  return f
}

export function loadScript(doc: Document, entry: ClientEntry): HTMLScriptElement | null {
  if (entry.gating.type !== 'script') return null
  const src = entry.gating.src
  if (!hostAllowed(entry, src)) throw new Error(`[consent] script origin not allowed for ${entry.id}: ${src}`)
  const existing = findOwned(doc, entry.id, 'script')
  if (existing) return existing
  const win = doc.defaultView
  if (entry.gating.init && win) runScriptInit(win, entry.gating.init)
  const s = doc.createElement('script')
  s.async = true
  s.setAttribute('async', '')
  s.src = src
  s.dataset.consentService = entry.id
  doc.head.appendChild(s)
  return s
}

/**
 * Runs a declared setup step as library code, so a strict Content Security Policy (no inline scripts) keeps working.
 * Each step mirrors the vendor's standard snippet; the id has already been validated to a fixed pattern.
 */
export function runScriptInit(win: Window & typeof globalThis, init: ScriptInit): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = win as any
  if (init.kind === 'fbq') {
    if (!w.fbq) {
      // Meta's loader semantics: calls queue until fbevents.js sets callMethod
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const n: any = function (this: unknown) {
        // eslint-disable-next-line prefer-rest-params
        if (n.callMethod) n.callMethod.apply(n, arguments)
        // eslint-disable-next-line prefer-rest-params
        else n.queue.push(arguments)
      }
      w.fbq = n
      if (!w._fbq) w._fbq = n
      n.push = n
      n.loaded = true
      n.version = '2.0'
      n.queue = []
    }
    w.fbq('init', init.id)
    w.fbq('track', 'PageView')
    return
  }
  if (!Array.isArray(w.dataLayer)) w.dataLayer = []
  const layer: unknown[] = w.dataLayer
  if (init.kind === 'gtm') {
    layer.push({ 'gtm.start': Date.now(), event: 'gtm.js' })
    return
  }
  // Google's loader only recognises Arguments objects in dataLayer, so the stub must push `arguments`, not an array
  w.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    layer.push(arguments)
  }
  w.gtag('js', new Date())
  w.gtag('config', init.id)
  w[`ga-disable-${init.id}`] = false
}

const SAFE_NAME = /^[A-Za-z0-9_.-]{1,128}$/

function findAllOwned(doc: Document, id: string, tag?: 'script' | 'iframe'): HTMLElement[] {
  const out: HTMLElement[] = []
  doc.querySelectorAll<HTMLElement>('script[data-consent-service],iframe[data-consent-service]').forEach((n) => {
    if (n.dataset.consentService === id && (!tag || n.localName === tag)) out.push(n)
  })
  return out
}

function findOwned(doc: Document, id: string, tag: 'script' | 'iframe'): HTMLScriptElement | null {
  return (findAllOwned(doc, id, tag)[0] as HTMLScriptElement | undefined) ?? null
}

function cookieNames(doc: Document): Set<string> {
  const names = new Set<string>()
  for (const part of doc.cookie.split(';')) {
    const eq = part.indexOf('=')
    const n = (eq === -1 ? part : part.slice(0, eq)).trim()
    if (n) names.add(n)
  }
  return names
}

export function clearStorage(doc: Document, entry: ServiceEntry): StorageItem[] {
  const host = doc.location?.hostname ?? ''
  const domains: (string | null)[] = [null]
  if (host) {
    domains.push(host)
    const parts = host.split('.')
    for (let i = 0; i < parts.length - 1; i++) domains.push('.' + parts.slice(i).join('.'))
  }
  const secure = doc.location?.protocol === 'https:' ? '; Secure' : ''
  for (const item of entry.storage) {
    if (!SAFE_NAME.test(item.name)) continue
    try {
      if (item.type === 'localStorage') localStorage.removeItem(item.name)
      else if (item.type === 'sessionStorage') sessionStorage.removeItem(item.name)
      else for (const d of domains) doc.cookie = `${item.name}=; Max-Age=0; Path=/${d ? `; Domain=${d}` : ''}${secure}`
    } catch { /* blocked storage: reported below */ }
  }
  const present = cookieNames(doc)
  return entry.storage.filter((s) => {
    if (s.type === 'cookie') return present.has(s.name)
    try { return (s.type === 'localStorage' ? localStorage : sessionStorage).getItem(s.name) !== null } catch { return false }
  })
}

export function unloadService(doc: Document, entry: ServiceEntry): StorageItem[] {
  findAllOwned(doc, entry.id).forEach((n) => n.remove())
  // Google's documented opt-out switch: stops an already loaded gtag.js from measuring or setting cookies
  if (entry.kind === 'client' && entry.gating.type === 'script' && entry.gating.init?.kind === 'gtag' && doc.defaultView) {
    (doc.defaultView as unknown as Record<string, unknown>)[`ga-disable-${entry.gating.init.id}`] = true
  }
  return clearStorage(doc, entry)
}
