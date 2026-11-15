import { expect, test } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'

// The built server as deployed without a proxy (TRUSTED_PROXIES empty): the rate limits count the TCP
// peer, read by the node adapter patch (astro.config.mjs), never a header the client sends. The main e2e
// server trusts this machine as its proxy, so this runs its own.
const PORT = 4396
const origin = `http://localhost:${PORT}`
let server: ChildProcess

test.beforeAll(async () => {
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

test('without trusted proxies, a client-sent X-Forwarded-For or x-cmp-client-address does not change the rate-limit bucket', async () => {
  const statuses: number[] = []
  for (let i = 1; i <= 6; i++) {
    const response = await fetch(`${origin}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        // a new forged address on every request
        'X-Forwarded-For': `203.0.113.${i}`,
        'X-Cmp-Client-Address': `198.51.100.${i}`,
      },
      body: JSON.stringify({ email: `e2e-peer-${randomUUID()}@example.test`, password: 'wrong password 123' }),
    })
    statuses.push(response.status)
  }
  // every request is counted for this machine: the sixth at the latest is refused (earlier when an
  // earlier run of this test is less than a minute ago); never refused as an unknown address (400)
  expect(statuses).not.toContain(400)
  expect(statuses.slice(0, statuses.indexOf(429) === -1 ? 6 : statuses.indexOf(429)).every((s) => s === 401)).toBe(true)
  expect(statuses[5]).toBe(429)
})
