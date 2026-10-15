import { expect, test } from 'vitest'
import { isDev, isDevFrom } from '../src/dev'

test.each([
  ['vite dev', { DEV: true }, undefined, true],
  ['vite build', { DEV: false }, undefined, false],
  ['vite build wins over a stray NODE_ENV', { DEV: false }, 'development', false],
  ['import.meta.env without DEV', {}, 'development', false],
  ['node, NODE_ENV=production', undefined, 'production', false],
  ['node, NODE_ENV=development', undefined, 'development', true],
  ['node, NODE_ENV=test', undefined, 'test', true],
  ['browser without a bundler (no env at all)', undefined, undefined, false],
])('%s', (_n, meta, nodeEnv, want) => {
  expect(isDevFrom(meta as { DEV?: unknown } | undefined, nodeEnv)).toBe(want)
})

test('vitest counts as dev', () => expect(isDev()).toBe(true))
