import { describe, expect, test } from 'vitest'
import { defineConsent } from '../src/config'
import { theme, youtube } from '../src/catalog'
import sk from '../src/locales/sk'
import { buildStoredData, needsPrompt, parseConsent, readCookieValue, serviceAccepted } from '../src/state'

const enc = (o: unknown) => encodeURIComponent(JSON.stringify(o))
const good = (extra: object = {}) => enc({
  consentId: 'abc-12345678', categories: ['necessary', 'media'], lastConsentTimestamp: '2026-10-14T10:00:00.000Z',
  data: { siteRevision: 1, revisions: { youtube: 1, theme: 1 } }, ...extra,
})
const config = (over: object = {}, services = [youtube(), theme()]) =>
  defineConsent({ locales: ['sk'], defaultLocale: 'sk', packs: [sk], revision: 1, services, ...over } as any)

describe('readCookieValue', () => {
  test('finds a named cookie among others', () => {
    expect(readCookieValue('a=1; cc_cookie=xyz; b=2', 'cc_cookie')).toBe('xyz')
    expect(readCookieValue('a=1', 'cc_cookie')).toBeNull()
    expect(readCookieValue('xcc_cookie=1', 'cc_cookie')).toBeNull()
  })
})

describe('parseConsent (review focus 1)', () => {
  test('parses a valid cookie', () => {
    const s = parseConsent(good())!
    expect(s.categories).toEqual(['necessary', 'media'])
    expect(s.siteRevision).toBe(1)
    expect(s.revisions).toEqual({ youtube: 1, theme: 1 })
  })
  test('always includes necessary', () => {
    expect(parseConsent(good({ categories: ['media'] }))!.categories).toContain('necessary')
  })
  test.each([
    ['null', null], ['empty', ''], ['not json', 'not%20json'], ['bad percent', '%E0%A4%A'],
    ['array', enc([])], ['string', enc('x')],
    ['huge', 'a'.repeat(5000)],
    ['bad id', good({ consentId: '<script>' })],
    ['bad categories type', good({ categories: 'media' })],
  ])('treats %s as undecided', (_n, raw) => {
    expect(parseConsent(raw as string | null)).toBeNull()
  })
  test('drops unknown categories and bad revision entries, never pollutes prototypes', () => {
    const raw = '{"consentId":"abc-12345678","categories":["necessary","hacker","media"],"data":{"siteRevision":1,"revisions":{"__proto__":{"x":1},"constructor":2,"ok-id":3,"bad id":4,"neg":-1}}}'
    const s = parseConsent(encodeURIComponent(raw))!
    expect(s.categories).toEqual(['necessary', 'media'])
    expect(s.revisions).toEqual({ 'ok-id': 3 })
    expect(({} as any).x).toBeUndefined()
  })
  test('missing data means unknown revisions', () => {
    const s = parseConsent(enc({ consentId: 'abc-12345678', categories: ['necessary'] }))!
    expect(s.siteRevision).toBeNull()
    expect(s.revisions).toEqual({})
  })
})

describe('parseConsent services', () => {
  test('reads services keyed by category', () => {
    const s = parseConsent(good({ services: { media: ['youtube'], functional: [] } }))!
    expect(s.services).toEqual({ media: ['youtube'], functional: [] })
  })
  test('a cookie without a services field has services null', () => {
    expect(parseConsent(good())!.services).toBeNull()
  })
  test.each([
    ['array', []], ['string', 'x'], ['number', 3],
  ])('a services field that is %s is treated as missing', (_n, v) => {
    expect(parseConsent(good({ services: v }))!.services).toBeNull()
  })
  test('drops entries that are not arrays of valid service ids, unknown categories and prototype keys', () => {
    const raw = '{"consentId":"abc-12345678","categories":["necessary","media"],"services":{"media":["youtube","bad id",3,"UPPER"],"functional":"theme","hacker":["x"],"analytics":{"0":"a"},"__proto__":["pwn"],"constructor":["pwn"]}}'
    const s = parseConsent(encodeURIComponent(raw))!
    expect(s.services).toEqual({ media: ['youtube'] })
    expect(({} as any).pwn).toBeUndefined()
    expect(Object.getPrototypeOf(s.services)).toBeNull()
  })
})

describe('serviceAccepted', () => {
  const state = (services: Record<string, string[]> | null, categories = ['necessary', 'media']) =>
    parseConsent(good({ categories, ...(services ? { services } : {}) }))!
  test('necessary services are always accepted', () => {
    expect(serviceAccepted(state({}, ['necessary']), theme({ category: 'necessary' } as any))).toBe(true)
  })
  test('a listed service of an accepted category is accepted', () => {
    expect(serviceAccepted(state({ media: ['youtube'] }), youtube())).toBe(true)
  })
  test('an unlisted service of an accepted category is not accepted', () => {
    expect(serviceAccepted(state({ media: ['openstreetmap'] }), youtube())).toBe(false)
    expect(serviceAccepted(state({}), youtube())).toBe(false)
  })
  test('a listed service whose category is not accepted is not accepted', () => {
    expect(serviceAccepted(state({ media: ['youtube'] }, ['necessary']), youtube())).toBe(false)
  })
  test('old cookie (services null) accepts every service of an accepted category (review focus 1)', () => {
    const s = state(null)
    expect(s.services).toBeNull()
    expect(() => serviceAccepted(s, youtube())).not.toThrow()
    expect(serviceAccepted(s, youtube())).toBe(true)
    expect(serviceAccepted(s, theme())).toBe(false) // functional category not accepted
  })
})

describe('needsPrompt', () => {
  test('no state prompts', () => expect(needsPrompt(null, config())).toBe(true))
  test('matching state does not prompt', () => expect(needsPrompt(parseConsent(good()), config())).toBe(false))
  test('site revision bump prompts', () => expect(needsPrompt(parseConsent(good()), config({ revision: 2 }))).toBe(true))
  test('selected service revision bump prompts', () => {
    const y = youtube(); y.catalogRevision = 2
    expect(needsPrompt(parseConsent(good()), config({}, [y, theme()]))).toBe(true)
  })
  test('unselected service revision change does not prompt', () => {
    // visitor consented when [theme, youtube] were selected; the site now selects only [theme]
    const s = parseConsent(good())!
    expect(s.revisions.youtube).toBe(1)
    // the youtube preset is bumped, but only in a config this site does not use
    const bumped = youtube(); bumped.catalogRevision = 2
    const elsewhere = config({}, [theme(), bumped])
    expect(needsPrompt(s, elsewhere)).toBe(true) // sanity: the bump is real and would prompt if selected
    const current = config({}, [theme()])
    expect(current.services.map((x) => x.id)).toEqual(['theme'])
    expect(needsPrompt(s, current)).toBe(false)
  })
  test('stored revision higher than catalogRevision does not prompt', () => {
    const s = parseConsent(enc({ consentId: 'abc-12345678', categories: ['necessary'], data: { siteRevision: 1, revisions: { youtube: 3, theme: 2 } } }))
    expect(needsPrompt(s, config())).toBe(false)
  })
  test('lowered site revision prompts', () => {
    const s = parseConsent(enc({ consentId: 'abc-12345678', categories: ['necessary'], data: { siteRevision: 2, revisions: { youtube: 1, theme: 1 } } }))
    expect(needsPrompt(s, config({ revision: 1 }))).toBe(true)
  })
  test('newly selected service prompts', () => {
    const s = parseConsent(enc({ consentId: 'abc-12345678', categories: ['necessary'], data: { siteRevision: 1, revisions: { theme: 1 } } }))
    expect(needsPrompt(s, config())).toBe(true)
  })
  test('removed service does not prompt', () => {
    expect(needsPrompt(parseConsent(good()), config({}, [theme()]))).toBe(false)
  })
  test('cookie without our data (e.g. old cw cookie) prompts', () => {
    const s = parseConsent(enc({ consentId: 'abc-12345678', categories: ['necessary'] }))
    expect(needsPrompt(s, config())).toBe(true)
  })
})

test('buildStoredData lists current selected revisions', () => {
  expect(buildStoredData(config())).toEqual({ siteRevision: 1, revisions: { youtube: 1, theme: 1 } })
})
