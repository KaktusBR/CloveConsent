import type { APIRoute } from 'astro'

import { localizedPath } from '../../../i18n/locale'
import { auth, localeOfRequest } from '../../../server/auth/auth'
import { signInPath } from '../../../server/auth/guard'
import { membershipOf } from '../../../server/data/accounts'
import { notFound, seeOther } from '../../../server/responses'

export const prerender = false

/**
 * The account switcher (a plain form): `account` becomes the account the person works in, only when they
 * are a member of it. Any other id, existing or not, is 404 and the active account stays as it was.
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const locale = localeOfRequest(request)
  const home = localizedPath('/account', locale)
  const session = locals.session
  if (!session) return seeOther(signInPath(new URL(home, url)))

  const form = await request.formData().catch(() => null)
  const accountId = form?.get('account')
  if (typeof accountId !== 'string' || (await membershipOf(session.user.id, accountId)) === null) return notFound()
  await auth.api.setActiveOrganization({ headers: request.headers, body: { organizationId: accountId } })
  return seeOther(home)
}
