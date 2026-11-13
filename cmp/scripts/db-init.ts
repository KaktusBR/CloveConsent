/**
 * Creates the app's database roles and its database, once per Postgres server (idempotent: re-running
 * re-applies the role attributes and passwords). Migrations then run as the owner (scripts/migrate.ts).
 *
 *   DATABASE_URL_ADMIN=postgres://<admin>@host/postgres npm run db:init
 *
 * DATABASE_URL_ADMIN is a role allowed to create roles and databases (the server's superuser locally);
 * it is used by this script only, never by the app. The roles' names, passwords and the database name
 * come from the app's three URLs, which must name these roles:
 *
 *   DATABASE_URL         cmp_app     runtime; row-level security applies
 *   DATABASE_URL_MIGRATE cmp_owner   migrations; owns the database and every table
 *   DATABASE_URL_SYSTEM  cmp_system  audited system work
 *
 * Each role: LOGIN, NOSUPERUSER, NOCREATEDB, NOCREATEROLE, NOBYPASSRLS, NOINHERIT, and member of no
 * other. Only the owner and the two runtime roles may connect to the database.
 * Errors name the variable, never a value from it.
 */
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import pg from 'pg'

export interface RoleUrls {
  app: string
  migrate: string
  system: string
}

const ROLE_OF: Record<keyof RoleUrls, { role: string; variable: string }> = {
  app: { role: 'cmp_app', variable: 'DATABASE_URL' },
  migrate: { role: 'cmp_owner', variable: 'DATABASE_URL_MIGRATE' },
  system: { role: 'cmp_system', variable: 'DATABASE_URL_SYSTEM' },
}

function parse(value: string | undefined, variable: string): URL {
  let url: URL | null
  try {
    url = value ? new URL(value) : null
  } catch {
    url = null
  }
  if (!url || !['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error(`${variable} must be a postgres:// URL`)
  return url
}

export async function initDatabase(adminUrl: string, urls: RoleUrls): Promise<void> {
  parse(adminUrl, 'DATABASE_URL_ADMIN')
  const parsed = Object.fromEntries(
    (Object.keys(ROLE_OF) as (keyof RoleUrls)[]).map((k) => [k, parse(urls[k], ROLE_OF[k].variable)]),
  ) as Record<keyof RoleUrls, URL>
  for (const k of Object.keys(ROLE_OF) as (keyof RoleUrls)[]) {
    const { role, variable } = ROLE_OF[k]
    if (decodeURIComponent(parsed[k].username) !== role) throw new Error(`${variable} must connect as the role ${role}`)
    if (!parsed[k].password) throw new Error(`${variable} must include the password of ${role}`)
  }
  const database = decodeURIComponent(parsed.migrate.pathname.slice(1))
  if (!database) throw new Error('DATABASE_URL_MIGRATE must name a database')
  for (const k of ['app', 'system'] as const) {
    if (decodeURIComponent(parsed[k].pathname.slice(1)) !== database) throw new Error(`${ROLE_OF[k].variable} must name the same database as DATABASE_URL_MIGRATE`)
  }

  const admin = new pg.Client({ connectionString: adminUrl, application_name: 'cmp-db-init' })
  await admin.connect()
  try {
    const id = (name: string) => admin.escapeIdentifier(name)
    for (const k of Object.keys(ROLE_OF) as (keyof RoleUrls)[]) {
      const role = ROLE_OF[k].role
      const password = admin.escapeLiteral(decodeURIComponent(parsed[k].password))
      const exists = (await admin.query('select 1 from pg_roles where rolname = $1', [role])).rowCount === 1
      const attributes = 'LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT'
      await admin.query(`${exists ? 'ALTER' : 'CREATE'} ROLE ${id(role)} WITH ${attributes} PASSWORD ${password}`)
    }
    // no role of the app is a member of another (the app role cannot SET ROLE to the system role)
    const memberships = await admin.query<{ role: string; member: string }>(
      `select r.rolname as role, m.rolname as member from pg_auth_members am
       join pg_roles r on r.oid = am.roleid join pg_roles m on m.oid = am.member
       where r.rolname = any($1) and m.rolname = any($1)`,
      [Object.values(ROLE_OF).map((r) => r.role)],
    )
    for (const { role, member } of memberships.rows) await admin.query(`REVOKE ${id(role)} FROM ${id(member)}`)

    const dbExists = (await admin.query('select 1 from pg_database where datname = $1', [database])).rowCount === 1
    if (!dbExists) await admin.query(`CREATE DATABASE ${id(database)} OWNER cmp_owner`)
    else await admin.query(`ALTER DATABASE ${id(database)} OWNER TO cmp_owner`)
    await admin.query(`REVOKE ALL ON DATABASE ${id(database)} FROM PUBLIC`)
    await admin.query(`GRANT CONNECT ON DATABASE ${id(database)} TO cmp_app, cmp_system`)
  } finally {
    await admin.end()
  }

  // inside the database: nobody but the owner creates objects in the public schema
  const adminOnDb = new URL(adminUrl)
  adminOnDb.pathname = `/${encodeURIComponent(database)}`
  const inDb = new pg.Client({ connectionString: adminOnDb.href, application_name: 'cmp-db-init' })
  await inDb.connect()
  try {
    await inDb.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC')
  } finally {
    await inDb.end()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await initDatabase(process.env.DATABASE_URL_ADMIN ?? '', {
      app: process.env.DATABASE_URL ?? '',
      migrate: process.env.DATABASE_URL_MIGRATE ?? '',
      system: process.env.DATABASE_URL_SYSTEM ?? '',
    })
    console.log('database roles and database ready')
  } catch (err) {
    // pg errors carry no connection string; ours name only the variable
    console.error(`db:init failed: ${(err as Error).message}`)
    process.exitCode = 1
  }
}
