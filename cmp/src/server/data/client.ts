// The only database client. Nothing outside src/server/data/ imports this file (lint rule
// cmp/data-layer-only): the rest of the app uses withAccount / asSystem (scope.ts) and the repositories.
//
// Two pools, two roles, never a role switch:
//   app     DATABASE_URL         cmp_app, row-level security applies (withAccount, authDatabase)
//   system  DATABASE_URL_SYSTEM  cmp_system, only the policies granted to it (asSystem)
// The owner role (DATABASE_URL_MIGRATE) is used by scripts/migrate.ts only and is not in the app's env.
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres'
import { env } from '../env'
import { log } from '../log'
import { GuardedPool } from './pool'
import * as schema from './schema'

export type Database = NodePgDatabase<typeof schema>
/** A transaction on either pool; scope.ts brands it as a TenantTx or a SystemTx. */
export type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

// Guarded pools: a client is unusable once its checkout is released (see pool.ts).
function pool(connectionString: string, name: string): GuardedPool {
  const p = new GuardedPool({ connectionString, application_name: name, max: 10, idleTimeoutMillis: 30_000 })
  // an idle connection dropped by the server must not crash the process
  p.on('error', (err) => log.warn({ error: err.message, pool: name }, 'database pool connection lost'))
  return p
}

const appPool = pool(env.DATABASE_URL, 'cmp-app')
const systemPool = pool(env.DATABASE_URL_SYSTEM, 'cmp-system')

export const appDatabase: Database = drizzle(appPool, { schema })
export const systemDatabase: Database = drizzle(systemPool, { schema })

/** Close both pools (shutdown, tests). */
export async function closeDatabases(): Promise<void> {
  await Promise.all([appPool.end(), systemPool.end()])
}
