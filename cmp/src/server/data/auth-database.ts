// The one exception to the data-layer rule (ruling R2): Better Auth's adapter needs a database handle for
// its identity tables (user, session, account, verification, twoFactor, passkey, organization, member,
// invitation, rateLimit), which are guarded by Better Auth, not by row-level security.
//
// Only src/server/auth/ may import this module (lint rule cmp/data-layer-only). It connects as cmp_app on
// the app pool with no account set, so every tenant table reads as empty through it.
import { appDatabase, type Database } from './client'

export const authDatabase: Database = appDatabase
