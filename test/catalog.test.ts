import { describe, expect, test } from 'vitest'
import * as catalog from '../src/catalog'
import { defineConsent } from '../src/config'
import { theme } from '../src/catalog'
import { cspSources } from '../src/csp'
import de from '../src/locales/de'
import fr from '../src/locales/fr'
import sk from '../src/locales/sk'
import { validateProcessor, validateService } from '../src/validate'

const services = [catalog.turnstile(), catalog.youtube(), catalog.theme(), catalog.openStreetMap(), catalog.esriImagery()]
const processors = [catalog.resend(), catalog.cloudflareCdn(), catalog.facebookGraph(),
  catalog.hosting({ name: 'Test host', privacyUrl: 'https://example.com/privacy', location: { en: 'Germany' } })]

describe('catalog (English sources, valid, flagged)', () => {
  test.each(services.map((s) => [s.id, s] as const))('service %s', (_id, s) => {
    expect(() => validateService(s, s.id)).not.toThrow()
    expect(s.fromCatalog).toBe(true)
  })
  test.each(processors.map((p) => [p.id, p] as const))('processor %s', (_id, p) => {
    expect(() => validateProcessor(p, p.id)).not.toThrow()
  })
  test('ids are unique', () => {
    const ids = [...services, ...processors].map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  test('catalog entries are English-only sources', () => {
    for (const e of [...services, ...processors]) expect(JSON.stringify(e)).not.toMatch(/"(sk|fr|de)":/)
  })
  test('theme takes a custom storage key', () => {
    expect(theme({ key: 'color-scheme' }).storage[0]!.name).toBe('color-scheme')
    expect(() => defineConsent({ locales: ['en'], defaultLocale: 'en', revision: 1, services: [theme({ key: 'a;b' })] })).toThrow(/storage name/)
  })
  // Verification status as recorded in docs/catalog-verification.md. Changing a row here means re-checking the provider docs.
  const VERIFIED = '2026-10-14'
  const expected: Record<string, string | null> = {
    'cloudflare-turnstile': null, youtube: null, theme: null, openstreetmap: null, 'esri-imagery': null,
    resend: VERIFIED, 'cloudflare-cdn': VERIFIED, 'facebook-graph': null, hosting: null,
  }
  test('lastVerified matches the recorded verification status for every entry', () => {
    const all = [...services, ...processors]
    expect(Object.keys(expected).sort()).toEqual(all.map((e) => e.id).sort())
    for (const e of all) expect(e.lastVerified, e.id).toBe(expected[e.id])
  })
  test('verified dates are valid and not in the future', () => {
    for (const e of [...services, ...processors]) {
      if (e.lastVerified === null) continue
      expect(e.lastVerified).toMatch(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/)
      expect(Date.parse(e.lastVerified)).toBeLessThanOrEqual(Date.now())
    }
  })
  test('unverified client entries say so in notes and do not claim to have no storage', () => {
    for (const s of services) {
      if (s.lastVerified !== null || s.kind !== 'client') continue
      expect(s.notes ?? '', s.id).toMatch(/UNVERIFIED/)
    }
  })
  test('no entry text asserts cookie-free operation or an EU location without source support', () => {
    const text = JSON.stringify([...services, ...processors])
    expect(text).not.toMatch(/bez cookies|no cookies|cookie-free|sans cookie|ohne Cookies/i)
    const resend = catalog.resend()
    for (const loc of Object.values(resend.location)) expect(loc).toMatch(/USA|United States|États-Unis/)
  })
  describe('map tiles', () => {
    const base = { locales: ['en'], defaultLocale: 'en', revision: 1 }
    test('OpenStreetMap uses the single tile host from the OSMF tile policy, no wildcard', () => {
      const e = catalog.openStreetMap()
      expect(e.id).toBe('openstreetmap')
      expect(e.category).toBe('media')
      expect(e.origins).toEqual(['tile.openstreetmap.org'])
      expect(e.csp).toEqual({ 'img-src': ['tile.openstreetmap.org'] })
      expect(e.provider.privacyUrl).toBe('https://osmfoundation.org/wiki/Privacy_Policy')
    })
    test('Esri imagery is a media service on its tile host', () => {
      const e = catalog.esriImagery()
      expect(e.id).toBe('esri-imagery')
      expect(e.category).toBe('media')
      expect(e.origins).toEqual(['server.arcgisonline.com'])
      expect(e.csp).toEqual({ 'img-src': ['server.arcgisonline.com'] })
    })
    test('tile services are gated by the site code (gating none) and allow a category override', () => {
      for (const e of [catalog.openStreetMap(), catalog.esriImagery()]) expect(e.gating).toEqual({ type: 'none' })
      expect(catalog.openStreetMap({ category: 'functional' }).category).toBe('functional')
      expect(catalog.esriImagery({ category: 'functional' }).category).toBe('functional')
    })
    test('their hosts reach the CSP img-src list', () => {
      const c = defineConsent({ ...base, services: [catalog.openStreetMap(), catalog.esriImagery()] })
      expect(cspSources(c)['img-src']).toEqual(['server.arcgisonline.com', 'tile.openstreetmap.org'])
    })
  })
  test.each([['sk', sk], ['fr', fr], ['de', de]] as const)('the %s pack translates every catalog service', (code, pack) => {
    expect(() => defineConsent({ locales: [code, 'en'], defaultLocale: 'en', revision: 1, packs: [pack], services })).not.toThrow()
  })
  test('report warnings (never fails)', () => {
    const now = Date.now()
    for (const e of [...services, ...processors]) {
      if (e.lastVerified === null) console.warn(`[catalog] ${e.id}: not verified against provider docs`)
      else if (now - Date.parse(e.lastVerified) > 183 * 864e5) console.warn(`[catalog] ${e.id}: lastVerified older than 6 months`)
    }
  })
})
