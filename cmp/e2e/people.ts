// Helpers of e2e/isolation.spec.ts and e2e/journey.spec.ts: the catalogs, a client address per browser,
// people signed up and verified through the API and Mailpit, and the e2e database.
import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'

import { deleteMailTo, linkIn, mail } from './mailpit'

export type Locale = 'en' | 'sk'

/** A catalog text of `locale`, with its {variables} filled in. */
export function catalog(locale: Locale): (key: string, values?: Record<string, string>) => string {
  const texts = JSON.parse(readFileSync(`messages/${locale}.json`, 'utf8')) as Record<string, string>
  return (key, values = {}) => {
    const text = texts[key]
    if (text === undefined) throw new Error(`no ${key} in ${locale}.json`)
    return text.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`)
  }
}

/** A path (with its query) in `locale`: English has no prefix, Slovak is under /sk. */
export const pathIn = (locale: Locale, path: string) => (locale === 'en' ? path : `/sk${path}`)

let ipCounter = Math.floor(Math.random() * 1e6)
/** A client address per browser (sent as the e2e "proxy" does): Better Auth's rate limits are per address. */
export const clientAddress = () => `10.${(++ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`

export const newEmail = (label: string) => `e2e-${label}-${randomUUID()}@example.test`
/** Long, random: not in the stand-in's breach corpus (e2e/pwned-stand-in.mjs). */
export const newPassword = () => `pw-${randomUUID()}`

/**
 * Signs `email` up through the API and opens the verification link from Mailpit with the same client;
 * returns the password.
 */
export async function signedUp(request: APIRequestContext, origin: string, name: string, email: string): Promise<string> {
  const password = newPassword()
  const response = await request.post('/api/auth/sign-up/email', { headers: { Origin: origin }, data: { name, email, password } })
  expect(response.status(), await response.text()).toBe(200)
  const verified = await request.get(linkIn(await mail(request, email, catalog('en')('email_verify_subject')), origin), { maxRedirects: 0 })
  expect(verified.status()).toBe(302)
  expect(verified.headers().location).toContain('status=verified')
  return password
}

/** Signs in through the API: the client keeps the session cookie. */
export async function signedIn(request: APIRequestContext, origin: string, email: string, password: string): Promise<void> {
  const response = await request.post('/api/auth/sign-in/email', { headers: { Origin: origin }, data: { email, password } })
  expect(response.status(), await response.text()).toBe(200)
}

/** Waits until the page is at `path` (the pathname: a `next=` in a query never matches). */
export const at = (page: Page, path: string) => page.waitForURL((url) => url.pathname === path)

/** Runs `fn` on a connection to the e2e database as the app role (or the system role). */
export async function database<T>(fn: (client: pg.Client) => Promise<T>, role: 'app' | 'system' = 'app'): Promise<T> {
  const url =
    role === 'app'
      ? (process.env.DATABASE_URL ?? 'postgres://cmp_app:cmp_app@localhost:5432/cmp')
      : (process.env.DATABASE_URL_SYSTEM ?? 'postgres://cmp_system:cmp_system@localhost:5432/cmp')
  const client = new pg.Client({ connectionString: url })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/**
 * Frees a fixed address (a super-admin's) from an earlier run: the e2e database and Mailpit outlive a run,
 * so its user is renamed and its old mail (an old verification link) deleted.
 */
export async function freeAddress(email: string): Promise<void> {
  await deleteMailTo(email)
  await database((c) => c.query(`update auth_user set email = 'retired-' || id || '@example.test' where email = $1`, [email]))
}

/**
 * Marks the account named `name` paid until 2100, as the system role and without an audit row (a fixture:
 * only a paying account may invite, ruling R27; e2e/super-admin.spec.ts and e2e/journey.spec.ts go through the console).
 */
export async function markPaidNamed(name: string): Promise<void> {
  await database(async (c) => {
    const id = (await c.query<{ id: string }>(`select id from auth_account where name = $1`, [name])).rows[0]?.id
    if (!id) throw new Error(`no account named ${name}`)
    await c.query(`insert into entitlements (account_id, plan_id, paid_until) values ($1, 'starter', '2100-01-01') on conflict (account_id) do update set paid_until = excluded.paid_until`, [id])
  }, 'system')
}
