import { describe, expect, test } from 'vitest'
import { defineConsent } from '../src/config'
import { buildView } from '../src/view'
import { hosting, resend, theme, turnstile, youtube } from '../src/catalog'
import { choiceSummary, formatSaved, groupState, renderSettings } from '../src/settings'
import type { ConsentState } from '../src/schema'
import type { UiSettingsInput } from '../src/ui-settings'

function make(ui?: UiSettingsInput) {
  return defineConsent({
    locales: ['en'], defaultLocale: 'en', revision: 3, privacyHref: '/privacy/',
    services: [turnstile(), theme(), youtube()],
    processors: [resend(), hosting({ name: 'H', privacyUrl: 'https://h.example/p', location: { en: 'Germany' } })],
    ...(ui ? { ui } : {}),
  })
}
const state: ConsentState = {
  consentId: 'AbC-123_xyz', categories: ['necessary', 'functional'], siteRevision: 3, revisions: {},
  services: { functional: ['theme'] }, timestamp: '2026-03-01T10:20:30.000Z',
}
function render(ui?: UiSettingsInput, s: ConsentState | null = state, allowed: string[] = ['theme']) {
  const view = buildView(make(ui), 'en')
  const doc = new DOMParser().parseFromString(`<body>${renderSettings(view, s, new Set(allowed))}</body>`, 'text/html')
  return { view, doc, html: renderSettings(view, s, new Set(allowed)) }
}

describe('groupState', () => {
  test('on, off and mixed', () => {
    expect(groupState(new Set(['a', 'b']), ['a', 'b'])).toBe('on')
    expect(groupState(new Set(), ['a', 'b'])).toBe('off')
    expect(groupState(new Set(['a']), ['a', 'b'])).toBe('mixed')
    expect(groupState(new Set(['x']), ['a', 'b'])).toBe('off')
    expect(groupState(new Set(['a']), [])).toBe('off')
  })
})
describe('choiceSummary', () => {
  test('all, necessary and custom', () => {
    expect(choiceSummary(new Set(['a', 'b']), ['a', 'b'])).toBe('all')
    expect(choiceSummary(new Set(), ['a', 'b'])).toBe('necessary')
    expect(choiceSummary(new Set(['a']), ['a', 'b'])).toBe('custom')
    expect(choiceSummary(new Set(), [])).toBe('necessary')
  })
})
describe('formatSaved', () => {
  test('dash for null and invalid, text for a valid timestamp', () => {
    expect(formatSaved(null, 'en')).toBe('—')
    expect(formatSaved('garbage', 'en')).toBe('—')
    expect(formatSaved('2026-03-01T10:20:30.000Z', 'en').length).toBeGreaterThan(0)
    expect(formatSaved('2026-03-01T10:20:30.000Z', 'en')).not.toBe('—')
  })
})

describe('renderSettings', () => {
  test('one group switch per optional category and a disabled checked one for necessary', () => {
    const { doc, view } = render()
    const optional = view.categories.filter((c) => !c.readOnly)
    expect(doc.querySelectorAll('[data-consent-group]:not([disabled])').length).toBe(optional.length)
    const nec = doc.querySelector<HTMLInputElement>('[data-consent-group="necessary"]')!
    expect(nec.disabled).toBe(true)
    expect(nec.checked).toBe(true)
    expect(nec.getAttribute('role')).toBe('switch')
    expect(nec.type).toBe('checkbox')
    expect(doc.querySelector('section.consent-settings[data-consent-settings]')).not.toBeNull()
  })
  test('every switch has a real label and ids are unique', () => {
    const { doc } = render()
    const inputs = [...doc.querySelectorAll<HTMLInputElement>('input.consent-switch')]
    expect(inputs.length).toBeGreaterThan(0)
    for (const i of inputs) expect(doc.querySelector(`label[for="${i.id}"]`)).not.toBeNull()
    expect(new Set(inputs.map((i) => i.id)).size).toBe(inputs.length)
  })
  test('one service switch per service, checked from allowed', () => {
    const { doc, view } = render()
    const total = view.categories.flatMap((c) => c.services).length
    expect(doc.querySelectorAll('[data-consent-service]').length).toBe(total)
    expect(doc.querySelectorAll('div.consent-service[data-service]').length).toBe(total)
    expect(doc.querySelector<HTMLInputElement>('[data-consent-service="theme"]')!.checked).toBe(true)
    expect(doc.querySelector<HTMLInputElement>('[data-consent-service="youtube"]')!.checked).toBe(false)
  })
  test('group state follows the allowed services', () => {
    const { doc } = render()
    const fn = doc.querySelector<HTMLInputElement>('[data-consent-group="functional"]')!
    expect(fn.getAttribute('data-state')).toBe('on')
    expect(fn.checked).toBe(true)
    const media = doc.querySelector<HTMLInputElement>('[data-consent-group="media"]')!
    expect(media.getAttribute('data-state')).toBe('off')
    expect(media.checked).toBe(false)
  })
  test('service toggles off drops the service switches but keeps the group switches', () => {
    const { doc } = render({ manager: { serviceToggles: false } })
    expect(doc.querySelectorAll('[data-consent-service]').length).toBe(0)
    expect(doc.querySelectorAll('[data-consent-group]:not([disabled])').length).toBe(2)
    expect(doc.querySelectorAll('div.consent-service').length).toBeGreaterThan(0)
  })
  test('the receipt shows the consent id exactly as stored, escaped', () => {
    const { doc } = render(undefined, { ...state, consentId: 'a<b>&"c' })
    expect(doc.querySelector('.consent-receipt__id')!.textContent).toBe('a<b>&"c')
    expect(doc.querySelector('.consent-receipt__id b')).toBeNull()
    expect(doc.querySelector('.consent-receipt__id')!.getAttribute('dir')).toBe('ltr')
    expect(doc.querySelector('button.consent-btn.consent-btn--secondary[data-consent-action="copy"]')).not.toBeNull()
    const meta = doc.querySelector('.consent-receipt__meta')!.textContent!
    expect(meta).toContain(String(state.siteRevision))
    expect(meta).toContain('en')
    expect(meta).toContain('Custom')
  })
  test('the receipt can be turned off', () => {
    const { doc } = render({ manager: { receipt: false } })
    expect(doc.querySelector('.consent-receipt')).toBeNull()
  })
  test('without a state the receipt shows the none text and no reference', () => {
    const { doc, view } = render(undefined, null, [])
    expect(doc.querySelector('.consent-receipt__meta')!.textContent).toContain(view.m.receiptNone)
    expect(doc.querySelector('.consent-receipt__id')).toBeNull()
    expect(doc.querySelector('[data-consent-action="copy"]')).toBeNull()
  })
  test('withdraw is hidden by the setting and when nothing is allowed', () => {
    expect(render().doc.querySelector('[data-consent-action="withdraw"]')).not.toBeNull()
    expect(render({ manager: { withdraw: false } }).doc.querySelector('[data-consent-action="withdraw"]')).toBeNull()
    expect(render(undefined, state, []).doc.querySelector('[data-consent-action="withdraw"]')).toBeNull()
  })
  test('the other actions and the live status region exist', () => {
    const { doc } = render()
    for (const a of ['accept-all', 'reject-all', 'save']) expect(doc.querySelector(`.consent-actions button.consent-btn[data-consent-action="${a}"]`)).not.toBeNull()
    expect(doc.querySelector('div.consent-status[aria-live="polite"]')).not.toBeNull()
  })
  test('details are open only when configured so', () => {
    expect(render().doc.querySelector('details')).not.toBeNull()
    expect(render().doc.querySelector('details[open]')).toBeNull()
    expect(render({ manager: { details: 'open' } }).doc.querySelector('details[open]')).not.toBeNull()
  })
  test('storage tables follow the setting', () => {
    expect(render().doc.querySelectorAll('table.consent-table').length).toBeGreaterThan(0)
    const off = render({ manager: { storageTables: false } }).doc
    expect(off.querySelector('table')).toBeNull()
  })
  test('a service without storage shows the noStorage text', () => {
    const { doc, view } = render()
    const none = view.categories.flatMap((c) => c.services).filter((s) => s.storage.length === 0)
    for (const s of none) expect(doc.querySelector(`[data-service="${s.id}"]`)!.textContent).toContain(view.m.noStorage)
  })
  test('the processor list follows the setting', () => {
    const on = render().doc
    expect(on.querySelectorAll('.consent-processors li').length).toBe(2)
    expect(render({ manager: { processors: false } }).doc.querySelector('.consent-processors')).toBeNull()
  })
  test('markup in a service title is escaped', () => {
    const view = buildView(make(), 'en')
    view.categories[1]!.services[0]!.title = '<img src=x onerror=alert(1)>'
    const html = renderSettings(view, state, new Set())
    expect(html).not.toContain('<img')
    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
    expect(doc.querySelector('img')).toBeNull()
    expect(doc.body.textContent).toContain('<img src=x onerror=alert(1)>')
  })
})
