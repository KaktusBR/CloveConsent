import type pg from 'pg'
import { beforeAll, describe, expect, test } from 'vitest'
import { addAccount, asRole, errorCode, newId } from './raw'

/**
 * Better Auth's identity tables (Tasks 6-8) are guarded by Better Auth and the app's own checks, not by
 * row-level security (ruling R2); the account tables (Task 7) say who belongs to an account, so the
 * membership and invitation rows name one, but they are identity data too. Every other table in the public schema is tenant data
 * (or reference data, below). Each one is listed with exactly the privileges the app role holds on it
 * (what Better Auth does there) and why, and what the system role holds: the worker's auth.cleanup job
 * (DELETE, and SELECT of the one column it filters on), and the super-admin console (Task 8: SELECT of
 * the columns it shows of accounts, their members and those members' names and addresses). PUBLIC
 * holds none, and none has row-level security (an explicit decision: the sweep below fails a table that
 * turns it on without moving off this list).
 */
interface IdentityGrants {
  app: readonly string[]
  system?: { delete?: true; select: readonly string[] }
  why: string
}
const IDENTITY_GRANTS: Readonly<Record<string, IdentityGrants>> = {
  auth_user: { app: ['INSERT', 'SELECT', 'UPDATE'], system: { select: ['email', 'id', 'name'] }, why: 'people who sign in; never deleted by the app; the console shows members by name and address' },
  auth_credential: { app: ['INSERT', 'SELECT', 'UPDATE'], why: 'password hashes; never deleted by the app' },
  auth_session: { app: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'], system: { delete: true, select: ['expires_at'] }, why: 'sign-in sessions, revoked by deleting; expired ones cleaned up' },
  auth_verification: { app: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'], system: { delete: true, select: ['expires_at'] }, why: 'one-time challenges and tokens, consumed by deleting; expired ones cleaned up' },
  auth_two_factor: { app: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'], why: 'encrypted TOTP secrets and backup codes, deleted when 2FA is turned off' },
  auth_passkey: { app: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'], why: 'passkey public keys, removable by their owner' },
  auth_rate_limit: { app: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'], system: { delete: true, select: ['last_request'] }, why: 'rate-limit windows shared by every app process; finished ones cleaned up' },
  auth_account: { app: ['INSERT', 'SELECT', 'UPDATE'], system: { select: ['created_at', 'id', 'name'] }, why: 'accounts (the organization plugin): created and renamed, never deleted; locked by the owner trigger; listed and searched in the console' },
  auth_account_member: { app: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'], system: { select: ['account_id', 'role', 'user_id'] }, why: 'who belongs to which account with which role; members are removed by deleting; shown in the console' },
  auth_account_invitation: { app: ['INSERT', 'SELECT', 'UPDATE'], why: 'invitations (hashed link tokens); they change status, never deleted' },
}
const IDENTITY_TABLES: readonly string[] = Object.keys(IDENTITY_GRANTS)
/**
 * Reference data: the same for every account, no account_id, no row-level security. The app and system
 * roles may only read it; migrations change it.
 */
const REFERENCE_TABLES: Readonly<Record<string, string>> = {
  plans: 'the plans and their limits (Task 8); an account names its plan in entitlements',
}
/** audit_log also holds system and global events, which belong to no account (ruling R2). */
const NULLABLE_ACCOUNT: readonly string[] = ['audit_log']

const TABLES = `select c.relname as table from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p')`

/** The account rule as Postgres stores it (deparsed from isCurrentAccount). */
const ACCOUNT_RULE = `(account_id = (NULLIF(current_setting('app.account_id'::text, true), ''::text))::uuid)`

/**
 * Every way a tenant table breaks the rule: no forced row-level security, no account_id (or a nullable one
 * outside NULLABLE_ACCOUNT), no policy for the app role, or a permissive policy the app role can use (its
 * own, PUBLIC's, or an inherited role's) whose expression is anything but exactly the account rule.
 */
async function tenantViolations(c: pg.Client): Promise<string[]> {
  const { rows: tables } = await c.query<{ table: string; rls: boolean; forced: boolean; has_account: boolean; account_nullable: boolean }>(`
    select c.relname as table, c.relrowsecurity as rls, c.relforcerowsecurity as forced,
           exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'account_id' and not a.attisdropped) as has_account,
           exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'account_id' and not a.attisdropped and not a.attnotnull) as account_nullable
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p')`)
  const { rows: policies } = await c.query<{ table: string; name: string; cmd: string; qual: string | null; with_check: string | null }>(`
    select p.tablename as table, p.policyname as name, p.cmd, p.qual, p.with_check
    from pg_policies p
    where p.schemaname = 'public' and p.permissive = 'PERMISSIVE'
      and exists (select 1 from unnest(p.roles) r
                  where case when r = 'public' then true else pg_has_role('cmp_app', r, 'MEMBER') end)`)
  const out: string[] = []
  for (const t of tables.filter((t) => !IDENTITY_TABLES.includes(t.table) && !(t.table in REFERENCE_TABLES))) {
    if (!t.rls || !t.forced) out.push(`${t.table}: row-level security not enabled and forced`)
    if (!t.has_account) out.push(`${t.table}: no account_id`)
    if (t.account_nullable && !NULLABLE_ACCOUNT.includes(t.table)) out.push(`${t.table}: account_id is nullable`)
    const own = policies.filter((p) => p.table === t.table)
    if (own.length === 0) out.push(`${t.table}: no policy for cmp_app`)
    for (const p of own) {
      const usingOk = p.qual === ACCOUNT_RULE
      const checkOk = p.with_check === ACCOUNT_RULE
      const ok =
        p.cmd === 'INSERT' ? checkOk
        : p.cmd === 'SELECT' || p.cmd === 'DELETE' ? usingOk
        : usingOk && (p.with_check === null || checkOk) // UPDATE, ALL: a missing check reuses USING
      if (!ok) out.push(`${t.table}: policy ${p.name} (${p.cmd}) is not exactly the account rule: using ${p.qual}, check ${p.with_check}`)
    }
  }
  return out
}

const accountA = newId()
const accountB = newId()

beforeAll(async () => {
  await addAccount(accountA)
  await addAccount(accountB)
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
  test('every tenant table has account_id, forced row-level security and only exact account policies for the app role', async () => {
    const tables = await asRole('migrate', async (c) => (await c.query<{ table: string }>(TABLES)).rows.map((r) => r.table))
    expect(tables).toContain('audit_log')
    expect(await asRole('migrate', tenantViolations)).toEqual([])
  })

  test('identity tables: no row-level security, exactly the listed privileges for the app and system roles, none for anyone else', async () => {
    const found = await asRole('migrate', async (c) => {
      const { rows: tables } = await c.query<{ table: string; rls: boolean }>(
        `select c.relname as table, c.relrowsecurity as rls from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relname like 'auth\\_%' order by 1`,
      )
      const { rows: grants } = await c.query<{ table: string; grantee: string; privilege: string }>(
        `select table_name as table, grantee, privilege_type as privilege from information_schema.role_table_grants
         where table_schema = 'public' and table_name like 'auth\\_%' and grantee <> 'cmp_owner' order by 1, 2, 3`,
      )
      // column privileges of the roles without table-level SELECT (cmp_app's table grants list every column)
      const { rows: columns } = await c.query<{ table: string; grantee: string; column: string; privilege: string }>(
        `select table_name as table, grantee, column_name as column, privilege_type as privilege from information_schema.column_privileges
         where table_schema = 'public' and table_name like 'auth\\_%' and grantee not in ('cmp_owner', 'cmp_app') order by 1, 2, 3, 4`,
      )
      return { tables, grants, columns }
    })
    expect(found.tables.map((t) => t.table).sort()).toEqual([...IDENTITY_TABLES].sort())
    expect(found.tables.filter((t) => t.rls)).toEqual([])
    const systemColumns = Object.entries(IDENTITY_GRANTS).flatMap(([table, { system }]) =>
      (system?.select ?? []).map((column) => ({ table, grantee: 'cmp_system', column, privilege: 'SELECT' })),
    )
    expect(found.columns).toEqual(systemColumns.sort((a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column)))
    const expected = Object.entries(IDENTITY_GRANTS).flatMap(([table, { app, system }]) => [
      ...app.map((privilege) => ({ table, grantee: 'cmp_app', privilege })),
      ...(system?.delete ? [{ table, grantee: 'cmp_system', privilege: 'DELETE' }] : []),
    ])
    const key = (g: { table: string; grantee: string; privilege: string }) => `${g.table} ${g.grantee} ${g.privilege}`
    expect(found.grants.map(key).sort()).toEqual(expected.map(key).sort())
  })

  test('reference tables: no account_id, no row-level security, only SELECT for the app and system roles, nothing for anyone else', async () => {
    const found = await asRole('migrate', async (c) => {
      const names = Object.keys(REFERENCE_TABLES)
      const { rows: tables } = await c.query<{ table: string; rls: boolean; has_account: boolean }>(
        `select c.relname as table, c.relrowsecurity as rls,
                exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'account_id' and not a.attisdropped) as has_account
         from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname = any($1) order by 1`,
        [names],
      )
      const { rows: grants } = await c.query<{ table: string; grantee: string; privilege: string }>(
        `select table_name as table, grantee, privilege_type as privilege from information_schema.role_table_grants
         where table_schema = 'public' and table_name = any($1) and grantee <> 'cmp_owner' order by 1, 2, 3`,
        [names],
      )
      return { tables, grants }
    })
    expect(found.tables).toEqual(Object.keys(REFERENCE_TABLES).sort().map((table) => ({ table, rls: false, has_account: false })))
    expect(found.grants).toEqual(
      Object.keys(REFERENCE_TABLES).sort().flatMap((table) => [
        { table, grantee: 'cmp_app', privilege: 'SELECT' },
        { table, grantee: 'cmp_system', privilege: 'SELECT' },
      ]),
    )
  })

  test.each([
    ['a permissive TO PUBLIC policy that allows everything', `create policy sneaky on audit_log for select using (true)`],
    ['an app policy that ORs anything onto the account rule', `create policy sneaky on audit_log for select to cmp_app using (account_id = nullif(current_setting('app.account_id', true), '')::uuid or true)`],
    ['an app insert policy with no check', `create policy sneaky on audit_log for insert to cmp_app with check (account_id is not null)`],
    ['a policy for a role the app inherits', `create role cmp_test_parent nologin; grant cmp_test_parent to cmp_app; create policy sneaky on audit_log for select to cmp_test_parent using (true)`],
  ])('the sweep catches %s', async (_name, ddl) => {
    // as the admin (the owner cannot create roles), inside a transaction that is rolled back
    const violations = await asRole('admin', async (c) => {
      await c.query('begin')
      try {
        await c.query(ddl)
        return await tenantViolations(c)
      } finally {
        await c.query('rollback')
      }
    })
    expect(violations.join(' | ')).toContain('sneaky')
  })

  test('tables live only in the swept public schema, the job queue or the migrations journal', async () => {
    // A new schema must be swept like public, or be shown not to hold tenant data. pgboss is the job
    // queue (no tenant data, the app may only insert jobs: test/db/queue.test.ts); drizzle holds the
    // migrations journal, which only the owner can reach.
    const schemas = await asRole('migrate', async (c) =>
      (await c.query<{ schema: string }>(
        `select distinct n.nspname as schema from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where c.relkind in ('r', 'p', 'v', 'm', 'f') and n.nspname not in ('pg_catalog', 'information_schema') and n.nspname not like 'pg_toast%'
         order by 1`,
      )).rows.map((r) => r.schema),
    )
    expect(schemas).toEqual(['drizzle', 'pgboss', 'public'])
    const reach = await asRole('migrate', async (c) =>
      (await c.query<{ role: string; usage: boolean }>(`select r as role, has_schema_privilege(r, 'drizzle', 'USAGE') as usage from unnest(array['cmp_app', 'cmp_system']) r`)).rows,
    )
    expect(reach).toEqual([{ role: 'cmp_app', usage: false }, { role: 'cmp_system', usage: false }])
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
