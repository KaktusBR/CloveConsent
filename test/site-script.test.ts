// @vitest-environment node
// The per-site script: the real standalone runtime (built once here, as `npm run build` does) and one boot call.
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createContext, Script } from 'node:vm'
import { gzipSync } from 'node:zlib'
import { build } from 'tsup'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { standaloneBuild } from '../tsup.config'
import { defineConsent, toPublicJson } from '../src/config'
import { googleAnalytics, googleTagManager, metaPixel, openStreetMap, turnstile, youtube } from '../src/catalog'
import sk from '../src/locales/sk'
import { buildSiteScript, readRuntime } from '../src/site-script'
import type { Consent } from '../src/client'
import type { ClientEntry } from '../src/schema'
import type { StandaloneBundle } from '../src/standalone'

const jsdom = createRequire(import.meta.url)('jsdom') as {
  JSDOM: new (html: string, o: object) => { window: Window & typeof globalThis & { CloveConsent?: { boot(b: StandaloneBundle): Consent | null } } }
  VirtualConsole: new () => { on(event: string, f: (...args: unknown[]) => void): void }
}

// line and paragraph separators: allowed in texts, line terminators to older script engines
const LS = String.fromCharCode(0x2028)
const PS = String.fromCharCode(0x2029)
// texts are plain (no < >), the site key is not checked: it carries the markup
const site = 'key</script><script>alert(1)</script><!--'
const text = `Says hello${LS}and more${PS}& goodbye`
const widget: ClientEntry = {
  kind: 'client', id: 'widget', catalogRevision: 1, lastVerified: null, category: 'functional',
  provider: { name: 'Widget', privacyUrl: 'https://widget.example/privacy' },
  storage: [], gating: { type: 'none' }, origins: ['widget.example'],
  messages: { title: { en: 'Widget' }, description: { en: text } },
}
/** defineConsent without its expected development warnings (custom service, fallback language, unreviewed pack). */
function quietly<T>(f: () => T): T {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try { return f() } finally { warn.mockRestore() }
}
const config = quietly(() => defineConsent({
  locales: ['en', 'sk'], defaultLocale: 'en', packs: [sk], revision: 1, allowFallback: true,
  services: [widget, youtube(), googleTagManager({ containerId: 'GTM-ABC123' })],
}))
const sixServices = quietly(() => defineConsent({
  locales: ['en', 'sk'], defaultLocale: 'en', packs: [sk], revision: 1,
  services: [
    youtube(), googleTagManager({ containerId: 'GTM-ABC123' }), googleAnalytics({ measurementId: 'G-ABC123' }),
    metaPixel({ pixelId: '1234567890' }), openStreetMap(), turnstile(),
  ],
}))
const reportUrl = 'https://reports.example/unconfigured'

let outDir: string
let runtime: string
let script: string
// the runtime is built into a directory of its own: dist/standalone belongs to `npm run build`, which may be running too
beforeAll(async () => {
  outDir = await mkdtemp(join(tmpdir(), 'cloveconsent-runtime-'))
  await build({ ...standaloneBuild, outDir, config: false, silent: true })
  runtime = await readRuntime(join(outDir, 'cloveconsent.js'))
  script = await buildSiteScript({ site, config, reportUrl }, { runtime })
}, 60_000)
afterAll(async () => { await rm(outDir, { recursive: true, force: true }) })

const BOOT_LINE = '\nif(typeof CloveConsent'

/** The argument of the script's boot call, read by running that call against a stand-in runtime. */
function bootArgument(source: string): unknown {
  const call = source.slice(source.lastIndexOf(BOOT_LINE))
  const seen: unknown[] = []
  new Script(call).runInContext(createContext({ CloveConsent: { boot: (b: unknown) => seen.push(b) } }))
  expect(seen).toHaveLength(1)
  return seen[0]
}

/** Runs `script` inline, first in <head>, in a fresh jsdom page; resolves once the page has loaded, with what the page logged. */
async function page(lang: string) {
  const logged: string[] = []
  const virtualConsole = new jsdom.VirtualConsole()
  for (const level of ['error', 'warn', 'jsdomError']) virtualConsole.on(level, (...args) => logged.push(`${level}: ${args.map(String).join(' ')}`))
  const { window } = new jsdom.JSDOM(`<!DOCTYPE html><html lang="${lang}"><head><script>${script}</script></head>`
    + '<body><div data-cloveconsent-settings id="panel"></div></body></html>',
  { url: 'https://site.example/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole })
  if (window.document.readyState !== 'complete') await new Promise((r) => window.addEventListener('load', r, { once: true }))
  return { win: window, logged }
}

describe('buildSiteScript', () => {
  test('parses as JavaScript and ends with one boot call', () => {
    expect(() => new Script(script)).not.toThrow()
    expect(script.match(/CloveConsent\.boot\(/g)).toHaveLength(1)
    expect(script.trimEnd().endsWith(');')).toBe(true)
    expect(script.startsWith(runtime.trimEnd())).toBe(true)
  })

  test('the boot call is guarded: a runtime without its global leaves the page alone, a throwing one throws only its own error', async () => {
    const quiet = await buildSiteScript({ site: 's', config }, { runtime: '/* a runtime that defined nothing */' })
    expect(() => new Script(quiet).runInContext(createContext({}))).not.toThrow()
    const failing = await buildSiteScript({ site: 's', config }, { runtime: 'throw new Error("runtime failed")' })
    let thrown: unknown
    try { new Script(failing).runInContext(createContext({})) } catch (err) { thrown = err }
    expect((thrown as Error).message).toBe('runtime failed')
    expect((thrown as Error).name).toBe('Error')
  })

  test('contains no </script, <!--, & or raw line separators, even when the values do', () => {
    expect(script.toLowerCase()).not.toContain('</script')
    expect(script).not.toContain('<!--')
    expect(script).not.toContain(LS)
    expect(script).not.toContain(PS)
    const call = script.slice(script.lastIndexOf(BOOT_LINE))
    expect(call).not.toMatch(/[<>&]/)
  })

  test('the boot call carries the site key, the default locale, the report URL and one public JSON per enabled locale, exactly', () => {
    expect(bootArgument(script)).toEqual({
      site, defaultLocale: 'en', reportUrl,
      configs: { en: toPublicJson(config, 'en'), sk: toPublicJson(config, 'sk') },
    })
  })

  test('without a report URL the bundle has none', async () => {
    const out = await buildSiteScript({ site: 's', config }, { runtime })
    expect(bootArgument(out)).not.toHaveProperty('reportUrl')
  })

  test('boots in a jsdom window in the page language, with the exact texts, and binds the settings panel', async () => {
    const { win, logged } = await page('sk')
    expect(logged).toEqual([])
    // a later boot returns the client the script's own boot call started
    const consent = win.CloveConsent!.boot({ site: 'other', defaultLocale: 'en', configs: {} })
    expect(consent).not.toBeNull()
    expect(consent!.locale).toBe('sk')
    const entry = consent!.config.services.find((s) => s.id === 'widget') as ClientEntry
    expect(entry.messages.description.en).toBe(text)
    expect(win.document.querySelector('#panel [data-consent-action="accept-all"]')).not.toBeNull()
    win.close()
  })

  test('rejects a configuration that did not come from defineConsent', async () => {
    await expect(buildSiteScript({ site: 's', config: { ...config } })).rejects.toThrow(/defineConsent/)
  })

  test('size budget: 6 services in 2 languages is at most 46 KB gzipped', async () => {
    const out = await buildSiteScript({ site: 'site-key-1', config: sixServices }, { runtime })
    // growth guard; the 30 KB target is deferred to a follow-up that replaces the vanilla-cookieconsent engine (user decision 2026-11-11)
    expect(gzipSync(out).length).toBeLessThanOrEqual(46 * 1024)
  })
})
