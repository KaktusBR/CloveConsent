import { describe, expect, test } from 'vitest'
import { DEFAULT_UI, THEME_TOKENS, resolveUi } from '../src/ui-settings'
import { ConsentConfigError } from '../src/validate'

const theme = (tokens: Record<string, unknown>) => ({ theme: { tokens } })

describe('resolveUi', () => {
  test('undefined resolves to the defaults', () => {
    expect(resolveUi(undefined)).toEqual(DEFAULT_UI)
    expect(DEFAULT_UI).toEqual({
      banner: { layout: 'bar', position: 'bottom', equalWeightButtons: true, flipButtons: false },
      dialog: { layout: 'box', position: 'right' },
      manager: { receipt: true, serviceToggles: true, storageTables: true, processors: true, withdraw: true, details: 'collapsed' },
      theme: { tokens: {} },
    })
    expect(THEME_TOKENS).toHaveLength(10)
  })
  test('a partial input keeps the other defaults', () => {
    const ui = resolveUi({ banner: { layout: 'box', position: 'bottom left' } })
    expect(ui.banner).toEqual({ layout: 'box', position: 'bottom left', equalWeightButtons: true, flipButtons: false })
    expect(ui.dialog).toEqual(DEFAULT_UI.dialog)
    expect(ui.manager).toEqual(DEFAULT_UI.manager)
  })
  test('does not mutate the defaults', () => {
    const ui = resolveUi({ theme: { tokens: { primary: '#193637' } } })
    expect(ui.theme.tokens.primary).toBe('#193637')
    expect(DEFAULT_UI.theme.tokens).toEqual({})
  })
  test.each([
    ['bar with a non top/bottom position', { banner: { layout: 'bar', position: 'middle' } }, 'ui.banner.position'],
    ['unknown banner key', { banner: { colour: 'x' } }, 'ui.banner.colour'],
    ['unknown section', { footer: {} }, 'ui.footer'],
    ['unknown manager key', { manager: { sparkle: true } }, 'ui.manager.sparkle'],
    ['bad manager.details', { manager: { details: 'maybe' } }, 'ui.manager.details'],
    ['bad banner layout', { banner: { layout: 'popup' } }, 'ui.banner.layout'],
    ['bad dialog position', { dialog: { position: 'top' } }, 'ui.dialog.position'],
    ['non-boolean toggle', { manager: { withdraw: 'yes' } }, 'ui.manager.withdraw'],
    ['non-object ui', 'dark', 'ui'],
    ['non-object section', { banner: 'bar' }, 'ui.banner'],
    ['array ui', [], 'ui'],
  ])('rejects %s', (_n, input, path) => {
    expect(() => resolveUi(input)).toThrow(ConsentConfigError)
    expect(() => resolveUi(input)).toThrow(`[consent] ${path}:`)
  })
  test('uses the given path prefix', () => {
    expect(() => resolveUi({ banner: { colour: 'x' } }, 'cfg')).toThrow('[consent] cfg.banner.colour:')
  })
})

describe('theme tokens', () => {
  test.each(['#193637', '#fff', '#193637cc', 'rgb(0 0 0 / 50%)', 'rgba(0, 0, 0, 0.5)', 'hsl(180 40% 20%)', 'oklch(0.5 0.1 200)', 'oklab(0.5 0.1 0.1)', 'var(--brand)'])(
    'accepts %s as a colour',
    (v) => { expect(resolveUi(theme({ primary: v })).theme.tokens.primary).toBe(v) },
  )
  test.each([
    'red; background:url(x)', 'url(x)', 'expression(1)', 'red', 'rgb(0 0 0); x', 'rgb(url(x))', 'var(--Brand)', 'var(--a;b)', '#12', '#123456789',
    'x'.repeat(101), `#${'a'.repeat(100)}`, '', 5,
  ])('rejects %j as a colour', (v) => {
    expect(() => resolveUi(theme({ primary: v }))).toThrow(ConsentConfigError)
  })
  test('rejects a value over 100 characters even when it looks valid', () => {
    expect(() => resolveUi(theme({ primary: `rgb(${'0 '.repeat(60)})` }))).toThrow(ConsentConfigError)
  })
  test('rejects an unknown token name', () => {
    expect(() => resolveUi(theme({ accent: '#fff' }))).toThrow('[consent] ui.theme.tokens.accent:')
  })
  test('rejects unknown keys under theme', () => {
    expect(() => resolveUi({ theme: { tokens: {}, extra: 1 } })).toThrow(ConsentConfigError)
  })
  test('radius accepts a length and rejects a bare number', () => {
    expect(resolveUi(theme({ radius: '0.5rem' })).theme.tokens.radius).toBe('0.5rem')
    expect(() => resolveUi(theme({ radius: '5' }))).toThrow(ConsentConfigError)
    expect(() => resolveUi(theme({ radius: 5 }))).toThrow(ConsentConfigError)
  })
  test('fontFamily accepts inherit and a quoted family list, rejects a semicolon', () => {
    expect(resolveUi(theme({ fontFamily: 'inherit' })).theme.tokens.fontFamily).toBe('inherit')
    expect(resolveUi(theme({ fontFamily: '"Inter", sans-serif' })).theme.tokens.fontFamily).toBe('"Inter", sans-serif')
    expect(() => resolveUi(theme({ fontFamily: 'a;b' }))).toThrow(ConsentConfigError)
    expect(() => resolveUi(theme({ fontFamily: 'a{b}' }))).toThrow(ConsentConfigError)
  })
})
