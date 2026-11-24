import type { APIRoute } from 'astro'

import { localizedPath } from '../../../i18n/locale'
import { auth, localeOfRequest } from '../../../server/auth/auth'
import { completeSession, signInPath } from '../../../server/auth/guard'
import { notFound, seeOther } from '../../../server/responses'

export const prerender = false

/**
 * The Security page's "Sign out" of one session (a plain form, works without JavaScript): `session` is
 * the id of one of the signed-in person's own sessions. Session tokens never reach the page; the token
 * is looked up here among the person's sessions, so an id of anyone else's session matches nothing and
 * is answered 404, as an id that does not exist is.
 */
export const POST: APIRoute = async ({ request, url }) => {
  const locale = localeOfRequest(request)
  const security = localizedPath('/account/security', locale)
  const signedIn = await completeSession(request.headers)
  if (!signedIn) return seeOther(signInPath(new URL(security, url)))

  const form = await request.formData().catch(() => null)
  const id = form?.get('session')
  const sessions = await auth.api.listSessions({ headers: request.headers })
  const target = typeof id === 'string' ? sessions.find((s) => s.id === id) : undefined
  if (!target) return notFound()
  await auth.api.revokeSession({ headers: request.headers, body: { token: target.token } })
  // revoking the current session signs this browser out
  return seeOther(target.id === signedIn.session.id ? localizedPath('/sign-in', locale) : security)
}
