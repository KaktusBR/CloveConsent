import { env } from '../env'
import { log as defaultLog, type Logger } from '../log'
import { GuardedPool } from './pool'

export interface ReadinessProbe {
  /** True when the database answers `select 1` within the timeout; never throws. */
  check(): Promise<boolean>
  close(): Promise<void>
}

/** A one-connection pool used only to ask the database whether it answers. */
export function readinessProbe(connectionString: string, { timeoutMs = 2000, log = defaultLog }: { timeoutMs?: number; log?: Logger } = {}): ReadinessProbe {
  const pool = new GuardedPool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
    idleTimeoutMillis: 30_000,
    application_name: 'cmp-readiness',
  })
  // an idle connection dropped by the server must not crash the process
  pool.on('error', (err) => log.warn({ error: err.message }, 'readiness pool connection lost'))
  return {
    async check() {
      try {
        await pool.query('select 1')
        return true
      } catch (err) {
        log.warn({ error: (err as Error).message }, 'database not ready')
        return false
      }
    },
    close: () => pool.end(),
  }
}

let probe: ReadinessProbe | undefined

/** Whether the app's database answers, through one shared probe. */
export function databaseAnswers(): Promise<boolean> {
  probe ??= readinessProbe(env.DATABASE_URL)
  return probe.check()
}
