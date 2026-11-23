import { destination as stdout, pino, stdTimeFunctions, type DestinationStream, type Logger } from 'pino'

/** Keys whose values never reach a log line, matched case-insensitively anywhere in the key (accessToken, set-cookie, DATABASE_URL_MIGRATE …). */
export const SENSITIVE_KEY = /authorization|cookie|passw(?:or)?d|secret|token|api[-_]?key|database[-_]?url/i
const CENSOR = '[redacted]'

/** A copy of a parsed JSON value with every sensitive key censored, at any depth. */
export function redact(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(redact)
  const out: Record<string, unknown> = {}
  for (const [key, v] of Object.entries(value)) out[key] = SENSITIVE_KEY.test(key) ? CENSOR : redact(v)
  return out
}

/**
 * Redaction happens on the finished line, after pino has merged child bindings, serialized errors
 * (with their own properties) and cut cycles, so nothing reaches the output unredacted.
 */
function redacting(target: DestinationStream): DestinationStream {
  return {
    write(line: string) {
      target.write(`${JSON.stringify(redact(JSON.parse(line)))}\n`)
    },
  }
}

/** A structured JSON logger to stdout (or `destination`), with sensitive fields redacted. */
export function createLogger(destination: DestinationStream = stdout(1)): Logger {
  return pino(
    { timestamp: stdTimeFunctions.isoTime, formatters: { level: (label: string) => ({ level: label }) } },
    redacting(destination),
  )
}

/** The process logger used by the app and the worker. Use `log.child({ requestId })` per request. */
export const log: Logger = createLogger()

export type { Logger }

/**
 * A request path as it is logged: the token of an invitation link (`/invite/<token>`, in any language) is
 * a secret and is replaced by `:token`.
 */
export function pathForLog(pathname: string): string {
  return pathname.replace(/(\/invite\/)[^/]+/gi, '$1:token')
}
