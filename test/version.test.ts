import { describe, expect, test } from 'vitest'
import { nextVersion, skipRelease } from '../scripts/version.mjs'

describe('nextVersion', () => {
  test('first release is 1.0.0', () => expect(nextVersion([])).toBe('1.0.0'))
  test('bumps the minor and resets the patch', () => {
    expect(nextVersion(['v1.0.0'])).toBe('1.1.0')
    expect(nextVersion(['v1.4.7'])).toBe('1.5.0')
  })
  test('compares numerically, not as text', () => {
    expect(nextVersion(['v1.9.0', 'v1.10.0', 'v1.2.3'])).toBe('1.11.0')
  })
  test('uses the highest major', () => {
    expect(nextVersion(['v2.0.0', 'v1.5.0'])).toBe('2.1.0')
  })
  test('tags below 1.0.0 still start at 1.0.0', () => {
    expect(nextVersion(['v0.3.1'])).toBe('1.0.0')
  })
  test('ignores tags that are not plain vX.Y.Z', () => {
    expect(nextVersion(['v1.2', 'v1.2.3-rc1', 'foo', 'v01.2.3', 'v1.0.0 ', ''])).toBe('1.0.0')
    expect(nextVersion(['latest', 'v9.9.9-beta'])).toBe('1.0.0')
    expect(nextVersion(['v9.9.9-beta', 'v1.0.0', 'v1.2', 'v1.0.0\n'])).toBe('1.1.0')
  })
})

describe('skipRelease', () => {
  test('docs-only changes are skipped', () => {
    expect(skipRelease(['docs/a.md'])).toBe(true)
    expect(skipRelease(['README.md', 'docs/x/y.md', 'CLAUDE.md'])).toBe(true)
  })
  test('anything else is released', () => {
    expect(skipRelease(['src/a.ts'])).toBe(false)
    expect(skipRelease(['docs/a.md', 'src/a.ts'])).toBe(false)
    expect(skipRelease(['package.json'])).toBe(false)
    expect(skipRelease(['.github/workflows/ci.yml'])).toBe(false)
    expect(skipRelease(['scripts/release.mjs'])).toBe(false)
    expect(skipRelease(['test/a.md.ts'])).toBe(false)
    expect(skipRelease(['docs.json'])).toBe(false)
  })
  test('nested markdown outside docs is not docs-only', () => {
    expect(skipRelease(['src/NOTES.md'])).toBe(false)
  })
  test('an empty change list has nothing to release', () => {
    expect(skipRelease([])).toBe(true)
  })
})
