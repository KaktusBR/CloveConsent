// Sign-up, sign-in, verification, second factor and sessions against the real database, through Better
// Auth's request handler (what /api/auth/* runs) and the app's guard. Mail is read from the queue (the
// worker is not running here); Have I Been Pwned is answered by a local stand-in.
import { createHash } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { authErrorMessage } from '../../src/lib/auth-errors'
import { POST as revokeSession } from '../../src/pages/api/account/revoke-session'
import { auth, createAuth, type AuthInstance } from '../../src/server/auth/auth'
import { handleAuth } from '../../src/server/auth/handler'
import { completeSession, requireUser } from '../../src/server/auth/guard'
import { enqueue } from '../../src/server/jobs/queue'
import { startWorker } from '../../src/worker'
import { closeDatabases } from '../../src/server/data/client'
import { releaseInWindow, reserveInWindow } from '../../src/server/data/auth-limits'
import { closeQueue } from '../../src/server/data/queue'
import en from '../../messages/en.json'
import { captureLog } from '../unit/capture-log'
import { secretOf, totp } from '../totp'
import { asRole, newId } from './raw'

const ORIGIN = 'http://localhost:4321' // PUBLIC_ORIGIN of vitest.db.config.ts
const PASSWORD = 'correct horse battery staple 42'
/** In the stand-in's breach corpus. */
const BREACHED = 'password1234567'

/** Have I Been Pwned's range API, knowing one breached password. */
function pwnedStandIn() {
  const hash = createHash('sha1').update(BREACHED).digest('hex').toUpperCase()
  const real = globalThis.fetch
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input)
    const prefix = /^https:\/\/api\.pwnedpasswords\.com\/range\/([0-9A-F]{5})$/.exec(url)?.[1]
    if (prefix === undefined) return real(input, init)
    const lines = prefix === hash.slice(0, 5) ? `${hash.slice(5)}:3861493\r\n0000000000000000000000000000000000A:0` : '0000000000000000000000000000000000A:0'
    return new Response(lines, { status: 200, headers: { 'Content-Type': 'text/plain' } })
  })
}

let ipCounter = 0
/**
 * A distinct socket address per browser (what the node adapter reports as the peer), so the rate-limit
 * windows of one test never touch another's. Distinct clients, not a rotated header.
 */
const nextIp = () => `198.51.${100 + (++ipCounter >> 8)}.${ipCounter & 255}`
/** TRUSTED_PROXIES of vitest.db.config.ts. */
const PROXY = '192.0.2.10'

/** One browser: its cookies, its address. Requests carry this site's Origin, as browsers do. */
class Browser {
  readonly cookies = new Map<string, string>()

  /**
   * @param peer the socket address the request comes from (null: none known)
   * @param forwardedFor an X-Forwarded-For header the request carries (from the client or a proxy)
   * @param instance the auth instance (default: the app's)
   */
  constructor(
    readonly peer: string | null = nextIp(),
    readonly forwardedFor?: string,
    readonly instance: AuthInstance = auth,
    readonly origin: string = ORIGIN,
  ) {}

  headers(extra: Record<string, string> = {}): Headers {
    const h = new Headers({ origin: this.origin, 'user-agent': 'vitest', ...extra })
    if (this.forwardedFor !== undefined) h.set('x-forwarded-for', this.forwardedFor)
    if (this.cookies.size > 0) h.set('cookie', [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '))
    return h
  }

  keep(response: Response): void {
    for (const line of response.headers.getSetCookie()) {
      const [pair = '', ...attrs] = line.split(';')
      const at = pair.indexOf('=')
      const name = pair.slice(0, at).trim()
      const value = pair.slice(at + 1).trim()
      const expired = value === '' || attrs.some((a) => /^\s*max-age=0\s*$/i.test(a))
      if (expired) this.cookies.delete(name)
      else this.cookies.set(name, value)
    }
  }

  async call(path: string, body?: unknown, method = body === undefined ? 'GET' : 'POST') {
    const init: RequestInit = { method, headers: this.headers(body === undefined ? {} : { 'content-type': 'application/json' }) }
    if (body !== undefined) init.body = JSON.stringify(body)
    const response = await handleAuth(new Request(`${this.origin}/api/auth${path}`, init), this.peer ?? undefined, this.instance)
    this.keep(response)
    this.lastSetCookies = response.headers.getSetCookie()
    const text = await response.text()
    return { status: response.status, location: response.headers.get('location'), json: text ? (JSON.parse(text) as Record<string, unknown>) : null }
  }

  lastSetCookies: string[] = []

  hasSession(): boolean {
    return [...this.cookies.keys()].some((k) => k.endsWith('.session_token'))
  }
}

const address = (label: string) => `${label}-${newId()}@example.test`

/** The mail jobs queued for `to`, oldest first, read as the owner. */
async function mailsTo(to: string) {
  return asRole('migrate', async (c) =>
    (await c.query<{ data: { template: string; locale: string; data: Record<string, string> } }>(
      `select data from pgboss.job where name = 'mail.send' and data->>'to' = $1 order by created_on, id`,
      [to],
    )).rows.map((r) => r.data),
  )
}

async function signUp(email: string, password = PASSWORD) {
  return new Browser().call('/sign-up/email', { name: 'Test Person', email, password })
}

/** Signs up and opens the emailed link. */
async function verifiedUser(label: string): Promise<string> {
  const email = address(label)
  expect((await signUp(email)).status).toBe(200)
  const [mail] = await mailsTo(email)
  expect(mail?.template).toBe('verify-email')
  const link = new URL(mail?.data.url ?? '')
  expect(link.origin).toBe(ORIGIN)
  const opened = await new Browser().call(`${link.pathname.replace('/api/auth', '')}${link.search}`)
  expect(opened.status).toBe(302)
  expect(opened.location).toBe('/verify-email?status=verified')
  return email
}

async function signedIn(email: string): Promise<Browser> {
  const browser = new Browser()
  const result = await browser.call('/sign-in/email', { email, password: PASSWORD })
  expect(result.status).toBe(200)
  return browser
}

/** Turns on TOTP for the signed-in browser; returns the secret and the backup codes. */
async function enableTwoFactor(browser: Browser) {
  const enabled = await browser.call('/two-factor/enable', { password: PASSWORD })
  expect(enabled.status).toBe(200)
  const secret = secretOf(String(enabled.json?.totpURI))
  const confirmed = await browser.call('/two-factor/verify-totp', { code: totp(secret) })
  expect(confirmed.status).toBe(200)
  return { secret, backupCodes: enabled.json?.backupCodes as string[] }
}

beforeAll(pwnedStandIn)

afterAll(async () => {
  // the mail this file queued is never sent (no worker runs here, except briefly in the clean-up test):
  // left in the queue it would be a backlog of real deliveries for the next file's worker (queue.test.ts)
  await asRole('migrate', (c) => c.query(`delete from pgboss.job where name = 'mail.send' and data->>'to' like '%@example.test'`))
  vi.unstubAllGlobals()
  await closeQueue()
  await closeDatabases()
})

describe('sign-up and email verification', () => {
  test('the verification link is on the public origin, in the language of the page signed up from', async () => {
    const email = address('sk')
    const browser = new Browser()
    const init = { method: 'POST', headers: browser.headers({ 'content-type': 'application/json', referer: `${ORIGIN}/sk/sign-up` }) }
    const response = await handleAuth(new Request(`${ORIGIN}/api/auth/sign-up/email`, { ...init, body: JSON.stringify({ name: 'Osoba', email, password: PASSWORD }) }), browser.peer ?? undefined)
    expect(response.status).toBe(200)
    const [mail] = await mailsTo(email)
    expect(mail).toMatchObject({ template: 'verify-email', locale: 'sk' })
    expect(new URL(mail?.data.url ?? '').searchParams.get('callbackURL')).toBe('/sk/verify-email?status=verified')
  })

  test('an unverified user cannot sign in: no session, and the guard sees none (Review Focus 2)', async () => {
    const email = address('unverified')
    expect((await signUp(email)).status).toBe(200)
    const browser = new Browser()
    const result = await browser.call('/sign-in/email', { email, password: PASSWORD })
    expect(result.status).toBe(403)
    expect(result.json?.code).toBe('EMAIL_NOT_VERIFIED')
    expect(browser.hasSession()).toBe(false)
    expect(await completeSession(browser.headers())).toBeNull()
  })

  test('a verified user signs in and the guard accepts the session', async () => {
    const browser = await signedIn(await verifiedUser('verified'))
    expect(browser.hasSession()).toBe(true)
    expect((await completeSession(browser.headers()))?.user.emailVerified).toBe(true)
  })

  test('a breached password is refused with a code that maps to a translated message', async () => {
    const email = address('breached')
    const result = await signUp(email, BREACHED)
    expect(result.status).toBe(400)
    expect(result.json?.code).toBe('PASSWORD_COMPROMISED')
    expect(authErrorMessage({ code: 'PASSWORD_COMPROMISED', status: 400 })).toBe(en.auth_error_password_compromised)
    expect(await mailsTo(email)).toEqual([])
  })

  test('a password shorter than 12 or longer than 128 characters is refused', async () => {
    expect((await signUp(address('short'), 'a'.repeat(11))).json?.code).toBe('PASSWORD_TOO_SHORT')
    expect((await signUp(address('long'), 'a'.repeat(129))).json?.code).toBe('PASSWORD_TOO_LONG')
  })
})

describe('two-factor authentication', () => {
  test('with 2FA on, the password alone gives no session: no page or API, until the code (Review Focus 2)', async () => {
    const email = await verifiedUser('pending')
    const { secret } = await enableTwoFactor(await signedIn(email))

    const browser = new Browser()
    const first = await browser.call('/sign-in/email', { email, password: PASSWORD })
    expect(first.json?.twoFactorRedirect).toBe(true)
    expect(browser.hasSession()).toBe(false)
    expect(await completeSession(browser.headers())).toBeNull()
    expect((await browser.call('/get-session')).json).toBeNull()
    expect((await browser.call('/passkey/list-user-passkeys')).status).toBe(401)
    expect((await browser.call('/list-sessions')).status).toBe(401)

    const second = await browser.call('/two-factor/verify-totp', { code: totp(secret, 1) })
    expect(second.status).toBe(200)
    expect((await completeSession(browser.headers()))?.session.secondFactor).toBe(true)
  })

  test('a session of a 2FA user that did not pass the second factor counts as no session', async () => {
    const email = await verifiedUser('marker')
    const browser = await signedIn(email)
    await enableTwoFactor(browser)
    expect(await completeSession(browser.headers())).not.toBeNull()
    await asRole('migrate', (c) => c.query(`update auth_session s set second_factor = false from auth_user u where u.id = s.user_id and u.email = $1`, [email]))
    expect(await completeSession(browser.headers())).toBeNull()
  })

  test('turning 2FA on ends the other sessions of the user, which never passed it', async () => {
    const email = await verifiedUser('others')
    const other = await signedIn(email)
    await enableTwoFactor(await signedIn(email))
    expect(await completeSession(other.headers())).toBeNull()
    expect((await other.call('/get-session')).json).toBeNull()
  })

  test('"trust this device" is refused', async () => {
    const email = await verifiedUser('trust')
    const { secret } = await enableTwoFactor(await signedIn(email))
    const browser = new Browser()
    await browser.call('/sign-in/email', { email, password: PASSWORD })
    const result = await browser.call('/two-factor/verify-totp', { code: totp(secret, 1), trustDevice: true })
    expect(result.status).toBe(400)
    expect(browser.hasSession()).toBe(false)
  })

  test('a backup code signs in once; the second time it is refused', async () => {
    const email = await verifiedUser('backup')
    const { backupCodes } = await enableTwoFactor(await signedIn(email))
    const code = backupCodes[0] ?? ''

    const first = new Browser()
    await first.call('/sign-in/email', { email, password: PASSWORD })
    expect((await first.call('/two-factor/verify-backup-code', { code })).status).toBe(200)
    expect((await completeSession(first.headers()))?.session.secondFactor).toBe(true)

    const second = new Browser()
    await second.call('/sign-in/email', { email, password: PASSWORD })
    const again = await second.call('/two-factor/verify-backup-code', { code })
    expect(again.status).toBe(401)
    expect(again.json?.code).toBe('INVALID_BACKUP_CODE')
    expect(await completeSession(second.headers())).toBeNull()
  })

  test('turning 2FA on and off each queues a two-factor-changed mail', async () => {
    const email = await verifiedUser('changed')
    const browser = await signedIn(email)
    await enableTwoFactor(browser)
    expect((await browser.call('/two-factor/disable', { password: PASSWORD })).status).toBe(200)
    const notices = (await mailsTo(email)).filter((m) => m.template === 'two-factor-changed')
    expect(notices.map((m) => m.data.state)).toEqual(['enabled', 'disabled'])
    expect(notices[0]?.data.url).toBe(`${ORIGIN}/account/security`)
  })
})

/** One failed sign-in per browser, each for an account nobody has (only the per-address limit applies). */
async function wrongSignIns(browsers: Browser[]): Promise<number[]> {
  const statuses: number[] = []
  for (const b of browsers) statuses.push((await b.call('/sign-in/email', { email: address('unknown'), password: 'wrong password 123' })).status)
  return statuses
}

describe('rate limiting', () => {
  test('repeated failed sign-ins from one address are refused with 429, counted in the database', async () => {
    const email = await verifiedUser('limited')
    const browser = new Browser()
    // a different (unknown) account each time: the per-account limits are not what is tested here
    expect(await wrongSignIns(Array.from({ length: 6 }, () => browser))).toEqual([401, 401, 401, 401, 401, 429])
    // the right password is refused too until the window ends
    expect((await browser.call('/sign-in/email', { email, password: PASSWORD })).status).toBe(429)
    // another address is not affected
    expect((await new Browser().call('/sign-in/email', { email, password: PASSWORD })).status).toBe(200)

    const rows = await asRole('migrate', async (c) => (await c.query<{ count: number }>(`select count from auth_rate_limit where key = $1`, [`${browser.peer}|/sign-in/email`])).rows)
    expect(rows).toEqual([{ count: 5 }])
  })
})

describe('sessions', () => {
  test('revoking a session from the Security page signs that browser out', async () => {
    const email = await verifiedUser('revoke')
    const here = await signedIn(email)
    const there = await signedIn(email)
    const target = await completeSession(there.headers())
    expect(target).not.toBeNull()

    const request = new Request(`${ORIGIN}/api/account/revoke-session`, {
      method: 'POST',
      headers: here.headers({ 'content-type': 'application/x-www-form-urlencoded', referer: `${ORIGIN}/sk/account/security` }),
      body: new URLSearchParams({ session: target?.session.id ?? '' }),
    })
    const response = await revokeSession({ request, url: new URL(request.url) } as Parameters<typeof revokeSession>[0])
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/sk/account/security')

    expect(await completeSession(there.headers())).toBeNull()
    expect(await completeSession(here.headers())).not.toBeNull()
  })

  test("a session id of another user's session revokes nothing", async () => {
    const mine = await signedIn(await verifiedUser('mine'))
    const theirs = await signedIn(await verifiedUser('theirs'))
    const target = await completeSession(theirs.headers())
    const request = new Request(`${ORIGIN}/api/account/revoke-session`, {
      method: 'POST',
      headers: mine.headers({ 'content-type': 'application/x-www-form-urlencoded' }),
      body: new URLSearchParams({ session: target?.session.id ?? '' }),
    })
    await revokeSession({ request, url: new URL(request.url) } as Parameters<typeof revokeSession>[0])
    expect(await completeSession(theirs.headers())).not.toBeNull()
  })

  test('the database stores no plain password, TOTP secret or backup code', async () => {
    const email = await verifiedUser('stored')
    const { secret, backupCodes } = await enableTwoFactor(await signedIn(email))
    const row = await asRole('migrate', async (c) =>
      (await c.query<{ row: string }>(
        `select row_to_json(t)::text || row_to_json(c)::text || row_to_json(u)::text as row from auth_user u
         join auth_credential c on c.user_id = u.id join auth_two_factor t on t.user_id = u.id where u.email = $1`,
        [email],
      )).rows[0]?.row ?? '',
    )
    expect(row).not.toBe('')
    expect(row).not.toContain(PASSWORD)
    expect(row).not.toContain(secret)
    for (const code of backupCodes) expect(row).not.toContain(code)
  })
})

describe('the client address of rate limits (only a trusted proxy may name it)', () => {
  test('a client that is not a trusted proxy cannot pick its bucket with X-Forwarded-For', async () => {
    const peer = nextIp()
    // one client, a different forged header on every request
    const browsers = Array.from({ length: 6 }, (_, i) => new Browser(peer, `203.0.113.${i + 1}`))
    expect(await wrongSignIns(browsers)).toEqual([401, 401, 401, 401, 401, 429])
    const forged = await asRole('migrate', async (c) => (await c.query(`select 1 from auth_rate_limit where key like '203.0.113.%'`)).rowCount)
    expect(forged).toBe(0)
  })

  test('behind a trusted proxy, each client named by the proxy has its own bucket', async () => {
    const clients = Array.from({ length: 6 }, () => nextIp())
    expect(await wrongSignIns(clients.map((c) => new Browser(PROXY, c)))).toEqual([401, 401, 401, 401, 401, 401])
    // one client named six times (behind a forged value of its own) is limited
    const one = nextIp()
    expect(await wrongSignIns(Array.from({ length: 6 }, (_, i) => new Browser(PROXY, `203.0.113.${i + 1}, ${one}`)))).toEqual([401, 401, 401, 401, 401, 429])
  })

  test('a request whose address is unknown is refused, never counted in a shared bucket', async () => {
    const result = await new Browser(null).call('/sign-in/email', { email: address('nobody'), password: PASSWORD })
    expect(result.status).toBe(400)
    const shared = await asRole('migrate', async (c) => (await c.query(`select 1 from auth_rate_limit where key like 'no-trusted-ip|%' or key like '127.0.0.1|%'`)).rowCount)
    expect(shared).toBe(0)
  })

  test('IPv6: addresses in one /64 share the per-address bucket', async () => {
    const prefix = `2001:db8:${(++ipCounter).toString(16)}:1`
    const browsers = Array.from({ length: 6 }, (_, i) => new Browser(`${prefix}:${i + 1}::${(i + 7).toString(16)}`))
    expect(await wrongSignIns(browsers)).toEqual([401, 401, 401, 401, 401, 429])
    // another /64 is another client
    expect(await wrongSignIns([new Browser(`2001:db8:${ipCounter.toString(16)}:2::1`)])).toEqual([401])
  })

  test('a client-sent internal address header is replaced, not trusted', async () => {
    const peer = nextIp()
    const browsers = Array.from({ length: 6 }, (_, i) => {
      const b = new Browser(peer)
      const headers = b.headers.bind(b)
      b.headers = (extra = {}) => headers({ ...extra, 'x-cmp-client-address': `203.0.113.${100 + i}` })
      return b
    })
    expect(await wrongSignIns(browsers)).toEqual([401, 401, 401, 401, 401, 429])
  })
})

describe('failed password sign-ins per account (ruling R19)', () => {
  const wrong = (b: Browser, email: string) => b.call('/sign-in/email', { email, password: 'wrong password 123' })

  test('IPv6: the (account, address) pair is per /64, so rotating within one /64 does not reset it', async () => {
    const email = await verifiedUser('pair-v6')
    const prefix = `2001:db8:${(++ipCounter).toString(16)}:9`
    const statuses: number[] = []
    for (let i = 0; i < 5; i++) statuses.push((await wrong(new Browser(`${prefix}:${i + 1}::1`), email)).status)
    expect(statuses).toEqual([401, 401, 401, 401, 429])
  })

  test('concurrent wrong passwords from one address get exactly 4 tries (the check and the count are one step)', async () => {
    const email = await verifiedUser('pair-race')
    const peer = nextIp()
    // Better Auth's per-address limit lets 5 of these through; ours must stop all but 4 of those
    const answers = await Promise.all(Array.from({ length: 8 }, () => wrong(new Browser(peer), email)))
    expect(answers.filter((a) => a.status === 401)).toHaveLength(4)
    expect(answers.filter((a) => a.status === 429)).toHaveLength(4)
  })

  test('concurrent wrong passwords from many addresses get exactly 200 tries per account', { timeout: 180_000 }, async () => {
    const email = await verifiedUser('account-race')
    const answers = await Promise.all(Array.from({ length: 220 }, () => wrong(new Browser(), email)))
    expect(answers.filter((a) => a.status === 401)).toHaveLength(200)
    expect(answers.filter((a) => a.status === 429).every((a) => a.json?.code === 'SIGN_IN_LIMITED')).toBe(true)
    expect((await new Browser().call('/sign-in/email', { email, password: PASSWORD })).status).toBe(429)
  })

  test('one address is stopped after 4 wrong passwords for an account, but cannot lock it for anyone else', async () => {
    const email = await verifiedUser('pair')
    const attacker = new Browser()
    const answers = []
    for (let i = 0; i < 5; i++) answers.push(await wrong(attacker, email))
    expect(answers.map((a) => a.status)).toEqual([401, 401, 401, 401, 429])
    // refused by this limit (5 requests are within Better Auth's per-address one)
    expect(answers[4]?.json?.code).toBe('SIGN_IN_LIMITED')
    // the right password from another address still works, as do further attempts from other addresses
    expect((await new Browser().call('/sign-in/email', { email, password: PASSWORD })).status).toBe(200)
    expect((await wrong(new Browser(), email)).status).toBe(401)
  })

  test('the account-wide cap (200 failures an hour, from any addresses) engages exactly at its threshold; correct sign-ins do not count', { timeout: 180_000 }, async () => {
    const email = await verifiedUser('cap')
    // 199 failures, from as many addresses, 20 at a time
    for (let i = 0; i < 199; i += 20) {
      const batch = await Promise.all(Array.from({ length: Math.min(20, 199 - i) }, () => wrong(new Browser(), email)))
      expect(batch.every((a) => a.status === 401)).toBe(true)
    }
    expect((await new Browser().call('/sign-in/email', { email, password: PASSWORD })).status).toBe(200)
    expect((await wrong(new Browser(), email)).status).toBe(401) // the 200th failure
    const capped = await new Browser().call('/sign-in/email', { email, password: PASSWORD })
    expect(capped.status).toBe(429)
    expect(capped.json?.code).toBe('SIGN_IN_LIMITED')
    // another account is not affected
    expect((await new Browser().call('/sign-in/email', { email: await verifiedUser('cap-other'), password: PASSWORD })).status).toBe(200)
  })

  describe('the windows', () => {
    const at = (ms: number) => vi.spyOn(Date, 'now').mockReturnValue(ms)
    const key = () => `window-test:${newId()}`
    afterEach(() => vi.restoreAllMocks())

    test('a place given back after its window ended does not take one from the new window', async () => {
      const k = key()
      const t0 = 1_900_000_000_000
      at(t0)
      const old = await reserveInWindow(k, 60, 2)
      expect(old).not.toBe(false)
      at(t0 + 61_000) // the window has ended: a new one starts with this attempt
      expect(await reserveInWindow(k, 60, 2)).not.toBe(false)
      await releaseInWindow(k, old as number) // the first attempt's answer lands late
      at(t0 + 62_000)
      expect([await reserveInWindow(k, 60, 2), await reserveInWindow(k, 60, 2)].map((p) => p !== false)).toEqual([true, false])
    })

    test('a refused attempt leaves no mark: a place given back afterwards can be taken again', async () => {
      const k = key()
      at(1_900_000_000_000)
      const first = await reserveInWindow(k, 60, 2)
      expect(await reserveInWindow(k, 60, 2)).not.toBe(false)
      expect(await reserveInWindow(k, 60, 2)).toBe(false) // full: refused
      expect(await reserveInWindow(k, 60, 2)).toBe(false)
      await releaseInWindow(k, first as number)
      expect([await reserveInWindow(k, 60, 2), await reserveInWindow(k, 60, 2)].map((p) => p !== false)).toEqual([true, false])
    })

    test('a place is never given back twice past zero, and an unknown key is left alone', async () => {
      const k = key()
      at(1_900_000_000_000)
      const place = await reserveInWindow(k, 60, 1)
      await releaseInWindow(k, place as number)
      await releaseInWindow(k, place as number)
      await releaseInWindow(key(), place as number)
      expect([await reserveInWindow(k, 60, 1), await reserveInWindow(k, 60, 1)].map((p) => p !== false)).toEqual([true, false])
    })
  })

  test('the counters hold no email address in clear', async () => {
    const email = await verifiedUser('keys')
    await wrong(new Browser(), email)
    const keys = await asRole('migrate', async (c) => (await c.query<{ key: string }>(`select key from auth_rate_limit where key like 'sign-in-failures:%'`)).rows.map((r) => r.key))
    expect(keys.length).toBeGreaterThan(0)
    expect(keys.join(' ')).not.toContain('@')
  })
})

describe('the second-factor marker on every new session', () => {
  test('changing the password (revoking other sessions) keeps a 2FA session complete', async () => {
    const email = await verifiedUser('change-password')
    const browser = await signedIn(email)
    await enableTwoFactor(browser)
    const changed = await browser.call('/change-password', { currentPassword: PASSWORD, newPassword: 'another long passphrase 77', revokeOtherSessions: true })
    expect(changed.status).toBe(200)
    expect((await completeSession(browser.headers()))?.session.secondFactor).toBe(true)
  })

  test('a password session of a user without 2FA is not marked, and ends when 2FA is turned on', async () => {
    const email = await verifiedUser('later')
    const before = await signedIn(email)
    expect((await completeSession(before.headers()))?.session.secondFactor).toBe(false)
    await enableTwoFactor(await signedIn(email))
    expect(await completeSession(before.headers())).toBeNull()
  })
})

describe('sliding sessions on page renders', () => {
  test('requireUser forwards the refreshed session cookie and the session is extended', async () => {
    const email = await verifiedUser('sliding')
    const browser = await signedIn(email)
    // as if signed in two days ago: past updateAge (1 day), so the next read refreshes it
    const old = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000)
    await asRole('migrate', (c) => c.query(`update auth_session s set expires_at = $2 from auth_user u where u.id = s.user_id and u.email = $1`, [email, old]))
    const url = new URL(`${ORIGIN}/account/security`)
    const astro = {
      request: new Request(url, { headers: browser.headers() }),
      url,
      response: { headers: new Headers() },
      redirect: (to: string, status: number) => new Response(null, { status, headers: { Location: to } }),
    }
    const result = await requireUser(astro as unknown as Parameters<typeof requireUser>[0])
    expect(result).not.toBeInstanceOf(Response)
    expect(astro.response.headers.getSetCookie().some((c) => c.startsWith('cmp.session_token='))).toBe(true)
    const rows = await asRole('migrate', async (c) => (await c.query<{ expires_at: Date }>(`select s.expires_at from auth_session s join auth_user u on u.id = s.user_id where u.email = $1`, [email])).rows)
    expect(rows[0]?.expires_at.getTime()).toBeGreaterThan(Date.now() + 6.9 * 24 * 60 * 60 * 1000)
  })
})

describe('the session cookie on an https origin', () => {
  test('is __Secure- prefixed, Secure, HttpOnly, SameSite=Lax, for the whole site', async () => {
    const email = await verifiedUser('https')
    const httpsOrigin = 'https://cmp.example.test'
    const browser = new Browser(nextIp(), undefined, createAuth(httpsOrigin), httpsOrigin)
    expect((await browser.call('/sign-in/email', { email, password: PASSWORD })).status).toBe(200)
    const cookie = browser.lastSetCookies.find((c) => c.startsWith('__Secure-cmp.session_token='))
    expect(cookie).toBeDefined()
    const attrs = (cookie ?? '').split(';').slice(1).map((a) => a.trim().toLowerCase())
    expect(attrs).toEqual(expect.arrayContaining(['secure', 'httponly', 'samesite=lax', 'path=/']))
    expect(browser.lastSetCookies.some((c) => c.startsWith('cmp.session_token='))).toBe(false)
  })
})

describe('clean-up of expired identity rows (client addresses are personal data)', () => {
  test('the worker schedules auth.cleanup; a run deletes expired sessions and challenges and finished rate-limit windows only', async () => {
    const user = await asRole('migrate', async (c) => (await c.query<{ id: string }>(`insert into auth_user (name, email) values ('Old', $1) returning id`, [address('cleanup')])).rows[0]?.id ?? '')
    const now = Date.now()
    await asRole('migrate', async (c) => {
      await c.query(`insert into auth_session (token, user_id, expires_at, ip_address) values ($2, $1, now() - interval '1 minute', '203.0.113.9'), ($3, $1, now() + interval '1 day', '203.0.113.9')`, [user, `expired-${user}`, `live-${user}`])
      await c.query(`insert into auth_verification (identifier, value, expires_at) values ($1, 'x', now() - interval '1 minute'), ($2, 'x', now() + interval '1 hour')`, [`expired-${user}`, `live-${user}`])
      await c.query(`insert into auth_rate_limit (key, count, last_request) values ($1, 1, $2), ($3, 1, $4)`, [`old-${user}`, now - 2 * 60 * 60 * 1000, `recent-${user}`, now - 60 * 1000])
    })
    const remaining = async () =>
      asRole('migrate', async (c) =>
        (await c.query<{ k: string }>(
          `select token as k from auth_session where user_id = $1
           union all select identifier from auth_verification where identifier like '%' || $1
           union all select key from auth_rate_limit where key like '%' || $1 order by 1`,
          [user],
        )).rows.map((r) => r.k),
      )

    const worker = await startWorker({ transport: { sendMail: async () => ({}) }, log: captureLog().log, pollingIntervalSeconds: 1 })
    try {
      const schedules = await asRole('migrate', async (c) => (await c.query<{ name: string; cron: string }>(`select name, cron from pgboss.schedule where name = 'auth.cleanup'`)).rows)
      expect(schedules).toEqual([{ name: 'auth.cleanup', cron: '*/15 * * * *' }])
      await enqueue('auth.cleanup', {})
      const deadline = Date.now() + 20_000
      while ((await remaining()).length > 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200))
      expect(await remaining()).toEqual([`live-${user}`, `live-${user}`, `recent-${user}`])
    } finally {
      await worker.stop()
    }
  })
})
