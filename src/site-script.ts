import { readFile } from 'node:fs/promises'
import { assertValidatedConfig, toPublicJson } from './config'
import type { ConsentConfig } from './schema'
import type { StandaloneBundle } from './standalone'

export interface SiteScriptInput {
  /** Site key, sent with consent records and blocked-tracker reports. */
  site: string
  /** The site's configuration, from `defineConsent`. */
  config: ConsentConfig
  /** Where reports of unconfigured trackers and unknown marked ids go (hosted CMP only). */
  reportUrl?: string
}

export interface SiteScriptOptions {
  /** The standalone runtime's text (see `readRuntime`); default: read from the package's dist/standalone/cloveconsent.js. */
  runtime?: string
}

// from src/ (tests) and from dist/ (the package) alike: both sit next to dist/
const defaultRuntime = new URL('../dist/standalone/cloveconsent.js', import.meta.url)

/**
 * Reads the standalone runtime's text, for callers that load it once and pass it to every `buildSiteScript` call. Default: the
 * package's dist/standalone/cloveconsent.js (give the path when this module is bundled into an app, where that one is not found).
 */
export function readRuntime(path?: string): Promise<string> {
  return readFile(path ?? defaultRuntime, 'utf8')
}

const unsafe: Record<string, string> = { '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029' }

/** JSON that is also safe as script text in an HTML page: no `</script`, `<!--`, and no line terminators older engines reject. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (ch) => unsafe[ch]!)
}

/**
 * A site's single script: the standalone runtime, then one guarded `CloveConsent.boot(...)` call carrying the site key, the default
 * locale and one public configuration per enabled locale. Meant to be served as a classic script, first in `<head>`, without
 * `defer` or `async`, so auto-blocking is installed before the rest of the page is parsed.
 */
export async function buildSiteScript(input: SiteScriptInput, opts: SiteScriptOptions = {}): Promise<string> {
  const { site, config, reportUrl } = input
  assertValidatedConfig(config, 'buildSiteScript')
  const configs: Record<string, string> = {}
  for (const l of config.locales) configs[l] = toPublicJson(config, l)
  const bundle: StandaloneBundle = { site, defaultLocale: config.defaultLocale, configs }
  if (reportUrl !== undefined) bundle.reportUrl = reportUrl
  const runtime = opts.runtime ?? await readRuntime()
  // guarded: a runtime that failed to define its global leaves the page alone instead of throwing a TypeError into it
  return `${runtime.trimEnd()}\nif(typeof CloveConsent=="object")CloveConsent.boot(${scriptJson(bundle)});\n`
}
