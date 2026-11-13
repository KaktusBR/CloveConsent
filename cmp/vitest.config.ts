import { defineConfig } from 'vitest/config'

// src/server/env.ts validates process.env on import: unit tests get a valid, local-only environment.
const testEnv = {
  DATABASE_URL: 'postgres://cmp_app:cmp_app@localhost:5432/cmp',
  DATABASE_URL_MIGRATE: 'postgres://cmp_owner:cmp_owner@localhost:5432/cmp',
  DATABASE_URL_SYSTEM: 'postgres://cmp_system:cmp_system@localhost:5432/cmp',
  BETTER_AUTH_SECRET: 'unit-test-secret-unit-test-secret-0000',
  PUBLIC_ORIGIN: 'http://localhost:4321',
  SMTP_URL: 'smtp://localhost:1025',
  MAIL_FROM: 'noreply@localhost.test',
  NODE_ENV: 'test',
}

export default defineConfig({ test: { environment: 'node', include: ['test/unit/**/*.test.ts'], env: testEnv } })
