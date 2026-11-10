import { defineConsent } from '../../../src/config'
import type { LocalePack } from '../../../src/i18n/pack'
import type { ConsentConfig } from '../../../src/schema'
import type { UiSettingsInput } from '../../../src/ui-settings'
import { SAMPLE_ARGS, type CatalogItem } from './catalog'

export interface PlaygroundState {
  locales: string[]; defaultLocale: string; previewLocale: string
  services: string[]; processors: string[]        // CatalogItem.name values
  args: Record<string, string>                     // name -> JSON text passed to create(); absent -> SAMPLE_ARGS or no args
  revision: string                                 // kept as text so bad input reaches validation
  darkMode: boolean; privacyHref: string; allowFallback: boolean
  theme: 'light' | 'dark'
}

export const DEFAULT_STATE: PlaygroundState = {
  locales: ['en', 'sk'], defaultLocale: 'en', previewLocale: 'en',
  services: ['turnstile', 'theme', 'youtube'], processors: ['cloudflareCdn'],
  args: {}, revision: '1', darkMode: true, privacyHref: '', allowFallback: false, theme: 'light',
}

const ARGS_PREFIX = 'args.'

// `s=1` marks a submitted form: there an absent checkbox means false/empty, not "use the default"
export function parseState(q: URLSearchParams): PlaygroundState {
  const submitted = q.get('s') === '1'
  const list = (key: string, dflt: string[]) => (submitted || q.has(key) ? q.getAll(key) : dflt)
  const flag = (key: string, dflt: boolean) => (submitted || q.has(key) ? q.get(key) === '1' : dflt)
  const args: Record<string, string> = {}
  for (const [k, v] of q) if (k.startsWith(ARGS_PREFIX) && v !== '') args[k.slice(ARGS_PREFIX.length)] = v
  return {
    locales: list('locales', DEFAULT_STATE.locales),
    defaultLocale: q.get('defaultLocale') ?? DEFAULT_STATE.defaultLocale,
    previewLocale: q.get('previewLocale') ?? DEFAULT_STATE.previewLocale,
    services: list('services', DEFAULT_STATE.services),
    processors: list('processors', DEFAULT_STATE.processors),
    args,
    revision: q.get('revision') ?? DEFAULT_STATE.revision,
    darkMode: flag('darkMode', DEFAULT_STATE.darkMode),
    privacyHref: q.get('privacyHref') ?? DEFAULT_STATE.privacyHref,
    allowFallback: flag('allowFallback', DEFAULT_STATE.allowFallback),
    theme: q.get('theme') === 'dark' ? 'dark' : q.has('theme') ? 'light' : DEFAULT_STATE.theme,
  }
}

export function toQuery(s: PlaygroundState): string {
  const q = new URLSearchParams({ s: '1' })
  for (const l of s.locales) q.append('locales', l)
  q.set('defaultLocale', s.defaultLocale)
  q.set('previewLocale', s.previewLocale)
  for (const n of s.services) q.append('services', n)
  for (const n of s.processors) q.append('processors', n)
  for (const [n, v] of Object.entries(s.args)) q.set(ARGS_PREFIX + n, v)
  q.set('revision', s.revision)
  if (s.darkMode) q.set('darkMode', '1')
  q.set('privacyHref', s.privacyHref)
  if (s.allowFallback) q.set('allowFallback', '1')
  q.set('theme', s.theme)
  return q.toString()
}

export interface BuildResult { config: ConsentConfig | null; error: string | null; warnings: string[] }

export function buildConfig(s: PlaygroundState, catalog: CatalogItem[], packs: LocalePack[], ui?: UiSettingsInput): BuildResult {
  const warnings: string[] = []
  const fail = (error: string): BuildResult => ({ config: null, error, warnings })
  const realWarn = console.warn
  console.warn = (...a: unknown[]) => { warnings.push(a.map(String).join(' ')) }
  try {
    if (s.locales.length === 0) return fail('enable at least one language')
    if (!/^\d+$/.test(s.revision.trim())) return fail('revision must be a whole number')
    if (!s.locales.includes(s.previewLocale)) return fail('preview language must be one of the enabled languages')
    const make = (name: string, kind: 'service' | 'processor') => {
      const item = catalog.find((c) => c.name === name)
      if (!item) throw new Error(`unknown catalog entry: ${name}`)
      const text = s.args[name]?.trim()
      let args: unknown = SAMPLE_ARGS[name]
      if (text) {
        try { args = JSON.parse(text) } catch { throw new Error(`options for ${name} are not valid JSON`) }
      }
      const entry = item.create(args)
      if (kind === 'service' && entry.kind === 'processor') throw new Error(`${name} is a processor`)
      if (kind === 'processor' && entry.kind !== 'processor') throw new Error(`${name} is a service`)
      return entry
    }
    const services = s.services.map((n) => make(n, 'service'))
    const processors = s.processors.map((n) => make(n, 'processor'))
    const config = defineConsent({
      locales: s.locales,
      defaultLocale: s.defaultLocale,
      revision: Number(s.revision),
      darkMode: s.darkMode,
      privacyHref: s.privacyHref || undefined,
      allowFallback: s.allowFallback,
      services: services as Extract<typeof services[number], { kind: 'client' | 'first-party' }>[],
      processors: processors as Extract<typeof processors[number], { kind: 'processor' }>[],
      packs,
      ui,
    })
    return { config, error: null, warnings }
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e))
  } finally {
    console.warn = realWarn
  }
}
