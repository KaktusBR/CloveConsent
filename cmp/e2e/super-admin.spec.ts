import { expect, test, type Browser, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import pg from 'pg'

import { totp } from '../test/totp'
import { expectAccessible, expectAccessibleState } from './axe'
import { deleteMailTo, linkIn, mail } from './mailpit'
import { SUPER_ADMIN_EMAIL } from './super-admin'

// The paid-access gate and the super-admin console, in the built app: a customer sees only the paywall
// and account settings until the super-admin marks the account paid, then gets in on the next request
// (Review Focus 3); the console is a 404 for anyone else; impersonation is read-only, bannered, ended
// by the super-admin.

const texts = JSON.parse(readFileSync('messages/en.json', 'utf8')) as Record<string, string>
const skTexts = JSON.parse(readFileSync('messages/sk.json', 'utf8')) as Record<string, string>
/** An English catalog text, with its {variables} filled in. */
function en(key: string, values: Record<string, string> = {}, catalog = texts): string {
  const text = catalog[key]
  if (text === undefined) throw new Error(`no ${key} in the catalog`)
  return text.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`)
}
const sk = (key: string, values: Record<string, string> = {}) => en(key, values, skTexts)

let ipCounter = Math.floor(Math.random() * 1e6)
const clientAddress = () => `10.${(++ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`

const at = (page: Page, path: string) => page.waitForURL((url) => url.pathname === path)

/** Signs up through the API as `email` and opens the verification link; returns the password. */
async function verified(page: Page, origin: string, name: string, email: string): Promise<string> {
  const password = `pw-${randomUUID()}`
  const response = await page.request.post('/api/auth/sign-up/email', { headers: { Origin: origin }, data: { name, email, password } })
  expect(response.status(), await response.text()).toBe(200)
  await page.goto(linkIn(await mail(page.request, email, en('email_verify_subject')), origin))
  await expect(page.getByRole('status')).toHaveText(en('verify_email_done'))
  return password
}

async function signIn(page: Page, email: string, password: string, next: string) {
  await page.goto(`/sign-in?next=${encodeURIComponent(next)}`)
  await page.getByLabel(en('auth_email_label')).fill(email)
  await page.getByLabel(en('auth_password_label')).fill(password)
  await page.getByRole('button', { name: en('sign_in_submit'), exact: true }).click()
}

async function newContext(browser: Browser) {
  const context = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': clientAddress() } })
  return { context, page: await context.newPage() }
}

// The e2e database and Mailpit outlive a run: the super-admin's address is freed from an earlier run's
// user, and its earlier mail (an old verification link) is deleted.
test.beforeAll(async () => {
  await deleteMailTo(SUPER_ADMIN_EMAIL)
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL ?? 'postgres://cmp_app:cmp_app@localhost:5432/cmp' })
  await db.connect()
  try {
    await db.query(`update auth_user set email = 'retired-' || id || '@example.test' where email = $1`, [SUPER_ADMIN_EMAIL])
  } finally {
    await db.end()
  }
})

test('an unpaid account sees only the paywall until the super-admin marks it paid; impersonation is read-only', async ({ browser, baseURL }) => {
  test.setTimeout(180_000)
  const origin = baseURL ?? ''
  const accountName = `Shop ${randomUUID().slice(0, 8)}`

  // a customer creates an account: the product is behind the paywall, account settings are not
  const { context: customerContext, page: customer } = await newContext(browser)
  const customerEmail = `e2e-customer-${randomUUID()}@example.test`
  const customerPassword = await verified(customer, origin, 'Cara Customer', customerEmail)
  await signIn(customer, customerEmail, customerPassword, '/accounts/new')
  await at(customer, '/accounts/new')
  await customer.getByLabel(en('accounts_new_name_label')).fill(accountName)
  await customer.getByRole('button', { name: en('accounts_new_submit') }).click()
  await at(customer, '/account')
  await customer.goto('/sites')
  await at(customer, '/paywall')
  await expect(customer.getByRole('heading', { level: 1 })).toHaveText(en('paywall_heading'))
  await expect(customer.getByText(en('paywall_none'))).toBeVisible()
  await expectAccessible(customer)
  await customer.goto('/sk/sites')
  await at(customer, '/sk/paywall')
  await expect(customer.getByRole('heading', { level: 1 })).toHaveText(sk('paywall_heading'))
  await expectAccessible(customer)
  await customer.goto('/account')
  await expect(customer.getByRole('heading', { level: 1 })).toHaveText(accountName)
  // the console does not exist for a customer
  const notThere = await customer.goto('/admin/accounts')
  expect(notThere?.status()).toBe(404)
  await expect(customer.getByRole('heading', { level: 1 })).toHaveText(en('not_found_heading'))
  await expectAccessible(customer)
  expect((await customer.request.post('/api/admin/entitlement', { headers: { Origin: origin }, form: { intent: 'set' } })).status()).toBe(404)

  // the super-admin: listed, verified, sent to set up two-factor authentication first
  const { context: rootContext, page: root } = await newContext(browser)
  const rootPassword = await verified(root, origin, 'Root Admin', SUPER_ADMIN_EMAIL)
  await signIn(root, SUPER_ADMIN_EMAIL, rootPassword, '/admin/accounts')
  await at(root, '/account/security')
  const twoFactor = root.getByRole('region', { name: en('security_two_factor_heading') })
  await twoFactor.getByLabel(en('auth_password_label')).fill(rootPassword)
  await twoFactor.getByRole('button', { name: en('security_two_factor_enable') }).click()
  const secret = (await root.getByTestId('totp-secret').textContent()) ?? ''
  await twoFactor.getByLabel(en('two_factor_code_label')).fill(totp(secret))
  await twoFactor.getByRole('button', { name: en('security_two_factor_confirm') }).click()
  await expect(twoFactor.getByText(en('security_two_factor_on'))).toBeVisible()

  // … then the console: find the account, mark it paid with a reason
  await root.goto('/admin/accounts')
  await expect(root.getByRole('heading', { level: 1 })).toHaveText(en('admin_accounts_heading'))
  await expectAccessible(root)
  await root.getByLabel(en('admin_accounts_search_label')).fill(accountName)
  await root.getByRole('button', { name: en('admin_accounts_search_submit') }).click()
  await root.getByRole('link', { name: accountName }).click()
  await expect(root.getByRole('heading', { level: 1 })).toHaveText(accountName)
  await expect(root.getByText(en('entitlement_state_none'))).toBeVisible()
  await expectAccessible(root)
  const accountPath = new URL(root.url()).pathname
  const plan = root.getByRole('region', { name: en('admin_account_plan_heading') })
  await plan.getByLabel(en('admin_account_plan_label')).selectOption('starter')
  await plan.getByLabel(en('admin_account_paid_until_label')).fill('2030-12-31')
  await plan.getByLabel(en('admin_reason_label')).fill('e2e: paid by bank transfer')
  await plan.getByRole('button', { name: en('admin_account_plan_submit') }).click()
  await root.waitForURL((url) => url.pathname === accountPath && url.search === '?done=set')
  await expect(root.getByRole('status')).toHaveText(en('admin_done_set'))
  await expect(root.getByText(en('entitlement_state_active'))).toBeVisible()
  await expectAccessible(root)

  // the customer's next request gets in: no new sign-in
  await customer.goto('/sites')
  await at(customer, '/sites')
  await expect(customer.getByRole('heading', { level: 1 })).toHaveText(en('sites_heading'))
  await expectAccessible(customer)

  // the audit log shows the change, its actor and reason
  await root.goto('/admin/audit')
  const row = root.locator('[data-audit-action="admin.entitlement_set"]').filter({ hasText: 'e2e: paid by bank transfer' }).first()
  await expect(row).toContainText(SUPER_ADMIN_EMAIL)
  // the console's own reads are hidden until asked for (finding I3)
  await expect(root.locator('[data-audit-action="system.access"]')).toHaveCount(0)
  await expectAccessible(root)
  await root.getByRole('link', { name: en('admin_audit_show_access') }).click()
  await expect(root.locator('[data-audit-action="system.access"]').first()).toBeVisible()
  await root.getByRole('link', { name: en('admin_audit_hide_access') }).click()
  await expect(root.locator('[data-audit-action="system.access"]')).toHaveCount(0)
  await root.goto('/sk/admin/accounts')
  await expect(root.getByRole('heading', { level: 1 })).toHaveText(sk('admin_accounts_heading'))
  await expectAccessible(root)

  // read-only impersonation of the customer: bannered, no write gets through, ended by the super-admin
  await root.goto(accountPath)
  const member = root.locator(`[data-member="${customerEmail}"]`)
  await member.getByLabel(en('admin_reason_label')).fill('e2e: support ticket')
  await member.getByRole('button', { name: en('admin_impersonate_submit') }).click()
  await at(root, '/account')
  await expect(root.getByRole('heading', { level: 1 })).toHaveText(accountName)
  const banner = root.getByRole('region', { name: en('impersonation_label') })
  await expect(banner).toContainText(customerEmail)
  await expectAccessible(root)
  await root.goto('/sites')
  await expect(banner).toBeVisible()
  const write = await root.request.post('/api/accounts/create', { headers: { Origin: origin }, form: { name: 'Not allowed' } })
  expect(write.status()).toBe(403)
  const authWrite = await root.request.post('/api/auth/update-user', { headers: { Origin: origin }, data: { name: 'Changed' } })
  expect(authWrite.status()).toBe(403)
  await banner.getByRole('button', { name: en('impersonation_stop') }).click()
  await at(root, accountPath)
  await expect(root.getByRole('region', { name: en('impersonation_label') })).toHaveCount(0)
  await expectAccessibleState(root)

  await customerContext.close()
  await rootContext.close()
})
