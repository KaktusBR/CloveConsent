import type { APIRoute } from 'astro'

import { auth } from '../../../server/auth/auth'

export const prerender = false

/**
 * Better Auth's endpoints (sign-up, sign-in, verification, second factor, passkeys, sessions). A request
 * other than GET or HEAD reaches here only with this site's Origin (src/middleware.ts); Better Auth adds
 * its own origin and Fetch Metadata checks. Answers are never cached.
 */
export const ALL: APIRoute = async ({ request }) => {
  const answer = await auth.handler(request)
  // a copy: the headers of a redirect Better Auth built may be immutable
  const response = new Response(answer.body, answer)
  response.headers.set('Cache-Control', 'no-store')
  return response
}
