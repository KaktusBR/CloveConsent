import { expect, test, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { expectAccessible } from './axe'
import { linkIn, mail } from './mailpit'
import { markPaidNamed } from './people'

const texts = JSON.parse(readFileSync('messages/en.json', 'utf8')) as Record<string, string>
/** An English catalog text, with its {variables} filled in. */
function en(key: string, values: Record<string, string> = {}): string {
  const text = texts[key]
  if (text === undefined) throw new Error(`no ${key} in en.json`)
  return text.replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? `{${name}}`)
}

let ipCounter = Math.floor(Math.random() * 1e6)
/** Each browser is its own client address: Better Auth's rate limits are per address and path. */
const clientAddress = () => `10.${(++ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`

const newEmail = (label: string) => `e2e-${label}-${randomUUID()}@example.test`

/** Signs up through the API and opens the verification link; returns the credentials. */
async function verifiedUser(page: Page, baseURL: string, name: string) {
  const email = newEmail(name.replace(/\W+/g, '-').toLowerCase())
  const password = `pw-${randomUUID()}`
  const response = await page.request.post('/api/auth/sign-up/email', { headers: { Origin: baseURL }, data: { name, email, password } })
  expect(response.status(), await response.text()).toBe(200)
  await page.goto(linkIn(await mail(page.request, email, en('email_verify_subject')), baseURL))
  await expect(page.getByRole('status')).toHaveText(en('verify_email_done'))
  return { email, password }
}

/** Waits until the page is at `path` (the pathname: a `next=` in a query never matches). */
const at = (page: Page, path: string) => page.waitForURL((url) => url.pathname === path)

async function signIn(page: Page, email: string, password: string) {
  await page.getByLabel(en('auth_email_label')).fill(email)
  await page.getByLabel(en('auth_password_label')).fill(password)
  await page.getByRole('button', { name: en('sign_in_submit'), exact: true }).click()
}

test('an owner invites an editor, who accepts, sees the account and cannot open Members management', async ({ browser, baseURL }) => {
  test.setTimeout(120_000)
  const origin = baseURL ?? ''
  const accountName = `Acme ${randomUUID().slice(0, 8)}`

  // the owner creates the account
  const ownerContext = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': clientAddress() } })
  const owner = await ownerContext.newPage()
  const ownerLogin = await verifiedUser(owner, origin, 'Olivia Owner')
  await owner.goto('/sign-in?next=/accounts/new')
  await signIn(owner, ownerLogin.email, ownerLogin.password)
  await at(owner, '/accounts/new')
  await expectAccessible(owner)
  await owner.getByLabel(en('accounts_new_name_label')).fill(accountName)
  await owner.getByRole('button', { name: en('accounts_new_submit') }).click()
  await at(owner, '/account')
  await expect(owner.getByRole('heading', { level: 1 })).toHaveText(accountName)
  await expect(owner.getByText(en('account_your_role', { role: en('role_owner') }))).toBeVisible()
  await expectAccessible(owner)

  // … and invites an editor
  await owner.getByRole('link', { name: en('account_members_link') }).click()
  await at(owner, '/account/members')
  await expectAccessible(owner)
  const editorContext = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': clientAddress() } })
  const editor = await editorContext.newPage()
  const editorLogin = await verifiedUser(editor, origin, 'Eddie Editor')
  // an account that has not paid cannot invite (ruling R27): the reason, translated
  await owner.getByLabel(en('auth_email_label')).fill(editorLogin.email)
  await owner.getByRole('button', { name: en('members_invite_submit') }).click()
  await expect(owner.getByRole('alert')).toHaveText(en('members_error_unpaid'))
  await expect(owner.locator(`[data-invitation="${editorLogin.email}"]`)).toHaveCount(0)
  await expectAccessible(owner)
  await markPaidNamed(accountName)
  await owner.getByLabel(en('auth_email_label')).fill(editorLogin.email)
  await owner.getByLabel(en('members_invite_role_label'), { exact: true }).selectOption('editor')
  await owner.getByRole('button', { name: en('members_invite_submit') }).click()
  await owner.waitForURL((url) => url.pathname === '/account/members' && url.search === '?done=invite')
  await expect(owner.getByRole('status')).toHaveText(en('members_done_invite'))
  await expect(owner.locator(`[data-invitation="${editorLogin.email}"]`)).toBeVisible()
  await expectAccessible(owner)

  // the editor opens the link from the email, signed out: asked to sign in, then back to the invitation
  const link = linkIn(await mail(editor.request, editorLogin.email, en('email_invitation_subject', { inviter: 'Olivia Owner', account: accountName })), origin)
  expect(new URL(link).pathname).toMatch(/^\/invite\/[A-Za-z0-9_-]{43}$/)
  await editor.goto(link)
  await expect(editor.getByText(en('invite_signed_out'))).toBeVisible()
  // a new person signs up from here and comes back: both links carry the invitation as next=
  const invitePath = new URL(link).pathname
  for (const name of ['invite_sign_in_link', 'invite_sign_up_link']) {
    expect(new URL((await editor.getByRole('link', { name: en(name) }).getAttribute('href')) ?? '', origin).searchParams.get('next')).toBe(invitePath)
  }
  await expectAccessible(editor)
  await editor.getByRole('link', { name: en('invite_sign_in_link') }).click()
  await signIn(editor, editorLogin.email, editorLogin.password)
  await editor.waitForURL(link)
  await expect(editor.getByText(en('invite_pending', { account: accountName, role: en('role_editor') }))).toBeVisible()
  await expectAccessible(editor)

  // accepts, and sees the account as an editor, without Members management
  await editor.getByRole('button', { name: en('invite_accept') }).click()
  await at(editor, '/account')
  await expect(editor.getByRole('heading', { level: 1 })).toHaveText(accountName)
  await expect(editor.getByText(en('account_your_role', { role: en('role_editor') }))).toBeVisible()
  await expect(editor.getByRole('link', { name: en('account_members_link') })).toHaveCount(0)
  await expectAccessible(editor)
  const members = await editor.goto('/account/members')
  expect(members?.status()).toBe(404)
  await expect(editor.getByRole('heading', { level: 1 })).toHaveText(en('not_found_heading'))

  // the link a second time: nothing happens, and the page says why
  await editor.goto(link)
  await expect(editor.getByText(en('invite_state_used'))).toBeVisible()
  await expect(editor.getByRole('button', { name: en('invite_accept') })).toHaveCount(0)
  await expectAccessible(editor)

  // the owner sees the new member, and the invitation is no longer pending
  await owner.goto('/account/members')
  await expect(owner.locator(`[data-member="${editorLogin.email}"]`)).toContainText(en('role_editor'))
  await expect(owner.locator(`[data-invitation="${editorLogin.email}"]`)).toHaveCount(0)
  await expectAccessible(owner)

  await ownerContext.close()
  await editorContext.close()
})

test('an invitation opened by someone signed in with another address is refused with the reason', async ({ browser, baseURL }) => {
  test.setTimeout(90_000)
  const origin = baseURL ?? ''
  const context = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': clientAddress() } })
  const page = await context.newPage()
  const owner = await verifiedUser(page, origin, 'Owen Owner')
  await page.goto('/sign-in?next=/accounts/new')
  await signIn(page, owner.email, owner.password)
  await at(page, '/accounts/new')
  const accountName = `Private ${randomUUID().slice(0, 8)}`
  await page.getByLabel(en('accounts_new_name_label')).fill(accountName)
  await page.getByRole('button', { name: en('accounts_new_submit') }).click()
  await at(page, '/account')
  await markPaidNamed(accountName)
  await page.goto('/account/members')
  const invitee = newEmail('someone-else')
  await page.getByLabel(en('auth_email_label')).fill(invitee)
  await page.getByRole('button', { name: en('members_invite_submit') }).click()
  await page.waitForURL((url) => url.pathname === '/account/members' && url.search === '?done=invite')

  // the owner opens the link meant for someone else: told it is not theirs, nothing about the account
  const link = linkIn(await mail(page.request, invitee, en('email_invitation_subject', { inviter: 'Owen Owner', account: accountName })), origin)
  await page.goto(link)
  await expect(page.getByText(en('invite_state_unavailable'))).toBeVisible()
  await expect(page.getByRole('button', { name: en('invite_accept') })).toHaveCount(0)
  await expectAccessible(page)
  await context.close()
})
