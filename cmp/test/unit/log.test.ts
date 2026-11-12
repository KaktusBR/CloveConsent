import { describe, expect, test } from 'vitest'
import { captureLog as capture } from './capture-log'

describe('log', () => {
  test('writes one JSON object per line with level and message', () => {
    const { log, lines } = capture()
    log.info({ path: '/x' }, 'hello')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toMatchObject({ level: 'info', msg: 'hello', path: '/x' })
    expect(typeof lines[0]?.time).toBe('string')
  })

  test('redacts a password and a nested cookie', () => {
    const { log, lines } = capture()
    log.info({ password: 'x', headers: { cookie: 'y' } }, 'login')
    expect(lines[0]).toMatchObject({ password: '[redacted]', headers: { cookie: '[redacted]' } })
    const raw = JSON.stringify(lines[0])
    expect(raw).not.toContain('"x"')
    expect(raw).not.toContain('"y"')
  })

  test.each(['password', 'token', 'secret', 'cookie', 'authorization', 'set-cookie'])('redacts %s at the top level and two levels deep', (key) => {
    const { log, lines } = capture()
    log.info({ [key]: 'v1', a: { [key]: 'v2', b: { [key]: 'v3' } } })
    expect(JSON.stringify(lines[0])).not.toMatch(/"v[123]"/)
  })

  test('keeps the request id of a child logger on every line', () => {
    const { log, lines } = capture()
    const child = log.child({ requestId: 'r-1' })
    child.info('one')
    child.warn('two')
    expect(lines.map((l) => l.requestId)).toEqual(['r-1', 'r-1'])
  })
})
