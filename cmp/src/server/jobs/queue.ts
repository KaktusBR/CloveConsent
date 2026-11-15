// Background jobs: what can be queued, and with what data. The worker process (src/worker.ts) runs them.
// Each queue is created, with its retry and retention settings, by a migration (drizzle/0002_job_queue.sql).
//
// A job's data is stored in the queue schema until the job is deleted: never put an account's records or
// a secret in it beyond what the task needs (a mail job carries recipient, template, locale and values).
import { insertJob } from '../data/queue'
import type { SystemTx, TenantTx } from '../data/scope'
import type { MailJob } from './mail'

/** The data of each job. */
export interface JobData {
  'mail.send': MailJob
  /** Delete expired identity rows (src/server/jobs/auth-cleanup.ts); no data. */
  'auth.cleanup': Record<string, never>
}

export type JobName = keyof JobData

export interface EnqueueOptions {
  singletonKey?: string
  startAfter?: Date
  /**
   * The caller's transaction (from withAccount or asSystem): the job is created only if it commits, so no
   * email leaves for work that was rolled back. Await enqueue inside the callback.
   */
  tx?: TenantTx | SystemTx
}

/** Queue a job; returns its id. Without `tx` the job is committed at once. */
export function enqueue<N extends JobName>(name: N, data: JobData[N], opts?: EnqueueOptions): Promise<string> {
  return insertJob(name, data, opts)
}
