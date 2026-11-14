import type { ReactElement } from 'react'
import type { Locale } from '../i18n/locale'

/**
 * What a template value may be. Every value is a string, checked before the mail is queued and again
 * before it is sent (src/server/jobs/mail.ts):
 * - `text`: one line of at most 200 characters (a name, a device); escaped wherever it is shown
 * - `link`: an absolute URL on PUBLIC_ORIGIN
 * - `instant`: an ISO 8601 time, written out in the reader's language
 * - a list: one of these words (never shown as is)
 */
export type FieldKind = 'text' | 'link' | 'instant' | readonly string[]

export type Values<F> = { readonly [K in keyof F]: string }

/** A transactional email: its subject and body from the message catalog, in the reader's language. */
export interface EmailTemplate<F extends Record<string, FieldKind> = Record<string, FieldKind>> {
  /** The values the template takes: each is required, and nothing else is accepted. */
  readonly fields: F
  subject(data: Values<F>, locale: Locale): string
  /** The body, rendered to HTML and to plain text (src/emails/render.ts). */
  body(data: Values<F>, locale: Locale): ReactElement
}

export function defineTemplate<const F extends Record<string, FieldKind>>(template: EmailTemplate<F>): EmailTemplate<F> {
  return template
}

/** A time in the reader's language, in UTC (the reader's time zone is not known). */
export function formatInstant(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  }).format(new Date(iso))
}
