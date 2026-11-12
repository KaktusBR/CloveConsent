/**
 * "No words in source": every user-visible text comes from the Paraglide catalog (messages/*.json).
 *
 *   npm run check:words
 *
 * Fails on
 *  - literal text in `.astro` and `.tsx` markup, including markup passed in an attribute
 *    (`fallback={<p>...</p>}`),
 *  - a string literal rendered as a child, also as a branch of `?:`, `??`, `||` or `&&`
 *    (`{a ? 'Yes' : 'No'}`),
 *  - a literal in a user-visible attribute: title, alt, placeholder, label, aria-label and the other
 *    text-carrying aria-* attributes, any `...Label` prop (the Dialog's `closeLabel`), Astro's
 *    `set:text`, `value` of `<input type="submit|button|reset">`, and `content` of the
 *    description and social text `<meta>` tags (og:title, og:description, og:site_name,
 *    og:image:alt and the twitter: equivalents; not URLs or enums such as og:image, twitter:card),
 *  - a catalog that differs from the base one (messages/en.json): a missing or extra key, an empty text.
 *
 * Text counts only if it has a letter: punctuation, numbers and entities pass. Code is not text:
 * frontmatter, expression code, <script>, <style>, <code>, <pre>, <kbd>, <samp> are skipped.
 * Sources are parsed (@astrojs/compiler for .astro, the TypeScript compiler for .tsx and for
 * the expressions inside .astro), not matched by regex. A finding is allowed only by an explicit
 * comment on its line or the line above: `// words-ok: <reason>` (or the same inside a JSX
 * `{/* *\/}` or an HTML `<!-- -->` comment).
 * Out of scope: .ts files (machine responses such as /healthz's `ok`) and strings computed in code.
 */
import { parse } from '@astrojs/compiler'
import type { AttributeNode, Node as AstroNode } from '@astrojs/compiler/types'
import { globSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

export interface Finding {
  file: string
  line: number
  column: number
  message: string
}

type Report = (line: number, column: number, message: string) => void

/** Elements whose content is code or computer output, not prose. */
const CODE_ELEMENTS = new Set(['code', 'pre', 'kbd', 'samp', 'script', 'style'])

const VISIBLE_ATTRIBUTES = new Set([
  'title',
  'alt',
  'placeholder',
  'label',
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-placeholder',
  'aria-valuetext',
  'set:text',
])

const BUTTON_INPUTS = new Set(['submit', 'button', 'reset'])

const META_TEXTS = new Set([
  'description',
  'og:title',
  'og:description',
  'og:site_name',
  'og:image:alt',
  'twitter:title',
  'twitter:description',
  'twitter:image:alt',
])

/**
 * Whether attribute `name` of element `tag` is shown to people. `sibling` gives the literal
 * value of another attribute of the same element (for `type` and meta `name`/`property`).
 */
function isVisibleAttribute(tag: string, name: string, sibling: (name: string) => string | null): boolean {
  if (VISIBLE_ATTRIBUTES.has(name) || /[a-z]Label$/.test(name)) return true
  if (tag === 'input' && name === 'value') return BUTTON_INPUTS.has((sibling('type') ?? '').toLowerCase())
  if (tag === 'meta' && name === 'content') return META_TEXTS.has((sibling('name') ?? sibling('property') ?? '').toLowerCase())
  return false
}

/** Text with at least one letter, once character references (`&amp;`, `&#8212;`) are removed. */
function hasWords(text: string): boolean {
  return /\p{L}/u.test(text.replace(/&(?:#\d+|#x[\da-f]+|[a-z][a-z\d]*);/gi, ''))
}

const ALLOW = /(?:\/\/|\/\*|<!--)\s*words-ok:\s*\S/

function allowed(lines: string[], line: number): boolean {
  return ALLOW.test(lines[line - 1] ?? '') || ALLOW.test(lines[line - 2] ?? '')
}

function preview(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > 60 ? `${flat.slice(0, 57)}...` : flat
}

/** Line and column of the first non-blank character of `text`, which starts at `line`:`column`. */
function firstVisible(text: string, line: number, column: number): { line: number; column: number } {
  const lead = /^\s*/.exec(text)?.[0] ?? ''
  const newlines = lead.split('\n').length - 1
  if (newlines === 0) return { line, column: column + lead.length }
  return { line: line + newlines, column: lead.length - lead.lastIndexOf('\n') }
}

/**
 * The string literals an expression renders as text: the expression itself, or a branch of
 * `c ? a : b`, `a ?? b`, `a || b` and the right side of `c && a`.
 */
function renderedLiterals(expression: ts.Expression | undefined): ts.StringLiteralLike[] {
  if (!expression) return []
  if (ts.isParenthesizedExpression(expression)) return renderedLiterals(expression.expression)
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return [expression]
  if (ts.isConditionalExpression(expression)) return [...renderedLiterals(expression.whenTrue), ...renderedLiterals(expression.whenFalse)]
  if (ts.isBinaryExpression(expression)) {
    const op = expression.operatorToken.kind
    if (op === ts.SyntaxKind.QuestionQuestionToken || op === ts.SyntaxKind.BarBarToken) {
      return [...renderedLiterals(expression.left), ...renderedLiterals(expression.right)]
    }
    if (op === ts.SyntaxKind.AmpersandAmpersandToken) return renderedLiterals(expression.right)
  }
  return []
}

/**
 * Checks TSX: markup text, rendered literals, visible attributes. Used for .tsx files and for the
 * JavaScript inside .astro expressions; `at` maps a position in `sf` to the reported line/column.
 */
function checkJsx(root: ts.Node, sf: ts.SourceFile, at: (pos: number) => { line: number; column: number }, report: Report): void {
  const flagLiterals = (literals: ts.StringLiteralLike[], describe: (text: string) => string) => {
    for (const literal of literals) {
      if (!hasWords(literal.text)) continue
      const { line, column } = at(literal.getStart(sf))
      report(line, column, describe(literal.text))
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node)) {
      if (hasWords(node.text)) {
        const start = at(node.getStart(sf))
        const where = firstVisible(node.text, start.line, start.column)
        report(where.line, where.column, `literal text "${preview(node.text)}"`)
      }
      return
    }
    if (ts.isJsxAttribute(node)) {
      const element = node.parent.parent
      const tag = element.tagName.getText(sf)
      const name = node.name.getText(sf)
      const sibling = (other: string) => {
        for (const a of element.attributes.properties) {
          if (ts.isJsxAttribute(a) && a.name.getText(sf) === other && a.initializer && ts.isStringLiteral(a.initializer)) return a.initializer.text
        }
        return null
      }
      if (isVisibleAttribute(tag, name, sibling)) {
        const init = node.initializer
        const literals = !init ? [] : ts.isStringLiteral(init) ? [init] : ts.isJsxExpression(init) ? renderedLiterals(init.expression) : []
        flagLiterals(literals, (text) => `literal ${name}="${preview(text)}"`)
      }
      ts.forEachChild(node, visit) // markup passed as a value: fallback={<p>...</p>}
      return
    }
    if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      flagLiterals(renderedLiterals(node.expression), (text) => `literal text "${preview(text)}"`)
    }
    if (ts.isJsxElement(node) && CODE_ELEMENTS.has(node.openingElement.tagName.getText(sf))) {
      visit(node.openingElement)
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(root)
}

/** Parses `code` (an .astro expression) as TSX; positions map onto the source from `line`:`column`. */
function parseExpression(code: string, line: number, column: number) {
  const sf = ts.createSourceFile('x.tsx', `(${code}\n)`, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const [statement] = sf.statements
  const expression = sf.statements.length === 1 && statement && ts.isExpressionStatement(statement) ? statement.expression : null
  const at = (pos: number) => {
    const p = sf.getLineAndCharacterOfPosition(pos - 1) // minus the added "("
    return p.line === 0 ? { line, column: column + p.character } : { line: line + p.line, column: p.character + 1 }
  }
  return { sf, expression, at }
}

async function checkAstro(source: string, report: Report): Promise<void> {
  const { ast } = await parse(source, { position: true })

  const attribute = (tag: string, a: AttributeNode, all: AttributeNode[]) => {
    const start = a.position?.start
    if (!start) return
    const sibling = (name: string) => all.find((o) => o.name === name && o.kind === 'quoted')?.value ?? null
    const visible = isVisibleAttribute(tag, a.name, sibling)
    if (a.kind === 'quoted' || a.kind === 'template-literal') {
      if (visible && hasWords(a.value)) report(start.line, start.column, `literal ${a.name}="${preview(a.value)}"`)
      return
    }
    if (a.kind !== 'expression') return
    const { sf, expression, at } = parseExpression(a.value, start.line, start.column)
    if (!expression) return
    if (visible) {
      for (const literal of renderedLiterals(expression)) {
        if (hasWords(literal.text)) report(start.line, start.column, `literal ${a.name}="${preview(literal.text)}"`)
      }
    }
    checkJsx(expression, sf, at, report) // markup passed as a value: content={<span>...</span>}
  }

  const visit = (node: AstroNode, inExpression: boolean) => {
    if (node.type === 'text') {
      // Inside {...} a text node is JavaScript, not markup.
      const at = node.position?.start
      if (!inExpression && hasWords(node.value) && at) {
        const where = firstVisible(node.value, at.line, at.column)
        report(where.line, where.column, `literal text "${preview(node.value)}"`)
      }
      return
    }
    if (node.type === 'expression') {
      const [only] = node.children
      const at = only?.position?.start
      if (node.children.length === 1 && only?.type === 'text' && at) {
        const parsed = parseExpression(only.value, at.line, at.column)
        for (const literal of renderedLiterals(parsed.expression ?? undefined)) {
          if (!hasWords(literal.text)) continue
          const where = parsed.at(literal.getStart(parsed.sf))
          report(where.line, where.column, `literal text "${preview(literal.text)}"`)
        }
      }
      for (const child of node.children) visit(child, true)
      return
    }
    if (node.type === 'element' || node.type === 'component' || node.type === 'custom-element' || node.type === 'fragment') {
      for (const a of node.attributes) attribute(node.name, a, node.attributes)
      if (node.type === 'element' && CODE_ELEMENTS.has(node.name)) return
      for (const child of node.children) visit(child, false)
      return
    }
    if (node.type === 'root') for (const child of node.children) visit(child, false)
    // frontmatter, comment, doctype: not shown
  }
  visit(ast, false)
}

function checkTsx(file: string, source: string, report: Report): void {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  checkJsx(sf, sf, (pos) => {
    const { line, character } = sf.getLineAndCharacterOfPosition(pos)
    return { line: line + 1, column: character + 1 }
  }, report)
}

/** Findings for one `.astro` or `.tsx` source. `file` is only used to pick the parser and in the findings. */
export async function checkSource(file: string, source: string): Promise<Finding[]> {
  const findings: Finding[] = []
  const lines = source.split('\n')
  const report: Report = (line, column, message) => {
    if (!allowed(lines, line)) findings.push({ file, line, column, message })
  }
  if (file.endsWith('.astro')) await checkAstro(source, report)
  else if (file.endsWith('.tsx')) checkTsx(file, source, report)
  return findings.sort((a, b) => a.line - b.line || a.column - b.column)
}

interface ProjectSettings {
  baseLocale: string
  locales: string[]
  'plugin.inlang.messageFormat'?: { pathPattern?: string }
}

function readCatalog(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

/** Every catalog of the inlang project has exactly the base catalog's keys, none empty. */
export function checkCatalogs(projectDir: string): Finding[] {
  const settings = JSON.parse(readFileSync(join(projectDir, 'settings.json'), 'utf8')) as ProjectSettings
  const pattern = settings['plugin.inlang.messageFormat']?.pathPattern ?? './messages/{locale}.json'
  const pathOf = (locale: string) => resolve(dirname(projectDir), pattern.replace('{locale}', locale))
  const keys = (catalog: Record<string, unknown>) => Object.keys(catalog).filter((k) => k !== '$schema')

  const findings: Finding[] = []
  const add = (path: string, message: string) => findings.push({ file: path, line: 1, column: 1, message })

  const base = readCatalog(pathOf(settings.baseLocale))
  if (!base) return [{ file: pathOf(settings.baseLocale), line: 1, column: 1, message: 'base catalog missing or not JSON' }]
  const baseKeys = new Set(keys(base))

  for (const locale of settings.locales) {
    const path = pathOf(locale)
    const catalog = locale === settings.baseLocale ? base : readCatalog(path)
    if (!catalog) {
      add(path, `catalog for "${locale}" missing or not JSON`)
      continue
    }
    for (const key of baseKeys) {
      if (!(key in catalog)) add(path, `missing key "${key}" (the page would show the ${settings.baseLocale} text)`)
      else if (catalog[key] === '') add(path, `empty text for "${key}"`)
    }
    for (const key of keys(catalog)) {
      if (!baseKeys.has(key)) add(path, `key "${key}" is not in the ${settings.baseLocale} catalog`)
    }
  }
  return findings
}

/** All `.astro`/`.tsx` sources under src/ (generated Paraglide output excluded) and all catalogs. */
export async function checkWords(root: string): Promise<Finding[]> {
  const files = globSync('src/**/*.{astro,tsx}', { cwd: root })
    .map((f) => f.replaceAll('\\', '/'))
    .filter((f) => !f.startsWith('src/paraglide/'))
  const findings: Finding[] = []
  for (const file of files.sort()) findings.push(...(await checkSource(file, readFileSync(join(root, file), 'utf8'))))
  for (const f of checkCatalogs(join(root, 'project.inlang'))) findings.push({ ...f, file: relative(root, f.file).replaceAll('\\', '/') })
  return findings
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const findings = await checkWords(root)
  for (const f of findings) console.error(`${f.file}:${f.line}:${f.column}  ${f.message}`)
  if (findings.length > 0) {
    console.error(`\n${findings.length} user-visible text(s) outside the catalog. Move them to messages/en.json (and every other catalog) and use m.*().`)
    process.exit(1)
  }
  console.log('check:words: no words in source, catalogs complete')
}
