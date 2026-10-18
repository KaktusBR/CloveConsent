import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const root = join(__dirname, '..')

test('admin is not in the published package', () => {
  const r = spawnSync('npm pack --dry-run --json', { cwd: root, encoding: 'utf8', shell: true })
  expect(r.status).toBe(0)
  const [pack] = JSON.parse(r.stdout) as { files: { path: string }[] }[]
  expect(pack!.files.length).toBeGreaterThan(0)
  expect(pack!.files.filter((f) => f.path.startsWith('admin/'))).toEqual([])
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  expect(pkg.files).toEqual(['dist', 'src/astro'])
})
