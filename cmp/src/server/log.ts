import { pino, stdTimeFunctions, type DestinationStream, type Logger } from 'pino'

const SENSITIVE = ['password', 'token', 'secret', 'cookie', 'authorization', 'set-cookie']

/** Each sensitive key at the top level and up to two objects deep (e.g. `req.headers.cookie`). */
export const REDACT_PATHS = SENSITIVE.flatMap((key) => {
  const k = `["${key}"]`
  return [k, `*${k}`, `*.*${k}`]
})

/** A structured JSON logger to stdout (or `destination`), with sensitive fields redacted. */
export function createLogger(destination?: DestinationStream): Logger {
  const options = {
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
    timestamp: stdTimeFunctions.isoTime,
    formatters: { level: (label: string) => ({ level: label }) },
  }
  return destination ? pino(options, destination) : pino(options)
}

/** The process logger used by the app and the worker. Use `log.child({ requestId })` per request. */
export const log: Logger = createLogger()

export type { Logger }
