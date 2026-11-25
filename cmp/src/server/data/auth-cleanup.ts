// Deletes identity rows that have served their purpose, for the worker's auth.cleanup job: expired
// sessions and challenges, and rate-limit windows that no limit can still use: twice the longest window
// (an hour: the account-wide failed-password window in src/server/auth/auth.ts and the account-creation form's),
// a margin for clocks and windows that end between two runs.
// Runs on the system role, which may only read the filtered column and delete (drizzle/0005_auth_cleanup.sql).
// Not through asSystem: no tenant data is read, and an audit row every 15 minutes would say nothing.
import { sql } from 'drizzle-orm'
import { systemDatabase } from './client'

/** Rate-limit rows whose window started longer ago than this are finished windows (test/unit/auth-cleanup.test.ts). */
export const RATE_LIMIT_RETENTION_MS = 2 * 60 * 60 * 1000

export interface AuthCleanupResult {
  sessions: number
  verifications: number
  rateLimits: number
}

export async function deleteExpiredAuthRows(now: Date = new Date()): Promise<AuthCleanupResult> {
  const sessions = await systemDatabase.execute(sql`delete from auth_session where expires_at < ${now}`)
  const verifications = await systemDatabase.execute(sql`delete from auth_verification where expires_at < ${now}`)
  const rateLimits = await systemDatabase.execute(sql`delete from auth_rate_limit where last_request < ${now.getTime() - RATE_LIMIT_RETENTION_MS}`)
  return { sessions: sessions.rowCount ?? 0, verifications: verifications.rowCount ?? 0, rateLimits: rateLimits.rowCount ?? 0 }
}
