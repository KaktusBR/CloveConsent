import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { defineConsent } from '../src/config'
import { cloudflareCdn, facebookGraph, hosting, resend, theme, turnstile, youtube } from '../src/catalog'
import { mapEntryText, type Slot } from '../src/i18n/resolve'
import sk from '../src/locales/sk'
import fr from '../src/locales/fr'
import de from '../src/locales/de'

const golden = JSON.parse(readFileSync('.superpowers/baseline/old-texts.json', 'utf8')) as {
  messages: Record<string, Record<string, string>>
  rows: { factory: string; id: string; slot: Slot; text: Record<string, string> }[]
}
const LOCALES = ['sk', 'en', 'fr', 'de']

const config = defineConsent({
  locales: LOCALES, defaultLocale: 'sk', revision: 1, packs: [sk, fr, de],
  services: [turnstile(), theme(), youtube()],
  processors: [
    resend(), cloudflareCdn(), facebookGraph(),
    hosting({ name: 'Test host', privacyUrl: 'https://example.com/privacy', location: { sk: 'Nemecko', en: 'Germany', fr: 'Allemagne', de: 'Deutschland' } }),
  ],
})

describe('nothing was lost in the move to language packs', () => {
  test.each(LOCALES)('banner messages in %s are identical to the old build', (l) => {
    expect(config.messages[l]).toEqual(golden.messages[l])
  })
  test('every old entry text is identical in all four languages', () => {
    const got = new Map<string, Record<string, string | undefined>>()
    for (const e of [...config.services, ...config.processors]) {
      mapEntryText(e as never, (v, slot) => { got.set(`${e.id}|${JSON.stringify(slot)}`, v); return v })
    }
    expect(got.size).toBe(golden.rows.length)
    for (const row of golden.rows) {
      const actual = got.get(`${row.id}|${JSON.stringify(row.slot)}`)
      expect(actual, `${row.id} ${JSON.stringify(row.slot)}`).toBeDefined()
      for (const l of LOCALES) expect(actual![l], `${row.id} ${JSON.stringify(row.slot)} ${l}`).toBe(row.text[l])
    }
  })
  test('all shipped packs are flagged unreviewed', () => {
    expect([sk, fr, de].map((p) => p.reviewed)).toEqual([false, false, false])
    expect(config.unreviewed).toEqual(['sk', 'fr', 'de'])
  })
})
