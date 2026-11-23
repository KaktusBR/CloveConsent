import type { APIRoute } from 'astro'
import { isAPIError } from 'better-auth/api'

import { localizedPath } from '../../../i18n/locale'
import { auth, localeOfRequest } from '../../../server/auth/auth'
import { signInPath } from '../../../server/auth/guard'
import { impersonatorOf } from '../../../server/auth/super-admin'
import { recordImpersonation } from '../../../server/data/admin'
import { notFound, seeOther } from '../../../server/responses'

export const prerender = false

/**
 * The banner's button: ends a super-admin's read-only view (the one write such a session may make,
 * src/server/auth/access.ts). The member's session is deleted, the super-admin's own comes back and they
 * return to the account's console page; the stop is written to the account's audit log. Not
 * impersonating: 404. If the super-admin's own session has ended meanwhile, the view is signed out.
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const session = locals.session ?? null
  const superAdminId = impersonatorOf(session)
  if (!session || superAdminId === null) return notFound()
  const accountId = locals.scope?.accountId ?? session.session.activeOrganizationId ?? null
  const locale = localeOfRequest(request)

  let response: Response
  let cookies: Headers
  try {
    cookies = (await auth.api.stopImpersonating({ headers: request.headers, returnHeaders: true })).headers
    response = seeOther(localizedPath(accountId ? `/admin/accounts/${accountId}` : '/admin/accounts', locale))
  } catch (err) {
    if (!isAPIError(err)) throw err
    cookies = (await auth.api.signOut({ headers: request.headers, returnHeaders: true })).headers
    response = seeOther(signInPath(new URL(localizedPath('/admin/accounts', locale), url)))
  }
  await recordImpersonation(superAdminId, accountId, session.user.id, 'stop')
  for (const cookie of cookies.getSetCookie()) response.headers.append('Set-Cookie', cookie)
  return response
}
