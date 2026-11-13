/** The parts of Vite's plugin context this plugin uses (Vite is Astro's dependency, not ours). */
interface Context {
  environment?: { name: string }
  error(message: string): never
}

export interface PatchModule {
  /** The plugin's name, for Vite and in errors. */
  name: string
  /** The end of the patched module's path, e.g. `/@astrojs/node/dist/server.js`. */
  module: string
  /** The patched code; throws (with `fail`) when the code no longer has the expected shape. */
  edit(code: string, fail: (message: string) => never): string
}

/** The server bundle, where the node adapter's server code lives. */
const SERVER_ENVIRONMENT = 'ssr'

/**
 * A build-time patch of a dependency's module in the server bundle, which fails the build when
 * it cannot apply: when `edit` rejects the code, and when the module never went through Vite
 * (it became external, or moved), so the patch cannot silently stop applying.
 */
export function patchModule({ name, module, edit }: PatchModule) {
  let applied = false
  return {
    name,
    apply: 'build' as const,
    buildStart(this: Context) {
      if (this.environment?.name === SERVER_ENVIRONMENT) applied = false
    },
    transform(this: Context, code: string, id: string) {
      if (!id.replaceAll('\\', '/').endsWith(module)) return null
      const patched = edit(code, (message) => this.error(`${name}: ${message} in ${id}`))
      applied = true
      return { code: patched, map: null }
    },
    generateBundle(this: Context) {
      if (this.environment?.name === SERVER_ENVIRONMENT && !applied) {
        this.error(`${name}: ${module} was not part of the server bundle, so it was not patched`)
      }
    },
  }
}

/** `code` with `anchor` replaced; fails unless the anchor occurs exactly once. */
export function replaceOnce(code: string, anchor: string, replacement: string, fail: (message: string) => never): string {
  if (code.split(anchor).length !== 2) fail(`"${anchor}" not found exactly once`)
  return code.replace(anchor, () => replacement)
}
