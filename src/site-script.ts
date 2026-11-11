import { readFile } from 'node:fs/promises'
import { assertValidatedConfig, toPublicJson } from './config'
import type { ConsentConfig } from './schema'
import type { StandaloneBundle } from './standalone'

export interface SiteScriptInput {
  /** Site key, sent with consent records and unconfigured-tracker reports. */
  site: string
  /** The site's configuration, from `defineConsent`. */
  config: ConsentConfig
  /** Where unconfigured-tracker reports go (hosted CMP only). */
  reportUrl?: string
}

export interface SiteScriptOptions {
  /** Path of the standalone runtime; default: the package's dist/standalone/cloveconsent.js. */
  runtime?: string
}

// from src/ (tests) and from dist/ (the package) alike: both sit next to dist/
const defaultRuntime = new URL('../dist/standalone/cloveconsent.js', import.meta.url)

const unsafe: Record<string, string> = { '<': '\\u003c', '>': '\\u003e', '&': '\\u0026', '\u2028': '\\u2028', '\u2029': '\\u2029' }

/** JSON that is also safe as script text in an HTML page: no `</script`, `<!--`, and no line terminators older engines reject. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (ch) => unsafe[ch]!)
}

/**
 * A site's single script: the standalone runtime, then one `CloveConsent.boot(...)` call carrying the site key, the default
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
  const runtime = await readFile(opts.runtime ?? defaultRuntime, 'utf8')
  return `${runtime.trimEnd()}\nCloveConsent.boot(${scriptJson(bundle)});\n`
}
