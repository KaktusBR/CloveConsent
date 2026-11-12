import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

// The hosted app in cmp/ has its own package, tooling and CI; the library's tooling must not see it.
const root = join(__dirname, '..')
const slashes = (p: string) => p.replaceAll('\\', '/')
const cmpDir = `${slashes(root)}/cmp/`
const inCmp = (p: string) => slashes(p).startsWith(cmpDir)

test('cmp/ is not in the published package', () => {
  const r = spawnSync('npm pack --dry-run --json', { cwd: root, encoding: 'utf8', shell: true })
  expect(r.status).toBe(0)
  const [pack] = JSON.parse(r.stdout) as { files: { path: string }[] }[]
  expect(pack!.files.length).toBeGreaterThan(0)
  expect(pack!.files.filter((f) => f.path.startsWith('cmp/'))).toEqual([])
}, 30_000)

test('the root typecheck compiles no file from cmp/', () => {
  const r = spawnSync('npx tsc --listFilesOnly -p tsconfig.json', { cwd: root, encoding: 'utf8', shell: true })
  expect(r.status).toBe(0)
  const files = r.stdout.split('\n').map((s) => s.trim()).filter(Boolean)
  expect(files.some((f) => f.includes('/src/'))).toBe(true)
  expect(files.filter(inCmp)).toEqual([])
}, 60_000)

test('the library CI does not run for cmp/-only changes', () => {
  const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')
  expect(ci).toMatch(/paths-ignore:[^\n]*'cmp\/\*\*'/)
  expect(ci).toMatch(/paths-ignore:[^\n]*'\.github\/workflows\/cmp\.yml'/)
})
