// Counting windows of our own beside Better Auth's rate limits (which count requests per client address):
// stored in the same table, auth_rate_limit, so they are shared by every app process and cleared by the
// same clean-up job. A window is fixed: it starts at its first event (last_request holds that start).
// Only src/server/auth/ uses this (identity data, ruling R2).
import { sql } from 'drizzle-orm'
import { appDatabase } from './client'

/**
 * Take one of the `max` places of `key`'s window, in one statement (the row is locked and the condition
 * re-checked on it, so concurrent requests can never take more than `max`). Returns the start of the
 * window the place was taken in, or false when the window is full; a refused attempt changes nothing. A
 * place taken for an attempt that turned out not to count is given back with {@link releaseInWindow}.
 */
export async function reserveInWindow(key: string, windowSeconds: number, max: number): Promise<number | false> {
  const now = Date.now()
  const windowStart = now - windowSeconds * 1000
  const result = await appDatabase.execute<{ last_request: string | number }>(sql`
    insert into auth_rate_limit as r (key, count, last_request) values (${key}, 1, ${now})
    on conflict (key) do update set
      count = case when r.last_request <= ${windowStart} then 1 else r.count + 1 end,
      last_request = case when r.last_request <= ${windowStart} then ${now} else r.last_request end
    where r.last_request <= ${windowStart} or r.count < ${max}
    returning last_request`)
  const row = result.rows[0]
  return row === undefined ? false : Number(row.last_request)
}

/**
 * Give back a place taken with {@link reserveInWindow} (`window` is what it returned). Only to the window it
 * was taken in: once that window has ended and a new one started, there is nothing to give back.
 */
export async function releaseInWindow(key: string, window: number): Promise<void> {
  await appDatabase.execute(sql`update auth_rate_limit set count = count - 1 where key = ${key} and last_request = ${window} and count > 0`)
}
