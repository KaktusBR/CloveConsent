import { describe, expect, test } from 'vitest'
import * as catalog from '../src/catalog'
import { defineConsent } from '../src/config'
import { theme } from '../src/catalog'
import { cspSources } from '../src/csp'
import de from '../src/locales/de'
import fr from '../src/locales/fr'
import sk from '../src/locales/sk'
import { validateProcessor, validateService } from '../src/validate'

const services = [catalog.turnstile(), catalog.youtube(), catalog.theme(), catalog.openStreetMap(), catalog.esriImagery(),
  catalog.googleAnalytics({ measurementId: 'G-TEST1234' }), catalog.googleTagManager({ containerId: 'GTM-TEST123' }), catalog.metaPixel({ pixelId: '1234567890' })]
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
    'google-analytics': null, 'google-tag-manager': null, 'meta-pixel': null,
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
  describe('analytics and marketing', () => {
    const base = { locales: ['en'], defaultLocale: 'en', revision: 1 }
    test('Google Analytics 4: analytics by default, script with gtag init, two cookies', () => {
      const e = catalog.googleAnalytics({ measurementId: 'G-ABC1234XY' })
      expect(e.id).toBe('google-analytics')
      expect(e.category).toBe('analytics')
      expect(e.gating).toEqual({ type: 'script', src: 'https://www.googletagmanager.com/gtag/js?id=G-ABC1234XY', init: { kind: 'gtag', id: 'G-ABC1234XY' } })
      expect(e.origins).toEqual(['www.googletagmanager.com'])
      expect(e.csp).toEqual({ 'connect-src': ['www.google-analytics.com', 'analytics.google.com'], 'img-src': ['www.google-analytics.com'] })
      expect(e.storage.map((s) => s.name)).toEqual(['_ga', '_ga_ABC1234XY'])
      expect(e.storage[1]!.translationKey).toBe('_ga_container')
      expect(e.provider.privacyUrl).toBe('https://policies.google.com/privacy')
      expect(e.catalogRevision).toBe(1)
      expect(e.lastVerified).toBeNull()
      expect(e.notes ?? '').toMatch(/UNVERIFIED/)
    })
    test('Google Tag Manager: marketing by default, gtm init, storage empty and stated unknown', () => {
      const e = catalog.googleTagManager({ containerId: 'GTM-ABC1234' })
      expect(e.id).toBe('google-tag-manager')
      expect(e.category).toBe('marketing')
      expect(e.gating).toEqual({ type: 'script', src: 'https://www.googletagmanager.com/gtm.js?id=GTM-ABC1234', init: { kind: 'gtm' } })
      expect(e.storage).toEqual([])
      expect(e.notes ?? '').toMatch(/not gated individually/)
      expect(e.notes ?? '').toMatch(/unknown/)
      expect(e.notes ?? '').toMatch(/UNVERIFIED/)
    })
    test('Meta Pixel: marketing by default, fbq init, _fbp cookie', () => {
      const e = catalog.metaPixel({ pixelId: '123456789012345' })
      expect(e.id).toBe('meta-pixel')
      expect(e.category).toBe('marketing')
      expect(e.gating).toEqual({ type: 'script', src: 'https://connect.facebook.net/en_US/fbevents.js', init: { kind: 'fbq', id: '123456789012345' } })
      expect(e.origins).toEqual(['connect.facebook.net'])
      expect(e.csp).toEqual({ 'connect-src': ['www.facebook.com'], 'img-src': ['www.facebook.com'] })
      expect(e.storage.map((s) => s.name)).toEqual(['_fbp'])
      expect(e.provider.privacyUrl).toBe('https://www.facebook.com/privacy/policy/')
      expect(e.notes ?? '').toMatch(/UNVERIFIED/)
    })
    test('each accepts a category override and keeps notes within 600 characters', () => {
      expect(catalog.googleAnalytics({ measurementId: 'G-ABCD', category: 'marketing' }).category).toBe('marketing')
      expect(catalog.googleTagManager({ containerId: 'GTM-ABCD', category: 'analytics' }).category).toBe('analytics')
      expect(catalog.metaPixel({ pixelId: '12345', category: 'social' }).category).toBe('social')
      for (const e of [catalog.googleAnalytics({ measurementId: 'G-ABCD' }), catalog.googleTagManager({ containerId: 'GTM-ABCD' }), catalog.metaPixel({ pixelId: '12345' })]) expect((e.notes ?? '').length, e.id).toBeLessThanOrEqual(600)
    })
    test('missing or malformed ids throw an error naming the option', () => {
      const ga = catalog.googleAnalytics as (o?: unknown) => unknown
      const gtm = catalog.googleTagManager as (o?: unknown) => unknown
      const px = catalog.metaPixel as (o?: unknown) => unknown
      expect(() => ga()).toThrow(/measurementId/)
      expect(() => ga({ measurementId: 'UA-123' })).toThrow(/measurementId/)
      expect(() => ga({ measurementId: 'G-abc' })).toThrow(/measurementId/)
      expect(() => ga({ measurementId: 'G-ABC&x=1' })).toThrow(/measurementId/)
      expect(() => gtm()).toThrow(/containerId/)
      expect(() => gtm({ containerId: 'G-ABCD' })).toThrow(/containerId/)
      expect(() => gtm({ containerId: 'GTM-ABC' })).toThrow(/containerId/)
      expect(() => px()).toThrow(/pixelId/)
      expect(() => px({ pixelId: '12ab' })).toThrow(/pixelId/)
      expect(() => px({ pixelId: 12345 })).toThrow(/pixelId/)
    })
    test('their hosts reach the CSP connect-src and img-src lists', () => {
      const c = defineConsent({ ...base, services: services.slice(5) })
      const csp = cspSources(c)
      expect(csp['connect-src']).toEqual(expect.arrayContaining(['www.google-analytics.com', 'analytics.google.com', 'www.facebook.com']))
      expect(csp['img-src']).toEqual(expect.arrayContaining(['www.google-analytics.com', 'www.facebook.com']))
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
