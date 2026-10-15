import { describe, expect, test } from 'vitest'
import { canonicalLocale, localeChain, localePrefixes } from '../src/i18n/locale'

describe('canonicalLocale', () => {
  test.each([['en', 'en'], ['pt-br', 'pt-BR'], ['PT-BR', 'pt-BR'], ['zh-hant-tw', 'zh-Hant-TW'], ['sk', 'sk'], ['ar', 'ar']])(
    'accepts %s as %s', (input, expected) => expect(canonicalLocale(input)).toBe(expected))
  test.each(['', 'e', '__proto__', 'constructor', 'en_US', 'en us', '<b>', 'en-', 'a'.repeat(36), 'english-language-name-way-too-long-for-a-tag-x'])(
    'rejects %j', (input) => expect(canonicalLocale(input)).toBeNull())
  test.each([null, undefined, 5, {}, []])('rejects non-string %j', (input) => expect(canonicalLocale(input)).toBeNull())
})

describe('localePrefixes and localeChain', () => {
  test('prefixes are longest first', () => expect(localePrefixes('zh-Hant-TW')).toEqual(['zh-Hant-TW', 'zh-Hant', 'zh']))
  test('a bare language has one prefix', () => expect(localePrefixes('sk')).toEqual(['sk']))
  test('chain: prefixes, then site default, then English', () => {
    expect(localeChain('pt-BR', 'sk')).toEqual(['pt-BR', 'pt', 'sk', 'en'])
    expect(localeChain('en-GB', 'sk')).toEqual(['en-GB', 'en', 'sk'])
    expect(localeChain('en', 'en')).toEqual(['en'])
  })
})
