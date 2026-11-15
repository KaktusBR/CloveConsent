// The worker's auth.cleanup job: every 15 minutes (scheduled by the worker), delete expired sessions and
// challenges and finished rate-limit windows. They hold client addresses and user agents.
import type { JobHandler } from '../data/queue'
import { deleteExpiredAuthRows } from '../data/auth-cleanup'
import { log as defaultLog, type Logger } from '../log'

export const AUTH_CLEANUP = 'auth.cleanup'
/** Every 15 minutes, UTC. */
export const AUTH_CLEANUP_CRON = '*/15 * * * *'

export function authCleanupHandler(log: Logger = defaultLog): JobHandler {
  return async (job) => {
    const deleted = await deleteExpiredAuthRows()
    log.info({ jobId: job.id, deleted }, 'expired identity rows deleted')
  }
}
