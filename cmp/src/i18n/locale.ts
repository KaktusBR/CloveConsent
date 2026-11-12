import { baseLocale, locales, type Locale } from '../paraglide/runtime.js'

export { baseLocale, locales, type Locale }

/**
 * The language picked in the switcher (set by /api/locale). Never used to redirect or to choose the
 * language of a page: the URL alone does that. Read by {@link preferredLocale}.
 */
export const LOCALE_COOKIE = 'locale'

/** The switcher's endpoint (src/pages/api/locale.ts). */
export const LOCALE_SWITCH_PATH = '/api/locale'

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

/** The language of a page URL: its prefix, else English. Cookies and Accept-Language never change it. */
export function localeOfPath(pathname: string): Locale {
  return splitLocalePrefix(pathname).locale ?? baseLocale
}

/**
 * The language named by the optional `[...locale]` route segment (src/pages/[...locale]/*):
 * none is English, `sk` is Slovak; anything else (including `en`, which has no prefix) is no page.
 */
export function localeFromParam(param: string | undefined): Locale | null {
  if (param === undefined) return baseLocale
  const locale = shipped(param)
  return locale && locale !== baseLocale ? locale : null
}

/** `getStaticPaths` of a prerendered `[...locale]` page: one copy per language (`/x` and `/sk/x`). */
export function localeStaticPaths(): { params: { locale: string | undefined } }[] {
  return locales.map((locale) => ({ params: { locale: locale === baseLocale ? undefined : locale } }))
}

/** The URL path of a page in a language: `/sign-in` stays as is in English and becomes `/sk/sign-in` in Slovak. */
export function localizedPath(path: string, locale: Locale): string {
  return locale === baseLocale ? path : `/${locale}${path}`
}

/** The switcher's link: through /api/locale, which remembers the choice and opens `current` in `locale`. */
export function localeSwitchHref(current: string, locale: Locale): string {
  return `${LOCALE_SWITCH_PATH}?${new URLSearchParams({ to: locale, next: current })}`
}

const SENTINEL = 'http://same.invalid'

/**
 * A Location value that can only lead to this site: one leading slash, no backslash, no control
 * character, no encoded slash pair or backslash a browser might decode, and it still resolves to the
 * same host.
 */
function isLocalTarget(target: string): boolean {
  if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\') || /%5c|%2f%2f/i.test(target)) return false
  for (const c of target) {
    const code = c.charCodeAt(0)
    if (code <= 0x1f || code === 0x7f) return false
  }
  return new URL(target, SENTINEL).origin === SENTINEL
}

const collapseLeadingSlashes = (path: string) => path.replace(/^\/{2,}/, '/')

/**
 * Where /api/locale sends the reader: `next` (a path on this site, with or without a language prefix)
 * in `locale`. The final value is checked, not only the input: anything that could leave the site
 * (`//host`, `/\host`, `/sk//host`, `/.//host`, `https:...`) becomes the home page in `locale`.
 */
export function localeSwitchTarget(next: string | null, locale: Locale): string {
  const home = localizedPath('/', locale)
  if (next === null || !next.startsWith('/')) return home
  // The URL parser drops tabs and newlines and resolves dot segments (`/a/..//host` is `//host`).
  const url = new URL(next, SENTINEL)
  if (url.origin !== SENTINEL) return home
  const path = collapseLeadingSlashes(splitLocalePrefix(collapseLeadingSlashes(url.pathname)).path)
  const target = localizedPath(path, locale) + url.search
  return isLocalTarget(target) ? target : home
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
 * The reader's preferred language where a response has no language in its URL (e.g. an email or an
 * API error, in later tasks): the switcher's cookie, then Accept-Language, then English. Never used
 * to redirect or to pick the language of a page.
 *
 * @param cookie the value of the {@link LOCALE_COOKIE} cookie, if any
 * @param acceptLanguage the Accept-Language header, if any
 */
export function preferredLocale(cookie: string | null, acceptLanguage: string | null): Locale {
  return shipped(cookie) ?? (acceptLanguage ? fromAcceptLanguage(acceptLanguage) : null) ?? baseLocale
}
