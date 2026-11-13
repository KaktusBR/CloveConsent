import { describe, expect, test } from 'vitest'
import { EnvError, parseEnv } from '../../src/server/env'

const SECRET = 'k3y-'.repeat(8) + 'tail' // 36 bytes

const valid = (): Record<string, string | undefined> => ({
  DATABASE_URL: 'postgres://cmp_app:app-pw@localhost:5432/cmp',
  DATABASE_URL_SYSTEM: 'postgres://cmp_system:system-pw@localhost:5432/cmp',
  BETTER_AUTH_SECRET: SECRET,
  PUBLIC_ORIGIN: 'https://consent.example',
  SMTP_URL: 'smtp://mail-user:mail-pw@localhost:1025',
  MAIL_FROM: 'Consent <noreply@consent.example>',
  SUPER_ADMIN_EMAILS: 'Ada@Example.com, bob@example.com',
  NODE_ENV: 'production',
})

/** The thrown error, or a failure if nothing was thrown. */
function errorOf(source: Record<string, string | undefined>): EnvError {
  try {
    parseEnv(source)
  } catch (err) {
    expect(err).toBeInstanceOf(EnvError)
    return err as EnvError
  }
  throw new Error('parseEnv accepted an invalid environment')
}

describe('parseEnv', () => {
  test('accepts a complete environment', () => {
    const env = parseEnv(valid())
    expect(env.PUBLIC_ORIGIN).toBe('https://consent.example')
    expect(env.SUPER_ADMIN_EMAILS).toEqual(['ada@example.com', 'bob@example.com'])
    expect(env.NODE_ENV).toBe('production')
    expect(env.DATABASE_URL_SYSTEM).toBe(valid().DATABASE_URL_SYSTEM)
  })

  test('the result is frozen', () => {
    expect(Object.isFrozen(parseEnv(valid()))).toBe(true)
  })

  test('NODE_ENV defaults to development and SUPER_ADMIN_EMAILS to none', () => {
    const env = parseEnv({ ...valid(), NODE_ENV: undefined, SUPER_ADMIN_EMAILS: undefined })
    expect(env.NODE_ENV).toBe('development')
    expect(env.SUPER_ADMIN_EMAILS).toEqual([])
  })

  test('a trailing slash on PUBLIC_ORIGIN is normalised away', () => {
    expect(parseEnv({ ...valid(), PUBLIC_ORIGIN: 'https://consent.example/' }).PUBLIC_ORIGIN).toBe('https://consent.example')
  })

  test('the runtime environment never needs nor keeps the owner or admin database credentials', () => {
    const env = parseEnv(valid())
    expect(Object.keys(env)).not.toContain('DATABASE_URL_MIGRATE')
    const given = parseEnv({ ...valid(), DATABASE_URL_MIGRATE: 'postgres://cmp_owner:owner-pw@localhost:5432/cmp', DATABASE_URL_ADMIN: 'postgres://postgres:pw@localhost:5432/postgres' })
    expect(Object.keys(given)).not.toContain('DATABASE_URL_MIGRATE')
    expect(Object.keys(given)).not.toContain('DATABASE_URL_ADMIN')
  })

  test.each(['DATABASE_URL', 'DATABASE_URL_SYSTEM', 'BETTER_AUTH_SECRET', 'PUBLIC_ORIGIN', 'SMTP_URL', 'MAIL_FROM'])(
    'a missing %s is named',
    (name) => {
      const err = errorOf({ ...valid(), [name]: undefined })
      expect(err.message).toContain(name)
      expect(err.variables).toContain(name)
    },
  )

  test('rejects a missing BETTER_AUTH_SECRET', () => {
    expect(errorOf({ ...valid(), BETTER_AUTH_SECRET: undefined }).variables).toEqual(['BETTER_AUTH_SECRET'])
  })

  test('rejects a BETTER_AUTH_SECRET shorter than 32 bytes and never prints it', () => {
    const short = 'short-secret-31-bytes-long-abcd'
    expect(short).toHaveLength(31)
    const err = errorOf({ ...valid(), BETTER_AUTH_SECRET: short })
    expect(err.variables).toEqual(['BETTER_AUTH_SECRET'])
    expect(err.message).toContain('BETTER_AUTH_SECRET')
    expect(err.message).not.toContain(short)
    expect(String(err.stack)).not.toContain(short)
    expect(JSON.stringify(err)).not.toContain(short)
  })

  test('counts bytes, not characters', () => {
    expect(() => parseEnv({ ...valid(), BETTER_AUTH_SECRET: 'é'.repeat(16) })).not.toThrow() // 32 bytes
    expect(errorOf({ ...valid(), BETTER_AUTH_SECRET: 'é'.repeat(15) + 'a' }).variables).toEqual(['BETTER_AUTH_SECRET'])
  })

  test.each(['http://consent.example', 'http://localhost.example', 'http://10.0.0.1:4321'])('rejects the plain-http origin %s', (origin) => {
    expect(errorOf({ ...valid(), PUBLIC_ORIGIN: origin }).variables).toEqual(['PUBLIC_ORIGIN'])
  })

  test.each(['http://localhost:4321', 'http://127.0.0.1:4321', 'http://[::1]:4321'])('accepts the local http origin %s outside production', (origin) => {
    for (const NODE_ENV of ['development', 'test', undefined]) {
      expect(parseEnv({ ...valid(), NODE_ENV, PUBLIC_ORIGIN: origin }).PUBLIC_ORIGIN).toBe(origin)
    }
  })

  test.each(['http://localhost:4321', 'http://127.0.0.1:4321', 'http://[::1]:4321'])('rejects the http origin %s in production', (origin) => {
    const err = errorOf({ ...valid(), NODE_ENV: 'production', PUBLIC_ORIGIN: origin })
    expect(err.variables).toEqual(['PUBLIC_ORIGIN'])
    expect(err.message).toMatch(/production/)
    expect(err.message).not.toContain(origin)
  })

  test.each(['consent.example', 'ftp://consent.example', 'https://consent.example/app', 'https://consent.example/?x=1', 'https://user:pw@consent.example'])(
    'rejects %s, which is not a bare origin',
    (origin) => {
      expect(errorOf({ ...valid(), PUBLIC_ORIGIN: origin }).variables).toEqual(['PUBLIC_ORIGIN'])
    },
  )

  test('rejects a database URL that is not postgres', () => {
    expect(errorOf({ ...valid(), DATABASE_URL: 'mysql://u:p@h/db' }).variables).toEqual(['DATABASE_URL'])
  })

  test('rejects an SMTP URL that is not smtp(s)', () => {
    expect(errorOf({ ...valid(), SMTP_URL: 'https://mail.example' }).variables).toEqual(['SMTP_URL'])
  })

  test('rejects a SUPER_ADMIN_EMAILS entry that is not an email', () => {
    expect(errorOf({ ...valid(), SUPER_ADMIN_EMAILS: 'ada@example.com,nope' }).variables).toEqual(['SUPER_ADMIN_EMAILS'])
  })

  test('rejects an unknown NODE_ENV', () => {
    expect(errorOf({ ...valid(), NODE_ENV: 'staging' }).variables).toEqual(['NODE_ENV'])
  })

  test('names every invalid variable at once and prints none of their values', () => {
    const bad = {
      ...valid(),
      DATABASE_URL: 'mysql://leaky-user:leaky-db-pw@h/db',
      SMTP_URL: 'gopher://leaky-mail-pw@h',
      BETTER_AUTH_SECRET: 'leaky-short',
    }
    const err = errorOf(bad)
    expect(err.variables.sort()).toEqual(['BETTER_AUTH_SECRET', 'DATABASE_URL', 'SMTP_URL'])
    for (const leak of ['leaky-user', 'leaky-db-pw', 'leaky-mail-pw', 'leaky-short', 'mysql', 'gopher']) {
      expect(err.message).not.toContain(leak)
      expect(String(err.stack)).not.toContain(leak)
    }
    expect(err.cause).toBeUndefined()
  })
})
