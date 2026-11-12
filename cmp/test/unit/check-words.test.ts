import { compile } from '@inlang/paraglide-js'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

import { checkCatalogs, checkSource } from '../../scripts/check-words'

const lines = async (file: string, source: string) => (await checkSource(file, source)).map((f) => f.line)

describe('check-words: literal text in .astro and .tsx', () => {
  test('flags text in an .astro element', async () => {
    expect(await lines('src/pages/x.astro', '---\nconst a = 1\n---\n<p>Hello</p>\n')).toEqual([4])
  })

  test('flags text in a .tsx element, and a string literal used as a child', async () => {
    expect(await lines('src/components/X.tsx', 'export const X = () => <p>Hello</p>\n')).toEqual([1])
    expect(await lines('src/components/X.tsx', "export const X = () => (\n  <p>{'Hello'}</p>\n)\n")).toEqual([2])
  })

  test('flags a literal user-visible attribute', async () => {
    expect(await lines('src/pages/x.astro', '<button aria-label="Close">{m.close()}</button>\n')).toEqual([1])
    expect(await lines('src/components/X.tsx', 'export const X = () => <button aria-label="Close">{m.close()}</button>\n')).toEqual([1])
    expect(await lines('src/components/X.tsx', "export const X = () => <img alt={'Logo'} src={s} />\n")).toEqual([1])
    expect(await lines('src/components/X.tsx', 'export const X = () => <Dialog closeLabel="Close" />\n')).toEqual([1])
    expect(await lines('src/pages/x.astro', '<input placeholder="Email" />\n<b title=\'Bold\'>{x}</b>\n')).toEqual([1, 2])
  })

  test('passes catalog calls, punctuation-only text and code', async () => {
    const astro = [
      '---',
      "import { m } from '../paraglide/messages.js'",
      "const label = 'not checked: frontmatter is code'",
      '---',
      '<p class="flex gap-2" aria-label={m.close()}>{m.close()} — · : ( ) 42 &amp; &nbsp;</p>',
      '{items.map((i) => <li>{i.name}</li>)}',
      '<code>npm run dev</code>',
      '<pre>const a = 1</pre>',
      '<script>console.log("not text")</script>',
      '<style>p { color: red }</style>',
      '<!-- a comment is not shown -->',
    ].join('\n')
    expect(await checkSource('src/pages/x.astro', astro)).toEqual([])

    const tsx = [
      "import { m } from '@/paraglide/messages.js'",
      'export const X = ({ n }: { n: number }) => (',
      '  <div className="flex items-center" aria-label={m.close()}>',
      '    {m.close()} · {n} / 100 %',
      '    <code>npm test</code>',
      '    <kbd>Ctrl</kbd>',
      '  </div>',
      ')',
    ].join('\n')
    expect(await checkSource('src/components/X.tsx', tsx)).toEqual([])
  })

  test('an explicit words-ok comment with a reason allows a literal; without a reason it does not', async () => {
    expect(await lines('src/pages/x.astro', '<!-- words-ok: brand name, never translated -->\n<p>CloveConsent</p>\n')).toEqual([])
    expect(await lines('src/components/X.tsx', 'export const X = () => (\n  // words-ok: brand name, never translated\n  <p>CloveConsent</p>\n)\n')).toEqual([])
    expect(await lines('src/components/X.tsx', 'export const X = () => <p>CloveConsent</p> // words-ok: brand name\n')).toEqual([])
    expect(await lines('src/components/X.tsx', 'export const X = () => (\n  // words-ok:\n  <p>CloveConsent</p>\n)\n')).toEqual([3])
  })

  test('the finding names the file, line and the offending text', async () => {
    const [finding] = await checkSource('src/pages/x.astro', '<main>\n  <p>\n    Hello there\n  </p>\n</main>\n')
    expect(finding).toMatchObject({ file: 'src/pages/x.astro', line: 3 })
    expect(finding?.message).toContain('Hello there')
  })
})

describe('check-words: catalogs', () => {
  const dirs: string[] = []
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

  const plugin = resolve('node_modules/@inlang/plugin-message-format/dist/index.js').replaceAll('\\', '/')

  function project(catalogs: Record<string, Record<string, string>>): string {
    const root = mkdtempSync(join(tmpdir(), 'cmp-words-'))
    dirs.push(root)
    mkdirSync(join(root, 'project.inlang'))
    mkdirSync(join(root, 'messages'))
    const settings = {
      baseLocale: 'en',
      locales: Object.keys(catalogs),
      modules: [plugin],
      'plugin.inlang.messageFormat': { pathPattern: './messages/{locale}.json' },
    }
    writeFileSync(join(root, 'project.inlang', 'settings.json'), JSON.stringify(settings))
    for (const [locale, messages] of Object.entries(catalogs)) {
      writeFileSync(join(root, 'messages', `${locale}.json`), JSON.stringify(messages))
    }
    return root
  }

  test('complete catalogs pass', () => {
    const root = project({ en: { greeting: 'Hello', bye: 'Bye' }, sk: { greeting: 'Ahoj', bye: 'Dovidenia' } })
    expect(checkCatalogs(join(root, 'project.inlang'))).toEqual([])
  })

  test('a key missing from sk.json fails the check, and the page renders the English text for it', async () => {
    const root = project({ en: { greeting: 'Hello', bye: 'Bye' }, sk: { greeting: 'Ahoj' } })
    const findings = checkCatalogs(join(root, 'project.inlang'))
    expect(findings).toHaveLength(1)
    expect(findings[0]?.file).toMatch(/sk\.json$/)
    expect(findings[0]?.message).toContain('bye')

    const outdir = join(root, 'paraglide')
    await compile({ project: join(root, 'project.inlang'), outdir, strategy: ['baseLocale'], emitGitIgnore: false })
    const { m } = (await import(pathToFileURL(join(outdir, 'messages.js')).href)) as {
      m: Record<string, (inputs?: object, options?: { locale?: string }) => string>
    }
    expect(m.greeting?.({}, { locale: 'sk' })).toBe('Ahoj')
    expect(m.bye?.({}, { locale: 'sk' })).toBe('Bye')
  })

  test('a key only in a translation, an empty text and a missing catalog file fail the check', () => {
    const root = project({ en: { greeting: 'Hello' }, sk: { greeting: '', extra: 'Navyše' } })
    const messages = checkCatalogs(join(root, 'project.inlang')).map((f) => f.message)
    expect(messages).toHaveLength(2)
    expect(messages.join('\n')).toContain('extra')
    expect(messages.join('\n')).toContain('greeting')

    rmSync(join(root, 'messages', 'sk.json'))
    expect(checkCatalogs(join(root, 'project.inlang'))).toHaveLength(1)
  })
})
