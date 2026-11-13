import { sql } from 'drizzle-orm'
import { SENSITIVE_KEY } from '../log'
import type { Database } from './client'
import type { SystemTx, TenantTx } from './scope'

export interface AuditEvent {
  /** A short dotted name: `member.invite`, `account.plan_set`. */
  action: string
  /** What the action was done to, e.g. `user:<id>`. */
  target?: string
  /** Context for a reader. Never secrets: a key that looks like one (password, token, secret …) is refused. */
  meta?: Record<string, unknown>
  actorUserId: string | null
  accountId: string | null
}

const ACTION = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/

/** The path of the first key that names a secret, at any depth, or null. */
function sensitiveKey(value: unknown, path = ''): string | null {
  if (value === null || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const [i, v] of value.entries()) {
      const found = sensitiveKey(v, `${path}[${i}]`)
      if (found) return found
    }
    return null
  }
  for (const [key, v] of Object.entries(value)) {
    const here = path ? `${path}.${key}` : key
    if (SENSITIVE_KEY.test(key)) return here
    const found = sensitiveKey(v, here)
    if (found) return found
  }
  return null
}

/** Validate and insert one event: only the event columns, as the roles' column grants allow (never id or created_at). */
export async function appendAuditEvent(db: Pick<Database, 'execute'>, e: AuditEvent): Promise<void> {
  if (e.action.length > 100 || !ACTION.test(e.action)) throw new TypeError('audit: the action must be a short dotted name')
  // check exactly what will be written: JSON.stringify's output (toJSON() may add or rename keys)
  const json = JSON.stringify(e.meta ?? {})
  const key = sensitiveKey(JSON.parse(json))
  // the key path only, never the value
  if (key !== null) throw new TypeError(`audit: meta must not hold secrets (key ${key})`)
  await db.execute(sql`
    insert into audit_log (actor_user_id, account_id, action, target, meta)
    values (${e.actorUserId}, ${e.accountId}, ${e.action}, ${e.target ?? null}, ${json}::jsonb)`)
}

/**
 * Append an event to the audit log, inside the caller's transaction (it commits or rolls back with the
 * action it records). In a TenantTx the row-level security policy refuses any account but the scope's.
 */
export function audit(tx: TenantTx | SystemTx, e: AuditEvent): Promise<void> {
  return appendAuditEvent(tx, e)
}
