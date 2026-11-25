import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { totp } from '../test/totp'
import { expectAccessible, expectAccessibleState } from './axe'
import { linkIn, mail } from './mailpit'
import { database } from './people'

function catalog(locale: string): (key: string) => string {
  const texts = JSON.parse(readFileSync(`messages/${locale}.json`, 'utf8')) as Record<string, string>
  return (key) => {
    const text = texts[key]
    if (text === undefined) throw new Error(`no ${key} in ${locale}.json`)
    return text
  }
}
const en = catalog('en')
const sk = catalog('sk')

let ipCounter = Math.floor(Math.random() * 1e6)
/** Each test is its own client address: Better Auth's rate limits are per address and path. */
test.beforeEach(async ({ context }) => {
  await context.setExtraHTTPHeaders({ 'X-Forwarded-For': `10.${(++ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}` })
})

const newEmail = (label: string) => `e2e-${label}-${randomUUID()}@example.test`
/** Long, random: not in the stand-in's breach corpus (e2e/pwned-stand-in.mjs). */
const newPassword = () => `pw-${randomUUID()}`

/** Signs up through the API and opens the verification link; returns the credentials. */
async function verifiedUser(page: Page, baseURL: string) {
  const email = newEmail('api')
  const password = newPassword()
  const response = await page.request.post('/api/auth/sign-up/email', { headers: { Origin: baseURL }, data: { name: 'E2E Person', email, password } })
  expect(response.status()).toBe(200)
  await page.goto(linkIn(await mail(page.request, email, en('email_verify_subject')), baseURL))
  await expect(page.getByRole('status')).toHaveText(en('verify_email_done'))
  return { email, password }
}

async function signIn(page: Page, email: string, password: string, path = '/sign-in') {
  await page.goto(path)
  await page.getByLabel(en('auth_email_label')).fill(email)
  await page.getByLabel(en('auth_password_label')).fill(password)
  await page.getByRole('button', { name: en('sign_in_submit'), exact: true }).click()
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: en('security_sign_out') }).click()
  await page.waitForURL('**/sign-in')
}

async function virtualAuthenticator(context: BrowserContext, page: Page) {
  const cdp = await context.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  })
}

test('full flow: sign up, verify by email, TOTP, sign in with TOTP, add a passkey, sign in with it', async ({ page, context, baseURL }) => {
  test.setTimeout(120_000)
  const origin = baseURL ?? ''
  const email = newEmail('flow')
  const password = newPassword()

  await page.goto('/sign-up')
  await expectAccessible(page)
  await page.getByLabel(en('auth_name_label')).fill('E2E Person')
  await page.getByLabel(en('auth_email_label')).fill(email)
  await page.getByLabel(en('auth_password_label')).fill(password)
  await page.getByRole('button', { name: en('sign_up_submit') }).click()
  await page.waitForURL('**/verify-email?status=sent')
  await expect(page.getByRole('status').first()).toHaveText(en('verify_email_sent'))
  await expectAccessible(page)

  // the link from Mailpit, on the public origin
  await page.goto(linkIn(await mail(page.request, email, en('email_verify_subject')), origin))
  await expect(page).toHaveURL(/\/verify-email\?status=verified$/)
  await expectAccessible(page)

  await signIn(page, email, password)
  await page.waitForURL('**/account/security')
  await expectAccessible(page)

  // turn on TOTP: the secret and the backup codes are shown once, a first code confirms
  const twoFactor = page.getByRole('region', { name: en('security_two_factor_heading') })
  await twoFactor.getByLabel(en('auth_password_label')).fill(password)
  await twoFactor.getByRole('button', { name: en('security_two_factor_enable') }).click()
  const secret = (await page.getByTestId('totp-secret').textContent()) ?? ''
  expect(secret).toMatch(/^[A-Z2-7]+=*$/)
  await expect(page.getByRole('list', { name: en('security_backup_codes_label') }).getByRole('listitem')).toHaveCount(10)
  await expectAccessibleState(page)
  await twoFactor.getByLabel(en('two_factor_code_label')).fill(totp(secret))
  await twoFactor.getByRole('button', { name: en('security_two_factor_confirm') }).click()
  await expect(twoFactor.getByText(en('security_two_factor_on'))).toBeVisible()
  expect(await mail(page.request, email, en('email_two_factor_enabled_subject'))).toContain(`${origin}/account/security`)

  // sign out, then the password alone leads to the second step
  await signOut(page)
  await signIn(page, email, password)
  await page.waitForURL('**/two-factor?next=*')
  await expectAccessible(page)
  await page.getByLabel(en('two_factor_code_label')).fill(totp(secret, 1))
  await page.getByRole('button', { name: en('two_factor_submit') }).click()
  await page.waitForURL('**/account/security')

  // add a passkey (Chromium's virtual authenticator), sign out, sign in with it
  await virtualAuthenticator(context, page)
  const passkeys = page.getByRole('region', { name: en('security_passkeys_heading') })
  await passkeys.getByLabel(en('security_passkey_name_label')).fill('E2E key')
  await passkeys.getByRole('button', { name: en('security_passkey_add') }).click()
  await expect(passkeys.getByText('E2E key')).toBeVisible()
  await expectAccessible(page)
  // in the audit log, by the person, naming the passkey (ruling R27, M2)
  const added = await database(async (c) => {
    const userId = (await c.query<{ id: string }>('select id from auth_user where email = $1', [email])).rows[0]?.id
    const passkey = (await c.query<{ id: string }>('select id from auth_passkey where user_id = $1', [userId])).rows[0]?.id
    return { userId, passkey }
  })
  const audited = await database(async (c) => (await c.query("select actor_user_id, account_id, target, meta from audit_log where action = 'user.passkey_add' and actor_user_id = $1", [added.userId])).rows, 'system')
  expect(audited).toEqual([{ actor_user_id: added.userId, account_id: null, target: `user:${added.userId}`, meta: { passkey: added.passkey } }])

  await signOut(page)
  await page.getByRole('button', { name: en('sign_in_passkey') }).click()
  await page.waitForURL('**/account/security')
  await expect(page.getByText(en('security_signed_in_as').replace('{email}', email))).toBeVisible()
})

test('a breached password is refused with the translated message', async ({ page }) => {
  await page.goto('/sk/sign-up')
  await expectAccessible(page)
  await page.getByLabel(sk('auth_name_label')).fill('E2E Osoba')
  await page.getByLabel(sk('auth_email_label')).fill(newEmail('breached'))
  await page.getByLabel(sk('auth_password_label')).fill('cmp-e2e-only-breached-3f9c2a7d')
  await page.getByRole('button', { name: sk('sign_up_submit') }).click()
  await expect(page.getByRole('alert')).toHaveText(sk('auth_error_password_compromised'))
})

test('a signed-out visit to the Security page goes to sign-in, which ignores a next= off this site', async ({ page, baseURL }) => {
  const origin = baseURL ?? ''
  await page.goto('/sk/account/security')
  await expect(page).toHaveURL(`${origin}/sk/sign-in?next=%2Fsk%2Faccount%2Fsecurity`)
  await expectAccessible(page)

  const { email, password } = await verifiedUser(page, origin)
  for (const next of ['//evil.example', 'https://evil.example']) {
    await signIn(page, email, password, `/sign-in?next=${encodeURIComponent(next)}`)
    await page.waitForURL(`${origin}/account/security`)
    await signOut(page)
  }
})

test('forgot password: the emailed link sets a new password and the old one stops working', async ({ page, baseURL }) => {
  const origin = baseURL ?? ''
  const { email, password } = await verifiedUser(page, origin)

  await page.goto('/forgot-password')
  await expectAccessible(page)
  await page.getByLabel(en('auth_email_label')).fill(email)
  await page.getByRole('button', { name: en('forgot_password_submit') }).click()
  await expect(page.getByRole('status')).toHaveText(en('forgot_password_sent'))

  await page.goto(linkIn(await mail(page.request, email, en('email_reset_subject')), origin))
  await expect(page).toHaveURL(/\/reset-password\?token=/)
  await expectAccessible(page)
  const fresh = newPassword()
  await page.getByLabel(en('reset_password_new_label'), { exact: true }).fill(fresh)
  await page.getByLabel(en('reset_password_confirm_label')).fill(fresh)
  await page.getByRole('button', { name: en('reset_password_submit') }).click()
  await expect(page.getByRole('status')).toContainText(en('reset_password_done'))

  await signIn(page, email, password)
  await expect(page.getByRole('alert')).toHaveText(en('auth_error_invalid_credentials'))
  await signIn(page, email, fresh)
  await page.waitForURL('**/account/security')
})

test('the verify-email and reset-password pages explain a bad link', async ({ page }) => {
  await page.goto('/verify-email?status=verified&error=INVALID_TOKEN')
  await expect(page.getByRole('alert')).toHaveText(en('auth_error_link_invalid'))
  await expectAccessible(page)
  await page.goto('/reset-password')
  await expect(page.getByRole('alert')).toHaveText(en('auth_error_link_invalid'))
  await expectAccessible(page)
})

test('revoking a session on the Security page signs that browser out', async ({ page, browser, baseURL }) => {
  const origin = baseURL ?? ''
  const { email, password } = await verifiedUser(page, origin)
  await signIn(page, email, password)
  await page.waitForURL('**/account/security')

  const other = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { 'X-Forwarded-For': '192.0.2.77' } })
  const otherPage = await other.newPage()
  await signIn(otherPage, email, password)
  await otherPage.waitForURL('**/account/security')

  await page.reload()
  const sessions = page.getByRole('region', { name: en('security_sessions_heading') })
  await sessions.getByRole('button', { name: en('security_session_revoke') }).click()
  await page.waitForURL('**/account/security')
  await expect(sessions.getByRole('button', { name: en('security_session_revoke') })).toHaveCount(0)

  await otherPage.reload()
  await expect(otherPage).toHaveURL(/\/sign-in\?next=/)
  await other.close()
})

test('a page render never sees a client-sent x-cmp-client-address: the Security page shows the address the session was created from', async ({ browser, baseURL }) => {
  const origin = baseURL ?? ''
  const context = await browser.newContext({ baseURL: origin, extraHTTPHeaders: { 'X-Forwarded-For': '192.0.2.88' } })
  const page = await context.newPage()
  const { email, password } = await verifiedUser(page, origin)
  await signIn(page, email, password)
  await page.waitForURL('**/account/security')

  // every later request (the page render and its auth.api calls) carries a forged internal header
  await context.setExtraHTTPHeaders({ 'X-Forwarded-For': '192.0.2.88', 'X-Cmp-Client-Address': '198.51.100.250' })
  await page.reload()
  const sessions = page.getByRole('region', { name: en('security_sessions_heading') })
  await expect(sessions.getByText(en('security_session_address').replace('{address}', '192.0.2.88'))).toBeVisible()
  await expect(page.getByText('198.51.100.250')).toHaveCount(0)
  await expectAccessible(page)
  await context.close()
})
