import { sql } from 'drizzle-orm'
import { check, jsonb, pgPolicy, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core'
import { organization } from './auth'
import { appRole, isCurrentAccount, systemRole } from './tenancy'

/** What a plan allows (enforced by the parts of the product they limit, in later plans). */
export interface PlanLimits {
  sites: number
  languages: number
  scansPerMonth: number
  recordsPerMonth: number
  members: number
}

/**
 * The plans and their limits: data, not code. Reference data, not tenant data: the same for every
 * account, no account_id and no row-level security (test/db/rls.test.ts lists it as such). Seeded and
 * changed by migrations only; cmp_app and cmp_system may SELECT, nothing else. `name_key` is the
 * catalog key of the plan's name (messages/*.json).
 */
export const plans = pgTable(
  'plans',
  {
    id: text('id').primaryKey(),
    nameKey: text('name_key').notNull(),
    limits: jsonb('limits').$type<PlanLimits>().notNull(),
  },
  (t) => [
    check('plans_id_check', sql`${t.id} ~ '^[a-z][a-z0-9-]*$'`),
    check('plans_limits_check', sql`jsonb_typeof(${t.limits}) = 'object' and ${t.limits} ?& array['sites', 'languages', 'scansPerMonth', 'recordsPerMonth', 'members']`),
  ],
)

/**
 * What an account has paid for (src/server/data/entitlements.ts reads it into a state). No row: never
 * paid. Tenant data: forced row-level security; cmp_app may only read its current account's row (the
 * request gate); cmp_system reads and writes any (the super-admin console, through asSystem, each change
 * with its audit row). `account_id` is the key: one entitlement per account.
 */
export const entitlements = pgTable(
  'entitlements',
  {
    accountId: uuid('account_id')
      .primaryKey()
      .references(() => organization.id),
    planId: text('plan_id').references(() => plans.id),
    /** Paid up to this instant (exclusive): active before it, then the grace period. */
    paidUntil: timestamp('paid_until', { withTimezone: true }),
    /** Suspended by a super-admin at this instant: the grace period starts then (if it has not already). */
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    pgPolicy('entitlements_app_select', { for: 'select', to: appRole, using: isCurrentAccount(t.accountId) }),
    pgPolicy('entitlements_system_select', { for: 'select', to: systemRole, using: sql`true` }),
    pgPolicy('entitlements_system_insert', { for: 'insert', to: systemRole, withCheck: sql`true` }),
    pgPolicy('entitlements_system_update', { for: 'update', to: systemRole, using: sql`true`, withCheck: sql`true` }),
  ],
)
