// Inviting someone to an account and accepting an invitation: Better Auth endpoints of our own (at
// /api/auth/account/*), so they pass through Better Auth's request handling, origin check and rate limits
// (src/server/auth/auth.ts has their rules). The work is the data layer's (src/server/data/accounts.ts):
// the invitation, its audit row and its email, or the membership and its audit row, each in one
// transaction. The organization plugin's own endpoints are switched off (auth.ts, disabledPaths): they
// would store the link token in clear, answer 400 or 403 for another account's ids, and write outside
// one transaction.
import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthEndpoint, sessionMiddleware } from 'better-auth/api'
import * as z from 'zod'
import { acceptInvitation, createInvitation, membershipOf, type InvitationAccepted } from '../data/accounts'
import type { AccountScope } from '../data/scope'
import { sendMail } from '../jobs/mail'
import { isComplete } from './complete'
import { can, isRole } from './permissions'
import { localeOfRequest, pageLink } from './request-locale'

export const ACCOUNT_PATHS = { invite: '/account/invite', accept: '/account/accept-invitation' } as const

const refuse = (status: 'BAD_REQUEST' | 'UNAUTHORIZED' | 'FORBIDDEN' | 'NOT_FOUND', code: string) => new APIError(status, { code, message: code.toLowerCase() })

/** The session of the request, only when complete (src/server/auth/complete.ts). */
function signedIn(session: { user: { id: string; email: string; name: string; emailVerified: boolean }; session: { token: string } }) {
  if (!isComplete(session as Parameters<typeof isComplete>[0])) throw refuse('UNAUTHORIZED', 'UNAUTHORIZED')
  return session
}

const REFUSALS: Readonly<Record<Extract<InvitationAccepted, { refused: string }>['refused'], [Parameters<typeof refuse>[0], string]>> = {
  not_found: ['NOT_FOUND', 'INVITATION_NOT_FOUND'],
  // like a link that does not exist (ruling R23), its reason in the code
  wrong_email: ['NOT_FOUND', 'INVITATION_WRONG_EMAIL'],
  expired: ['BAD_REQUEST', 'INVITATION_EXPIRED'],
  used: ['BAD_REQUEST', 'INVITATION_USED'],
  canceled: ['BAD_REQUEST', 'INVITATION_CANCELED'],
  already_member: ['BAD_REQUEST', 'ALREADY_MEMBER'],
}

export const accountEndpoints = () =>
  ({
    id: 'cmp-accounts',
    endpoints: {
      /**
       * Invite an email address to an account, by one of its owners or admins. Anyone else, and any id
       * that is not an account of theirs, gets 404 and nothing is written.
       */
      inviteToAccount: createAuthEndpoint(
        ACCOUNT_PATHS.invite,
        { method: 'POST', body: z.object({ accountId: z.string(), email: z.string().max(254), role: z.string() }), use: [sessionMiddleware] },
        async (ctx) => {
          const { user } = signedIn(ctx.context.session)
          const role = await membershipOf(user.id, ctx.body.accountId)
          const scope: AccountScope | null = role ? { accountId: ctx.body.accountId, userId: user.id, role } : null
          if (!scope || !can(scope, 'member', 'invite')) throw refuse('NOT_FOUND', 'NOT_FOUND')
          if (!isRole(ctx.body.role)) throw refuse('BAD_REQUEST', 'ROLE_NOT_FOUND')
          const email = ctx.body.email.trim().toLowerCase()
          if (!z.email().safeParse(email).success) throw refuse('BAD_REQUEST', 'INVALID_EMAIL')
          const locale = localeOfRequest(ctx.request)
          const result = await createInvitation(scope, { email, role: ctx.body.role }, (tx, invitation) =>
            sendMail(
              {
                to: invitation.email,
                template: 'invitation',
                locale,
                data: { url: pageLink(`/invite/${invitation.token}`, locale).href, inviter: user.name, account: invitation.accountName },
              },
              { tx },
            ),
          )
          if (result === 'ok') return ctx.json({ invited: email })
          if (result === 'owner_only') throw refuse('FORBIDDEN', 'OWNER_ONLY')
          if (result === 'already_member') throw refuse('BAD_REQUEST', 'ALREADY_MEMBER')
          if (result === 'already_invited') throw refuse('BAD_REQUEST', 'ALREADY_INVITED')
          if (result === 'pending_limit') throw refuse('BAD_REQUEST', 'INVITATION_LIMIT_PENDING')
          if (result === 'account_day_limit') throw refuse('BAD_REQUEST', 'INVITATION_LIMIT_ACCOUNT_DAY')
          if (result === 'user_day_limit') throw refuse('BAD_REQUEST', 'INVITATION_LIMIT_USER_DAY')
          throw refuse('NOT_FOUND', 'NOT_FOUND')
        },
      ),

      /**
       * Accept an invitation (by the token of its link) as the signed-in person; it then becomes their
       * active account. Refused, with the reason as its code, when the invitation is not theirs, was
       * used, canceled or has expired: nothing is written then.
       */
      acceptAccountInvitation: createAuthEndpoint(
        ACCOUNT_PATHS.accept,
        { method: 'POST', body: z.object({ token: z.string().max(100) }), use: [sessionMiddleware] },
        async (ctx) => {
          const { user, session } = signedIn(ctx.context.session)
          const result = await acceptInvitation(ctx.body.token, user)
          if ('refused' in result) throw refuse(...REFUSALS[result.refused])
          await ctx.context.internalAdapter.updateSession(session.token, { activeOrganizationId: result.accountId })
          return ctx.json({ accountId: result.accountId })
        },
      ),
    },
  }) satisfies BetterAuthPlugin
