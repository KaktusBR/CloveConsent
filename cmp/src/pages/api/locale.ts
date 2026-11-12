import type { APIRoute } from 'astro'

import { LOCALE_COOKIE, localeSwitchTarget, locales, type Locale } from '../../i18n/locale'
import { env } from '../../server/env'

export const prerender = false

const ONE_YEAR = 60 * 60 * 24 * 365

/**
 * The language switcher: `GET /api/locale?to=sk&next=/sign-in` remembers the choice in the
 * `locale` cookie and sends the reader to the same page in that language (`/sk/sign-in`).
 * Works without JavaScript. `next` must be a path on this site; anything else becomes `/`.
 */
export const GET: APIRoute = ({ url, cookies }) => {
  const to = url.searchParams.get('to')
  if (!(locales as readonly string[]).includes(to ?? '')) {
    return new Response(null, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  }
  const locale = to as Locale
  cookies.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: ONE_YEAR,
    sameSite: 'lax',
    httpOnly: true,
    secure: env.PUBLIC_ORIGIN.startsWith('https:'), // the public scheme, not the one behind a TLS-terminating proxy
  })
  return new Response(null, {
    status: 303,
    headers: { Location: localeSwitchTarget(url.searchParams.get('next'), locale), 'Cache-Control': 'no-store' },
  })
}
