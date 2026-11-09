import { expect, test } from 'vitest'
import { cspSources } from '../src/csp'
import { defineConsent } from '../src/config'
import { theme, turnstile, youtube } from '../src/catalog'
import sk from '../src/locales/sk'

test('collects hosts per directive from selected services only', () => {
  const c = defineConsent({ locales: ['sk'], defaultLocale: 'sk', packs: [sk], revision: 1, services: [turnstile(), youtube(), theme()] })
  expect(cspSources(c)).toEqual({
    'script-src': ['challenges.cloudflare.com'],
    'frame-src': ['challenges.cloudflare.com', 'www.youtube-nocookie.com'],
    'connect-src': [], 'img-src': [],
  })
})
test('no client services gives empty lists', () => {
  const c = defineConsent({ locales: ['sk'], defaultLocale: 'sk', packs: [sk], revision: 1, services: [theme()] })
  expect(cspSources(c)['frame-src']).toEqual([])
})
test('script host is still derived from src when the script has a setup step', () => {
  const y = { ...youtube(), id: 'ga', origins: ['www.googletagmanager.com'], gating: { type: 'script' as const, src: 'https://www.googletagmanager.com/gtag/js?id=G-ABCD1234', init: { kind: 'gtag' as const, id: 'G-ABCD1234' } }, csp: undefined }
  const c = defineConsent({ locales: ['sk'], defaultLocale: 'sk', packs: [sk], revision: 1, services: [y], allowFallback: true })
  expect(cspSources(c)['script-src']).toEqual(['www.googletagmanager.com'])
})
test('script gating adds its host to script-src', () => {
  const y = { ...youtube(), id: 'plausible', origins: ['plausible.io'], gating: { type: 'script' as const, src: 'https://plausible.io/js/s.js' }, csp: undefined }
  const c = defineConsent({ locales: ['sk'], defaultLocale: 'sk', packs: [sk], revision: 1, services: [y], allowFallback: true })
  expect(cspSources(c)['script-src']).toEqual(['plausible.io'])
})
