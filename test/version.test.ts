import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, test } from 'vitest'
import { LABELS, decide, latest, nextVersion, parseLabels, parsePullRequests, pickLabel, plan, skipBetween, skipRelease } from '../scripts/version.mjs'

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

describe('decide (what release.yml does with the merged pull requests of a push)', () => {
  test('no merged pull request (a direct push) releases nothing and says how to release', () => {
    const d = decide(['v0.1.0'], []) as { skip: string }
    expect(d.skip).toMatch(/direct push/)
    expect(d.skip).toMatch(/by hand/)
  })
  test('one merged pull request with a release label releases', () => {
    expect(decide([], [['bug', 'release:minor']])).toEqual({ release: '0.1.0' })
    expect(decide(['v0.1.0'], [['release:patch']])).toEqual({ release: '0.1.1' })
  })
  test('release:none skips quietly', () => expect(decide(['v0.1.0'], [['release:none']])).toEqual({ skip: 'release:none' }))
  test('a merged pull request without exactly one release label is an error, not a quiet skip', () => {
    expect(() => decide([], [[]])).toThrow(/exactly one/)
    expect(() => decide([], [['release:major', 'release:patch']])).toThrow(/more than one/)
  })
  test('more than one merged pull request is an error', () => {
    expect(() => decide([], [['release:patch'], ['release:minor']])).toThrow(/more than one merged pull request/)
  })
})

describe('parsePullRequests', () => {
  test('accepts an array of label arrays', () => {
    expect(parsePullRequests('[]')).toEqual([])
    expect(parsePullRequests('[["release:minor","x"]]')).toEqual([['release:minor', 'x']])
  })
  test.each(['', '{}', 'null', '["release:minor"]', '[[1]]', '[null]'])('rejects %j', (s) => expect(() => parsePullRequests(s)).toThrow())
})

describe('parseLabels', () => {
  test('accepts an array of strings', () => {
    expect(parseLabels('[]')).toEqual([])
    expect(parseLabels('["a","release:minor"]')).toEqual(['a', 'release:minor'])
  })
  test.each(['', 'x', '{}', 'null', '[1]', '["a",2]', '"release:minor"'])('rejects %j', (s) => expect(() => parseLabels(s)).toThrow())
})

describe('skipRelease', () => {
  test('docs-only and app-only (cmp/) changes are skipped', () => {
    expect(skipRelease(['docs/a.md'])).toBe(true)
    expect(skipRelease(['README.md', 'docs/x/y.md', 'CLAUDE.md'])).toBe(true)
    expect(skipRelease(['cmp/package.json', 'cmp/src/pages/healthz.ts', 'cmp/Dockerfile'])).toBe(true)
    expect(skipRelease(['.github/workflows/cmp.yml', 'cmp/README.md', 'docs/superpowers/plans/p.md'])).toBe(true)
  })
  test('a library change alongside cmp/ is released', () => {
    expect(skipRelease(['cmp/src/a.ts', 'src/a.ts'])).toBe(false)
    expect(skipRelease(['cmp/package.json', 'package.json'])).toBe(false)
    expect(skipRelease(['cmp/x.ts', '.github/workflows/ci.yml'])).toBe(false)
  })
  test('lookalikes of cmp/ are released', () => {
    expect(skipRelease(['cmp'])).toBe(false)
    expect(skipRelease(['cmp.ts'])).toBe(false)
    expect(skipRelease(['src/cmp/a.ts'])).toBe(false)
    expect(skipRelease(['cmpx/a.ts'])).toBe(false)
    expect(skipRelease(['.github/workflows/cmp.yml.bak'])).toBe(false)
  })
  test('anything else is released', () => {
    for (const f of ['src/a.ts', 'package.json', 'scripts/release.mjs', 'test/a.md.ts', 'docs.json', 'src/NOTES.md', 'tsconfig.json']) expect(skipRelease([f])).toBe(false)
  })
  test('an empty change list has nothing to release', () => expect(skipRelease([])).toBe(true))
})

describe('version.mjs skip (as release.yml runs it)', () => {
  const script = join(__dirname, '..', 'scripts', 'version.mjs')
  const repo = mkdtempSync(join(tmpdir(), 'cloveconsent-release-'))
  afterAll(() => rmSync(repo, { recursive: true, force: true }))
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim()
  const commit = (files: string[]) => {
    for (const f of files) {
      mkdirSync(join(repo, dirname(f)), { recursive: true })
      writeFileSync(join(repo, f), `${f} ${Math.random()}
`)
    }
    git('add', '-A')
    git('-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'c')
    return git('rev-parse', 'HEAD')
  }
  const skip = (before: string, after: string) => {
    const r = spawnSync(process.execPath, [script, 'skip', before, after], { cwd: repo, encoding: 'utf8' })
    return { status: r.status, out: r.stdout.trim(), err: r.stderr.trim() }
  }
  git('init', '-q')
  const base = commit(['src/index.ts', 'cmp/package.json'])

  test('a push that changes only cmp/ (and docs) prints true', () => {
    const after = commit(['cmp/src/pages/healthz.ts', 'cmp/Dockerfile', 'docs/notes.md', '.github/workflows/cmp.yml'])
    expect(skip(base, after)).toEqual({ status: 0, out: 'true', err: '' })
    expect(skipBetween(base, after, repo)).toBe(true)
  })
  test('a push that also touches the library prints false', () => {
    const before = git('rev-parse', 'HEAD')
    const after = commit(['cmp/src/a.ts', 'src/index.ts'])
    expect(skip(before, after)).toEqual({ status: 0, out: 'false', err: '' })
  })
  test('a new branch (all-zero before) releases', () => {
    expect(skip('0'.repeat(40), git('rev-parse', 'HEAD')).out).toBe('false')
  })
  test.each(['cmp/moved.ts', 'docs/moved.ts'])('moving a library file to %s releases (the source path counts)', (to) => {
    commit(['src/moved.ts'])
    const before = git('rev-parse', 'HEAD')
    git('mv', 'src/moved.ts', to)
    git('-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'mv')
    const after = git('rev-parse', 'HEAD')
    expect(git('diff', '--name-only', before, after)).toBe(to) // what rename detection alone would show
    expect(skip(before, after).out).toBe('false')
  })
  test('decide prints the decision as JSON; a bad pull request list is an error', () => {
    const run = (arg: string) => spawnSync(process.execPath, [script, 'decide', arg], { cwd: repo, encoding: 'utf8' })
    const ok = run('[["release:minor"]]')
    expect(ok.status).toBe(0)
    expect(JSON.parse(ok.stdout)).toEqual({ release: '0.1.0' }) // the scratch repo has no tags
    const bad = run('[[]]')
    expect(bad.status).toBe(1)
    expect(bad.stderr).toMatch(/exactly one/)
  })
  test('a malformed after-SHA is a usage error', () => {
    const r = skip(base, 'HEAD')
    expect(r.status).toBe(1)
    expect(r.err).toMatch(/usage/)
  })
})
