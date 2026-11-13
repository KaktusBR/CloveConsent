import { describe, expect, test } from 'vitest'

import { patchModule, replaceOnce } from '../../src/build/patch-module'

const MODULE = '/@astrojs/node/dist/standalone.js'

/** Runs the plugin's hooks as one Vite environment's build would. */
function build(plugin: ReturnType<typeof patchModule>, environment: string, modules: Record<string, string>) {
  const context = {
    environment: { name: environment },
    error(message: string): never {
      throw new Error(message)
    },
  }
  plugin.buildStart.call(context)
  const output = Object.entries(modules).map(([id, code]) => plugin.transform.call(context, code, id)?.code ?? code)
  plugin.generateBundle.call(context)
  return output
}

const plugin = () =>
  patchModule({ name: 'test-patch', module: MODULE, edit: (code, fail) => replaceOnce(code, 'handler()', 'secured(handler())', fail) })

describe('patchModule: a build-time patch that cannot stop applying silently', () => {
  test('patches the module in the server bundle (Windows or POSIX ids), leaves others alone', () => {
    const p = plugin()
    expect(build(p, 'ssr', { 'C:\\app\\node_modules\\@astrojs\\node\\dist\\standalone.js': 'handler()', '/app/other.js': 'handler()' })).toEqual([
      'secured(handler())',
      'handler()',
    ])
  })

  test('fails the build when the module never went through Vite in the server bundle (made external, moved)', () => {
    expect(() => build(plugin(), 'ssr', { '/app/other.js': 'x' })).toThrow(/test-patch: .*standalone\.js was not part of the server bundle/)
  })

  test('a fresh server build must patch again; other environments (client, prerender) are not checked', () => {
    const p = plugin()
    build(p, 'ssr', { [`/n${MODULE}`]: 'handler()' })
    expect(() => build(p, 'client', {})).not.toThrow()
    expect(() => build(p, 'prerender', {})).not.toThrow()
    expect(() => build(p, 'ssr', {})).toThrow(/was not part of the server bundle/)
  })

  test('fails the build when the code no longer has the expected shape', () => {
    expect(() => build(plugin(), 'ssr', { [`/n${MODULE}`]: 'other()' })).toThrow(/test-patch: "handler\(\)" not found exactly once in .*standalone\.js/)
    expect(() => build(plugin(), 'ssr', { [`/n${MODULE}`]: 'handler(); handler()' })).toThrow(/not found exactly once/)
  })

  test('replaceOnce inserts the replacement literally (no $ patterns)', () => {
    const fail = (m: string): never => {
      throw new Error(m)
    }
    expect(replaceOnce('a b', 'b', '$&$&', fail)).toBe('a $&$&')
  })
})
