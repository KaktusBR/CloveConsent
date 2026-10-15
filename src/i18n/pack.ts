import { MESSAGE_KEYS, type Messages } from '../messages'
import { canonicalLocale } from './locale'
import { ConsentConfigError, ID_PATTERN, STORAGE_NAME_PATTERN, assertText } from '../validate'

/** The translation of one catalog entry's texts, mirroring the entry's field names. */
export interface EntryTranslation {
  title?: string
  description?: string
  purpose?: string
  location?: string
  transfers?: string
  dataCategories?: string[]
  storage?: Record<string, { expiry?: string; purpose?: string }>
}

/** All texts of one language: banner messages plus catalog translations. May be partial; coverage is judged per site. */
export interface LocalePack {
  locale: string
  reviewed: boolean
  messages: Partial<Messages>
  catalog: Record<string, EntryTranslation>
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function onlyKeys(o: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) throw new ConsentConfigError(`${path}.${k}`, `unknown key (allowed: ${allowed.join(', ')})`)
  }
}

export function validatePack(p: unknown, path: string): asserts p is LocalePack {
  if (!isObject(p)) throw new ConsentConfigError(path, 'must be an object')
  onlyKeys(p, ['locale', 'reviewed', 'messages', 'catalog'], path)
  const canonical = canonicalLocale(p.locale)
  if (canonical === null || canonical !== p.locale) {
    throw new ConsentConfigError(`${path}.locale`, 'must be a valid, canonical language tag such as "sk" or "pt-BR"')
  }
  if (typeof p.reviewed !== 'boolean') throw new ConsentConfigError(`${path}.reviewed`, 'must be true or false')

  const messages = p.messages ?? {}
  if (!isObject(messages)) throw new ConsentConfigError(`${path}.messages`, 'must be an object')
  for (const key of Object.keys(messages)) {
    if (!(MESSAGE_KEYS as readonly string[]).includes(key)) throw new ConsentConfigError(`${path}.messages.${key}`, 'unknown message key')
    assertText(messages[key], `${path}.messages.${key}`)
  }

  const catalog = p.catalog ?? {}
  if (!isObject(catalog)) throw new ConsentConfigError(`${path}.catalog`, 'must be an object')
  for (const id of Object.keys(catalog)) {
    const cp = `${path}.catalog.${id}`
    if (!ID_PATTERN.test(id)) throw new ConsentConfigError(cp, 'entry id must match ^[a-z0-9-]{1,48}$')
    const t = catalog[id]
    if (!isObject(t)) throw new ConsentConfigError(cp, 'must be an object')
    onlyKeys(t, ['title', 'description', 'purpose', 'location', 'transfers', 'dataCategories', 'storage'], cp)
    for (const f of ['title', 'description', 'purpose', 'location', 'transfers'] as const) {
      if (Object.hasOwn(t, f)) assertText(t[f], `${cp}.${f}`)
    }
    if (Object.hasOwn(t, 'dataCategories')) {
      if (!Array.isArray(t.dataCategories)) throw new ConsentConfigError(`${cp}.dataCategories`, 'must be an array')
      t.dataCategories.forEach((d, i) => assertText(d, `${cp}.dataCategories[${i}]`))
    }
    if (Object.hasOwn(t, 'storage')) {
      if (!isObject(t.storage)) throw new ConsentConfigError(`${cp}.storage`, 'must be an object keyed by storage name')
      for (const name of Object.keys(t.storage)) {
        const sp = `${cp}.storage.${name}`
        if (!STORAGE_NAME_PATTERN.test(name)) throw new ConsentConfigError(sp, 'invalid storage name')
        const s = t.storage[name]
        if (!isObject(s)) throw new ConsentConfigError(sp, 'must be an object')
        onlyKeys(s, ['expiry', 'purpose'], sp)
        for (const f of ['expiry', 'purpose'] as const) if (Object.hasOwn(s, f)) assertText(s[f], `${sp}.${f}`)
      }
    }
  }
}
