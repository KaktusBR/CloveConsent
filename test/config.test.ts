import { describe, expect, test, vi } from 'vitest'
import { assertValidatedConfig, defineConsent, fromPublicJson, isValidatedConfig, toPublicJson } from '../src/config'
import { ConsentConfigError } from '../src/validate'
import { theme, youtube } from '../src/catalog'
import sk from '../src/locales/sk'

// review status is not what these tests are about: a reviewed copy keeps the dev warnings to the ones under test
const skPack = { ...sk, reviewed: true }
const input = () => ({ locales: ['sk', 'en'] as const, defaultLocale: 'sk' as const, revision: 1, services: [theme()], packs: [skPack] })

describe('defineConsent', () => {
  test('applies defaults and freezes', () => {
    const c = defineConsent({ ...input(), locales: ['sk', 'en'] })
    expect(c.cookieName).toBe('cc_cookie')
    expect(c.darkMode).toBe(true)
    expect(c.processors).toEqual([])
    expect(Object.isFrozen(c)).toBe(true)
  })
  test.each([
    ['invalid locale tag', { locales: ['sk', 'xx_yy'] }],
    ['enabled locale without translations', { locales: ['sk', 'xx'] }],
    ['default not enabled', { defaultLocale: 'de' }],
    ['bad revision', { revision: 0 }],
    ['bad cookie name', { cookieName: 'a;b' }],
    ['bad privacy href', { privacyHref: 'javascript:alert(1)' }],
    ['duplicate ids', { services: [theme(), theme()] }],
  ])('rejects %s (review focus 2)', (_n, patch) => {
    expect(() => defineConsent({ ...(input() as any), ...patch })).toThrow(ConsentConfigError)
  })
  test('warns once for custom (non-catalog) entries in dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const L = (v: string) => ({ sk: v, en: v, fr: v, de: v })
    defineConsent({ ...(input() as any), services: [{
      kind: 'first-party', id: 'branch-choice', catalogRevision: 1, lastVerified: null, category: 'functional',
      storage: [], messages: { title: L('B'), description: L('B') } }] })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0]![0])).toMatch(/not in the catalog/)
    warn.mockRestore()
  })
  const custom = () => {
    const L = (v: string) => ({ sk: v, en: v, fr: v, de: v })
    return { ...(input() as any), services: [{
      kind: 'first-party', id: 'branch-choice', catalogRevision: 1, lastVerified: null, category: 'functional',
      storage: [], messages: { title: L('B'), description: L('B') } }] }
  }
  test('does not warn when re-validating the public json at browser boot', () => {
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const json = toPublicJson(defineConsent(custom()), 'sk')
    quiet.mockClear()
    fromPublicJson(json)
    expect(quiet).not.toHaveBeenCalled()
    quiet.mockRestore()
  })
  test('does not warn in a production build (import.meta.env.DEV false)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubEnv('DEV', false)
    try {
      defineConsent(custom())
      expect(warn).not.toHaveBeenCalled()
    } finally { vi.unstubAllEnvs(); warn.mockRestore() }
  })
  test('isValidatedConfig accepts only defineConsent/fromPublicJson results', () => {
    const c = defineConsent(input() as any)
    expect(isValidatedConfig(c)).toBe(true)
    expect(isValidatedConfig(fromPublicJson(toPublicJson(c, 'sk')))).toBe(true)
    expect(isValidatedConfig({ ...c })).toBe(false)
    expect(isValidatedConfig(structuredClone(c))).toBe(false)
    expect(isValidatedConfig(null)).toBe(false)
    expect(() => assertValidatedConfig({ ...c }, 'ProcessorList')).toThrow(/ProcessorList.*defineConsent/)
    expect(() => assertValidatedConfig(c, 'ProcessorList')).not.toThrow()
  })
  test('category override works', () => {
    const c = defineConsent({ ...(input() as any), services: [youtube({ category: 'marketing' })] })
    expect((c.services[0] as any).category).toBe('marketing')
  })
})

describe('public json', () => {
  test('round-trips without hooks and escapes <', () => {
    const c = defineConsent({ ...(input() as any), hooks: { onConsent() {} } })
    const json = toPublicJson(c, 'sk')
    expect(json).not.toContain('<')
    expect(json).not.toContain('onConsent')
    expect(fromPublicJson(json).services[0]!.id).toBe('theme')
  })
  test('config without privacyHref round-trips (null stored)', () => {
    const c = defineConsent(input() as any)
    expect(c.privacyHref).toBeNull()
    const back = fromPublicJson(toPublicJson(c, 'sk'))
    expect(back.privacyHref).toBeNull()
    expect(back.services[0]!.id).toBe('theme')
  })
  test('fromPublicJson re-validates tampered input', () => {
    const c = defineConsent(input() as any)
    const tampered = JSON.parse(toPublicJson(c, 'sk'))
    tampered.services[0].messages.title.sk = '<script>'
    expect(() => fromPublicJson(JSON.stringify(tampered))).toThrow(ConsentConfigError)
  })
})

describe('immutability', () => {
  test('config is isolated from caller objects and deeply frozen', () => {
    const preset = youtube()
    const c = defineConsent({ ...(input() as any), services: [preset] })
    preset.origins.push('evil.example')
    ;(preset.messages.title as any).sk = 'changed'
    const s = c.services[0] as any
    expect(s.origins).toEqual(['www.youtube-nocookie.com'])
    expect(s.messages.title.sk).toBe('Videá YouTube')
    expect(Object.isFrozen(s)).toBe(true)
    expect(Object.isFrozen(s.origins)).toBe(true)
    expect(Object.isFrozen(s.messages.title)).toBe(true)
    expect(() => { 'use strict'; s.origins.push('x') }).toThrow(TypeError)
    expect(() => { 'use strict'; s.messages.title.sk = 'x' }).toThrow(TypeError)
    expect(Object.isFrozen(c.hooks)).toBe(true)
  })
  test('storage mutation of the original does not leak', () => {
    const preset = theme()
    const c = defineConsent({ ...(input() as any), services: [preset] })
    preset.storage.push({ ...preset.storage[0]!, name: 'evil' })
    expect((c.services[0] as any).storage).toHaveLength(1)
  })
})

describe('non-ConsentConfigError failures', () => {
  test.each([['{{{'], ['[]'], ['null'], ['{"locales":["sk"],"defaultLocale":"sk","revision":1}']])('fromPublicJson rejects %s', (j) => {
    expect(() => fromPublicJson(j)).toThrow(ConsentConfigError)
  })
  test('processors not an array', () => {
    expect(() => defineConsent({ ...(input() as any), processors: 'x' })).toThrow(ConsentConfigError)
    expect(() => fromPublicJson(JSON.stringify({ ...input(), processors: 'x' }))).toThrow(ConsentConfigError)
  })
  test('services not an array (direct)', () => {
    expect(() => defineConsent({ ...(input() as any), services: 'x' })).toThrow(ConsentConfigError)
  })
  test('oversized input rejected', () => {
    expect(() => fromPublicJson(' '.repeat(200_001))).toThrow(ConsentConfigError)
  })
})

describe('public json escaping', () => {
  test('no raw <, > or & (& via text; < > rejected by validator)', () => {
    const t = { ...theme(), id: 'amp-test', fromCatalog: false as const }
    ;(t.messages.title as any).sk = 'A & B'
    // a custom id is not in the sk pack, so it carries its own Slovak texts
    ;(t.messages.description as any).sk = 'Popis'
    ;(t.storage[0]!.expiry as any).sk = 'Trvalo'
    ;(t.storage[0]!.purpose as any).sk = 'Účel'
    const c = defineConsent({ ...(input() as any), services: [t] })
    const json = toPublicJson(c, 'sk')
    expect(json).not.toMatch(/[<>&]/)
    expect((fromPublicJson(json).services[0] as any).messages.title.sk).toBe('A & B')
  })
})

test.each([null, 5, 'x', []])('a %j entry gives a ConsentConfigError, not a TypeError', (bad) => {
  const mk = (over: object) => () => defineConsent({ ...(input() as any), ...over })
  expect(mk({ services: [bad] })).toThrow(ConsentConfigError)
  expect(mk({ processors: [bad] })).toThrow(ConsentConfigError)
})
