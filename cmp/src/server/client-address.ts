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

/** An IPv6 address (no zone id) written canonically by the URL parser: lower case, an IPv4 tail as two groups, the longest zero run as `::`. */
const canonicalIPv6 = (address: string) => new URL(`http://[${address}]`).hostname.slice(1, -1)

/**
 * An address as IPv4 (an IPv4-mapped IPv6 address, `::ffff:203.0.113.5` or `::ffff:cb00:7105`, is its
 * IPv4 address) or as the eight groups of an IPv6 address (a zone id, `fe80::1%eth0`, dropped); null when
 * it is not an address. Validated by Node's parser; the groups are read from the URL parser's canonical form.
 */
function parse(value: string): { ipv4: string } | { ipv6: number[] } | null {
  const version = isIP(value)
  if (version === 4) return { ipv4: value }
  if (version !== 6) return null
  const [head = '', tail] = canonicalIPv6(value.split('%')[0] ?? '').split('::')
  const left = head === '' ? [] : head.split(':')
  const right = tail === undefined || tail === '' ? [] : tail.split(':')
  if (tail === undefined ? left.length !== 8 : left.length + right.length > 7) return null
  const groups = [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right].map((g) => Number.parseInt(g, 16))
  if (groups.some((g) => !(g >= 0 && g <= 0xffff))) return null
  const [g0, g1, g2, g3, g4, g5, g6 = 0, g7 = 0] = groups
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) return { ipv4: [g6 >> 8, g6 & 0xff, g7 >> 8, g7 & 0xff].join('.') }
  return { ipv6: groups }
}

const hex = (groups: number[]) => groups.map((g) => g.toString(16)).join(':')

/** The address in one spelling (see {@link parse}); anything that is not an address is null. */
function normalize(value: string | undefined): string | null {
  const parsed = parse((value ?? '').trim())
  if (parsed === null) return null
  return 'ipv4' in parsed ? parsed.ipv4 : canonicalIPv6(hex(parsed.ipv6))
}

const isTrusted = (address: string, proxies: BlockList) => proxies.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6')

/**
 * The client an address stands for: an IPv4 address itself, an IPv6 address its /64 (the prefix one
 * subscriber line or host gets; the rest is chosen freely by the client), written as an address
 * (`2001:db8:1:2::`) so Better Auth and our counters take it as is. Null when it is not an address.
 */
export function clientOf(input: string): string | null {
  const parsed = parse(input)
  if (parsed === null) return null
  return 'ipv4' in parsed ? parsed.ipv4 : canonicalIPv6(`${hex(parsed.ipv6.slice(0, 4))}::`)
}

/**
 * The client's address, or null when the peer is unknown (the request is then refused: it must never
 * share a bucket with other requests). From a trusted proxy, X-Forwarded-For is read right to left: each
 * trusted hop is skipped, the first untrusted address is the client; a hop that is not an address stops
 * the walk at the last trusted address (what the proxies could vouch for). An IPv6 client is its /64.
 */
export function clientAddress(peer: string | undefined, forwardedFor: string | null, proxies: BlockList): string | null {
  const address = forwardedClient(normalize(peer), forwardedFor, proxies)
  return address === null ? null : clientOf(address)
}

function forwardedClient(peer: string | null, forwardedFor: string | null, proxies: BlockList): string | null {
  let address = peer
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
