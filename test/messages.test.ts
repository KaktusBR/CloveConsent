import { expect, test } from 'vitest'
import { MESSAGE_KEYS, en, format } from '../src/messages'

test('English has every key, non-empty, plain text without control characters', () => {
  expect(Object.keys(en).sort()).toEqual([...MESSAGE_KEYS].sort())
  expect(MESSAGE_KEYS.length).toBeGreaterThan(0)
  for (const k of MESSAGE_KEYS) {
    const v = en[k]
    expect(typeof v === 'string' && v.trim().length > 0, k).toBe(true)
    expect(/[<>]/.test(v), k).toBe(false)
    expect(/[\u0000-\u001F\u007F]/.test(v), k).toBe(false)
  }
})
test('format replaces named placeholders and leaves unknown ones', () => {
  expect(format('Hi {provider}, {x}', { provider: 'A' })).toBe('Hi A, {x}')
})
test('format does not interpret replacement patterns', () => {
  expect(format('{a}', { a: '$& $1' })).toBe('$& $1')
})
