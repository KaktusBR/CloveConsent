/**
 * Applies the SQL migrations in drizzle/ as the owner role, under an advisory lock (two migrate runs
 * never interleave).
 *
 *   npm run db:migrate                 (development, reads .env)
 *   node scripts/migrate.ts            (in the image: the one-shot migrate service, before app and worker)
 *
 * Reads only DATABASE_URL_MIGRATE, which must connect as cmp_owner: the app and system roles never run
 * migrations. Errors never include the URL.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import pg from 'pg'

const MIGRATIONS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle')
const OWNER = 'cmp_owner'
const LOCK = 'cmp:migrate'

export async function migrateDatabase(url: string): Promise<void> {
  const client = new pg.Client({ connectionString: url, application_name: 'cmp-migrate' })
  await client.connect()
  try {
    const { rows } = await client.query<{ user: string }>('select current_user as user')
    if (rows[0]?.user !== OWNER) throw new Error(`migrations run only as ${OWNER}`)
    await client.query('select pg_advisory_lock(hashtext($1))', [LOCK])
    try {
      await migrate(drizzle(client), { migrationsFolder: MIGRATIONS })
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', [LOCK])
    }
  } finally {
    await client.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const url = process.env.DATABASE_URL_MIGRATE ?? ''
  if (!/^postgres(ql)?:\/\//.test(url)) {
    console.error('db:migrate failed: DATABASE_URL_MIGRATE must be a postgres:// URL')
    process.exitCode = 1
  } else {
    try {
      await migrateDatabase(url)
      console.log('migrations applied')
    } catch (err) {
      console.error(`db:migrate failed: ${(err as Error).message}`)
      process.exitCode = 1
    }
  }
}
