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
