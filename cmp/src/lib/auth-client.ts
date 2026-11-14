// Better Auth's browser client, for the auth islands. Same origin (/api/auth), so its POSTs carry this
// site's Origin, as the middleware requires.
import { passkeyClient } from '@better-auth/passkey/client'
import { createAuthClient } from 'better-auth/client'
import { twoFactorClient } from 'better-auth/client/plugins'

export const authClient = createAuthClient({
  basePath: '/api/auth',
  // the sign-in form moves to the second step itself (src/components/auth/SignInForm.tsx)
  plugins: [twoFactorClient(), passkeyClient()],
})

/** What a failed call returns: Better Auth's code (never shown) and the HTTP status. */
export interface AuthFailure {
  code?: string | undefined
  status: number
}
