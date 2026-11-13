import { expect, test } from '@playwright/test'
import { spawnSync } from 'node:child_process'
import { renameSync } from 'node:fs'

// Runs the built entry points (the webServer step builds them) with an invalid environment.
const LEAK = 'short-secret-leak'

function boot(entry: string) {
  const env: Record<string, string> = { PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '', PORT: '4397', BETTER_AUTH_SECRET: LEAK }
  return spawnSync(process.execPath, [entry], { env, encoding: 'utf8', timeout: 15_000 })
}

for (const entry of ['dist/server/entry.mjs', 'dist/worker.js']) {
  test(`${entry} refuses to start with an invalid environment, naming variables but not values`, () => {
    const run = boot(entry)
    expect(run.error).toBeUndefined() // not killed by the timeout: it exited on its own
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('BETTER_AUTH_SECRET')
    expect(run.stderr).toContain('DATABASE_URL')
    expect(run.stderr).not.toContain(LEAK)
    expect(run.stdout).not.toContain('listening')
  })
}

// The adapter reads the prerendered pages' CSP from _headers.json, by the build's absolute path.
// Without it every prerendered page would get the baseline CSP (its scripts blocked): refuse to start.
test('the server refuses to start when the prerendered pages have no CSP (_headers.json missing)', () => {
  const file = 'dist/_headers.json'
  const aside = `${file}.boot-test`
  renameSync(file, aside)
  try {
    const database = 'postgres://cmp:cmp@localhost:5432/cmp'
    const env: Record<string, string> = {
      PATH: process.env.PATH ?? '',
      SystemRoot: process.env.SystemRoot ?? '',
      PORT: '4398',
      NODE_ENV: 'test',
      PUBLIC_ORIGIN: 'http://localhost:4398',
      DATABASE_URL: database,
      DATABASE_URL_SYSTEM: database,
      BETTER_AUTH_SECRET: 'e2e-only-secret-e2e-only-secret-0000',
      SMTP_URL: 'smtp://localhost:1025',
      MAIL_FROM: 'noreply@localhost.test',
    }
    const run = spawnSync(process.execPath, ['dist/server/entry.mjs'], { env, encoding: 'utf8', timeout: 15_000 })
    expect(run.error).toBeUndefined() // not killed by the timeout: it exited on its own
    expect(run.status).toBe(1)
    expect(run.stderr).toContain('No CSP for the prerendered pages')
    expect(run.stdout).not.toContain('listening')
  } finally {
    renameSync(aside, file)
  }
})
