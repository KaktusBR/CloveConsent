import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defineConsent } from '../src/config'
import { createConsent } from '../src/client'
import { bindDom, bootFromDom } from '../src/ui'
import { toPublicJson } from '../src/config'
import { youtube } from '../src/catalog'

const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o))
const driver = (raw: string | null = null) => {
  let r = raw; let hooks: any
  return { init: (_v: any, h: any) => { hooks = h }, readRaw: () => r, writeData() {}, showBanner() {}, open: vi.fn(), acceptAll() {}, rejectAll() {}, acceptCategories: vi.fn(),
    set: (x: string | null) => { r = x }, hooks: () => hooks }
}
const config = defineConsent({ locales: ['sk'], defaultLocale: 'sk', revision: 1, services: [youtube()] })
const page = `
<button data-consent-open>Settings</button>
<div data-consent-embed data-consent-service="youtube" data-consent-src="https://www.youtube-nocookie.com/embed/abc" data-consent-title="Video">
  <div data-consent-placeholder><button data-consent-action="once">once</button><button data-consent-action="accept">accept</button></div>
</div>`
beforeEach(() => { document.body.innerHTML = page })

describe('dom binding', () => {
test('open button opens preferences', () => {
  const d = driver(); const c = createConsent(config, { driver: d as any }); c.init(); bindDom(c)
  document.querySelector<HTMLElement>('[data-consent-open]')!.click()
  expect(d.open).toHaveBeenCalled()
})
test('embed stays a placeholder until allowed, then becomes an iframe', () => {
  const d = driver(); const c = createConsent(config, { driver: d as any }); c.init(); bindDom(c)
  expect(document.querySelector('iframe')).toBeNull()
  document.querySelector<HTMLElement>('[data-consent-action="once"]')!.click()
  expect(document.querySelector('iframe')!.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/abc')
})
test('accept button accepts the service category, keeping existing ones', () => {
  const d = driver(enc({ consentId: 'abc-12345678', categories: ['necessary', 'functional'], data: { siteRevision: 1, revisions: { youtube: 1 } } }))
  const c = createConsent(config, { driver: d as any }); c.init(); bindDom(c)
  document.querySelector<HTMLElement>('[data-consent-action="accept"]')!.click()
  expect(d.acceptCategories).toHaveBeenCalledWith(['necessary', 'functional', 'media'])
})
test('withdrawing consent restores the placeholder', () => {
  const d = driver(enc({ consentId: 'abc-12345678', categories: ['necessary', 'media'], data: { siteRevision: 1, revisions: { youtube: 1 } } }))
  const c = createConsent(config, { driver: d as any }); c.init(); bindDom(c)
  expect(document.querySelector('iframe')).not.toBeNull()
  d.set(enc({ consentId: 'abc-12345678', categories: ['necessary'], data: { siteRevision: 1, revisions: { youtube: 1 } } }))
  d.hooks().onChange(['media'])
  expect(document.querySelector('iframe')).toBeNull()
  expect(document.querySelector('[data-consent-placeholder]')).not.toBeNull()
})
test('an embed whose service has no stored revision stays a placeholder until a decision', () => {
  const stale = enc({ consentId: 'abc-12345678', categories: ['necessary', 'media'], data: { siteRevision: 1, revisions: {} } })
  const fresh = enc({ consentId: 'abc-12345678', categories: ['necessary', 'media'], data: { siteRevision: 1, revisions: { youtube: 1 } } })
  const d = driver(stale)
  d.writeData = () => { d.set(fresh) }
  const c = createConsent(config, { driver: d as any }); c.init(); bindDom(c)
  d.hooks().onConsent()
  expect(document.querySelector('iframe')).toBeNull()
  expect(document.querySelector('[data-consent-placeholder]')).not.toBeNull()
  d.hooks().onDecision()
  expect(document.querySelector('iframe')).not.toBeNull()
})
test('a tampered embed src is not loaded', () => {
  document.querySelector('[data-consent-embed]')!.setAttribute('data-consent-src', 'https://evil.com/x')
  const d = driver(enc({ consentId: 'abc-12345678', categories: ['necessary', 'media'], data: { siteRevision: 1, revisions: { youtube: 1 } } }))
  const c = createConsent(config, { driver: d as any }); c.init()
  expect(() => bindDom(c)).not.toThrow()
  expect(document.querySelector('iframe')).toBeNull()
})
// a fresh module graph so no client from another test is registered as current
const freshBoot = async () => { vi.resetModules(); return (await import('../src/ui')).bootFromDom }
test('bootFromDom reads the json block and validates it', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {})
  document.body.innerHTML = `<script type="application/json" id="consent-config" data-locale="sk">${toPublicJson(config)}</script>`
  expect((await freshBoot())(document, driver() as any)).not.toBeNull()
  document.body.innerHTML = `<script type="application/json" id="consent-config">{"locales":["xx"]}</script>`
  const bootFromDom = await freshBoot()
  expect(bootFromDom(document, driver() as any)).toBeNull()
  expect(err).toHaveBeenCalled()
  err.mockRestore()
  document.body.innerHTML = ''
  expect(bootFromDom(document, driver() as any)).toBeNull()
})
test('bootFromDom twice returns the existing client instead of starting a second one', async () => {
  document.body.innerHTML = `<script type="application/json" id="consent-config" data-locale="sk">${toPublicJson(config)}</script>`
  const bootFromDom = await freshBoot()
  const d1 = driver(); const init1 = vi.spyOn(d1, 'init')
  const first = bootFromDom(document, d1 as any)
  const d2 = driver(); const init2 = vi.spyOn(d2, 'init')
  const second = bootFromDom(document, d2 as any)
  expect(second).toBe(first)
  expect(init1).toHaveBeenCalledTimes(1)
  expect(init2).not.toHaveBeenCalled()
})
test('load once then reject removes the iframe and restores the placeholder', () => {
  const d = driver(enc({ consentId: 'abc-12345678', categories: ['necessary'], data: { siteRevision: 1, revisions: { youtube: 1 } } }))
  const c = createConsent(config, { driver: d as any }); c.init(); bindDom(c)
  document.querySelector<HTMLElement>('[data-consent-action="once"]')!.click()
  expect(document.querySelector('iframe')).not.toBeNull()
  d.hooks().onChange(['media'])
  expect(c.isAllowed('youtube')).toBe(false)
  expect(document.querySelector('iframe')).toBeNull()
  expect(document.querySelector('[data-consent-placeholder]')).not.toBeNull()
})
test('fallback content is intact on a plain sync while not allowed', () => {
  document.body.innerHTML = '<div data-consent-embed data-consent-service="youtube"><p id="fb">fallback</p></div>'
  const d = driver(); const c = createConsent(config, { driver: d as any }); c.init(); bindDom(c)
  d.hooks().onConsent()
  expect(document.querySelector('#fb')).not.toBeNull()
})
test('bindDom is idempotent', () => {
  const d = driver(); const c = createConsent(config, { driver: d as any }); c.init(); bindDom(c); bindDom(c)
  document.querySelector<HTMLElement>('[data-consent-open]')!.click()
  expect(d.open).toHaveBeenCalledTimes(1)
})
test('a click dispatched on document does not throw', () => {
  const d = driver(); const c = createConsent(config, { driver: d as any }); c.init(); bindDom(c)
  expect(() => document.dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow()
})
})
