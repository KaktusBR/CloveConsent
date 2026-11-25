// The nightly backup script (backup/backup.sh), run with stand-ins for pg_dump and age: only a dump that
// was written whole is kept as a backup, and old backups are deleted only after a new one succeeded. A
// failed night leaves no file that looks like a backup, keeps every older one, and is reported as failed.
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

const SCRIPT = join(import.meta.dirname, '..', '..', 'backup', 'backup.sh')

/** A POSIX shell: `sh` on Linux and macOS, Git's on Windows. */
function posixShell(): string {
  if (process.platform !== 'win32') return 'sh'
  const gitExec = execFileSync('git', ['--exec-path'], { encoding: 'utf8' }).trim() // <git>/mingw64/libexec/git-core
  const sh = join(dirname(dirname(dirname(gitExec))), 'usr', 'bin', 'sh.exe')
  if (!existsSync(sh)) throw new Error(`no POSIX shell at ${sh}`)
  return sh
}

// pg_dump: STUB_PG_DUMP=ok writes a dump; fail writes part of one and fails.
// It also writes down what it was given: its arguments (anyone on the machine can read them) and
// PGPASSWORD (only its owner can).
const PG_DUMP = `#!/bin/sh
for arg in "$@"; do echo "$arg"; done > "$STUB_SEEN/argv"
echo "\${PGPASSWORD-(unset)}" > "$STUB_SEEN/pgpassword"
case "$STUB_PG_DUMP" in
  ok) printf 'PGDMP whole dump' ;;
  fail) printf 'PGDMP part'; echo 'pg_dump: error: connection lost' >&2; exit 1 ;;
esac
`
// age: STUB_AGE=ok passes the dump through (marked); fail reads some of it and fails.
const AGE = `#!/bin/sh
case "$STUB_AGE" in
  ok) printf 'age-encryption.org/v1 '; cat ;;
  fail) head -c 3 > /dev/null; echo 'age: error: bad recipient' >&2; exit 1 ;;
esac
`

let dir: string
let bin: string
let backups: string
const OLD = 'cmp-20200101T023000Z.dump.age'

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cmp-backup-test-'))
  bin = join(dir, 'bin')
  backups = join(dir, 'backups')
  for (const d of [bin, backups]) mkdirSync(d)
  writeFileSync(join(bin, 'pg_dump'), PG_DUMP, { mode: 0o755 })
  writeFileSync(join(bin, 'age'), AGE, { mode: 0o755 })
  // a good backup from long ago: past BACKUP_KEEP_DAYS
  writeFileSync(join(backups, OLD), 'age-encryption.org/v1 old')
  const longAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  utimesSync(join(backups, OLD), longAgo, longAgo)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function runBackup(pgDump: 'ok' | 'fail', age: 'ok' | 'fail', databaseUrl = 'postgres://cmp_backup:x@db/cmp') {
  const result = spawnSync(posixShell(), [SCRIPT, 'now'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`,
      STUB_PG_DUMP: pgDump,
      STUB_AGE: age,
      BACKUP_DIR: backups,
      BACKUP_DATABASE_URL: databaseUrl,
      PGPASSWORD: undefined,
      STUB_SEEN: dir,
      BACKUP_AGE_RECIPIENT: 'age1stub',
      BACKUP_KEEP_DAYS: '14',
    },
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}`, files: readdirSync(backups).sort() }
}

describe('backup.sh', () => {
  test('a whole dump is kept, encrypted, under its final name; then backups past BACKUP_KEEP_DAYS are deleted', () => {
    const { status, output, files } = runBackup('ok', 'ok')
    expect(status).toBe(0)
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^cmp-\d{8}T\d{6}Z\.dump\.age$/)
    expect(files[0]).not.toBe(OLD)
    expect(readFileSync(join(backups, files[0]!), 'utf8')).toBe('age-encryption.org/v1 PGDMP whole dump')
    expect(output).toContain('"msg":"backup written"')
  })

  for (const [pgDump, age, what] of [
    ['fail', 'ok', 'pg_dump fails'],
    ['ok', 'fail', 'age fails'],
  ] as const) {
    test(`when ${what}: no file is kept as a backup, no old backup is deleted, the run fails and says so`, () => {
      const { status, output, files } = runBackup(pgDump, age)
      expect(status).not.toBe(0)
      expect(files).toEqual([OLD])
      expect(output).toContain('"msg":"backup failed"')
      expect(output).not.toContain('backup written')
    })
  }
})

describe("backup.sh keeps the password out of pg_dump's arguments (ruling R27, M5)", () => {
  const seen = () => ({ argv: readFileSync(join(dir, 'argv'), 'utf8'), password: readFileSync(join(dir, 'pgpassword'), 'utf8').replace(/\n$/, '') })

  test('the password goes in PGPASSWORD, percent-decoded; the URL pg_dump gets has none', () => {
    const { status } = runBackup('ok', 'ok', 'postgres://cmp_backup:p%40ss%3Aw%2Frd%25x%5Cy%20z@db:5432/cmp?sslmode=require')
    expect(status).toBe(0)
    const { argv, password } = seen()
    expect(password).toBe(`p@ss:w/rd%x${String.fromCharCode(92)}y z`)
    expect(argv).toContain('--dbname=postgres://cmp_backup@db:5432/cmp?sslmode=require')
    for (const part of ['p%40ss', 'p@ss', 'w/rd']) expect(argv).not.toContain(part)
  })

  test('a URL without a password is passed as it is, with no PGPASSWORD', () => {
    expect(runBackup('ok', 'ok', 'postgres://cmp_backup@db/cmp').status).toBe(0)
    expect(seen()).toEqual({ argv: expect.stringContaining('--dbname=postgres://cmp_backup@db/cmp'), password: '(unset)' })
  })
})
