import { describe, expect, test } from 'vitest'

import { localizedPath, resolveLocale, splitLocalePrefix } from '../../src/i18n/locale'

describe('resolveLocale: URL prefix, then cookie, then Accept-Language, then en', () => {
  test('the URL prefix wins over the cookie and the header', () => {
    expect(resolveLocale('/sk/sign-in', 'en', 'en-US')).toBe('sk')
    expect(resolveLocale('/sk/', null, null)).toBe('sk')
    expect(resolveLocale('/sk', null, null)).toBe('sk')
  })

  test('an unprefixed URL takes the cookie before the header', () => {
    expect(resolveLocale('/sign-in', 'sk', 'en-US')).toBe('sk')
    expect(resolveLocale('/sign-in', 'en', 'sk-SK')).toBe('en')
  })

  test('an unknown cookie value is ignored', () => {
    expect(resolveLocale('/sign-in', 'xx', 'sk')).toBe('sk')
    expect(resolveLocale('/sign-in', '', null)).toBe('en')
  })

  test('Accept-Language: exact tag, then its language, in q order', () => {
    expect(resolveLocale('/', null, 'sk-SK,en;q=0.5')).toBe('sk')
    expect(resolveLocale('/', null, 'en;q=0.2, sk;q=0.9')).toBe('sk')
    expect(resolveLocale('/', null, 'fr, sk;q=0.4')).toBe('sk')
    expect(resolveLocale('/', null, 'sk;q=0, en;q=0.1')).toBe('en')
  })

  test('de-AT falls to en when de is not shipped', () => {
    expect(resolveLocale('/', null, 'de-AT')).toBe('en')
    expect(resolveLocale('/', null, 'de-AT, de;q=0.9')).toBe('en')
  })

  test('nothing usable: en', () => {
    expect(resolveLocale('/', null, null)).toBe('en')
    expect(resolveLocale('/', null, '*')).toBe('en')
    expect(resolveLocale('/', null, ';;,,q=')).toBe('en')
  })

  test('only a whole first segment naming a shipped non-default language is a prefix', () => {
    expect(resolveLocale('/skate', null, null)).toBe('en')
    expect(resolveLocale('/en/sign-in', 'sk', null)).toBe('sk') // English has no prefix: /en/... is an ordinary path
    expect(resolveLocale('/SK/sign-in', null, null)).toBe('en')
  })
})

describe('splitLocalePrefix', () => {
  test('separates the language from the page path', () => {
    expect(splitLocalePrefix('/sk/sign-in')).toEqual({ locale: 'sk', path: '/sign-in' })
    expect(splitLocalePrefix('/sk/')).toEqual({ locale: 'sk', path: '/' })
    expect(splitLocalePrefix('/sk')).toEqual({ locale: 'sk', path: '/' })
    expect(splitLocalePrefix('/sign-in')).toEqual({ locale: null, path: '/sign-in' })
    expect(splitLocalePrefix('/')).toEqual({ locale: null, path: '/' })
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
