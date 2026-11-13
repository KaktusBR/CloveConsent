// Raw connections as one of the three roles, bypassing the data layer: what a bug or a forgotten
// scope would see.
import { randomUUID } from 'node:crypto'
import pg from 'pg'
import { inject } from 'vitest'

export type RoleName = 'app' | 'migrate' | 'system'

/** Run `fn` on a fresh connection as the given role, then close it. */
export async function asRole<T>(role: RoleName, fn: (client: pg.Client) => Promise<T>): Promise<T> {
  const client = new pg.Client({ connectionString: inject('databaseUrls')[role] })
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
