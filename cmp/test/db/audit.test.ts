import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { audit } from '../../src/server/data/audit'
import { closeDatabases } from '../../src/server/data/client'
import { auditLog } from '../../src/server/data/schema'
import { withAccount, type AccountScope } from '../../src/server/data/scope'
import { asRole, errorCode, newId } from './raw'

const scope: AccountScope = { accountId: newId(), userId: newId(), role: 'admin' }

afterAll(closeDatabases)

describe('audit', () => {
  test('writes actor, account, action, target, meta and a creation time', async () => {
    const before = Date.now()
    const rows = await withAccount(scope, async (tx) => {
      await audit(tx, { action: 'member.invite', target: 'invitation:42', meta: { role: 'editor' }, actorUserId: scope.userId, accountId: scope.accountId })
      return tx.select().from(auditLog)
    })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      actorUserId: scope.userId,
      accountId: scope.accountId,
      action: 'member.invite',
      target: 'invitation:42',
      meta: { role: 'editor' },
    })
    expect(rows[0]!.createdAt.getTime()).toBeGreaterThanOrEqual(before - 5_000)
  })

  test.each([
    { password: 'hunter2' },
    { token: 'abc' },
    { secret: 'abc' },
    { Password: 'x' },
    { accessToken: 'x' },
    { clientSecret: 'x' },
    { nested: { deeper: [{ token: 'x' }] } },
  ])('refuses meta %j and writes nothing', async (meta) => {
    const s: AccountScope = { ...scope, accountId: newId() }
    await expect(withAccount(s, (tx) => audit(tx, { action: 'probe.meta', meta, actorUserId: s.userId, accountId: s.accountId }))).rejects.toThrow(/meta/i)
    expect(await withAccount(s, (tx) => tx.select().from(auditLog))).toEqual([])
  })

  test('refuses an action that is not a short dotted name', async () => {
    for (const action of ['', 'Has Spaces', 'x'.repeat(101)]) {
      await expect(withAccount(scope, (tx) => audit(tx, { action, actorUserId: null, accountId: scope.accountId }))).rejects.toThrow(/action/i)
    }
  })
})

describe('audit_log is append-only', () => {
  beforeAll(async () => {
    await withAccount(scope, (tx) => audit(tx, { action: 'probe.append', actorUserId: scope.userId, accountId: scope.accountId }))
  })

  test.each(['app', 'system'] as const)('as the %s role, UPDATE, DELETE and TRUNCATE are refused', async (role) => {
    const codes = await asRole(role, async (c) => {
      await c.query('begin')
      await c.query(`select set_config('app.account_id', $1, true)`, [scope.accountId])
      const attempts = [
        `update audit_log set action = 'tampered'`,
        'delete from audit_log',
        'truncate audit_log',
      ]
      const out: (string | null)[] = []
      for (const q of attempts) {
        await c.query('savepoint s')
        out.push(await errorCode(c.query(q)))
        await c.query('rollback to savepoint s')
      }
      await c.query('rollback')
      return out
    })
    expect(codes).toEqual(['42501', '42501', '42501']) // insufficient_privilege
  })
})
