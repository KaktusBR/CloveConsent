import { LOCALES, type ConsentConfig, type ConsentConfigInput, type Locale } from './schema'
import { ConsentConfigError, assertUrl, validateProcessor, validateService } from './validate'
import { isDev } from './dev'

const COOKIE_NAME = /^[A-Za-z0-9_-]{1,64}$/

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v)
    for (const k of Reflect.ownKeys(v)) deepFreeze((v as Record<PropertyKey, unknown>)[k])
  }
  return v
}

export function defineConsent(input: ConsentConfigInput): ConsentConfig {
  return define(input, true)
}

// `warn` is false for fromPublicJson: the browser re-validates on every page and must stay quiet
function define(input: ConsentConfigInput, warn: boolean): ConsentConfig {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new ConsentConfigError('config', 'must be an object')
  if (!Array.isArray(input.services)) throw new ConsentConfigError('services', 'must be an array')
  if (input.processors != null && !Array.isArray(input.processors)) throw new ConsentConfigError('processors', 'must be an array')
  if (!Array.isArray(input.locales) || input.locales.length === 0) throw new ConsentConfigError('locales', 'must be a non-empty array')
  for (const l of input.locales) if (!(LOCALES as readonly string[]).includes(l)) throw new ConsentConfigError('locales', `unsupported locale ${String(l)}`)
  if (!input.locales.includes(input.defaultLocale)) throw new ConsentConfigError('defaultLocale', 'must be one of locales')
  if (!Number.isInteger(input.revision) || input.revision < 1) throw new ConsentConfigError('revision', 'must be an integer >= 1')
  const cookieName = input.cookieName ?? 'cc_cookie'
  if (!COOKIE_NAME.test(cookieName)) throw new ConsentConfigError('cookieName', 'must match ^[A-Za-z0-9_-]{1,64}$')
  if (input.privacyHref != null) assertUrl(input.privacyHref, 'privacyHref')

  const locales = input.locales as readonly Locale[]
  const seen = new Set<string>()
  const processors = input.processors ?? []
  const idOf = (e: unknown): string => (typeof e === 'object' && e !== null && typeof (e as { id?: unknown }).id === 'string' ? (e as { id: string }).id : '?')
  input.services.forEach((s, i) => validateService(s, locales, `services[${i}](${idOf(s)})`))
  processors.forEach((p, i) => validateProcessor(p, locales, `processors[${i}](${idOf(p)})`))
  for (const e of [...input.services, ...processors]) {
    if (seen.has(e.id)) throw new ConsentConfigError('services', `duplicate id ${e.id}`)
    seen.add(e.id)
  }
  for (const s of input.services) {
    if (warn && !s.fromCatalog && isDev()) console.warn(`[consent] "${s.id}" is not in the catalog; consider adding it upstream.`)
  }
  const config: ConsentConfig = deepFreeze({
    locales: [...locales], defaultLocale: input.defaultLocale, revision: input.revision,
    cookieName, darkMode: input.darkMode ?? true, privacyHref: input.privacyHref ?? null,
    services: structuredClone(input.services), processors: structuredClone(processors),
    hooks: { ...input.hooks },
  })
  validated.add(config)
  return config
}

// Configs produced by defineConsent/fromPublicJson (deep-frozen, so they cannot change afterwards).
// Components that render hrefs or embeds refuse anything else, e.g. a hand-written object typed as ConsentConfig.
const validated = new WeakSet<object>()
export function isValidatedConfig(config: unknown): boolean {
  return typeof config === 'object' && config !== null && validated.has(config)
}
export function assertValidatedConfig(config: unknown, component: string): asserts config is ConsentConfig {
  if (!isValidatedConfig(config)) {
    throw new ConsentConfigError('config', `${component}: config must be the result of defineConsent() (got an unvalidated object)`)
  }
}

export function toPublicJson(config: ConsentConfig): string {
  const { hooks: _hooks, ...rest } = config
  return JSON.stringify(rest).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
}

export function fromPublicJson(json: string): ConsentConfig {
  if (json.length > 200_000) throw new ConsentConfigError('config', 'too large')
  let raw: unknown
  try { raw = JSON.parse(json) } catch { throw new ConsentConfigError('config', 'malformed JSON') }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new ConsentConfigError('config', 'must be a JSON object')
  return define({ ...(raw as ConsentConfigInput), hooks: undefined }, false)
}
