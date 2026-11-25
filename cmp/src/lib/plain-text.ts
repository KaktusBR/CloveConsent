// One line of plain text typed by a person, the one rule for every such value that later goes into an
// email or a page: person names (sign-up, profile: src/server/auth/auth.ts), account names, super-admin
// reasons, and the text values of a mail (src/server/jobs/mail.ts checks them again before queueing and
// before sending). A value this accepts always passes the mail's check.

/** The longest name a person may give themselves. */
export const MAX_PERSON_NAME = 100

/** Control and invisible format characters (bidi controls, zero-width space, soft hyphen, BOM, tags), line and paragraph separators. */
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u
/** The zero-width non-joiner and joiner: Persian, Devanagari, Bengali, Sinhala and other scripts, and emoji sequences need them. */
const JOINERS = /[\u200c\u200d]/gu

/**
 * A line of text as given (trimmed), or null when it is not a string, is blank (nothing but spaces and
 * joiners), is longer than `max` characters, or holds a control or format character other than the joiners
 * anywhere, its ends included (trimming would remove a line break or a byte order mark there).
 */
export function plainText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  if (text.replace(JOINERS, '').trim() === '' || text.length > max || CONTROL.test(value.replace(JOINERS, ''))) return null
  return text
}

/** A person's name as given (trimmed), or null when it is not plain text of 1 to MAX_PERSON_NAME characters. */
export const personName = (value: unknown): string | null => plainText(value, MAX_PERSON_NAME)
