import consentCss from './astro/consent.css?raw'
import engineCss from 'vanilla-cookieconsent/dist/cookieconsent.css?raw'

type Adopting = Document & { adoptedStyleSheets?: CSSStyleSheet[] }

/** Splits a stylesheet into its top-level rules (comments dropped), for `insertRule`, which takes one rule at a time. */
export function topLevelRules(css: string): string[] {
  const rules: string[] = []
  let depth = 0
  let start = 0
  let quote: string | null = null
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (quote) {
      if (ch === '\\') i++
      else if (ch === quote) quote = null
      continue
    }
    if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2)
      const stop = end === -1 ? css.length : end + 2
      css = css.slice(0, i) + ' '.repeat(stop - i) + css.slice(stop)
      i = stop - 1
      continue
    }
    if (ch === '"' || ch === "'") quote = ch
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) { rules.push(css.slice(start, i + 1).trim()); start = i + 1 }
    } else if (ch === ';' && depth === 0) {
      // a statement at-rule, such as the `@layer` order statement
      rules.push(css.slice(start, i + 1).trim()); start = i + 1
    }
  }
  return rules.filter((r) => r.length > 0)
}

const adopted = new WeakSet<Document>()

/**
 * Gives the document the engine's stylesheet and consent.css, in that order (consent.css maps the engine's variables), as
 * constructed sheets in `adoptedStyleSheets`. Where constructed sheets are not supported, the rules go one by one through
 * `insertRule` into the sheet of an empty `<style>` element: never as style text. A rule the browser rejects is skipped.
 * Once per document.
 */
export function adoptStyles(doc: Document): void {
  if (adopted.has(doc)) return
  adopted.add(doc)
  const win = doc.defaultView
  const d = doc as Adopting
  const Sheet = win?.CSSStyleSheet
  const texts = [engineCss, consentCss]
  if (Sheet && typeof Sheet.prototype.replaceSync === 'function' && 'adoptedStyleSheets' in doc) {
    try {
      const sheets = texts.map((css) => { const s = new Sheet(); s.replaceSync(css); return s })
      d.adoptedStyleSheets = [...(d.adoptedStyleSheets ?? []), ...sheets]
      return
    } catch { /* fall through to the CSSOM */ }
  }
  const el = doc.createElement('style')
  ;(doc.head ?? doc.documentElement).appendChild(el)
  const sheet = el.sheet
  if (!sheet) return
  for (const css of texts) {
    for (const rule of topLevelRules(css)) {
      try { sheet.insertRule(rule, sheet.cssRules.length) } catch { /* not supported by this browser */ }
    }
  }
}
