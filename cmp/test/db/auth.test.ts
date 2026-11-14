// Sign-up, sign-in, verification, second factor and sessions against the real database, through Better
// Auth's request handler (what /api/auth/* runs) and the app's guard. Mail is read from the queue (the
// worker is not running here); Have I Been Pwned is answered by a local stand-in.
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { authErrorMessage } from '../../src/lib/auth-errors'
import { POST as revokeSession } from '../../src/pages/api/account/revoke-session'
import { auth } from '../../src/server/auth/auth'
import { completeSession } from '../../src/server/auth/guard'
import { closeDatabases } from '../../src/server/data/client'
import { closeQueue } from '../../src/server/data/queue'
import en from '../../messages/en.json'
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
/** A distinct client address per browser, so rate-limit windows of one test never touch another's. */
const nextIp = () => `198.51.100.${++ipCounter}`

/** One browser: its cookies, its address. Requests carry this site's Origin, as browsers do. */
class Browser {
  readonly cookies = new Map<string, string>()
  readonly ip = nextIp()

  headers(extra: Record<string, string> = {}): Headers {
    const h = new Headers({ origin: ORIGIN, 'x-forwarded-for': this.ip, 'user-agent': 'vitest', ...extra })
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
    const response = await auth.handler(new Request(`${ORIGIN}/api/auth${path}`, init))
    this.keep(response)
    const text = await response.text()
    return { status: response.status, location: response.headers.get('location'), json: text ? (JSON.parse(text) as Record<string, unknown>) : null }
  }

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
  vi.unstubAllGlobals()
  await closeQueue()
  await closeDatabases()
})

describe('sign-up and email verification', () => {
  test('the verification link is on the public origin, in the language of the page signed up from', async () => {
    const email = address('sk')
    const browser = new Browser()
    const init = { method: 'POST', headers: browser.headers({ 'content-type': 'application/json', referer: `${ORIGIN}/sk/sign-up` }) }
    const response = await auth.handler(new Request(`${ORIGIN}/api/auth/sign-up/email`, { ...init, body: JSON.stringify({ name: 'Osoba', email, password: PASSWORD }) }))
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

describe('rate limiting', () => {
  test('repeated failed sign-ins from one address are refused with 429, counted in the database', async () => {
    const email = await verifiedUser('limited')
    const browser = new Browser()
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) statuses.push((await browser.call('/sign-in/email', { email, password: 'wrong password 123' })).status)
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429])
    // the right password is refused too until the window ends
    expect((await browser.call('/sign-in/email', { email, password: PASSWORD })).status).toBe(429)
    // another address is not affected
    expect((await new Browser().call('/sign-in/email', { email, password: PASSWORD })).status).toBe(200)

    const rows = await asRole('migrate', async (c) => (await c.query<{ count: number }>(`select count from auth_rate_limit where key = $1`, [`${browser.ip}|/sign-in/email`])).rows)
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
