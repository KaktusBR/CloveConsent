import type { APIRoute } from 'astro'
import { randomUUID } from 'node:crypto'
import { isAPIError } from 'better-auth/api'

import { localizedPath } from '../../../i18n/locale'
import { auth, localeOfRequest } from '../../../server/auth/auth'
import { isListedSuperAdmin, superAdminStatus, withinAdminLimit } from '../../../server/auth/super-admin'
import { accountMember, recordImpersonationStart } from '../../../server/data/admin'
import { adminReason } from '../../../server/data/entitlements'
import { notFound, seeOther } from '../../../server/responses'

export const prerender = false

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A super-admin starts a read-only view of `account` as its member `user`, with a required reason (a
 * plain form on the account's console page). The start is written to the account's audit log first, then
 * the server-only `startImpersonation` (src/server/auth/account-endpoints.ts) opens the member's session,
 * and this browser lands on the account's page as them, with the banner. Anyone but a super-admin gets
 * 404 (so no view is opened from inside one), as do an unknown account, someone who is not its member,
 * and another super-admin. Rate limited.
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

  // the view's name: its start and end rows carry it, and the impersonator cookie is bound to it
  const impersonation = randomUUID()
  await recordImpersonationStart(actor, accountId, member.userId, impersonation, reason)
  let cookies: Headers
  try {
    cookies = (await auth.api.startImpersonation({ body: { userId: member.userId, accountId, impersonation }, headers: request.headers, returnHeaders: true })).headers
  } catch (err) {
    if (isAPIError(err)) return seeOther(`${page}?error=impersonation`)
    throw err
  }
  const response = seeOther(localizedPath('/account', locale))
  for (const cookie of cookies.getSetCookie()) response.headers.append('Set-Cookie', cookie)
  return response
}
