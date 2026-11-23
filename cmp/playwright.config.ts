import { defineConfig, devices } from '@playwright/test'

import { SUPER_ADMIN_EMAIL } from './e2e/super-admin'

const PORT = 4329
const origin = `http://localhost:${PORT}`
// the roles of .env.example, created by `npm run db:init`
const database = process.env.DATABASE_URL ?? 'postgres://cmp_app:cmp_app@localhost:5432/cmp'

/** A local-only environment (compose.yaml or the CI services), for the server and the worker. */
const serverEnv = {
  PORT: String(PORT),
  NODE_ENV: 'test',
  PUBLIC_ORIGIN: origin,
  DATABASE_URL: database,
  DATABASE_URL_SYSTEM: process.env.DATABASE_URL_SYSTEM ?? 'postgres://cmp_system:cmp_system@localhost:5432/cmp',
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'e2e-only-secret-e2e-only-secret-0000',
  SMTP_URL: process.env.SMTP_URL ?? 'smtp://localhost:1025',
  MAIL_FROM: process.env.MAIL_FROM ?? 'noreply@localhost.test',
  // the tests act as the reverse proxy: their X-Forwarded-For names a client per test (fresh rate-limit
  // windows), as Traefik does in production; the server trusts it only from this machine
  TRUSTED_PROXIES: '127.0.0.1,::1',
  // e2e/super-admin.spec.ts signs up as this address (freed from an earlier run first)
  SUPER_ADMIN_EMAILS: SUPER_ADMIN_EMAIL,
}

// The built server and worker, as in production.
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: origin, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Have I Been Pwned answered by a local stand-in: no live network call in a test
      command: 'npm run build && node --import ./e2e/pwned-stand-in.mjs dist/server/entry.mjs',
      url: `${origin}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      env: serverEnv,
    },
    // sends the queued mail to Mailpit, where e2e/auth.spec.ts reads it; started once the build above is done
    {
      command: 'node dist/worker.js',
      wait: { stdout: /worker started/ },
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: serverEnv,
    },
  ],
})
