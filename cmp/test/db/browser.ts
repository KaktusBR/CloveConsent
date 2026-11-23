// One simulated browser against Better Auth's request handler (what /api/auth/* runs), and the sign-up
// steps the database tests share. Have I Been Pwned is answered by a local stand-in (pwnedStandIn).
import { createHash, randomInt } from 'node:crypto'
import { expect, vi } from 'vitest'
import { auth, type AuthInstance } from '../../src/server/auth/auth'
import { handleAuth } from '../../src/server/auth/handler'
import { asRole, newId } from './raw'

export const ORIGIN = 'http://localhost:4321' // PUBLIC_ORIGIN of vitest.db.config.ts
export const PASSWORD = 'correct horse battery staple 42'
/** In the stand-in's breach corpus. */
export const BREACHED = 'password1234567'

/** Have I Been Pwned's range API, knowing one breached password. */
export function pwnedStandIn() {
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

// Each test file loads this module afresh (and every file shares one database for the run), so each
// starts its addresses at a random place: one file's rate-limit windows never meet another's.
let ipCounter = randomInt(0, 0xffffff - 0x10000)
let networkCounter = randomInt(0, 0xf000)
/**
 * A distinct socket address per browser (what the node adapter reports as the peer), so the rate-limit
 * windows of one test never touch another's. Distinct clients, not a rotated header.
 */
export const nextIp = () => {
  const n = ++ipCounter
  return `10.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`
}
/** A fresh number (up to 0xffff), for a test's own IPv6 network. */
export const nextNetwork = (): number => ++networkCounter
/** TRUSTED_PROXIES of vitest.db.config.ts. */
export const PROXY = '192.0.2.10'

/** One browser: its cookies, its address. Requests carry this site's Origin, as browsers do. */
export class Browser {
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
    return { status: response.status, location: response.headers.get('location'), json: text && response.headers.get('content-type')?.includes('json') ? (JSON.parse(text) as Record<string, unknown>) : null }
  }

  lastSetCookies: string[] = []

  hasSession(): boolean {
    return [...this.cookies.keys()].some((k) => k.endsWith('.session_token'))
  }
}

export const address = (label: string) => `${label}-${newId()}@example.test`

/** The mail jobs queued for `to`, oldest first, read as the owner. */
export async function mailsTo(to: string) {
  return asRole('migrate', async (c) =>
    (await c.query<{ data: { template: string; locale: string; data: Record<string, string> } }>(
      `select data from pgboss.job where name = 'mail.send' and data->>'to' = $1 order by created_on, id`,
      [to],
    )).rows.map((r) => r.data),
  )
}

export async function signUp(email: string, password = PASSWORD) {
  return new Browser().call('/sign-up/email', { name: 'Test Person', email, password })
}

/** Signs up and opens the emailed link. */
export async function verifiedUser(label: string): Promise<string> {
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

export async function signedIn(email: string): Promise<Browser> {
  const browser = new Browser()
  const result = await browser.call('/sign-in/email', { email, password: PASSWORD })
  expect(result.status).toBe(200)
  return browser
}
