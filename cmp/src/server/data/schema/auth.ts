import { bigint, boolean, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'

/**
 * Better Auth's identity tables (ruling R2): sign-in identities, not tenant data. They have no account_id
 * and no row-level security; Better Auth guards them, through the adapter handle of auth-database.ts on
 * the app role. Grants (in the migration): to cmp_app only what Better Auth does with each table, never
 * TRUNCATE; nothing to cmp_system. test/db/rls.test.ts holds the list and checks those grants.
 *
 * The object keys are Better Auth's model names (the adapter finds tables by them); the SQL names carry an
 * `auth_` prefix, so raw SQL never meets the reserved word `user`, and Better Auth's `account` (a
 * sign-in method of a user) is `auth_credential`: "account" is the product's tenant (Task 7). Ids are
 * uuids (generateId: 'uuid' in src/server/auth/auth.ts): the tenant tables reference them.
 */
const id = () => uuid('id').defaultRandom().primaryKey()
const createdAt = () => timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull()

export const user = pgTable('auth_user', {
  id: id(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  image: text('image'),
  twoFactorEnabled: boolean('two_factor_enabled').default(false).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
})

export const session = pgTable(
  'auth_session',
  {
    id: id(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull().unique(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** The session was created by a second-factor step (TOTP, backup code) or a passkey (src/server/auth/guard.ts). */
    secondFactor: boolean('second_factor').default(false).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('auth_session_user_id_idx').on(t.userId)],
)

/** Better Auth's `account`: one sign-in method of a user (here only email and password). */
export const account = pgTable(
  'auth_credential',
  {
    id: id(),
    accountId: text('provider_account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    /** The password hash (scrypt), never the password. */
    password: text('password'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('auth_credential_user_id_idx').on(t.userId)],
)

/** One-time values: password-reset tokens, second-factor challenges, WebAuthn challenges. Identifiers are stored hashed. */
export const verification = pgTable(
  'auth_verification',
  {
    id: id(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('auth_verification_identifier_idx').on(t.identifier)],
)

/** TOTP secret and backup codes, both encrypted with BETTER_AUTH_SECRET. */
export const twoFactor = pgTable(
  'auth_two_factor',
  {
    id: id(),
    secret: text('secret').notNull(),
    backupCodes: text('backup_codes').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    verified: boolean('verified').default(true),
    failedVerificationCount: integer('failed_verification_count').default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
  },
  (t) => [index('auth_two_factor_user_id_idx').on(t.userId)],
)

export const passkey = pgTable(
  'auth_passkey',
  {
    id: id(),
    name: text('name'),
    publicKey: text('public_key').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    credentialID: text('credential_id').notNull(),
    counter: integer('counter').notNull(),
    deviceType: text('device_type').notNull(),
    backedUp: boolean('backed_up').notNull(),
    transports: text('transports'),
    createdAt: timestamp('created_at', { withTimezone: true }),
    aaguid: text('aaguid'),
  },
  (t) => [index('auth_passkey_user_id_idx').on(t.userId), index('auth_passkey_credential_id_idx').on(t.credentialID)],
)

/** Better Auth's rate limiter: one row per client address and path, shared by every app process. */
export const rateLimit = pgTable('auth_rate_limit', {
  id: id(),
  key: text('key').notNull().unique(),
  count: integer('count').notNull(),
  lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
})

/** The adapter's schema: Better Auth model name → table. */
export const authSchema = { user, session, account, verification, twoFactor, passkey, rateLimit }
