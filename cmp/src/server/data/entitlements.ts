// What an account has paid for, and the state that decides its access (Review Focus 3).
//
// The request gate reads an account's entitlement on every request (src/server/auth/guard.ts), in a
// transaction scoped to that account (row-level security): a change by the super-admin applies to the
// account's next request, with no new sign-in. Changes are made only by a super-admin through asSystem,
// each in one transaction with its audit row (actor and reason). Until a payment provider is chosen
// (a later plan), that is how an account gets paid.
import { sql } from 'drizzle-orm'
import { plainText } from './accounts'
import { audit } from './audit'
import { appDatabase } from './client'
import type { PlanLimits } from './schema'
import { asSystem, withAccount, type SystemTx } from './scope'

/** Days of grace after the paid time ends or the account is suspended. */
export const GRACE_DAYS = 30
const GRACE_MS = GRACE_DAYS * 24 * 60 * 60 * 1000

/**
 * - `active`: paid (until `paidUntil`, exclusive);
 * - `grace`: for GRACE_DAYS after `paidUntil` or after a suspension, whichever comes first;
 * - `necessary-only`: after that;
 * - `none`: never paid.
 * The admin is for `active` and `grace`; `necessary-only` and `none` get the paywall and account settings
 * only (src/server/auth/access.ts). What grace and necessary-only mean for a published site is a later plan's.
 */
export type EntitlementState = 'active' | 'grace' | 'necessary-only' | 'none'

export interface Entitlement {
  state: EntitlementState
  planId: string | null
  paidUntil: Date | null
  /** When the grace period ends (or ended): GRACE_DAYS after `paidUntil` or the suspension. */
  graceEndsAt: Date | null
}

/** An account's row of `entitlements` (none: never paid). */
export interface EntitlementRecord {
  planId: string | null
  paidUntil: Date | null
  suspendedAt: Date | null
}

/** The entitlement a record gives at `now`. */
export function entitlementAt(record: EntitlementRecord | null, now: Date): Entitlement {
  if (!record?.paidUntil) return { state: 'none', planId: record?.planId ?? null, paidUntil: null, graceEndsAt: null }
  const { paidUntil, suspendedAt } = record
  const ends = suspendedAt && suspendedAt.getTime() < paidUntil.getTime() ? suspendedAt : paidUntil
  const graceEndsAt = new Date(ends.getTime() + GRACE_MS)
  const t = now.getTime()
  const state: EntitlementState = t < ends.getTime() ? 'active' : t < graceEndsAt.getTime() ? 'grace' : 'necessary-only'
  return { state, planId: record.planId, paidUntil, graceEndsAt }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)

/** A timestamp as a raw query returns it (drizzle leaves timestamptz as text). */
export type Timestamp = Date | string

/** A timestamp column's value as a Date. */
export const dateOf = (value: Timestamp): Date => (value instanceof Date ? value : new Date(value))
const dateOrNull = (value: Timestamp | null): Date | null => (value === null ? null : dateOf(value))

type EntitlementRow = {
  plan_id: string | null
  paid_until: Timestamp | null
  suspended_at: Timestamp | null
}
const recordOf = (row: EntitlementRow | undefined): EntitlementRecord | null =>
  row ? { planId: row.plan_id, paidUntil: dateOrNull(row.paid_until), suspendedAt: dateOrNull(row.suspended_at) } : null

/** The entitlement of `accountId` at `now`, read in a transaction scoped to that account. */
export async function entitlementOf(accountId: string, now: Date = new Date()): Promise<Entitlement> {
  if (!isUuid(accountId)) return entitlementAt(null, now)
  const row = await withAccount({ accountId }, async (tx) =>
    (await tx.execute<EntitlementRow>(sql`select plan_id, paid_until, suspended_at from entitlements where account_id = ${accountId}`)).rows[0],
  )
  return entitlementAt(recordOf(row), now)
}

/** The entitlement records of some accounts, for the console (system role). */
export async function entitlementRecords(tx: SystemTx, accountIds: readonly string[]): Promise<Map<string, EntitlementRecord>> {
  if (accountIds.length === 0) return new Map()
  const { rows } = await tx.execute<EntitlementRow & { account_id: string }>(
    sql`select account_id, plan_id, paid_until, suspended_at from entitlements where account_id = any(${sql.param([...accountIds])}::uuid[])`,
  )
  return new Map(rows.map((r) => [r.account_id, recordOf(r) as EntitlementRecord]))
}

export interface Plan {
  id: string
  /** The catalog key of its name. */
  nameKey: string
  limits: PlanLimits
}

/** Every plan, smallest first (reference data, read on the app role). */
export async function listPlans(): Promise<Plan[]> {
  const { rows } = await appDatabase.execute<{ id: string; name_key: string; limits: PlanLimits }>(
    sql`select id, name_key, limits from plans order by (limits->>'sites')::int, id`,
  )
  return rows.map((r) => ({ id: r.id, nameKey: r.name_key, limits: r.limits }))
}

/** The longest reason a super-admin may give. */
export const MAX_REASON = 500

/** A super-admin's reason as given (trimmed), or null when it is missing, too long or holds control characters. */
export const adminReason = (value: unknown): string | null => plainText(value, MAX_REASON)

function requireReason(reason: string): string {
  const text = adminReason(reason)
  if (text === null) throw new TypeError('a super-admin action needs a reason')
  return text
}

const accountExists = async (tx: SystemTx, accountId: string) =>
  (await tx.execute(sql`select id from auth_account where id = ${accountId}`)).rows.length > 0

const iso = (t: Timestamp | null | undefined) => (t ? dateOf(t).toISOString() : null)

export type EntitlementSet = 'ok' | 'not_found' | 'bad_plan'

/** A super-admin sets an account's plan and the instant it is paid until (audited with `reason`). */
export async function setEntitlement(actorUserId: string, accountId: string, change: { planId: string; paidUntil: Date }, reason: string): Promise<EntitlementSet> {
  const why = requireReason(reason)
  if (!isUuid(accountId)) return 'not_found'
  if (Number.isNaN(change.paidUntil.getTime())) throw new TypeError('setEntitlement: paidUntil is not a date')
  return asSystem(
    'super-admin: set entitlement',
    async (tx) => {
      if (!(await accountExists(tx, accountId))) return 'not_found'
      if ((await tx.execute(sql`select id from plans where id = ${change.planId}`)).rows.length === 0) return 'bad_plan'
      const before = (await tx.execute<EntitlementRow>(sql`select plan_id, paid_until, suspended_at from entitlements where account_id = ${accountId} for update`)).rows[0]
      await tx.execute(sql`
        insert into entitlements (account_id, plan_id, paid_until) values (${accountId}, ${change.planId}, ${change.paidUntil})
        on conflict (account_id) do update set plan_id = excluded.plan_id, paid_until = excluded.paid_until, updated_at = now()`)
      await audit(tx, {
        action: 'admin.entitlement_set',
        target: `account:${accountId}`,
        meta: {
          reason: why,
          planId: change.planId,
          paidUntil: change.paidUntil.toISOString(),
          before: { planId: before?.plan_id ?? null, paidUntil: iso(before?.paid_until), suspendedAt: iso(before?.suspended_at) },
        },
        actorUserId,
        accountId,
      })
      return 'ok'
    },
    actorUserId,
  )
}

export type Suspension = 'ok' | 'not_found' | 'already_suspended'
export type Unsuspension = 'ok' | 'not_found' | 'not_suspended'

/** A super-admin suspends an account now: its grace period starts (audited with `reason`). */
export async function suspendAccount(actorUserId: string, accountId: string, reason: string): Promise<Suspension> {
  const why = requireReason(reason)
  if (!isUuid(accountId)) return 'not_found'
  return asSystem(
    'super-admin: suspend account',
    async (tx) => {
      if (!(await accountExists(tx, accountId))) return 'not_found'
      // the app's clock, as the request gate reads the state with it (entitlementOf)
      const now = new Date()
      const { rows } = await tx.execute(sql`
        insert into entitlements (account_id, suspended_at) values (${accountId}, ${now})
        on conflict (account_id) do update set suspended_at = ${now}, updated_at = now() where entitlements.suspended_at is null
        returning account_id`)
      if (rows.length === 0) return 'already_suspended'
      await audit(tx, { action: 'admin.account_suspend', target: `account:${accountId}`, meta: { reason: why }, actorUserId, accountId })
      return 'ok'
    },
    actorUserId,
  )
}

/** A super-admin lifts a suspension: the paid time counts again (audited with `reason`). */
export async function unsuspendAccount(actorUserId: string, accountId: string, reason: string): Promise<Unsuspension> {
  const why = requireReason(reason)
  if (!isUuid(accountId)) return 'not_found'
  return asSystem(
    'super-admin: unsuspend account',
    async (tx) => {
      if (!(await accountExists(tx, accountId))) return 'not_found'
      const { rows } = await tx.execute(sql`
        update entitlements set suspended_at = null, updated_at = now() where account_id = ${accountId} and suspended_at is not null returning account_id`)
      if (rows.length === 0) return 'not_suspended'
      await audit(tx, { action: 'admin.account_unsuspend', target: `account:${accountId}`, meta: { reason: why }, actorUserId, accountId })
      return 'ok'
    },
    actorUserId,
  )
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/**
 * The instant an account paid through `day` (YYYY-MM-DD, the console's date field) is paid until: the
 * end of that day in UTC (the start of the next). Null for anything but a real day from 2000 to 2100.
 */
export function paidThroughDay(day: unknown): Date | null {
  const match = typeof day === 'string' ? DAY.exec(day) : null
  if (!match) return null
  const [year, month, date] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const start = new Date(Date.UTC(year, month - 1, date))
  if (year < 2000 || year > 2100 || start.getUTCMonth() !== month - 1 || start.getUTCDate() !== date) return null
  return new Date(Date.UTC(year, month - 1, date + 1))
}

/** The last instant an account paid until `paidUntil` (exclusive) is paid: its day is the one it is paid through. */
export const paidThrough = (paidUntil: Date): Date => new Date(paidUntil.getTime() - 1)

/** The day (YYYY-MM-DD, UTC) an account paid until `paidUntil` is paid through: the inverse of paidThroughDay. */
export const paidThroughDayOf = (paidUntil: Date): string => paidThrough(paidUntil).toISOString().slice(0, 10)
