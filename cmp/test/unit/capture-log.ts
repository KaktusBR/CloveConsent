import { Writable } from 'node:stream'
import { createLogger } from '../../src/server/log'

/** A logger whose lines are collected as parsed JSON instead of going to stdout. */
export function captureLog() {
  const lines: Record<string, unknown>[] = []
  const sink = new Writable({
    write(chunk: Buffer, _enc, done) {
      for (const line of chunk.toString('utf8').split('\n').filter(Boolean)) lines.push(JSON.parse(line) as Record<string, unknown>)
      done()
    },
  })
  return { log: createLogger(sink), lines }
}
