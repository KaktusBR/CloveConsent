import type { APIRoute } from 'astro'

import { localizedPath } from '../../../i18n/locale'
import { localeOfRequest } from '../../../server/auth/auth'
import { superAdminStatus, withinAdminLimit } from '../../../server/auth/super-admin'
import { adminReason, paidThroughDay, setEntitlement, suspendAccount, unsuspendAccount } from '../../../server/data/entitlements'
import { notFound, seeOther } from '../../../server/responses'

export const prerender = false

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const INTENTS = new Set(['set', 'suspend', 'unsuspend'])
const ERRORS: Record<string, string> = { bad_plan: 'plan', already_suspended: 'already_suspended', not_suspended: 'not_suspended' }

/**
 * The super-admin's forms on an account's console page (plain forms), each with a required reason that
 * goes into the audit log with the change:
 *   intent=set        account, plan, paidUntil (YYYY-MM-DD: paid through the end of that day, UTC)
 *   intent=suspend    account
 *   intent=unsuspend  account
 * Anyone but a super-admin gets 404 (the middleware answers first; this checks again), as does an
 * unknown account or intent. Refusals go back to the page with their reason; rate limited per
 * super-admin and per client address.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const session = locals.session ?? null
  if (!session || superAdminStatus(session) !== 'super-admin') return notFound()

  const form = await request.formData().catch(() => null)
  const field = (name: string) => {
    const value = form?.get(name)
    return typeof value === 'string' ? value : ''
  }
  const intent = field('intent')
  const accountId = field('account')
  if (!INTENTS.has(intent) || !UUID.test(accountId)) return notFound()
  const page = localizedPath(`/admin/accounts/${accountId.toLowerCase()}`, localeOfRequest(request))

  const reason = adminReason(field('reason'))
  if (reason === null) return seeOther(`${page}?error=reason`)
  const paidUntil = intent === 'set' ? paidThroughDay(field('paidUntil')) : null
  if (intent === 'set' && paidUntil === null) return seeOther(`${page}?error=date`)
  if (!(await withinAdminLimit(request, 'change', session.user.id))) return seeOther(`${page}?error=limited`)

  const actor = session.user.id
  const result =
    intent === 'set' && paidUntil ? await setEntitlement(actor, accountId, { planId: field('plan'), paidUntil }, reason)
    : intent === 'suspend' ? await suspendAccount(actor, accountId, reason)
    : await unsuspendAccount(actor, accountId, reason)
  if (result === 'not_found') return notFound()
  if (result !== 'ok') return seeOther(`${page}?error=${ERRORS[result] ?? 'unknown'}`)
  return seeOther(`${page}?done=${intent}`)
}
