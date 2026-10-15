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
