// Rate limits of the app's own form endpoints (Better Auth's endpoints have its own: src/server/auth/auth.ts),
// counted in the database (src/server/data/auth-limits.ts: shared by every app process, cleared by the
// auth.cleanup job): one window per person and one per client address, so neither more sessions nor more
// people behind one address get past them.
import { clientAddress, trustedProxies } from '../client-address'
import { releaseInWindow, reserveInWindow } from '../data/auth-limits'
import { env } from '../env'
import { socketPeer } from '../socket-peer'

/** At most `max` tries in `window` seconds. */
export interface RequestLimit {
  readonly window: number
  readonly max: number
}

const proxies = trustedProxies(env.TRUSTED_PROXIES)

/**
 * Takes a place in `name`'s window for `userId` and in the one for the request's client address; false
 * when either is full, or when the address is unknown (src/server/socket-peer.ts: never a header the
 * client chose). A place taken in the person's window is given back when the address's is full.
 */
export async function withinLimit(request: Request, name: string, userId: string, { window, max }: RequestLimit): Promise<boolean> {
  const client = clientAddress(socketPeer(request), request.headers.get('x-forwarded-for'), proxies)
  if (client === null) return false
  const byUser = `${name}:user:${userId}`
  const user = await reserveInWindow(byUser, window, max)
  if (user === false) return false
  if ((await reserveInWindow(`${name}:client:${client}`, window, max)) === false) {
    await releaseInWindow(byUser, user)
    return false
  }
  return true
}
