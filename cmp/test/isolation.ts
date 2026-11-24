// The tenant-isolation sweep's cases (Review Focus 1), shared by test/db/isolation.test.ts (every endpoint
// and every Better Auth endpoint, in-process) and e2e/isolation.spec.ts (every route over HTTP, in both
// languages). A member of account A presents account B's identifiers to each route, in the path, the query
// and the body: a route that takes an identifier answers 404, every other route ignores them, and the
// answer, the logs and the database hold nothing of B.
//
// The cases are keyed by the routes of Astro's route manifest (test/routes.ts) and by Better Auth's served paths: both
// sweeps fail on a route or path that has no case here, so a new one is swept on purpose.
import type pg from 'pg'

/** Everything that identifies account B and its people: what A is assumed to know, or to have guessed. */
export interface OtherAccount {
  accountId: string
  accountName: string
  /** B's owner first, then a member. */
  people: { userId: string; email: string; name: string; memberId: string }[]
  /** A pending invitation of B, to someone outside A (its token is the one in the link). */
  invitation: { id: string; token: string; email: string }
  /** One of B's owner's sessions. */
  session: { id: string; token: string }
  /** B's owner's passkey. */
  passkey: { id: string; name: string }
  /** B's owner's password sign-in (a row of auth_credential). */
  credentialId: string
}

/** One request of the sweep, made by a member (the owner) of account A. */
export interface Probe {
  method: 'GET' | 'POST'
  /** The request path, with its query; a page under [...locale] is also requested as `/sk/...`. */
  path: string
  /** A form body (the app's own form endpoints). */
  form?: Record<string, string>
  /** A JSON body (Better Auth's endpoints). */
  json?: Record<string, unknown>
  /** The status A gets. */
  status: number
}

/** B's identifiers as fields a request might carry. */
const idFields = (b: OtherAccount): Record<string, string> => ({
  account: b.accountId,
  accountId: b.accountId,
  organizationId: b.accountId,
  user: b.people[0]!.userId,
  userId: b.people[0]!.userId,
  member: b.people[1]!.memberId,
  invitation: b.invitation.id,
  session: b.session.id,
})

/** `path` with B's identifiers in its query: a route that takes none ignores them. */
const withIds = (path: string, b: OtherAccount) => `${path}${path.includes('?') ? '&' : '?'}${new URLSearchParams(idFields(b))}`

const get = (path: string, status: number): Probe => ({ method: 'GET', path, status })
const form = (path: string, fields: Record<string, string>, status: number): Probe => ({ method: 'POST', path, form: fields, status })
const json = (path: string, body: Record<string, unknown>, status: number): Probe => ({ method: 'POST', path: `/api/auth${path}`, json: body, status })

/**
 * Better Auth's endpoints that take an identifier of a session, a sign-in method, a passkey, an account, a
 * member or an invitation: each answers 404 to B's (a path no longer served answers 404 too).
 */
export const AUTH_ID_PROBES: Record<string, (b: OtherAccount) => Probe[]> = {
  '/revoke-session': (b) => [json('/revoke-session', { token: b.session.token }, 404)],
  '/passkey/delete-passkey': (b) => [json('/passkey/delete-passkey', { id: b.passkey.id }, 404)],
  '/passkey/update-passkey': (b) => [json('/passkey/update-passkey', { id: b.passkey.id, name: 'renamed' }, 404)],
  '/account/invite': (b) => [json('/account/invite', { accountId: b.accountId, email: 'isolation-new@example.test', role: 'viewer' }, 404)],
  '/account/accept-invitation': (b) => [json('/account/accept-invitation', { token: b.invitation.token }, 404)],
  // a third-party sign-in's account (none is configured): never served (src/server/auth/auth.ts)
  '/account-info': (b) => [{ method: 'GET', path: `/api/auth/account-info?accountId=${b.credentialId}`, status: 404 }],
  '/unlink-account': (b) => [json('/unlink-account', { providerId: 'credential', accountId: b.people[0]!.userId }, 404)],
  '/get-access-token': (b) => [json('/get-access-token', { providerId: 'credential', accountId: b.credentialId, userId: b.people[0]!.userId }, 404)],
  '/refresh-token': (b) => [json('/refresh-token', { providerId: 'credential', accountId: b.credentialId, userId: b.people[0]!.userId }, 404)],
  '/link-social': () => [json('/link-social', { provider: 'google' }, 404)],
  '/sign-in/social': () => [json('/sign-in/social', { provider: 'google' }, 404)],
  // the session's active account is not a field a request may set (whichever account it names)
  '/update-session': (b) => [json('/update-session', { activeOrganizationId: b.accountId }, 400)],
}

/**
 * Better Auth's served endpoints that take no identifier of anyone else (the signed-in person's own
 * session, a one-time token from an email, or nothing). test/db/isolation.test.ts calls each with B's
 * identifiers in the query or body anyway, from a member of A: nothing of B in the answer, nothing of B changed.
 */
export const AUTH_NO_IDS: readonly string[] = [
  '/callback/:id',
  '/change-email',
  '/change-password',
  '/delete-user',
  '/delete-user/callback',
  '/error',
  '/get-session',
  '/list-accounts',
  '/list-sessions',
  '/ok',
  '/passkey/generate-authenticate-options',
  '/passkey/generate-register-options',
  '/passkey/list-user-passkeys',
  '/passkey/verify-authentication',
  '/passkey/verify-registration',
  '/request-password-reset',
  '/reset-password',
  '/reset-password/:token',
  '/revoke-other-sessions',
  '/revoke-sessions',
  '/send-verification-email',
  '/sign-in/email',
  '/sign-out',
  '/sign-up/email',
  '/two-factor/disable',
  '/two-factor/enable',
  '/two-factor/generate-backup-codes',
  '/two-factor/get-totp-uri',
  '/two-factor/send-otp',
  '/two-factor/verify-backup-code',
  '/two-factor/verify-otp',
  '/two-factor/verify-totp',
  '/update-user',
  '/verify-email',
  '/verify-password',
]

/**
 * Every route of the route manifest (test/routes.ts: src/pages and the routes Astro injects) and what A sends it. A route that takes an identifier gets B's
 * and answers 404; any other gets B's identifiers in its query (and form) and answers as it does for A.
 */
export const ROUTE_PROBES: Record<string, (b: OtherAccount) => Probe[]> = {
  // pages
  '/': (b) => [get(withIds('/', b), 200)],
  '/404': (b) => [get(withIds('/404', b), 404)],
  // Astro's injected routes: the image endpoint refuses a request without an image (400); there is no
  // server island, so a request for one is refused (400 without its parameters, 404 with them)
  '/_image': (b) => [get(withIds('/_image', b), 400)],
  '/_server-islands/[name]': (b) => [get(withIds('/_server-islands/sample', b), 400), get(withIds('/_server-islands/sample?e=x&p=y&s=z', b), 404)],
  '/account': (b) => [get(withIds('/account', b), 200)],
  '/account/members': (b) => [get(withIds('/account/members', b), 200)],
  '/account/security': (b) => [get(withIds('/account/security', b), 200)],
  '/accounts/new': (b) => [get(withIds('/accounts/new', b), 200)],
  '/admin/accounts': (b) => [get(`/admin/accounts?${new URLSearchParams({ q: b.accountName })}`, 404), get(`/admin/accounts?q=${b.accountId}`, 404)],
  '/admin/accounts/[id]': (b) => [get(`/admin/accounts/${b.accountId}`, 404)],
  '/admin/audit': (b) => [get(`/admin/audit?account=${b.accountId}`, 404)],
  '/forgot-password': (b) => [get(withIds('/forgot-password', b), 200)],
  '/invite/[token]': (b) => [get(`/invite/${b.invitation.token}`, 404)],
  '/paywall': (b) => [get(withIds('/paywall', b), 200)],
  '/reset-password': (b) => [get(withIds(`/reset-password?token=${b.session.token}`, b), 200)],
  // signed in already: on to the account
  '/sign-in': (b) => [get(withIds('/sign-in', b), 303)],
  '/sign-up': (b) => [get(withIds('/sign-up', b), 200)],
  '/sites': (b) => [get(withIds('/sites', b), 200)],
  '/two-factor': (b) => [get(withIds('/two-factor', b), 200)],
  '/verify-email': (b) => [get(withIds('/verify-email', b), 200)],

  // endpoints
  '/api/account/members': (b) => [
    ...b.people.flatMap((p) => [
      form('/api/account/members', { intent: 'role', member: p.memberId, role: 'viewer' }, 404),
      form('/api/account/members', { intent: 'remove', member: p.memberId }, 404),
      form('/api/account/members', { intent: 'remove', member: p.userId }, 404),
    ]),
    form('/api/account/members', { intent: 'cancel', invitation: b.invitation.id }, 404),
  ],
  '/api/account/revoke-session': (b) => [form('/api/account/revoke-session', { session: b.session.id }, 404)],
  '/api/account/switch': (b) => [form('/api/account/switch', { account: b.accountId }, 404)],
  // no name: refused back to its form, which changes nothing (a new account would become A's active one)
  '/api/accounts/create': (b) => [form('/api/accounts/create', { ...idFields(b), name: '' }, 303)],
  '/api/admin/entitlement': (b) => [
    form('/api/admin/entitlement', { intent: 'set', account: b.accountId, plan: 'agency', paidUntil: '2099-12-31', reason: 'isolation' }, 404),
    form('/api/admin/entitlement', { intent: 'suspend', account: b.accountId, reason: 'isolation' }, 404),
  ],
  '/api/admin/impersonate': (b) => b.people.map((p) => form('/api/admin/impersonate', { account: b.accountId, user: p.userId, reason: 'isolation' }, 404)),
  '/api/auth/[...all]': (b) => Object.values(AUTH_ID_PROBES).flatMap((probes) => probes(b)),
  '/api/impersonation/stop': (b) => [form('/api/impersonation/stop', idFields(b), 404)],
  '/api/locale': (b) => [get(`/api/locale?to=sk&next=${encodeURIComponent(`/admin/accounts/${b.accountId}`)}`, 303)],
  '/healthz': (b) => [get(withIds('/healthz', b), 200)],
  '/readyz': (b) => [get(withIds('/readyz', b), 200)],
}

/**
 * Cookies that claim B as the account, the session or the impersonated member: none is believed (the
 * active account is the session's, read from the database with the membership; the impersonator cookie is
 * signed by the server). Named as the app's cookies are (the `cmp` prefix).
 */
export function forgedCookies(b: OtherAccount): Record<string, string> {
  const claim = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return {
    'cmp.active_account': b.accountId,
    'cmp.active_organization': b.accountId,
    'cmp.session_data': claim({ session: { session: { activeOrganizationId: b.accountId, userId: b.people[0]!.userId }, user: { id: b.people[0]!.userId } }, expiresAt: Date.now() + 3_600_000 }),
    'cmp.impersonator': `${claim({ by: b.people[0]!.userId, userId: b.people[0]!.userId, accountId: b.accountId, token: b.session.token })}.forged`,
  }
}

/** The strings of B that must appear nowhere in what A gets back or causes to be logged. */
export function factsOf(b: OtherAccount): string[] {
  return [
    b.accountId,
    b.accountName,
    ...b.people.flatMap((p) => [p.userId, p.email, p.name, p.memberId]),
    b.invitation.id,
    b.invitation.token,
    b.invitation.email,
    b.session.id,
    b.session.token,
    b.passkey.id,
    b.passkey.name,
    b.credentialId,
  ]
}

/**
 * The facts of B found in `text` that A did not send itself (`sent`: the request's path, body and
 * cookies). Echoing A's own input back reveals nothing about B.
 */
export function leaksOf(text: string, b: OtherAccount, sent: string): string[] {
  const haystack = text.toLowerCase()
  const own = sent.toLowerCase()
  return factsOf(b).filter((fact) => haystack.includes(fact.toLowerCase()) && !own.includes(fact.toLowerCase()) && !own.includes(encodeURIComponent(fact).toLowerCase()))
}

/**
 * Every row of the database about B (its account, members, invitations, entitlement, audit log, and its
 * people's sign-in data and sessions), plus any session that names B as its account: compared before and
 * after each request. Read as the app role (`client`), with B as the transaction's account for the tables
 * under row-level security.
 */
export async function snapshotOf(client: pg.Client, b: OtherAccount): Promise<string> {
  const users = b.people.map((p) => p.userId)
  const emails = [...b.people.map((p) => p.email), b.invitation.email]
  await client.query('begin')
  try {
    await client.query(`select set_config('app.account_id', $1, true)`, [b.accountId])
    const { rows } = await client.query<{ kind: string; row: unknown }>(
      `select 'user' as kind, to_jsonb(t) as row from auth_user t where id = any($1::uuid[])
       union all select 'session', to_jsonb(t) from auth_session t where user_id = any($1::uuid[]) or active_account_id = $2::uuid
       union all select 'credential', to_jsonb(t) from auth_credential t where user_id = any($1::uuid[])
       union all select 'two_factor', to_jsonb(t) from auth_two_factor t where user_id = any($1::uuid[])
       union all select 'passkey', to_jsonb(t) from auth_passkey t where user_id = any($1::uuid[])
       union all select 'account', to_jsonb(t) from auth_account t where id = $2::uuid
       union all select 'member', to_jsonb(t) from auth_account_member t where account_id = $2::uuid or user_id = any($1::uuid[])
       union all select 'invitation', to_jsonb(t) from auth_account_invitation t where account_id = $2::uuid or email = any($3::text[])
       union all select 'entitlement', to_jsonb(t) from entitlements t where account_id = $2::uuid
       union all select 'audit', to_jsonb(t) from audit_log t where account_id = $2::uuid
       order by 1, 2`,
      [users, b.accountId, emails],
    )
    return JSON.stringify(rows)
  } finally {
    await client.query('rollback')
  }
}
