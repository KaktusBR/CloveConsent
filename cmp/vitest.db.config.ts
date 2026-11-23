import { defineConfig } from 'vitest/config'

// Database tests against a real Postgres (compose.yaml locally, the service container in CI).
// test/db/setup.ts creates the roles and a fresh database, applies the migrations, and drops it at the end;
// test/db/env.ts points each test file at that database before anything imports src/server/env.ts.
const otherEnv = {
  BETTER_AUTH_SECRET: 'db-test-secret-db-test-secret-000000',
  PUBLIC_ORIGIN: 'http://localhost:4321',
  SMTP_URL: 'smtp://localhost:1025',
  MAIL_FROM: 'noreply@localhost.test',
  NODE_ENV: 'test',
  // the address the db tests' "proxy" requests come from (test/db/auth.test.ts)
  TRUSTED_PROXIES: '192.0.2.10',
  // the super-admins of test/db/entitlements.test.ts (each signs up once per run)
  SUPER_ADMIN_EMAILS: 'root-a@admin.test,root-b@admin.test,root-c@admin.test,root-d@admin.test,root-e@admin.test,root-limit@admin.test,Root-No2fa@admin.test,root-unverified@admin.test',
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/db/**/*.test.ts'],
    globalSetup: ['test/db/setup.ts'],
    setupFiles: ['test/db/env.ts'],
    env: otherEnv,
    fileParallelism: false,
    hookTimeout: 60_000,
  },
})
