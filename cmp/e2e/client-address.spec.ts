import { expect, test } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import pg from 'pg'

// The built server as deployed behind Traefik but without TRUSTED_PROXIES: every request carries
// Traefik's X-Forwarded-Host and X-Forwarded-Proto, which Astro honours (security.allowedDomains, so it
// rebuilds the Request), and the rate limits must still count the TCP peer, never a header the client
// sends. The main e2e server trusts this machine as its proxy, so this runs its own.
const PORT = 4396
const origin = `http://localhost:${PORT}`
let server: ChildProcess

/** What Traefik adds to every request it forwards. */
const FORWARDED = { 'X-Forwarded-Host': `localhost:${PORT}`, 'X-Forwarded-Proto': 'http' }

test.describe.configure({ mode: 'serial' })

const env: Record<string, string> = {
  PATH: process.env.PATH ?? '',
  SystemRoot: process.env.SystemRoot ?? '',
  PORT: String(PORT),
  NODE_ENV: 'test',
  PUBLIC_ORIGIN: origin,
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://cmp_app:cmp_app@localhost:5432/cmp',
  DATABASE_URL_SYSTEM: process.env.DATABASE_URL_SYSTEM ?? 'postgres://cmp_system:cmp_system@localhost:5432/cmp',
  BETTER_AUTH_SECRET: 'e2e-only-secret-e2e-only-secret-0000',
  SMTP_URL: 'smtp://localhost:1025',
  MAIL_FROM: 'noreply@localhost.test',
  TRUSTED_PROXIES: '',
}

test.beforeAll(async () => {
  server = spawn(process.execPath, ['--import', './e2e/pwned-stand-in.mjs', 'dist/server/entry.mjs'], { env, stdio: 'ignore' })
  const deadline = Date.now() + 20_000
  for (;;) {
    const up = await fetch(`${origin}/healthz`).then((r) => r.ok, () => false)
    if (up) break
    if (Date.now() > deadline) throw new Error('the server did not start')
    await new Promise((r) => setTimeout(r, 200))
  }
})

test.afterAll(() => {
  server.kill()
})

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(`${origin}/api/auth${path}`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json', ...FORWARDED, ...headers }, body: JSON.stringify(body) })

test('behind a forwarding proxy (Host rewritten from X-Forwarded-*), sign-up and sign-in work', async () => {
  const email = `e2e-proxied-${randomUUID()}@example.test`
  const password = `pw-${randomUUID()}`
  expect((await post('/sign-up/email', { name: 'E2E Person', email, password })).status).toBe(200)
  // the address confirmed directly (its mail would link to this server's origin, which the shared e2e
  // worker refuses to send: links must be on its own PUBLIC_ORIGIN)
  const db = new pg.Client({ connectionString: env.DATABASE_URL })
  await db.connect()
  try {
    await db.query('update auth_user set email_verified = true where email = $1', [email])
  } finally {
    await db.end()
  }
  const signedIn = await post('/sign-in/email', { email, password })
  expect(signedIn.status).toBe(200)
  expect(signedIn.headers.getSetCookie().some((c) => c.startsWith('cmp.session_token='))).toBe(true)
})

test('without trusted proxies, a forged X-Forwarded-For, x-cmp-client-address or x-cmp-socket-peer does not change the rate-limit bucket', async () => {
  const statuses: number[] = []
  for (let i = 1; i <= 6; i++) {
    const response = await post(
      '/sign-in/email',
      { email: `e2e-peer-${randomUUID()}@example.test`, password: 'wrong password 123' },
      // a new forged address on every request, in every header that could carry one
      { 'X-Forwarded-For': `203.0.113.${i}`, 'X-Cmp-Client-Address': `198.51.100.${i}`, 'X-Cmp-Socket-Peer': `192.0.2.${i}` },
    )
    statuses.push(response.status)
  }
  // every request is counted for this machine: the sixth at the latest is refused (earlier when the
  // previous test or run is less than a minute ago); never refused as an unknown address (400)
  expect(statuses).not.toContain(400)
  const first429 = statuses.indexOf(429)
  expect(statuses.slice(0, first429 === -1 ? 6 : first429).every((s) => s === 401)).toBe(true)
  expect(statuses[5]).toBe(429)
})
