// The client address that rate limits count. Never taken from a header the client controls: the socket
// peer (what the node adapter saw), or, only when that peer is a trusted reverse proxy (TRUSTED_PROXIES),
// the nearest address in X-Forwarded-For that is not a trusted proxy.
import { BlockList, isIP } from 'node:net'

/** Addresses and CIDR ranges (`10.0.0.0/8`, `fd00::/8`, `192.0.2.10`); throws on anything else. */
export function trustedProxies(entries: readonly string[]): BlockList {
  const list = new BlockList()
  for (const entry of entries) {
    const parsed = parseRange(entry)
    if (!parsed) throw new TypeError('trustedProxies: not an address or CIDR range')
    list.addSubnet(parsed.address, parsed.prefix, parsed.family)
  }
  return list
}

/** `address[/prefix]` → its parts, or null. A range of every address (`/0`) is refused: it would trust any client. */
export function parseRange(entry: string): { address: string; prefix: number; family: 'ipv4' | 'ipv6' } | null {
  const [address = '', prefixText, ...rest] = entry.split('/')
  const version = isIP(address)
  if (version === 0 || rest.length > 0) return null
  const max = version === 4 ? 32 : 128
  if (prefixText !== undefined && !/^\d{1,3}$/.test(prefixText)) return null
  const prefix = prefixText === undefined ? max : Number(prefixText)
  if (prefix < 1 || prefix > max) return null
  return { address, prefix, family: version === 4 ? 'ipv4' : 'ipv6' }
}

/** `::ffff:203.0.113.5` is 203.0.113.5; anything that is not an address is null. */
function normalize(value: string | undefined): string | null {
  const address = (value ?? '').trim().replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '')
  return isIP(address) === 0 ? null : address
}

const isTrusted = (address: string, proxies: BlockList) => proxies.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6')

/**
 * The client's address, or null when the peer is unknown (the request is then refused: it must never
 * share a bucket with other requests). From a trusted proxy, X-Forwarded-For is read right to left: each
 * trusted hop is skipped, the first untrusted address is the client; a hop that is not an address stops
 * the walk at the last trusted address (what the proxies could vouch for).
 */
export function clientAddress(peer: string | undefined, forwardedFor: string | null, proxies: BlockList): string | null {
  let address = normalize(peer)
  if (address === null || !isTrusted(address, proxies)) return address
  const hops = (forwardedFor ?? '').split(',').map((h) => h.trim()).filter((h) => h !== '')
  for (let i = hops.length - 1; i >= 0; i--) {
    const hop = normalize(hops[i])
    if (hop === null) return address
    address = hop
    if (!isTrusted(hop, proxies)) return hop
  }
  return address
}
