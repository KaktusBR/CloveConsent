// Every query on tenant data runs inside withAccount: one transaction on the app role with
// `app.account_id` set for that transaction only, so the row-level security policies show and accept
// only that account's rows. asSystem is the audited way around it, for super-admin and worker code.
import { sql } from 'drizzle-orm'
import { appendAuditEvent } from './audit'
import { appDatabase, systemDatabase, type Transaction } from './client'

export type Role = 'owner' | 'admin' | 'editor' | 'viewer'

export interface AccountScope {
  readonly accountId: string
  readonly userId: string
  readonly role: Role
}

declare const tenantBrand: unique symbol
declare const systemBrand: unique symbol
/** A transaction scoped to one account (app role, row-level security applies). */
export type TenantTx = Transaction & { readonly [tenantBrand]: true }
/** A transaction on the system role: sees what cmp_system's policies allow, across accounts. */
export type SystemTx = Transaction & { readonly [systemBrand]: true }

/**
 * The handle given to a callback. What is guaranteed once the callback has returned:
 * - the handle itself throws on any use (this Proxy), with a message naming withAccount/asSystem;
 * - work created from it inside the callback and run afterwards (a query builder, `tx.query.*`, a nested
 *   transaction handle) holds the checked-out client, which pool.ts makes throw once released. So it
 *   never runs without the account setting, nor inside another request's transaction on the same
 *   connection (test/db/scope.test.ts reproduces both).
 * - a query started inside the callback but not awaited either reaches the client before the release (and
 *   runs in this transaction, with this account) or after it (and throws). Await everything: which of the
 *   two happens is not defined.
 */
async function runScoped<T, H>(tx: Transaction, label: string, fn: (handle: H) => Promise<T>): Promise<T> {
  let open = true
  const handle = new Proxy(tx, {
    get(target, prop) {
      if (!open) throw new Error(`${label}: the transaction has ended; use its handle only inside the callback`)
      const value: unknown = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  try {
    return await fn(handle as H)
  } finally {
    open = false
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Run `fn` in one transaction that sees and writes only `scope.accountId`'s tenant rows. */
export async function withAccount<T>(scope: AccountScope, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  if (!UUID.test(scope.accountId)) throw new TypeError('withAccount: the account id must be a uuid')
  return appDatabase.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.account_id', ${scope.accountId}, true)`)
    return runScoped(tx, 'withAccount', fn)
  })
}

/**
 * Run `fn` in one transaction on the system role. Super-admin and worker code only. The access is
 * written to the audit log with its reason before `fn` runs, in its own statement, so it stays recorded
 * even when `fn` fails.
 */
export async function asSystem<T>(reason: string, fn: (tx: SystemTx) => Promise<T>): Promise<T> {
  if (reason.trim() === '') throw new TypeError('asSystem: a reason is required')
  await appendAuditEvent(systemDatabase, { action: 'system.access', meta: { reason: reason.trim() }, actorUserId: null, accountId: null })
  return systemDatabase.transaction((tx) => runScoped(tx, 'asSystem', fn))
}
