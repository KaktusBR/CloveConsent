// The super-admin console's reads and its impersonation records, on the system role through asSystem:
// every call is itself recorded in the audit log (system.access) with the super-admin's id. The system
// role sees only the columns of accounts, members and people that the console shows
// (drizzle/0008_entitlements.sql). Who is a super-admin is decided before any of this is called
// (src/server/auth/super-admin.ts).
import { sql } from 'drizzle-orm'
import { ROLES, type Role } from '../../lib/roles'
import { audit } from './audit'
import { adminReason, dateOf, entitlementAt, entitlementRecords, type Entitlement, type Timestamp } from './entitlements'
import { asSystem } from './scope'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)

/** At most this many accounts in a list, and audit events on a page. */
export const CONSOLE_PAGE = 100

export interface AccountListItem {
  id: string
  name: string
  createdAt: Date
  entitlement: Entitlement
}

/** `text` for a LIKE pattern that matches it literally. */
const literal = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`)

/**
 * Accounts, newest first: all of them for an empty query; else the one with that id, those whose name
 * contains it, and those with a member whose address contains it (case ignored).
 */
export async function searchAccounts(actorUserId: string, query: string, now: Date = new Date()): Promise<AccountListItem[]> {
  const q = query.trim().slice(0, 200)
  const pattern = `%${literal(q)}%`
  return asSystem(
    'super-admin: account list',
    async (tx) => {
      const { rows } = await tx.execute<{ id: string; name: string; created_at: Timestamp }>(sql`
        select a.id, a.name, a.created_at from auth_account a
        where ${q} = ''
           or a.id::text = lower(${q})
           or a.name ilike ${pattern} escape '\\'
           or exists (select 1 from auth_account_member m join auth_user u on u.id = m.user_id
                      where m.account_id = a.id and u.email ilike ${pattern} escape '\\')
        order by a.created_at desc, a.id
        limit ${CONSOLE_PAGE}`)
      const records = await entitlementRecords(tx, rows.map((r) => r.id))
      return rows.map((r) => ({ id: r.id, name: r.name, createdAt: dateOf(r.created_at), entitlement: entitlementAt(records.get(r.id) ?? null, now) }))
    },
    actorUserId,
  )
}

export interface AccountMember {
  userId: string
  name: string
  email: string
  role: Role
}

export interface AccountDetail {
  id: string
  name: string
  createdAt: Date
  entitlement: Entitlement
  /** When a super-admin suspended it (null: not suspended). */
  suspendedAt: Date | null
  /** Owners first, then by address. */
  members: AccountMember[]
}

/** One account with its entitlement and members, or null when there is no such account. */
export async function accountDetail(actorUserId: string, accountId: string, now: Date = new Date()): Promise<AccountDetail | null> {
  if (!isUuid(accountId)) return null
  return asSystem(
    'super-admin: account',
    async (tx) => {
      const account = (await tx.execute<{ id: string; name: string; created_at: Timestamp }>(sql`select id, name, created_at from auth_account where id = ${accountId}`)).rows[0]
      if (!account) return null
      const record = (await entitlementRecords(tx, [accountId])).get(accountId) ?? null
      const { rows } = await tx.execute<{ user_id: string; name: string; email: string; role: Role }>(sql`
        select m.user_id, u.name, u.email, m.role from auth_account_member m join auth_user u on u.id = m.user_id
        where m.account_id = ${accountId}`)
      const rank = (role: Role) => ROLES.indexOf(role)
      const members = rows
        .map((r) => ({ userId: r.user_id, name: r.name, email: r.email, role: r.role }))
        .sort((a, b) => rank(a.role) - rank(b.role) || a.email.localeCompare(b.email))
      return { id: account.id, name: account.name, createdAt: dateOf(account.created_at), entitlement: entitlementAt(record, now), suspendedAt: record?.suspendedAt ?? null, members }
    },
    actorUserId,
  )
}

/** A member of `accountId` (the person a super-admin may view the account as), or null. */
export async function accountMember(actorUserId: string, accountId: string, userId: string): Promise<AccountMember | null> {
  if (!isUuid(accountId) || !isUuid(userId)) return null
  return asSystem(
    'super-admin: impersonation target',
    async (tx) => {
      const row = (await tx.execute<{ user_id: string; name: string; email: string; role: Role }>(sql`
        select m.user_id, u.name, u.email, m.role from auth_account_member m join auth_user u on u.id = m.user_id
        where m.account_id = ${accountId} and m.user_id = ${userId}`)).rows[0]
      return row ? { userId: row.user_id, name: row.name, email: row.email, role: row.role } : null
    },
    actorUserId,
  )
}

/**
 * Records a super-admin starting (with their reason) or stopping a read-only view of `accountId` as
 * `userId`, in that account's audit log (a view stopped after the member left the account: in none).
 */
export async function recordImpersonation(actorUserId: string, accountId: string | null, userId: string, event: 'start' | 'stop', reason?: string): Promise<void> {
  const why = event === 'start' ? adminReason(reason) : null
  if (event === 'start' && why === null) throw new TypeError('an impersonation needs a reason')
  await asSystem(
    `super-admin: impersonation ${event}`,
    (tx) => audit(tx, { action: `admin.impersonation_${event}`, target: `user:${userId}`, meta: why === null ? {} : { reason: why }, actorUserId, accountId }),
    actorUserId,
  )
}

export interface AuditEventRow {
  id: string
  createdAt: Date
  actorUserId: string | null
  actorEmail: string | null
  accountId: string | null
  accountName: string | null
  action: string
  target: string | null
  meta: Record<string, unknown>
}

/** The newest audit events (CONSOLE_PAGE at most), of one account when `accountId` is given. */
export async function auditEvents(actorUserId: string, filter: { accountId?: string | undefined }): Promise<AuditEventRow[]> {
  const accountId = isUuid(filter.accountId) ? filter.accountId : null
  if (filter.accountId !== undefined && accountId === null) return []
  return asSystem(
    'super-admin: audit log',
    async (tx) => {
      const { rows } = await tx.execute<{
        id: string
        created_at: Timestamp
        actor_user_id: string | null
        actor_email: string | null
        account_id: string | null
        account_name: string | null
        action: string
        target: string | null
        meta: Record<string, unknown>
      }>(sql`
        select l.id, l.created_at, l.actor_user_id, u.email as actor_email, l.account_id, a.name as account_name, l.action, l.target, l.meta
        from audit_log l left join auth_user u on u.id = l.actor_user_id left join auth_account a on a.id = l.account_id
        where ${accountId}::uuid is null or l.account_id = ${accountId}::uuid
        order by l.created_at desc, l.id desc
        limit ${CONSOLE_PAGE}`)
      return rows.map((r) => ({
        id: r.id,
        createdAt: dateOf(r.created_at),
        actorUserId: r.actor_user_id,
        actorEmail: r.actor_email,
        accountId: r.account_id,
        accountName: r.account_name,
        action: r.action,
        target: r.target,
        meta: r.meta,
      }))
    },
    actorUserId,
  )
}
