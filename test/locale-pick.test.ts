import { describe, expect, test } from 'vitest'
import { pickLocale } from '../src/locale-pick'

const available = ['en', 'sk', 'de', 'pt']

describe('pickLocale', () => {
  test('an exact match wins', () => {
    expect(pickLocale(available, 'sk', ['de'], 'en')).toBe('sk')
  })
  test('an exact match ignores the case of the page language', () => {
    expect(pickLocale(['en', 'pt-BR'], 'pt-br', [], 'en')).toBe('pt-BR')
  })
  test('de-AT gives de', () => {
    expect(pickLocale(available, 'de-AT', [], 'en')).toBe('de')
  })
  test('pt-BR with only pt available gives pt', () => {
    expect(pickLocale(available, 'pt-BR', [], 'en')).toBe('pt')
  })
  test('the longest available prefix wins', () => {
    expect(pickLocale(['en', 'zh', 'zh-Hant'], 'zh-Hant-TW', [], 'en')).toBe('zh-Hant')
  })
  test('a missing lang gives the fallback', () => {
    expect(pickLocale(available, null, [], 'sk')).toBe('sk')
    expect(pickLocale(available, '', [], 'sk')).toBe('sk')
  })
  test('a page language that is not enabled falls to the preferred list, in order', () => {
    expect(pickLocale(available, 'fr', ['fr-CA', 'de-CH', 'sk'], 'en')).toBe('de')
  })
  test('the page language beats the preferred list', () => {
    expect(pickLocale(available, 'sk', ['de'], 'en')).toBe('sk')
  })
  test('nothing matching gives the fallback', () => {
    expect(pickLocale(available, 'fr', ['it', 'es-MX'], 'en')).toBe('en')
  })
  test('an invalid page language is treated as missing', () => {
    expect(pickLocale(available, 'not a tag', [], 'sk')).toBe('sk')
  })
  test('returns the enabled tag as written, not the visitor tag', () => {
    expect(pickLocale(['en', 'pt-BR'], 'pt-BR', [], 'en')).toBe('pt-BR')
  })
})
