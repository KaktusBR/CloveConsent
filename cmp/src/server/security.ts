import { createHash } from 'node:crypto'

// Security headers and the CSRF origin check. No import of ./env: astro.config.mjs reads the CSP
// from here at build time, and the node adapter's static file handler uses it (see astro.config.mjs).

/**
 * The CSP's directives other than script-src and style-src. Astro adds those two to every page,
 * with the hash of each inline script and style it renders (`security.csp` in astro.config.mjs):
 * `script-src 'self' 'sha256-…' 'strict-dynamic'; style-src 'self' 'sha256-…'`. Server-rendered
 * pages get the policy as a header; prerendered pages too (the adapter's `staticHeaders`).
 */
export const CSP_DIRECTIVES = [
  "default-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
] as const

/**
 * The policy of a response that is not a page Astro rendered (API routes, redirects, static
 * files): the same directives, and no hash, so no script or inline style of it can run.
 */
export const BASELINE_CSP = [...CSP_DIRECTIVES, "script-src 'self' 'strict-dynamic'", "style-src 'self'"].join('; ')

/** Every response carries these, with these exact values. */
const HEADERS: Readonly<Record<string, string>> = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'X-Frame-Options': 'DENY',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
}

/** The security headers of a response, with the baseline CSP. */
export function securityHeaders(): Headers {
  return new Headers({ ...HEADERS, 'Content-Security-Policy': BASELINE_CSP })
}

/** The CSP source expression allowing an inline script or style with exactly this text. */
export function cspHash(source: string): string {
  return `sha256-${createHash('sha256').update(source).digest('base64')}`
}

/**
 * The response with every security header. A CSP already there (the hashed policy Astro sets on a
 * page) is kept. An immutable response (`Response.redirect`) is copied.
 */
export function withSecurityHeaders(response: Response): Response {
  let target = response
  try {
    apply(target.headers)
  } catch {
    target = new Response(response.body, response)
    apply(target.headers)
  }
  return target
}

function apply(headers: Headers): void {
  for (const [name, value] of securityHeaders()) {
    if (name === 'content-security-policy' && headers.has(name)) continue
    headers.set(name, value)
  }
}

/** The node adapter's `_headers.json`: the hashed CSP of each prerendered page, by path. */
export type PageHeaders = readonly { pathname: string; headers: readonly { key: string; value: string }[] }[]

interface NodeRequest {
  url?: string
}
interface NodeResponse {
  setHeader(name: string, value: string): unknown
}

/** `/sk/` and `/sk` are the same page (the adapter serves sk/index.html for both); no query. */
function pagePath(url: string): string {
  let path = url.split(/[?#]/, 1)[0] ?? ''
  try {
    path = decodeURI(path)
  } catch {
    // the adapter answers 400 to an undecodable path
  }
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

/**
 * For the node adapter's request handler, which serves prerendered pages and bundled assets before
 * the app (and the middleware) runs: sets every security header on the Node response before anything
 * is written, and a prerendered page's hashed CSP (from `pages`) when the path is exactly that page's.
 * Any other file gets the baseline CSP, so a page whose policy is not found runs no script (fails closed).
 * A response the app writes later replaces these with its own values.
 */
export function staticSecurityHeaders(pages: PageHeaders = []): (req: NodeRequest, res: NodeResponse) => void {
  const policies = new Map<string, string>()
  for (const { pathname, headers } of pages) {
    const csp = headers.find((h) => h.key.toLowerCase() === 'content-security-policy')
    if (csp) policies.set(pagePath(pathname), csp.value)
  }
  return (req, res) => {
    for (const [name, value] of securityHeaders()) res.setHeader(name, value)
    const policy = policies.get(pagePath(req.url ?? ''))
    if (policy) res.setHeader('Content-Security-Policy', policy)
  }
}

const SAFE_METHODS = new Set(['GET', 'HEAD'])

/**
 * CSRF: a request other than GET or HEAD is accepted only when its `Origin` is exactly the public
 * origin. Fails closed: no Origin, `null`, or any other origin is refused. The request's own URL is
 * not trusted (behind a proxy it is the internal address).
 */
export function checkOrigin(request: Request, publicOrigin: string): boolean {
  if (SAFE_METHODS.has(request.method)) return true
  const origin = request.headers.get('origin')
  return origin !== null && origin === new URL(publicOrigin).origin
}
