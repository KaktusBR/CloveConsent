// The TCP peer of a request (the address the connection came from, as the operating system reports
// it), carried to the app in an internal request header, SOCKET_PEER_HEADER.
//
// Set on the incoming Node request before Astro sees it, after deleting any copy the client sent: by the
// node adapter (a build patch, astro.config.mjs) in production, by a dev-server middleware in
// `astro dev`. A header, not a property of the Request object, because Astro builds new Request
// objects from it (forwarded headers under security.allowedDomains, rewrites), and headers are copied.
// Astro's own `clientAddress` is not used: it is the leftmost X-Forwarded-For entry, chosen by the
// client, as soon as allowedDomains validates the Host.
//
// No import of the server's environment: astro.config.mjs loads this module.

export const SOCKET_PEER_HEADER = 'x-cmp-socket-peer'

/** The parts of a Node IncomingMessage used here. */
interface NodeRequest {
  headers: Record<string, string | string[] | undefined>
  socket?: { remoteAddress?: string | undefined } | undefined
}

/** Replace whatever the client sent under SOCKET_PEER_HEADER with the connection's peer (none: absent). */
export function stampSocketPeer(req: NodeRequest): void {
  delete req.headers[SOCKET_PEER_HEADER]
  const address = req.socket?.remoteAddress
  if (typeof address === 'string' && address !== '') req.headers[SOCKET_PEER_HEADER] = address
}

/** `astro dev`'s equivalent of the node adapter patch (a Connect middleware, astro.config.mjs). */
export function socketPeerDevMiddleware(req: NodeRequest, _res: unknown, next: () => void): void {
  stampSocketPeer(req)
  next()
}

/** The TCP peer of `request`, or undefined when none was recorded (the request is then refused). */
export function socketPeer(request: Request): string | undefined {
  return request.headers.get(SOCKET_PEER_HEADER) ?? undefined
}
