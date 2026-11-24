import { expect, test, type Browser, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'

import { totp } from '../test/totp'
import { expectAccessible } from './axe'
import { linkIn, mail } from './mailpit'
import { at, catalog, clientAddress, freeAddress, newEmail, newPassword, pathIn, signedUp, type Locale } from './people'
import { JOURNEY_SUPER_ADMIN_EMAIL } from './super-admin'

// The whole way in, through the pages, once in English and once in Slovak: a customer signs up, verifies
// the address from the email, creates an account (behind the paywall); the super-admin marks it paid;
// the customer invites a member, who signs up from the invitation's link and accepts it; both see the
// (empty) sites area. Every page on the way is checked with axe, in the light and the dark theme.

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({ extraHTTPHeaders: { 'X-Forwarded-For': clientAddress() } })
  return context.newPage()
}

for (const locale of ['en', 'sk'] as const satisfies readonly Locale[]) {
  test(`sign up, verify, create an account, paid by the super-admin, invite a member who accepts: both see the sites (${locale})`, async ({ browser, baseURL }) => {
    test.setTimeout(240_000)
    const origin = baseURL ?? ''
    const t = catalog(locale)
    const p = (path: string) => pathIn(locale, path)
    const accountName = `Journey ${randomUUID().slice(0, 8)}`
    await freeAddress(JOURNEY_SUPER_ADMIN_EMAIL)

    // the customer signs up and verifies the address from the email
    const owner = await newPage(browser)
    const ownerEmail = newEmail(`journey-owner-${locale}`)
    const ownerPassword = newPassword()
    await owner.goto(p('/sign-up'))
    await expectAccessible(owner)
    await owner.getByLabel(t('auth_name_label')).fill('Olga Owner')
    await owner.getByLabel(t('auth_email_label')).fill(ownerEmail)
    await owner.getByLabel(t('auth_password_label')).fill(ownerPassword)
    await owner.getByRole('button', { name: t('sign_up_submit') }).click()
    await at(owner, p('/verify-email'))
    await expect(owner.getByRole('status').first()).toHaveText(t('verify_email_sent'))
    await expectAccessible(owner)
    await owner.goto(linkIn(await mail(owner.request, ownerEmail, t('email_verify_subject')), origin))
    await at(owner, p('/verify-email'))
    await expect(owner.getByRole('status')).toHaveText(t('verify_email_done'))
    await expectAccessible(owner)

    // … signs in, creates an account: the product is behind the paywall
    await owner.goto(`${p('/sign-in')}?next=${encodeURIComponent(p('/accounts/new'))}`)
    await expectAccessible(owner)
    await owner.getByLabel(t('auth_email_label')).fill(ownerEmail)
    await owner.getByLabel(t('auth_password_label')).fill(ownerPassword)
    await owner.getByRole('button', { name: t('sign_in_submit'), exact: true }).click()
    await at(owner, p('/accounts/new'))
    await expectAccessible(owner)
    await owner.getByLabel(t('accounts_new_name_label')).fill(accountName)
    await owner.getByRole('button', { name: t('accounts_new_submit') }).click()
    await at(owner, p('/account'))
    await expect(owner.getByRole('heading', { level: 1 })).toHaveText(accountName)
    await expectAccessible(owner)
    await owner.goto(p('/sites'))
    await at(owner, p('/paywall'))
    await expect(owner.getByText(t('paywall_none'))).toBeVisible()
    await expectAccessible(owner)

    // the super-admin turns on two-factor authentication (required), finds the account, marks it paid
    const root = await newPage(browser)
    const rootPassword = await signedUp(root.request, origin, 'Rita Root', JOURNEY_SUPER_ADMIN_EMAIL)
    await root.goto(`${p('/sign-in')}?next=${encodeURIComponent(p('/admin/accounts'))}`)
    await root.getByLabel(t('auth_email_label')).fill(JOURNEY_SUPER_ADMIN_EMAIL)
    await root.getByLabel(t('auth_password_label')).fill(rootPassword)
    await root.getByRole('button', { name: t('sign_in_submit'), exact: true }).click()
    await at(root, p('/account/security'))
    await expectAccessible(root)
    const twoFactor = root.getByRole('region', { name: t('security_two_factor_heading') })
    await twoFactor.getByLabel(t('auth_password_label')).fill(rootPassword)
    await twoFactor.getByRole('button', { name: t('security_two_factor_enable') }).click()
    const secret = (await root.getByTestId('totp-secret').textContent()) ?? ''
    await twoFactor.getByLabel(t('two_factor_code_label')).fill(totp(secret))
    await twoFactor.getByRole('button', { name: t('security_two_factor_confirm') }).click()
    await expect(twoFactor.getByText(t('security_two_factor_on'))).toBeVisible()
    await root.goto(p('/admin/accounts'))
    await expectAccessible(root)
    await root.getByLabel(t('admin_accounts_search_label')).fill(accountName)
    await root.getByRole('button', { name: t('admin_accounts_search_submit') }).click()
    await root.getByRole('link', { name: accountName }).click()
    await expect(root.getByRole('heading', { level: 1 })).toHaveText(accountName)
    await expectAccessible(root)
    const accountPath = new URL(root.url()).pathname
    const plan = root.getByRole('region', { name: t('admin_account_plan_heading') })
    await plan.getByLabel(t('admin_account_plan_label')).selectOption('starter')
    await plan.getByLabel(t('admin_account_paid_until_label')).fill('2030-12-31')
    await plan.getByLabel(t('admin_reason_label')).fill('e2e journey: paid by bank transfer')
    await plan.getByRole('button', { name: t('admin_account_plan_submit') }).click()
    await root.waitForURL((url) => url.pathname === accountPath && url.search === '?done=set')
    await expect(root.getByText(t('entitlement_state_active'))).toBeVisible()
    await expectAccessible(root)

    // the customer's next request gets the (empty) sites area
    await owner.goto(p('/sites'))
    await at(owner, p('/sites'))
    await expect(owner.getByRole('heading', { level: 1 })).toHaveText(t('sites_heading'))
    await expect(owner.getByText(t('sites_none'))).toBeVisible()
    await expectAccessible(owner)

    // … and invites a member
    await owner.goto(p('/account/members'))
    await expectAccessible(owner)
    const memberEmail = newEmail(`journey-member-${locale}`)
    await owner.getByLabel(t('auth_email_label')).fill(memberEmail)
    await owner.getByLabel(t('members_invite_role_label'), { exact: true }).selectOption('editor')
    await owner.getByRole('button', { name: t('members_invite_submit') }).click()
    await owner.waitForURL((url) => url.pathname === p('/account/members') && url.search === '?done=invite')
    await expect(owner.getByRole('status')).toHaveText(t('members_done_invite'))
    await expectAccessible(owner)

    // the member opens the link signed out, signs up from it, verifies, signs in and is back at the invitation
    const member = await newPage(browser)
    const link = linkIn(await mail(member.request, memberEmail, t('email_invitation_subject', { inviter: 'Olga Owner', account: accountName })), origin)
    const invitation = new URL(link).pathname
    expect(invitation.startsWith(p('/invite/'))).toBe(true)
    await member.goto(link)
    await expect(member.getByText(t('invite_signed_out'))).toBeVisible()
    await expectAccessible(member)
    await member.getByRole('link', { name: t('invite_sign_up_link') }).click()
    await at(member, p('/sign-up'))
    await expectAccessible(member)
    const memberPassword = newPassword()
    await member.getByLabel(t('auth_name_label')).fill('Max Member')
    await member.getByLabel(t('auth_email_label')).fill(memberEmail)
    await member.getByLabel(t('auth_password_label')).fill(memberPassword)
    await member.getByRole('button', { name: t('sign_up_submit') }).click()
    await at(member, p('/verify-email'))
    await expectAccessible(member)
    await member.goto(linkIn(await mail(member.request, memberEmail, t('email_verify_subject')), origin))
    await expect(member.getByRole('status')).toHaveText(t('verify_email_done'))
    await expectAccessible(member)
    await member.getByRole('link', { name: t('sign_in_heading') }).click()
    await at(member, p('/sign-in'))
    await member.getByLabel(t('auth_email_label')).fill(memberEmail)
    await member.getByLabel(t('auth_password_label')).fill(memberPassword)
    await member.getByRole('button', { name: t('sign_in_submit'), exact: true }).click()
    await at(member, invitation)
    await expect(member.getByText(t('invite_pending', { account: accountName, role: t('role_editor') }))).toBeVisible()
    await expectAccessible(member)

    // … accepts: in the account, and the sites area is theirs too
    await member.getByRole('button', { name: t('invite_accept') }).click()
    await at(member, p('/account'))
    await expect(member.getByRole('heading', { level: 1 })).toHaveText(accountName)
    await expect(member.getByText(t('account_your_role', { role: t('role_editor') }))).toBeVisible()
    await expectAccessible(member)
    await member.goto(p('/sites'))
    await at(member, p('/sites'))
    await expect(member.getByRole('heading', { level: 1 })).toHaveText(t('sites_heading'))
    await expect(member.getByText(t('sites_none'))).toBeVisible()
    await expectAccessible(member)

    for (const page of [owner, root, member]) await page.context().close()
  })
}
