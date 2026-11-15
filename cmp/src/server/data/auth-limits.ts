// Counting windows of our own beside Better Auth's rate limits (which count requests per client address):
// stored in the same table, auth_rate_limit, so they are shared by every app process and cleared by the
// same clean-up job. A window is fixed: it starts at its first event (last_request holds that start).
// Only src/server/auth/ uses this (identity data, ruling R2).
import { sql } from 'drizzle-orm'
import { appDatabase } from './client'

/** Count one event against `key` in its window of `windowSeconds`, atomically; returns the count in the window. */
export async function addToWindow(key: string, windowSeconds: number): Promise<number> {
  const now = Date.now()
  const windowStart = now - windowSeconds * 1000
  const result = await appDatabase.execute<{ count: number }>(sql`
    insert into auth_rate_limit (key, count, last_request) values (${key}, 1, ${now})
    on conflict (key) do update set
      count = case when auth_rate_limit.last_request <= ${windowStart} then 1 else auth_rate_limit.count + 1 end,
      last_request = case when auth_rate_limit.last_request <= ${windowStart} then ${now} else auth_rate_limit.last_request end
    returning count`)
  return Number(result.rows[0]?.count ?? 0)
}

/** The events counted against `key` in its current window (0 once the window is over). */
export async function countInWindow(key: string, windowSeconds: number): Promise<number> {
  const windowStart = Date.now() - windowSeconds * 1000
  const result = await appDatabase.execute<{ count: number }>(sql`
    select count from auth_rate_limit where key = ${key} and last_request > ${windowStart}`)
  return Number(result.rows[0]?.count ?? 0)
}
