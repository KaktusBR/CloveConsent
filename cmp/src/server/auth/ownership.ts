// Better Auth's endpoints that take the id of one of the signed-in person's own things answer 404 for
// anyone else's, exactly as for an id that does not exist (Review Focus 1: never a different answer that
// tells an existing id of someone else from a made-up one). Better Auth's own answers differ: /revoke-session
// says done for any token (and does nothing to another person's session), and the passkey endpoints answer
// 401 for another person's passkey but 404 for a passkey that does not exist.
import { APIError } from 'better-auth/api'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The parts of a Better Auth endpoint context these checks read. */
interface OwnershipContext {
  path: string
  body?: unknown
  context: {
    internalAdapter: { findSession(token: string): Promise<{ session: { userId: string } } | null> }
    adapter: { findOne<T>(query: { model: string; where: { field: string; value: string }[] }): Promise<T | null> }
  }
}

const field = (body: unknown, name: string): unknown => (body !== null && typeof body === 'object' ? (body as Record<string, unknown>)[name] : undefined)

/**
 * Throws 404 when the request names a session or passkey that is not `userId`'s (the signed-in person's);
 * does nothing for any other endpoint.
 */
export async function refuseOthersIds(ctx: OwnershipContext, userId: string): Promise<void> {
  if (ctx.path === '/revoke-session') {
    const token = field(ctx.body, 'token')
    const found = typeof token === 'string' ? await ctx.context.internalAdapter.findSession(token) : null
    if (found?.session.userId !== userId) throw new APIError('NOT_FOUND', { code: 'SESSION_NOT_FOUND', message: 'session not found' })
  }
  if (ctx.path === '/passkey/delete-passkey' || ctx.path === '/passkey/update-passkey') {
    const id = field(ctx.body, 'id')
    const passkey = typeof id === 'string' && UUID.test(id) ? await ctx.context.adapter.findOne<{ userId: string }>({ model: 'passkey', where: [{ field: 'id', value: id }] }) : null
    if (passkey?.userId !== userId) throw new APIError('NOT_FOUND', { code: 'PASSKEY_NOT_FOUND', message: 'passkey not found' })
  }
}
