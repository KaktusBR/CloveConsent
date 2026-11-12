import { baseLocale, locales, type Locale } from '../paraglide/runtime.js'

export { baseLocale, locales, type Locale }

/**
 * Remembers the language picked in the switcher (see LocaleSwitcher). Only consulted for
 * unprefixed URLs: a `/sk/...` URL is Slovak whatever the cookie says.
 */
export const LOCALE_COOKIE = 'locale'

function shipped(value: string | null | undefined): Locale | null {
  return (locales as readonly string[]).includes(value ?? '') ? (value as Locale) : null
}

/**
 * Splits a request path into its language prefix and the page path. English (the base locale)
 * has no prefix, so only a first segment naming another shipped language counts:
 * `/sk/sign-in` → `{ locale: 'sk', path: '/sign-in' }`, `/sign-in` → `{ locale: null, path: '/sign-in' }`.
 */
export function splitLocalePrefix(pathname: string): { locale: Locale | null; path: string } {
  const match = /^\/([^/]+)(\/.*)?$/.exec(pathname)
  const locale = shipped(match?.[1])
  if (!match || !locale || locale === baseLocale) return { locale: null, path: pathname }
  return { locale, path: match[2] ?? '/' }
}

/** The first shipped language in an Accept-Language header, by q-value; `de-AT` also tries `de`. */
function fromAcceptLanguage(header: string): Locale | null {
  const ranges = header
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.split(';').map((s) => s.trim())
      const q = params.find((p) => /^q=/i.test(p))
      return { tag: tag.toLowerCase(), q: q ? Number(q.slice(2)) : 1, index }
    })
    .filter((r) => r.tag !== '' && r.tag !== '*' && Number.isFinite(r.q) && r.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index)

  for (const { tag } of ranges) {
    const language = tag.split('-')[0]
    const locale = locales.find((l) => l.toLowerCase() === tag) ?? locales.find((l) => l.toLowerCase() === language)
    if (locale) return locale
  }
  return null
}

/**
 * The language of a request: the URL prefix wins, then the switcher's cookie, then the
 * browser's Accept-Language, then English.
 *
 * @param pathname the request path, e.g. `/sk/sign-in`
 * @param cookie the value of the {@link LOCALE_COOKIE} cookie, if any
 * @param acceptLanguage the Accept-Language header, if any
 */
export function resolveLocale(pathname: string, cookie: string | null, acceptLanguage: string | null): Locale {
  return splitLocalePrefix(pathname).locale ?? shipped(cookie) ?? (acceptLanguage ? fromAcceptLanguage(acceptLanguage) : null) ?? baseLocale
}

/** The URL path of a page in a language: `/sign-in` stays as is in English and becomes `/sk/sign-in` in Slovak. */
export function localizedPath(path: string, locale: Locale): string {
  return locale === baseLocale ? path : `/${locale}${path}`
}
