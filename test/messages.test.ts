import { describe, expect, test } from 'vitest'
import { MESSAGE_KEYS, en, format } from '../src/messages'
import { defineConsent } from '../src/config'
import { theme } from '../src/catalog'
import sk from '../src/locales/sk'
import fr from '../src/locales/fr'
import de from '../src/locales/de'

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

const NEW_KEYS = [
  'receiptTitle', 'receiptNone', 'receiptCopy', 'receiptCopied', 'receiptSaved', 'receiptPolicy', 'receiptLanguage', 'receiptChoice',
  'choiceAll', 'choiceNecessary', 'choiceCustom', 'settingsTitle', 'settingsIntro', 'settingsSaved', 'withdraw', 'showDetails', 'hideDetails',
  'servicesAllowed', 'stateMixed', 'noStorage', 'embedAllow',
] as const

test('consent manager texts exist in English with the exact wording', () => {
  for (const k of NEW_KEYS) expect(MESSAGE_KEYS, k).toContain(k)
  expect(en.receiptTitle).toBe('Your consent reference')
  expect(en.settingsIntro).toBe('Choose what you allow. Necessary items are always on. You can change or withdraw your choice at any time.')
  expect(en.servicesAllowed).toBe('{allowed} of {total} allowed')
  expect(en.embedAllow).toBe('Allow {service}')
})
test('embedAccept is gone, replaced by embedAllow', () => {
  expect(MESSAGE_KEYS as readonly string[]).not.toContain('embedAccept')
  expect(en.embedAllow).toContain('{service}')
})
describe.each([['sk', sk], ['fr', fr], ['de', de]])('%s pack', (_name, pack) => {
  test('provides every message key and no removed key', () => {
    const keys = Object.keys(pack.messages)
    for (const k of MESSAGE_KEYS) expect(keys, k).toContain(k)
    expect(keys).not.toContain('embedAccept')
    expect(keys.sort()).toEqual([...MESSAGE_KEYS].sort())
  })
  test('keeps the {allowed}, {total} and {service} placeholders', () => {
    const m = pack.messages as Record<string, string>
    expect(m.servicesAllowed).toMatch(/\{allowed\}/)
    expect(m.servicesAllowed).toMatch(/\{total\}/)
    expect(m.embedAllow).toMatch(/\{service\}/)
    for (const k of NEW_KEYS) expect(m[k]!.trim().length, k).toBeGreaterThan(0)
  })
  test('is accepted by the strict policy', () => {
    expect(() => defineConsent({ locales: [pack.locale], defaultLocale: pack.locale, revision: 1, services: [theme()], packs: [pack] })).not.toThrow()
  })
})
