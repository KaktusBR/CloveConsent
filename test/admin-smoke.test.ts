// @vitest-environment node
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { DEFAULT_STATE, toQuery } from '../admin/src/lib/playground'
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

test('/languages shows the text grid with packs and review state', async () => {
  const html = await get('/languages')
  for (const s of ['bannerTitle', 'Používame cookies', '>unreviewed<']) expect(html).toContain(s)
})

test('/ shows where each entry is translated', async () => {
  expect(await get('/')).toContain('Translated in:')
})

test('/playground has the form, the cloudflareCdn checkbox and the preview iframe', async () => {
  const html = await get('/playground')
  for (const s of ['<iframe', 'cloudflareCdn', 'right-to-left test']) expect(html).toContain(s)
})

test('/preview renders the real banner config and the reset button', async () => {
  const html = await get('/preview')
  expect(html).toContain('id="consent-config"')
  expect(html).toContain('Reset consent')
})

test('/preview shows a bad config as an error', async () => {
  const html = await get('/preview?s=1&services=nope&locales=en&defaultLocale=en&previewLocale=en&revision=1')
  expect(html).toContain('unknown catalog entry: nope')
})

test('/preview honours the page theme', async () => {
  expect(await get('/preview?' + toQuery({ ...DEFAULT_STATE, theme: 'dark' }))).toContain('class="dark"')
})

test('/manager renders the settings panel, processors and the gated embed', async () => {
  const html = await get('/manager?tokens=none')
  for (const s of ['data-consent-settings', 'data-consent-embed', 'id="consent-config"', 'Manager']) expect(html).toContain(s)
})

test('/manager?tokens=dark puts the dark class and the dark tokens on html', async () => {
  const html = await get('/manager?tokens=dark')
  expect(html).toMatch(/<html[^>]*class="dark"/)
  expect(html).toContain('#0f1616')
  expect(html).toContain('#86c5c6')
})

test('/manager?tokens=light defines the light tokens without the dark class', async () => {
  const html = await get('/manager?tokens=light')
  expect(html).not.toMatch(/<html[^>]*class="dark"/)
  expect(html).toContain('#193637')
})

test('/manager falls back to no tokens and the bar banner for invalid values', async () => {
  const bad = await get('/manager?tokens=bogus&banner=nope')
  const none = await get('/manager?tokens=none')
  expect(bad).not.toMatch(/<html[^>]*class="dark"/)
  for (const s of ['#193637', '#0f1616', '#86c5c6']) expect(bad).not.toContain(s)
  expect(bad).toContain('"layout":"bar"')
  expect(none).not.toContain('#193637')
})

test('/manager?banner=box passes the layout through the config', async () => {
  expect(await get('/manager?banner=box')).toContain('"layout":"box"')
})
