// Inviting someone to an account and accepting an invitation: Better Auth endpoints of our own (at
// /api/auth/account/*), so they pass through Better Auth's request handling, origin check and rate limits
// (src/server/auth/auth.ts has their rules). The work is the data layer's (src/server/data/accounts.ts):
// the invitation, its audit row and its email, or the membership and its audit row, each in one
// transaction. The organization plugin's own endpoints are switched off (auth.ts, disabledPaths): they
// would store the link token in clear, answer 400 or 403 for another account's ids, and write outside
// one transaction.
//
// Also the super-admin's read-only impersonation (src/server/auth/super-admin.ts): two server-only
// endpoints (no URL; `auth.api.startImpersonation` / `auth.api.endImpersonation`), called by the
// console's form endpoints after their checks, and checking again themselves.
import type { BetterAuthPlugin } from 'better-auth'
import { APIError, createAuthEndpoint, sessionMiddleware } from 'better-auth/api'
import { setSessionCookie } from 'better-auth/cookies'
import * as z from 'zod'
import { acceptInvitation, createInvitation, membershipOf, type InvitationAccepted } from '../data/accounts'
import type { AccountScope } from '../data/scope'
import { sendMail } from '../jobs/mail'
import { isComplete } from './complete'
import { can, isRole } from './permissions'
import { localeOfRequest, pageLink } from './request-locale'
import { IMPERSONATION_SECONDS, isListedSuperAdmin, superAdminStatus } from './super-admin'
import type { AuthSession } from './auth'
import { endView, keepSuperAdminAside } from './impersonation'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
          if (result === 'unpaid') throw refuse('FORBIDDEN', 'INVITATION_NEEDS_PAYMENT')
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

      /**
       * A super-admin opens a read-only view of `accountId` as its member `userId` (server only); the view
       * is named `impersonation`. The caller (src/pages/api/admin/impersonate.ts) has written the start,
       * with that name, to the audit log. Refused (404) unless the request's session is a super-admin's
       * (so never from inside a view), and unless the person is a member of that account and not a
       * super-admin. The new session works in that account, counts as having passed the second factor
       * (the super-admin's own session did), lasts IMPERSONATION_SECONDS and is "don't remember" (never
       * refreshed); the super-admin's session is kept aside in the impersonator cookie, bound to this
       * view (impersonation.ts).
       */
      startImpersonation: createAuthEndpoint.serverOnly(
        { method: 'POST', body: z.object({ userId: z.string(), accountId: z.string(), impersonation: z.string().regex(UUID) }), use: [sessionMiddleware] },
        async (ctx) => {
          const own = ctx.context.session as unknown as AuthSession
          if (superAdminStatus(own) !== 'super-admin') throw refuse('NOT_FOUND', 'NOT_FOUND')
          const { userId, accountId, impersonation } = ctx.body
          const target = userId === own.user.id ? null : await ctx.context.internalAdapter.findUserById(userId)
          if (!target || isListedSuperAdmin(target.email) || (await membershipOf(userId, accountId)) === null) throw refuse('NOT_FOUND', 'NOT_FOUND')

          const created = await ctx.context.internalAdapter.createSession(
            userId,
            true,
            { impersonatedBy: own.user.id, activeOrganizationId: accountId, expiresAt: new Date(Date.now() + IMPERSONATION_SECONDS * 1000) },
            true,
          )
          // the create hook (auth.ts) marks only sessions of a second-factor step: this one inherits the super-admin's
          const session = await ctx.context.internalAdapter.updateSession(created.token, { secondFactor: true })
          if (!session) throw refuse('NOT_FOUND', 'NOT_FOUND')

          const dontRemember = await ctx.getSignedCookie(ctx.context.authCookies.dontRememberToken.name, ctx.context.secret)
          await keepSuperAdminAside(ctx, {
            impersonation,
            view: session.id,
            started: new Date(session.createdAt).getTime(),
            by: own.user.id,
            token: own.session.token,
            dontRemember: !!dontRemember,
            userId,
            accountId,
          })
          await setSessionCookie(ctx, { session, user: target }, true)
          return ctx.json({ accountId })
        },
      ),

      /**
       * Ends the super-admin's view the impersonator cookie is bound to (server only), whether it is still
       * running (stopped), past its time (expired) or revoked by the member: recorded once, then the
       * super-admin's own session comes back (`restored`), or the browser is signed out if that has
       * ended too. `ended` is null when there is nothing to end (impersonation.ts, endView); the answer's
       * cookies then still expire a stale impersonator cookie (not an error, whose cookies would be lost).
       */
      endImpersonation: createAuthEndpoint.serverOnly({ method: 'POST' }, async (ctx) => ctx.json({ ended: await endView(ctx, 'restore') })),
    },
  }) satisfies BetterAuthPlugin
