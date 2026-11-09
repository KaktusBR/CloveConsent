import type { Messages } from '../messages'
import { en } from '../messages'
import type { EntryTranslation, LocalePack } from './pack'
import { localeChain, localePrefixes } from './locale'

// `Localised` and the entry types change shape in a later task; this module only needs the text maps.
export interface LocalisedText { en: string; [locale: string]: string | undefined }

export type Slot =
  | { kind: 'field'; field: 'title' | 'description' | 'purpose' | 'location' | 'transfers' }
  // `name` is the pack lookup key: the storage item's `translationKey` when it has one, else its `name`
  | { kind: 'storage'; name: string; field: 'expiry' | 'purpose' }
  | { kind: 'category'; index: number }

export interface Resolved { value: string; covered: boolean }

export interface Resolver {
  /** Resolve one localised text of a catalog or site entry for `locale`. */
  text(src: LocalisedText, entryId: string, slot: Slot, locale: string): Resolved
  /** Resolve one banner message for `locale`. */
  message(key: keyof Messages, locale: string): Resolved
}

export function slotLabel(slot: Slot): string {
  if (slot.kind === 'field') return slot.field
  if (slot.kind === 'storage') return `storage.${slot.name}.${slot.field}`
  return `dataCategories[${slot.index}]`
}

function own<T>(o: Record<string, T> | undefined, key: string): T | undefined {
  return o !== undefined && Object.hasOwn(o, key) ? o[key] : undefined
}

function packText(t: EntryTranslation | undefined, slot: Slot): string | undefined {
  if (t === undefined) return undefined
  if (slot.kind === 'field') return own(t as Record<string, string>, slot.field)
  if (slot.kind === 'category') return Array.isArray(t.dataCategories) ? t.dataCategories[slot.index] : undefined
  const s = own(t.storage, slot.name)
  return own(s as Record<string, string> | undefined, slot.field)
}

export function createResolver(
  packs: ReadonlyMap<string, LocalePack>,
  overrides: ReadonlyMap<string, Partial<Messages>>,
  defaultLocale: string,
): Resolver {
  return {
    text(src, entryId, slot, locale) {
      const exact = new Set(localePrefixes(locale))
      for (const tag of localeChain(locale, defaultLocale)) {
        const inline = own(src as Record<string, string | undefined>, tag)
        const v = inline ?? packText(own(packs.get(tag)?.catalog, entryId), slot)
        if (typeof v === 'string') return { value: v, covered: exact.has(tag) }
      }
      throw new Error(`[consent] internal: "${entryId}" has no English text for ${slotLabel(slot)}`)
    },
    message(key, locale) {
      const exact = new Set(localePrefixes(locale))
      for (const tag of localeChain(locale, defaultLocale)) {
        const v = own(overrides.get(tag) as Record<string, string> | undefined, key)
          ?? own(packs.get(tag)?.messages as Record<string, string> | undefined, key)
          ?? (tag === 'en' ? en[key] : undefined)
        if (typeof v === 'string') return { value: v, covered: exact.has(tag) }
      }
      throw new Error(`[consent] internal: no English text for message ${key}`)
    },
  }
}

/** Return a copy of a service or processor entry with `f` applied to every localised text. Entries must already be validated. */
export function mapEntryText<T extends { kind: string }>(entry: T, f: (v: LocalisedText, slot: Slot) => LocalisedText): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const e = structuredClone(entry) as any
  const field = (name: Extract<Slot, { kind: 'field' }>['field']): Slot => ({ kind: 'field', field: name })
  if (e.kind === 'processor') {
    e.purpose = f(e.purpose, field('purpose'))
    e.location = f(e.location, field('location'))
    if (e.transfers) e.transfers = f(e.transfers, field('transfers'))
    e.dataCategories = e.dataCategories.map((d: LocalisedText, i: number) => f(d, { kind: 'category', index: i }))
  } else {
    e.messages.title = f(e.messages.title, field('title'))
    e.messages.description = f(e.messages.description, field('description'))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    e.storage = e.storage.map((s: any) => ({
      ...s,
      expiry: f(s.expiry, { kind: 'storage', name: s.translationKey ?? s.name, field: 'expiry' }),
      purpose: f(s.purpose, { kind: 'storage', name: s.translationKey ?? s.name, field: 'purpose' }),
    }))
  }
  return e as T
}
