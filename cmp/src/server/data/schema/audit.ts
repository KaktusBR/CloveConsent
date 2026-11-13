import { sql } from 'drizzle-orm'
import { index, jsonb, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { appRole, isCurrentAccount, systemRole } from './tenancy'

/**
 * Append-only record of sensitive actions. Grants (in the migration): SELECT and INSERT to cmp_app and
 * cmp_system, never UPDATE, DELETE or TRUNCATE to anyone but the owner, which has no policy.
 *
 * - cmp_app reads and writes only rows of the current account. Rows with no account (global and system
 *   events) are invisible to it and it cannot write them.
 * - cmp_system reads every row (super-admin audit viewer) and writes any row (system events,
 *   asSystem's access records).
 *
 * `account_id` will reference Better Auth's organization id (Task 7 adds the foreign key);
 * `actor_user_id` its user id (the auth config must generate uuid ids). `meta` never holds secrets:
 * src/server/data/audit.ts refuses sensitive keys.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id'),
    accountId: uuid('account_id'),
    action: text('action').notNull(),
    target: text('target'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('audit_log_account_created_idx').on(t.accountId, t.createdAt.desc()),
    pgPolicy('audit_log_app_select', { for: 'select', to: appRole, using: isCurrentAccount(t.accountId) }),
    pgPolicy('audit_log_app_insert', { for: 'insert', to: appRole, withCheck: isCurrentAccount(t.accountId) }),
    pgPolicy('audit_log_system_select', { for: 'select', to: systemRole, using: sql`true` }),
    pgPolicy('audit_log_system_insert', { for: 'insert', to: systemRole, withCheck: sql`true` }),
  ],
)
