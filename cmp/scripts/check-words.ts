/**
 * "No words in source": every user-visible text comes from the Paraglide catalog (messages/*.json).
 *
 *   npm run check:words
 *
 * Fails on
 *  - literal text in `.astro` and `.tsx` markup (text nodes, a string literal used as a child),
 *  - a literal in a user-visible attribute (title, alt, placeholder, label, aria-label and other
 *    text-carrying aria-* attributes, and any `...Label` prop such as the Dialog's `closeLabel`),
 *  - a catalog that differs from the base one (messages/en.json): a missing or extra key, an empty text.
 *
 * Text counts only if it has a letter: punctuation, numbers and entities pass. Code is not text:
 * frontmatter, expressions, <script>, <style>, <code>, <pre>, <kbd>, <samp> are skipped.
 * Sources are parsed (@astrojs/compiler for .astro, the TypeScript compiler for .tsx), not matched
 * by regex. A finding is allowed only by an explicit comment on its line or the line above:
 * `// words-ok: <reason>` (or the same inside a JSX `{/* *\/}` or an HTML `<!-- -->` comment).
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
])

const isVisibleAttribute = (name: string) => VISIBLE_ATTRIBUTES.has(name) || /[a-z]Label$/.test(name)

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

/** The string, if `code` is nothing but a string literal (`'Close'`, `"Close"`, `` `Close` ``). */
function stringLiteral(code: string): string | null {
  const file = ts.createSourceFile('x.ts', `(${code})`, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS)
  const [statement] = file.statements
  if (file.statements.length !== 1 || !statement || !ts.isExpressionStatement(statement)) return null
  let expression = statement.expression
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression
  return ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression) ? expression.text : null
}

async function checkAstro(source: string, report: (line: number, column: number, message: string) => void): Promise<void> {
  const { ast } = await parse(source, { position: true })

  const attribute = (a: AttributeNode) => {
    if (!isVisibleAttribute(a.name)) return
    const value = a.kind === 'quoted' || a.kind === 'template-literal' ? a.value : a.kind === 'expression' ? stringLiteral(a.value) : null
    const at = a.position?.start
    if (value !== null && hasWords(value) && at) report(at.line, at.column, `literal ${a.name}="${preview(value)}"`)
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
      const literal = node.children.length === 1 && only?.type === 'text' ? stringLiteral(only.value) : null
      const at = node.position?.start
      if (literal !== null && hasWords(literal) && at) report(at.line, at.column, `literal text "${preview(literal)}"`)
      for (const child of node.children) visit(child, true)
      return
    }
    if (node.type === 'element' || node.type === 'component' || node.type === 'custom-element' || node.type === 'fragment') {
      node.attributes.forEach(attribute)
      if (node.type === 'element' && CODE_ELEMENTS.has(node.name)) return
      for (const child of node.children) visit(child, false)
      return
    }
    if (node.type === 'root') for (const child of node.children) visit(child, false)
    // frontmatter, comment, doctype: not shown
  }
  visit(ast, false)
}

function checkTsx(file: string, source: string, report: (line: number, column: number, message: string) => void): void {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const at = (pos: number) => {
    const { line, character } = sf.getLineAndCharacterOfPosition(pos)
    return { line: line + 1, column: character + 1 }
  }
  const literalOf = (node: ts.Node | undefined): string | null =>
    node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : null

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
      const name = node.name.getText(sf)
      const init = node.initializer
      const value = init && ts.isJsxExpression(init) ? literalOf(init.expression) : literalOf(init)
      if (isVisibleAttribute(name) && value !== null && hasWords(value)) {
        const { line, column } = at(node.getStart(sf))
        report(line, column, `literal ${name}="${preview(value)}"`)
      }
      return
    }
    if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      const value = literalOf(node.expression)
      if (value !== null && hasWords(value)) {
        const { line, column } = at(node.getStart(sf))
        report(line, column, `literal text "${preview(value)}"`)
      }
    }
    if (ts.isJsxElement(node)) {
      const tag = node.openingElement.tagName.getText(sf)
      if (CODE_ELEMENTS.has(tag)) {
        visit(node.openingElement)
        return
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
}

/** Findings for one `.astro` or `.tsx` source. `file` is only used to pick the parser and in the findings. */
export async function checkSource(file: string, source: string): Promise<Finding[]> {
  const findings: Finding[] = []
  const lines = source.split('\n')
  const report = (line: number, column: number, message: string) => {
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
