import { eq, sql } from 'drizzle-orm'
import { afterAll, describe, expect, test } from 'vitest'
import { audit } from '../../src/server/data/audit'
import { authDatabase } from '../../src/server/data/auth-database'
import { closeDatabases } from '../../src/server/data/client'
import { auditLog } from '../../src/server/data/schema'
import { asSystem, withAccount, type AccountScope, type SystemTx, type TenantTx } from '../../src/server/data/scope'
import { newId } from './raw'

const scopeOf = (accountId: string): AccountScope => ({ accountId, userId: newId(), role: 'owner' })

afterAll(closeDatabases)

describe('withAccount', () => {
  test("a query through account A's scope never returns account B's rows", async () => {
    const a = scopeOf(newId())
    const b = scopeOf(newId())
    await withAccount(a, (tx) => audit(tx, { action: 'probe.a', actorUserId: a.userId, accountId: a.accountId }))
    await withAccount(b, (tx) => audit(tx, { action: 'probe.b', actorUserId: b.userId, accountId: b.accountId }))

    const seenByA = await withAccount(a, (tx) => tx.select().from(auditLog))
    expect(seenByA.map((r) => r.action)).toEqual(['probe.a'])
    // asking for B's rows by id, from A's scope, finds nothing
    const bById = await withAccount(a, (tx) => tx.select().from(auditLog).where(eq(auditLog.accountId, b.accountId)))
    expect(bById).toEqual([])
  })

  test("writing a row for account B from account A's scope is refused and nothing is written", async () => {
    const a = scopeOf(newId())
    const b = scopeOf(newId())
    const refused = await withAccount(a, (tx) => audit(tx, { action: 'probe.cross', actorUserId: a.userId, accountId: b.accountId })).then(
      () => null,
      (err: { code?: string; cause?: { code?: string; message?: string } }) => ({ code: err.cause?.code ?? err.code, message: err.cause?.message }),
    )
    expect(refused).toEqual({ code: '42501', message: expect.stringMatching(/row-level security policy/) })
    expect(await withAccount(b, (tx) => tx.select().from(auditLog))).toEqual([])
  })

  test('the account setting lives only for the transaction: the next query on the pool sees no tenant rows', async () => {
    const a = scopeOf(newId())
    await withAccount(a, (tx) => audit(tx, { action: 'probe.local', actorUserId: a.userId, accountId: a.accountId }))
    // authDatabase shares the app pool, so this reuses the connection withAccount just released
    const { rows: [row] } = await authDatabase.execute<{ setting: string | null; n: number }>(
      sql`select current_setting('app.account_id', true) as setting, (select count(*)::int from audit_log) as n`,
    )
    expect(row?.setting ?? '').toBe('')
    expect(row?.n).toBe(0)
  })

  test('everything in the callback is one transaction: a throw rolls back its writes', async () => {
    const a = scopeOf(newId())
    await expect(
      withAccount(a, async (tx) => {
        await audit(tx, { action: 'probe.rollback', actorUserId: a.userId, accountId: a.accountId })
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')
    expect(await withAccount(a, (tx) => tx.select().from(auditLog))).toEqual([])
  })

  test('an account id that is not a uuid is refused before any query', async () => {
    let ran = false
    for (const accountId of ['', 'not-a-uuid', "x' or '1'='1", `${newId()} `]) {
      await expect(withAccount({ ...scopeOf(newId()), accountId }, async () => { ran = true })).rejects.toThrow(/account id/i)
    }
    expect(ran).toBe(false)
  })
})

describe('a transaction handle used after its scope ended', () => {
  test('throws a clear error before touching the connection', async () => {
    const a = scopeOf(newId())
    let tenant: TenantTx | undefined
    let system: SystemTx | undefined
    await withAccount(a, async (tx) => { tenant = tx })
    await asSystem('test: leak the handle', async (tx) => { system = tx })
    expect(() => tenant!.select().from(auditLog)).toThrow(/transaction.*(ended|over)/i)
    expect(() => system!.select().from(auditLog)).toThrow(/transaction.*(ended|over)/i)
    await expect(audit(tenant!, { action: 'probe.late', actorUserId: null, accountId: a.accountId })).rejects.toThrow(/transaction.*(ended|over)/i)
  })

  test('works normally while the scope is open, also inside nested helpers', async () => {
    const a = scopeOf(newId())
    const rows = await withAccount(a, async (tx) => {
      await audit(tx, { action: 'probe.live', actorUserId: a.userId, accountId: a.accountId })
      return tx.select().from(auditLog)
    })
    expect(rows.map((r) => r.action)).toEqual(['probe.live'])
  })
})

describe('asSystem', () => {
  test('sees every account, and records the access with its reason in the audit log', async () => {
    const a = scopeOf(newId())
    const b = scopeOf(newId())
    await withAccount(a, (tx) => audit(tx, { action: 'probe.sys', actorUserId: a.userId, accountId: a.accountId }))
    await withAccount(b, (tx) => audit(tx, { action: 'probe.sys', actorUserId: b.userId, accountId: b.accountId }))

    const reason = `test ${newId()}`
    const accounts = await asSystem(reason, async (tx) => {
      const rows = await tx.select().from(auditLog).where(eq(auditLog.action, 'probe.sys'))
      return rows.map((r) => r.accountId)
    })
    expect(accounts).toEqual(expect.arrayContaining([a.accountId, b.accountId]))

    const recorded = await asSystem('test: read the access record', (tx) =>
      tx.select().from(auditLog).where(sql`${auditLog.action} = 'system.access' and ${auditLog.meta}->>'reason' = ${reason}`),
    )
    expect(recorded).toHaveLength(1)
    expect(recorded[0]).toMatchObject({ accountId: null, actorUserId: null })
  })

  test('the access is recorded even when the work fails', async () => {
    const reason = `failing ${newId()}`
    await expect(asSystem(reason, async () => { throw new Error('boom') })).rejects.toThrow('boom')
    const recorded = await asSystem('test: read the access record', (tx) =>
      tx.select().from(auditLog).where(sql`${auditLog.meta}->>'reason' = ${reason}`),
    )
    expect(recorded).toHaveLength(1)
  })

  test('a blank reason is refused before any query', async () => {
    let ran = false
    for (const reason of ['', '   ']) {
      await expect(asSystem(reason, async () => { ran = true })).rejects.toThrow(/reason/i)
    }
    expect(ran).toBe(false)
  })
})
