// Integration tests against the real vanilla-cookieconsent (no library mocks) in jsdom.
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import * as CC from 'vanilla-cookieconsent'
import { defineConsent } from '../src/config'
import { createConsent, type Consent } from '../src/client'
import { createVccDriver } from '../src/driver-vcc'
import { parseConsent, readCookieValue } from '../src/state'
import { theme, youtube } from '../src/catalog'

const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o))
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)) }
const cfg = (revision = 2) => defineConsent({ locales: ['sk'], defaultLocale: 'sk', revision, services: [theme(), youtube()] })
const stored = () => parseConsent(readCookieValue(document.cookie, 'cc_cookie'))
const setStale = (categories: string[]) => {
  document.cookie = `cc_cookie=${enc({
    categories, revision: 0, data: { siteRevision: 1, revisions: { theme: 1, youtube: 1 } },
    consentTimestamp: '2026-10-01T10:00:00.000Z', lastConsentTimestamp: '2026-10-01T10:00:00.000Z',
    consentId: 'abc-12345678', services: {}, languageCode: 'sk', expirationTime: Date.now() + 1e9,
  })}; path=/`
}
const clearCookie = () => { document.cookie = 'cc_cookie=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT' }

async function load(revision = 2): Promise<Consent> {
  CC.reset(false)
  document.body.innerHTML = ''
  document.documentElement.className = ''
  const c = createConsent(cfg(revision), { driver: createVccDriver() })
  c.init()
  await flush()
  return c
}
const banner = () => document.documentElement.classList.contains('show--consent')
const prefs = () => document.documentElement.classList.contains('show--preferences')
const click = (sel: string) => {
  const el = document.querySelector<HTMLElement>(sel)
  if (!el) throw new Error(`missing ${sel}`)
  el.click()
}

beforeEach(() => { clearCookie() })
afterEach(() => { CC.reset(false); clearCookie() })

describe('real vanilla-cookieconsent: re-consent decisions', () => {
  test('stale revision + Manage + close (X) does not record revisions; banner returns on next load', async () => {
    setStale(['necessary', 'functional'])
    await load()
    expect(banner()).toBe(true)
    click('.cm__btn[data-role="show"]')
    await flush()
    expect(prefs()).toBe(true)
    click('.pm__close-btn')
    await flush()
    expect(prefs()).toBe(false)
    expect(stored()!.siteRevision).toBe(1)
    await load()
    expect(banner()).toBe(true)
  })

  test('stale revision + Escape in preferences does not record revisions', async () => {
    setStale(['necessary'])
    await load()
    click('.cm__btn[data-role="show"]')
    await flush()
    document.documentElement.dispatchEvent(new KeyboardEvent('keydown', { keyCode: 27, bubbles: true } as KeyboardEventInit))
    await flush()
    expect(stored()!.siteRevision).toBe(1)
  })

  test.each([
    ['all', ['necessary', 'functional']],
    ['necessary', ['necessary']],
    ['necessary', ['necessary', 'functional']],
    ['all', ['necessary', 'functional', 'media']],
  ])('stale revision + banner %s (stored %j) records revisions; no banner on next load', async (role, cats) => {
    setStale(cats)
    await load()
    expect(banner()).toBe(true)
    click(`.cm__btn[data-role="${role}"]`)
    await flush()
    expect(banner()).toBe(false)
    expect(stored()).toMatchObject({ siteRevision: 2, revisions: { theme: 1, youtube: 1 } })
    await load()
    expect(banner()).toBe(false)
  })

  test('stale revision + Manage + Save records revisions', async () => {
    setStale(['necessary', 'media'])
    await load()
    click('.cm__btn[data-role="show"]')
    await flush()
    click('.pm__btn[data-role="save"]')
    await flush()
    expect(banner()).toBe(false)
    expect(stored()!.siteRevision).toBe(2)
    await load()
    expect(banner()).toBe(false)
  })

  test('first consent via banner records revisions', async () => {
    await load()
    expect(banner()).toBe(true)
    click('.cm__btn[data-role="necessary"]')
    await flush()
    expect(stored()).toMatchObject({ siteRevision: 2, categories: ['necessary'] })
    await load()
    expect(banner()).toBe(false)
  })

  test('after re-confirming with unchanged categories, newly allowed services load', async () => {
    setStale(['necessary', 'functional', 'media'])
    const c = await load()
    expect(c.isAllowed('theme')).toBe(false)
    click('.cm__btn[data-role="all"]')
    await flush()
    expect(c.isAllowed('theme')).toBe(true)
    expect(c.isAllowed('youtube')).toBe(true)
  })
})

describe('real vanilla-cookieconsent: programmatic decisions hide the UI', () => {
  test('acceptCategory (embed "Allow category") hides the banner and records revisions', async () => {
    const c = await load()
    expect(banner()).toBe(true)
    c.acceptCategory('media')
    await flush()
    expect(banner()).toBe(false)
    expect(stored()).toMatchObject({ siteRevision: 2, categories: ['necessary', 'media'] })
  })
  test('window.CookieConsent.acceptAll hides the banner and preferences', async () => {
    await load()
    click('.cm__btn[data-role="show"]')
    await flush()
    expect(prefs()).toBe(true)
    ;(window as unknown as { CookieConsent: { acceptAll(): void } }).CookieConsent.acceptAll()
    await flush()
    expect(banner()).toBe(false)
    expect(prefs()).toBe(false)
    expect(stored()!.siteRevision).toBe(2)
  })
  test('rejectAll on a stale cookie with unchanged categories hides the banner and records revisions', async () => {
    setStale(['necessary'])
    const c = await load()
    expect(banner()).toBe(true)
    c.rejectAll()
    await flush()
    expect(banner()).toBe(false)
    expect(stored()!.siteRevision).toBe(2)
  })
})
