import { beforeAll, describe, expect, test } from 'vitest'
import { asRole, errorCode, newId } from './raw'

/**
 * Better Auth's identity tables (Tasks 6-8) carry no account_id and are guarded by Better Auth, not by
 * row-level security (ruling R2). Every other table in the public schema is tenant data.
 */
const IDENTITY_TABLES: readonly string[] = []
/** audit_log also holds system and global events, which belong to no account (ruling R2). */
const NULLABLE_ACCOUNT: readonly string[] = ['audit_log']

const accountA = newId()
const accountB = newId()

beforeAll(async () => {
  // rows of two accounts and one global row, written as the system role
  await asRole('system', (c) =>
    c.query(`insert into audit_log (account_id, action) values ($1, 'probe.raw'), ($2, 'probe.raw'), (null, 'probe.raw')`, [accountA, accountB]),
  )
})

describe('row-level security as the app role', () => {
  test('a raw query without the account setting returns zero tenant rows', async () => {
    const n = await asRole('app', async (c) => (await c.query<{ n: number }>('select count(*)::int as n from audit_log')).rows[0]?.n)
    expect(n).toBe(0)
  })

  test('a connection whose earlier transaction set an account sees zero rows afterwards, without an error', async () => {
    const n = await asRole('app', async (c) => {
      await c.query('begin')
      await c.query(`select set_config('app.account_id', $1, true)`, [accountA])
      await c.query('commit')
      return (await c.query<{ n: number }>('select count(*)::int as n from audit_log')).rows[0]?.n
    })
    expect(n).toBe(0)
  })

  test("with account A set, only A's rows are visible, never B's or the global ones", async () => {
    const accounts = await asRole('app', async (c) => {
      await c.query('begin')
      await c.query(`select set_config('app.account_id', $1, true)`, [accountA])
      const { rows } = await c.query<{ account_id: string | null }>(`select account_id from audit_log where action = 'probe.raw'`)
      await c.query('commit')
      return rows.map((r) => r.account_id)
    })
    expect(accounts).toEqual([accountA])
  })

  test('the app role cannot become the system or owner role', async () => {
    for (const role of ['cmp_system', 'cmp_owner']) {
      expect(await asRole('app', (c) => errorCode(c.query(`set role ${role}`)))).toBe('42501')
    }
  })
})

describe('the database catalog', () => {
  test('every tenant table has account_id, forced row-level security and an account policy for the app role', async () => {
    const tables = await asRole('migrate', async (c) =>
      (
        await c.query<{ table: string; rls: boolean; forced: boolean; has_account: boolean; account_nullable: boolean; app_policies: string[] }>(`
          select c.relname as table, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
                 exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'account_id' and not a.attisdropped) as has_account,
                 exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'account_id' and not a.attisdropped and not a.attnotnull) as account_nullable,
                 coalesce(array(
                   select coalesce(p.qual, '') || ' ' || coalesce(p.with_check, '')
                   from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname and 'cmp_app' = any (p.roles)
                 ), '{}') as app_policies
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r', 'p')`)
      ).rows,
    )
    expect(tables.map((t) => t.table)).toContain('audit_log')
    for (const t of tables.filter((t) => !IDENTITY_TABLES.includes(t.table))) {
      expect({ table: t.table, rls: t.rls, forced: t.forced, hasAccount: t.has_account }).toEqual({ table: t.table, rls: true, forced: true, hasAccount: true })
      expect(t.account_nullable, `${t.table}: account_id must be not null`).toBe(NULLABLE_ACCOUNT.includes(t.table))
      expect(t.app_policies.length, `${t.table}: policies for cmp_app`).toBeGreaterThan(0)
      for (const p of t.app_policies) expect(p, `${t.table}: every cmp_app policy compares account_id to app.account_id`).toMatch(/account_id = .*current_setting\('app\.account_id'::text, true\)/)
    }
  })

  test('no role of the app is a superuser or bypasses row-level security, and only the owner owns tables', async () => {
    const roles = await asRole('migrate', async (c) =>
      (await c.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean; rolcreatedb: boolean }>(
        `select rolname, rolsuper, rolbypassrls, rolcreaterole, rolcreatedb from pg_roles where rolname in ('cmp_owner', 'cmp_app', 'cmp_system') order by rolname`,
      )).rows,
    )
    expect(roles.map((r) => r.rolname)).toEqual(['cmp_app', 'cmp_owner', 'cmp_system'])
    for (const r of roles) expect(r).toMatchObject({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false })

    const owners = await asRole('migrate', async (c) =>
      (await c.query<{ owner: string }>(
        `select distinct pg_get_userbyid(c.relowner) as owner from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'`,
      )).rows.map((r) => r.owner),
    )
    expect(owners).toEqual(['cmp_owner'])
  })
})
