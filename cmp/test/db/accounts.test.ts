// Accounts, members, roles and invitations against the real database: the app's form routes (called as
// the middleware would, with locals from signedInScope), Better Auth's handler for the account endpoints,
// and the tables underneath. Review Focus 1 (another account's ids are 404 and change nothing) and 4
// (an invitation used by another email, twice, after expiry or after cancellation does nothing and says why).
import { createHash } from 'node:crypto'
import type { APIRoute } from 'astro'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { POST as createAccountRoute } from '../../src/pages/api/accounts/create'
import { POST as membersRoute } from '../../src/pages/api/account/members'
import { POST as switchRoute } from '../../src/pages/api/account/switch'
import { ORGANIZATION_PATHS } from '../../src/server/auth/auth'
import { signedInScope } from '../../src/server/auth/guard'
import { viewInvitation } from '../../src/server/data/accounts'
import { closeDatabases } from '../../src/server/data/client'
import { closeQueue } from '../../src/server/data/queue'
import type { Role } from '../../src/server/data/scope'
import { address, Browser, mailsTo, ORIGIN, pwnedStandIn, signedIn, verifiedUser } from './browser'
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
    headers: who.browser.headers({ 'content-type': 'application/x-www-form-urlencoded', referer: `${ORIGIN}/account/members` }),
    body: new URLSearchParams(fields),
  })
  const locals = await signedInScope(request.headers)
  const response = await route({ request, locals, url: new URL(request.url) } as unknown as Parameters<APIRoute>[0])
  return { status: response.status, location: response.headers.get('location'), body: await response.text() }
}

/** The scope a next request of `who` would get. */
const scopeOf = async (who: Person) => (await signedInScope(who.browser.headers())).scope

/** A new account owned by `who` (through the app's form), now their active account. */
async function newAccount(who: Person, name = `Account ${newId().slice(0, 8)}`): Promise<string> {
  const created = await post(createAccountRoute, who, '/api/accounts/create', { name })
  expect(created).toMatchObject({ status: 303, location: '/account' })
  const scope = await scopeOf(who)
  expect(scope?.role).toBe('owner')
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
      const hits = await Promise.all(tables.map((t) => c.query(`select 1 from ${t} where ${t}::text like $1`, [`%${token}%`])))
      return hits.reduce((n, r) => n + (r.rowCount ?? 0), 0)
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
    expect(await accept(stranger, token)).toMatchObject({ status: 403, json: expect.objectContaining({ code: 'INVITATION_WRONG_EMAIL' }) })
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
