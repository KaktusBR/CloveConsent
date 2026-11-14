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
import { authDatabase } from '../data/auth-database'
import { authSchema } from '../data/schema'
import { env } from '../env'
import { log } from '../log'
import { sendMail } from '../jobs/mail'

export const AUTH_BASE_PATH = '/api/auth'

/** Paths that create a session only after the second factor (or a passkey, which is both factors). */
const SECOND_FACTOR_PATHS: ReadonlySet<string> = new Set(['/two-factor/verify-totp', '/two-factor/verify-backup-code', '/passkey/verify-authentication'])

const origin = new URL(env.PUBLIC_ORIGIN)
const secure = origin.protocol === 'https:'

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

const options = {
  appName: m.app_name({}, { locale: 'en' }),
  baseURL: env.PUBLIC_ORIGIN,
  basePath: AUTH_BASE_PATH,
  secret: env.BETTER_AUTH_SECRET,
  trustedOrigins: [env.PUBLIC_ORIGIN],
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
      origin: env.PUBLIC_ORIGIN,
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
    }),
  },

  databaseHooks: {
    session: {
      create: {
        // Mark whether this session passed a second factor; src/server/auth/guard.ts requires it from users with 2FA.
        async before(session, ctx) {
          return { data: { ...session, secondFactor: SECOND_FACTOR_PATHS.has(ctx?.path ?? '') } }
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

export const auth = betterAuth(options)

export type AuthSession = NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>
