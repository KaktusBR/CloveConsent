import { describe, expect, test } from 'vitest'

import { buildOrigin } from '../../src/server/origin'

describe('buildOrigin: PUBLIC_ORIGIN for pages prerendered at build time', () => {
  test('a bare https origin, or http on a local host outside production', () => {
    expect(buildOrigin({ PUBLIC_ORIGIN: 'https://consent.example/' })).toBe('https://consent.example')
    expect(buildOrigin({ PUBLIC_ORIGIN: 'http://localhost:4321', NODE_ENV: 'test' })).toBe('http://localhost:4321')
  })

  test('missing or invalid: an error naming the variable, never its value', () => {
    for (const source of [{}, { PUBLIC_ORIGIN: '' }, { PUBLIC_ORIGIN: 'http://secret-host.test' }, { PUBLIC_ORIGIN: 'https://a.test/path' }, { PUBLIC_ORIGIN: 'http://localhost', NODE_ENV: 'production' }]) {
      expect(() => buildOrigin(source)).toThrow(/PUBLIC_ORIGIN/)
    }
    expect(() => buildOrigin({ PUBLIC_ORIGIN: 'http://secret-host.test' })).not.toThrow(/secret-host/)
  })
})
