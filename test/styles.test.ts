import { createRequire } from 'node:module'
import { expect, test } from 'vitest'
import consentCss from '../src/astro/consent.css?raw'
import { adoptStyles, topLevelRules } from '../src/styles'

const jsdom = createRequire(import.meta.url)('jsdom') as { JSDOM: new (html: string) => { window: Window & typeof globalThis } }
const page = () => new jsdom.JSDOM('<!DOCTYPE html><html><head></head><body></body></html>').window

test('splits a stylesheet into its top-level rules, the @layer order statement first, comments dropped', () => {
  const rules = topLevelRules(consentCss)
  expect(rules[0]).toBe('@layer theme, base, components, utilities;')
  const sheet = new CSSStyleSheet()
  sheet.replaceSync(consentCss)
  expect(rules).toHaveLength(sheet.cssRules.length)
  expect(rules.some((r) => r.includes('/*'))).toBe(false)
  expect(topLevelRules('a { content: "}" } /* { */ @media (min-width: 1px) { b { c: d } }')).toEqual([
    'a { content: "}" }', '@media (min-width: 1px) { b { c: d } }',
  ])
})

test('with adoptedStyleSheets: two constructed sheets, no <style> element, once per document', () => {
  const win = page()
  const store = new WeakMap<Document, CSSStyleSheet[]>()
  Object.defineProperty(win.Document.prototype, 'adoptedStyleSheets', {
    configurable: true, get(this: Document) { return store.get(this) ?? [] }, set(this: Document, v: CSSStyleSheet[]) { store.set(this, v) },
  })
  const doc = win.document as Document & { adoptedStyleSheets: CSSStyleSheet[] }
  adoptStyles(doc)
  adoptStyles(doc)
  expect(doc.querySelectorAll('style')).toHaveLength(0)
  expect(doc.adoptedStyleSheets).toHaveLength(2)
  expect(doc.adoptedStyleSheets[0]!.cssRules[0]!.cssText).toContain('#cc-main')
})

test('without adoptedStyleSheets: rules inserted one by one into an empty <style> element, never as text', () => {
  const doc = page().document
  adoptStyles(doc)
  adoptStyles(doc)
  const styles = doc.querySelectorAll('style')
  expect(styles).toHaveLength(1)
  expect(styles[0]!.textContent).toBe('')
  const text = [...styles[0]!.sheet!.cssRules].map((r) => r.cssText).join('\n')
  expect(text).toContain('#cc-main')
  expect(text).toContain('@layer theme, base, components, utilities')
})
