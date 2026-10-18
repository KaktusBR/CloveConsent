/// <reference types="vite/client" />
import { MESSAGE_KEYS, en as englishMessages } from '../../../src/messages'
import { validatePack, type EntryTranslation, type LocalePack } from '../../../src/i18n/pack'
import type { Entry } from './catalog'

export interface PackInfo { file: string; pack: LocalePack | null; error: string | null }

// Eager glob so a new src/locales/*.ts file shows up with no admin change
const shipped = import.meta.glob('../../../src/locales/*.ts', { eager: true }) as Record<string, unknown>

export function loadPacks(mods: Record<string, unknown> = shipped): PackInfo[] {
  const infos = Object.keys(mods).map((file): PackInfo => {
    try {
      const value = (mods[file] as { default?: unknown } | undefined)?.default
      validatePack(value, file)
      return { file, pack: value, error: null }
    } catch (e) {
      return { file, pack: null, error: e instanceof Error ? e.message : String(e) }
    }
  })
  const sortKey = (p: PackInfo) => p.pack?.locale ?? p.file
  return infos.sort((a, b) => sortKey(a).localeCompare(sortKey(b)))
}

export interface TextRow { group: string; key: string; en: string; translations: Record<string, string | null> }

type Loc = { en: string }

export function textGrid(entries: Entry[], packs: LocalePack[]): TextRow[] {
  const rows: TextRow[] = []
  const add = (group: string, key: string, en: string, pick: (t: EntryTranslation | undefined, p: LocalePack) => string | undefined, fromMessages = false) => {
    const translations: Record<string, string | null> = {}
    for (const p of packs) translations[p.locale] = (fromMessages ? (p.messages as Record<string, string | undefined>)[key] : pick(p.catalog[group], p)) ?? null
    rows.push({ group, key, en, translations })
  }
  for (const key of MESSAGE_KEYS) add('banner', key, englishMessages[key], () => undefined, true)
  for (const e of entries) {
    const id = e.id
    if (e.kind === 'processor') {
      add(id, 'purpose', e.purpose.en, (t) => t?.purpose)
      add(id, 'location', e.location.en, (t) => t?.location)
      if (e.transfers) add(id, 'transfers', e.transfers.en, (t) => t?.transfers)
      e.dataCategories.forEach((d: Loc, i) => add(id, `dataCategories.${i}`, d.en, (t) => t?.dataCategories?.[i]))
    } else {
      add(id, 'title', e.messages.title.en, (t) => t?.title)
      add(id, 'description', e.messages.description.en, (t) => t?.description)
      for (const s of e.storage) {
        add(id, `storage.${s.name}.expiry`, s.expiry.en, (t) => t?.storage?.[s.name]?.expiry)
        add(id, `storage.${s.name}.purpose`, s.purpose.en, (t) => t?.storage?.[s.name]?.purpose)
      }
    }
  }
  return rows
}

export function orphanTranslations(entries: Entry[], packs: LocalePack[]): { locale: string; id: string }[] {
  const ids = new Set(entries.map((e) => e.id))
  return packs.flatMap((p) => Object.keys(p.catalog).filter((id) => !ids.has(id)).map((id) => ({ locale: p.locale, id })))
}
