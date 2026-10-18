import { expect, test } from 'vitest'
import { listCatalog } from '../admin/src/lib/catalog'
import { loadPacks } from '../admin/src/lib/languages'
import { DEFAULT_STATE, buildConfig, parseState, toQuery, type PlaygroundState } from '../admin/src/lib/playground'

const catalog = listCatalog()
const packs = loadPacks().flatMap((p) => (p.pack ? [p.pack] : []))
const build = (s: Partial<PlaygroundState>) => buildConfig({ ...DEFAULT_STATE, ...s }, catalog, packs)

test('round-trips state', () => {
  const custom: PlaygroundState = {
    ...DEFAULT_STATE,
    args: { hosting: '{"name":"H","privacyUrl":"https://h.example","location":{"en":"EU"}}' },
    theme: 'dark',
  }
  for (const s of [DEFAULT_STATE, custom]) expect(parseState(new URLSearchParams(toQuery(s)))).toEqual(s)
})

test('round-trips a submitted form with nothing ticked', () => {
  const s: PlaygroundState = { ...DEFAULT_STATE, services: [], processors: [], darkMode: false, allowFallback: true, privacyHref: 'https://x.example/p' }
  expect(parseState(new URLSearchParams(toQuery(s)))).toEqual(s)
})

test('empty query is the default', () => {
  expect(parseState(new URLSearchParams(''))).toEqual(DEFAULT_STATE)
})

test('default state builds', () => {
  const r = buildConfig(DEFAULT_STATE, catalog, packs)
  expect(r.error).toBeNull()
  expect(r.config?.services.map((s) => s.id)).toEqual(['cloudflare-turnstile', 'theme', 'youtube'])
})

test('a processor with no typed options uses its sample args', () => {
  const r = build({ locales: ['en'], processors: ['hosting'] })
  expect(r.error).toBeNull()
  expect(r.config?.processors.map((p) => p.id)).toContain('hosting')
})

test.each<[string, Partial<PlaygroundState>, string]>([
  ['unknown name', { services: ['nope'] }, 'unknown catalog entry: nope'],
  ['bad json', { processors: ['hosting'], args: { hosting: '{' } }, 'options for hosting are not valid JSON'],
  ['bad revision', { revision: 'abc' }, 'revision must be a whole number'],
  ['preview locale not enabled', { locales: ['en'], previewLocale: 'fr' }, 'preview language must be one of the enabled languages'],
  ['default locale not enabled', { locales: ['en'], defaultLocale: 'de' }, 'defaultLocale'],
  ['processor as service', { services: ['cloudflareCdn'] }, 'cloudflareCdn is a processor'],
  ['service as processor', { processors: ['youtube'] }, 'youtube is a service'],
])('garbage is reported: %s', (_n, s, message) => {
  const r = build(s)
  expect(r.config).toBeNull()
  expect(r.error).toContain(message)
})

test('missing pack with allowFallback warns, without it fails', () => {
  const ar = { locales: ['en', 'ar'], previewLocale: 'ar' }
  const ok = build({ ...ar, allowFallback: true })
  expect(ok.error).toBeNull()
  expect(ok.warnings.some((w) => w.includes('missing translations'))).toBe(true)
  const bad = build({ ...ar, allowFallback: false })
  expect(bad.config).toBeNull()
  expect(bad.error).toContain('missing translations')
})
