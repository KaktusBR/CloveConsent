// Background worker process: same image as the app, started with `node dist/worker.js` (npm run worker).
// Takes jobs from the queue (src/server/data/queue.ts) as the system role, one at a time per queue.
// On SIGTERM or SIGINT it stops taking jobs, lets the ones in hand finish (up to 30 s), then exits.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { startQueueWorker } from './server/data/queue'
import { env } from './server/env'
import { createMailTransport, deadMailHandler, MAIL_DEAD_LETTER, mailHandler, type MailJob, type MailTransport } from './server/jobs/mail'
import { log as defaultLog, type Logger } from './server/log'

export interface WorkerOptions {
  /** Default: SMTP_URL. */
  transport?: MailTransport
  log?: Logger
  /** How often an idle queue is asked for jobs. Default 2 s. */
  pollingIntervalSeconds?: number
}

export interface Worker {
  /** Stop taking jobs, wait for those in hand, close the connections. */
  stop(): Promise<void>
}

export async function startWorker({ transport = createMailTransport(), log = defaultLog, pollingIntervalSeconds = 2 }: WorkerOptions = {}): Promise<Worker> {
  const queue = await startQueueWorker({ log })
  await queue.work<MailJob>('mail.send', mailHandler(transport, log), { pollingIntervalSeconds })
  await queue.work<MailJob>(MAIL_DEAD_LETTER, deadMailHandler(log), { pollingIntervalSeconds })
  return {
    async stop() {
      await queue.stop()
      transport.close?.()
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const worker = await startWorker()
    let stopping = false
    const stop = (signal: NodeJS.Signals) => {
      if (stopping) return
      stopping = true
      defaultLog.info({ signal }, 'worker stopping')
      worker.stop().then(
        () => defaultLog.info('worker stopped'),
        (err: unknown) => {
          defaultLog.error({ error: (err as Error).message }, 'worker did not stop cleanly')
          process.exitCode = 1
        },
      )
    }
    process.once('SIGTERM', stop)
    process.once('SIGINT', stop)
    defaultLog.info({ nodeEnv: env.NODE_ENV }, 'worker started')
  } catch (err) {
    defaultLog.error({ error: (err as Error).message }, 'worker failed to start')
    process.exitCode = 1
  }
}
