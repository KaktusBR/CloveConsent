// Every query on tenant data runs inside withAccount: one transaction on the app role with
// `app.account_id` set for that transaction only, so the row-level security policies show and accept
// only that account's rows. asSystem is the audited way around it, for super-admin and worker code.
import { sql } from 'drizzle-orm'
import { auditLog } from './schema'
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Run `fn` in one transaction that sees and writes only `scope.accountId`'s tenant rows. */
export async function withAccount<T>(scope: AccountScope, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  if (!UUID.test(scope.accountId)) throw new TypeError('withAccount: the account id must be a uuid')
  return appDatabase.transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.account_id', ${scope.accountId}, true)`)
    return fn(tx as TenantTx)
  })
}

/**
 * Run `fn` in one transaction on the system role. Super-admin and worker code only. The access is
 * written to the audit log with its reason before `fn` runs, in its own statement, so it stays recorded
 * even when `fn` fails.
 */
export async function asSystem<T>(reason: string, fn: (tx: SystemTx) => Promise<T>): Promise<T> {
  if (reason.trim() === '') throw new TypeError('asSystem: a reason is required')
  await systemDatabase.insert(auditLog).values({ action: 'system.access', meta: { reason: reason.trim() } })
  return systemDatabase.transaction((tx) => fn(tx as SystemTx))
}
