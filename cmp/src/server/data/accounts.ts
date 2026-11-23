// Accounts, their members and invitations (the organization plugin's tables, identity data: ruling R2).
//
// Reads that decide access (membershipOf, scopeFor) hit the database on every request: a role is never
// taken from a session or a cookie. Every change to members runs in one withAccount transaction together
// with its audit_log row (and, for an invitation, its email job), so a change is never without its record.
// Anything addressed by an id is looked up inside the caller's account only: another account's id is
// "not found", exactly like an id that does not exist.
import { createHash, randomBytes } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { audit } from './audit'
import { appDatabase } from './client'
import { withAccount, type AccountScope, type Role, type TenantTx } from './scope'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value)

/** How long an invitation can be accepted. */
export const INVITATION_DAYS = 7

export type AccountSummary = {
  id: string
  name: string
  role: Role
}

/** The role of `userId` in `accountId`, or null when not a member (or either id is malformed). */
export async function membershipOf(userId: string, accountId: string): Promise<Role | null> {
  if (!isUuid(userId) || !isUuid(accountId)) return null
  const { rows } = await appDatabase.execute<{ role: Role }>(
    sql`select role from auth_account_member where user_id = ${userId} and account_id = ${accountId}`,
  )
  return rows[0]?.role ?? null
}

/**
 * The account a request works in: the session's active account when the person is (still) a member of
 * it, else their oldest membership, else none. Checked against the memberships on every call.
 */
export async function scopeFor(userId: string, activeAccountId: string | null | undefined): Promise<AccountScope | null> {
  if (!isUuid(userId)) return null
  const active = isUuid(activeAccountId) ? activeAccountId : null
  const { rows } = await appDatabase.execute<{ account_id: string; role: Role }>(sql`
    select account_id, role from auth_account_member where user_id = ${userId}
    order by (account_id = ${active}) is true desc, created_at, id
    limit 1`)
  const row = rows[0]
  return row ? { accountId: row.account_id, userId, role: row.role } : null
}

/** Every account `userId` belongs to, by name. */
export async function accountsOf(userId: string): Promise<AccountSummary[]> {
  if (!isUuid(userId)) return []
  const { rows } = await appDatabase.execute<AccountSummary>(sql`
    select a.id, a.name, m.role from auth_account_member m join auth_account a on a.id = m.account_id
    where m.user_id = ${userId} order by a.name, a.id`)
  return rows
}

/** The scope's account (its name), for its own pages. */
export async function accountOf(scope: AccountScope): Promise<{ id: string; name: string } | null> {
  const { rows } = await appDatabase.execute<{ id: string; name: string }>(sql`select id, name from auth_account where id = ${scope.accountId}`)
  return rows[0] ?? null
}

const MAX_NAME = 100
/** Control and invisible format characters (bidi controls, zero-width space …), except the joiners. */
const CONTROL = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u
const JOINERS = /[‌‍]/gu

/** An account name as given (trimmed), or null when it is empty, too long or holds control characters. */
export function accountName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  if (name === '' || name.length > MAX_NAME || CONTROL.test(name.replace(JOINERS, ''))) return null
  return name
}

/** A new account named `name`, with `userId` as its owner. Returns its id. */
export async function createAccount(userId: string, name: string): Promise<string> {
  const accountId = crypto.randomUUID()
  const scope: AccountScope = { accountId, userId, role: 'owner' }
  await withAccount(scope, async (tx) => {
    // Better Auth requires a unique slug; the product does not use one
    await tx.execute(sql`insert into auth_account (id, name, slug) values (${accountId}, ${name}, ${accountId})`)
    await tx.execute(sql`insert into auth_account_member (account_id, user_id, role) values (${accountId}, ${userId}, 'owner')`)
    await audit(tx, { action: 'account.create', target: `account:${accountId}`, meta: { name }, actorUserId: userId, accountId })
    await audit(tx, { action: 'member.add', target: `user:${userId}`, meta: { role: 'owner' }, actorUserId: userId, accountId })
  })
  return accountId
}

export type MemberRow = {
  id: string
  userId: string
  name: string
  email: string
  role: Role
}

/** The scope's members, owners first. */
export async function listMembers(scope: AccountScope): Promise<MemberRow[]> {
  const { rows } = await appDatabase.execute<MemberRow>(sql`
    select m.id, m.user_id as "userId", u.name, u.email, m.role
    from auth_account_member m join auth_user u on u.id = m.user_id
    where m.account_id = ${scope.accountId}
    order by array_position(array['owner', 'admin', 'editor', 'viewer'], m.role), u.email`)
  return rows
}

export interface InvitationRow {
  id: string
  email: string
  role: Role
  expiresAt: Date
}

/** The scope's invitations still waiting for an answer (some may have expired), newest first. */
export async function listPendingInvitations(scope: AccountScope): Promise<InvitationRow[]> {
  const { rows } = await appDatabase.execute<{ id: string; email: string; role: Role; expires_at: string | Date }>(sql`
    select id, email, role, expires_at from auth_account_invitation
    where account_id = ${scope.accountId} and status = 'pending' order by created_at desc, id`)
  return rows.map((r) => ({ id: r.id, email: r.email, role: r.role, expiresAt: new Date(r.expires_at) }))
}

/**
 * The acting member's role, read again inside the change's transaction (it may have changed since the
 * request began). The account row is locked first, as the owner trigger does: changes to one account's
 * members run one after the other, never interleaved (and never deadlocked against each other).
 */
async function actorRole(tx: TenantTx, scope: AccountScope): Promise<Role | null> {
  await tx.execute(sql`select 1 from auth_account where id = ${scope.accountId} for no key update`)
  const { rows } = await tx.execute<{ role: Role }>(
    sql`select role from auth_account_member where account_id = ${scope.accountId} and user_id = ${scope.userId}`,
  )
  return rows[0]?.role ?? null
}

/** Admins may manage members; only an owner may touch an owner or make one. */
const managesMembers = (role: Role | null): role is 'owner' | 'admin' => role === 'owner' || role === 'admin'

/** Whether an error is the database refusing to leave an account without an owner (drizzle/0006_accounts.sql). */
function isLastOwnerError(err: unknown): boolean {
  for (let e: unknown = err; e !== null && typeof e === 'object'; e = (e as { cause?: unknown }).cause) {
    const { code, constraint } = e as { code?: unknown; constraint?: unknown }
    if (code === '23514' && constraint === 'auth_account_keeps_an_owner') return true
  }
  return false
}

/** Rolls a transaction back with a result for the caller. */
class Refused<T extends string> extends Error {
  constructor(readonly reason: T) {
    super(reason)
  }
}

async function refusable<T extends string>(run: () => Promise<void>): Promise<'ok' | T | 'last_owner'> {
  try {
    await run()
    return 'ok'
  } catch (err) {
    if (err instanceof Refused) return err.reason as T
    if (isLastOwnerError(err)) return 'last_owner'
    throw err
  }
}

export type MemberChange = 'ok' | 'not_found' | 'owner_only' | 'last_owner'

/** Give a member of the scope's account another role. */
export async function changeRole(scope: AccountScope, memberId: string, role: Role): Promise<MemberChange> {
  if (!isUuid(memberId)) return 'not_found'
  return refusable<MemberChange>(() =>
    withAccount(scope, async (tx) => {
      const actor = await actorRole(tx, scope)
      if (!managesMembers(actor)) throw new Refused('not_found')
      const { rows } = await tx.execute<{ user_id: string; role: Role }>(
        sql`select user_id, role from auth_account_member where id = ${memberId} and account_id = ${scope.accountId}`,
      )
      const target = rows[0]
      if (!target) throw new Refused('not_found')
      if ((target.role === 'owner' || role === 'owner') && actor !== 'owner') throw new Refused('owner_only')
      if (target.role === role) return
      await tx.execute(sql`update auth_account_member set role = ${role} where id = ${memberId}`)
      await audit(tx, { action: 'member.role_change', target: `user:${target.user_id}`, meta: { from: target.role, to: role }, actorUserId: scope.userId, accountId: scope.accountId })
    }),
  )
}

/** Remove a member (possibly the acting one) from the scope's account. */
export async function removeMember(scope: AccountScope, memberId: string): Promise<MemberChange> {
  if (!isUuid(memberId)) return 'not_found'
  return refusable<MemberChange>(() =>
    withAccount(scope, async (tx) => {
      const actor = await actorRole(tx, scope)
      if (!managesMembers(actor)) throw new Refused('not_found')
      const { rows } = await tx.execute<{ user_id: string; role: Role }>(
        sql`select user_id, role from auth_account_member where id = ${memberId} and account_id = ${scope.accountId}`,
      )
      const target = rows[0]
      if (!target) throw new Refused('not_found')
      if (target.role === 'owner' && actor !== 'owner') throw new Refused('owner_only')
      await tx.execute(sql`delete from auth_account_member where id = ${memberId}`)
      await audit(tx, { action: 'member.remove', target: `user:${target.user_id}`, meta: { role: target.role }, actorUserId: scope.userId, accountId: scope.accountId })
    }),
  )
}

/** What the invitation's email needs: the link's token exists only here and in that email. */
export interface NewInvitation {
  token: string
  email: string
  role: Role
  accountName: string
}

export type InvitationCreated = 'ok' | 'not_found' | 'owner_only' | 'already_member' | 'already_invited'

/** The SHA-256 of an invitation token: what the database stores instead of the token. */
const tokenHash = (token: string) => createHash('sha256').update(token).digest('base64url')
/** The shape of a token made by createInvitation (32 random bytes, base64url). */
const TOKEN = /^[A-Za-z0-9_-]{43}$/

/**
 * Invite `email` to the scope's account with `role`, valid for INVITATION_DAYS days. `deliver` runs in the
 * same transaction (queue the email there with its `tx`): the invitation exists only if its email is queued.
 */
export async function createInvitation(
  scope: AccountScope,
  input: { email: string; role: Role },
  deliver: (tx: TenantTx, invitation: NewInvitation) => Promise<void>,
): Promise<InvitationCreated> {
  const email = input.email.trim().toLowerCase()
  const result = await refusable<InvitationCreated>(() =>
    withAccount(scope, async (tx) => {
      const actor = await actorRole(tx, scope)
      if (!managesMembers(actor)) throw new Refused('not_found')
      if (input.role === 'owner' && actor !== 'owner') throw new Refused('owner_only')
      const member = await tx.execute(sql`
        select 1 from auth_account_member m join auth_user u on u.id = m.user_id
        where m.account_id = ${scope.accountId} and lower(u.email) = ${email}`)
      if (member.rows.length > 0) throw new Refused('already_member')
      const pending = await tx.execute(sql`
        select 1 from auth_account_invitation
        where account_id = ${scope.accountId} and email = ${email} and status = 'pending' and expires_at > now()`)
      if (pending.rows.length > 0) throw new Refused('already_invited')
      const token = randomBytes(32).toString('base64url')
      const { rows } = await tx.execute<{ id: string; name: string }>(sql`
        insert into auth_account_invitation (account_id, email, role, status, expires_at, inviter_id, token_hash)
        values (${scope.accountId}, ${email}, ${input.role}, 'pending', now() + make_interval(days => ${INVITATION_DAYS}), ${scope.userId}, ${tokenHash(token)})
        returning id, (select name from auth_account where id = ${scope.accountId}) as name`)
      const created = rows[0]
      if (!created) throw new Error('createInvitation: the invitation was not created')
      await audit(tx, { action: 'member.invite', target: `invitation:${created.id}`, meta: { email, role: input.role }, actorUserId: scope.userId, accountId: scope.accountId })
      await deliver(tx, { token, email, role: input.role, accountName: created.name })
    }),
  )
  // no owner is touched here
  return result === 'last_owner' ? 'not_found' : result
}

export type InvitationCanceled = 'ok' | 'not_found' | 'not_pending'

/** Cancel a pending invitation of the scope's account: its link stops working. */
export async function cancelInvitation(scope: AccountScope, invitationId: string): Promise<InvitationCanceled> {
  if (!isUuid(invitationId)) return 'not_found'
  const result = await refusable<InvitationCanceled>(() =>
    withAccount(scope, async (tx) => {
      if (!managesMembers(await actorRole(tx, scope))) throw new Refused('not_found')
      const { rows } = await tx.execute<{ status: string; email: string }>(
        sql`select status, email from auth_account_invitation where id = ${invitationId} and account_id = ${scope.accountId}`,
      )
      const invitation = rows[0]
      if (!invitation) throw new Refused('not_found')
      if (invitation.status !== 'pending') throw new Refused('not_pending')
      await tx.execute(sql`update auth_account_invitation set status = 'canceled' where id = ${invitationId}`)
      await audit(tx, { action: 'member.invite_cancel', target: `invitation:${invitationId}`, meta: { email: invitation.email }, actorUserId: scope.userId, accountId: scope.accountId })
    }),
  )
  // no owner is touched here
  return result === 'last_owner' ? 'not_found' : result
}

/** Why an invitation link cannot be used (or `pending`: it can). */
export type InvitationState = 'pending' | 'not_found' | 'wrong_email' | 'expired' | 'used' | 'canceled'

export interface InvitationView {
  state: InvitationState
  /** Only when the person is the one invited (state is not `not_found` or `wrong_email`). */
  accountName?: string
  role?: Role
}

type InvitationRecord = {
  id: string
  account_id: string
  account_name: string
  email: string
  role: Role
  status: string
  expires_at: string | Date
}

async function findInvitation(token: string): Promise<InvitationRecord | null> {
  if (!TOKEN.test(token)) return null
  const { rows } = await appDatabase.execute<InvitationRecord>(sql`
    select i.id, i.account_id, a.name as account_name, i.email, i.role, i.status, i.expires_at
    from auth_account_invitation i join auth_account a on a.id = i.account_id
    where i.token_hash = ${tokenHash(token)}`)
  return rows[0] ?? null
}

/**
 * The state of an invitation for the person signed in as `email`. Someone else learns only that it is
 * not theirs: not its account, role or status.
 */
function stateOf(invitation: InvitationRecord | null, email: string, now: Date): InvitationState {
  if (!invitation) return 'not_found'
  if (invitation.email !== email.trim().toLowerCase()) return 'wrong_email'
  if (invitation.status === 'accepted') return 'used'
  if (invitation.status !== 'pending') return 'canceled'
  if (new Date(invitation.expires_at).getTime() <= now.getTime()) return 'expired'
  return 'pending'
}

/** What the invitation page shows to the person signed in as `email`. */
export async function viewInvitation(token: string, email: string, now = new Date()): Promise<InvitationView> {
  const invitation = await findInvitation(token)
  const state = stateOf(invitation, email, now)
  if (!invitation || state === 'not_found' || state === 'wrong_email') return { state }
  return { state, accountName: invitation.account_name, role: invitation.role }
}

export type InvitationAccepted = { accountId: string } | { refused: Exclude<InvitationState, 'pending'> | 'already_member' }

/**
 * Accept an invitation as the signed-in person `user`: only when it was sent to their email address, is
 * still pending and has not expired. It is used at most once (the status changes from pending in the same
 * statement that checks it); the membership and its audit row are written in that transaction.
 */
export async function acceptInvitation(token: string, user: { id: string; email: string }): Promise<InvitationAccepted> {
  const invitation = await findInvitation(token)
  const state = stateOf(invitation, user.email, new Date())
  if (!invitation || state !== 'pending') return { refused: state === 'pending' ? 'not_found' : state }
  const scope: AccountScope = { accountId: invitation.account_id, userId: user.id, role: invitation.role }
  const result = await refusable<'taken' | 'already_member'>(() =>
    withAccount(scope, async (tx) => {
      const taken = await tx.execute(sql`
        update auth_account_invitation set status = 'accepted'
        where id = ${invitation.id} and status = 'pending' and expires_at > now() and email = ${user.email.trim().toLowerCase()}
        returning id`)
      if (taken.rows.length === 0) throw new Refused('taken')
      const joined = await tx.execute(sql`
        insert into auth_account_member (account_id, user_id, role) values (${invitation.account_id}, ${user.id}, ${invitation.role})
        on conflict (account_id, user_id) do nothing returning id`)
      if (joined.rows.length === 0) throw new Refused('already_member')
      await audit(tx, { action: 'member.join', target: `user:${user.id}`, meta: { role: invitation.role, invitation: invitation.id }, actorUserId: user.id, accountId: invitation.account_id })
    }),
  )
  if (result === 'ok') return { accountId: invitation.account_id }
  if (result === 'already_member') return { refused: 'already_member' }
  // someone (or this person, in another tab) got there first: say why it cannot be used now
  const now = stateOf(await findInvitation(token), user.email, new Date())
  return { refused: now === 'pending' ? 'used' : now }
}
