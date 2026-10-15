import { describe, expect, test } from 'vitest'
import { validatePack } from '../src/i18n/pack'
import { ConsentConfigError } from '../src/validate'

const good = () => ({
  locale: 'pl', reviewed: false,
  messages: { acceptAll: 'Zaakceptuj wszystko' },
  catalog: {
    youtube: { title: 'Filmy YouTube', description: 'Osadzone filmy.' },
    theme: { storage: { theme: { expiry: 'Bez końca', purpose: 'Pamięta motyw.' } } },
    resend: { dataCategories: ['Adres e-mail'], purpose: 'Wysyłanie e-maili.' },
  },
})

describe('validatePack', () => {
  test('accepts a valid, partial pack', () => expect(() => validatePack(good(), 'p')).not.toThrow())
  test('accepts an empty pack', () => expect(() => validatePack({ locale: 'xx', reviewed: false }, 'p')).not.toThrow())

  test.each([
    ['not an object', null],
    ['array', []],
    ['locale not a tag', { ...good(), locale: 'en_US' }],
    ['locale not canonical', { ...good(), locale: 'pt-br' }],
    ['reviewed not boolean', { ...good(), reviewed: 'yes' }],
    ['messages null', { ...good(), messages: null }],
    ['catalog null', { ...good(), catalog: null }],
    ['unknown top-level key', { ...good(), extra: 1 }],
    ['unknown message key', { ...good(), messages: { nope: 'x' } }],
    ['html in a message', { ...good(), messages: { acceptAll: '<b>x</b>' } }],
    ['html in a catalog text', { ...good(), catalog: { youtube: { title: 'a<b' } } }],
    ['unknown entry field', { ...good(), catalog: { youtube: { colour: 'x' } } }],
    ['bad entry id', { ...good(), catalog: { 'Bad Id': { title: 'x' } } }],
    ['dataCategories not an array', { ...good(), catalog: { resend: { dataCategories: 'x' } } }],
    ['dataCategories item not text', { ...good(), catalog: { resend: { dataCategories: [''] } } }],
    ['bad storage name', { ...good(), catalog: { theme: { storage: { 'a;b': { expiry: 'x' } } } } }],
    ['unknown storage field', { ...good(), catalog: { theme: { storage: { theme: { colour: 'x' } } } } }],
  ])('rejects %s', (_name, pack) => {
    expect(() => validatePack(pack, 'p')).toThrow(ConsentConfigError)
  })

  test('rejects an own __proto__ entry id (JSON.parse creates one)', () => {
    const pack = JSON.parse('{"locale":"pl","reviewed":false,"catalog":{"__proto__":{"title":"x"}}}')
    expect(() => validatePack(pack, 'p')).toThrow(ConsentConfigError)
  })
  test('error messages name the path', () => {
    expect(() => validatePack({ ...good(), messages: { acceptAll: '<' } }, 'packs[2]')).toThrow(/packs\[2\]\.messages\.acceptAll/)
  })
})
