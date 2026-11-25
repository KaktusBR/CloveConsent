// The clean-up job deletes rate-limit rows only once no window could still use them (ruling R27, M6): its
// retention is at least twice the longest window of any limit counted in auth_rate_limit.
import { describe, expect, test } from 'vitest'
import { ACCOUNT_CREATE_LIMIT } from '../../src/pages/api/accounts/create'
import { SIGN_IN_FAILURES } from '../../src/server/auth/auth'
import { ADMIN_LIMITS } from '../../src/server/auth/super-admin'
import { RATE_LIMIT_RETENTION_MS } from '../../src/server/data/auth-cleanup'

describe('auth.cleanup', () => {
  test('keeps a rate-limit row for twice the longest window', () => {
    const windows = [SIGN_IN_FAILURES.pair.window, SIGN_IN_FAILURES.account.window, ADMIN_LIMITS.change.window, ADMIN_LIMITS.impersonate.window, ACCOUNT_CREATE_LIMIT.window]
    expect(Math.max(...windows)).toBe(60 * 60)
    expect(RATE_LIMIT_RETENTION_MS).toBeGreaterThanOrEqual(2 * Math.max(...windows) * 1000)
  })
})
