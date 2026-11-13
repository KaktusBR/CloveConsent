import { defineConfig, devices } from '@playwright/test'

const PORT = 4329
const origin = `http://localhost:${PORT}`
// the roles of .env.example, created by `npm run db:init`
const database = process.env.DATABASE_URL ?? 'postgres://cmp_app:cmp_app@localhost:5432/cmp'

// The built server, as in production, with a local-only environment (compose.yaml or the CI services).
export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: { baseURL: origin, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run build && node dist/server/entry.mjs',
    url: `${origin}/healthz`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      PORT: String(PORT),
      NODE_ENV: 'test',
      PUBLIC_ORIGIN: origin,
      DATABASE_URL: database,
      DATABASE_URL_MIGRATE: process.env.DATABASE_URL_MIGRATE ?? 'postgres://cmp_owner:cmp_owner@localhost:5432/cmp',
      DATABASE_URL_SYSTEM: process.env.DATABASE_URL_SYSTEM ?? 'postgres://cmp_system:cmp_system@localhost:5432/cmp',
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? 'e2e-only-secret-e2e-only-secret-0000',
      SMTP_URL: process.env.SMTP_URL ?? 'smtp://localhost:1025',
      MAIL_FROM: process.env.MAIL_FROM ?? 'noreply@localhost.test',
    },
  },
})
