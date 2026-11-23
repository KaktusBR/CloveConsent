import type { APIRoute } from 'astro'
import { isAPIError } from 'better-auth/api'

import { localizedPath } from '../../../i18n/locale'
import { auth, localeOfRequest } from '../../../server/auth/auth'
import { isListedSuperAdmin, startingImpersonation, superAdminStatus, withinAdminLimit } from '../../../server/auth/super-admin'
import { accountMember, recordImpersonation } from '../../../server/data/admin'
import { adminReason } from '../../../server/data/entitlements'
import { notFound, seeOther } from '../../../server/responses'

export const prerender = false

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A super-admin starts a read-only view of `account` as its member `user`, with a required reason (a
 * plain form on the account's console page). The start is written to the account's audit log first, then
 * the admin plugin opens the member's session (src/server/auth/super-admin.ts) and this browser lands on
 * the account's page as them, with the banner. Anyone but a super-admin gets 404, as do an unknown
 * account, someone who is not its member, and another super-admin. Rate limited.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const session = locals.session ?? null
  if (!session || superAdminStatus(session) !== 'super-admin') return notFound()

  const form = await request.formData().catch(() => null)
  const field = (name: string) => {
    const value = form?.get(name)
    return typeof value === 'string' ? value : ''
  }
  const accountId = field('account').toLowerCase()
  if (!UUID.test(accountId)) return notFound()
  const actor = session.user.id
  const member = await accountMember(actor, accountId, field('user').toLowerCase())
  if (!member || member.userId === actor || isListedSuperAdmin(member.email)) return notFound()

  const locale = localeOfRequest(request)
  const page = localizedPath(`/admin/accounts/${accountId}`, locale)
  const reason = adminReason(field('reason'))
  if (reason === null) return seeOther(`${page}?error=reason`)
  if (!(await withinAdminLimit(request, 'impersonate', actor))) return seeOther(`${page}?error=limited`)

  await recordImpersonation(actor, accountId, member.userId, 'start', reason)
  let cookies: Headers
  try {
    const started = await startingImpersonation({ superAdminId: actor, accountId }, () =>
      auth.api.impersonateUser({ body: { userId: member.userId }, headers: request.headers, returnHeaders: true }),
    )
    cookies = started.headers
  } catch (err) {
    if (isAPIError(err)) return seeOther(`${page}?error=impersonation`)
    throw err
  }
  const response = seeOther(localizedPath('/account', locale))
  for (const cookie of cookies.getSetCookie()) response.headers.append('Set-Cookie', cookie)
  return response
}
