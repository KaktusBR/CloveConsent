// Accounts, members, roles and invitations against the real database: the app's form routes (called as
// the middleware would, with locals from signedInScope), Better Auth's handler for the account endpoints,
// and the tables underneath. Review Focus 1 (another account's ids are 404 and change nothing) and 4
// (an invitation used by another email, twice, after expiry or after cancellation does nothing and says why).
import { createHash } from 'node:crypto'
import type { APIRoute } from 'astro'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { ACCOUNT_CREATE_LIMIT, POST as createAccountRoute } from '../../src/pages/api/accounts/create'
import { POST as membersRoute } from '../../src/pages/api/account/members'
import { POST as switchRoute } from '../../src/pages/api/account/switch'
import { ORGANIZATION_PATHS } from '../../src/server/auth/auth'
import { signedInScope } from '../../src/server/auth/guard'
import { cancelInvitation, createAccount, createInvitation, LIMITS, viewInvitation } from '../../src/server/data/accounts'
import { closeDatabases } from '../../src/server/data/client'
import { closeQueue } from '../../src/server/data/queue'
import type { Role } from '../../src/server/data/scope'
import { address, Browser, mailsTo, nextIp, ORIGIN, pwnedStandIn, signedIn, verifiedUser } from './browser'
import { handleAuth } from '../../src/server/auth/handler'
import { SOCKET_PEER_HEADER } from '../../src/server/socket-peer'
import { asRole, errorCode, newId } from './raw'

interface Person {
  email: string
  browser: Browser
  userId: string
}

async function person(label: string): Promise<Person> {
  const email = await verifiedUser(label)
  const browser = await signedIn(email)
  const { session } = await signedInScope(browser.headers())
  if (!session) throw new Error('no session')
  return { email, browser, userId: session.user.id }
}

/** A plain form POST to one of the app's routes, with the locals the middleware would set. */
async function post(route: APIRoute, who: Person, path: string, fields: Record<string, string>) {
  const request = new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    // from the browser's socket address, as the node adapter stamps it (src/server/socket-peer.ts)
    headers: who.browser.headers({ 'content-type': 'application/x-www-form-urlencoded', referer: `${ORIGIN}/account/members`, ...(who.browser.peer ? { [SOCKET_PEER_HEADER]: who.browser.peer } : {}) }),
    body: new URLSearchParams(fields),
  })
  const locals = await signedInScope(request.headers)
  const response = await route({ request, locals, url: new URL(request.url) } as unknown as Parameters<APIRoute>[0])
  return { status: response.status, location: response.headers.get('location'), body: await response.text() }
}

/** The scope a next request of `who` would get. */
const scopeOf = async (who: Person) => (await signedInScope(who.browser.headers())).scope

/** Marks an account paid (only a paying account may invite: ruling R27), as the system role, without an audit row. */
const markPaid = (accountId: string, paidUntil = '2100-01-01') =>
  asRole('system', (c) => c.query(`insert into entitlements (account_id, plan_id, paid_until) values ($1, 'starter', $2) on conflict (account_id) do update set paid_until = excluded.paid_until`, [accountId, paidUntil]))

/** A new account owned by `who` (through the app's form), now their active account; paid unless `paid` is false. */
async function newAccount(who: Person, name = `Account ${newId().slice(0, 8)}`, { paid = true } = {}): Promise<string> {
  const created = await post(createAccountRoute, who, '/api/accounts/create', { name })
  expect(created).toMatchObject({ status: 303, location: '/account' })
  const scope = await scopeOf(who)
  expect(scope?.role).toBe('owner')
  if (paid) await markPaid(scope!.accountId)
  return scope!.accountId
}

const invite = (who: Person, accountId: string, email: string, role: Role = 'editor') => who.browser.call('/account/invite', { accountId, email, role })
const accept = (who: Person, token: string) => who.browser.call('/account/accept-invitation', { token })

/** The token of the newest invitation mail to `email`. */
async function invitationToken(email: string): Promise<string> {
  const mails = await mailsTo(email)
  const mail = mails.at(-1)
  expect(mail?.template).toBe('invitation')
  const link = new URL(mail?.data.url ?? '')
  expect(link.origin).toBe(ORIGIN)
  return link.pathname.split('/').at(-1) ?? ''
}

/** Invite `email` to `accountId` (by its owner) and return the link's token. */
async function invited(owner: Person, accountId: string, email: string, role: Role = 'editor'): Promise<string> {
  expect((await invite(owner, accountId, email, role)).status).toBe(200)
  return invitationToken(email)
}

/** A member of `accountId` with `role`, through an accepted invitation. */
async function memberOf(owner: Person, accountId: string, role: Role, label: string = role): Promise<Person> {
  const who = await person(label)
  const token = await invited(owner, accountId, who.email, role)
  expect((await accept(who, token)).status).toBe(200)
  return who
}

const membersOf = (accountId: string) =>
  asRole('migrate', async (c) =>
    (await c.query<{ id: string; user_id: string; role: Role }>(`select id, user_id, role from auth_account_member where account_id = $1 order by created_at`, [accountId])).rows,
  )
const memberId = async (accountId: string, userId: string) => (await membersOf(accountId)).find((m) => m.user_id === userId)?.id ?? ''
const auditOf = (accountId: string) =>
  asRole('system', async (c) =>
    (await c.query<{ action: string; actor_user_id: string | null; target: string | null; meta: Record<string, unknown> }>(
      `select action, actor_user_id, target, meta from audit_log where account_id = $1 order by created_at, id`,
      [accountId],
    )).rows,
  )
const invitationsOf = (accountId: string) =>
  asRole('migrate', async (c) => (await c.query<{ id: string; email: string; status: string; token_hash: string }>(`select id, email, status, token_hash from auth_account_invitation where account_id = $1`, [accountId])).rows)
const activeAccountOf = async (who: Person) => (await signedInScope(who.browser.headers())).session?.session.activeOrganizationId ?? null

beforeAll(pwnedStandIn)

afterAll(async () => {
  // queued mail is never sent here; left in the queue it would be a backlog for the next file's worker
  await asRole('migrate', (c) => c.query(`delete from pgboss.job where name = 'mail.send' and data->>'to' like '%@example.test'`))
  vi.unstubAllGlobals()
  await closeQueue()
  await closeDatabases()
})

describe('creating an account', () => {
  test('the creator is its owner, it becomes their active account, and both are in the audit log', async () => {
    const owner = await person('creator')
    const accountId = await newAccount(owner, 'Acme s.r.o.')
    expect(await membersOf(accountId)).toEqual([expect.objectContaining({ user_id: owner.userId, role: 'owner' })])
    expect(await activeAccountOf(owner)).toBe(accountId)
    // one transaction: the same time, in no particular order
    const events = await auditOf(accountId)
    expect(events).toHaveLength(2)
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'account.create', actor_user_id: owner.userId, meta: { name: 'Acme s.r.o.' } }),
        expect.objectContaining({ action: 'member.add', actor_user_id: owner.userId, target: `user:${owner.userId}`, meta: { role: 'owner' } }),
      ]),
    )
  })

  test('a name that is empty, too long or holds a bidi control is refused', async () => {
    const owner = await person('names')
    for (const name of ['   ', 'x'.repeat(101), 'Acme‮gnp.exe']) {
      expect(await post(createAccountRoute, owner, '/api/accounts/create', { name })).toMatchObject({ status: 303, location: '/accounts/new?error=name' })
    }
    expect(await scopeOf(owner)).toBeNull()
  })

  test('signed out, the form goes to sign-in', async () => {
    const response = await createAccountRoute({
      request: new Request(`${ORIGIN}/api/accounts/create`, { method: 'POST', body: new URLSearchParams({ name: 'x' }) }),
      locals: { session: null, scope: null },
      url: new URL(`${ORIGIN}/api/accounts/create`),
    } as unknown as Parameters<APIRoute>[0])
    expect(response.headers.get('location')).toMatch(/^\/sign-in\?next=/)
  })
})

describe('the last owner', () => {
  test('the only owner can neither leave, be removed nor stop being an owner', async () => {
    const owner = await person('sole-owner')
    const accountId = await newAccount(owner)
    const own = await memberId(accountId, owner.userId)
    for (const role of ['admin', 'editor', 'viewer']) {
      expect(await post(membersRoute, owner, '/api/account/members', { intent: 'role', member: own, role })).toMatchObject({ status: 303, location: '/account/members?error=last_owner' })
    }
    expect(await post(membersRoute, owner, '/api/account/members', { intent: 'remove', member: own })).toMatchObject({ status: 303, location: '/account/members?error=last_owner' })
    expect(await membersOf(accountId)).toEqual([expect.objectContaining({ user_id: owner.userId, role: 'owner' })])
    expect((await auditOf(accountId)).map((e) => e.action).sort()).toEqual(['account.create', 'member.add'])
  })

  test('the database refuses it from any code path (raw SQL as the app role)', async () => {
    const owner = await person('raw-owner')
    const accountId = await newAccount(owner)
    const sql = [`delete from auth_account_member where account_id = $1`, `update auth_account_member set role = 'admin' where account_id = $1`]
    for (const query of sql) expect(await asRole('app', (c) => errorCode(c.query(query, [accountId])))).toBe('23514')
    expect(await membersOf(accountId)).toEqual([expect.objectContaining({ role: 'owner' })])
  })

  test('two owners demoting each other at the same moment: one change succeeds, one owner remains', async () => {
    const first = await person('owner-a')
    const accountId = await newAccount(first)
    const second = await memberOf(first, accountId, 'owner', 'owner-b')
    const [a, b] = [await memberId(accountId, first.userId), await memberId(accountId, second.userId)]
    const results = await Promise.all([
      post(membersRoute, first, '/api/account/members', { intent: 'role', member: b, role: 'admin' }),
      post(membersRoute, second, '/api/account/members', { intent: 'role', member: a, role: 'admin' }),
    ])
    // the changes run one after the other: the second finds its actor no longer an owner
    expect(results.map((r) => r.location).sort()).toEqual(['/account/members?done=role', '/account/members?error=owner_only'])
    expect((await membersOf(accountId)).filter((m) => m.role === 'owner')).toHaveLength(1)
  })

  test('the database too: two concurrent transactions each demoting one of the two owners, the second fails', async () => {
    const first = await person('raw-a')
    const accountId = await newAccount(first)
    const second = await memberOf(first, accountId, 'owner', 'raw-b')
    const demote = `update auth_account_member set role = 'admin' where account_id = $1 and user_id = $2`
    const outcome = await asRole('app', (one) =>
      asRole('app', async (two) => {
        await one.query('begin')
        await two.query('begin')
        await one.query(demote, [accountId, first.userId])
        // waits for the account row the first transaction's trigger locked
        const blocked = errorCode(two.query(demote, [accountId, second.userId]))
        await one.query('commit')
        const code = await blocked
        await two.query('rollback')
        return code
      }),
    )
    expect(outcome).toBe('23514')
    expect((await membersOf(accountId)).filter((m) => m.role === 'owner')).toEqual([expect.objectContaining({ user_id: second.userId })])
  })

  test('with a second owner, an owner may step down', async () => {
    const first = await person('step-down')
    const accountId = await newAccount(first)
    await memberOf(first, accountId, 'owner', 'successor')
    expect(await post(membersRoute, first, '/api/account/members', { intent: 'role', member: await memberId(accountId, first.userId), role: 'admin' })).toMatchObject({
      location: '/account/members?done=role',
    })
    expect((await scopeOf(first))?.role).toBe('admin')
  })
})

describe('owners and admins', () => {
  test('an admin cannot change or remove an owner, make anyone an owner, or invite one', async () => {
    const owner = await person('owner-of-admin')
    const accountId = await newAccount(owner)
    const admin = await memberOf(owner, accountId, 'admin')
    const editor = await memberOf(owner, accountId, 'editor', 'promoted')
    const ownerMember = await memberId(accountId, owner.userId)
    const refused = { status: 303, location: '/account/members?error=owner_only' }
    expect(await post(membersRoute, admin, '/api/account/members', { intent: 'role', member: ownerMember, role: 'viewer' })).toMatchObject(refused)
    expect(await post(membersRoute, admin, '/api/account/members', { intent: 'remove', member: ownerMember })).toMatchObject(refused)
    expect(await post(membersRoute, admin, '/api/account/members', { intent: 'role', member: await memberId(accountId, editor.userId), role: 'owner' })).toMatchObject(refused)
    const asOwner = await invite(admin, accountId, address('would-be-owner'), 'owner')
    expect(asOwner).toMatchObject({ status: 403, json: expect.objectContaining({ code: 'OWNER_ONLY' }) })
    // what an admin may do
    expect(await post(membersRoute, admin, '/api/account/members', { intent: 'role', member: await memberId(accountId, editor.userId), role: 'viewer' })).toMatchObject({
      location: '/account/members?done=role',
    })
  })

  test('an editor or a viewer cannot manage members: 404, nothing changes', async () => {
    const owner = await person('owner-of-editor')
    const accountId = await newAccount(owner)
    for (const role of ['editor', 'viewer'] as const) {
      const who = await memberOf(owner, accountId, role)
      const before = await membersOf(accountId)
      const target = await memberId(accountId, owner.userId)
      expect((await post(membersRoute, who, '/api/account/members', { intent: 'role', member: target, role: 'viewer' })).status).toBe(404)
      expect((await post(membersRoute, who, '/api/account/members', { intent: 'remove', member: target })).status).toBe(404)
      expect((await invite(who, accountId, address('by-editor'))).status).toBe(404)
      expect(await membersOf(accountId)).toEqual(before)
    }
  })
})

describe('another account (Review Focus 1)', () => {
  test("its member, invitation and account ids are 404 to a member of another account, and nothing of it changes", async () => {
    const ownerA = await person('owner-a')
    const accountA = await newAccount(ownerA)
    const ownerB = await person('owner-b')
    const accountB = await newAccount(ownerB)
    const memberB = await memberOf(ownerB, accountB, 'editor', 'member-b')
    await invited(ownerB, accountB, address('invitee-b'))
    const invitationsB = await invitationsOf(accountB)
    const invitationB = invitationsB.find((i) => i.status === 'pending')
    const membersB = await membersOf(accountB)
    const auditB = await auditOf(accountB)
    const targetB = await memberId(accountB, memberB.userId)

    for (const fields of [
      { intent: 'role', member: targetB, role: 'viewer' },
      { intent: 'remove', member: targetB },
      { intent: 'cancel', invitation: invitationB!.id },
      { intent: 'role', member: newId(), role: 'viewer' },
      { intent: 'remove', member: 'not-a-uuid' },
      { intent: 'cancel', invitation: newId() },
    ]) {
      const answer = await post(membersRoute, ownerA, '/api/account/members', fields)
      expect(answer, JSON.stringify(fields)).toEqual({ status: 404, location: null, body: '' })
    }
    // the account endpoints and the switcher, with B's id (and with ids that do not exist)
    for (const id of [accountB, newId(), 'nonsense']) {
      expect(await invite(ownerA, id, address('via-a'))).toMatchObject({ status: 404, json: expect.objectContaining({ code: 'NOT_FOUND' }) })
      expect(await post(switchRoute, ownerA, '/api/account/switch', { account: id })).toEqual({ status: 404, location: null, body: '' })
    }
    expect(await membersOf(accountB)).toEqual(membersB)
    expect(await invitationsOf(accountB)).toEqual(invitationsB)
    expect(await auditOf(accountB)).toEqual(auditB)
    // and A's own active account stayed as it was
    expect(await activeAccountOf(ownerA)).toBe(accountA)
    expect((await scopeOf(ownerA))?.accountId).toBe(accountA)
  })

  test("none of the organization plugin's endpoints answers over HTTP", async () => {
    const owner = await person('plugin-paths')
    const accountId = await newAccount(owner)
    expect(ORGANIZATION_PATHS.length).toBeGreaterThan(20)
    for (const path of ORGANIZATION_PATHS) {
      const answer = await owner.browser.call(path, { organizationId: accountId }, 'POST')
      expect(answer.status, path).toBe(404)
      expect((await owner.browser.call(path)).status, path).toBe(404)
    }
  })
})

describe('switching accounts', () => {
  test('to an account of theirs: it becomes the scope of the next request', async () => {
    const who = await person('switcher')
    const first = await newAccount(who, 'First')
    const second = await newAccount(who, 'Second')
    expect((await scopeOf(who))?.accountId).toBe(second)
    expect(await post(switchRoute, who, '/api/account/switch', { account: first })).toMatchObject({ status: 303, location: '/account' })
    expect((await scopeOf(who))?.accountId).toBe(first)
  })

  test('to an account they are not a member of: refused, and the active account stays', async () => {
    const who = await person('no-switch')
    const mine = await newAccount(who)
    const other = await newAccount(await person('someone-else'))
    expect((await post(switchRoute, who, '/api/account/switch', { account: other })).status).toBe(404)
    expect(await activeAccountOf(who)).toBe(mine)
    expect((await scopeOf(who))?.accountId).toBe(mine)
  })
})

describe('membership is checked on every request', () => {
  test('a removed member loses the account on their next request; the change is in the audit log', async () => {
    const owner = await person('remover')
    const accountId = await newAccount(owner)
    const member = await memberOf(owner, accountId, 'admin', 'removed')
    expect(await scopeOf(member)).toEqual({ accountId, userId: member.userId, role: 'admin' })
    expect(await post(membersRoute, owner, '/api/account/members', { intent: 'remove', member: await memberId(accountId, member.userId) })).toMatchObject({
      location: '/account/members?done=remove',
    })
    // the same session, the same active account in it: no longer a scope
    expect(await activeAccountOf(member)).toBe(accountId)
    expect(await scopeOf(member)).toBeNull()
    expect((await post(membersRoute, member, '/api/account/members', { intent: 'remove', member: await memberId(accountId, owner.userId) })).status).toBe(404)
    expect((await auditOf(accountId)).at(-1)).toMatchObject({ action: 'member.remove', actor_user_id: owner.userId, target: `user:${member.userId}`, meta: { role: 'admin' } })
  })

  test('a role change takes effect on the next request', async () => {
    const owner = await person('demoter')
    const accountId = await newAccount(owner)
    const member = await memberOf(owner, accountId, 'admin', 'demoted')
    await post(membersRoute, owner, '/api/account/members', { intent: 'role', member: await memberId(accountId, member.userId), role: 'viewer' })
    expect((await scopeOf(member))?.role).toBe('viewer')
    expect((await auditOf(accountId)).at(-1)).toMatchObject({ action: 'member.role_change', target: `user:${member.userId}`, meta: { from: 'admin', to: 'viewer' } })
  })
})

describe('invitations (Review Focus 4)', () => {
  test('the link is on the public origin, in the language of the page; only a hash of its token is stored', async () => {
    const owner = await person('inviter')
    const accountId = await newAccount(owner, 'Inviting')
    const email = address('invitee')
    const sent = await owner.browser.call('/account/invite', { accountId, email: email.toUpperCase(), role: 'viewer' })
    expect(sent.status).toBe(200)
    const [mail] = await mailsTo(email)
    expect(mail).toMatchObject({ template: 'invitation', locale: 'en', data: { inviter: 'Test Person', account: 'Inviting' } })
    const token = await invitationToken(email)
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const [row] = await invitationsOf(accountId)
    expect(row).toMatchObject({ email, status: 'pending', token_hash: createHash('sha256').update(token).digest('base64url') })
    const stored = await asRole('migrate', async (c) => {
      const tables = ['auth_account_invitation', 'audit_log', 'auth_verification']
      // one query at a time: a pg client runs one query at once
      let n = 0
      for (const t of tables) n += (await c.query(`select 1 from ${t} where ${t}::text like $1`, [`%${token}%`])).rowCount ?? 0
      return n
    })
    expect(stored).toBe(0)
    expect((await auditOf(accountId)).at(-1)).toMatchObject({ action: 'member.invite', target: `invitation:${row!.id}`, meta: { email, role: 'viewer' } })
  })

  test('accepted by the invited person: a member with the role, the active account, in the audit log; a second use does nothing and says why', async () => {
    const owner = await person('host')
    const accountId = await newAccount(owner, 'Host')
    const guest = await person('guest')
    const token = await invited(owner, accountId, guest.email, 'editor')
    expect(await viewInvitation(token, guest.email)).toEqual({ state: 'pending', accountName: 'Host', role: 'editor' })
    expect(await accept(guest, token)).toMatchObject({ status: 200, json: { accountId } })
    expect(await scopeOf(guest)).toEqual({ accountId, userId: guest.userId, role: 'editor' })
    expect((await auditOf(accountId)).at(-1)).toMatchObject({ action: 'member.join', actor_user_id: guest.userId, target: `user:${guest.userId}`, meta: { role: 'editor' } })

    const auditBefore = await auditOf(accountId)
    expect(await accept(guest, token)).toMatchObject({ status: 400, json: expect.objectContaining({ code: 'INVITATION_USED' }) })
    expect((await viewInvitation(token, guest.email)).state).toBe('used')
    expect(await membersOf(accountId)).toHaveLength(2)
    expect(await auditOf(accountId)).toEqual(auditBefore)
  })

  test('used by another signed-in email: refused, and they learn nothing of the account', async () => {
    const owner = await person('host-2')
    const accountId = await newAccount(owner, 'Secret name')
    const intended = address('intended')
    const token = await invited(owner, accountId, intended)
    const stranger = await person('stranger')
    // 404 like a link that does not exist, with its reason as the code (ruling R23)
    expect(await accept(stranger, token)).toMatchObject({ status: 404, json: expect.objectContaining({ code: 'INVITATION_WRONG_EMAIL' }) })
    expect(await viewInvitation(token, stranger.email)).toEqual({ state: 'wrong_email' })
    expect(await membersOf(accountId)).toHaveLength(1)
    expect(await invitationsOf(accountId)).toEqual([expect.objectContaining({ status: 'pending' })])
    expect(await scopeOf(stranger)).toBeNull()
  })

  test('after expiry: refused with the reason, nothing written', async () => {
    const owner = await person('host-3')
    const accountId = await newAccount(owner)
    const guest = await person('late')
    const token = await invited(owner, accountId, guest.email)
    const [row] = await invitationsOf(accountId)
    // the 7 days are over
    await asRole('migrate', (c) => c.query(`update auth_account_invitation set expires_at = now() - interval '1 second' where id = $1`, [row!.id]))
    expect(await accept(guest, token)).toMatchObject({ status: 400, json: expect.objectContaining({ code: 'INVITATION_EXPIRED' }) })
    expect((await viewInvitation(token, guest.email)).state).toBe('expired')
    expect(await membersOf(accountId)).toHaveLength(1)
  })

  test('valid for 7 days', async () => {
    const owner = await person('host-7')
    const accountId = await newAccount(owner)
    await invited(owner, accountId, address('week'))
    const days = await asRole('migrate', async (c) =>
      (await c.query<{ days: number }>(`select extract(epoch from expires_at - created_at) / 86400 as days from auth_account_invitation where account_id = $1`, [accountId])).rows[0]?.days,
    )
    expect(Number(days)).toBeCloseTo(7, 3)
  })

  test('after cancellation: refused with the reason; the cancellation is in the audit log', async () => {
    const owner = await person('host-4')
    const accountId = await newAccount(owner)
    const guest = await person('canceled')
    const token = await invited(owner, accountId, guest.email)
    const [row] = await invitationsOf(accountId)
    expect(await post(membersRoute, owner, '/api/account/members', { intent: 'cancel', invitation: row!.id })).toMatchObject({ location: '/account/members?done=cancel' })
    expect((await auditOf(accountId)).at(-1)).toMatchObject({ action: 'member.invite_cancel', target: `invitation:${row!.id}`, actor_user_id: owner.userId })
    expect(await accept(guest, token)).toMatchObject({ status: 400, json: expect.objectContaining({ code: 'INVITATION_CANCELED' }) })
    expect((await viewInvitation(token, guest.email)).state).toBe('canceled')
    expect(await membersOf(accountId)).toHaveLength(1)
    // a second cancel says it is no longer pending
    expect(await post(membersRoute, owner, '/api/account/members', { intent: 'cancel', invitation: row!.id })).toMatchObject({ location: '/account/members?error=not_pending' })
  })

  test('an unknown or malformed token: not found', async () => {
    const guest = await person('guesser')
    for (const token of ['A'.repeat(43), 'short', "x' or '1'='1"]) {
      expect(await accept(guest, token)).toMatchObject({ status: 404, json: expect.objectContaining({ code: 'INVITATION_NOT_FOUND' }) })
      expect(await viewInvitation(token, guest.email)).toEqual({ state: 'not_found' })
    }
  })

  test('accepted twice at the same moment: one membership', async () => {
    const owner = await person('host-5')
    const accountId = await newAccount(owner)
    const guest = await person('double')
    const token = await invited(owner, accountId, guest.email)
    const answers = await Promise.all([accept(guest, token), accept(guest, token)])
    expect(answers.map((a) => a.status).sort()).toEqual([200, 400])
    expect(await membersOf(accountId)).toHaveLength(2)
    expect((await auditOf(accountId)).filter((e) => e.action === 'member.join')).toHaveLength(1)
  })

  test('a member, or an address with a pending invitation, is not invited again', async () => {
    const owner = await person('host-6')
    const accountId = await newAccount(owner)
    const member = await memberOf(owner, accountId, 'viewer', 'already')
    expect(await invite(owner, accountId, member.email)).toMatchObject({ status: 400, json: expect.objectContaining({ code: 'ALREADY_MEMBER' }) })
    const pending = address('pending')
    await invited(owner, accountId, pending)
    expect(await invite(owner, accountId, pending)).toMatchObject({ status: 400, json: expect.objectContaining({ code: 'ALREADY_INVITED' }) })
    expect(await invite(owner, accountId, 'not an address')).toMatchObject({ status: 400, json: expect.objectContaining({ code: 'INVALID_EMAIL' }) })
    expect(await invite(owner, accountId, address('x'), 'member' as Role)).toMatchObject({ status: 400, json: expect.objectContaining({ code: 'ROLE_NOT_FOUND' }) })
  })

  test('accepting is rate limited per client address', async () => {
    const guest = await person('limited')
    const statuses: number[] = []
    for (let i = 0; i < 11; i++) statuses.push((await accept(guest, 'B'.repeat(43))).status)
    expect(statuses).toEqual([...Array<number>(10).fill(404), 429])
  })

  test('inviting is rate limited per client address', async () => {
    const owner = await person('spammer')
    const accountId = await newAccount(owner)
    const statuses: number[] = []
    for (let i = 0; i < 21; i++) statuses.push((await invite(owner, accountId, address(`flood-${i}`))).status)
    expect(statuses).toEqual([...Array<number>(20).fill(200), 429])
  })
})

/** Backends of this run's database now waiting for a lock (read as the admin, who sees every session). */
const lockWaiters = () =>
  asRole('admin', async (c) =>
    Number((await c.query<{ n: string }>(`select count(*) as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`)).rows[0]?.n),
  )
async function untilWaiters(n: number) {
  for (const deadline = Date.now() + 10_000; Date.now() < deadline; ) {
    if ((await lockWaiters()) >= n) return
    await new Promise((r) => setTimeout(r, 25))
  }
  throw new Error(`fewer than ${n} lock waiters`)
}

describe('fix round 1: cancel and accept at the same moment (I1)', () => {
  test('an accept that commits while a cancel is under way: exactly one wins, and the record and the audit log agree', async () => {
    const owner = await person('race-owner')
    const accountId = await newAccount(owner)
    const guest = await person('race-guest')
    const token = await invited(owner, accountId, guest.email)
    const [row] = await invitationsOf(accountId)
    const scope = (await scopeOf(owner))!
    const outcome = await asRole('app', async (holder) => {
      // hold the invitation row: the accept, then the cancel, queue behind it
      await holder.query('begin')
      await holder.query('select 1 from auth_account_invitation where id = $1 for update', [row!.id])
      const accepting = accept(guest, token)
      await untilWaiters(1)
      const canceling = cancelInvitation(scope, row!.id)
      await untilWaiters(2).catch(() => undefined)
      await holder.query('commit')
      return { accepted: await accepting, canceled: await canceling }
    })
    const [after] = await invitationsOf(accountId)
    const joined = (await membersOf(accountId)).some((m) => m.user_id === guest.userId)
    const actions = (await auditOf(accountId)).map((e) => e.action)
    const acceptWon = outcome.accepted.status === 200
    expect(acceptWon !== (outcome.canceled === 'ok')).toBe(true)
    expect(after?.status).toBe(acceptWon ? 'accepted' : 'canceled')
    expect(joined).toBe(acceptWon)
    expect(actions.includes('member.join')).toBe(acceptWon)
    expect(actions.includes('member.invite_cancel')).toBe(!acceptWon)
  })
})

describe('fix round 1: the invitations of an inviter follow the inviter (I2)', () => {
  test('removing a member cancels their pending invitations (audited); the link then says canceled', async () => {
    const owner = await person('i2-owner')
    const accountId = await newAccount(owner)
    const admin = await memberOf(owner, accountId, 'admin', 'i2-admin')
    // the admin, about to be removed, invites another address of theirs as admin
    const second = await person('i2-second')
    expect((await invite(admin, accountId, second.email, 'admin')).status).toBe(200)
    const token = await invitationToken(second.email)
    expect(await post(membersRoute, owner, '/api/account/members', { intent: 'remove', member: await memberId(accountId, admin.userId) })).toMatchObject({
      location: '/account/members?done=remove',
    })
    expect((await invitationsOf(accountId)).find((i) => i.email === second.email)?.status).toBe('canceled')
    expect(await auditOf(accountId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'member.invite_cancel', meta: expect.objectContaining({ email: second.email, reason: 'inviter_removed' }) })]),
    )
    expect(await accept(second, token)).toMatchObject({ status: 400, json: expect.objectContaining({ code: 'INVITATION_CANCELED' }) })
    expect((await membersOf(accountId)).some((m) => m.user_id === second.userId)).toBe(false)
  })

  test('the invitations a demoted member may no longer give are canceled (audited); the others stay', async () => {
    const owner = await person('i2-first-owner')
    const accountId = await newAccount(owner)
    const other = await memberOf(owner, accountId, 'owner', 'i2-other-owner')
    const asOwner = address('as-owner')
    const asEditor = address('as-editor')
    await invited(other, accountId, asOwner, 'owner')
    await invited(other, accountId, asEditor, 'editor')
    const otherMember = await memberId(accountId, other.userId)
    const statuses = async () =>
      Object.fromEntries((await invitationsOf(accountId)).filter((i) => i.email === asOwner || i.email === asEditor).map((i) => [i.email, i.status]))
    // owner to admin: the owner invitation goes, the editor one stays
    await post(membersRoute, owner, '/api/account/members', { intent: 'role', member: otherMember, role: 'admin' })
    expect(await statuses()).toEqual({ [asOwner]: 'canceled', [asEditor]: 'pending' })
    expect(await auditOf(accountId)).toEqual(
      expect.arrayContaining([expect.objectContaining({ action: 'member.invite_cancel', meta: expect.objectContaining({ email: asOwner, reason: 'inviter_role_changed' }) })]),
    )
    // admin to editor: no invitation of theirs stays
    await post(membersRoute, owner, '/api/account/members', { intent: 'role', member: otherMember, role: 'editor' })
    expect(await statuses()).toEqual({ [asOwner]: 'canceled', [asEditor]: 'canceled' })
  })

  test('accepting re-checks the inviter, whatever changed their role', async () => {
    const owner = await person('i2-check-owner')
    const accountId = await newAccount(owner)
    const admin = await memberOf(owner, accountId, 'admin', 'i2-check-admin')
    const guest = await person('i2-check-guest')
    expect((await invite(admin, accountId, guest.email, 'admin')).status).toBe(200)
    const token = await invitationToken(guest.email)
    // demoted behind the app's back: the invitation row is still pending
    await asRole('app', (c) => c.query(`update auth_account_member set role = 'viewer' where account_id = $1 and user_id = $2`, [accountId, admin.userId]))
    expect((await viewInvitation(token, guest.email)).state).toBe('canceled')
    expect(await accept(guest, token)).toMatchObject({ status: 400, json: expect.objectContaining({ code: 'INVITATION_CANCELED' }) })
    expect((await membersOf(accountId)).some((m) => m.user_id === guest.userId)).toBe(false)
  })
})

describe('fix round 1: limits (ruling R22)', () => {
  const quiet = async () => undefined

  test('at most 10 accounts created per person; the refusal is translated and audited', async () => {
    expect(LIMITS.accountsPerUser).toBe(10)
    const who = await person('many-accounts')
    for (let i = 1; i < 10; i++) expect(await createAccount(who.userId, `Account ${i}`)).toHaveProperty('accountId')
    expect(await post(createAccountRoute, who, '/api/accounts/create', { name: 'Tenth' })).toMatchObject({ location: '/account' })
    expect(await post(createAccountRoute, who, '/api/accounts/create', { name: 'Eleventh' })).toMatchObject({ status: 303, location: '/accounts/new?error=limit' })
    expect(await createAccount(who.userId, 'Twelfth')).toEqual({ refused: 'account_limit' })
    const refused = await asRole('system', async (c) =>
      (await c.query(`select meta from audit_log where action = 'account.create_refused' and actor_user_id = $1`, [who.userId])).rows,
    )
    expect(refused).toEqual([{ meta: { reason: 'account_limit' } }, { meta: { reason: 'account_limit' } }])
  })

  test('concurrent account creations never pass the limit', async () => {
    const who = await person('accounts-race')
    const results = await Promise.all(Array.from({ length: 14 }, (_, i) => createAccount(who.userId, `Race ${i}`)))
    expect(results.filter((r) => 'accountId' in r)).toHaveLength(10)
  })

  test('at most 50 pending invitations per account', async () => {
    expect(LIMITS.pendingInvitationsPerAccount).toBe(50)
    const owner = await person('pending-cap')
    const accountId = await newAccount(owner)
    const scope = (await scopeOf(owner))!
    for (let i = 0; i < 50; i++) expect(await createInvitation(scope, { email: address(`p${i}`), role: 'viewer' }, quiet)).toBe('ok')
    // sent days ago (no longer in the day's counts), still pending
    await asRole('migrate', (c) => c.query(`update auth_account_invitation set created_at = now() - interval '2 days' where account_id = $1`, [accountId]))
    expect(await createInvitation(scope, { email: address('p50'), role: 'viewer' }, quiet)).toBe('pending_limit')
    expect((await auditOf(accountId)).at(-1)).toMatchObject({ action: 'member.invite_refused', actor_user_id: owner.userId, meta: expect.objectContaining({ reason: 'pending_limit' }) })
    // through the endpoint: its own code
    expect(await invite(owner, accountId, address('p51'))).toMatchObject({ status: 400, json: expect.objectContaining({ code: 'INVITATION_LIMIT_PENDING' }) })
  })

  test('at most 50 invitations per account per day', async () => {
    expect(LIMITS.invitationsPerAccountPerDay).toBe(50)
    const owner = await person('account-day')
    const accountId = await newAccount(owner)
    const scope = (await scopeOf(owner))!
    for (let i = 0; i < 50; i++) expect(await createInvitation(scope, { email: address(`d${i}`), role: 'viewer' }, quiet)).toBe('ok')
    // canceling frees a pending place, not a place of the day
    const [one] = await invitationsOf(accountId)
    expect(await cancelInvitation(scope, one!.id)).toBe('ok')
    expect(await createInvitation(scope, { email: address('d50'), role: 'viewer' }, quiet)).toBe('account_day_limit')
    expect(await invite(owner, accountId, address('d51'))).toMatchObject({ status: 400, json: expect.objectContaining({ code: 'INVITATION_LIMIT_ACCOUNT_DAY' }) })
    expect((await auditOf(accountId)).at(-1)).toMatchObject({ action: 'member.invite_refused', meta: expect.objectContaining({ reason: 'account_day_limit' }) })
  })

  test('at most 100 invitations per person per day, over all their accounts', async () => {
    expect(LIMITS.invitationsPerUserPerDay).toBe(100)
    const owner = await person('user-day')
    const scopes: { accountId: string; userId: string; role: 'owner' }[] = []
    for (const name of ['One', 'Two', 'Three']) {
      const created = await createAccount(owner.userId, name)
      if (!('accountId' in created)) throw new Error('refused')
      await markPaid(created.accountId)
      scopes.push({ accountId: created.accountId, userId: owner.userId, role: 'owner' })
    }
    for (const scope of scopes.slice(0, 2)) for (let i = 0; i < 50; i++) expect(await createInvitation(scope, { email: address(`u${i}`), role: 'viewer' }, quiet)).toBe('ok')
    expect(await createInvitation(scopes[2]!, { email: address('u100'), role: 'viewer' }, quiet)).toBe('user_day_limit')
    expect((await auditOf(scopes[2]!.accountId)).at(-1)).toMatchObject({ action: 'member.invite_refused', meta: expect.objectContaining({ reason: 'user_day_limit' }) })
  })

  test('concurrent invitations never pass a limit', async () => {
    const owner = await person('limit-race')
    const accountId = await newAccount(owner)
    const scope = (await scopeOf(owner))!
    const results = await Promise.all(Array.from({ length: 60 }, (_, i) => createInvitation(scope, { email: address(`c${i}`), role: 'viewer' }, quiet)))
    expect(results.filter((r) => r === 'ok')).toHaveLength(50)
    expect(await invitationsOf(accountId)).toHaveLength(50)
  })
})

describe('the account-creation form is rate limited (finding T7: each refusal is an audit row)', () => {
  const refusals = (userId: string) =>
    asRole('system', async (c) => (await c.query(`select count(*)::int as n from audit_log where action = 'account.create_refused' and actor_user_id = $1`, [userId])).rows[0]?.n)

  test(`${ACCOUNT_CREATE_LIMIT.max} tries per person per ${ACCOUNT_CREATE_LIMIT.window / 60} minutes; past it nothing is written`, async () => {
    const who = await person('create-flood')
    // a person at the account limit: each try that gets through writes a refusal to the append-only log
    for (let i = 0; i < LIMITS.accountsPerUser; i++) expect(await createAccount(who.userId, `Mine ${i}`)).toHaveProperty('accountId')
    for (let i = 0; i < ACCOUNT_CREATE_LIMIT.max; i++) {
      expect(await post(createAccountRoute, who, '/api/accounts/create', { name: `Flood ${i}` })).toMatchObject({ status: 303, location: '/accounts/new?error=limit' })
    }
    for (const name of ['Flood again', '']) {
      expect(await post(createAccountRoute, who, '/api/accounts/create', { name })).toMatchObject({ status: 303, location: '/accounts/new?error=limited' })
    }
    expect(await refusals(who.userId)).toBe(ACCOUNT_CREATE_LIMIT.max)
    // the same person from another address: still their window
    const elsewhere: Person = { ...who, browser: new Browser(nextIp()) }
    for (const [name, value] of who.browser.cookies) elsewhere.browser.cookies.set(name, value)
    expect(await post(createAccountRoute, elsewhere, '/api/accounts/create', { name: 'Elsewhere' })).toMatchObject({ location: '/accounts/new?error=limited' })
  })

  test('per client address too: other people behind the same address share its window', async () => {
    const first = await person('create-address')
    for (let i = 0; i < ACCOUNT_CREATE_LIMIT.max; i++) {
      expect(await post(createAccountRoute, first, '/api/accounts/create', { name: '' })).toMatchObject({ location: '/accounts/new?error=name' })
    }
    const other = await person('create-address-other')
    const sameAddress: Person = { ...other, browser: new Browser(first.browser.peer) }
    for (const [name, value] of other.browser.cookies) sameAddress.browser.cookies.set(name, value)
    expect(await post(createAccountRoute, sameAddress, '/api/accounts/create', { name: 'Shared' })).toMatchObject({ location: '/accounts/new?error=limited' })
    expect(await scopeOf(other)).toBeNull()
    // from its own address the other person is not limited
    expect(await post(createAccountRoute, other, '/api/accounts/create', { name: 'Own address' })).toMatchObject({ location: '/account' })
  })

  test('a request without a known client address is refused, never counted in a shared window', async () => {
    const who = await person('create-no-address')
    const unknown: Person = { ...who, browser: new Browser(null) }
    for (const [name, value] of who.browser.cookies) unknown.browser.cookies.set(name, value)
    expect(await post(createAccountRoute, unknown, '/api/accounts/create', { name: 'Nowhere' })).toMatchObject({ location: '/accounts/new?error=limited' })
    expect(await scopeOf(who)).toBeNull()
  })
})

describe('only an account that has paid may invite (ruling R27: no unpaid relay of invitation emails)', () => {
  test('never paid, or past its grace period: refused with its code; no invitation, no mail, nothing in the log', async () => {
    const owner = await person('unpaid-inviter')
    const accountId = await newAccount(owner, `Unpaid ${newId().slice(0, 8)}`, { paid: false })
    const scope = (await scopeOf(owner))!
    const quiet = async () => undefined
    for (const state of ['none', 'necessary-only']) {
      if (state === 'necessary-only') await markPaid(accountId, '2001-01-01') // paid once, long past its grace
      const email = address(`unpaid-${state}`)
      expect(await invite(owner, accountId, email), state).toMatchObject({ status: 403, json: expect.objectContaining({ code: 'INVITATION_NEEDS_PAYMENT' }) })
      expect(await createInvitation(scope, { email, role: 'viewer' }, quiet), state).toBe('unpaid')
      expect(await mailsTo(email), state).toEqual([])
    }
    expect(await invitationsOf(accountId)).toEqual([])
    expect((await auditOf(accountId)).map((e) => e.action)).not.toContain('member.invite')
  })

  test('paid, or in its grace period: invites', async () => {
    const owner = await person('paid-inviter')
    const accountId = await newAccount(owner, `Grace ${newId().slice(0, 8)}`, { paid: false })
    await markPaid(accountId, new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) // ended yesterday: grace
    expect((await invite(owner, accountId, address('in-grace'))).status).toBe(200)
    await markPaid(accountId)
    expect((await invite(owner, accountId, address('paid'))).status).toBe(200)
  })
})

describe('fix round 1: minors (ruling R23)', () => {
  test('expiry is the clock of the database, not the app', async () => {
    const owner = await person('clock-owner')
    const accountId = await newAccount(owner)
    const guest = await person('clock-guest')
    const token = await invited(owner, accountId, guest.email)
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      // the app's clock says the 7 days are long over; the database says not
      vi.setSystemTime(Date.now() + 30 * 24 * 60 * 60 * 1000)
      expect((await viewInvitation(token, guest.email)).state).toBe('pending')
    } finally {
      vi.useRealTimers()
    }
  })

  test('signing up from a page with a next= (the invitation link) brings the verified person back to it; anything off-site is dropped', async () => {
    const signUpFrom = async (next: string) => {
      const email = address('next')
      const request = new Request(`${ORIGIN}/api/auth/sign-up/email`, {
        method: 'POST',
        headers: { origin: ORIGIN, 'content-type': 'application/json', referer: `${ORIGIN}/sign-up?${new URLSearchParams({ next })}` },
        body: JSON.stringify({ name: 'Next Person', email, password: 'correct horse battery staple 42' }),
      })
      expect((await handleAuth(request, nextIp())).status).toBe(200)
      const [mail] = await mailsTo(email)
      return new URL(mail?.data.url ?? '').searchParams.get('callbackURL')
    }
    expect(await signUpFrom('/invite/abc_DEF-123')).toBe(`/verify-email?${new URLSearchParams({ status: 'verified', next: '/invite/abc_DEF-123' })}`)
    expect(await signUpFrom('//evil.example/x')).toBe('/verify-email?status=verified')
  })
})
