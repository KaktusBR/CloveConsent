import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const pkg = JSON.parse(readFileSync('package.json', 'utf8'))
test('every language pack is a package export', () => {
  for (const l of ['sk', 'fr', 'de']) {
    expect(pkg.exports[`./locales/${l}`]).toEqual({ types: `./dist/locales/${l}.d.ts`, import: `./dist/locales/${l}.js` })
  }
  expect(pkg.exports['./messages']).toBeUndefined()
})
test('every exports target is produced by tsup or is an astro source file', () => {
  const tsup = readFileSync('tsup.config.ts', 'utf8')
  const hasEntry = (name: string) => tsup.includes(`'${name}'`) || new RegExp(`\\b${name}:`).test(tsup)
  for (const [key, value] of Object.entries<any>(pkg.exports)) {
    if (typeof value === 'string') { expect(value.startsWith('./src/astro/'), key).toBe(true); continue }
    expect(hasEntry(key === '.' ? 'index' : key.slice(2)), key).toBe(true)
  }
})
test('the settings component and the stylesheet are package exports', () => {
  expect(pkg.exports['./astro/ConsentSettings.astro']).toBe('./src/astro/ConsentSettings.astro')
  expect(pkg.exports['./consent.css']).toBe('./src/astro/consent.css')
})
