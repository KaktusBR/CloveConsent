// Background worker process: same image as the app, started with `node dist/worker.js`.
// Jobs are registered here as they arrive (the queue comes with the jobs work).
import { env } from './server/env'
import { log } from './server/log'

const idle = setInterval(() => {}, 2 ** 30) // keep the process alive until it is told to stop

function stop(signal: NodeJS.Signals): void {
  log.info({ signal }, 'worker stopping')
  clearInterval(idle)
}

process.once('SIGTERM', stop)
process.once('SIGINT', stop)
log.info({ nodeEnv: env.NODE_ENV }, 'worker started')
