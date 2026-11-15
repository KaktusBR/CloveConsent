// The Better Auth instance: email and password with verified addresses, TOTP second factor with backup
// codes, passkeys, database sessions and a database rate limiter. Its endpoints answer at /api/auth/*
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
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { haveIBeenPwned, twoFactor } from 'better-auth/plugins'
import { passkey } from '@better-auth/passkey'
import { localeOfPath, localizedPath, LOCALE_COOKIE, preferredLocale, type Locale } from '../../i18n/locale'
import { m } from '../../paraglide/messages.js'
import { createHash } from 'node:crypto'
import { authDatabase } from '../data/auth-database'
import { consumeLimit } from '../data/auth-limits'
import { authSchema } from '../data/schema'
import { env } from '../env'
import { log } from '../log'
import { sendMail } from '../jobs/mail'

export const AUTH_BASE_PATH = '/api/auth'

/** The request header carrying the client address to Better Auth (src/server/auth/handler.ts sets it). */
export const CLIENT_ADDRESS_HEADER = 'x-cmp-client-address'

/** Sign-ins per account, from any address. */
const ACCOUNT_SIGN_IN = { window: 15 * 60, max: 10 }
/** The account limit's key: a hash of the address, so the table holds no email address. */
const accountLimitKey = (email: string) => `account:${createHash('sha256').update(email.trim().toLowerCase()).digest('base64url')}|/sign-in/email`

/** Paths that create a session only after the second factor (or a passkey, which is both factors). */
const SECOND_FACTOR_PATHS: ReadonlySet<string> = new Set(['/two-factor/verify-totp', '/two-factor/verify-backup-code', '/passkey/verify-authentication'])

/**
 * The language of the page a request came from (its Referer on this site; the browser sends the full URL
 * to the same origin), else the reader's preferred one. Auth emails are written in it.
 */
export function localeOfRequest(request: Request | undefined): Locale {
  const referer = request?.headers.get('referer')
  if (referer && URL.canParse(referer)) {
    const url = new URL(referer)
    if (url.origin === env.PUBLIC_ORIGIN) return localeOfPath(url.pathname)
  }
  const cookie = request?.headers.get('cookie')?.match(new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]*)`))?.[1] ?? null
  return preferredLocale(cookie, request?.headers.get('accept-language') ?? null)
}

/** An absolute link to a page of this site in `locale`. */
const pageLink = (path: string, locale: Locale) => new URL(localizedPath(path, locale), env.PUBLIC_ORIGIN)

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
        url.searchParams.set('callbackURL', `${localizedPath('/verify-email', locale)}?status=verified`)
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
      },
    },

    advanced: {
      cookiePrefix: 'cmp',
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
    ],

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // "Trust this device" would let a later sign-in skip the second factor: not offered, refused.
        if (ctx.path.startsWith('/two-factor/verify-') && (ctx.body as { trustDevice?: unknown } | undefined)?.trustDevice) {
          throw new APIError('BAD_REQUEST', { code: 'TRUST_DEVICE_NOT_ALLOWED', message: 'trusting a device is not allowed' })
        }
        // Per account, from any address: password guessing spread over many addresses. (Counts every
        // attempt; a passkey sign-in is not affected, so a person locked out this way can still use one.)
        if (ctx.path === '/sign-in/email') {
          const email = (ctx.body as { email?: unknown } | undefined)?.email
          if (typeof email === 'string' && !(await consumeLimit(accountLimitKey(email), ACCOUNT_SIGN_IN.window, ACCOUNT_SIGN_IN.max))) {
            throw new APIError('TOO_MANY_REQUESTS', { code: 'ACCOUNT_RATE_LIMITED', message: 'too many sign-ins for this account' })
          }
        }
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
