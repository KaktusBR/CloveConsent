// Integration tests against the real vanilla-cookieconsent (no library mocks) in jsdom.
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import * as CC from 'vanilla-cookieconsent'
import { defineConsent } from '../src/config'
import { createConsent, type Consent } from '../src/client'
import { createVccDriver } from '../src/driver-vcc'
import { parseConsent, readCookieValue } from '../src/state'
import { openStreetMap, theme, youtube } from '../src/catalog'
import sk from '../src/locales/sk'

const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o))
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)) }
const cfg = (revision = 2, services = [theme(), youtube()], ui?: Parameters<typeof defineConsent>[0]['ui']) =>
  defineConsent({ locales: ['sk'], defaultLocale: 'sk', packs: [sk], revision, services, ui })
const stored = () => parseConsent(readCookieValue(document.cookie, 'cc_cookie'))
const setStale = (categories: string[]) => {
  document.cookie = `cc_cookie=${enc({
    categories, revision: 0, data: { siteRevision: 1, revisions: { theme: 1, youtube: 1 } },
    consentTimestamp: '2026-10-01T10:00:00.000Z', lastConsentTimestamp: '2026-10-01T10:00:00.000Z',
    consentId: 'abc-12345678', services: {}, languageCode: 'sk', expirationTime: Date.now() + 1e9,
  })}; path=/`
}
const clearCookie = () => { document.cookie = 'cc_cookie=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT' }

async function load(revision = 2, services?: Parameters<typeof cfg>[1], ui?: Parameters<typeof cfg>[2]): Promise<Consent> {
  CC.reset(false)
  document.body.innerHTML = ''
  document.documentElement.className = ''
  const c = createConsent(cfg(revision, services, ui), { driver: createVccDriver() })
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
  test('acceptCategory (what the embed "Allow" button does) hides the banner and records revisions', async () => {
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

describe('real vanilla-cookieconsent: per-service cookie shape', () => {
  test('the engine stores services keyed by category and the client allows only the accepted one', async () => {
    const c = await load()
    CC.acceptCategory(['media', 'functional'])
    CC.acceptService(['youtube'], 'media')
    CC.acceptService([], 'functional')
    await flush()
    const st = stored()!
    expect(st.services).toEqual({ necessary: [], media: ['youtube'], functional: [] })
    expect(c.isAllowed('youtube')).toBe(true)
    expect(c.isAllowed('theme')).toBe(false)
  })
  test('accepting all lists every declared service', async () => {
    const c = await load()
    click('.cm__btn[data-role="all"]')
    await flush()
    expect(stored()!.services).toEqual({ necessary: [], media: ['youtube'], functional: ['theme'] })
    expect(c.isAllowed('theme')).toBe(true)
  })
})

describe('real vanilla-cookieconsent: acceptServices and old cookies', () => {
  const three = () => [theme(), youtube(), openStreetMap()]
  const setOld = (categories: string[]) => {
    // written before per-service consent: no `services` field at all
    document.cookie = `cc_cookie=${enc({
      categories, revision: 0, data: { siteRevision: 2, revisions: { theme: 1, youtube: 1, openstreetmap: 1 } },
      consentTimestamp: '2026-10-01T10:00:00.000Z', lastConsentTimestamp: '2026-10-01T10:00:00.000Z',
      consentId: 'abc-12345678', languageCode: 'sk', expirationTime: Date.now() + 1e9,
    })}; path=/`
  }

  test('acceptServices stores exactly the listed services, fires one change and serviceAccepted agrees', async () => {
    const c = await load(2, three())
    click('.cm__btn[data-role="necessary"]')
    await flush()
    const seen: string[] = []
    c.on('decision', (i) => seen.push(`${i.kind}:${i.changed.join(',')}:${i.changedServices.join(',')}`))
    c.setServices(['openstreetmap'])
    await flush()
    expect(stored()!.services).toEqual({ necessary: [], media: ['openstreetmap'], functional: [] })
    expect(stored()!.categories).toEqual(['necessary', 'media'])
    expect(seen).toEqual(['change:media:openstreetmap'])
    expect(c.isAllowed('openstreetmap')).toBe(true)
    expect(c.isAllowed('youtube')).toBe(false)
    expect(c.isAllowed('theme')).toBe(false)
    expect(banner()).toBe(false)
  })

  test('acceptServices on the first answer is one first decision and hides the banner', async () => {
    const c = await load(2, three())
    const seen: string[] = []
    c.on('decision', (i) => seen.push(i.kind))
    c.setServices(['youtube', 'theme'])
    await flush()
    expect(banner()).toBe(false)
    expect(stored()!.services).toEqual({ necessary: [], media: ['youtube'], functional: ['theme'] })
    expect(seen).toEqual(['first'])
  })

  test('turning one service off inside an accepted category is one change that lists it', async () => {
    const c = await load(2, three())
    c.setServices(['youtube', 'openstreetmap'])
    await flush()
    const seen: string[] = []
    c.on('decision', (i) => seen.push(`${i.kind}:${i.changed.join(',')}:${i.changedServices.join(',')}`))
    c.setServices(['youtube'])
    await flush()
    expect(stored()!.services).toEqual({ necessary: [], media: ['youtube'], functional: [] })
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatch(/^change::openstreetmap$/)
    expect(c.isAllowed('openstreetmap')).toBe(false)
    expect(c.isAllowed('youtube')).toBe(true)
  })

  test('withdraw() rejects everything and is recorded as a withdraw', async () => {
    const c = await load(2, three())
    c.setServices(['youtube', 'theme'])
    await flush()
    const seen: string[] = []
    const idBefore = stored()!.consentId
    c.on('decision', (i) => seen.push(`${i.kind}:${i.changedServices.sort().join(',')}`))
    c.withdraw()
    await flush()
    expect(stored()!.categories).toEqual(['necessary'])
    // the consent reference survives a withdrawal (it is the proof of the earlier consent) and the banner is not shown again
    expect(stored()!.consentId).toBe(idBefore)
    expect(banner()).toBe(false)
    expect(prefs()).toBe(false)
    expect(seen).toEqual(['withdraw:theme,youtube'])
    expect(c.isAllowed('youtube')).toBe(false)
  })

  test('an old cookie without a services field: what the engine does on init, and every service of an accepted category stays allowed', async () => {
    setOld(['necessary', 'functional', 'media'])
    const c = await load(2, three())
    await flush()
    const raw = JSON.parse(decodeURIComponent(readCookieValue(document.cookie, 'cc_cookie')!))
    // pinned: the engine neither rewrites nor drops the cookie on init, so it still has no `services` field
    expect(raw.services).toBeUndefined()
    expect(stored()!.services).toBeNull()
    expect(raw.categories).toEqual(['necessary', 'functional', 'media'])
    expect(banner()).toBe(false)
    expect(c.isAllowed('theme')).toBe(true)
    expect(c.isAllowed('youtube')).toBe(true)
    expect(c.isAllowed('openstreetmap')).toBe(true)
  })
})

describe('real vanilla-cookieconsent: layout and dialog from ui', () => {
  const three = () => [theme(), youtube(), openStreetMap()]
  const serviceToggles = () => [...document.querySelectorAll<HTMLInputElement>('.pm input.section__toggle[data-category]')]
  const groupToggles = () => [...document.querySelectorAll<HTMLInputElement>('.pm input.section__toggle:not([data-category])')]

  test('the banner is a bottom bar by default', async () => {
    await load()
    const cm = document.querySelector('.cm')!
    expect(cm.classList.contains('cm--bar')).toBe(true)
    expect(cm.classList.contains('cm--bottom')).toBe(true)
  })
  test('banner and dialog layout follow ui', async () => {
    await load(2, undefined, { banner: { layout: 'box', position: 'top left' }, dialog: { layout: 'bar', position: 'left' } })
    const cm = document.querySelector('.cm')!
    expect(cm.classList.contains('cm--box')).toBe(true)
    expect(cm.classList.contains('cm--top')).toBe(true)
    expect(cm.classList.contains('cm--left')).toBe(true)
    click('.cm__btn[data-role="show"]')
    await flush()
    expect(document.querySelector('.pm')!.classList.contains('pm--bar')).toBe(true)
    expect(document.querySelector('.pm')!.classList.contains('pm--left')).toBe(true)
  })
  test('the dialog has one toggle per declared service, labelled with the service title, next to the group toggles', async () => {
    await load(2, three())
    click('.cm__btn[data-role="show"]')
    await flush()
    expect(serviceToggles().map((i) => `${i.dataset.category}:${i.value}`)).toEqual(['functional:theme', 'media:youtube', 'media:openstreetmap'])
    expect([...document.querySelectorAll('.pm .toggle-service .toggle__label')].map((l) => l.textContent)).toEqual(['Vzhľad stránky', 'Videá YouTube', 'Mapy OpenStreetMap'])
    expect(groupToggles().map((i) => i.value)).toEqual(['necessary', 'functional', 'media'])
  })
  test('a service toggled in the dialog and saved goes through the client and reads back from it', async () => {
    const c = await load(2, three())
    const seen: string[] = []
    c.on('decision', (i) => seen.push(`${i.kind}:${i.changed.join(',')}:${i.changedServices.join(',')}`))
    click('.cm__btn[data-role="show"]')
    await flush()
    serviceToggles().find((i) => i.value === 'openstreetmap')!.click()
    await flush()
    click('.pm__btn[data-role="save"]')
    await flush()
    expect(stored()!.services).toEqual({ necessary: [], media: ['openstreetmap'], functional: [] })
    expect(c.isAllowed('openstreetmap')).toBe(true)
    expect(c.isAllowed('youtube')).toBe(false)
    expect(seen).toEqual(['first:media:openstreetmap'])
    // the dialog reads the stored state back
    c.open()
    await flush()
    expect(serviceToggles().filter((i) => i.checked).map((i) => i.value)).toEqual(['openstreetmap'])
  })
  test('serviceToggles:false renders group toggles only', async () => {
    await load(2, three(), { manager: { serviceToggles: false } })
    click('.cm__btn[data-role="show"]')
    await flush()
    expect(serviceToggles()).toHaveLength(0)
    expect(document.querySelectorAll('.pm .pm__service')).toHaveLength(0)
    expect(groupToggles().map((i) => i.value)).toEqual(['necessary', 'functional', 'media'])
  })
  test('serviceToggles:false: a group toggle accepts every service of that category', async () => {
    const c = await load(2, three(), { manager: { serviceToggles: false } })
    click('.cm__btn[data-role="show"]')
    await flush()
    groupToggles().find((i) => i.value === 'media')!.click()
    await flush()
    click('.pm__btn[data-role="save"]')
    await flush()
    expect(stored()!.categories).toEqual(['necessary', 'media'])
    expect(c.isAllowed('youtube')).toBe(true)
    expect(c.isAllowed('openstreetmap')).toBe(true)
    expect(c.isAllowed('theme')).toBe(false)
  })

  describe('without service toggles the client works per category', () => {
    const noToggles = { manager: { serviceToggles: false } }
    test('a cookie written with toggles on is honoured when the site later turns them off', async () => {
      // the visitor accepted only OpenStreetMap while per-service toggles were on
      document.cookie = `cc_cookie=${enc({
        categories: ['necessary', 'media'], revision: 0, data: { siteRevision: 2, revisions: { theme: 1, youtube: 1, openstreetmap: 1 } },
        consentTimestamp: '2026-10-01T10:00:00.000Z', lastConsentTimestamp: '2026-10-01T10:00:00.000Z',
        consentId: 'abc-12345678', services: { necessary: [], media: ['openstreetmap'], functional: [] }, languageCode: 'sk', expirationTime: Date.now() + 1e9,
      })}; path=/`
      const c = await load(2, three(), noToggles)
      expect(banner()).toBe(false)
      expect(c.isAllowed('openstreetmap')).toBe(true)
      expect(c.isAllowed('youtube')).toBe(false)
      expect(c.isAllowed('theme')).toBe(false)
    })
    test('accept all allows every service and lists the changed ones', async () => {
      const c = await load(2, three(), noToggles)
      const seen: string[] = []
      c.on('decision', (i) => seen.push(`${i.kind}:${i.changed.join(',')}:${i.changedServices.join(',')}`))
      click('.cm__btn[data-role="all"]')
      await flush()
      expect(['theme', 'youtube', 'openstreetmap'].map((id) => c.isAllowed(id))).toEqual([true, true, true])
      expect(seen).toEqual(['first:functional,media:theme,youtube,openstreetmap'])
    })
    test('setServices accepts the categories of the listed services and records one decision', async () => {
      const c = await load(2, three(), noToggles)
      const seen: string[] = []
      c.on('decision', (i) => seen.push(`${i.kind}:${i.changed.join(',')}`))
      c.setServices(['youtube'])
      await flush()
      expect(stored()!.categories).toEqual(['necessary', 'media'])
      expect(c.isAllowed('youtube')).toBe(true)
      expect(c.isAllowed('openstreetmap')).toBe(true)
      expect(c.isAllowed('theme')).toBe(false)
      expect(seen).toEqual(['first:media'])
      expect(banner()).toBe(false)
    })
    test('acceptService keeps the categories already accepted', async () => {
      const c = await load(2, three(), noToggles)
      c.setServices(['theme'])
      await flush()
      c.acceptService('youtube')
      await flush()
      expect(stored()!.categories).toEqual(['necessary', 'functional', 'media'])
      expect(c.isAllowed('theme')).toBe(true)
      expect(c.isAllowed('youtube')).toBe(true)
    })
    test('withdraw() lists every service that was allowed', async () => {
      const c = await load(2, three(), noToggles)
      c.acceptAll()
      await flush()
      const seen: string[] = []
      c.on('decision', (i) => seen.push(`${i.kind}:${i.changedServices.sort().join(',')}`))
      c.withdraw()
      await flush()
      expect(seen).toEqual(['withdraw:openstreetmap,theme,youtube'])
      expect(c.isAllowed('youtube')).toBe(false)
    })
    test('setServices([]) rejects everything', async () => {
      const c = await load(2, three(), noToggles)
      c.setServices(['youtube'])
      await flush()
      c.setServices([])
      await flush()
      expect(stored()!.categories).toEqual(['necessary'])
      expect(c.isAllowed('youtube')).toBe(false)
    })
  })
})
