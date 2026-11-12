/** Hosts for which a plain-http PUBLIC_ORIGIN is allowed (local development and tests). */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

export function parseUrl(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/** A bare origin: https, or http on a local host; no credentials, path, query or fragment. */
export function isOrigin(value: string): boolean {
  const url = parseUrl(value)
  if (!url) return false
  const schemeOk = url.protocol === 'https:' || (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname))
  return schemeOk && url.username === '' && url.password === '' && url.pathname === '/' && url.search === '' && url.hash === ''
}

/**
 * PUBLIC_ORIGIN for pages prerendered at build time (canonical and hreflang URLs), where the server's
 * other variables (database, secrets) are absent so src/server/env.ts cannot load. Same rules as env.ts.
 * Throws naming the variable, never its value.
 */
export function buildOrigin(source: Record<string, string | undefined> = process.env): string {
  const value = source.PUBLIC_ORIGIN ?? ''
  if (!isOrigin(value) || (source.NODE_ENV === 'production' && parseUrl(value)?.protocol === 'http:')) {
    throw new Error('PUBLIC_ORIGIN must be set to a bare https origin when building (prerendered pages link to it); value not shown')
  }
  return new URL(value).origin
}
