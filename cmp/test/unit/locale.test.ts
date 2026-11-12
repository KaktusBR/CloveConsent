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

  /** On this site: one leading slash, no backslash or control character, and it resolves to the same host. */
  function expectOnSite(target: string, label: string) {
    expect(target, label).toMatch(/^\/(?![/\\])/)
    expect(target, label).not.toMatch(/\\|%5c|%2f%2f/i)
    expect([...target].every((c) => c.charCodeAt(0) > 0x1f && c.charCodeAt(0) !== 0x7f), label).toBe(true)
    expect(new URL(target, 'https://site.test').host, label).toBe('site.test')
  }

  test('the final target stays on this site, whatever the language prefix or path normalisation does', () => {
    const tricks = [
      '/sk//evil.test/x',
      '/.//evil.test/x',
      '/a/..//evil.test',
      '/sk/.//evil.test',
      '/sk/..//evil.test',
      '/sk///evil.test',
      '%2F%2Fevil.test',
      '/%2F%2Fevil.test',
      '/sk/%2F%2Fevil.test',
      '/\\evil.test',
      '/sk/\\evil.test',
      '/sk/%5c%5cevil.test',
      '/%5Cevil.test',
      '/\t/evil.test',
      '/sk/\t/evil.test',
      '/sk/\n/evil.test',
      '/sk\t//evil.test',
      '/\r\n/evil.test',
    ]
    for (const next of tricks) {
      for (const locale of ['en', 'sk'] as const) {
        const target = localeSwitchTarget(next, locale)
        expectOnSite(target, `${JSON.stringify(next)} in ${locale} → ${target}`)
      }
    }
    expect(localeSwitchTarget('/sk//evil.test/x', 'en')).toBe('/evil.test/x')
    expect(localeSwitchTarget('/a/..//evil.test', 'en')).toBe('/evil.test')
  })

  test('repeated leading slashes are collapsed before localizing', () => {
    expect(localeSwitchTarget('/sk///sign-in?x=1', 'en')).toBe('/sign-in?x=1')
    expect(localeSwitchTarget('/sign-in//x', 'sk')).toBe('/sk/sign-in//x')
  })
})
