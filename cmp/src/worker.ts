// Background worker process: same image as the app, started with `node dist/worker.js` (npm run worker).
// Takes jobs from the queue (src/server/data/queue.ts) as the system role, one at a time per queue.
// On SIGTERM or SIGINT (also during startup) it stops taking jobs, lets the ones in hand finish (up to
// 30 s; one still running then is left to the queue to expire and retry), then exits 0. It exits 1 when
// it fails to start, or if stopping throws.
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { startQueueWorker } from './server/data/queue'
import { env } from './server/env'
import { createMailTransport, deadMailHandler, MAIL_DEAD_LETTER, mailHandler, type MailTransport } from './server/jobs/mail'
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
  await queue.work('mail.send', mailHandler(transport, log), { pollingIntervalSeconds })
  await queue.work(MAIL_DEAD_LETTER, deadMailHandler(log), { pollingIntervalSeconds })
  return {
    async stop() {
      await queue.stop()
      transport.close?.()
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // Signals are taken from the start: one that arrives during startup stops the worker once it has started.
  let worker: Worker | undefined
  let signalled = false
  const shutdown = (running: Worker) => {
    running.stop().then(
      () => {
        defaultLog.info('worker stopped')
        process.exit(process.exitCode ?? 0)
      },
      (err: unknown) => {
        defaultLog.error({ error: (err as Error).message }, 'worker did not stop cleanly')
        process.exit(1)
      },
    )
  }
  const onSignal = (signal: NodeJS.Signals) => {
    if (signalled) return
    signalled = true
    defaultLog.info({ signal }, 'worker stopping')
    if (worker) shutdown(worker)
  }
  process.on('SIGTERM', onSignal)
  process.on('SIGINT', onSignal)
  defaultLog.info({ nodeEnv: env.NODE_ENV }, 'worker starting')
  try {
    worker = await startWorker()
  } catch (err) {
    defaultLog.error({ error: (err as Error).message }, 'worker failed to start')
    process.exit(1)
  }
  if (signalled) shutdown(worker)
  else defaultLog.info('worker started')
}
