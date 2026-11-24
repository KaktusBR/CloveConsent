// Raw connections as one of the three roles, bypassing the data layer: what a bug or a forgotten
// scope would see.
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { inject } from 'vitest'

export type RoleName = 'app' | 'migrate' | 'system' | 'backup' | 'admin'

/** Run `fn` on a fresh connection as the given role, then close it. */
export async function asRole<T>(role: RoleName, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const url = role === 'admin' ? inject('databaseAdminUrl') : inject('databaseUrls')[role]
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/** A Postgres error code from a rejected query, or null when it did not fail. */
export async function errorCode(query: Promise<unknown>): Promise<string | null> {
  try {
    await query
    return null
  } catch (err) {
    return (err as { code?: string }).code ?? 'unknown'
  }
}

export const newId = (): string => randomUUID()

/**
 * Adds a new, empty account (`id`, else a fresh one) and returns its id (a row in auth_account, written as the owner role): audit_log.account_id
 * references it, so a test's account ids must exist.
 */
export async function addAccount(id: string = randomUUID()): Promise<string> {
  await asRole('migrate', (c) => c.query(`insert into auth_account (id, name, slug) values ($1, 'test account', $2)`, [id, id]))
  return id
}
