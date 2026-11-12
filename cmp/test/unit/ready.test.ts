import { createServer } from 'node:net'
import { afterAll, describe, expect, test } from 'vitest'
import { readinessProbe } from '../../src/server/data/ready'
import { captureLog } from './capture-log'

/** A port that nothing listens on: bind, note the port, close. */
async function closedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

describe('readinessProbe', () => {
  const probes: { close(): Promise<void> }[] = []
  afterAll(async () => { await Promise.all(probes.map((p) => p.close())) })

  test('answers false, without throwing, when the database is unreachable, and logs why', async () => {
    const { log, lines } = captureLog()
    const probe = readinessProbe(`postgres://u:secret-pw@127.0.0.1:${await closedPort()}/db`, { timeoutMs: 1000, log })
    probes.push(probe)
    await expect(probe.check()).resolves.toBe(false)
    expect(lines).toMatchObject([{ level: 'warn', msg: 'database not ready' }])
    expect(JSON.stringify(lines)).not.toContain('secret-pw')
  })
})
