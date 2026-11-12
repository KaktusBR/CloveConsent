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

  test.each([
    'password', 'token', 'secret', 'cookie', 'authorization', 'set-cookie',
    'Authorization', 'COOKIE', 'Password', 'accessToken', 'refreshToken', 'refresh_token', 'clientSecret', 'BETTER_AUTH_SECRET',
    'apikey', 'apiKey', 'api_key', 'x-api-key', 'DATABASE_URL', 'DATABASE_URL_MIGRATE', 'databaseUrl',
  ])('redacts %s at every depth', (key) => {
    const { log, lines } = capture()
    log.info({ [key]: 'v0', a: { [key]: 'v1', b: { [key]: 'v2', c: { d: { e: { [key]: 'v5' } } } } }, list: [{ [key]: 'v6' }] })
    const raw = JSON.stringify(lines[0])
    expect(raw).not.toMatch(/"v\d"/)
    expect(lines[0]).toMatchObject({ [key]: '[redacted]', a: { b: { c: { d: { e: { [key]: '[redacted]' } } } } } })
  })

  test('redacts nested headers of a request five levels deep, keeping other fields', () => {
    const { log, lines } = capture()
    log.info({ l1: { l2: { l3: { l4: { headers: { Authorization: 'Bearer abc', Cookie: 'sid=1', accept: 'text/html' } } } } } })
    const headers = (lines[0] as { l1: { l2: { l3: { l4: { headers: Record<string, string> } } } } }).l1.l2.l3.l4.headers
    expect(headers).toEqual({ Authorization: '[redacted]', Cookie: '[redacted]', accept: 'text/html' })
  })

  test('redacts in child bindings and in error properties, and survives cycles', () => {
    const { log, lines } = capture()
    const err = Object.assign(new Error('boom'), { config: { password: 'pw-leak' } })
    const cyclic: Record<string, unknown> = { token: 'tok-leak' }
    cyclic.self = cyclic
    log.child({ apiKey: 'key-leak' }).error({ err, cyclic }, 'failed')
    const raw = JSON.stringify(lines[0])
    for (const leak of ['pw-leak', 'tok-leak', 'key-leak']) expect(raw).not.toContain(leak)
    expect(raw).toContain('boom')
  })

  test('leaves other fields as they are', () => {
    const { log, lines } = capture()
    log.info({ path: '/healthz', status: 200 })
    expect(lines[0]).toMatchObject({ path: '/healthz', status: 200 })
  })

  test('keeps the request id of a child logger on every line', () => {
    const { log, lines } = capture()
    const child = log.child({ requestId: 'r-1' })
    child.info('one')
    child.warn('two')
    expect(lines.map((l) => l.requestId)).toEqual(['r-1', 'r-1'])
  })
})
