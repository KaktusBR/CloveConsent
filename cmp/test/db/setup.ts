// Global setup of `npm run test:db`: a fresh database per run, with the roles, migrated from scratch.
//
// The admin connection (DATABASE_URL_ADMIN, a role allowed to create roles and databases) defaults to the
// compose.yaml superuser. The three role URLs come from the environment when set (CI), else from the
// local defaults of .env.example and .env.db.example; only their database name is replaced by this run's.
import { randomBytes } from 'node:crypto'
import pg from 'pg'
import type { TestProject } from 'vitest/node'
import { initDatabase, type RoleUrls } from '../../scripts/db-init.ts'
import { migrateDatabase } from '../../scripts/migrate.ts'

const LOCAL = {
  admin: 'postgres://postgres:postgres@localhost:5432/postgres',
  app: 'postgres://cmp_app:cmp_app@localhost:5432/cmp',
  migrate: 'postgres://cmp_owner:cmp_owner@localhost:5432/cmp',
  system: 'postgres://cmp_system:cmp_system@localhost:5432/cmp',
  backup: 'postgres://cmp_backup:cmp_backup@localhost:5432/cmp',
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrls: RoleUrls
    /** The admin connection on this run's database: for tests that must change the schema (then roll back). */
    databaseAdminUrl: string
  }
}

function onDatabase(url: string, database: string): string {
  const u = new URL(url)
  u.pathname = `/${database}`
  return u.href
}

export default async function setup(project: TestProject) {
  const admin = process.env.DATABASE_URL_ADMIN || LOCAL.admin
  const database = `cmp_test_${randomBytes(6).toString('hex')}`
  const urls: RoleUrls = {
    app: onDatabase(process.env.DATABASE_URL || LOCAL.app, database),
    migrate: onDatabase(process.env.DATABASE_URL_MIGRATE || LOCAL.migrate, database),
    system: onDatabase(process.env.DATABASE_URL_SYSTEM || LOCAL.system, database),
    backup: onDatabase(process.env.DATABASE_URL_BACKUP || LOCAL.backup, database),
  }
  await initDatabase(admin, urls)
  await migrateDatabase(urls.migrate)
  project.provide('databaseUrls', urls)
  project.provide('databaseAdminUrl', onDatabase(admin, database))

  return async () => {
    const client = new pg.Client({ connectionString: admin })
    await client.connect()
    try {
      await client.query(`drop database if exists ${client.escapeIdentifier(database)} with (force)`)
    } finally {
      await client.end()
    }
  }
}
