import { describe, expect, test, vi } from 'vitest'
import { defineConsent, fromPublicJson, toPublicJson } from '../src/config'
import { ConsentConfigError } from '../src/validate'
import { MESSAGE_KEYS, en } from '../src/messages'
import { buildView } from '../src/view'
import { resend, theme, turnstile, youtube } from '../src/catalog'
import sk from '../src/locales/sk'
import type { LocalePack } from '../src/i18n/pack'

const base = () => ({ locales: ['en'], defaultLocale: 'en', revision: 1, services: [theme()] })
const allMessages = Object.fromEntries(MESSAGE_KEYS.map((k) => [k, `x ${k}`]))
const plPack = (catalog: LocalePack['catalog'] = {}, reviewed = true): LocalePack => ({ locale: 'pl', reviewed, messages: allMessages, catalog })
const themePl = { theme: { title: 'Motyw', description: 'Zapisuje motyw.', storage: { theme: { expiry: 'Bez końca', purpose: 'Pamięta motyw.' } } } }

describe('languages', () => {
  test('English alone needs no pack', () => {
    const c = defineConsent(base())
    expect(c.messages.en).toEqual(en)
    expect(c.services[0]!.messages.title.en).toBe('Site theme')
  })
  test('a shipped pack supplies a language', () => {
    const c = defineConsent({ ...base(), locales: ['sk', 'en'], defaultLocale: 'sk', packs: [sk] })
    expect(c.services[0]!.messages.title.sk).toBe('Vzhľad stránky')
    expect(c.messages.sk!.acceptAll).toBe('Prijať všetky')
  })
  test('any language works with its own pack', () => {
    const c = defineConsent({ ...base(), locales: ['pl'], defaultLocale: 'pl', packs: [plPack(themePl)] })
    expect(c.services[0]!.messages.title.pl).toBe('Motyw')
    expect(c.messages.pl!.acceptAll).toBe('x acceptAll')
  })
  test('tags are canonicalised', () => {
    const c = defineConsent({ ...base(), locales: ['pt-br'], defaultLocale: 'pt-BR', allowFallback: true })
    expect(c.locales).toEqual(['pt-BR'])
  })
  test.each([['xx_yy'], ['__proto__'], ['constructor'], [''], ['en-'], [5], [null]])('rejects the locale %j', (bad) => {
    expect(() => defineConsent({ ...base(), locales: [bad as never], defaultLocale: 'en' })).toThrow(ConsentConfigError)
  })
  test('rejects a default locale that is not enabled, and duplicate locales', () => {
    expect(() => defineConsent({ ...base(), defaultLocale: 'sk' })).toThrow(/defaultLocale/)
    expect(() => defineConsent({ ...base(), locales: ['en', 'EN'] })).toThrow(/twice/)
  })
  test('rejects two packs for one language and invalid packs', () => {
    expect(() => defineConsent({ ...base(), locales: ['sk'], defaultLocale: 'sk', packs: [sk, sk] })).toThrow(/two packs/)
    expect(() => defineConsent({ ...base(), packs: [{ ...plPack(), reviewed: 'yes' } as never] })).toThrow(ConsentConfigError)
  })
  test('banner texts can be overridden per language', () => {
    const c = defineConsent({ ...base(), messages: { en: { acceptAll: 'Yes please' } } })
    expect(c.messages.en!.acceptAll).toBe('Yes please')
    expect(() => defineConsent({ ...base(), messages: { en: { nope: 'x' } as never } })).toThrow(/unknown message key/)
    expect(() => defineConsent({ ...base(), messages: { en: { acceptAll: '<b>' } } })).toThrow(/plain text/)
  })
  test('banner text overrides and pack messages reject control characters', () => {
    expect(() => defineConsent({ ...base(), messages: { en: { acceptAll: 'a\u0007b' } } })).toThrow(/plain text/)
    expect(() => defineConsent({ ...base(), messages: { en: { acceptAll: 'a\nb' } } })).toThrow(/plain text/)
    expect(() => defineConsent({ ...base(), locales: ['pl'], defaultLocale: 'pl', packs: [{ ...plPack(themePl), messages: { ...allMessages, close: 'x\u0000' } }] }))
      .toThrow(/packs\[0\]\.messages\.close: must be plain text/)
  })
  test('custom entries can carry their own translations', () => {
    const entry = { ...theme(), id: 'my-theme', fromCatalog: undefined, messages: { title: { en: 'Mine', pl: 'Mój' }, description: { en: 'Desc', pl: 'Opis' } },
      storage: [{ name: 'mine', type: 'localStorage' as const, expiry: { en: 'long', pl: 'długo' }, purpose: { en: 'why', pl: 'dlaczego' } }] }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const c = defineConsent({ ...base(), locales: ['pl'], defaultLocale: 'pl', services: [entry as never], packs: [plPack()] })
    warn.mockRestore()
    expect(c.services[0]!.messages.title.pl).toBe('Mój')
  })
})

describe('strict policy (Review Focus 2 and 3)', () => {
  test('a language with no pack names every missing string', () => {
    let err: Error | undefined
    try { defineConsent({ ...base(), locales: ['pl'], defaultLocale: 'pl' }) } catch (e) { err = e as Error }
    expect(err).toBeInstanceOf(ConsentConfigError)
    expect(err!.message).toMatch(/missing translations/)
    expect(err!.message).toMatch(/pl: theme title/)
    expect(err!.message).toMatch(/pl: theme storage\.theme\.expiry/)
    expect(err!.message).toMatch(/pl: messages\.acceptAll/)
  })
  test('allowFallback fills with the fallback and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const c = defineConsent({ ...base(), locales: ['en', 'pl'], defaultLocale: 'en', allowFallback: true })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toMatch(/missing translations/)
    warn.mockRestore()
    expect(c.services[0]!.messages.title.pl).toBe('Site theme')
    expect(c.messages.pl!.acceptAll).toBe(en.acceptAll)
  })
  test('entries the site does not select are never required', () => {
    expect(() => defineConsent({ ...base(), locales: ['pl'], defaultLocale: 'pl', packs: [plPack(themePl)] })).not.toThrow()
    expect(() => defineConsent({ ...base(), locales: ['pl'], defaultLocale: 'pl', packs: [plPack(themePl)], services: [theme(), youtube()] }))
      .toThrow(/pl: youtube title/)
  })
  test('a data-categories list shorter than the source leaves the extra slots missing', () => {
    const catalog = { resend: { purpose: 'a', location: 'b', transfers: 'c', dataCategories: ['one'] } }
    expect(() => defineConsent({ ...base(), locales: ['pl'], defaultLocale: 'pl', services: [turnstile()], processors: [resend()], packs: [plPack({ ...catalog, 'cloudflare-turnstile': { title: 't', description: 'd' } })] }))
      .toThrow(/pl: resend dataCategories\[1\]/)
  })
  test('unreviewed languages are reported', () => {
    expect(defineConsent({ ...base(), locales: ['sk'], defaultLocale: 'sk', packs: [sk] }).unreviewed).toEqual(['sk'])
    expect(defineConsent({ ...base(), locales: ['pl'], defaultLocale: 'pl', packs: [plPack(themePl, true)] }).unreviewed).toEqual([])
  })
})

describe('single-language snapshot (Review Focus 4)', () => {
  const config = () => defineConsent({ ...base(), locales: ['sk', 'en'], defaultLocale: 'sk', packs: [sk], services: [theme(), youtube()] })
  test('carries one language and round-trips', () => {
    const json = toPublicJson(config(), 'sk')
    const parsed = JSON.parse(json)
    expect(parsed.locales).toEqual(['sk'])
    expect(Object.keys(parsed.messages)).toEqual(['sk'])
    expect(Object.keys(parsed.services[0].messages.title).sort()).toEqual(['en', 'sk'])
    const back = fromPublicJson(json)
    expect(back.messages.sk!.acceptAll).toBe('Prijať všetky')
    expect(back.services[0]!.messages.title.sk).toBe('Vzhľad stránky')
    // one language is smaller than the full multi-language config
    expect(json.length).toBeLessThan(JSON.stringify(config()).length)
  })
  test('English snapshot has no other language', () => {
    const parsed = JSON.parse(toPublicJson(config(), 'en'))
    expect(Object.keys(parsed.services[0].messages.title)).toEqual(['en'])
  })
  test('an unknown language falls back to the default', () => {
    expect(JSON.parse(toPublicJson(config(), 'xx')).locales).toEqual(['sk'])
  })
  test('escapes < > & so it can sit in a script tag', () => {
    const c = structuredClone(config()) as any
    c.services = [structuredClone(c.services[1])]
    c.services[0].provider.name = 'A<B>&C'
    const json = toPublicJson(c, 'sk')
    expect(json).not.toMatch(/[<>&]/)
    expect(JSON.parse(json).services[0].provider.name).toBe('A<B>&C')
  })
  test('tampered snapshots are rejected', () => {
    const json = toPublicJson(config(), 'sk')
    const tamper = (f: (o: any) => void) => { const o = JSON.parse(json); f(o); return JSON.stringify(o) }
    expect(() => fromPublicJson(tamper((o) => { o.services[0].messages.title.sk = '<script>' }))).toThrow(ConsentConfigError)
    expect(() => fromPublicJson(json.replace('"en":"Site theme"', '"__proto__":"x","en":"Site theme"'))).toThrow(ConsentConfigError)
    expect(() => fromPublicJson(tamper((o) => { o.locales = ['sk', 'de']; o.defaultLocale = 'sk' }))).toThrow(/missing translations/)
    expect(() => fromPublicJson(tamper((o) => { o.packs = [plPack()] }))).not.toThrow() // packs are ignored, never trusted
    expect(() => fromPublicJson('x'.repeat(200_001))).toThrow(/too large/)
    expect(() => fromPublicJson('{{{')).toThrow(ConsentConfigError)
  })
})

describe('right-to-left (Review Focus 5)', () => {
  test('the view knows the text direction', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const c = defineConsent({ ...base(), locales: ['ar', 'sk'], defaultLocale: 'sk', packs: [sk], allowFallback: true })
    warn.mockRestore()
    expect(buildView(c, 'ar').dir).toBe('rtl')
    expect(buildView(c, 'sk').dir).toBe('ltr')
  })
})
