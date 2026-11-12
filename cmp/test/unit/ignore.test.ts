import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'

// Environment files hold secrets: never committed, never sent to the image build. The example is the exception.
const SECRETS = ['.env', '.env.local', '.env.production', '.env.test.local']

describe('environment files', () => {
  test.each(SECRETS)('git ignores %s', (file) => {
    expect(spawnSync('git', ['check-ignore', '-q', file], { cwd: process.cwd() }).status).toBe(0)
  })

  test('git keeps .env.example', () => {
    expect(spawnSync('git', ['check-ignore', '-q', '.env.example'], { cwd: process.cwd() }).status).toBe(1)
  })

  test('the image build context leaves out every .env file but the example', () => {
    const lines = readFileSync('Dockerfile.dockerignore', 'utf8').split('\n').map((l) => l.trim())
    expect(lines).toContain('cmp/.env*')
    expect(lines.indexOf('!cmp/.env.example')).toBeGreaterThan(lines.indexOf('cmp/.env*'))
  })
})
