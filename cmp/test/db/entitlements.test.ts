// Entitlements, the paid-access gate, and the super-admin console against the real database: the
// request rules as the middleware applies them (requestAccess, with the session and account read from
// the database), the console's form endpoints (called as the middleware would, with locals from
// signedInScope), Better Auth's handler, and the tables underneath. Review Focus 3: an account that has
// not paid gets only the paywall and account settings, and being marked paid takes effect on its next
// request without signing in again.
import type { APIRoute } from 'astro'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { POST as createAccountRoute } from '../../src/pages/api/accounts/create'
import { POST as entitlementRoute } from '../../src/pages/api/admin/entitlement'
import { POST as impersonateRoute } from '../../src/pages/api/admin/impersonate'
import { POST as stopRoute } from '../../src/pages/api/impersonation/stop'
import { auth } from '../../src/server/auth/auth'
import { completeSession, requestAccess, signedInScope } from '../../src/server/auth/guard'
import { ADMIN_LIMITS, IMPERSONATION_MINUTES, superAdminStatus } from '../../src/server/auth/super-admin'
import { accountDetail, auditEvents, searchAccounts } from '../../src/server/data/admin'
import { closeDatabases } from '../../src/server/data/client'
import { entitlementOf, GRACE_DAYS, listPlans, setEntitlement, suspendAccount, unsuspendAccount } from '../../src/server/data/entitlements'
import { closeQueue } from '../../src/server/data/queue'
import { SOCKET_PEER_HEADER } from '../../src/server/socket-peer'
import { secretOf, totp } from '../totp'
import { appRoutes, CONSOLE, OPEN, pathsOf } from '../routes'
import { Browser, ORIGIN, PASSWORD, pwnedStandIn, signedIn, signUp, verifiedUser } from './browser'
import { addAccount, asRole, errorCode, newId } from './raw'

const DAY = 24 * 60 * 60 * 1000

interface Person {
  email: string
  browser: Browser
  userId: string
}

async function person(label: string, email?: string): Promise<Person> {
  const verified = await verifiedUser(label, email)
  const browser = await signedIn(verified)
  const { session } = await signedInScope(browser.headers())
  if (!session) throw new Error('no session')
  return { email: verified, browser, userId: session.user.id }
}

/** A listed super-admin with two-factor authentication on, signed in with it (its session is replaced by one that passed the code). */
async function superAdmin(email: string): Promise<Person> {
  const who = await person('root', email)
  const enabled = await who.browser.call('/two-factor/enable', { password: PASSWORD })
  expect(enabled.status).toBe(200)
  const secret = secretOf(String(enabled.json?.totpURI))
  expect((await who.browser.call('/two-factor/verify-totp', { code: totp(secret) })).status).toBe(200)
  return who
}

/** A request of `who`'s browser, from its socket address, with its cookies. */
function requestOf(who: Person | Browser, path: string, method = 'GET', fields?: Record<string, string>): Request {
  const browser = who instanceof Browser ? who : who.browser
  const extra: Record<string, string> = fields ? { 'content-type': 'application/x-www-form-urlencoded' } : {}
  if (browser.peer) extra[SOCKET_PEER_HEADER] = browser.peer
  const init: RequestInit = { method, headers: browser.headers(extra) }
  if (fields) init.body = new URLSearchParams(fields)
  return new Request(`${ORIGIN}${path}`, init)
}

/** What the middleware decides for this request. */
async function accessOf(who: Person | Browser, path: string, method = 'GET') {
  return (await requestAccess(requestOf(who, path, method))).access
}

/** A plain form POST to one of the app's routes, with the locals the middleware would set; keeps the cookies it sets. */
async function post(route: APIRoute, who: Person, path: string, fields: Record<string, string>) {
  const request = requestOf(who, path, 'POST', fields)
  const locals = await signedInScope(request.headers)
  const response = await route({ request, locals, url: new URL(request.url) } as unknown as Parameters<APIRoute>[0])
  who.browser.keep(response)
  return { status: response.status, location: response.headers.get('location'), body: await response.text() }
}

/** A new account owned by `who`, now their active account. */
async function newAccount(who: Person, name = `Account ${newId().slice(0, 8)}`): Promise<string> {
  const created = await post(createAccountRoute, who, '/api/accounts/create', { name })
  expect(created).toMatchObject({ status: 303, location: '/account' })
  const scope = (await signedInScope(who.browser.headers())).scope
  expect(scope?.role).toBe('owner')
  return scope!.accountId
}

/** The super-admin rows of the audit log about `accountId`, oldest first (read as the system role). */
async function adminRows(accountId: string) {
  return asRole('system', async (c) =>
    (await c.query<{ actor_user_id: string | null; action: string; target: string | null; meta: Record<string, unknown> }>(
      `select actor_user_id, action, target, meta from audit_log where account_id = $1 and action like 'admin.%' order by created_at, id`,
      [accountId],
    )).rows,
  )
}

const impersonationRows = async (accountId: string) => (await adminRows(accountId)).filter((r) => r.action.startsWith('admin.impersonation_'))

const entitlementRow = (accountId: string) =>
  asRole('system', async (c) => (await c.query<{ plan_id: string | null; paid_until: Date | null; suspended_at: Date | null }>(`select plan_id, paid_until, suspended_at from entitlements where account_id = $1`, [accountId])).rows[0] ?? null)

/** The form of the account page: set a plan and the day it is paid through. */
const setPaid = (who: Person, accountId: string, paidThrough: string, reason = 'paid by bank transfer', plan = 'starter') =>
  post(entitlementRoute, who, '/api/admin/entitlement', { intent: 'set', account: accountId, plan, paidUntil: paidThrough, reason })

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10)

let rootA: Person
let rootB: Person

beforeAll(async () => {
  pwnedStandIn()
  rootA = await superAdmin('root-a@admin.test')
  rootB = await superAdmin('root-b@admin.test')
})

afterAll(async () => {
  await closeQueue()
  await closeDatabases()
})

describe('plans', () => {
  test('are data, seeded by the migration, with a translatable name and every limit', async () => {
    const plans = await listPlans()
    expect(plans.length).toBeGreaterThan(0)
    for (const plan of plans) {
      expect(plan.id).toMatch(/^[a-z][a-z0-9-]*$/)
      expect(plan.nameKey).toBe(`plan_${plan.id.replaceAll('-', '_')}`)
      expect(Object.keys(plan.limits).sort()).toEqual(['languages', 'members', 'recordsPerMonth', 'scansPerMonth', 'sites'])
      for (const value of Object.values(plan.limits)) expect(Number.isInteger(value) && value > 0).toBe(true)
    }
  })

  test('are reference data: every role reads them, the app and system roles cannot change them', async () => {
    for (const role of ['app', 'system'] as const) {
      expect(await asRole(role, async (c) => (await c.query('select id from plans')).rowCount)).toBeGreaterThan(0)
      expect(await asRole(role, (c) => errorCode(c.query(`insert into plans (id, name_key, limits) values ('x', 'plan_x', '{}')`)))).toBe('42501')
      expect(await asRole(role, (c) => errorCode(c.query(`update plans set limits = '{}'`)))).toBe('42501')
      expect(await asRole(role, (c) => errorCode(c.query(`delete from plans`)))).toBe('42501')
    }
  })
})

describe('entitlementOf: the state at the exact boundaries', () => {
  test('none when never paid', async () => {
    expect(await entitlementOf(await addAccount())).toEqual({ state: 'none', planId: null, paidUntil: null, graceEndsAt: null })
  })

  test(`active until paidUntil, grace for ${GRACE_DAYS} days after it, then necessary-only`, async () => {
    expect(GRACE_DAYS).toBe(30)
    const accountId = await addAccount()
    const paidUntil = new Date('2027-03-01T00:00:00.000Z')
    expect(await setEntitlement(rootA.userId, accountId, { planId: 'starter', paidUntil }, 'invoice 2026-001')).toBe('ok')
    const graceEndsAt = new Date(paidUntil.getTime() + 30 * DAY)
    const at = (t: number) => entitlementOf(accountId, new Date(t))

    expect(await at(paidUntil.getTime() - 1)).toEqual({ state: 'active', planId: 'starter', paidUntil, graceEndsAt })
    expect(await at(paidUntil.getTime())).toEqual({ state: 'grace', planId: 'starter', paidUntil, graceEndsAt })
    expect((await at(graceEndsAt.getTime() - 1)).state).toBe('grace')
    expect((await at(graceEndsAt.getTime())).state).toBe('necessary-only')
    expect((await at(graceEndsAt.getTime() + 365 * DAY)).state).toBe('necessary-only')
  })

  test('a suspension starts the grace period at once; unsuspending gives back the paid time', async () => {
    const accountId = await addAccount()
    const paidUntil = new Date('2099-01-01T00:00:00.000Z')
    expect(await setEntitlement(rootA.userId, accountId, { planId: 'business', paidUntil }, 'yearly')).toBe('ok')
    expect(await suspendAccount(rootA.userId, accountId, 'chargeback')).toBe('ok')
    const suspendedAt = (await entitlementRow(accountId))?.suspended_at
    if (!suspendedAt) throw new Error('not suspended')
    const graceEndsAt = new Date(suspendedAt.getTime() + 30 * DAY)
    const at = (t: number) => entitlementOf(accountId, new Date(t))

    expect((await at(suspendedAt.getTime() - 1)).state).toBe('active')
    expect(await at(suspendedAt.getTime())).toEqual({ state: 'grace', planId: 'business', paidUntil, graceEndsAt })
    expect((await at(graceEndsAt.getTime() - 1)).state).toBe('grace')
    expect((await at(graceEndsAt.getTime())).state).toBe('necessary-only')
    expect((await entitlementOf(accountId)).state).toBe('grace')

    expect(await suspendAccount(rootA.userId, accountId, 'again')).toBe('already_suspended')
    expect(await unsuspendAccount(rootA.userId, accountId, 'chargeback withdrawn')).toBe('ok')
    expect(await entitlementOf(accountId)).toEqual({ state: 'active', planId: 'business', paidUntil, graceEndsAt: new Date(paidUntil.getTime() + 30 * DAY) })
    expect(await unsuspendAccount(rootA.userId, accountId, 'again')).toBe('not_suspended')
  })

  test('a paidUntil earlier than the suspension keeps its own grace period', async () => {
    const accountId = await addAccount()
    const paidUntil = new Date(Date.now() - 10 * DAY)
    await setEntitlement(rootA.userId, accountId, { planId: 'starter', paidUntil }, 'lapsed')
    await suspendAccount(rootA.userId, accountId, 'abuse')
    expect(await entitlementOf(accountId)).toMatchObject({ state: 'grace', graceEndsAt: new Date(paidUntil.getTime() + 30 * DAY) })
  })

  test('a suspended account that never paid stays none', async () => {
    const accountId = await addAccount()
    expect(await suspendAccount(rootA.userId, accountId, 'spam sign-ups')).toBe('ok')
    expect((await entitlementOf(accountId)).state).toBe('none')
  })

  test('an unknown plan or account changes nothing', async () => {
    const accountId = await addAccount()
    expect(await setEntitlement(rootA.userId, accountId, { planId: 'platinum', paidUntil: new Date() }, 'x')).toBe('bad_plan')
    expect(await setEntitlement(rootA.userId, newId(), { planId: 'starter', paidUntil: new Date() }, 'x')).toBe('not_found')
    expect(await suspendAccount(rootA.userId, newId(), 'x')).toBe('not_found')
    expect(await unsuspendAccount(rootA.userId, 'not-a-uuid', 'x')).toBe('not_found')
    expect(await entitlementRow(accountId)).toBeNull()
  })

  test("row-level security: the app role reads only the current account's entitlement and writes none", async () => {
    const a = await addAccount()
    const b = await addAccount()
    await setEntitlement(rootA.userId, a, { planId: 'starter', paidUntil: new Date('2030-01-01') }, 'a')
    await setEntitlement(rootA.userId, b, { planId: 'starter', paidUntil: new Date('2030-01-01') }, 'b')
    const seen = await asRole('app', async (c) => {
      await c.query('begin')
      await c.query(`select set_config('app.account_id', $1, true)`, [a])
      const { rows } = await c.query<{ account_id: string }>('select account_id from entitlements')
      const update = await errorCode(c.query(`update entitlements set paid_until = '2100-01-01'`))
      await c.query('rollback')
      return { accounts: rows.map((r) => r.account_id), update }
    })
    expect(seen).toEqual({ accounts: [a], update: '42501' })
    expect(await asRole('app', async (c) => (await c.query('select count(*)::int as n from entitlements')).rows[0]?.n)).toBe(0)
    expect(await asRole('app', (c) => errorCode(c.query(`insert into entitlements (account_id, plan_id, paid_until) values ($1, 'starter', '2100-01-01')`, [newId()])))).toBe('42501')
  })
})

describe('paid access (Review Focus 3)', () => {
  /** What every route answers for `who` now (the console aside). */
  async function sweep(who: Person, paid: boolean) {
    for (const r of appRoutes().filter((r) => !CONSOLE.includes(r.route))) {
      for (const path of pathsOf(r)) {
        for (const method of ['GET', 'POST']) {
          const access = await accessOf(who, path, method)
          const where = `${method} ${path}`
          if (paid || OPEN.includes(r.route)) expect(access, where).toEqual({ kind: 'pass' })
          else if (r.endpoint) expect(access, where).toEqual({ kind: 'refuse', status: 402, code: 'PAYMENT_REQUIRED' })
          else expect(access, where).toEqual({ kind: 'see-other', location: path.startsWith('/sk/') ? '/sk/paywall' : '/paywall' })
        }
      }
    }
  }

  test('an unpaid account gets only the paywall and account settings for every route; marked paid, its next request gets in without signing in again', async () => {
    const owner = await person('unpaid')
    const accountId = await newAccount(owner)
    expect((await requestAccess(requestOf(owner, '/sites'))).entitlement?.state).toBe('none')
    await sweep(owner, false)
    // also an endpoint of the product no file serves yet
    expect(await accessOf(owner, '/api/sites/x', 'POST')).toEqual({ kind: 'refuse', status: 402, code: 'PAYMENT_REQUIRED' })

    // the super-admin marks it paid through tomorrow; the same browser, the same session
    const session = (await completeSession(owner.browser.headers()))?.session.id
    expect(await setPaid(rootA, accountId, isoDay(Date.now() + DAY))).toEqual({ status: 303, location: `/admin/accounts/${accountId}?done=set`, body: '' })
    expect((await completeSession(owner.browser.headers()))?.session.id).toBe(session)
    expect((await requestAccess(requestOf(owner, '/sites'))).entitlement?.state).toBe('active')
    await sweep(owner, true)

    // ended 29 days ago: still in grace; 31 days ago: necessary-only, the paywall again
    expect(await setPaid(rootA, accountId, isoDay(Date.now() - 30 * DAY))).toMatchObject({ status: 303 })
    expect(await accessOf(owner, '/sites')).toEqual({ kind: 'pass' })
    expect(await setPaid(rootA, accountId, isoDay(Date.now() - 32 * DAY))).toMatchObject({ status: 303 })
    expect(await accessOf(owner, '/sk/sites')).toEqual({ kind: 'see-other', location: '/sk/paywall' })
  })

  test('the gate follows the account the person works in', async () => {
    const owner = await person('two-accounts')
    const unpaid = await newAccount(owner)
    expect(await accessOf(owner, '/sites')).toEqual({ kind: 'see-other', location: '/paywall' })
    const paid = await newAccount(owner)
    await setPaid(rootA, paid, isoDay(Date.now() + 10 * DAY))
    expect(await accessOf(owner, '/sites')).toEqual({ kind: 'pass' })
    expect(unpaid).not.toBe(paid)
  })
})

describe('who is a super-admin', () => {
  test('a listed address, verified, with two-factor authentication on, signed in with it', async () => {
    expect(superAdminStatus((await completeSession(rootA.browser.headers())) ?? null)).toBe('super-admin')
    expect(await accessOf(rootA, '/admin/accounts')).toEqual({ kind: 'pass' })
    expect(await accessOf(rootA, '/sk/admin/audit')).toEqual({ kind: 'pass' })
  })

  test('anyone else gets 404 on every console page and endpoint, signed in or not', async () => {
    const someone = await person('not-listed')
    await newAccount(someone)
    for (const who of [someone, new Browser()]) {
      for (const r of appRoutes().filter((r) => CONSOLE.includes(r.route))) {
        for (const path of pathsOf(r)) {
          for (const method of ['GET', 'POST']) expect(await accessOf(who, path, method), `${method} ${path}`).toEqual({ kind: 'not-found' })
        }
      }
    }
  })

  test("the console's endpoints answer 404 themselves to anyone else, and change nothing", async () => {
    const someone = await person('not-listed-direct')
    const accountId = await newAccount(someone)
    expect(await setPaid(someone, accountId, '2099-01-01')).toEqual({ status: 404, location: null, body: '' })
    expect(await post(impersonateRoute, someone, '/api/admin/impersonate', { account: accountId, user: someone.userId, reason: 'x' })).toEqual({ status: 404, location: null, body: '' })
    expect(await entitlementRow(accountId)).toBeNull()
    expect(await adminRows(accountId)).toEqual([])
  })

  test('a listed user without two-factor authentication is sent to set it up; its endpoints are 404', async () => {
    const listed = await person('root-no2fa', 'root-no2fa@admin.test')
    expect(superAdminStatus((await completeSession(listed.browser.headers())) ?? null)).toBe('needs-two-factor')
    expect(await accessOf(listed, '/admin/accounts')).toEqual({ kind: 'see-other', location: '/account/security' })
    expect(await accessOf(listed, '/sk/admin/accounts')).toEqual({ kind: 'see-other', location: '/sk/account/security' })
    expect(await accessOf(listed, '/api/admin/entitlement', 'POST')).toEqual({ kind: 'not-found' })
    const accountId = await addAccount()
    expect((await setPaid(listed, accountId, '2099-01-01')).status).toBe(404)
  })

  test('a listed address that is not verified never has a session: 404', async () => {
    const browser = new Browser()
    expect((await signUp('root-unverified@admin.test')).status).toBe(200)
    expect((await browser.call('/sign-in/email', { email: 'root-unverified@admin.test', password: PASSWORD })).status).toBe(403)
    expect(await accessOf(browser, '/admin/accounts')).toEqual({ kind: 'not-found' })
  })

  test('a super-admin session that has not passed the second factor is no super-admin', async () => {
    const browser = new Browser()
    const first = await browser.call('/sign-in/email', { email: rootA.email, password: PASSWORD })
    expect(first.json?.twoFactorRedirect).toBe(true)
    expect(await accessOf(browser, '/admin/accounts')).toEqual({ kind: 'not-found' })
  })
})

describe('the console', () => {
  test('finds accounts by name, id or a member address, and shows one with its members and entitlement', async () => {
    const owner = await person('findable')
    const name = `Findable ${newId().slice(0, 8)}`
    const accountId = await newAccount(owner, name)
    for (const q of [name.slice(9), accountId, owner.email.toUpperCase()]) {
      expect((await searchAccounts(rootA.userId, q)).map((a) => a.id), q).toEqual([accountId])
    }
    expect((await searchAccounts(rootA.userId, '%')).some((a) => a.id === accountId)).toBe(false)
    const detail = await accountDetail(rootA.userId, accountId)
    expect(detail).toMatchObject({ id: accountId, name, entitlement: { state: 'none' }, suspendedAt: null })
    expect(detail?.members).toEqual([{ userId: owner.userId, name: 'Test Person', email: owner.email, role: 'owner' }])
    expect(await accountDetail(rootA.userId, newId())).toBeNull()
    expect(await accountDetail(rootA.userId, 'nope')).toBeNull()
  })

  test("its reads are recorded as system access with the super-admin's id", async () => {
    const before = Date.now()
    await auditEvents(rootB.userId, {})
    const rows = await asRole('system', async (c) =>
      (await c.query<{ meta: { reason: string } }>(`select meta from audit_log where action = 'system.access' and actor_user_id = $1 and created_at >= to_timestamp($2::double precision / 1000)`, [rootB.userId, before - 1000])).rows,
    )
    expect(rows.map((r) => r.meta.reason)).toContain('super-admin: audit log')
  })

  test('the audit viewer lists the newest events, of one account when asked', async () => {
    const accountId = await addAccount()
    await setEntitlement(rootA.userId, accountId, { planId: 'starter', paidUntil: new Date('2030-01-01') }, 'audit viewer test')
    const events = await auditEvents(rootA.userId, { accountId })
    expect(events.map((e) => e.action)).toEqual(['admin.entitlement_set'])
    expect(events[0]).toMatchObject({ accountId, actorUserId: rootA.userId, actorEmail: rootA.email, meta: { reason: 'audit viewer test' } })
    expect((await auditEvents(rootA.userId, {})).length).toBeGreaterThan(0)
  })

  test("a super-admin's look at one account (its page, its audit log) is recorded in that account's audit log", async () => {
    const accountId = await addAccount()
    await accountDetail(rootB.userId, accountId)
    await auditEvents(rootB.userId, { accountId })
    expect((await adminRows(accountId)).map((r) => [r.action, r.actor_user_id, r.target])).toEqual([
      ['admin.account_view', rootB.userId, `account:${accountId}`],
      ['admin.audit_view', rootB.userId, `account:${accountId}`],
    ])
    // the next look at the audit log shows the earlier ones
    expect((await auditEvents(rootB.userId, { accountId })).map((e) => e.action)).toEqual(['admin.audit_view', 'admin.account_view'])
    // an account that does not exist: nothing to record it in, and no error
    expect(await accountDetail(rootB.userId, newId())).toBeNull()
    expect(await auditEvents(rootB.userId, { accountId: newId() })).toEqual([])
  })
})

describe('every super-admin action is audited with its actor and a required reason', () => {
  test('set, suspend and unsuspend: one audit row each, in the account, with the reason', async () => {
    const accountId = await addAccount()
    expect(await setPaid(rootA, accountId, '2030-06-30', 'invoice 42')).toMatchObject({ status: 303, location: `/admin/accounts/${accountId}?done=set` })
    expect(await entitlementRow(accountId)).toEqual({ plan_id: 'starter', paid_until: new Date('2030-07-01T00:00:00.000Z'), suspended_at: null })
    const suspend = await post(entitlementRoute, rootA, '/api/admin/entitlement', { intent: 'suspend', account: accountId, reason: 'fraud check' })
    expect(suspend).toMatchObject({ status: 303, location: `/admin/accounts/${accountId}?done=suspend` })
    const unsuspend = await post(entitlementRoute, rootA, '/sk/api/admin/entitlement', { intent: 'unsuspend', account: accountId, reason: 'cleared' })
    expect(unsuspend.status).toBe(303)

    const rows = await adminRows(accountId)
    expect(rows.map((r) => [r.action, r.actor_user_id, r.meta.reason])).toEqual([
      ['admin.entitlement_set', rootA.userId, 'invoice 42'],
      ['admin.account_suspend', rootA.userId, 'fraud check'],
      ['admin.account_unsuspend', rootA.userId, 'cleared'],
    ])
    expect(rows[0]).toMatchObject({ target: `account:${accountId}`, meta: { planId: 'starter', paidUntil: '2030-07-01T00:00:00.000Z', before: { planId: null, paidUntil: null, suspendedAt: null } } })
  })

  test('setting the plan of a suspended account records the suspension in what it was before', async () => {
    const accountId = await addAccount()
    await suspendAccount(rootA.userId, accountId, 'abuse report')
    const suspendedAt = (await entitlementRow(accountId))?.suspended_at
    await setPaid(rootA, accountId, '2031-01-31', 'paid anyway')
    const set = (await adminRows(accountId)).find((r) => r.action === 'admin.entitlement_set')
    expect(set?.meta.before).toEqual({ planId: null, paidUntil: null, suspendedAt: suspendedAt?.toISOString() })
  })

  test('without a reason (or with a blank one) nothing changes and nothing is recorded', async () => {
    const accountId = await addAccount()
    for (const reason of ['', '   ', '\u0000x']) {
      expect(await setPaid(rootA, accountId, '2030-01-01', reason)).toEqual({ status: 303, location: `/admin/accounts/${accountId}?error=reason`, body: '' })
      expect((await post(entitlementRoute, rootA, '/api/admin/entitlement', { intent: 'suspend', account: accountId, reason })).location).toBe(`/admin/accounts/${accountId}?error=reason`)
    }
    expect((await setPaid(rootA, accountId, '2030-01-01', 'x'.repeat(501))).location).toBe(`/admin/accounts/${accountId}?error=reason`)
    expect(await entitlementRow(accountId)).toBeNull()
    expect(await adminRows(accountId)).toEqual([])
  })

  test('a bad plan or date, an unknown intent or account: nothing changes', async () => {
    const accountId = await addAccount()
    expect((await setPaid(rootA, accountId, '2030-01-01', 'r', 'platinum')).location).toBe(`/admin/accounts/${accountId}?error=plan`)
    for (const day of ['', '2030-02-30', '30-01-2030', '1999-12-31', '2101-01-01']) {
      expect((await setPaid(rootA, accountId, day)).location, day).toBe(`/admin/accounts/${accountId}?error=date`)
    }
    expect((await post(entitlementRoute, rootA, '/api/admin/entitlement', { intent: 'delete', account: accountId, reason: 'r' })).status).toBe(404)
    expect((await setPaid(rootA, newId(), '2030-01-01')).status).toBe(404)
    expect((await setPaid(rootA, 'nope', '2030-01-01')).status).toBe(404)
    expect(await entitlementRow(accountId)).toBeNull()
    expect(await adminRows(accountId)).toEqual([])
  })
})

describe('read-only impersonation', () => {
  test('is opened by server-only endpoints of the app: Better Auth serves no impersonation path, and has no admin plugin', async () => {
    for (const path of ['/admin/impersonate-user', '/admin/stop-impersonating', '/admin/set-role', '/admin/list-users', '/admin/ban-user']) {
      expect([path, (await rootA.browser.call(path, {})).status]).toEqual([path, 404])
    }
    expect(Object.keys(auth.api).filter((k) => /imperson|admin/i.test(k)).sort()).toEqual(['endImpersonation', 'startImpersonation'])
    const columns = await asRole('migrate', async (c) =>
      (await c.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'auth_user' and column_name in ('role', 'banned', 'ban_reason', 'ban_expires')`)).rows,
    )
    expect(columns).toEqual([])
  })

  test('the server-only start refuses anyone but a super-admin, whatever code calls it', async () => {
    const someone = await person('caller')
    // a real member of a real account: only the caller's status can refuse it
    const target = await person('target')
    const accountId = await newAccount(target)
    const attempt = (who: Person) =>
      auth.api.startImpersonation({ headers: who.browser.headers(), body: { userId: target.userId, accountId } }).then(
        () => 'started',
        (err: { status?: string }) => err.status ?? 'error',
      )
    expect(await attempt(someone)).toBe('NOT_FOUND')
    expect(await asRole('app', async (c) => (await c.query('select count(*)::int as n from auth_session where impersonated_by is not null and user_id = $1', [target.userId])).rows[0]?.n)).toBe(0)
  })

  async function impersonating(root: Person) {
    const owner = await person('impersonated')
    const accountId = await newAccount(owner)
    await setPaid(rootA, accountId, isoDay(Date.now() + 30 * DAY))
    const started = await post(impersonateRoute, root, '/api/admin/impersonate', { account: accountId, user: owner.userId, reason: 'support ticket 77' })
    expect(started).toEqual({ status: 303, location: '/account', body: '' })
    return { owner, accountId }
  }

  test('starts a session as the member, in that account, marked with the super-admin, for a limited time; audited', async () => {
    const { owner, accountId } = await impersonating(rootA)
    const now = await completeSession(rootA.browser.headers())
    expect(now?.user.id).toBe(owner.userId)
    expect((now?.session as { impersonatedBy?: string } | undefined)?.impersonatedBy).toBe(rootA.userId)
    expect((await signedInScope(rootA.browser.headers())).scope).toEqual({ accountId, userId: owner.userId, role: 'owner' })
    expect(IMPERSONATION_MINUTES).toBe(30)
    expect((now?.session.expiresAt.getTime() ?? 0) - (now?.session.createdAt.getTime() ?? 0)).toBeLessThanOrEqual(30 * 60 * 1000 + 1000)
    expect(superAdminStatus(now ?? null)).toBe('none')
    expect(await accessOf(rootA, '/admin/accounts')).toEqual({ kind: 'not-found' })
    expect(await impersonationRows(accountId)).toEqual([
      { actor_user_id: rootA.userId, action: 'admin.impersonation_start', target: `user:${owner.userId}`, meta: { reason: 'support ticket 77' } },
    ])
    await post(stopRoute, rootA, '/api/impersonation/stop', {})
  })

  test('cannot POST, PUT, PATCH or DELETE anything: no route, and none of Better Auth\'s endpoints', async () => {
    const { accountId } = await impersonating(rootA)
    expect(await accessOf(rootA, '/account')).toEqual({ kind: 'pass' })
    expect(await accessOf(rootA, '/sites')).toEqual({ kind: 'pass' })
    for (const r of appRoutes()) {
      for (const path of pathsOf(r)) {
        for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
          const expected = path === '/api/impersonation/stop' ? { kind: 'pass' } : { kind: 'refuse', status: 403, code: 'IMPERSONATION_READ_ONLY' }
          if (!path.startsWith('/api/auth/')) expect(await accessOf(rootA, path, method), `${method} ${path}`).toEqual(expected)
        }
      }
    }
    // Better Auth's own endpoints refuse too (a request there is not read by the middleware)
    const calls: [string, unknown][] = [
      ['/sign-out', {}],
      ['/two-factor/enable', { password: PASSWORD }],
      ['/change-password', { currentPassword: PASSWORD, newPassword: 'another long password 99' }],
      ['/revoke-sessions', {}],
      ['/update-user', { name: 'Changed' }],
      ['/account/invite', { accountId, email: 'someone@example.test', role: 'viewer' }],
    ]
    for (const [path, body] of calls) {
      const answer = await rootA.browser.call(path, body)
      expect([path, answer.status, answer.json?.code]).toEqual([path, 403, 'IMPERSONATION_READ_ONLY'])
    }
    const invitations = await asRole('app', async (c) => (await c.query('select count(*)::int as n from auth_account_invitation where account_id = $1', [accountId])).rows[0]?.n)
    expect(invitations).toBe(0)
    // reading still works
    expect((await rootA.browser.call('/get-session')).status).toBe(200)
    // no impersonation from inside one
    expect((await post(impersonateRoute, rootA, '/api/admin/impersonate', { account: accountId, user: rootB.userId, reason: 'nested' })).status).toBe(404)
    const other = await person('other')
    const otherAccount = await newAccount(other)
    await expect(auth.api.startImpersonation({ headers: rootA.browser.headers(), body: { userId: other.userId, accountId: otherAccount } })).rejects.toMatchObject({ status: 'NOT_FOUND' })
    expect(await asRole('app', async (c) => (await c.query('select count(*)::int as n from auth_session where user_id = $1 and impersonated_by is not null', [other.userId])).rows[0]?.n)).toBe(0)
    await post(stopRoute, rootA, '/api/impersonation/stop', {})
  })

  /** Moves an impersonation of `owner` past its time, with a row that says it is still valid for a day. */
  const outlive = (owner: Person) =>
    asRole('app', (c) =>
      c.query(`update auth_session set created_at = now() - interval '31 minutes', expires_at = now() + interval '1 day' where user_id = $1 and impersonated_by is not null`, [owner.userId]),
    )
  const impersonationSessions = async (owner: Person) =>
    asRole('app', async (c) => (await c.query('select count(*)::int as n from auth_session where user_id = $1 and impersonated_by is not null', [owner.userId])).rows[0]?.n)

  test("ends after its time even if the session row says otherwise: no page, and none of Better Auth's endpoints (even without the cookie that stops a refresh)", async () => {
    const { owner } = await impersonating(rootB)
    await outlive(owner)
    expect(await completeSession(rootB.browser.headers())).toBeNull()
    for (const name of [...rootB.browser.cookies.keys()]) if (name.includes('dont_remember')) rootB.browser.cookies.delete(name)
    const served = await rootB.browser.call('/get-session')
    expect(served.json).toBeNull()
    expect((await rootB.browser.call('/list-sessions')).status).toBe(401)
    expect(await impersonationSessions(owner)).toBe(0)
    // the super-admin is back on the next request (the end is recorded: next test)
    rootB.browser.keep(await endedBy(rootB, '/account'))
    expect(superAdminStatus((await completeSession(rootB.browser.headers())) ?? null)).toBe('super-admin')
  })

  /** The middleware's answer headers for a request of `who` (what a browser would get). */
  async function endedBy(who: Person, path: string): Promise<Response> {
    const headers = new Headers()
    const { access } = await requestAccess(requestOf(who, path), headers)
    if (access.kind === 'see-other') headers.set('Location', access.location)
    return new Response(null, { status: access.kind === 'see-other' ? 303 : 200, headers })
  }

  test('past its time, the next request records its end and gives the super-admin their own session back, on the account page', async () => {
    const { owner, accountId } = await impersonating(rootB)
    await outlive(owner)
    const answer = await endedBy(rootB, '/sk/account')
    expect([answer.status, answer.headers.get('location')]).toEqual([303, `/sk/admin/accounts/${accountId}`])
    rootB.browser.keep(answer)
    const now = await completeSession(rootB.browser.headers())
    expect(superAdminStatus(now ?? null)).toBe('super-admin')
    expect(now?.user.id).toBe(rootB.userId)
    expect((await impersonationRows(accountId)).map((r) => [r.action, r.actor_user_id, r.meta])).toEqual([
      ['admin.impersonation_start', rootB.userId, { reason: 'support ticket 77' }],
      ['admin.impersonation_stop', rootB.userId, { ended: 'expired' }],
    ])
    expect(await impersonationSessions(owner)).toBe(0)
    // nothing left to end
    expect(await accessOf(rootB, '/admin/accounts')).toEqual({ kind: 'pass' })
  })

  test('past its time, the stop button still works: the end is recorded and the super-admin is back', async () => {
    const { owner, accountId } = await impersonating(rootB)
    await outlive(owner)
    const stopped = await post(stopRoute, rootB, '/api/impersonation/stop', {})
    expect(stopped).toEqual({ status: 303, location: `/admin/accounts/${accountId}`, body: '' })
    expect(superAdminStatus((await completeSession(rootB.browser.headers())) ?? null)).toBe('super-admin')
    expect((await impersonationRows(accountId)).at(-1)).toMatchObject({ action: 'admin.impersonation_stop', meta: { ended: 'expired' } })
    expect(await impersonationSessions(owner)).toBe(0)
  })

  test('stopping it gives the super-admin their own session back, on the account page; audited', async () => {
    const { owner, accountId } = await impersonating(rootA)
    const stopped = await post(stopRoute, rootA, '/api/impersonation/stop', {})
    expect(stopped).toEqual({ status: 303, location: `/admin/accounts/${accountId}`, body: '' })
    const now = await completeSession(rootA.browser.headers())
    expect(now?.user.id).toBe(rootA.userId)
    expect(superAdminStatus(now ?? null)).toBe('super-admin')
    const rows = await impersonationRows(accountId)
    expect(rows.map((r) => [r.action, r.actor_user_id, r.target, r.meta])).toEqual([
      ['admin.impersonation_start', rootA.userId, `user:${owner.userId}`, { reason: 'support ticket 77' }],
      ['admin.impersonation_stop', rootA.userId, `user:${owner.userId}`, { ended: 'stopped' }],
    ])
    // no impersonated session of the owner is left
    const left = await asRole('app', async (c) => (await c.query('select count(*)::int as n from auth_session where user_id = $1 and impersonated_by is not null', [owner.userId])).rows[0]?.n)
    expect(left).toBe(0)
    // not impersonating: the stop endpoint does not exist
    expect((await post(stopRoute, rootA, '/api/impersonation/stop', {})).status).toBe(404)
  })

  test('refused without a reason, for someone who is not a member of that account, or for a super-admin; nothing recorded', async () => {
    const owner = await person('not-impersonated')
    const accountId = await newAccount(owner)
    const other = await person('elsewhere')
    const start = (fields: Record<string, string>) => post(impersonateRoute, rootA, '/api/admin/impersonate', { account: accountId, user: owner.userId, reason: 'r', ...fields })
    expect(await start({ reason: ' ' })).toEqual({ status: 303, location: `/admin/accounts/${accountId}?error=reason`, body: '' })
    expect((await start({ user: other.userId })).status).toBe(404)
    expect((await start({ user: 'nope' })).status).toBe(404)
    expect((await start({ account: newId() })).status).toBe(404)
    // a super-admin who is a member of the account
    const rootAccount = await newAccount(rootB)
    expect((await post(impersonateRoute, rootA, '/api/admin/impersonate', { account: rootAccount, user: rootB.userId, reason: 'r' })).status).toBe(404)
    expect((await completeSession(rootA.browser.headers()))?.user.id).toBe(rootA.userId)
    expect(await adminRows(accountId)).toEqual([])
  })

  test(`is rate limited: ${ADMIN_LIMITS.impersonate.max} starts per ${ADMIN_LIMITS.impersonate.window / 60} minutes`, async () => {
    const who = await superAdmin('root-limit@admin.test')
    const owner = await person('limited')
    const accountId = await newAccount(owner)
    const locations: (string | null)[] = []
    for (let i = 0; i < ADMIN_LIMITS.impersonate.max + 1; i++) {
      const started = await post(impersonateRoute, who, '/api/admin/impersonate', { account: accountId, user: owner.userId, reason: `limit ${i}` })
      locations.push(started.location)
      if (started.location === '/account') await post(stopRoute, who, '/api/impersonation/stop', {})
    }
    expect(locations).toEqual([...Array<string>(ADMIN_LIMITS.impersonate.max).fill('/account'), `/admin/accounts/${accountId}?error=limited`])
    expect((await impersonationRows(accountId)).filter((r) => r.action === 'admin.impersonation_start')).toHaveLength(ADMIN_LIMITS.impersonate.max)
  })
})
