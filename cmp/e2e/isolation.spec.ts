import { expect, request as http, test, type APIRequestContext, type APIResponse } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'

import { forgedCookies, leaksOf, ROUTE_PROBES, snapshotOf, type OtherAccount, type Probe } from '../test/isolation'
import { appRoutes } from '../test/routes'
import { linkIn, mail } from './mailpit'
import { catalog, clientAddress, database, newEmail, pathIn, signedIn, signedUp } from './people'
import { SERVER_LOG } from './server-log'

// The tenant-isolation sweep over HTTP against the built server (Review Focus 1): the owner of account A
// requests every route of src/pages (pages in both languages) with account B's identifiers in the path,
// query and body, with plain cookies, with forged cookies naming B, and with A's session naming B as its
// account. A route that takes an identifier answers 404 (the 404 page for a page); no answer, no line the
// server logged for the request, holds anything of B, and nothing of B changes in the database. The cases
// are in test/isolation.ts; a route without one fails the sweep. test/db/isolation.test.ts runs the
// endpoints in-process, Better Auth's whole HTTP surface included.

const en = catalog('en')
const STATES = ['identifiers', 'forged cookies', "A's session names B"] as const

let origin: string
let owner: APIRequestContext
let ownerState: Awaited<ReturnType<APIRequestContext['storageState']>>
let ownerUserId: string
let accountA: string
let b: OtherAccount

/** A client of its own (cookies, address), as a browser would be. */
const client = (baseURL: string) => http.newContext({ baseURL, extraHTTPHeaders: { 'X-Forwarded-For': clientAddress() } })
/** The Origin header a browser sends with a POST from this site's pages. */
const fromSite = () => ({ Origin: origin })

/** The account `who` works in, created through its form, and its id. */
async function newAccount(who: APIRequestContext, name: string, userId: string): Promise<string> {
  const created = await who.post('/api/accounts/create', { headers: fromSite(), form: { name }, maxRedirects: 0 })
  expect(created.status()).toBe(303)
  return database(async (c) => (await c.query<{ id: string }>(`select active_account_id as id from auth_session where user_id = $1 order by created_at desc limit 1`, [userId])).rows[0]!.id)
}

const userIdOf = (email: string) => database(async (c) => (await c.query<{ id: string }>(`select id from auth_user where email = $1`, [email])).rows[0]!.id)
const markPaid = (accountId: string) => database((c) => c.query(`insert into entitlements (account_id, plan_id, paid_until) values ($1, 'starter', '2100-01-01')`, [accountId]), 'system')

/** The token of the newest invitation link mailed to `email`. */
async function invitationToken(who: APIRequestContext, email: string, account: string): Promise<string> {
  const link = linkIn(await mail(who, email, en('email_invitation_subject', { inviter: b.people[0]?.name ?? '', account })), origin)
  return new URL(link).pathname.split('/').at(-1) ?? ''
}

test.beforeAll(async ({ baseURL }) => {
  test.setTimeout(120_000)
  origin = baseURL ?? ''

  // A: an owner of a paid account
  owner = await client(origin)
  const ownerEmail = newEmail('isolation-a')
  await signedIn(owner, origin, ownerEmail, await signedUp(owner, origin, `Alpha ${randomUUID()}`, ownerEmail))
  ownerUserId = await userIdOf(ownerEmail)
  accountA = await newAccount(owner, `Alpha ${randomUUID()}`, ownerUserId)
  await markPaid(accountA)
  ownerState = await owner.storageState()

  // B: an owner with a passkey, a member who joined by invitation, a pending invitation; paid
  const bOwner = await client(origin)
  const bMember = await client(origin)
  const people = [
    { email: newEmail('isolation-b-owner'), name: `Bianca ${randomUUID()}`, client: bOwner },
    { email: newEmail('isolation-b-member'), name: `Boris ${randomUUID()}`, client: bMember },
  ]
  for (const p of people) await signedIn(p.client, origin, p.email, await signedUp(p.client, origin, p.name, p.email))
  const bOwnerId = await userIdOf(people[0]!.email)
  const accountName = `Bravo ${randomUUID()}`
  const accountB = await newAccount(bOwner, accountName, bOwnerId)
  await markPaid(accountB)
  b = { accountId: accountB, accountName, people: [], invitation: { id: '', token: '', email: newEmail('isolation-b-invitee') }, session: { id: '', token: '' }, passkey: { id: '', name: `Key ${randomUUID()}` }, credentialId: '' }
  b.people.push({ userId: bOwnerId, email: people[0]!.email, name: people[0]!.name, memberId: '' })
  for (const email of [people[1]!.email, b.invitation.email]) {
    const invited = await bOwner.post('/api/auth/account/invite', { headers: fromSite(), data: { accountId: accountB, email, role: 'editor' } })
    expect(invited.status(), await invited.text()).toBe(200)
  }
  const joined = await bMember.post('/api/auth/account/accept-invitation', { headers: fromSite(), data: { token: await invitationToken(bMember, people[1]!.email, accountName) } })
  expect(joined.status(), await joined.text()).toBe(200)
  b.invitation.token = await invitationToken(bOwner, b.invitation.email, accountName)

  await database(async (c) => {
    const memberUserId = (await c.query<{ id: string }>(`select id from auth_user where email = $1`, [people[1]!.email])).rows[0]!.id
    const members = (await c.query<{ id: string; user_id: string }>(`select id, user_id from auth_account_member where account_id = $1`, [accountB])).rows
    b.people[0]!.memberId = members.find((m) => m.user_id === bOwnerId)!.id
    b.people.push({ userId: memberUserId, email: people[1]!.email, name: people[1]!.name, memberId: members.find((m) => m.user_id === memberUserId)!.id })
    b.invitation.id = (await c.query<{ id: string }>(`select id from auth_account_invitation where account_id = $1 and email = $2`, [accountB, b.invitation.email])).rows[0]!.id
    const session = (await c.query<{ id: string; token: string }>(`select id, token from auth_session where user_id = $1 order by created_at desc limit 1`, [bOwnerId])).rows[0]!
    b.session = session
    b.credentialId = (await c.query<{ id: string }>(`select id from auth_credential where user_id = $1`, [bOwnerId])).rows[0]!.id
    b.passkey.id = (
      await c.query<{ id: string }>(
        `insert into auth_passkey (name, public_key, user_id, credential_id, counter, device_type, backed_up, created_at)
         values ($1, 'isolation-public-key', $2, $3, 0, 'singleDevice', false, now()) returning id`,
        [b.passkey.name, bOwnerId, `credential-${randomUUID()}`],
      )
    ).rows[0]!.id
  })
  await bOwner.dispose()
  await bMember.dispose()
})

test.afterAll(async () => {
  await owner.dispose()
})

/** The server's log lines (playwright.config.ts writes them to SERVER_LOG) of the request with this id. */
function serverLogOf(requestId: string): string[] {
  return readFileSync(SERVER_LOG, 'utf8')
    .split('\n')
    .filter((line) => line.includes(`"requestId":"${requestId}"`))
}

/** What A sent: what A may get back without it being a leak. */
const sentBy = (probe: Probe, path: string, cookies: Record<string, string>) => `${path} ${JSON.stringify(probe.form ?? probe.json ?? {})} ${JSON.stringify(cookies)}`

async function send(who: APIRequestContext, probe: Probe, path: string): Promise<APIResponse> {
  if (probe.method === 'GET') return who.get(path, { maxRedirects: 0 })
  return who.post(path, { headers: fromSite(), maxRedirects: 0, ...(probe.form ? { form: probe.form } : { data: probe.json }) })
}

test('the sweep covers every route of src/pages, and the server log is captured', () => {
  expect(Object.keys(ROUTE_PROBES).sort()).toEqual(appRoutes().map((r) => r.route).sort())
  expect(existsSync(SERVER_LOG), `${SERVER_LOG}: start the server through playwright.config.ts (not a reused one)`).toBe(true)
})

for (const state of STATES) {
  test.describe(`A's owner presents B's identifiers to every route (${state})`, () => {
    let who: APIRequestContext
    let cookies: Record<string, string> = {}

    test.beforeAll(async () => {
      cookies = state === 'forged cookies' ? forgedCookies(b) : {}
      const host = new URL(origin).hostname
      who = await http.newContext({
        baseURL: origin,
        extraHTTPHeaders: { 'X-Forwarded-For': clientAddress() },
        storageState: { origins: [], cookies: [...ownerState.cookies, ...Object.entries(cookies).map(([name, value]) => ({ name, value, domain: host, path: '/', expires: -1, httpOnly: true, secure: false, sameSite: 'Lax' as const }))] },
      })
      if (state === "A's session names B") await database((c) => c.query(`update auth_session set active_account_id = $2 where user_id = $1`, [ownerUserId, b.accountId]))
    })
    test.afterAll(async () => {
      await database((c) => c.query(`update auth_session set active_account_id = $2 where user_id = $1`, [ownerUserId, accountA]))
      await who.dispose()
    })

    for (const route of appRoutes()) {
      test(route.route, async () => {
        for (const probe of ROUTE_PROBES[route.route]!(b)) {
          for (const path of route.localized ? [probe.path, pathIn('sk', probe.path)] : [probe.path]) {
            const where = `${probe.method} ${path} ${JSON.stringify(probe.form ?? probe.json ?? '')}`
            const before = await database((c) => snapshotOf(c, b))
            const response = await send(who, probe, path)
            const seen = `${response.headers().location ?? ''}\n${response.headers()['set-cookie'] ?? ''}\n${await response.text()}`
            const sent = sentBy(probe, path, cookies)
            expect.soft(response.status(), where).toBe(probe.status)
            expect.soft(leaksOf(seen, b, sent), `${where}: answer`).toEqual([])
            expect.soft(await database((c) => snapshotOf(c, b)), `${where}: database`).toBe(before)
            // a request the server handled (not a prerendered file) is logged under its id
            const requestId = response.headers()['x-request-id']
            if (requestId && !['/healthz', '/readyz'].includes(path.split('?')[0]!)) {
              await expect.poll(() => serverLogOf(requestId).length, `${where}: logged`).toBeGreaterThan(0)
              expect.soft(leaksOf(serverLogOf(requestId).join('\n'), b, sent), `${where}: log`).toEqual([])
            }
          }
        }
      })
    }
  })
}
