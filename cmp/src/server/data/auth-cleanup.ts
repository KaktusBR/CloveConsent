// Deletes identity rows that have served their purpose, for the worker's auth.cleanup job: expired
// sessions and challenges, and rate-limit windows older than the longest window (15 minutes) by a margin.
// Runs on the system role, which may only read the filtered column and delete (drizzle/0005_auth_cleanup.sql).
// Not through asSystem: no tenant data is read, and an audit row every 15 minutes would say nothing.
import { sql } from 'drizzle-orm'
import { systemDatabase } from './client'

/** Rate-limit rows idle longer than this are finished windows. */
export const RATE_LIMIT_RETENTION_MS = 60 * 60 * 1000

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
