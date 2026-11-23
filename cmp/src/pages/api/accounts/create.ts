import type { APIRoute } from 'astro'

import { localizedPath } from '../../../i18n/locale'
import { auth, localeOfRequest } from '../../../server/auth/auth'
import { signInPath } from '../../../server/auth/guard'
import { accountName, createAccount } from '../../../server/data/accounts'
import { seeOther } from '../../../server/responses'

export const prerender = false

/**
 * The "Create an account" form (a plain form): a new account named `name`, with the signed-in person as
 * its owner (written with its audit rows in one transaction), which becomes the account they work in.
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const locale = localeOfRequest(request)
  const page = localizedPath('/accounts/new', locale)
  const session = locals.session
  if (!session) return seeOther(signInPath(new URL(page, url)))

  const form = await request.formData().catch(() => null)
  const name = accountName(form?.get('name'))
  if (!name) return seeOther(`${page}?error=name`)
  const accountId = await createAccount(session.user.id, name)
  await auth.api.setActiveOrganization({ headers: request.headers, body: { organizationId: accountId } })
  return seeOther(localizedPath('/account', locale))
}
