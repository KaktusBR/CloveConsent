// A pg.Pool whose checked-out clients die on release. Like client.ts, only src/server/data/ may import
// this module (lint rule cmp/data-layer-only).
//
// Why: pg-pool reuses one client object across checkouts and, after release(), still lets query() run on
// it. Anything that kept a reference to a released client (a Drizzle query builder or `tx.query.*` created
// inside a withAccount callback and awaited after it, a nested transaction handle) would run its query on
// whatever that connection is doing next: idle autocommit without app.account_id, or inside another
// request's withAccount transaction, with that account's setting and rows. Here each checkout hands out a
// fresh guard over the client; once that checkout is released, every use of the guard throws, while the
// pool's next checkout gets a new, working guard over the same connection.
import pg from 'pg'

export class ReleasedClientError extends Error {
  override readonly name = 'ReleasedClientError'
  constructor() {
    super('database client used after it was released: a query or handle escaped its withAccount/asSystem callback')
  }
}

function guard(client: pg.PoolClient): pg.PoolClient {
  let released = false
  return new Proxy(client, {
    get(target, prop) {
      if (released) throw new ReleasedClientError()
      if (prop === 'release') {
        return (...args: Parameters<pg.PoolClient['release']>) => {
          released = true
          target.release(...args)
        }
      }
      const value: unknown = Reflect.get(target, prop, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
}

type ConnectCallback = (err: Error | undefined, client: pg.PoolClient | undefined, done: (release?: unknown) => void) => void

export class GuardedPool extends pg.Pool {
  override connect(): Promise<pg.PoolClient>
  override connect(callback: ConnectCallback): void
  override connect(callback?: ConnectCallback): Promise<pg.PoolClient> | void {
    // pool.query() checks out through the callback form; Drizzle's transactions through the promise form
    if (callback) {
      return super.connect((err, client, done) => {
        if (!client) return callback(err, undefined, done)
        const guarded = guard(client)
        // pg-pool's `done` is the client's release: route it through the guard too
        callback(err, guarded, (release) => guarded.release(release as boolean | Error | undefined))
      })
    }
    return super.connect().then(guard)
  }
}
