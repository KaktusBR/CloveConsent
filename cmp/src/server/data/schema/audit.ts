import { sql } from 'drizzle-orm'
import { index, jsonb, pgPolicy, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'
import { organization } from './auth'
import { appRole, isCurrentAccount, systemRole } from './tenancy'

/**
 * Append-only record of sensitive actions. Grants (in the migrations): SELECT, and INSERT of the event
 * columns only (not id or created_at), to cmp_app and cmp_system; never UPDATE, DELETE or TRUNCATE.
 * Inserts therefore go through appendAuditEvent (src/server/data/audit.ts), which names only those columns.
 *
 * - cmp_app reads and writes only rows of the current account. Rows with no account (global and system
 *   events) are invisible to it and it cannot write them.
 * - cmp_system reads every row (super-admin audit viewer) and writes any row (system events,
 *   asSystem's access records).
 *
 * `account_id` references the account (auth_account; no action on delete: an account with audit rows
 * cannot be deleted until account deletion decides what happens to them); `actor_user_id` is a user id. `meta` never holds secrets:
 * src/server/data/audit.ts refuses sensitive keys.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    actorUserId: uuid('actor_user_id'),
    accountId: uuid('account_id').references(() => organization.id),
    action: text('action').notNull(),
    target: text('target'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('audit_log_account_created_idx').on(t.accountId, t.createdAt.desc()),
    // A super-admin's view (src/server/auth/super-admin.ts) ends once: one stop row per view, whoever
    // tries to end it and however often (src/server/data/admin.ts relies on this to make ending single-use).
    uniqueIndex('audit_log_impersonation_ends_once').on(sql`(${t.meta}->>'impersonation')`).where(sql`${t.action} = 'admin.impersonation_stop'`),
    pgPolicy('audit_log_app_select', { for: 'select', to: appRole, using: isCurrentAccount(t.accountId) }),
    pgPolicy('audit_log_app_insert', { for: 'insert', to: appRole, withCheck: isCurrentAccount(t.accountId) }),
    pgPolicy('audit_log_system_select', { for: 'select', to: systemRole, using: sql`true` }),
    pgPolicy('audit_log_system_insert', { for: 'insert', to: systemRole, withCheck: sql`true` }),
  ],
)
