import { expect, test } from 'vitest'
import { defineConsent } from '../src/config'
import { buildView } from '../src/view'
import { hosting, resend, theme, turnstile, youtube } from '../src/catalog'
import sk from '../src/locales/sk'
import fr from '../src/locales/fr'
import de from '../src/locales/de'

const config = defineConsent({
  locales: ['sk', 'en', 'fr', 'de'], defaultLocale: 'sk', revision: 1, packs: [sk, fr, de], privacyHref: '/ochrana-udajov/',
  services: [turnstile(), theme(), youtube()],
  processors: [resend(), hosting({ name: 'H', privacyUrl: 'https://h.example/p', location: { sk: 'Nemecko', en: 'Germany', fr: 'Allemagne', de: 'Deutschland' } })],
})

test('only categories with selected entries appear, necessary first', () => {
  const v = buildView(config, 'en')
  expect(v.categories.map((c) => c.id)).toEqual(['necessary', 'functional', 'media'])
  expect(v.categories[0]!.readOnly).toBe(true)
  expect(v.categories[1]!.readOnly).toBe(false)
})
test('uses the requested locale and falls back to default for unknown', () => {
  expect(buildView(config, 'de').categories[1]!.services[0]!.title).toBe('Seitendesign')
  expect(buildView(config, 'xx' as any).locale).toBe('sk')
})
test('storage rows are localised strings', () => {
  const row = buildView(config, 'en').categories[1]!.services[0]!.storage[0]!
  expect(row).toEqual({ name: 'theme', type: 'localStorage', expiry: 'Persistent (until you delete it)', purpose: 'Remembers light or dark appearance.' })
})
test('processors carry facts only', () => {
  const p = buildView(config, 'en').processors
  expect(p.map((x) => x.id)).toEqual(['resend', 'hosting'])
  expect(p[1]!.location).toBe('Germany')
})
test('the view carries the resolved ui settings', () => {
  expect(buildView(config, 'en').ui).toEqual(config.ui)
  const custom = defineConsent({ locales: ['en'], defaultLocale: 'en', revision: 1, services: [theme()], ui: { banner: { layout: 'cloud', position: 'top' } } })
  expect(buildView(custom, 'en').ui.banner).toEqual({ layout: 'cloud', position: 'top', equalWeightButtons: true, flipButtons: false })
})
