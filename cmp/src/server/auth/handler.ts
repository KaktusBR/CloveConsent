// What /api/auth/* runs: Better Auth's handler, told the client's address by us only.
//
// Better Auth keys its rate limits (and records a session's address) by the header named in
// `advanced.ipAddress.ipAddressHeaders`: CLIENT_ADDRESS_HEADER, which only this function sets. A value the
// client sent under that name is dropped; X-Forwarded-For counts only from a trusted proxy (TRUSTED_PROXIES,
// src/server/client-address.ts). A request whose address is unknown is refused, so it can neither share
// a bucket with other requests nor lock them out.
import { env } from '../env'
import { clientAddress, trustedProxies } from '../client-address'
import { CLIENT_ADDRESS_HEADER } from '../security'
import { auth, type AuthInstance } from './auth'

const proxies = trustedProxies(env.TRUSTED_PROXIES)

/**
 * @param peer the socket address of the connection (Astro's `clientAddress`), undefined when unknown
 */
export async function handleAuth(request: Request, peer: string | undefined, instance: AuthInstance = auth): Promise<Response> {
  const address = clientAddress(peer, request.headers.get('x-forwarded-for'), proxies)
  if (address === null) return new Response(null, { status: 400, headers: { 'Cache-Control': 'no-store' } })
  const headers = new Headers(request.headers)
  headers.set(CLIENT_ADDRESS_HEADER, address)
  const init: RequestInit & { duplex?: 'half' } = { method: request.method, headers, signal: request.signal }
  if (request.body !== null) {
    init.body = request.body
    init.duplex = 'half'
  }
  return instance.handler(new Request(request.url, init))
}
