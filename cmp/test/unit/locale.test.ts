import { describe, expect, test } from 'vitest'

import {
  localeFromParam,
  localeOfPath,
  localeStaticPaths,
  localeSwitchHref,
  localeSwitchTarget,
  localizedPath,
  preferredLocale,
  splitLocalePrefix,
} from '../../src/i18n/locale'

describe('localeOfPath: the URL alone names the language of a page', () => {
  test('a shipped non-default prefix is that language, everything else is English', () => {
    expect(localeOfPath('/sk/sign-in')).toBe('sk')
    expect(localeOfPath('/sk/')).toBe('sk')
    expect(localeOfPath('/sk')).toBe('sk')
    expect(localeOfPath('/sign-in')).toBe('en')
    expect(localeOfPath('/')).toBe('en')
  })

  test('only a whole first segment naming a shipped non-default language is a prefix', () => {
    expect(localeOfPath('/skate')).toBe('en')
    expect(localeOfPath('/en/sign-in')).toBe('en') // English has no prefix: /en/... is an ordinary path
    expect(localeOfPath('/SK/sign-in')).toBe('en')
  })
})

describe('the optional [...locale] route segment', () => {
  test('none is English, a shipped non-default tag is that language, anything else is no page', () => {
    expect(localeFromParam(undefined)).toBe('en')
    expect(localeFromParam('sk')).toBe('sk')
    expect(localeFromParam('en')).toBeNull()
    expect(localeFromParam('de')).toBeNull()
    expect(localeFromParam('sk/extra')).toBeNull()
  })

  test('a prerendered page gets one copy per shipped language', () => {
    expect(localeStaticPaths()).toEqual([{ params: { locale: undefined } }, { params: { locale: 'sk' } }])
  })
})

describe('preferredLocale (never used to redirect or to pick a page language)', () => {
  test('the cookie, then Accept-Language by q order, then en', () => {
    expect(preferredLocale('sk', 'en-US')).toBe('sk')
    expect(preferredLocale('xx', 'sk-SK,en;q=0.5')).toBe('sk')
    expect(preferredLocale(null, 'en;q=0.2, sk;q=0.9')).toBe('sk')
    expect(preferredLocale(null, 'fr, sk;q=0.4')).toBe('sk')
    expect(preferredLocale(null, 'sk;q=0, en;q=0.1')).toBe('en')
    expect(preferredLocale(null, null)).toBe('en')
    expect(preferredLocale(null, '*')).toBe('en')
  })

  test('de-AT falls to en when de is not shipped', () => {
    expect(preferredLocale(null, 'de-AT')).toBe('en')
    expect(preferredLocale(null, 'de-AT, de;q=0.9')).toBe('en')
  })
})

describe('splitLocalePrefix', () => {
  test('separates the language from the page path', () => {
    expect(splitLocalePrefix('/sk/sign-in')).toEqual({ locale: 'sk', path: '/sign-in' })
    expect(splitLocalePrefix('/sk/')).toEqual({ locale: 'sk', path: '/' })
    expect(splitLocalePrefix('/sk')).toEqual({ locale: 'sk', path: '/' })
    expect(splitLocalePrefix('/sign-in')).toEqual({ locale: null, path: '/sign-in' })
  })
})

describe('localizedPath', () => {
  test('English URLs have no prefix, other languages do', () => {
    expect(localizedPath('/sign-in', 'en')).toBe('/sign-in')
    expect(localizedPath('/sign-in', 'sk')).toBe('/sk/sign-in')
    expect(localizedPath('/', 'en')).toBe('/')
    expect(localizedPath('/', 'sk')).toBe('/sk/')
  })

  test('round-trips through splitLocalePrefix', () => {
    for (const path of ['/', '/sign-in', '/a/b']) {
      expect(splitLocalePrefix(localizedPath(path, 'sk'))).toEqual({ locale: 'sk', path })
    }
  })
})

describe('the language switcher endpoint', () => {
  test('links go through /api/locale with the target language and the current page', () => {
    expect(localeSwitchHref('/sign-in?x=1', 'sk')).toBe('/api/locale?to=sk&next=%2Fsign-in%3Fx%3D1')
  })

  test('sends the reader to the same page in the chosen language', () => {
    expect(localeSwitchTarget('/sign-in?x=1', 'sk')).toBe('/sk/sign-in?x=1')
    expect(localeSwitchTarget('/sk/sign-in?x=1', 'en')).toBe('/sign-in?x=1')
    expect(localeSwitchTarget('/sk/', 'en')).toBe('/')
    expect(localeSwitchTarget('/', 'sk')).toBe('/sk/')
  })

  test('anything but a plain same-site path becomes the home page', () => {
    for (const next of [null, '', 'sign-in', '//evil.test/x', '/\\evil.test', 'https://evil.test/', 'javascript:alert(1)', '/%0d%0aSet-Cookie:x', '/a\nb', '/\t/evil.test/x', '/\n/evil.test/x']) {
      const target = localeSwitchTarget(next, 'sk')
      expect(target.startsWith('/sk/'), `${next} → ${target}`).toBe(true)
      expect(target).not.toContain('evil')
    }
    expect(localeSwitchTarget('//evil.test/x', 'en')).toBe('/')
  })
})
