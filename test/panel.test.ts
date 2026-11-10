import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { defineConsent } from '../src/config'
import { createConsent, getConsent, type Consent } from '../src/client'
import type { ConsentDriver, DriverHooks } from '../src/driver'
import { buildView } from '../src/view'
import { renderSettings } from '../src/settings'
import { openStreetMap, theme, turnstile, youtube } from '../src/catalog'
import { applyTheme, bindSettings, bindSettingsFromDom } from '../src/panel'
import type { UiSettingsInput } from '../src/ui-settings'

const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o))

/** A driver that behaves like the real one for what the panel needs: it stores a decision and reports it through the hooks. */
function liveDriver(optional: string[] = ['functional', 'media'], initial: string | null = null) {
  let raw = initial
  let data: unknown = {}
  let hooks!: DriverHooks
  let decided = initial !== null
  const d = {
    acceptAllCalls: 0, rejectAllCalls: 0,
    init: (_v: unknown, h: DriverHooks) => { hooks = h },
    readRaw: (): string | null => raw,
    writeData: (x: unknown) => { data = x; if (raw) raw = enc({ ...JSON.parse(decodeURIComponent(raw)), data }) },
    showBanner: () => {}, open: vi.fn(), acceptCategories: vi.fn(),
    acceptServices: (selection: Record<string, string[]>) => {
      const kept = Object.fromEntries(Object.entries(selection).filter(([, ids]) => ids.length > 0))
      decide(Object.keys(kept), kept)
    },
    acceptAll() { d.acceptAllCalls++; decide(optional, undefined) },
    rejectAll() { d.rejectAllCalls++; decide([], undefined) },
    get hooks() { return hooks },
  }
  function decide(categories: string[], services: Record<string, string[]> | undefined) {
    const before = raw ? (JSON.parse(decodeURIComponent(raw)).categories as string[]) : ['necessary']
    const cats = ['necessary', ...categories]
    raw = enc({ consentId: 'abc-12345678', categories: cats, lastConsentTimestamp: '2026-10-14T10:00:00.000Z', data, ...(services ? { services } : {}) })
    const changed = [...new Set([...before, ...cats])].filter((c) => before.includes(c) !== cats.includes(c) && c !== 'necessary')
    if (!decided) { decided = true; hooks.onFirstConsent() } else if (changed.length > 0 || services) hooks.onChange(changed as never, [])
  }
  return d
}
type Live = ReturnType<typeof liveDriver>

function make(ui?: UiSettingsInput) {
  return defineConsent({
    locales: ['en'], defaultLocale: 'en', revision: 1, privacyHref: '/privacy/',
    services: [turnstile(), theme(), youtube(), openStreetMap()],
    ...(ui ? { ui } : {}),
  })
}
const decisionCookie = (categories: string[], services?: Record<string, string[]>) => enc({
  consentId: 'AbC-12345678', categories, lastConsentTimestamp: '2026-03-01T10:20:30.000Z',
  data: { siteRevision: 1, revisions: { 'cloudflare-turnstile': 1, theme: 1, youtube: 1, openstreetmap: 1 } },
  ...(services ? { services } : {}),
})

interface Setup { consent: Consent; driver: Live; root: HTMLElement }
function setup(opts: { ui?: UiSettingsInput; raw?: string | null; bind?: boolean } = {}): Setup {
  const config = make(opts.ui)
  const driver = liveDriver(['functional', 'media'], opts.raw ?? null)
  const consent = createConsent(config, { driver: driver as unknown as ConsentDriver })
  consent.init()
  // the page as the Astro component renders it: server-side, no state, read-only until bound
  document.body.innerHTML = renderSettings(buildView(config, 'en'), null, new Set())
  const root = document.querySelector<HTMLElement>('[data-consent-settings]')!
  if (opts.bind !== false) bindSettings(consent, root)
  return { consent, driver, root }
}
const q = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector<T>(sel)!
const group = (root: ParentNode, id: string) => q<HTMLInputElement>(root, `[data-consent-group="${id}"]`)
const service = (root: ParentNode, id: string) => q<HTMLInputElement>(root, `[data-consent-service="${id}"]`)
const action = (root: ParentNode, name: string) => root.querySelector<HTMLButtonElement>(`[data-consent-action="${name}"]`)
const status = (root: ParentNode) => q(root, '.consent-status').textContent
const count = (root: ParentNode, cat: string) => q(root, `[data-category="${cat}"] .consent-category__count`).textContent
const flush = () => new Promise<void>((r) => setTimeout(r, 0))

beforeEach(() => { document.body.innerHTML = '' })
afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('before any decision (state null)', () => {
  test('renders without a reference, hides Withdraw, and Save creates the first decision', async () => {
    const { consent, root } = setup()
    expect(consent.getState()).toBeNull()
    expect(root.querySelector('.consent-receipt__id')).toBeNull()
    expect(q(root, '.consent-receipt').textContent).toContain('No choice saved yet.')
    expect(action(root, 'withdraw')).toBeNull()
    expect(service(root, 'cloudflare-turnstile').disabled).toBe(true)
    expect(service(root, 'cloudflare-turnstile').checked).toBe(true)

    const seen: string[] = []
    consent.on('decision', (info) => seen.push(info.kind))
    service(root, 'theme').click()
    action(root, 'save')!.click()
    expect(seen).toEqual(['first'])
    expect(consent.getState()?.consentId).toBe('abc-12345678')
    expect(consent.isAllowed('theme')).toBe(true)
    expect(q(root, '.consent-receipt__id').textContent).toBe('abc-12345678')
    expect(action(root, 'withdraw')).not.toBeNull()
    await flush()
    expect(status(root)).toBe('Your choice has been saved.')
  })
  test('Save with nothing ticked is still a first decision (necessary only)', () => {
    const { consent, root } = setup()
    const spy = vi.spyOn(consent, 'setServices')
    action(root, 'save')!.click()
    expect(spy).toHaveBeenCalledWith([])
    expect(consent.getState()).not.toBeNull()
    expect(consent.isAllowed('theme')).toBe(false)
  })
})

describe('switches', () => {
  test('a group switch sets all its service switches and clears the mixed state', () => {
    const { root } = setup()
    service(root, 'youtube').click()
    expect(group(root, 'media').indeterminate).toBe(true)
    group(root, 'media').click() // from mixed: turns everything on
    expect(service(root, 'youtube').checked).toBe(true)
    expect(service(root, 'openstreetmap').checked).toBe(true)
    expect(group(root, 'media').checked).toBe(true)
    expect(group(root, 'media').indeterminate).toBe(false)
    expect(group(root, 'media').dataset.state).toBe('on')
    expect(count(root, 'media')).toBe('2 of 2 allowed')
    group(root, 'media').click()
    expect(service(root, 'youtube').checked).toBe(false)
    expect(service(root, 'openstreetmap').checked).toBe(false)
    expect(group(root, 'media').dataset.state).toBe('off')
    expect(count(root, 'media')).toBe('0 of 2 allowed')
  })
  test('one service makes the group mixed and updates the count text', () => {
    const { root } = setup()
    service(root, 'openstreetmap').click()
    const g = group(root, 'media')
    // role="switch" has no mixed state: no aria-checked="mixed"; the input is indeterminate and described by the visible state text
    expect(g.getAttribute('role')).toBe('switch')
    expect(g.hasAttribute('aria-checked')).toBe(false)
    expect(g.indeterminate).toBe(true)
    expect(g.dataset.state).toBe('mixed')
    const described = root.ownerDocument.getElementById(g.getAttribute('aria-describedby')!)
    expect(described?.textContent).toBe('Some allowed')
    expect(g.checked).toBe(false)
    expect(count(root, 'media')).toBe('1 of 2 allowed')
    expect(q(root, '[data-category="media"] .consent-category__state').textContent).toBe('Some allowed')
    service(root, 'openstreetmap').click()
    expect(g.indeterminate).toBe(false)
    expect(g.hasAttribute('aria-checked')).toBe(false)
    expect(q(root, '[data-category="media"] .consent-category__state').textContent).toBe('')
    expect(count(root, 'media')).toBe('0 of 2 allowed')
  })
  test('a stored partial choice renders mixed: indeterminate after the render, described by the state text', () => {
    const { root } = setup({ raw: decisionCookie(['necessary', 'media'], { media: ['youtube'] }) })
    expect(group(root, 'media').indeterminate).toBe(true)
    expect(group(root, 'media').hasAttribute('aria-checked')).toBe(false)
    expect(root.ownerDocument.getElementById(group(root, 'media').getAttribute('aria-describedby')!)?.textContent).toBe('Some allowed')
    expect(service(root, 'youtube').checked).toBe(true)
    expect(service(root, 'openstreetmap').checked).toBe(false)
    expect(count(root, 'media')).toBe('1 of 2 allowed')
  })
  test('without service toggles a group switch saves the whole category', () => {
    const { consent, root } = setup({ ui: { manager: { serviceToggles: false } } })
    expect(root.querySelector('[data-consent-service]')).toBeNull()
    const spy = vi.spyOn(consent, 'setServices')
    group(root, 'media').click()
    expect(count(root, 'media')).toBe('2 of 2 allowed')
    action(root, 'save')!.click()
    expect(spy).toHaveBeenCalledWith(['youtube', 'openstreetmap'])
    expect(consent.isAllowed('youtube')).toBe(true)
    expect(consent.isAllowed('openstreetmap')).toBe(true)
    expect(consent.isAllowed('theme')).toBe(false)
  })
})

describe('actions', () => {
  test('Save calls setServices with exactly the checked, enabled service ids and reports it', async () => {
    const { consent, root } = setup()
    const spy = vi.spyOn(consent, 'setServices')
    service(root, 'theme').click()
    service(root, 'openstreetmap').click()
    action(root, 'save')!.click()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith(['theme', 'openstreetmap'])
    await flush()
    expect(status(root)).toBe('Your choice has been saved.')
    expect(consent.isAllowed('theme')).toBe(true)
    expect(consent.isAllowed('youtube')).toBe(false)
  })
  test('Accept all and Reject all call the consent methods', () => {
    const { consent, root } = setup()
    const a = vi.spyOn(consent, 'acceptAll')
    const r = vi.spyOn(consent, 'rejectAll')
    action(root, 'accept-all')!.click()
    expect(a).toHaveBeenCalledTimes(1)
    expect(consent.isAllowed('youtube')).toBe(true)
    expect(service(root, 'youtube').checked).toBe(true)
    action(root, 'reject-all')!.click()
    expect(r).toHaveBeenCalledTimes(1)
    expect(consent.isAllowed('youtube')).toBe(false)
    expect(service(root, 'youtube').checked).toBe(false)
  })
  test('Withdraw calls consent.withdraw() and disappears once nothing optional is allowed', () => {
    const { consent, root } = setup({ raw: decisionCookie(['necessary', 'media']) })
    const spy = vi.spyOn(consent, 'withdraw')
    const seen: string[] = []
    consent.on('decision', (i) => seen.push(i.kind))
    action(root, 'withdraw')!.click()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(seen).toEqual(['withdraw'])
    expect(action(root, 'withdraw')).toBeNull()
    expect(service(root, 'youtube').checked).toBe(false)
  })
  test('Withdraw is not offered when nothing optional is allowed', () => {
    const { root } = setup({ raw: decisionCookie(['necessary']) })
    expect(action(root, 'withdraw')).toBeNull()
  })
  test('focus stays on the control used, or falls back to Save when that control disappears', () => {
    const { root } = setup({ raw: decisionCookie(['necessary', 'media']) })
    const accept = action(root, 'accept-all')!
    accept.focus()
    accept.click()
    expect(document.activeElement).toBe(action(root, 'accept-all'))
    const withdraw = action(root, 'withdraw')!
    withdraw.focus()
    withdraw.click()
    expect(document.activeElement).toBe(action(root, 'save'))
  })
})

describe('copy', () => {
  test('writes the reference to the clipboard and shows receiptCopied', async () => {
    const { root } = setup({ raw: decisionCookie(['necessary', 'media']) })
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    action(root, 'copy')!.click()
    await flush()
    await flush()
    expect(writeText).toHaveBeenCalledWith('AbC-12345678')
    expect(status(root)).toBe('Copied')
  })
  test('a missing clipboard API degrades without an error or a false confirmation', async () => {
    const { root } = setup({ raw: decisionCookie(['necessary', 'media']) })
    expect(navigator.clipboard).toBeUndefined()
    action(root, 'copy')!.click()
    await flush()
    expect(status(root)).toBe('')
    expect(q(root, '.consent-receipt__id').textContent).toBe('AbC-12345678')
  })
  test('a rejecting clipboard degrades the same way', async () => {
    const { root } = setup({ raw: decisionCookie(['necessary', 'media']) })
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    action(root, 'copy')!.click()
    await flush()
    expect(writeText).toHaveBeenCalled()
    expect(status(root)).toBe('')
  })
})

describe('decisions from elsewhere', () => {
  test('a decision made outside the panel re-renders it to the new state and keeps focus', () => {
    const { consent, root } = setup()
    expect(service(root, 'youtube').checked).toBe(false)
    service(root, 'youtube').focus()
    consent.acceptAll() // e.g. the banner
    expect(service(root, 'youtube').checked).toBe(true)
    expect(group(root, 'media').checked).toBe(true)
    expect(q(root, '.consent-receipt__id').textContent).toBe('abc-12345678')
    expect(document.activeElement).toBe(service(root, 'youtube'))
    expect(action(root, 'withdraw')).not.toBeNull()
  })
  test('the same root element stays in place', () => {
    const { consent, root } = setup()
    consent.acceptAll()
    expect(document.querySelector('[data-consent-settings]')).toBe(root)
    expect(document.querySelectorAll('[data-consent-settings]').length).toBe(1)
  })
  test('an event that leaves the state unchanged keeps ticks the visitor has not saved yet', () => {
    const { driver, root } = setup({ raw: decisionCookie(['necessary', 'media']) })
    service(root, 'theme').click()
    driver.hooks.onConsent() // reports ready with the same stored state
    expect(service(root, 'theme').checked).toBe(true)
  })
})

describe('one-time allowances are not choices', () => {
  test('allowOnce leaves the switch unticked and Save does not include the service', () => {
    const { consent, root } = setup()
    consent.allowOnce('youtube')
    expect(consent.isAllowed('youtube')).toBe(true)
    expect(service(root, 'youtube').checked).toBe(false)
    expect(count(root, 'media')).toBe('0 of 2 allowed')
    const spy = vi.spyOn(consent, 'setServices')
    service(root, 'theme').click()
    action(root, 'save')!.click()
    expect(spy).toHaveBeenCalledWith(['theme'])
    expect(consent.isAllowed('youtube')).toBe(false)
  })
  test('a once allowance with no stored decision offers no Withdraw and no reference', () => {
    const { consent, root } = setup()
    consent.allowOnce('youtube')
    expect(consent.getState()).toBeNull()
    expect(action(root, 'withdraw')).toBeNull()
    expect(root.querySelector('.consent-receipt__id')).toBeNull()
  })
})

describe('live region', () => {
  test('the status node survives a re-render caused by a decision', () => {
    const { consent, root } = setup()
    const node = q(root, '.consent-status')
    consent.acceptAll() // e.g. the banner
    expect(q(root, '.consent-status')).toBe(node)
    expect(node.isConnected).toBe(true)
    action(root, 'reject-all')!.click()
    expect(q(root, '.consent-status')).toBe(node)
  })
  test('Save writes settingsSaved into that node, and the same text twice is announced again', async () => {
    const { root } = setup()
    const node = q(root, '.consent-status')
    action(root, 'save')!.click()
    expect(node.textContent).toBe('') // cleared first, set on a later task
    await flush()
    expect(node.textContent).toBe('Your choice has been saved.')
    action(root, 'save')!.click()
    expect(node.textContent).toBe('')
    await flush()
    expect(node.textContent).toBe('Your choice has been saved.')
    expect(q(root, '.consent-status')).toBe(node)
  })
  test('an action that causes a decision renders once', () => {
    const { consent, root } = setup()
    const spy = vi.spyOn(root, 'replaceChildren')
    void consent
    action(root, 'accept-all')!.click()
    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('details', () => {
  test('a category the visitor opened stays open across a re-render, with its summary text', () => {
    const { consent, root } = setup()
    const details = q(root, '[data-category="media"] details')
    expect(details.hasAttribute('open')).toBe(false)
    details.setAttribute('open', '')
    consent.acceptAll()
    const after = q(root, '[data-category="media"] details')
    expect(after.hasAttribute('open')).toBe(true)
    expect(q(after, 'summary').textContent).toBe('Hide details')
    expect(q(root, '[data-category="functional"] details').hasAttribute('open')).toBe(false)
  })
})

describe('idempotence (Review Focus 4)', () => {
  test('binding the same root twice registers once: one click is one decision', () => {
    const { consent, driver, root } = setup()
    const unbind1 = bindSettings(consent, root)
    const unbind2 = bindSettings(consent, root)
    const seen: string[] = []
    consent.on('decision', (i) => seen.push(i.kind))
    action(root, 'accept-all')!.click()
    expect(driver.acceptAllCalls).toBe(1)
    expect(seen).toEqual(['first'])
    expect(unbind1).toBe(unbind2)
  })
  test('bindSettingsFromDom and astro:page-load dispatched twice still bind once', () => {
    const { consent, driver, root } = setup({ bind: false })
    expect(getConsent()).toBe(consent)
    bindSettingsFromDom(document)
    bindSettingsFromDom(document)
    document.dispatchEvent(new Event('astro:page-load'))
    document.dispatchEvent(new Event('astro:page-load'))
    const seen: string[] = []
    consent.on('decision', (i) => seen.push(i.kind))
    action(root, 'accept-all')!.click()
    expect(driver.acceptAllCalls).toBe(1)
    expect(seen).toEqual(['first'])
    expect(q(root, '.consent-receipt__id').textContent).toBe('abc-12345678')
  })
  test('a root swapped in by a page transition is bound on astro:page-load; the old one is released', () => {
    const { consent, driver } = setup({ bind: false })
    bindSettingsFromDom(document)
    const old = document.querySelector<HTMLElement>('[data-consent-settings]')!
    const fresh = old.cloneNode(true) as HTMLElement
    old.replaceWith(fresh)
    document.dispatchEvent(new Event('astro:page-load'))
    action(fresh, 'accept-all')!.click()
    expect(driver.acceptAllCalls).toBe(1)
    expect(service(fresh, 'youtube').checked).toBe(true)
    void consent
  })
  test('rebinding a root to a different client releases the first one', () => {
    const a = setup()
    const other = createConsent(make(), { driver: liveDriver() as unknown as ConsentDriver })
    other.init()
    bindSettings(other, a.root)
    action(a.root, 'accept-all')!.click()
    expect(a.driver.acceptAllCalls).toBe(0)
    expect(other.getState()).not.toBeNull()
  })
})

describe('bindSettingsFromDom before the client exists', () => {
  test('does nothing until a client exists, then binds on the next run', async () => {
    // a fresh module instance (no client yet) and its own document, so listeners of the other tests do not interfere
    vi.resetModules()
    const client = await import('../src/client')
    const view = await import('../src/view')
    const settings = await import('../src/settings')
    const panel = await import('../src/panel')
    expect(client.getConsent()).toBeNull()
    const doc = document.implementation.createHTMLDocument('page')
    const config = make()
    doc.body.innerHTML = settings.renderSettings(view.buildView(config, 'en'), null, new Set())
    const root = doc.querySelector<HTMLElement>('[data-consent-settings]')!
    panel.bindSettingsFromDom(doc)
    const driver = liveDriver()
    const consent = client.createConsent(config, { driver: driver as unknown as ConsentDriver, doc })
    consent.init()
    // still read-only: nothing was wired and nothing threw
    action(root, 'accept-all')!.click()
    expect(driver.acceptAllCalls).toBe(0)
    doc.dispatchEvent(new Event('astro:page-load'))
    action(root, 'accept-all')!.click()
    expect(driver.acceptAllCalls).toBe(1)
    expect(q(root, '.consent-receipt__id').textContent).toBe('abc-12345678')
  })
})

/** Wraps consent.on so the tests can see which subscriptions are released. */
function trackSubscriptions(consent: Consent): ReturnType<typeof vi.fn>[] {
  const offs: ReturnType<typeof vi.fn>[] = []
  const real = consent.on.bind(consent) as (e: string, fn: never) => () => void
  vi.spyOn(consent, 'on').mockImplementation(((e: string, fn: never) => {
    const off = vi.fn(real(e, fn))
    offs.push(off)
    return off
  }) as never)
  return offs
}

describe('unbind', () => {
  test('removes the listeners and the consent subscriptions', () => {
    const { consent, driver, root } = setup({ bind: false })
    const offs = trackSubscriptions(consent)
    const unbind = bindSettings(consent, root)
    expect(offs.length).toBeGreaterThan(0)
    unbind()
    for (const off of offs) expect(off).toHaveBeenCalled()
    action(root, 'accept-all')!.click()
    expect(driver.acceptAllCalls).toBe(0)
  })
  test('after unbind the panel no longer follows decisions and can be bound again', () => {
    const { consent, root } = setup()
    bindSettings(consent, root)() // idempotent call returns the same unbind
    consent.acceptAll()
    expect(service(root, 'youtube').checked).toBe(false)
    bindSettings(consent, root)
    expect(service(root, 'youtube').checked).toBe(true)
  })
  test('a root removed from the page is released on the next event', () => {
    const { consent, root } = setup({ bind: false })
    const offs = trackSubscriptions(consent)
    bindSettings(consent, root)
    root.remove()
    consent.acceptAll()
    expect(offs.length).toBeGreaterThan(0)
    for (const off of offs) expect(off).toHaveBeenCalled()
  })
})

describe('applyTheme', () => {
  test('sets --consent-override-<kebab> through style.setProperty and nothing else', () => {
    const el = document.createElement('div')
    const spy = vi.spyOn(el.style, 'setProperty')
    applyTheme(el, { primary: '#112233', primaryForeground: 'rgb(255 255 255)', radius: '0.5rem', fontFamily: 'Inter, sans-serif' })
    expect(spy).toHaveBeenCalledTimes(4)
    expect(spy).toHaveBeenCalledWith('--consent-override-primary', '#112233')
    expect(spy).toHaveBeenCalledWith('--consent-override-primary-foreground', 'rgb(255 255 255)')
    expect(spy).toHaveBeenCalledWith('--consent-override-radius', '0.5rem')
    expect(spy).toHaveBeenCalledWith('--consent-override-font-family', 'Inter, sans-serif')
    expect(el.style.getPropertyValue('--consent-override-primary')).toBe('#112233')
    expect(el.getAttributeNames()).toEqual(['style'])
    expect(el.children.length).toBe(0)
  })
  test('unsafe values and unknown names are a no-op', () => {
    const el = document.createElement('div')
    const spy = vi.spyOn(el.style, 'setProperty')
    applyTheme(el, { primary: 'red; background: url(//evil)', radius: 'calc(1px)', ring: 'url(x)' })
    applyTheme(el, { nope: '#fff' } as never)
    applyTheme(el, { primary: 42 } as never)
    expect(spy).not.toHaveBeenCalled()
    expect(el.hasAttribute('style')).toBe(false)
  })
  test('an empty token set leaves the element untouched', () => {
    const el = document.createElement('div')
    applyTheme(el, {})
    expect(el.getAttributeNames()).toEqual([])
  })
})
