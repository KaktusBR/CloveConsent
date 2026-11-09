import { ConsentConfigError } from './validate'

export const THEME_TOKENS = [
  'background', 'foreground', 'primary', 'primaryForeground', 'muted', 'mutedForeground', 'border', 'ring', 'radius', 'fontFamily',
] as const
export type ThemeToken = (typeof THEME_TOKENS)[number]

export interface UiSettings {
  banner: { layout: 'bar' | 'box' | 'cloud'; position: string; equalWeightButtons: boolean; flipButtons: boolean }
  dialog: { layout: 'box' | 'bar'; position: 'left' | 'right' }
  manager: { receipt: boolean; serviceToggles: boolean; storageTables: boolean; processors: boolean; withdraw: boolean; details: 'open' | 'collapsed' }
  theme: { tokens: Partial<Record<ThemeToken, string>> }
}
export type UiSettingsInput = { [K in keyof UiSettings]?: Partial<UiSettings[K]> }

export const DEFAULT_UI: UiSettings = {
  banner: { layout: 'bar', position: 'bottom', equalWeightButtons: true, flipButtons: false },
  dialog: { layout: 'box', position: 'right' },
  manager: { receipt: true, serviceToggles: true, storageTables: true, processors: true, withdraw: true, details: 'collapsed' },
  theme: { tokens: {} },
}

const MAX_TOKEN = 100
const COLOR = /^(?:#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla|oklch|oklab)\([0-9a-zA-Z.,%/ +-]*\)|var\(--[a-z0-9-]{1,40}\))$/
const RADIUS = /^(?:0|\d{1,3}(?:\.\d{1,3})?(?:px|rem|em|%))$/
const FONT_FAMILY = /^[A-Za-z0-9 ,"'_-]+$/
const BAR_POSITIONS = ['top', 'bottom']
const FLOATING_POSITIONS = [
  'top', 'bottom', 'top left', 'top center', 'top right', 'bottom left', 'bottom center', 'bottom right', 'middle', 'middle center',
]

const TOKEN_PATTERNS: Record<ThemeToken, RegExp> = {
  background: COLOR, foreground: COLOR, primary: COLOR, primaryForeground: COLOR, muted: COLOR, mutedForeground: COLOR, border: COLOR, ring: COLOR,
  radius: RADIUS, fontFamily: FONT_FAMILY,
}
const COLOR_HINT = 'a colour (hex, rgb(), hsl(), oklch(), oklab() or var(--name))'
const TOKEN_HINT: Partial<Record<ThemeToken, string>> = {
  radius: 'a length such as 0.5rem or 8px',
  fontFamily: 'a font list of letters, digits, spaces, commas and quotes (or inherit)',
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function section(v: unknown, path: string, allowed: readonly string[]): Record<string, unknown> {
  if (v === undefined) return {}
  if (!isObject(v)) throw new ConsentConfigError(path, 'must be an object')
  for (const k of Object.keys(v)) {
    if (!allowed.includes(k)) throw new ConsentConfigError(`${path}.${k}`, `unknown key (allowed: ${allowed.join(', ')})`)
  }
  return v
}
function oneOf<T extends string>(v: unknown, path: string, options: readonly T[], fallback: T): T {
  if (v === undefined) return fallback
  if (typeof v !== 'string' || !options.includes(v as T)) throw new ConsentConfigError(path, `must be one of: ${options.join(', ')}`)
  return v as T
}
function bool(v: unknown, path: string, fallback: boolean): boolean {
  if (v === undefined) return fallback
  if (typeof v !== 'boolean') throw new ConsentConfigError(path, 'must be true or false')
  return v
}

function tokenValue(name: ThemeToken, v: unknown, path: string): string {
  if (typeof v !== 'string' || v === '') throw new ConsentConfigError(path, 'must be a non-empty string')
  if (v.length > MAX_TOKEN) throw new ConsentConfigError(path, `must be at most ${MAX_TOKEN} characters`)
  if (name === 'fontFamily' && v === 'inherit') return v
  if (!TOKEN_PATTERNS[name].test(v)) {
    throw new ConsentConfigError(path, `must be ${TOKEN_HINT[name] ?? COLOR_HINT}`)
  }
  return v
}

/** Validates the `ui` settings and fills in the defaults. Rejects unknown keys at every level. */
export function resolveUi(input: unknown, path = 'ui'): UiSettings {
  const root = section(input, path, Object.keys(DEFAULT_UI))
  const d = DEFAULT_UI

  const bn = section(root.banner, `${path}.banner`, Object.keys(d.banner))
  const layout = oneOf(bn.layout, `${path}.banner.layout`, ['bar', 'box', 'cloud'] as const, d.banner.layout)
  // the default position (bottom) is valid for every layout; an explicit one must fit the layout
  const positions = layout === 'bar' ? BAR_POSITIONS : FLOATING_POSITIONS
  const position = oneOf(bn.position, `${path}.banner.position`, positions, d.banner.position)

  const dg = section(root.dialog, `${path}.dialog`, Object.keys(d.dialog))
  const mg = section(root.manager, `${path}.manager`, Object.keys(d.manager))
  const th = section(root.theme, `${path}.theme`, Object.keys(d.theme))
  const tk = section(th.tokens, `${path}.theme.tokens`, THEME_TOKENS)
  const tokens: Partial<Record<ThemeToken, string>> = {}
  for (const name of THEME_TOKENS) {
    if (tk[name] !== undefined) tokens[name] = tokenValue(name, tk[name], `${path}.theme.tokens.${name}`)
  }

  return {
    banner: {
      layout, position,
      equalWeightButtons: bool(bn.equalWeightButtons, `${path}.banner.equalWeightButtons`, d.banner.equalWeightButtons),
      flipButtons: bool(bn.flipButtons, `${path}.banner.flipButtons`, d.banner.flipButtons),
    },
    dialog: {
      layout: oneOf(dg.layout, `${path}.dialog.layout`, ['box', 'bar'] as const, d.dialog.layout),
      position: oneOf(dg.position, `${path}.dialog.position`, ['left', 'right'] as const, d.dialog.position),
    },
    manager: {
      receipt: bool(mg.receipt, `${path}.manager.receipt`, d.manager.receipt),
      serviceToggles: bool(mg.serviceToggles, `${path}.manager.serviceToggles`, d.manager.serviceToggles),
      storageTables: bool(mg.storageTables, `${path}.manager.storageTables`, d.manager.storageTables),
      processors: bool(mg.processors, `${path}.manager.processors`, d.manager.processors),
      withdraw: bool(mg.withdraw, `${path}.manager.withdraw`, d.manager.withdraw),
      details: oneOf(mg.details, `${path}.manager.details`, ['open', 'collapsed'] as const, d.manager.details),
    },
    theme: { tokens },
  }
}
