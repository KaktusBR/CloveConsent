// The TCP peer of a request: the address the connection came from, as the operating system reports it.
//
// Astro's `clientAddress` is not used for this: Astro takes the leftmost X-Forwarded-For entry (chosen
// by the client, behind a proxy) whenever the Host header validates against `security.allowedDomains`.
// The node adapter's request handler is patched (astro.config.mjs) to record `req.socket.remoteAddress`
// here, keyed by the Request object itself: nothing a client sends can set or change it.
const peers = new WeakMap<Request, string>()

/** Called by the patched node adapter for every request it hands to the app. */
export function recordSocketPeer(request: Request, address: string | undefined): void {
  if (typeof address === 'string' && address !== '') peers.set(request, address)
}

/** The TCP peer of `request`, or undefined when the adapter recorded none. */
export function socketPeer(request: Request): string | undefined {
  return peers.get(request)
}
