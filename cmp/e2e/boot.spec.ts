import { expect, test } from '@playwright/test'
import { spawnSync } from 'node:child_process'

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
