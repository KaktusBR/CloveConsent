// The Better Auth instance: email and password with verified addresses, TOTP second factor with backup
// codes, passkeys, database sessions and a database rate limiter; accounts (the organization plugin) and
// the super-admin's read-only impersonation (endpoints of our own, account-endpoints.ts). Its endpoints answer at /api/auth/*
// (src/pages/api/auth/[...all].ts), behind the middleware's origin check like every other request.
//
// Tables: src/server/data/schema/auth.ts, created by the migrations (never by Better Auth at runtime);
// reached through authDatabase on the app role (ruling R2).
//
// Mail goes through sendMail (the queue). Better Auth calls the senders after its own writes have
// completed and gives them no transaction, so a mail is queued on its own: if queueing fails the request
// fails and the person asks again (resend, forgot password), and a mail can be queued for a change that
// is then rolled back (its link then fails as invalid). Delivery is at least once (the queue retries).
import { betterAuth, type BetterAuthOptions } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api'
import { haveIBeenPwned, organization, twoFactor } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import { localizedPath } from '../../i18n/locale'
import { personName } from '../../lib/plain-text'
import { m } from '../../paraglide/messages.js'
import { createHash } from 'node:crypto'
import { authDatabase } from '../data/auth-database'
import { CLIENT_ADDRESS_HEADER } from '../security'
import { releaseInWindow, reserveInWindow } from '../data/auth-limits'
import { authSchema } from '../data/schema'
import { env } from '../env'
import { log } from '../log'
import { sendMail } from '../jobs/mail'
import { accountEndpoints, ACCOUNT_PATHS } from './account-endpoints'
import { organizationRoles } from './permissions'
import { endView, redactViews } from './impersonation'
import { refuseOthersIds } from './ownership'
import { COOKIE_PREFIX, impersonationOver, impersonatorOf } from './super-admin'
import { localeOfRequest, nextOfRequest, pageLink } from './request-locale'

export { localeOfRequest }

export const AUTH_BASE_PATH = '/api/auth'

/**
 * Failed password sign-ins (ruling R19), beside Better Auth's per-address request limit. An address is a
 * client as src/server/client-address.ts sees it: an IPv4 address, or an IPv6 /64.
 * - per (account, address): 4 in 15 minutes, then that address may not try that account again until the
 *   window ends. One address cannot lock an account for anyone else.
 * - per account, from any address: 200 in an hour, a backstop against guessing spread over many addresses.
 * Each attempt takes a place in both windows before the password is checked, in one statement per window
 * (so concurrent attempts cannot exceed them), and gives it back unless the password was wrong (to the
 * window it was taken in only; a refused attempt takes no place).
 * Accepted residual: the windows are fixed (they start at their first failure), so one address can fail
 * up to about 19 or 20 times for an account inside one account hour (4 in each 15-minute window it
 * touches). Keeping one account's password sign-in blocked therefore takes about 11 distinct IPv4
 * addresses or IPv6 /64s every hour; a single customer with a /56 or /48 holds 256 or more /64s, so can
 * do it alone. Its passkey sign-in is never blocked.
 */
const FAILURES = { pair: { window: 15 * 60, max: 4 }, account: { window: 60 * 60, max: 200 } } as const

/** The windows a sign-in request took its places in, from the before-hook to the after-hook (keyed by the request). */
const signInPlaces = new WeakMap<object, { pair: number; account: number }>()

/** The counters of a password sign-in request; keyed by a hash of the email, so the table holds no address in clear. */
function failureKeys(ctx: { path: string; body?: unknown; headers?: Headers | undefined; request?: Request | undefined }): { pair: string; account: string } | null {
  if (ctx.path !== '/sign-in/email') return null
  const email = (ctx.body as { email?: unknown } | undefined)?.email
  if (typeof email !== 'string') return null
  const account = createHash('sha256').update(email.trim().toLowerCase()).digest('base64url')
  // set by src/server/auth/handler.ts for every request it passes on
  const address = (ctx.headers ?? ctx.request?.headers)?.get(CLIENT_ADDRESS_HEADER) ?? 'unknown'
  return { pair: `sign-in-failures:${account}:${address}`, account: `sign-in-failures:${account}` }
}

/**
 * Better Auth's organization plugin is the product's accounts: its tables (renamed, see
 * src/server/data/schema/auth.ts), the session's active account, and its roles (ours, from
 * permissions.ts). None of its endpoints answers over HTTP (disabledPaths below): accounts are created,
 * switched and their members changed through the app's own routes and the account endpoints
 * (account-endpoints.ts), which answer 404 for another account's ids and write each change with its audit
 * row in one transaction. Server code may still call its API (`auth.api.setActiveOrganization`).
 */
// Only what applies with its endpoints switched off: the roles (for its server-side permission checks)
// and the schema. The real checks live elsewhere: invitations (7 days, bound to one address, used once,
// the inviter re-checked, limits) and every member change in src/server/data/accounts.ts; who may do
// what in permissions.ts; the account kept with an owner by the database (drizzle/0006_accounts.sql);
// accounts are not deleted (no route does it).
const accounts = organization({
  roles: organizationRoles,
  schema: {
    member: { fields: { organizationId: 'accountId' } },
    invitation: {
      fields: { organizationId: 'accountId' },
      // the SHA-256 of the link's token (src/server/data/accounts.ts writes it; Better Auth never shows it)
      additionalFields: { tokenHash: { type: 'string', required: true, input: false, returned: false } },
    },
    session: { fields: { activeOrganizationId: 'activeAccountId' } },
  },
})
/** Every path of the organization plugin: none is served over HTTP. */
export const ORGANIZATION_PATHS: readonly string[] = Object.values(accounts.endpoints).map((e) => e.path)

/**
 * Better Auth's endpoints for third-party sign-in (social and OAuth providers): the product has none (no
 * third-party identity provider), and these take the id of a provider account, answering 400 rather than
 * 404 for another person's. Not served. (Its OAuth callback, `/callback/:id`, cannot be listed by pattern;
 * with no provider it only redirects to the error page.)
 */
export const THIRD_PARTY_PATHS: readonly string[] = ['/sign-in/social', '/link-social', '/unlink-account', '/get-access-token', '/refresh-token', '/account-info']

/** Paths that create a session only after the second factor (or a passkey, which is both factors). */
const SECOND_FACTOR_PATHS: ReadonlySet<string> = new Set(['/two-factor/verify-totp', '/two-factor/verify-backup-code', '/passkey/verify-authentication'])

/**
 * The Better Auth options for a public origin: the app uses PUBLIC_ORIGIN ({@link auth}); tests build
 * one for another origin (an https one, to check the cookie attributes). Mail links always point to
 * PUBLIC_ORIGIN.
 */
function authOptions(publicOrigin: string) {
  const origin = new URL(publicOrigin)
  const secure = origin.protocol === 'https:'
  return {
    appName: m.app_name({}, { locale: 'en' }),
    baseURL: origin.origin,
    basePath: AUTH_BASE_PATH,
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [origin.origin],
    telemetry: { enabled: false },
    disabledPaths: [...ORGANIZATION_PATHS, ...THIRD_PARTY_PATHS],
    database: drizzleAdapter(authDatabase, { provider: 'pg', schema: authSchema, transaction: true }),

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      async sendResetPassword({ user, token }, request) {
        const locale = localeOfRequest(request)
        const url = pageLink('/reset-password', locale)
        url.searchParams.set('token', token)
        await sendMail({ to: user.email, template: 'reset-password', locale, data: { url: url.href } })
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: false,
      // Signing in stays a separate step: a verification link never signs anyone in.
      autoSignInAfterVerification: false,
      expiresIn: 24 * 60 * 60,
      async sendVerificationEmail({ user, token }, request) {
        const locale = localeOfRequest(request)
        // Better Auth checks the token, then redirects to our page (with `error=` when the link is bad).
        const url = new URL(`${AUTH_BASE_PATH}/verify-email`, env.PUBLIC_ORIGIN)
        url.searchParams.set('token', token)
        // back to where sign-up was asked from (an invitation's link), when that is a page of this site
        const next = nextOfRequest(request)
        url.searchParams.set('callbackURL', `${localizedPath('/verify-email', locale)}?${new URLSearchParams(next ? { status: 'verified', next } : { status: 'verified' })}`)
        await sendMail({ to: user.email, template: 'verify-email', locale, data: { url: url.href } })
      },
    },

    session: {
      expiresIn: 7 * 24 * 60 * 60,
      updateAge: 24 * 60 * 60,
      // no cookie cache: every request reads the session from the database, so a revoked session ends at once
      cookieCache: { enabled: false },
      additionalFields: {
        secondFactor: { type: 'boolean', required: false, defaultValue: false, input: false },
        // the super-admin viewing as this session's user (src/server/auth/super-admin.ts); set only by the
        // server-only start of an impersonation (account-endpoints.ts)
        impersonatedBy: { type: 'string', required: false, input: false },
      },
    },
    verification: { storeIdentifier: 'hashed' },

    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 3 },
        '/request-password-reset': { window: 300, max: 3 },
        '/reset-password': { window: 300, max: 5 },
        '/send-verification-email': { window: 300, max: 3 },
        '/two-factor/verify-*': { window: 60, max: 5 },
        '/passkey/verify-authentication': { window: 60, max: 10 },
        // each invitation sends an email; an invitation link is tried by a signed-in person only
        [ACCOUNT_PATHS.invite]: { window: 10 * 60, max: 20 },
        [ACCOUNT_PATHS.accept]: { window: 60, max: 10 },
      },
    },

    advanced: {
      cookiePrefix: COOKIE_PREFIX,
      // __Secure- names and the Secure attribute whenever the site is served over https (always in production)
      useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, secure, sameSite: 'lax', path: '/' },
      database: { generateId: 'uuid' },
      // the client address, set by src/server/auth/handler.ts only (never X-Forwarded-For directly)
      ipAddress: { ipAddressHeaders: [CLIENT_ADDRESS_HEADER] },
    },

    plugins: [
      haveIBeenPwned(),
      twoFactor({
        issuer: m.app_name({}, { locale: 'en' }),
        backupCodeOptions: { amount: 10, length: 10, storeBackupCodes: 'encrypted' },
        // the sign-in challenge between password and code
        twoFactorCookieMaxAge: 10 * 60,
      }),
      passkey({
        rpID: origin.hostname,
        rpName: m.app_name({}, { locale: 'en' }),
        origin: origin.origin,
        // a passkey counts as both factors, so the authenticator must verify the person (PIN or biometrics)
        authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      }),
      accounts,
      accountEndpoints(),
    ],

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // A super-admin viewing as a member (super-admin.ts), whatever endpoint the session is presented
        // to, read from its cookie without a refresh:
        // - past its time it is deleted, so no endpoint serves it (whatever its row's expiry says: a
        //   refresh could have extended that);
        // - otherwise it writes nothing: any HTTP request other than GET or HEAD is refused. Server-side
        //   calls (no request) are the app's own, made after its checks.
        if (ctx.request || ctx.headers) {
          const token = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret)
          let found = token ? await ctx.context.internalAdapter.findSession(token) : null
          if (token && found && impersonatorOf(found as AuthSession) !== null) {
            if (impersonationOver(found.session)) {
              await ctx.context.internalAdapter.deleteSession(token)
              found = null
            } else if (ctx.request && !['GET', 'HEAD'].includes(ctx.request.method)) {
              throw new APIError('FORBIDDEN', { code: 'IMPERSONATION_READ_ONLY', message: 'a read-only view cannot change anything' })
            }
          }
          // a session or passkey id that is not the person's own: 404, as for one that does not exist
          if (found) await refuseOthersIds(ctx, found.session.userId)
        }
        // "Trust this device" would let a later sign-in skip the second factor: not offered, refused.
        if (ctx.path.startsWith('/two-factor/verify-') && (ctx.body as { trustDevice?: unknown } | undefined)?.trustDevice) {
          throw new APIError('BAD_REQUEST', { code: 'TRUST_DEVICE_NOT_ALLOWED', message: 'trusting a device is not allowed' })
        }
        // A person's name goes into the invitations they send: it must pass the mail's plain-text rule
        // where it comes in (src/lib/plain-text.ts), stored trimmed, so a stored name never makes an
        // invitation fail. No picture: nothing shows one, and its URL would be a request to anywhere.
        let profile: Record<string, unknown> | undefined
        if (ctx.path === '/sign-up/email' || ctx.path === '/update-user') {
          const body = (ctx.body ?? {}) as Record<string, unknown>
          if (body.image !== undefined) throw new APIError('BAD_REQUEST', { code: 'IMAGE_NOT_ALLOWED', message: 'a picture cannot be set' })
          if (ctx.path === '/sign-up/email' || body.name !== undefined) {
            const name = personName(body.name)
            if (name === null) throw new APIError('BAD_REQUEST', { code: 'INVALID_NAME', message: 'the name must be one line of plain text' })
            profile = { ...body, name }
          }
        }
        // Failed passwords (ruling R19): a place in the pair's window, then in the account's; refused
        // when either is full (the pair is checked first, so a refused address never uses up the account's).
        const signIn = failureKeys(ctx)
        if (signIn) {
          const refuse = () => new APIError('TOO_MANY_REQUESTS', { code: 'SIGN_IN_LIMITED', message: 'too many failed sign-ins' })
          const pair = await reserveInWindow(signIn.pair, FAILURES.pair.window, FAILURES.pair.max)
          if (pair === false) throw refuse()
          const account = await reserveInWindow(signIn.account, FAILURES.account.window, FAILURES.account.max)
          if (account === false) {
            await releaseInWindow(signIn.pair, pair)
            throw refuse()
          }
          const request = ctx.request ?? ctx.headers
          if (request) signInPlaces.set(request, { pair, account })
        }
        return profile ? { context: { body: profile } } : undefined
      }),
      after: createAuthMiddleware(async (ctx) => {
        // only a wrong email or password keeps its places (not a right one, nor an unverified address)
        const signIn = failureKeys(ctx)
        const request = ctx.request ?? ctx.headers
        const places = request ? signInPlaces.get(request) : undefined
        const returned = ctx.context.returned
        const failed = isAPIError(returned) && (returned.body as { code?: unknown } | undefined)?.code === 'INVALID_EMAIL_OR_PASSWORD'
        if (signIn && places && !failed) await Promise.all([releaseInWindow(signIn.pair, places.pair), releaseInWindow(signIn.account, places.account)])

        // Signing out after a super-admin's view has ended (past its time, or revoked by the member: a
        // live view cannot sign out) ends it here too: recorded, the impersonator cookie expired and the
        // super-admin's own session deleted, so the next request does not bring it back.
        if (ctx.path === '/sign-out' && !isAPIError(returned)) await endView(ctx, 'sign-out')

        // A member's list of their sessions shows a view as a support view, without who or where.
        if (ctx.path === '/list-sessions') {
          const listed = returned instanceof Response ? (returned.status === 200 ? await returned.clone().json() : null) : isAPIError(returned) ? null : returned
          if (Array.isArray(listed)) return ctx.json(redactViews(listed as Record<string, unknown>[]))
        }
        return undefined
      }),
    },

    databaseHooks: {
      session: {
        create: {
          // Mark whether this session passed a second factor; src/server/auth/guard.ts requires it from users with 2FA.
          // A session counts as having passed the second factor when it is created by that step (or a
          // passkey), or when it replaces a session of the same user that had (change-password with
          // revokeOtherSessions, the 2FA endpoints, any later endpoint that re-issues the session).
          // Anything else (a password sign-in, whatever its path) is unmarked.
          async before(session, ctx) {
            const current = ctx?.context.session
            const inherited = current?.user.id === session.userId && (current.session as { secondFactor?: unknown }).secondFactor === true
            return { data: { ...session, secondFactor: SECOND_FACTOR_PATHS.has(ctx?.path ?? '') || inherited } }
          },
        },
      },
      user: {
        update: {
          async after(user, ctx) {
            // Only these endpoints switch two-factor authentication (verify-totp when finishing its setup).
            const state = ctx?.path === '/two-factor/disable' ? 'disabled' : ctx?.path === '/two-factor/verify-totp' && user.twoFactorEnabled ? 'enabled' : null
            if (!state || !ctx) return
            // Turning it on ends every session of the user that did not pass it; the request's own session
            // is replaced by Better Auth right after this hook.
            if (state === 'enabled') await ctx.context.internalAdapter.deleteUserSessions(user.id)
            const locale = localeOfRequest(ctx.request)
            await sendMail({ to: user.email, template: 'two-factor-changed', locale, data: { url: pageLink('/account/security', locale).href, state } })
          },
        },
      },
    },

    logger: {
      // its warnings are mostly people's mistakes ("Invalid password"): kept in production, quiet in tests
      level: env.NODE_ENV === 'test' ? 'error' : 'warn',
      // Better Auth's own message only: its extra arguments can carry request data or database errors that quote values.
      log(level, message, ...args) {
        const errors = args.filter((a): a is Error => a instanceof Error).map((e) => e.name)
        const fields = { source: 'better-auth', ...(errors.length > 0 ? { errors } : {}) }
        if (level === 'error') log.error(fields, message)
        else if (level === 'warn') log.warn(fields, message)
        else log.info(fields, message)
      },
    },
  } satisfies BetterAuthOptions
}

/** A Better Auth instance for `publicOrigin`. */
export const createAuth = (publicOrigin: string) => betterAuth(authOptions(publicOrigin))

export type AuthInstance = ReturnType<typeof createAuth>

/** The app's instance, on PUBLIC_ORIGIN. */
export const auth: AuthInstance = createAuth(env.PUBLIC_ORIGIN)

export type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>
