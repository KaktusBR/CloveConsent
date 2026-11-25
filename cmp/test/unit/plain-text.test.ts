// The one plain-text rule for what people type that later goes into an email or a page: person names
// (sign-up, profile), account names, super-admin reasons, and every text value of a mail (finding I2).
import { randomInt } from 'node:crypto'
import { describe, expect, test } from 'vitest'
import { MAX_PERSON_NAME, personName, plainText } from '../../src/lib/plain-text'
import { checkMail } from '../../src/server/jobs/mail'

const ORIGIN = 'http://localhost:4321' // PUBLIC_ORIGIN of vitest.config.ts

/** An invitation mail from `inviter`: refused by checkMail when the name is not plain text. */
const invitationFrom = (inviter: string) =>
  checkMail({ to: 'ana@example.test', template: 'invitation', locale: 'en', data: { url: `${ORIGIN}/invite/x`, inviter, account: 'Acme' } })

const REFUSED: Record<string, unknown> = {
  empty: '',
  'spaces only': '   ',
  'joiners only (invisible)': '\u200c\u200d',
  'spaces and joiners only': ' \u200d ',
  [`over ${MAX_PERSON_NAME} characters`]: 'a'.repeat(MAX_PERSON_NAME + 1),
  'soft hyphen (Cf)': 'Ana\u00adMaria',
  'zero-width space (Cf)': 'Ana\u200b',
  'right-to-left override (Cf)': 'Ana\u202eevil',
  'byte order mark inside a name (Cf; trim removes one at either end)': 'An\ufeffa',
  'flag tag characters (Cf)': 'Ana \u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
  'NUL (Cc)': 'Ana\u0000',
  'newline (Cc)': 'Ana\nBcc: x@evil.test',
  'tab (Cc)': 'Ana\tB',
  'line separator (Zl)': 'Ana\u2028B',
  'paragraph separator (Zp)': 'Ana\u2029B',
  'not a string': 42,
}

const ACCEPTED: Record<string, [string, string]> = {
  'Latin with diacritics': ['Ana Nováková', 'Ana Nováková'],
  'trimmed': ['  Ana  ', 'Ana'],
  'Persian with a zero-width non-joiner': ['محمد\u200cرضا', 'محمد\u200cرضا'],
  'an emoji sequence with a zero-width joiner': ['Dev \u{1F469}\u200d\u{1F4BB}', 'Dev \u{1F469}\u200d\u{1F4BB}'],
  [`exactly ${MAX_PERSON_NAME} characters`]: ['a'.repeat(MAX_PERSON_NAME), 'a'.repeat(MAX_PERSON_NAME)],
}

describe('personName', () => {
  test.each(Object.entries(REFUSED))('refuses %s', (_, value) => {
    expect(personName(value)).toBeNull()
  })

  test.each(Object.entries(ACCEPTED))('accepts %s (trimmed), and an invitation mail from it passes checkMail', (_, [value, name]) => {
    expect(personName(value)).toBe(name)
    expect(() => invitationFrom(name)).not.toThrow()
  })

  test('whatever it accepts, checkMail accepts as an inviter (random strings over every kind of character)', () => {
    // code points from ranges with letters, spaces, joiners, controls, format characters, separators, emoji and tags
    const ranges: [number, number][] = [[0x00, 0x7f], [0x80, 0x24f], [0x2000, 0x206f], [0x600, 0x6ff], [0xfe00, 0xfeff], [0x1f300, 0x1f6ff], [0xe0000, 0xe007f]]
    let accepted = 0
    for (let i = 0; i < 20_000; i++) {
      const chars: string[] = []
      for (let n = randomInt(0, 12); n > 0; n--) {
        const [from, to] = ranges[randomInt(0, ranges.length)]!
        chars.push(String.fromCodePoint(randomInt(from, to + 1)))
      }
      const name = personName(chars.join(''))
      if (name === null) continue
      accepted++
      expect(() => invitationFrom(name), JSON.stringify(name)).not.toThrow()
    }
    expect(accepted).toBeGreaterThan(100)
  })
})

describe('plainText', () => {
  test('applies the same rules with its own length', () => {
    expect(plainText('abc', 3)).toBe('abc')
    expect(plainText('abcd', 3)).toBeNull()
    expect(plainText('\u200c', 3)).toBeNull()
    expect(plainText('a\u00ad', 3)).toBeNull()
  })
})
