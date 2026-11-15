// Rate-limit windows of our own beside Better Auth's (which count per client address): stored in the same
// table, auth_rate_limit, so they are shared by every app process and cleared by the same clean-up job.
// Only src/server/auth/ uses this (identity data, ruling R2).
import { sql } from 'drizzle-orm'
import { appDatabase } from './client'

/**
 * Count one request against `key` in a fixed window of `windowSeconds` starting at its first request,
 * atomically (one statement). True while at most `max` requests fell in the window.
 */
export async function consumeLimit(key: string, windowSeconds: number, max: number): Promise<boolean> {
  const now = Date.now()
  const windowStart = now - windowSeconds * 1000
  const result = await appDatabase.execute<{ count: number }>(sql`
    insert into auth_rate_limit (key, count, last_request) values (${key}, 1, ${now})
    on conflict (key) do update set
      count = case when auth_rate_limit.last_request <= ${windowStart} then 1 else auth_rate_limit.count + 1 end,
      last_request = case when auth_rate_limit.last_request <= ${windowStart} then ${now} else auth_rate_limit.last_request end
    returning count`)
  return Number(result.rows[0]?.count ?? Infinity) <= max
}
