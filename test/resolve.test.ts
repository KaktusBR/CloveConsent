import { describe, expect, test } from 'vitest'
import { createResolver, mapEntryText, slotLabel, type Slot } from '../src/i18n/resolve'
import type { LocalePack } from '../src/i18n/pack'
import { en } from '../src/messages'

const pack = (locale: string, catalog: LocalePack['catalog'], messages: LocalePack['messages'] = {}): LocalePack =>
  ({ locale, reviewed: false, messages, catalog })
const title: Slot = { kind: 'field', field: 'title' }

const packs = new Map<string, LocalePack>([
  ['sk', pack('sk', { youtube: { title: 'Videá', storage: { yt: { expiry: 'Rok' } }, dataCategories: ['IP adresa'] } }, { acceptAll: 'Prijať všetky' })],
  ['pt', pack('pt', { youtube: { title: 'Vídeos' } }, { acceptAll: 'Aceitar tudo' })],
])
const r = createResolver(packs, new Map(), 'sk')

describe('text resolution and coverage', () => {
  test('English always resolves from the source and is covered', () => {
    expect(r.text({ en: 'Videos' }, 'youtube', title, 'en')).toEqual({ value: 'Videos', covered: true })
  })
  test('a pack supplies the language', () => {
    expect(r.text({ en: 'Videos' }, 'youtube', title, 'sk')).toEqual({ value: 'Videá', covered: true })
  })
  test('inline text wins over the pack', () => {
    expect(r.text({ en: 'Videos', sk: 'Moje videá' }, 'youtube', title, 'sk')).toEqual({ value: 'Moje videá', covered: true })
  })
  test('a regional tag is covered by its language pack', () => {
    expect(r.text({ en: 'Videos' }, 'youtube', title, 'pt-BR')).toEqual({ value: 'Vídeos', covered: true })
  })
  test('en-GB is covered by the English source', () => {
    expect(r.text({ en: 'Videos' }, 'youtube', title, 'en-GB')).toEqual({ value: 'Videos', covered: true })
  })
  test('with no pack the site default is used and is not covered', () => {
    expect(r.text({ en: 'Videos' }, 'youtube', title, 'pl')).toEqual({ value: 'Videá', covered: false })
  })
  test('with no pack and no default text it falls back to English, not covered', () => {
    expect(r.text({ en: 'Videos' }, 'other', title, 'pl')).toEqual({ value: 'Videos', covered: false })
  })
  test('storage and category slots', () => {
    expect(r.text({ en: 'Year' }, 'youtube', { kind: 'storage', name: 'yt', field: 'expiry' }, 'sk').value).toBe('Rok')
    expect(r.text({ en: 'IP address' }, 'youtube', { kind: 'category', index: 0 }, 'sk').value).toBe('IP adresa')
    expect(r.text({ en: 'IP address' }, 'youtube', { kind: 'category', index: 1 }, 'sk').covered).toBe(false)
  })
  test('an entry id that is a prototype name is just a missing entry', () => {
    expect(r.text({ en: 'x' }, 'constructor', title, 'sk')).toEqual({ value: 'x', covered: false })
  })
})

describe('banner messages', () => {
  test('pack, override and English source', () => {
    expect(r.message('acceptAll', 'sk')).toEqual({ value: 'Prijať všetky', covered: true })
    expect(r.message('acceptAll', 'en')).toEqual({ value: en.acceptAll, covered: true })
    expect(r.message('rejectAll', 'sk')).toEqual({ value: en.rejectAll, covered: false })
    const o = createResolver(packs, new Map([['sk', { acceptAll: 'Súhlasím' }]]), 'sk')
    expect(o.message('acceptAll', 'sk')).toEqual({ value: 'Súhlasím', covered: true })
  })
})

describe('mapEntryText', () => {
  const service = {
    kind: 'first-party', id: 'theme', catalogRevision: 1, lastVerified: null, category: 'functional',
    storage: [{ name: 'theme', type: 'localStorage', expiry: { en: 'forever' }, purpose: { en: 'remembers' } }],
    messages: { title: { en: 'Theme' }, description: { en: 'Saves theme' } },
  } as const
  const processor = {
    kind: 'processor', id: 'resend', catalogRevision: 1, lastVerified: null,
    provider: { name: 'Resend', privacyUrl: 'https://resend.com/legal/privacy-policy' },
    purpose: { en: 'email' }, location: { en: 'US' }, transfers: { en: 'SCC' },
    dataCategories: [{ en: 'address' }, { en: 'content' }],
  } as const

  test('visits every service slot in a fixed order', () => {
    const seen: string[] = []
    mapEntryText(structuredClone(service) as never, (v, slot) => { seen.push(slotLabel(slot)); return v })
    expect(seen).toEqual(['title', 'description', 'storage.theme.expiry', 'storage.theme.purpose'])
  })
  test('visits every processor slot, skipping an absent transfers', () => {
    const seen: string[] = []
    mapEntryText(structuredClone(processor) as never, (v, slot) => { seen.push(slotLabel(slot)); return v })
    expect(seen).toEqual(['purpose', 'location', 'transfers', 'dataCategories[0]', 'dataCategories[1]'])
    const { transfers: _t, ...noTransfers } = structuredClone(processor) as Record<string, unknown>
    const seen2: string[] = []
    mapEntryText(noTransfers as never, (v, slot) => { seen2.push(slotLabel(slot)); return v })
    expect(seen2).not.toContain('transfers')
  })
  test('returns a copy and applies the mapper', () => {
    const input = structuredClone(service)
    const out = mapEntryText(input as never, (v) => ({ ...v, sk: 'X' })) as typeof service
    expect(out.messages.title).toEqual({ en: 'Theme', sk: 'X' })
    expect(input.messages.title).toEqual({ en: 'Theme' })
  })
})
