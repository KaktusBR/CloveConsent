import type { APIRoute } from 'astro'

import { localeOfRequest } from '../../../server/auth/auth'
import { endImpersonation } from '../../../server/auth/guard'
import { carriesImpersonatorCookie, impersonatorOf } from '../../../server/auth/super-admin'
import { notFound, seeOther } from '../../../server/responses'

export const prerender = false

/**
 * The banner's button: ends a super-admin's read-only view (the one write such a session may make,
 * src/server/auth/access.ts), also once it is past its time. The end is written to the account's audit
 * log, then the view's session is deleted and the super-admin's own comes back; they return to the
 * account's console page (or to sign in, if their own session has ended meanwhile). Nothing to end: 404.
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const session = locals.session ?? null
  if (impersonatorOf(session) === null && (session !== null || !carriesImpersonatorCookie(request.headers))) return notFound()
  const ended = await endImpersonation(request, url, localeOfRequest(request))
  if (!ended) return notFound()
  const response = seeOther(ended.location)
  for (const cookie of ended.cookies) response.headers.append('Set-Cookie', cookie)
  return response
}
