// The language of a request's emails, and links into this site for them.
import { localeOfPath, localizedPath, LOCALE_COOKIE, preferredLocale, sameSitePath, type Locale } from '../../i18n/locale'
import { env } from '../env'

/**
 * The language of the page a request came from (its Referer on this site; the browser sends the full URL
 * to the same origin), else the reader's preferred one. Auth emails are written in it.
 */
export function localeOfRequest(request: Request | undefined): Locale {
  const referer = request?.headers.get('referer')
  if (referer && URL.canParse(referer)) {
    const url = new URL(referer)
    if (url.origin === env.PUBLIC_ORIGIN) return localeOfPath(url.pathname)
  }
  const cookie = request?.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)`))?.[1] ?? null
  return preferredLocale(cookie, request?.headers.get('accept-language') ?? null)
}

/**
 * The `next=` of the page a request came from (its Referer on this site): where to go once signed in,
 * only when it is a path on this site (sameSitePath), else null.
 */
export function nextOfRequest(request: Request | undefined): string | null {
  const referer = request?.headers.get('referer')
  if (!referer || !URL.canParse(referer)) return null
  const url = new URL(referer)
  return url.origin === env.PUBLIC_ORIGIN ? sameSitePath(url.searchParams.get('next')) : null
}

/** An absolute link to a page of this site in `locale`. */
export const pageLink = (path: string, locale: Locale) => new URL(localizedPath(path, locale), env.PUBLIC_ORIGIN)
