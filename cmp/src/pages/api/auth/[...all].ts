import type { APIRoute } from 'astro'

import { handleAuth } from '../../../server/auth/handler'
import { socketPeer } from '../../../server/socket-peer'

export const prerender = false

/**
 * Better Auth's endpoints (sign-up, sign-in, verification, second factor, passkeys, sessions). A request
 * other than GET or HEAD reaches here only with this site's Origin (src/middleware.ts); Better Auth adds
 * its own origin and Fetch Metadata checks. The client address its rate limits count is the TCP peer
 * (never Astro's `clientAddress`, see src/server/socket-peer.ts), or what a trusted proxy says
 * (src/server/auth/handler.ts); without one the request is refused. Answers are never cached.
 */
export const ALL: APIRoute = async ({ request }) => {
  const answer = await handleAuth(request, socketPeer(request))
  // a copy: the headers of a redirect Better Auth built may be immutable
  const response = new Response(answer.body, answer)
  response.headers.set('Cache-Control', 'no-store')
  return response
}
