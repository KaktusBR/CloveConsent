type MetaEnv = { DEV?: unknown } | undefined

// Pure decision, exported for tests. A bundler's import.meta.env wins; NODE_ENV is only consulted where
// there is no import.meta.env (plain Node). Anything else (e.g. an unbundled browser) is not dev.
export function isDevFrom(metaEnv: MetaEnv, nodeEnv: string | undefined): boolean {
  if (metaEnv) return metaEnv.DEV === true
  return typeof nodeEnv === 'string' && nodeEnv !== 'production'
}

function readMetaEnv(): MetaEnv {
  // must stay the literal `import.meta.env` (no casts around import.meta) so Vite/Astro/Vitest replace it
  // statically; in plain Node ESM it is simply undefined
  try { return import.meta.env } catch { return undefined }
}

export function isDev(): boolean {
  const nodeEnv = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.NODE_ENV
  return isDevFrom(readMetaEnv(), nodeEnv)
}
