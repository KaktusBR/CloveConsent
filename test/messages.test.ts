import { expect, test } from 'vitest'
import { LOCALES } from '../src/schema'
import { format, messages } from '../src/messages'

test('every locale has every key, non-empty, plain text', () => {
  const keys = Object.keys(messages.en).sort()
  for (const l of LOCALES) {
    expect(Object.keys(messages[l]).sort()).toEqual(keys)
    for (const v of Object.values(messages[l])) {
      expect(typeof v === 'string' && v.trim().length > 0).toBe(true)
      expect(/[<>]/.test(v as string)).toBe(false)
    }
  }
})
test('format replaces named placeholders and leaves unknown ones', () => {
  expect(format('Hi {provider}, {x}', { provider: 'A' })).toBe('Hi A, {x}')
})
test('format does not interpret replacement patterns', () => {
  expect(format('{a}', { a: '$& $1' })).toBe('$& $1')
})
