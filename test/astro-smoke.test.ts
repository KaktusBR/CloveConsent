import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { beforeAll, expect, test } from 'vitest'

const fixtures = join(__dirname, '..', 'fixtures')
const site = join(fixtures, 'astro-site')
const astroBin = join(__dirname, '..', 'node_modules', 'astro', 'bin', 'astro.mjs')
const build = (root: string) =>
  spawnSync(process.execPath, [astroBin, 'build', '--root', root], { encoding: 'utf8' })

let html = ''
beforeAll(() => {
  const r = build(site)
  if (r.status !== 0) throw new Error(`astro build failed:\n${r.stdout}\n${r.stderr}`)
  html = readFileSync(join(site, 'dist', 'index.html'), 'utf8')
}, 120_000)

const blob = () => {
  const m = html.match(/<script([^>]*)id="consent-config"([^>]*)>([\s\S]*?)<\/script>/)
  expect(m).not.toBeNull()
  return { attrs: `${m![1]}${m![2]}`, body: m![3]! }
}

test('banner config block is present, json, and has no raw angle brackets inside', () => {
  const { body } = blob()
  expect(body).not.toMatch(/[<>]/)
  expect(JSON.parse(body).services.length).toBe(3)
})
test('banner blob has the expected services, locales, locale attribute and no hooks', () => {
  const { attrs, body } = blob()
  const cfg = JSON.parse(body)
  expect(attrs).toContain('data-locale="sk"')
  expect(cfg.services.map((s: { id: string }) => s.id)).toEqual(['cloudflare-turnstile', 'theme', 'youtube'])
  expect(cfg.locales).toEqual(['sk'])
  expect(Object.keys(cfg.messages)).toEqual(['sk'])
  expect(cfg).not.toHaveProperty('hooks')
})
test('embed renders as a placeholder, not an iframe, with the exact src', () => {
  expect(html).toContain('data-consent-embed')
  expect(html).toContain('data-consent-placeholder')
  expect(html).toContain('data-consent-src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"')
  expect(html).not.toContain('<iframe')
})
test('preferences table matches the selected entries only', () => {
  expect(html).toContain('data-service="theme"')
  expect(html).toContain('>theme<')
  expect(html).not.toContain('data-service="vimeo"')
  for (const c of ['necessary', 'functional', 'media']) expect(html).toContain(`data-category="${c}"`)
  expect(html).not.toContain('data-category="analytics"')
})
test('processor list renders facts', () => {
  expect(html).toContain('data-processor="cloudflare-cdn"')
  expect(html).toContain('Globálna sieť')
  expect(html).toContain('Doručovanie a ochrana stránky (CDN, ochrana pred útokmi).')
  expect(html).toContain('<a href="https://www.cloudflare.com/privacypolicy/" rel="noopener noreferrer">')
})
test('settings panel renders without script, read-only, with a reference block and dir/lang', () => {
  expect(html).toContain('data-consent-settings')
  expect(html).toContain('consent-receipt')
  expect(html).toContain('<div dir="ltr" lang="sk"><section class="consent-settings"')
  const panel = html.slice(html.indexOf('data-consent-settings'))
  const switches = panel.match(/<input[^>]*role="switch"[^>]*>/g) ?? []
  expect(switches.length).toBeGreaterThan(0)
  for (const s of switches) expect(s, s).toMatch(/\sdisabled[\s>]/)
  expect(panel.slice(0, panel.indexOf('consent-processors'))).not.toContain('data-consent-action')
})
test('the built stylesheet carries the settings panel styles', () => {
  const dir = join(site, 'dist', '_astro')
  const css = readdirSync(dir).filter((f) => f.endsWith('.css')).map((f) => readFileSync(join(dir, f), 'utf8')).join(' ')
  expect(css).toContain('.consent-settings')
})
test('reopen button is present', () => {
  expect(html).toContain('data-consent-open')
})

test('GatedEmbed fails the build for a src host that is not allowed', () => {
  const r = build(join(fixtures, 'astro-site-bad-src'))
  expect(r.status).not.toBe(0)
  expect(`${r.stdout}${r.stderr}`).toContain('not allowed')
}, 120_000)
test('components fail the build for a config that did not come from defineConsent', () => {
  const r = build(join(fixtures, 'astro-site-unvalidated'))
  expect(r.status).not.toBe(0)
  expect(`${r.stdout}${r.stderr}`).toContain('ProcessorList: config must be the result of defineConsent()')
}, 120_000)
test('GatedEmbed fails the build for a service that is not a selected client service', () => {
  const r = build(join(fixtures, 'astro-site-bad-service'))
  expect(r.status).not.toBe(0)
  expect(`${r.stdout}${r.stderr}`).toContain('not a selected client service')
}, 120_000)
test('a language without a pack fails the site build and names the missing strings', () => {
  const r = build(join(fixtures, 'astro-site-missing-translation'))
  const output = `${r.stdout}${r.stderr}`
  expect(r.status).not.toBe(0)
  expect(output).toMatch(/missing translations/)
  expect(output).toMatch(/pl: youtube title/)
}, 120_000)
