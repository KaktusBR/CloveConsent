// The job queue's database side (pg-boss): only src/server/data/ may import pg-boss (lint rule
// cmp/data-layer-only), the rest of the app uses enqueue (src/server/jobs/queue.ts) and the worker API here.
//
// The queue lives in its own schema, `pgboss`, installed and upgraded by migrations as the owner
// (drizzle/0002_job_queue.sql); pg-boss never changes the schema at runtime (migrate: false). Its jobs are
// not tenant data, so the schema has no row-level security: a job carries what one background task needs,
// never an account's records or secrets. Two roles, two instances, as with the database pools (client.ts):
//   app     DATABASE_URL         cmp_app: reads the queue settings and inserts jobs, nothing else
//   worker  DATABASE_URL_SYSTEM  cmp_system: fetches, completes, fails, retries and cleans up jobs (DML only)
import { sql } from 'drizzle-orm'
import { fromDrizzle, PgBoss, type ConstructorOptions, type JobResult, type JobWithMetadata } from 'pg-boss'
import { env } from '../env'
import { log as defaultLog, type Logger } from '../log'
import type { SystemTx, TenantTx } from './scope'

export const QUEUE_SCHEMA = 'pgboss'

/** Shared by both instances: the installed schema as is, no scheduler, no DDL (stats tables, reindexing). */
const COMMON: ConstructorOptions = {
  schema: QUEUE_SCHEMA,
  migrate: false,
  createSchema: false,
  schedule: false,
  persistQueueStats: false,
  reindex: false,
  openTelemetry: { enabled: false },
}

function create(options: ConstructorOptions, log: Logger, role: string): PgBoss {
  const boss = new PgBoss({ ...COMMON, ...options })
  // pg-boss reports connection and maintenance failures as events; an unhandled 'error' would crash the process
  boss.on('error', (err: Error) => log.error({ error: err.message, queue: role }, 'job queue error'))
  boss.on('warning', (w: { message: string }) => log.warn({ warning: w.message, queue: role }, 'job queue warning'))
  return boss
}

export class QueueSchemaError extends Error {
  override readonly name = 'QueueSchemaError'
  constructor(cause: unknown) {
    super('job queue: the pgboss schema is missing or of another version than this pg-boss; apply the migrations (npm run db:migrate)', { cause })
  }
}

/** Start an instance; on a schema it cannot use (migrate: false), fail with a QueueSchemaError and close its pool. */
async function start(boss: PgBoss): Promise<PgBoss> {
  try {
    return await boss.start()
  } catch (err) {
    await boss.stop({ graceful: false, close: true }).catch(() => {})
    // pg-boss's checks when it may not migrate (contractor.check)
    if (/requires migrations|is not installed/.test((err as Error).message)) throw new QueueSchemaError(err)
    throw err
  }
}

// ---- enqueue (app role) ----

let appQueue: Promise<PgBoss> | undefined

function app(): Promise<PgBoss> {
  appQueue ??= start(
    create({ connectionString: env.DATABASE_URL, application_name: 'cmp-app-queue', max: 3, supervise: false, registerInstance: false }, defaultLog, 'app'),
  ).catch((err: unknown) => {
      appQueue = undefined // the next enqueue tries again
      throw err
    })
  return appQueue
}

export interface InsertJobOptions {
  singletonKey?: string
  startAfter?: Date
  /** Insert in this transaction: the job exists only if it commits. Await the call inside the callback. */
  tx?: TenantTx | SystemTx
}

/** Insert a job into the named queue (created by a migration). Returns its id. */
export async function insertJob(name: string, data: object, options: InsertJobOptions = {}): Promise<string> {
  const boss = await app()
  const id = await boss.send(name, data, {
    ...(options.singletonKey === undefined ? {} : { singletonKey: options.singletonKey }),
    ...(options.startAfter === undefined ? {} : { startAfter: options.startAfter }),
    // pg-boss's statements on the caller's transaction (its Drizzle adapter turns `$n` into parameters)
    ...(options.tx === undefined ? {} : { db: fromDrizzle(options.tx, sql) }),
  })
  // only a queue policy that keeps one job per key skips an insert; none of ours does yet
  if (id === null) throw new Error(`queue: the ${name} job was not created (a job with its singleton key exists)`)
  return id
}

/** Stop the app's queue instance (shutdown, tests). */
export async function closeQueue(): Promise<void> {
  const boss = appQueue
  appQueue = undefined
  if (boss) await (await boss).stop({ graceful: false, close: true })
}

// ---- worker (system role) ----

export interface QueueJob {
  id: string
  name: string
  /** As stored: anything a role that may insert jobs wrote. Check it before use. */
  data: unknown
  /** 0 on the first attempt. */
  retryCount: number
  retryLimit: number
  /** For a dead-lettered job: the job that failed, and how many retries it had. */
  sourceId: string | null
  sourceName: string | null
  sourceRetryCount: number | null
  /** For a dead-lettered job: overwrite the stored data of the job it was copied from (nothing otherwise). */
  replaceSourceData(data: object): Promise<void>
  /** Overwrite the stored data (to drop what must not outlive the job; a dead-letter copy takes the data as it is then). */
  replaceData(data: object): Promise<void>
}

/** Resolve to complete the job, throw to fail it (retried while it has retries left), or say it can never succeed. */
export type JobHandler = (job: QueueJob) => Promise<void | 'dead-letter'>

export interface QueueWorker {
  /** Take jobs from `name`, one at a time. */
  work(name: string, handler: JobHandler, options?: { pollingIntervalSeconds?: number }): Promise<void>
  /** One maintenance pass now (expire, retry, delete old jobs); the worker also runs it on a timer. */
  supervise(): Promise<void>
  /** Stop fetching, wait up to `timeoutMs` for the jobs in hand to finish, then close the connections. */
  stop(options?: { timeoutMs?: number }): Promise<void>
}

export async function startQueueWorker({ log = defaultLog, supervise = true }: { log?: Logger; supervise?: boolean } = {}): Promise<QueueWorker> {
  const boss = await start(
    create({ connectionString: env.DATABASE_URL_SYSTEM, application_name: 'cmp-worker', max: 5, supervise, instanceName: 'worker' }, log, 'worker'),
  )
  const replaceData = async (name: string, id: string, data: object) => {
    await boss.getDb().executeSql(`update ${QUEUE_SCHEMA}.job set data = $1::jsonb where name = $2 and id = $3`, [JSON.stringify(data), name, id])
  }
  return {
    async work(name: string, handler: JobHandler, { pollingIntervalSeconds = 2 } = {}) {
      const options = { batchSize: 1, includeMetadata: true, perJobResults: true, pollingIntervalSeconds } as const
      await boss.work<unknown, unknown, typeof options>(name, options, async (jobs: JobWithMetadata<unknown>[]) => {
        const results: JobResult[] = []
        for (const job of jobs) {
          const outcome = await handler({
            id: job.id,
            name: job.name,
            data: job.data,
            retryCount: job.retryCount,
            retryLimit: job.retryLimit,
            sourceId: job.sourceId,
            sourceName: job.sourceName,
            sourceRetryCount: job.sourceRetryCount,
            replaceData: (data) => replaceData(job.name, job.id, data),
            replaceSourceData: async (data) => {
              if (job.sourceName !== null && job.sourceId !== null) await replaceData(job.sourceName, job.sourceId, data)
            },
          })
          results.push({ id: job.id, status: outcome === 'dead-letter' ? 'deadletter' : 'completed' })
        }
        return results
      })
    },
    supervise: () => boss.supervise(),
    stop: ({ timeoutMs = 30_000 } = {}) => boss.stop({ graceful: true, timeout: timeoutMs, close: true }),
  }
}
