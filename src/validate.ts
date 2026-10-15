import { CATEGORIES, LOCALES, type Locale, type ProcessorEntry, type ServiceEntry } from './schema'

export class ConsentConfigError extends Error {
  constructor(path: string, message: string) {
    super(`[consent] ${path}: ${message}`)
    this.name = 'ConsentConfigError'
  }
}

const FORBIDDEN_TEXT = /[<>\u0000-\u001F\u007F]/
const ID = /^[a-z0-9-]{1,48}$/
const STORAGE_NAME = /^[A-Za-z0-9_.-]{1,128}$/
const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/

export function assertText(v: unknown, path: string, opts: { max?: number } = {}): asserts v is string {
  const max = opts.max ?? 600
  if (typeof v !== 'string' || v.trim() === '') throw new ConsentConfigError(path, 'must be a non-empty string')
  if (v.length > max) throw new ConsentConfigError(path, `must be at most ${max} characters`)
  if (FORBIDDEN_TEXT.test(v)) throw new ConsentConfigError(path, 'must be plain text (no < > or control characters)')
}

export function assertUrl(v: unknown, path: string): asserts v is string {
  assertText(v, path, { max: 2000 })
  if (/[\u0000-\u0020\u007F]/.test(v)) throw new ConsentConfigError(path, 'must not contain spaces or control characters')
  if (v.startsWith('/')) {
    if (v.startsWith('//') || v.includes('\\')) throw new ConsentConfigError(path, 'path must start with a single /')
    return
  }
  let u: URL
  try { u = new URL(v) } catch { throw new ConsentConfigError(path, 'must be an https URL or a / path') }
  if (u.protocol !== 'https:') throw new ConsentConfigError(path, 'URL must use https')
  if (u.username || u.password) throw new ConsentConfigError(path, 'URL must not contain credentials')
  if (!u.hostname) throw new ConsentConfigError(path, 'URL needs a host')
}

export function assertHost(v: unknown, path: string): asserts v is string {
  if (typeof v !== 'string' || !HOST.test(v)) throw new ConsentConfigError(path, 'must be a lowercase hostname such as www.example.com')
}

export function assertLocalised(v: unknown, path: string, locales: readonly Locale[]): void {
  if (typeof v !== 'object' || v === null) throw new ConsentConfigError(path, 'must be an object with one string per locale')
  for (const l of locales) assertText((v as Record<string, unknown>)[l], `${path}.${l}`)
}

function assertStorage(items: unknown, locales: readonly Locale[], path: string): void {
  if (!Array.isArray(items)) throw new ConsentConfigError(path, 'must be an array')
  items.forEach((s, i) => {
    const p = `${path}[${i}]`
    if (typeof s?.name !== 'string' || !STORAGE_NAME.test(s.name)) throw new ConsentConfigError(`${p}.name`, 'invalid storage name')
    if (!['cookie', 'localStorage', 'sessionStorage'].includes(s.type)) throw new ConsentConfigError(`${p}.type`, 'invalid storage type')
    assertLocalised(s.expiry, `${p}.expiry`, locales)
    assertLocalised(s.purpose, `${p}.purpose`, locales)
  })
}

function assertCommon(e: any, path: string): void {
  if (typeof e?.id !== 'string' || !ID.test(e.id)) throw new ConsentConfigError(`${path}.id`, 'id must match ^[a-z0-9-]{1,48}$')
  if (!Number.isInteger(e.catalogRevision) || e.catalogRevision < 1) throw new ConsentConfigError(`${path}.catalogRevision`, 'must be an integer >= 1')
  if (e.lastVerified !== null && !(typeof e.lastVerified === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.lastVerified))) {
    throw new ConsentConfigError(`${path}.lastVerified`, 'must be null or YYYY-MM-DD')
  }
  if (e.unreviewed !== undefined) {
    if (!Array.isArray(e.unreviewed) || !e.unreviewed.every((l: unknown) => (LOCALES as readonly unknown[]).includes(l))) {
      throw new ConsentConfigError(`${path}.unreviewed`, 'must be an array of known locales')
    }
  }
}

export function validateService(e: ServiceEntry, locales: readonly Locale[], path: string): void {
  assertCommon(e, path)
  if (e.kind !== 'client' && e.kind !== 'first-party') throw new ConsentConfigError(`${path}.kind`, 'must be client or first-party')
  if (!(CATEGORIES as readonly string[]).includes(e.category)) throw new ConsentConfigError(`${path}.category`, 'unknown category')
  assertLocalised(e.messages?.title, `${path}.messages.title`, locales)
  assertLocalised(e.messages?.description, `${path}.messages.description`, locales)
  assertStorage(e.storage, locales, `${path}.storage`)
  if (e.kind === 'first-party') return

  assertText(e.provider?.name, `${path}.provider.name`, { max: 100 })
  assertUrl(e.provider?.privacyUrl, `${path}.provider.privacyUrl`)
  if (!Array.isArray(e.origins)) throw new ConsentConfigError(`${path}.origins`, 'must be an array')
  e.origins.forEach((h, i) => assertHost(h, `${path}.origins[${i}]`))
  if (e.notes !== undefined) assertText(e.notes, `${path}.notes`)
  if (e.csp !== undefined && (typeof e.csp !== 'object' || e.csp === null || Array.isArray(e.csp))) {
    throw new ConsentConfigError(`${path}.csp`, 'must be an object')
  }
  for (const [dir, hosts] of Object.entries(e.csp ?? {})) {
    if (!['script-src', 'frame-src', 'connect-src', 'img-src'].includes(dir)) throw new ConsentConfigError(`${path}.csp`, `unknown directive ${dir}`)
    if (!Array.isArray(hosts)) throw new ConsentConfigError(`${path}.csp.${dir}`, 'must be an array')
    ;(hosts as unknown[]).forEach((h, i) => assertHost(h, `${path}.csp.${dir}[${i}]`))
  }
  const g = e.gating
  if (!g || !['none', 'script', 'iframe'].includes(g.type)) throw new ConsentConfigError(`${path}.gating`, 'invalid gating')
  if (g.type === 'script') {
    assertUrl(g.src, `${path}.gating.src`)
    let u: URL
    try { u = new URL(g.src) } catch { throw new ConsentConfigError(`${path}.gating.src`, 'must be an absolute https URL') }
    if (u.host !== u.hostname) throw new ConsentConfigError(`${path}.gating.src`, 'must not specify a port')
    const host = u.hostname
    if (!e.origins.includes(host)) throw new ConsentConfigError(`${path}.gating.src`, `host ${host} is not in origins`)
  }
  if (g.type === 'iframe' && g.sandbox !== undefined) {
    if (typeof g.sandbox !== 'string' || g.sandbox.length > 300 || !/^[a-z-]+( [a-z-]+)*$/.test(g.sandbox)) {
      throw new ConsentConfigError(`${path}.gating.sandbox`, 'must be space-separated sandbox tokens')
    }
  }
}

export function validateProcessor(e: ProcessorEntry, locales: readonly Locale[], path: string): void {
  assertCommon(e, path)
  if (e.kind !== 'processor') throw new ConsentConfigError(`${path}.kind`, 'must be processor')
  assertText(e.provider?.name, `${path}.provider.name`, { max: 100 })
  assertUrl(e.provider?.privacyUrl, `${path}.provider.privacyUrl`)
  assertLocalised(e.purpose, `${path}.purpose`, locales)
  assertLocalised(e.location, `${path}.location`, locales)
  if (!Array.isArray(e.dataCategories)) throw new ConsentConfigError(`${path}.dataCategories`, 'must be an array')
  e.dataCategories.forEach((d, i) => assertLocalised(d, `${path}.dataCategories[${i}]`, locales))
  if (e.dpaUrl !== undefined) assertUrl(e.dpaUrl, `${path}.dpaUrl`)
  if (e.transfers !== undefined) assertLocalised(e.transfers, `${path}.transfers`, locales)
}
