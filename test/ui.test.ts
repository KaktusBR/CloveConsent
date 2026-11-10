import { beforeEach, describe, expect, test, vi } from 'vitest'
import { defineConsent } from '../src/config'
import { createConsent } from '../src/client'
import { bindDom, bootFromDom } from '../src/ui'
import { toPublicJson } from '../src/config'
import { youtube } from '../src/catalog'
import sk from '../src/locales/sk'

const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o))
const driver = (raw: string | null = null) => {
  let r = raw; let hooks: any
  return { init: (_v: any, h: any) => { hooks = h }, readRaw: () => r, writeData() {}, showBanner() {}, open: vi.fn(), acceptAll() {}, rejectAll() {}, acceptCategories: vi.fn(), acceptServices: vi.fn(),
    set: (x: string | null) => { r = x }, hooks: () => hooks }
}
const config = defineConsent({ locales: ['sk'], defaultLocale: 'sk', packs: [sk], revision: 1, services: [youtube()] })
const page = `
<button data-consent-open>Settings</button>
<div data-consent-embed data-consent-service="youtube" data-consent-src="https://www.youtube-nocookie.com/embed/abc" data-consent-title="Video">
  <div data-consent-placeholder-for="youtube"><button data-consent-action="once">once</button><button data-consent-action="accept">accept</button></div>
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
test('accept button accepts that one service, keeping the existing ones', () => {
  const d = driver(enc({ consentId: 'abc-12345678', categories: ['necessary', 'functional'], data: { siteRevision: 1, revisions: { youtube: 1 } } }))
  const c = createConsent(config, { driver: d as any }); c.init(); bindDom(c)
  document.querySelector<HTMLElement>('[data-consent-action="accept"]')!.click()
  expect(d.acceptServices).toHaveBeenCalledWith({ media: ['youtube'] })
})
test('withdrawing consent restores the placeholder', () => {
  const d = driver(enc({ consentId: 'abc-12345678', categories: ['necessary', 'media'], data: { siteRevision: 1, revisions: { youtube: 1 } } }))
  const c = createConsent(config, { driver: d as any }); c.init(); bindDom(c)
  expect(document.querySelector('iframe')).not.toBeNull()
  d.set(enc({ consentId: 'abc-12345678', categories: ['necessary'], data: { siteRevision: 1, revisions: { youtube: 1 } } }))
  d.hooks().onChange(['media'], [])
  expect(document.querySelector('iframe')).toBeNull()
  expect(document.querySelector('[data-consent-placeholder-for]')).not.toBeNull()
})
test('an embed whose service has no stored revision stays a placeholder until a decision', () => {
  const stale = enc({ consentId: 'abc-12345678', categories: ['necessary', 'media'], data: { siteRevision: 1, revisions: {} } })
  const fresh = enc({ consentId: 'abc-12345678', categories: ['necessary', 'media'], data: { siteRevision: 1, revisions: { youtube: 1 } } })
  const d = driver(stale)
  d.writeData = () => { d.set(fresh) }
  const c = createConsent(config, { driver: d as any }); c.init(); bindDom(c)
  d.hooks().onConsent()
  expect(document.querySelector('iframe')).toBeNull()
  expect(document.querySelector('[data-consent-placeholder-for]')).not.toBeNull()
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
  document.body.innerHTML = `<script type="application/json" id="consent-config" data-locale="sk">${toPublicJson(config, 'sk')}</script>`
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
  document.body.innerHTML = `<script type="application/json" id="consent-config" data-locale="sk">${toPublicJson(config, 'sk')}</script>`
  const bootFromDom = await freshBoot()
  const d1 = driver(); const init1 = vi.spyOn(d1, 'init')
  const first = bootFromDom(document, d1 as any)
  const d2 = driver(); const init2 = vi.spyOn(d2, 'init')
  const second = bootFromDom(document, d2 as any)
  expect(second).toBe(first)
  expect(init1).toHaveBeenCalledTimes(1)
  expect(init2).not.toHaveBeenCalled()
})
test('bootFromDom applies the theme tokens to the document root', async () => {
  const themed = defineConsent({ locales: ['sk'], defaultLocale: 'sk', packs: [sk], revision: 1, services: [youtube()], ui: { theme: { tokens: { primary: '#123456', radius: '4px' } } } })
  document.documentElement.removeAttribute('style')
  document.body.innerHTML = `<script type="application/json" id="consent-config" data-locale="sk">${toPublicJson(themed, 'sk')}</script>`
  expect((await freshBoot())(document, driver() as any)).not.toBeNull()
  const style = document.documentElement.style
  expect(style.getPropertyValue('--consent-override-primary')).toBe('#123456')
  expect(style.getPropertyValue('--consent-override-radius')).toBe('4px')
  document.documentElement.removeAttribute('style')
})
test('bootFromDom binds a settings panel that is in the page', async () => {
  document.body.innerHTML = `<script type="application/json" id="consent-config" data-locale="sk">${toPublicJson(config, 'sk')}</script>`
    + `<section class="consent-settings" data-consent-settings><input type="checkbox" role="switch" class="consent-switch" data-consent-group="media" disabled></section>`
  const root = document.querySelector<HTMLElement>('[data-consent-settings]')!
  expect(root.querySelector('[data-consent-action="save"]')).toBeNull()
  expect((await freshBoot())(document, driver() as any)).not.toBeNull()
  // the binder rendered the panel from the client state: its action buttons exist now and the switches are enabled
  expect(root.querySelector('[data-consent-action="save"]')).not.toBeNull()
  expect(root.querySelector<HTMLInputElement>('input[data-consent-group="media"]')!.disabled).toBe(false)
})
const themedConfig = () => defineConsent({ locales: ['sk'], defaultLocale: 'sk', packs: [sk], revision: 1, services: [youtube()], ui: { theme: { tokens: { primary: '#123456' } } } })
const themedPage = () => { document.body.innerHTML = `<script type="application/json" id="consent-config" data-locale="sk">${toPublicJson(themedConfig(), 'sk')}</script>` }
test('theme overrides are reapplied on astro:page-load and by a second bootFromDom call', async () => {
  document.documentElement.removeAttribute('style')
  themedPage()
  const bootFromDom = await freshBoot()
  expect(bootFromDom(document, driver() as any)).not.toBeNull()
  const style = document.documentElement.style
  expect(style.getPropertyValue('--consent-override-primary')).toBe('#123456')
  // a view transition swaps the root attributes and can wipe the inline style
  document.documentElement.removeAttribute('style')
  expect(style.getPropertyValue('--consent-override-primary')).toBe('')
  document.dispatchEvent(new Event('astro:page-load'))
  expect(style.getPropertyValue('--consent-override-primary')).toBe('#123456')
  document.documentElement.removeAttribute('style')
  themedPage()
  expect(bootFromDom(document, driver() as any)).not.toBeNull()
  expect(style.getPropertyValue('--consent-override-primary')).toBe('#123456')
  document.documentElement.removeAttribute('style')
})
test('a failure while theming or binding the panel does not stop the banner or log "banner not started"', async () => {
  const err = vi.spyOn(console, 'error').mockImplementation(() => {})
  themedPage()
  vi.resetModules()
  vi.doMock('../src/panel', async (orig) => ({ ...(await orig<typeof import('../src/panel')>()), bindSettingsFromDom: () => { throw new Error('boom') } }))
  try {
    const { bootFromDom } = await import('../src/ui')
    const c = bootFromDom(document, driver() as any)
    expect(c).not.toBeNull()
    const messages = err.mock.calls.map((x) => String(x[0]))
    expect(messages.some((x) => x.includes('banner not started'))).toBe(false)
    expect(messages.some((x) => x.includes('[consent]'))).toBe(true)
  } finally {
    vi.doUnmock('../src/panel')
    err.mockRestore()
    document.documentElement.removeAttribute('style')
  }
})
test('load once then reject removes the iframe and restores the placeholder', () => {
  const d = driver(enc({ consentId: 'abc-12345678', categories: ['necessary'], data: { siteRevision: 1, revisions: { youtube: 1 } } }))
  const c = createConsent(config, { driver: d as any }); c.init(); bindDom(c)
  document.querySelector<HTMLElement>('[data-consent-action="once"]')!.click()
  expect(document.querySelector('iframe')).not.toBeNull()
  d.hooks().onChange(['media'], [])
  expect(c.isAllowed('youtube')).toBe(false)
  expect(document.querySelector('iframe')).toBeNull()
  expect(document.querySelector('[data-consent-placeholder-for]')).not.toBeNull()
})
test('fallback content is intact on a plain sync while not allowed', () => {
  document.body.innerHTML = '<div data-consent-embed data-consent-service="youtube"><p id="fb">fallback</p></div>'
  const d = driver(); const c = createConsent(config, { driver: d as any }); c.init(); bindDom(c)
  d.hooks().onConsent()
  expect(document.querySelector('#fb')).not.toBeNull()
})
test('an iframe the page put there itself gets the shared placeholder, at its size, when consent is withdrawn', () => {
  document.body.innerHTML = '<div data-consent-embed data-consent-service="youtube"><iframe width="560" height="315"></iframe></div>'
  const d = driver(); const c = createConsent(config, { driver: d as any }); c.init(); bindDom(c)
  d.hooks().onConsent()
  expect(document.querySelector('iframe')).toBeNull()
  const ph = document.querySelector<HTMLElement>('[data-consent-placeholder-for="youtube"]')!
  expect(ph.style.inlineSize).toBe('560px')
  expect(ph.querySelector('[data-consent-action="once"]')).not.toBeNull()
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
test('embeds on a page swapped in by Astro view transitions are synced (astro:page-load)', () => {
  const d = driver(enc({ consentId: 'abc-12345678', categories: ['necessary', 'media'], data: { siteRevision: 1, revisions: { youtube: 1 } } }))
  document.body.innerHTML = ''
  const c = createConsent(config, { driver: d as any }); c.init(); bindDom(c)
  document.body.innerHTML = page            // the new page arrives
  expect(document.querySelector('iframe')).toBeNull()
  document.dispatchEvent(new Event('astro:page-load'))
  expect(document.querySelector('iframe')!.getAttribute('src')).toBe('https://www.youtube-nocookie.com/embed/abc')
})
})
