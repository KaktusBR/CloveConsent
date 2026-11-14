// The worker as a process: built like `npm run build:worker`, started like `node dist/worker.js`,
// stopped with a signal. Signals are POSIX: the signal tests run in CI (Linux) and are skipped on
// Windows, where a child process cannot be sent SIGTERM (Node can only kill it outright).
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { connect, createServer, type Server, type Socket } from 'node:net'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { closeQueue } from '../../src/server/data/queue'
import { checkMail } from '../../src/server/jobs/mail'
import { enqueue } from '../../src/server/jobs/queue'
import { asRole, newId } from './raw'

const OUT_DIR = resolve('node_modules/.cache/cmp-worker-test')
const WORKER = resolve(OUT_DIR, 'worker.js')
const SMTP = new URL(process.env.SMTP_URL || 'smtp://localhost:1025')
const POSIX = process.platform !== 'win32'

interface Run {
  child: ChildProcess
  lines: Record<string, unknown>[]
  exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>
  /** Resolves with the first log line whose message is `msg`. */
  line(msg: string): Promise<Record<string, unknown>>
}

function run(env: Record<string, string> = {}): Run {
  const child = spawn(process.execPath, [WORKER], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  const lines: Record<string, unknown>[] = []
  const waiting: { msg: string; resolve: (l: Record<string, unknown>) => void }[] = []
  let buffer = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    buffer += chunk.toString('utf8')
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''
    for (const part of parts.filter(Boolean)) {
      const line = JSON.parse(part) as Record<string, unknown>
      lines.push(line)
      for (const w of waiting.filter((x) => x.msg === line.msg)) w.resolve(line)
    }
  })
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((done) => child.on('exit', (code, signal) => done({ code, signal })))
  return {
    child,
    lines,
    exited,
    line: (msg) => {
      const seen = lines.find((l) => l.msg === msg)
      return seen ? Promise.resolve(seen) : new Promise((r) => waiting.push({ msg, resolve: r }))
    },
  }
}

const within = <T>(ms: number, what: string, p: Promise<T>) =>
  Promise.race([p, new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms waiting for ${what}`)), ms))])

beforeAll(async () => {
  mkdirSync(OUT_DIR, { recursive: true })
  // the build:worker script's options (package.json)
  await build({ entryPoints: ['src/worker.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'external', outfile: WORKER, logLevel: 'silent' })
}, 60_000)

afterAll(closeQueue)

test('a worker that cannot reach its database logs it and exits 1', async () => {
  const bad = new URL(process.env.DATABASE_URL_SYSTEM ?? '')
  bad.password = 'wrong-password'
  const worker = run({ DATABASE_URL_SYSTEM: bad.href })
  expect(await within(35_000, 'the exit', worker.exited)).toEqual({ code: 1, signal: null })
  expect(worker.lines.map((l) => l.msg)).toContain('worker failed to start')
  expect(JSON.stringify(worker.lines)).not.toContain('wrong-password')
})

describe.skipIf(!POSIX)('signals (POSIX only: skipped on Windows, which cannot send SIGTERM to a process)', () => {
  /** An SMTP relay to Mailpit that holds each connection until released: a job stays in hand meanwhile. */
  let relay: Server
  let held: { socket: Socket; release: () => void }[] = []
  let connected: () => void = () => {}

  beforeAll(async () => {
    relay = createServer((socket) => {
      held.push({
        socket,
        release: () => {
          const upstream = connect(Number(SMTP.port || 1025), SMTP.hostname === 'localhost' ? '127.0.0.1' : SMTP.hostname)
          socket.pipe(upstream).pipe(socket)
        },
      })
      connected()
    })
    await new Promise<void>((r) => relay.listen(0, '127.0.0.1', r))
  })

  afterAll(async () => {
    for (const h of held) h.socket.destroy()
    await new Promise((r) => relay.close(r))
  })

  test('SIGTERM lets the job in hand finish, then the worker exits 0', async () => {
    held = []
    const port = (relay.address() as { port: number }).port
    const id = await enqueue('mail.send', checkMail({ to: `signal-${newId()}@example.test`, template: 'reset-password', locale: 'en', data: { url: `http://localhost:4321/reset-password?token=tok_${newId()}` } }))
    const inHand = new Promise<void>((r) => (connected = r))
    const worker = run({ SMTP_URL: `smtp://127.0.0.1:${port}` })
    await within(30_000, 'the job in hand', inHand)
    worker.child.kill('SIGTERM')
    await within(10_000, 'worker stopping', worker.line('worker stopping'))
    // still waiting for the job: no exit yet
    const early = await Promise.race([worker.exited, new Promise((r) => setTimeout(() => r('running'), 1000))])
    expect(early).toBe('running')
    for (const h of held) h.release()
    expect(await within(35_000, 'the exit', worker.exited)).toEqual({ code: 0, signal: null })
    expect(worker.lines.map((l) => l.msg)).toEqual(expect.arrayContaining(['worker started', 'worker stopping', 'mail sent', 'worker stopped']))
    const state = await asRole('migrate', async (c) => (await c.query<{ state: string }>('select state from pgboss.job where id = $1', [id])).rows[0]?.state)
    expect(state).toBe('completed')
  })

  test('a SIGTERM during startup stops the worker once it has started, and it exits 0', async () => {
    const worker = run()
    await within(10_000, 'worker starting', worker.line('worker starting'))
    worker.child.kill('SIGTERM')
    expect(await within(35_000, 'the exit', worker.exited)).toEqual({ code: 0, signal: null })
    const messages = worker.lines.map((l) => l.msg)
    expect(messages).toContain('worker stopped')
    expect(messages).not.toContain('worker failed to start')
  })
})
