import { hasOwn } from './has-own'
import { MESSAGE_KEYS, type Messages } from './messages'
import { canonicalLocale, localePrefixes } from './i18n/locale'
import { validatePack, type LocalePack } from './i18n/pack'
import { createResolver, mapEntryText, slotLabel, type LocalisedText, type Slot } from './i18n/resolve'
import type { ConsentConfig, ConsentConfigInput, Localised } from './schema'
import { ConsentConfigError, assertHost, assertText, assertUrl, endpointProblem, validateProcessor, validateService } from './validate'
import { MAX_COOKIE_LENGTH, maxCookieBytes } from './state'
import { isDev } from './dev'
import { resolveUi } from './ui-settings'

const COOKIE_NAME = /^[A-Za-z0-9_-]{1,64}$/
const MAX_JSON = 200_000
const MAX_LISTED = 25

function deepFreeze<T>(v: T): T {
  if (v !== null && typeof v === 'object' && !Object.isFrozen(v)) {
    Object.freeze(v)
    for (const k of Reflect.ownKeys(v)) deepFreeze((v as Record<PropertyKey, unknown>)[k])
  }
  return v
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const idOf = (e: unknown): string => (isObject(e) && typeof e.id === 'string' ? e.id : '?')

function canonicalList(v: unknown, path: string): string[] {
  if (!Array.isArray(v) || v.length === 0) throw new ConsentConfigError(path, 'must be a non-empty array of language tags')
  const out = v.map((l, i) => {
    const c = canonicalLocale(l)
    if (c === null) throw new ConsentConfigError(`${path}[${i}]`, `${JSON.stringify(l)} is not a valid language tag (examples: en, sk, pt-BR)`)
    return c
  })
  if (new Set(out).size !== out.length) throw new ConsentConfigError(path, 'contains the same language twice')
  return out
}

function validateRecords(v: unknown): { url: string } {
  if (!isObject(v)) throw new ConsentConfigError('records', 'must be an object with a url')
  for (const k of Object.keys(v)) if (k !== 'url') throw new ConsentConfigError(`records.${k}`, 'unknown key')
  assertText(v.url, 'records.url', { max: 2000 })
  const problem = endpointProblem(v.url, null)
  if (problem) throw new ConsentConfigError('records.url', problem)
  return { url: v.url }
}

export function defineConsent(input: ConsentConfigInput): ConsentConfig {
  return define(input, true)
}

// `warn` is false for fromPublicJson: the browser re-validates on every page and must stay quiet
function define(input: ConsentConfigInput, warn: boolean): ConsentConfig {
  if (!isObject(input)) throw new ConsentConfigError('config', 'must be an object')
  if (!Array.isArray(input.services)) throw new ConsentConfigError('services', 'must be an array')
  if (input.processors != null && !Array.isArray(input.processors)) throw new ConsentConfigError('processors', 'must be an array')
  const locales = canonicalList(input.locales, 'locales')
  const defaultLocale = canonicalLocale(input.defaultLocale)
  if (defaultLocale === null || !locales.includes(defaultLocale)) throw new ConsentConfigError('defaultLocale', 'must be one of locales')
  if (!Number.isInteger(input.revision) || input.revision < 1) throw new ConsentConfigError('revision', 'must be an integer >= 1')
  const cookieName = input.cookieName ?? 'cc_cookie'
  if (!COOKIE_NAME.test(cookieName)) throw new ConsentConfigError('cookieName', 'must match ^[A-Za-z0-9_-]{1,64}$')
  if (input.privacyHref != null) assertUrl(input.privacyHref, 'privacyHref')
  if (input.cookieDomain != null) assertHost(input.cookieDomain, 'cookieDomain')
  const records = input.records == null ? null : validateRecords(input.records)

  // language packs: every pack is validated before it is used
  const packs = new Map<string, LocalePack>()
  if (input.packs != null) {
    if (!Array.isArray(input.packs)) throw new ConsentConfigError('packs', 'must be an array')
    input.packs.forEach((p, i) => {
      validatePack(p, `packs[${i}]`)
      if (packs.has(p.locale)) throw new ConsentConfigError(`packs[${i}]`, `two packs for ${p.locale}`)
      packs.set(p.locale, p)
    })
  }
  // per-language banner text overrides
  const overrides = new Map<string, Partial<Messages>>()
  if (input.messages != null) {
    if (!isObject(input.messages)) throw new ConsentConfigError('messages', 'must be an object keyed by language tag')
    for (const key of Object.keys(input.messages)) {
      if (canonicalLocale(key) !== key) throw new ConsentConfigError(`messages.${key}`, 'key must be a valid, canonical language tag')
      const m = (input.messages as Record<string, unknown>)[key]
      if (!isObject(m)) throw new ConsentConfigError(`messages.${key}`, 'must be an object of banner texts')
      for (const k of Object.keys(m)) {
        if (!(MESSAGE_KEYS as readonly string[]).includes(k)) throw new ConsentConfigError(`messages.${key}.${k}`, 'unknown message key')
        assertText(m[k], `messages.${key}.${k}`)
      }
      overrides.set(key, m as Partial<Messages>)
    }
  }

  // entries
  const processors = input.processors ?? []
  input.services.forEach((s, i) => validateService(s, `services[${i}](${idOf(s)})`))
  processors.forEach((p, i) => validateProcessor(p, `processors[${i}](${idOf(p)})`))
  const seen = new Set<string>()
  for (const e of [...input.services, ...processors]) {
    if (seen.has(e.id)) throw new ConsentConfigError('services', `duplicate id ${e.id}`)
    seen.add(e.id)
  }
  for (const s of input.services) {
    if (warn && !s.fromCatalog && isDev()) console.warn(`[consent] "${s.id}" is not in the catalog; consider adding it upstream.`)
  }

  // resolve every text for every enabled language; collect what had to fall back
  const resolver = createResolver(packs, overrides, defaultLocale)
  const missing: string[] = []
  const fill = (id: string) => (v: LocalisedText, slot: Slot): Localised => {
    const out: Localised = { en: v.en }
    for (const l of locales) {
      const r = resolver.text(v, id, slot, l)
      out[l] = r.value
      if (!r.covered) missing.push(`${l}: ${id} ${slotLabel(slot)}`)
    }
    return out
  }
  const services = input.services.map((s) => mapEntryText(s, fill(s.id)))
  const resolvedProcessors = processors.map((p) => mapEntryText(p, fill(p.id)))
  const messages: Record<string, Messages> = {}
  for (const l of locales) {
    const m: Record<string, string> = {}
    for (const key of MESSAGE_KEYS) {
      const r = resolver.message(key, l)
      m[key] = r.value
      if (!r.covered) missing.push(`${l}: messages.${key}`)
    }
    messages[l] = m as unknown as Messages
  }
  if (missing.length > 0) {
    const listed = missing.slice(0, MAX_LISTED).join('\n  ') + (missing.length > MAX_LISTED ? `\n  ... and ${missing.length - MAX_LISTED} more` : '')
    if (!input.allowFallback) {
      throw new ConsentConfigError('locales', `missing translations. Add them to a language pack, or set allowFallback: true to show the fallback language instead:\n  ${listed}`)
    }
    if (warn && isDev()) console.warn(`[consent] missing translations, showing the fallback language:\n  ${listed}`)
  }
  const unreviewed = locales.filter((l) => l !== 'en' && localePrefixes(l).some((t) => packs.get(t)?.reviewed === false))
  if (warn && isDev() && unreviewed.length > 0) console.warn(`[consent] unreviewed translations in use for: ${unreviewed.join(', ')}`)

  const config: ConsentConfig = {
    locales, defaultLocale, revision: input.revision,
    cookieName, cookieDomain: input.cookieDomain ?? null, records,
    darkMode: input.darkMode ?? true, privacyHref: input.privacyHref ?? null,
    services, processors: resolvedProcessors, hooks: { ...input.hooks },
    messages, unreviewed, ui: resolveUi(input.ui, 'ui'),
  }
  const cookieBytes = maxCookieBytes(config)
  if (cookieBytes > MAX_COOKIE_LENGTH) {
    throw new ConsentConfigError('services', `with every service accepted the consent cookie would take up to ${cookieBytes} bytes, over the ${MAX_COOKIE_LENGTH}-byte limit browsers allow. Use fewer services or shorter ids, or turn off ui.manager.serviceToggles`)
  }
  deepFreeze(config)
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

/**
 * The browser's copy of the config, reduced to ONE language: each text keeps `en` plus the chosen language, and the
 * banner texts of that language travel as `messages`. Safe to place inside a <script type="application/json"> tag.
 */
export function toPublicJson(config: ConsentConfig, locale: string): string {
  const l = config.locales.includes(locale) ? locale : config.defaultLocale
  const keep = (v: LocalisedText): LocalisedText => (l === 'en' ? { en: v.en } : { en: v.en, [l]: hasOwn(v, l) ? v[l] : v.en })
  const { hooks: _hooks, unreviewed: _unreviewed, messages, ...rest } = config
  const snapshot = {
    ...rest, locales: [l], defaultLocale: l,
    services: config.services.map((s) => mapEntryText(s, keep)),
    processors: config.processors.map((p) => mapEntryText(p, keep)),
    messages: { [l]: messages[l] },
  }
  return JSON.stringify(snapshot).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
}

export function fromPublicJson(json: string): ConsentConfig {
  if (json.length > MAX_JSON) throw new ConsentConfigError('config', 'too large')
  let raw: unknown
  try { raw = JSON.parse(json) } catch { throw new ConsentConfigError('config', 'malformed JSON') }
  if (!isObject(raw)) throw new ConsentConfigError('config', 'must be a JSON object')
  // a snapshot never carries packs or hooks, and is always checked strictly
  return define({ ...(raw as unknown as ConsentConfigInput), hooks: undefined, packs: undefined, allowFallback: undefined }, false)
}
