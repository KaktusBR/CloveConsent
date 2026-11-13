// The database roles and the tenant rule every tenant table follows.
//
// Roles (created by scripts/db-init.ts, never by a migration):
//   cmp_owner  runs the migrations and owns every table. It has no policy anywhere, and FORCE ROW LEVEL
//              SECURITY applies to it too, so it reads and writes no tenant rows.
//   cmp_app    the app at runtime (DATABASE_URL). Sees and writes only the rows of the account set by
//              withAccount, through the policies below. Not a member of the other roles.
//   cmp_system audited system work (asSystem: super-admin, worker; DATABASE_URL_SYSTEM). Gets only the
//              policies and grants a table declares for it, each one documented on that table.
//
// A tenant table has `account_id uuid not null`, row-level security enabled AND forced (the migration
// adds FORCE, which drizzle-kit does not emit), explicit grants, and policies for cmp_app built from
// `isCurrentAccount`. test/db/rls.test.ts checks every table in the catalog against this.
import { sql, type SQL } from 'drizzle-orm'
import { pgRole, type AnyPgColumn } from 'drizzle-orm/pg-core'

export const appRole = pgRole('cmp_app').existing()
export const systemRole = pgRole('cmp_system').existing()

/**
 * `account_id = current_setting('app.account_id', true)::uuid`, with the setting read through nullif:
 * after a transaction that set it ends, the same pooled connection reads '' (not null), and ''::uuid
 * would make every later query fail instead of matching nothing.
 */
export const isCurrentAccount = (accountId: AnyPgColumn): SQL =>
  sql`${accountId} = nullif(current_setting('app.account_id', true), '')::uuid`
