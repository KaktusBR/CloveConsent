// Counting windows of our own beside Better Auth's rate limits (which count requests per client address):
// stored in the same table, auth_rate_limit, so they are shared by every app process and cleared by the
// same clean-up job. A window is fixed: it starts at its first event (last_request holds that start).
// Only src/server/auth/ uses this (identity data, ruling R2).
import { sql } from 'drizzle-orm'
import { appDatabase } from './client'

/**
 * Take one of the `max` places of `key`'s window, in one statement (so concurrent requests can never
 * take more than `max`). False when the window is full; the count then stays at max + 1, which only marks
 * it full. A place taken for an attempt that turned out not to count is given back with {@link releaseInWindow}.
 */
export async function reserveInWindow(key: string, windowSeconds: number, max: number): Promise<boolean> {
  const now = Date.now()
  const windowStart = now - windowSeconds * 1000
  const result = await appDatabase.execute<{ count: number }>(sql`
    insert into auth_rate_limit as r (key, count, last_request) values (${key}, 1, ${now})
    on conflict (key) do update set
      count = case when r.last_request <= ${windowStart} then 1 when r.count <= ${max} then r.count + 1 else r.count end,
      last_request = case when r.last_request <= ${windowStart} then ${now} else r.last_request end
    returning count`)
  return Number(result.rows[0]?.count ?? Infinity) <= max
}

/** Give back a place taken with {@link reserveInWindow}. */
export async function releaseInWindow(key: string): Promise<void> {
  await appDatabase.execute(sql`update auth_rate_limit set count = count - 1 where key = ${key} and count > 0`)
}
