// The tenant-isolation sweep in-process (Review Focus 1): the owner of account A presents account B's
// identifiers to every endpoint of src/pages (as the middleware serves them: the access rules first, then
// the route) and to every endpoint Better Auth serves, in the path, query and body, with plain cookies,
// with forged ones, and with A's session naming B as its account. A route that takes an identifier answers
// 404; every answer, every log line the request wrote, and the database hold nothing of B, and nothing of
// B changes. The cases are in test/isolation.ts; a route or Better Auth path without a case fails here.
// e2e/isolation.spec.ts sweeps every route, pages included, over HTTP against the built server.
import type { APIRoute } from 'astro'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { POST as createAccountRoute } from '../../src/pages/api/accounts/create'
import { auth } from '../../src/server/auth/auth'
import { requestAccess, signedInScope } from '../../src/server/auth/guard'
import { closeDatabases } from '../../src/server/data/client'
import { closeQueue } from '../../src/server/data/queue'
import { SOCKET_PEER_HEADER } from '../../src/server/socket-peer'
import { AUTH_ID_PROBES, AUTH_NO_IDS, forgedCookies, leaksOf, ROUTE_PROBES, snapshotOf, type OtherAccount, type Probe } from '../isolation'
import { appRoutes } from '../routes'
import { Browser, mailsTo, ORIGIN, pwnedStandIn, signedIn, verifiedUser } from './browser'
import { asRole, newId } from './raw'

// Every line the app logs during this file (the process logger, which Better Auth's logger also writes to).
const logged = vi.hoisted(() => [] as string[])
vi.mock('../../src/server/log', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../src/server/log')>()
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      logged.push(chunk.toString('utf8'))
      done()
    },
  })
  return { ...real, log: real.createLogger(sink) }
})

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

/** A new account owned by `who`, now their active account. */
async function newAccount(who: Person, name: string): Promise<string> {
  const request = new Request(`${ORIGIN}/api/accounts/create`, {
    method: 'POST',
    headers: who.browser.headers({ 'content-type': 'application/x-www-form-urlencoded' }),
    body: new URLSearchParams({ name }),
  })
  const response = await createAccountRoute({ request, locals: await signedInScope(request.headers), url: new URL(request.url) } as unknown as Parameters<APIRoute>[0])
  expect(response.status).toBe(303)
  const scope = (await signedInScope(who.browser.headers())).scope
  if (!scope) throw new Error('no account')
  return scope.accountId
}

/** Paid through 2099 (written as the system role, as the super-admin's console does). */
const markPaid = (accountId: string) =>
  asRole('system', (c) => c.query(`insert into entitlements (account_id, plan_id, paid_until) values ($1, 'starter', '2100-01-01')`, [accountId]))

/** The endpoint module of a route of src/pages (endpoints are not localized: the route is the file). */
async function endpointOf(route: string): Promise<Record<string, APIRoute | undefined>> {
  return (await import(/* @vite-ignore */ pathToFileURL(join(import.meta.dirname, '..', '..', 'src', 'pages', `${route}.ts`)).href)) as Record<string, APIRoute | undefined>
}

/** The answer of the middleware for a request the access rules did not let through (src/middleware.ts). */
function refused(access: Awaited<ReturnType<typeof requestAccess>>['access']): Response {
  if (access.kind === 'not-found') return new Response(null, { status: 404 })
  if (access.kind === 'see-other') return new Response(null, { status: 303, headers: { Location: access.location } })
  if (access.kind === 'refuse') return Response.json({ code: access.code }, { status: access.status })
  throw new Error('not refused')
}

/** A request as a browser sends it: its cookies (and `extra` ones), its address, this site's Origin. */
function requestOf(browser: Browser, probe: Probe, extraCookies: Record<string, string> = {}): Request {
  const headers = browser.headers({ [SOCKET_PEER_HEADER]: browser.peer ?? '' })
  const cookies = [headers.get('cookie'), ...Object.entries(extraCookies).map(([k, v]) => `${k}=${v}`)].filter(Boolean)
  headers.set('cookie', cookies.join('; '))
  const init: RequestInit = { method: probe.method, headers }
  if (probe.form) {
    headers.set('content-type', 'application/x-www-form-urlencoded')
    init.body = new URLSearchParams(probe.form)
  } else if (probe.json) {
    headers.set('content-type', 'application/json')
    init.body = JSON.stringify(probe.json)
  }
  return new Request(`${ORIGIN}${probe.path}`, init)
}

/** Serves `probe` for the route `route` as the app does: Better Auth's handler, or the access rules then the endpoint. */
async function serve(route: string, request: Request): Promise<Response> {
  const url = new URL(request.url)
  const module = await endpointOf(route)
  const handler = module[request.method] ?? module.ALL
  if (!handler) throw new Error(`${route} has no ${request.method} handler`)
  const context = (locals: object) => ({ request, url, locals, params: {}, cookies: { set() {} } }) as unknown as Parameters<APIRoute>[0]
  if (url.pathname.startsWith('/api/auth/') || ['/healthz', '/readyz'].includes(url.pathname)) return handler(context({}))
  const found = await requestAccess(request)
  if (found.access.kind !== 'pass') return refused(found.access)
  return handler(context({ session: found.session, scope: found.scope, entitlement: found.entitlement, locale: 'en' }))
}

/** What the request gave back (status, headers that carry content, body) and what it logged. */
async function answer(route: string, request: Request): Promise<{ status: number; seen: string; log: string }> {
  const from = logged.length
  const response = await serve(route, request)
  const body = await response.text()
  await new Promise((resolve) => setImmediate(resolve))
  const headers = ['location', 'content-type'].map((h) => response.headers.get(h) ?? '').concat(response.headers.getSetCookie())
  return { status: response.status, seen: `${headers.join('\n')}\n${body}`, log: logged.slice(from).join('') }
}

/** The request's own content: what it may get back without that being a leak. */
const sentBy = (probe: Probe, cookies: Record<string, string>) => `${probe.path} ${JSON.stringify(probe.form ?? probe.json ?? {})} ${JSON.stringify(cookies)}`

const snapshot = (b: OtherAccount) => asRole('app', (c) => snapshotOf(c, b))

let owner: Person
let accountA: string
let b: OtherAccount

beforeAll(async () => {
  pwnedStandIn()
  owner = await person('isolation-a')
  accountA = await newAccount(owner, `Alpha ${newId()}`)
  await markPaid(accountA)

  // account B: an owner with a passkey, a member, a pending invitation; paid
  const bOwner = await person('isolation-b-owner')
  const bMember = await person('isolation-b-member')
  const accountName = `Bravo ${newId()}`
  const accountB = await newAccount(bOwner, accountName)
  await markPaid(accountB)
  const names = [`Bianca ${newId()}`, `Boris ${newId()}`]
  await asRole('migrate', async (c) => {
    await c.query(`update auth_user set name = $2 where id = $1`, [bOwner.userId, names[0]])
    await c.query(`update auth_user set name = $2 where id = $1`, [bMember.userId, names[1]])
    await c.query(`insert into auth_account_member (account_id, user_id, role) values ($1, $2, 'editor')`, [accountB, bMember.userId])
  })
  const invitee = `isolation-b-invitee-${newId()}@example.test`
  expect((await bOwner.browser.call('/account/invite', { accountId: accountB, email: invitee, role: 'viewer' })).status).toBe(200)
  const link = (await mailsTo(invitee)).find((m) => m.template === 'invitation')?.data.url ?? ''
  const token = new URL(link).pathname.split('/').at(-1) ?? ''

  const passkeyName = `Key ${newId()}`
  const rows = await asRole('migrate', async (c) => {
    const one = async (sql: string, params: unknown[]) => (await c.query<{ id: string; token?: string }>(sql, params)).rows[0]!
    return {
      members: (await c.query<{ id: string; user_id: string }>(`select id, user_id from auth_account_member where account_id = $1`, [accountB])).rows,
      invitation: await one(`select id from auth_account_invitation where account_id = $1 and email = $2`, [accountB, invitee]),
      session: await one(`select id, token from auth_session where user_id = $1 order by created_at desc limit 1`, [bOwner.userId]),
      credential: await one(`select id from auth_credential where user_id = $1`, [bOwner.userId]),
      passkey: await one(
        `insert into auth_passkey (name, public_key, user_id, credential_id, counter, device_type, backed_up, created_at)
         values ($1, 'isolation-public-key', $2, $3, 0, 'singleDevice', false, now()) returning id`,
        [passkeyName, bOwner.userId, `credential-${newId()}`],
      ),
    }
  })
  const memberOf = (userId: string) => rows.members.find((m) => m.user_id === userId)!.id
  b = {
    accountId: accountB,
    accountName,
    people: [
      { userId: bOwner.userId, email: bOwner.email, name: names[0]!, memberId: memberOf(bOwner.userId) },
      { userId: bMember.userId, email: bMember.email, name: names[1]!, memberId: memberOf(bMember.userId) },
    ],
    invitation: { id: rows.invitation.id, token, email: invitee },
    session: { id: rows.session.id, token: rows.session.token! },
    passkey: { id: rows.passkey.id, name: passkeyName },
    credentialId: rows.credential.id,
  }
}, 60_000)

afterAll(async () => {
  await asRole('migrate', (c) => c.query(`delete from pgboss.job where name = 'mail.send' and data->>'to' like '%@example.test'`))
  await closeQueue()
  await closeDatabases()
})

describe('the sweep covers everything that answers', () => {
  test('every route of src/pages has its cases', () => {
    expect(Object.keys(ROUTE_PROBES).sort()).toEqual(appRoutes().map((r) => r.route).sort())
  })

  test('every path Better Auth serves over HTTP has its cases, and every case without an identifier is still served', () => {
    const disabled = new Set(auth.options.disabledPaths ?? [])
    const served = Object.values(auth.api as Record<string, { path?: string }>)
      .map((endpoint) => endpoint.path)
      .filter((path): path is string => typeof path === 'string' && !disabled.has(path))
    const withIds = Object.keys(AUTH_ID_PROBES)
    expect(AUTH_NO_IDS.filter((path) => withIds.includes(path))).toEqual([])
    expect(served.filter((path) => !withIds.includes(path)).sort()).toEqual([...AUTH_NO_IDS].sort())
  })
})

// The three ways A could claim B: B's identifiers alone; with cookies naming B; with A's session row naming
// B as its active account (as if a switch had been forged).
const STATES = ['identifiers', 'forged cookies', "A's session names B"] as const

describe.each(STATES)("A's owner presents B's identifiers to every endpoint (%s)", (state) => {
  beforeAll(async () => {
    if (state === "A's session names B") {
      await asRole('migrate', (c) => c.query(`update auth_session set active_account_id = $2 where user_id = $1`, [owner.userId, b.accountId]))
      // the scope stays A's: B is not one of the person's accounts
      expect((await signedInScope(owner.browser.headers())).scope?.accountId).toBe(accountA)
    }
  })
  afterAll(async () => {
    await asRole('migrate', (c) => c.query(`update auth_session set active_account_id = $2 where user_id = $1`, [owner.userId, accountA]))
  })

  for (const route of appRoutes().filter((r) => r.endpoint)) {
    test(route.route, async () => {
      const cookies = state === 'forged cookies' ? forgedCookies(b) : {}
      for (const probe of ROUTE_PROBES[route.route]!(b)) {
        const where = `${probe.method} ${probe.path} ${JSON.stringify(probe.form ?? probe.json ?? '')}`
        const before = await snapshot(b)
        const got = await answer(route.route, requestOf(owner.browser, probe, cookies))
        expect.soft(got.status, where).toBe(probe.status)
        expect.soft(leaksOf(got.seen, b, sentBy(probe, cookies)), `${where}: answer`).toEqual([])
        expect.soft(leaksOf(got.log, b, sentBy(probe, cookies)), `${where}: log`).toEqual([])
        expect.soft(await snapshot(b), `${where}: database`).toBe(before)
      }
      // A is still signed in, in A
      expect((await signedInScope(owner.browser.headers())).scope?.accountId).toBe(accountA)
    })
  }
})

describe("Better Auth's endpoints that take no identifier ignore B's", () => {
  /** A fresh member of A for each endpoint: some of them sign out, revoke sessions or change the person. */
  async function memberOfA(): Promise<Person> {
    const who = await person('isolation-a-member')
    await asRole('migrate', (c) => c.query(`insert into auth_account_member (account_id, user_id, role) values ($1, $2, 'viewer')`, [accountA, who.userId]))
    return who
  }

  for (const path of AUTH_NO_IDS) {
    test(path, async () => {
      const endpoint = Object.values(auth.api as Record<string, { path?: string; options?: { method?: string | string[] } }>).find((e) => e.path === path)
      const methods = [endpoint?.options?.method ?? 'GET'].flat()
      const concrete = path.replace(':id', b.accountId).replace(':token', b.session.token)
      const fields = { account: b.accountId, accountId: b.accountId, organizationId: b.accountId, userId: b.people[0]!.userId, id: b.passkey.id, token: b.session.token }
      for (const method of methods.filter((m) => m === 'GET' || m === 'POST')) {
        for (const cookies of [{}, forgedCookies(b)]) {
          const who = await memberOfA()
          const probe: Probe =
            method === 'GET'
              ? { method, path: `/api/auth${concrete}?${new URLSearchParams(fields)}`, status: 0 }
              : { method: 'POST', path: `/api/auth${concrete}`, json: fields, status: 0 }
          const where = `${method} ${path}`
          const before = await snapshot(b)
          const got = await answer('/api/auth/[...all]', requestOf(who.browser, probe, cookies))
          expect(got.status, where).toBeLessThan(500)
          expect.soft(leaksOf(got.seen, b, sentBy(probe, cookies)), `${where}: answer`).toEqual([])
          expect.soft(leaksOf(got.log, b, sentBy(probe, cookies)), `${where}: log`).toEqual([])
          expect.soft(await snapshot(b), `${where}: database`).toBe(before)
        }
      }
    })
  }
})
