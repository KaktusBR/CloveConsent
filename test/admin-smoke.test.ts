// @vitest-environment node
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'

const root = join(__dirname, '..')
const astroBin = join(root, 'node_modules', 'astro', 'bin', 'astro.mjs')
const base = 'http://localhost:4390'
// vitest's env (VITEST*, NODE_ENV=test) makes astro dev serve nothing
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(VITEST|NODE_ENV$)/.test(k)))
let child: ChildProcess | undefined
let log = ''

const get = async (path: string): Promise<string> => {
  const res = await fetch(base + path)
  expect(res.status).toBe(200)
  return res.text()
}

beforeAll(async () => {
  child = spawn(process.execPath, [astroBin, 'dev', '--root', 'admin', '--port', '4390'], {
    cwd: root,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (d) => (log += d))
  child.stderr?.on('data', (d) => (log += d))
  const deadline = Date.now() + 60_000
  for (;;) {
    if (child.exitCode !== null) throw new Error(`astro dev exited early:\n${log}`)
    try {
      if ((await fetch(base + '/')).status === 200) return
    } catch {}
    if (Date.now() > deadline) throw new Error(`astro dev not ready in 60s:\n${log}`)
    await new Promise((r) => setTimeout(r, 300))
  }
}, 70_000)

afterAll(() => {
  if (!child?.pid) return
  if (process.platform === 'win32') spawnSync(`taskkill /pid ${child.pid} /T /F`, { shell: true })
  else child.kill()
})

test.each([
  ['/', 'Catalog'],
  ['/languages', 'Languages'],
  ['/playground', 'Playground'],
])('%s renders the tabs with %s active', async (path, active) => {
  const html = await get(path)
  expect(html).toContain('aria-current="page"')
  for (const label of ['Catalog', 'Languages', 'Playground']) expect(html).toContain(label)
  expect(html).toMatch(new RegExp(`aria-current="page"[^>]*>${active}<`))
})

test('/ lists the catalog entries, sample args and unverified notes', async () => {
  const html = await get('/')
  for (const s of ['cloudflare-turnstile', 'cloudflare-cdn', 'Example Host (sample)', 'UNVERIFIED']) expect(html).toContain(s)
})
