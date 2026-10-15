import type { ClientEntry, ServiceEntry, StorageItem } from './schema'

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
  const s = doc.createElement('script')
  s.async = true
  s.setAttribute('async', '')
  s.src = src
  s.dataset.consentService = entry.id
  doc.head.appendChild(s)
  return s
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
  return clearStorage(doc, entry)
}
