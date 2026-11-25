import type { APIRoute } from 'astro'

import { localizedPath } from '../../../i18n/locale'
import { auth, localeOfRequest } from '../../../server/auth/auth'
import { signInPath } from '../../../server/auth/guard'
import { withinLimit, type RequestLimit } from '../../../server/auth/request-limits'
import { accountName, createAccount } from '../../../server/data/accounts'
import { seeOther } from '../../../server/responses'

export const prerender = false

/**
 * Tries of this form per person, and per client address (finding T7): each refused try (past LIMITS) is a
 * row in the append-only audit log, so tries are bounded before anything is written.
 */
export const ACCOUNT_CREATE_LIMIT: RequestLimit = { window: 60 * 60, max: 10 }

/**
 * The "Create an account" form (a plain form): a new account named `name`, with the signed-in person as
 * its owner (written with its audit rows in one transaction), which becomes the account they work in.
 * Past the number of accounts a person may create (LIMITS), or past ACCOUNT_CREATE_LIMIT tries, back to the
 * form with the reason.
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const locale = localeOfRequest(request)
  const page = localizedPath('/accounts/new', locale)
  const session = locals.session
  if (!session) return seeOther(signInPath(new URL(page, url)))
  if (!(await withinLimit(request, 'accounts:create', session.user.id, ACCOUNT_CREATE_LIMIT))) return seeOther(`${page}?error=limited`)

  const form = await request.formData().catch(() => null)
  const name = accountName(form?.get('name'))
  if (!name) return seeOther(`${page}?error=name`)
  const created = await createAccount(session.user.id, name)
  if ('refused' in created) return seeOther(`${page}?error=limit`)
  await auth.api.setActiveOrganization({ headers: request.headers, body: { organizationId: created.accountId } })
  return seeOther(localizedPath('/account', locale))
}
