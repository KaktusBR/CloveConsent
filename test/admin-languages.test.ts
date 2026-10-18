import { expect, test } from 'vitest'
import { cloudflareCdn, turnstile } from '../src/catalog/index'
import type { LocalePack } from '../src/i18n/pack'
import { loadPacks, orphanTranslations, textGrid } from '../admin/src/lib/languages'

const empty = (locale = 'sk'): LocalePack => ({ locale, reviewed: false, messages: {}, catalog: {} })

test('loads every shipped pack', () => {
  const packs = loadPacks()
  expect(packs.map((p) => p.pack?.locale)).toEqual(['de', 'fr', 'sk'])
  expect(packs.every((p) => p.error === null)).toBe(true)
})

test('a broken pack is reported, not thrown', () => {
  const packs = loadPacks({ 'x.ts': { default: { locale: 'xx', reviewed: 'no' } } })
  expect(packs).toHaveLength(1)
  expect(packs[0]?.pack).toBeNull()
  expect(packs[0]?.error).toContain('reviewed')
})

test('banner rows come first with sk text', () => {
  const packs = loadPacks().flatMap((p) => (p.pack ? [p.pack] : []))
  const grid = textGrid([cloudflareCdn()], packs)
  expect(grid[0]?.group).toBe('banner')
  const row = grid.find((r) => r.group === 'banner' && r.key === 'bannerTitle')
  expect(row?.en).toBe('We use cookies')
  expect(row?.translations.sk).toBe('Používame cookies')
})

test('missing translation is null', () => {
  const grid = textGrid([cloudflareCdn(), turnstile()], [empty()])
  expect(grid.length).toBeGreaterThan(0)
  expect(grid.every((r) => r.translations.sk === null)).toBe(true)
})

test('processor fields and indices', () => {
  const keys = textGrid([cloudflareCdn()], [empty()]).filter((r) => r.group === 'cloudflare-cdn').map((r) => r.key)
  for (const k of ['purpose', 'location', 'dataCategories.0', 'dataCategories.1']) expect(keys).toContain(k)
  expect(keys).not.toContain('transfers')
})

test('client rows cover title, description and storage fields', () => {
  const e = turnstile()
  const keys = textGrid([e], [empty()]).filter((r) => r.group === e.id).map((r) => r.key)
  expect(keys.slice(0, 2)).toEqual(['title', 'description'])
  for (const s of (e as { storage: { name: string }[] }).storage) {
    expect(keys).toContain(`storage.${s.name}.expiry`)
    expect(keys).toContain(`storage.${s.name}.purpose`)
  }
})

test('catalog translations are picked up per field', () => {
  const e = cloudflareCdn()
  const pack: LocalePack = { ...empty(), catalog: { [e.id]: { purpose: 'P', dataCategories: ['A'] } } }
  const rows = textGrid([e], [pack]).filter((r) => r.group === e.id)
  expect(rows.find((r) => r.key === 'purpose')?.translations.sk).toBe('P')
  expect(rows.find((r) => r.key === 'dataCategories.0')?.translations.sk).toBe('A')
  expect(rows.find((r) => r.key === 'dataCategories.1')?.translations.sk).toBeNull()
})

test('orphans', () => {
  const pack: LocalePack = { ...empty(), catalog: { ghost: { title: 'x' }, [cloudflareCdn().id]: {} } }
  expect(orphanTranslations([cloudflareCdn()], [pack])).toEqual([{ locale: 'sk', id: 'ghost' }])
})
