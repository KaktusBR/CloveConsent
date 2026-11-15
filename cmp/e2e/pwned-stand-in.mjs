// Preloaded into the e2e server (playwright.config.ts: node --import): Have I Been Pwned's range API
// answered locally, so no test makes a live network call. Same protocol as the real one (k-anonymity:
// the first five characters of the SHA-1 in the path, suffixes and counts in the answer). Any other
// request leaving this machine is refused.
import { createHash } from 'node:crypto'

/** The stand-in's breach corpus: e2e/auth.spec.ts signs up with it. No real corpus knows it, so a test that sees it refused proves the stand-in answered. */
export const BREACHED = ['cmp-e2e-only-breached-3f9c2a7d']

const hashes = BREACHED.map((p) => createHash('sha1').update(p).digest('hex').toUpperCase())
const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]'])
const real = globalThis.fetch

globalThis.fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  if (url.origin === 'https://api.pwnedpasswords.com') {
    const prefix = /^\/range\/([0-9A-F]{5})$/.exec(url.pathname)?.[1]
    if (!prefix) return new Response('', { status: 400 })
    const lines = hashes.filter((h) => h.startsWith(prefix)).map((h) => `${h.slice(5)}:3861493`)
    lines.push('0000000000000000000000000000000000A:0') // padding, as the real API sends
    return new Response(lines.join('\r\n'), { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }
  if (!LOCAL.has(url.hostname)) throw new TypeError(`e2e: no live network call (${url.origin})`)
  return real(input, init)
}
