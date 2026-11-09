import { expect, test, vi } from 'vitest'
import { defineConsent } from '../src/config'
import { buildView } from '../src/view'
import { buildVccConfig } from '../src/driver-vcc'
import { theme, youtube } from '../src/catalog'
import sk from '../src/locales/sk'

const hooks = { onFirstConsent() {}, onConsent() {}, onChange() {}, onDecision() {} }
const view = buildView(defineConsent({ locales: ['sk'], defaultLocale: 'sk', packs: [sk], revision: 1, privacyHref: '/p/', services: [theme(), youtube()] }), 'sk')

test('cookie options follow the spec', () => {
  const c: any = buildVccConfig(view, hooks, false)
  expect(c.cookie).toMatchObject({ name: 'cc_cookie', path: '/', sameSite: 'Lax', expiresAfterDays: 182, secure: false })
  expect((buildVccConfig(view, hooks, true) as any).cookie).toMatchObject({ secure: true })
  expect(c.cookie.domain).toBeUndefined()
})
test('library revision is constant; re-consent is ours', () => {
  expect((buildVccConfig(view, hooks, false) as any).revision).toBe(0)
})
test('only selected categories are configured; necessary is read-only', () => {
  const c: any = buildVccConfig(view, hooks, false)
  expect(Object.keys(c.categories).sort()).toEqual(['functional', 'media', 'necessary'])
  expect(c.categories.necessary).toMatchObject({ enabled: true, readOnly: true })
})
test('every string passed to the library is escaped', () => {
  const evilView = structuredClone(view)
  evilView.categories[1]!.services[0]!.title = 'a&b "q"'
  evilView.categories[1]!.services[0]!.storage[0]!.name = "x'y"
  const json = JSON.stringify(buildVccConfig(evilView, hooks, false))
  expect(json).toContain('a&amp;b &quot;q&quot;')
  expect(json).toContain('x&#39;y')
})
test('footer link is built from validated href and escaped', () => {
  const c: any = buildVccConfig(view, hooks, false)
  expect(c.language.translations.sk.consentModal.footer).toBe('<a href="/p/" class="cc__link">Ochrana osobných údajov</a>')
})
test('cookie autoClear lists declared cookies of optional categories only', () => {
  const v = structuredClone(view)
  v.categories[2]!.services[0]!.storage.push({ name: '_ytc', type: 'cookie', expiry: 'x', purpose: 'y' })
  const c: any = buildVccConfig(v, hooks, false)
  expect(c.categories.media.autoClear.cookies).toEqual([{ name: '_ytc' }])
  expect(c.categories.necessary.autoClear).toBeUndefined()
})
test('right-to-left languages are passed to the library', () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  const c = defineConsent({ locales: ['ar'], defaultLocale: 'ar', revision: 1, services: [theme()], allowFallback: true })
  const cfg: any = buildVccConfig(buildView(c, 'ar'), hooks, false)
  expect(cfg.language.rtl).toBe('ar')
})
test('left-to-right languages do not set rtl', () => {
  const cfg: any = buildVccConfig(view, hooks, false)
  expect(cfg.language.rtl).toBeUndefined()
})

const withUi = (ui: Parameters<typeof defineConsent>[0]['ui']) =>
  buildView(defineConsent({ locales: ['sk'], defaultLocale: 'sk', packs: [sk], revision: 1, services: [theme(), youtube()], ui }), 'sk')

test('default ui gives a bottom bar banner and a right box dialog', () => {
  const c: any = buildVccConfig(view, hooks, false)
  expect(c.guiOptions.consentModal).toEqual({ layout: 'bar', position: 'bottom', equalWeightButtons: true, flipButtons: false })
  expect(c.guiOptions.preferencesModal).toEqual({ layout: 'box', position: 'right', equalWeightButtons: true, flipButtons: false })
})
test('banner and dialog layout come from ui', () => {
  const c: any = buildVccConfig(withUi({
    banner: { layout: 'box', position: 'bottom left', equalWeightButtons: false, flipButtons: true },
    dialog: { layout: 'bar', position: 'left' },
  }), hooks, false)
  expect(c.guiOptions.consentModal).toEqual({ layout: 'box', position: 'bottom left', equalWeightButtons: false, flipButtons: true })
  expect(c.guiOptions.preferencesModal).toMatchObject({ layout: 'bar', position: 'left' })
})
test('every service of an optional category is declared with its escaped title and cookie names', () => {
  const v = structuredClone(view)
  v.categories[2]!.services[0]!.title = 'a&b'
  v.categories[2]!.services[0]!.storage.push({ name: '_ytc', type: 'cookie', expiry: 'x', purpose: 'y' }, { name: 'ls', type: 'localStorage', expiry: 'x', purpose: 'y' })
  const c: any = buildVccConfig(v, hooks, false)
  expect(c.categories.media.services.youtube).toEqual({ label: 'a&amp;b', cookies: [{ name: '_ytc' }] })
  expect(c.categories.functional.services.theme).toEqual({ label: v.categories[1]!.services[0]!.title })
  expect(c.categories.necessary.services).toBeUndefined()
})
test('serviceToggles:false declares no services, so the dialog has group toggles only', () => {
  const c: any = buildVccConfig(withUi({ manager: { serviceToggles: false } }), hooks, false)
  expect(c.categories.media.services).toBeUndefined()
  expect(c.categories.functional.services).toBeUndefined()
  expect(c.categories.media).toMatchObject({ enabled: false, readOnly: false })
})
test('serviceToggles:false keeps category-level cookie auto-clear', () => {
  const v = withUi({ manager: { serviceToggles: false } })
  v.categories[2]!.services[0]!.storage.push({ name: '_ytc', type: 'cookie', expiry: 'x', purpose: 'y' })
  const c: any = buildVccConfig(v, hooks, false)
  expect(c.categories.media.autoClear.cookies).toEqual([{ name: '_ytc' }])
})
test('the engine change callback passes changed categories and flattened services to the hook', () => {
  const calls: unknown[][] = []
  const c: any = buildVccConfig(view, { ...hooks, onChange: (...a: unknown[]) => { calls.push(a) } }, false)
  c.onChange({ changedCategories: ['media'], changedServices: { media: ['youtube'], functional: ['theme', 'youtube'] } })
  c.onChange({ changedCategories: ['functional'] })
  expect(calls).toEqual([[['media'], ['youtube', 'theme']], [['functional'], []]])
})
test('without service toggles a changed category stands for all its services', () => {
  const calls: unknown[][] = []
  const c: any = buildVccConfig(withUi({ manager: { serviceToggles: false } }), { ...hooks, onChange: (...a: unknown[]) => { calls.push(a) } }, false)
  c.onChange({ changedCategories: ['media'], changedServices: {} })
  expect(calls).toEqual([[['media'], ['youtube']]])
})
