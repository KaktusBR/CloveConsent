import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test } from 'vitest'

const css = readFileSync(join(__dirname, '..', 'src', 'astro', 'consent.css'), 'utf8')
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')

test('first statement is the layer order, so it works before or after Tailwind', () => {
  expect(css.startsWith('@layer theme, base, components, utilities;')).toBe(true)
})

test('every site token read has a neutral fallback', () => {
  const reads = stripped.match(/var\(--(?:background|foreground|primary|primary-foreground|muted|muted-foreground|border|ring)[^,)]*[,)]/g) ?? []
  expect(reads.length).toBeGreaterThan(0)
  for (const r of reads) expect(r.endsWith(','), r).toBe(true)
})

test('overrides win, then site tokens, then fallbacks', () => {
  expect(stripped).toMatch(/--consent-bg:\s*var\(--consent-override-background,\s*var\(--background,\s*#ffffff\)\)/)
  expect(stripped).toMatch(/--consent-primary:\s*var\(--consent-override-primary,\s*var\(--primary,\s*#1f2937\)\)/)
  expect(stripped).toMatch(/--consent-radius:\s*var\(--consent-override-radius,\s*var\(--radius,\s*0\.5rem\)\)/)
})

test('no physical left/right in the .consent-* rules (RTL uses logical properties)', () => {
  const physical = /margin-left|margin-right|padding-left|padding-right|(?:^|[\s;{])left\s*:|(?:^|[\s;{])right\s*:|text-align:\s*(?:left|right)|border-left|border-right|border-top-left|border-top-right|border-bottom-left|border-bottom-right/
  expect(stripped).not.toMatch(physical)
})

test('engine mapping is unlayered and covers dark mode', () => {
  expect(stripped).toContain('#cc-main.cc--darkmode')
  const layerStart = stripped.indexOf('@layer components {')
  expect(layerStart).toBeGreaterThan(-1)
  const outside = stripped.slice(0, layerStart)
  expect(outside).toMatch(/#cc-main\s*[,{]/)
  expect(outside).toContain('--cc-bg')
  expect(outside).toContain('--cc-btn-primary-bg')
})

test('a .dark block carries dark fallbacks', () => {
  const m = stripped.match(/\.dark[^{]*\{[^}]*\}/)
  expect(m).not.toBeNull()
  expect(m![0]).toMatch(/var\(--background,\s*#[0-9a-f]{6}\)/i)
  expect(m![0]).not.toContain('#ffffff)')
})

test('every class in the contract appears', () => {
  const classes = [
    'consent-settings', 'consent-receipt', 'consent-receipt__id', 'consent-receipt__meta', 'consent-category',
    'consent-category__head', 'consent-service', 'consent-switch', 'consent-table', 'consent-actions',
    'consent-status', 'consent-btn', 'consent-btn--primary', 'consent-btn--secondary', 'consent-placeholder',
    'consent-processors', 'consent-preferences',
  ]
  for (const c of classes) expect(stripped, c).toContain(`.${c}`)
})

test('switch is operable and focusable, with visible focus, and motion is optional', () => {
  expect(stripped).toContain('appearance: none')
  expect(stripped).toMatch(/\.consent-switch:focus-visible/)
  expect(stripped).toMatch(/\.consent-btn:focus-visible/)
  expect(stripped).toMatch(/summary:focus-visible/)
  expect(stripped).toContain('prefers-reduced-motion')
})

test('no tailwind directives', () => {
  expect(stripped).not.toMatch(/@tailwind|@apply/)
})
