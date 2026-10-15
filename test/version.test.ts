import { describe, expect, test } from 'vitest'
import { LABELS, latest, nextVersion, parseLabels, pickLabel, plan } from '../scripts/version.mjs'

describe('latest', () => {
  test('no tags', () => expect(latest([])).toBeNull())
  test('compares numerically, not as text', () => expect(latest(['v1.2.3', 'v1.10.0', 'v1.9.9'])).toEqual([1, 10, 0]))
  test('picks the highest major', () => expect(latest(['v2.0.0', 'v1.5.0'])).toEqual([2, 0, 0]))
  test('ignores junk', () => {
    expect(latest(['v1.2', 'v1.2.3-rc1', 'latest', 'v01.2.3', 'v1.0.0 ', '', 'x1.0.0'])).toBeNull()
    expect(latest(['v9.9.9-beta', 'v1.0.0', 'v1.2', 'v1.0.0\n'])).toEqual([1, 0, 0])
  })
})

describe('pickLabel', () => {
  test.each(LABELS)('accepts %s alone', (l) => expect(pickLabel([l])).toEqual({ label: l }))
  test('finds the label among others', () => expect(pickLabel(['bug', 'release:minor', 'docs'])).toEqual({ label: 'release:minor' }))
  test('none is an error that says what to do', () => {
    const r = pickLabel(['bug']) as { error: string }
    expect(r.error).toMatch(/exactly one/)
    expect(r.error).toMatch(/release:patch/)
  })
  test('two release labels is an error', () => expect((pickLabel(['release:minor', 'release:patch']) as { error: string }).error).toMatch(/more than one/))
  test('a typo is not a label', () => expect(pickLabel(['release:huge', 'release:Minor'])).toHaveProperty('error'))
})

describe('nextVersion', () => {
  test('first release is 0.1.0 for any releasing label', () => {
    for (const l of ['release:major', 'release:minor', 'release:patch']) expect(nextVersion([], l)).toBe('0.1.0')
    expect(nextVersion([], 'release:none')).toBeNull()
  })
  test('before 1.0: major bumps the minor; minor and patch bump the patch', () => {
    expect(nextVersion(['v0.1.4'], 'release:major')).toBe('0.2.0')
    expect(nextVersion(['v0.1.4'], 'release:minor')).toBe('0.1.5')
    expect(nextVersion(['v0.1.4'], 'release:patch')).toBe('0.1.5')
    expect(nextVersion(['v0.0.3'], 'release:major')).toBe('0.1.0')
  })
  test('from 1.0 on: each label bumps what it names', () => {
    expect(nextVersion(['v1.2.3'], 'release:major')).toBe('2.0.0')
    expect(nextVersion(['v1.2.3'], 'release:minor')).toBe('1.3.0')
    expect(nextVersion(['v1.2.3'], 'release:patch')).toBe('1.2.4')
    expect(nextVersion(['v1.9.0', 'v1.10.0'], 'release:patch')).toBe('1.10.1')
  })
  test('release:none never releases', () => expect(nextVersion(['v1.2.3'], 'release:none')).toBeNull())
  test('an unknown label throws', () => expect(() => nextVersion(['v1.0.0'], 'release:huge')).toThrow(/unknown label/))
})

describe('plan', () => {
  test('releases with a valid label', () => expect(plan(['v0.1.0'], ['release:patch'])).toEqual({ release: '0.1.1' }))
  test('skips with none', () => expect(plan(['v0.1.0'], ['release:none'])).toEqual({ skip: 'release:none' }))
  test('skips with no label and says why', () => expect((plan(['v0.1.0'], []) as { skip: string }).skip).toMatch(/exactly one/))
  test('skips with two labels', () => expect(plan([], ['release:major', 'release:minor'])).toHaveProperty('skip'))
})

describe('parseLabels', () => {
  test('accepts an array of strings', () => {
    expect(parseLabels('[]')).toEqual([])
    expect(parseLabels('["a","release:minor"]')).toEqual(['a', 'release:minor'])
  })
  test.each(['', 'x', '{}', 'null', '[1]', '["a",2]', '"release:minor"'])('rejects %j', (s) => expect(() => parseLabels(s)).toThrow())
})
