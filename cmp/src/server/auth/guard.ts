// Route guards. A page or API that needs a signed-in person calls these; there is no other way to the
// session (Better Auth's own endpoints check it themselves).
import type { AstroGlobal } from 'astro'
import { localizedPath, sameSitePath, splitLocalePrefix } from '../../i18n/locale'
import { auth, type AuthSession } from './auth'

/**
 * The request's session, only when it is complete: the email address is verified and, for a user with
 * two-factor authentication on, the session was created by its second step (TOTP or backup code) or by a
 * passkey (or replaced one that was). Anything else, including a sign-in still waiting for its code, is
 * no session.
 *
 * Reading a session older than a day extends it (a sliding session) and renews its cookie: pass the
 * response's headers to receive that Set-Cookie, as requireUser does.
 */
export async function completeSession(headers: Headers, responseHeaders?: Headers): Promise<AuthSession | null> {
  const { headers: answer, response: found } = await auth.api.getSession({ headers, returnHeaders: true })
  if (!found) return null
  if (!found.user.emailVerified) return null
  if (found.user.twoFactorEnabled && !found.session.secondFactor) return null
  if (responseHeaders) for (const cookie of answer.getSetCookie()) responseHeaders.append('Set-Cookie', cookie)
  return found
}

/** The sign-in page, in the page's language, with where to come back to (a path on this site only). */
export function signInPath(url: URL): string {
  const { locale } = splitLocalePrefix(url.pathname)
  const next = sameSitePath(url.pathname + url.search)
  const path = localizedPath('/sign-in', locale ?? 'en')
  return next ? `${path}?${new URLSearchParams({ next })}` : path
}

/**
 * For a page that needs a signed-in person: their user and session, or a redirect to the sign-in page
 * (then `return` it from the page). The page is never cached: it shows one person's data.
 *
 *   const signedIn = await requireUser(Astro)
 *   if (signedIn instanceof Response) return signedIn
 */
export async function requireUser(astro: AstroGlobal): Promise<AuthSession | Response> {
  astro.response.headers.set('Cache-Control', 'no-store')
  const found = await completeSession(astro.request.headers, astro.response.headers)
  return found ?? astro.redirect(signInPath(astro.url), 303)
}
