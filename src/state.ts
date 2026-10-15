import { CATEGORIES, type Category, type ConsentConfig, type ConsentState } from './schema'

export const MAX_COOKIE_LENGTH = 4096
const ID = /^[a-z0-9-]{1,48}$/
const CONSENT_ID = /^[A-Za-z0-9-]{8,64}$/

export function readCookieValue(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return null
}

export function parseConsent(rawValue: string | null): ConsentState | null {
  if (!rawValue || rawValue.length > MAX_COOKIE_LENGTH) return null
  let json: unknown
  try { json = JSON.parse(decodeURIComponent(rawValue)) } catch { return null }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null
  const o = json as Record<string, unknown>
  if (typeof o.consentId !== 'string' || !CONSENT_ID.test(o.consentId)) return null
  if (!Array.isArray(o.categories)) return null

  const categories = new Set<Category>(['necessary'])
  for (const c of o.categories) if ((CATEGORIES as readonly unknown[]).includes(c)) categories.add(c as Category)

  const data = typeof o.data === 'object' && o.data !== null && !Array.isArray(o.data) ? (o.data as Record<string, unknown>) : {}
  const siteRevision = Number.isInteger(data.siteRevision) && (data.siteRevision as number) >= 1 ? (data.siteRevision as number) : null
  const revisions: Record<string, number> = {}
  if (typeof data.revisions === 'object' && data.revisions !== null && !Array.isArray(data.revisions)) {
    for (const [k, v] of Object.entries(data.revisions as Record<string, unknown>)) {
      if (ID.test(k) && !(k in Object.prototype) && Number.isInteger(v) && (v as number) >= 1) revisions[k] = v as number
    }
  }
  const ts = typeof o.lastConsentTimestamp === 'string' && !Number.isNaN(Date.parse(o.lastConsentTimestamp)) ? o.lastConsentTimestamp : null
  return { consentId: o.consentId, categories: [...categories], siteRevision, revisions, timestamp: ts }
}

export function needsPrompt(state: ConsentState | null, config: ConsentConfig): boolean {
  if (!state) return true
  if (state.siteRevision !== config.revision) return true
  for (const s of config.services) {
    const seen = Object.hasOwn(state.revisions, s.id) ? state.revisions[s.id] : undefined
    if (seen === undefined || seen < s.catalogRevision) return true
  }
  return false
}

export function buildStoredData(config: ConsentConfig): { siteRevision: number; revisions: Record<string, number> } {
  const revisions: Record<string, number> = {}
  for (const s of config.services) revisions[s.id] = s.catalogRevision
  return { siteRevision: config.revision, revisions }
}
