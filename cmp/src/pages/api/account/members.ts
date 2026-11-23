import type { APIRoute } from 'astro'

import { localizedPath } from '../../../i18n/locale'
import { localeOfRequest } from '../../../server/auth/auth'
import { signInPath } from '../../../server/auth/guard'
import { can, isRole } from '../../../server/auth/permissions'
import { cancelInvitation, changeRole, membershipOf, removeMember } from '../../../server/data/accounts'
import { notFound, seeOther } from '../../../server/responses'

export const prerender = false

/**
 * The Members page's forms (plain forms), in the account the person works in (locals.scope, checked
 * against the memberships on this request):
 *   intent=role    member, role   give a member another role
 *   intent=remove  member         remove a member (possibly oneself)
 *   intent=cancel  invitation     cancel a pending invitation
 * Only owners and admins may; for anyone else, and for a member or invitation id that is not of this
 * account (whether it exists elsewhere or not), the answer is 404 and nothing changes. A refusal of the
 * account's rules (the last owner, owner-only changes) goes back to the page with its reason.
 */
export const POST: APIRoute = async ({ request, locals, url }) => {
  const locale = localeOfRequest(request)
  const page = localizedPath('/account/members', locale)
  if (!locals.session) return seeOther(signInPath(new URL(page, url)))
  const scope = locals.scope
  if (!scope) return notFound()

  const form = await request.formData().catch(() => null)
  const field = (name: string) => {
    const value = form?.get(name)
    return typeof value === 'string' ? value : ''
  }
  const intent = field('intent')
  let result: string
  if (intent === 'role' && can(scope, 'member', 'update')) {
    const role = field('role')
    if (!isRole(role)) return seeOther(`${page}?error=role`)
    result = await changeRole(scope, field('member'), role)
  } else if (intent === 'remove' && can(scope, 'member', 'remove')) {
    result = await removeMember(scope, field('member'))
  } else if (intent === 'cancel' && can(scope, 'member', 'invite')) {
    result = await cancelInvitation(scope, field('invitation'))
  } else {
    return notFound()
  }
  if (result === 'not_found') return notFound()
  if (result !== 'ok') return seeOther(`${page}?error=${result}`)
  // someone who removed themselves is no longer in this account
  if (intent === 'remove' && (await membershipOf(scope.userId, scope.accountId)) === null) return seeOther(localizedPath('/account', locale))
  return seeOther(`${page}?done=${intent}`)
}
