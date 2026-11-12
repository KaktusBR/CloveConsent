import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

import { expectAccessible } from './axe'

/** Expected texts come from the catalogs; a key missing there fails the test instead of matching undefined. */
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

const switcher = (page: Page, t: (key: string) => string) => page.getByRole('navigation', { name: t('locale_switcher_label') })

async function expectPage(page: Page, lang: 'en' | 'sk', heading: string) {
  await expect(page.locator('html')).toHaveAttribute('lang', lang)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading)
}

test('the prerendered home page is built once per language: dist/client/index.html and sk/index.html', () => {
  const english = readFileSync('dist/client/index.html', 'utf8')
  const slovak = readFileSync('dist/client/sk/index.html', 'utf8')
  expect(english).toContain('<html lang="en"')
  expect(english).toContain(en('home_heading'))
  expect(slovak).toContain('<html lang="sk"')
  expect(slovak).toContain(sk('home_heading'))
})

test('/ is English and /sk/ is Slovak, with canonical and hreflang alternates', async ({ page }) => {
  await page.goto('/')
  await expectPage(page, 'en', en('home_heading'))
  await expectAccessible(page)

  const response = await page.goto('/sk/')
  expect(response?.status()).toBe(200)
  await expectPage(page, 'sk', sk('home_heading'))
  await expect(switcher(page, sk).getByRole('link', { name: sk('language_name') })).toHaveAttribute('aria-current', 'true')

  const origin = new URL(page.url()).origin
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', `${origin}/sk/`)
  await expect(page.locator('link[rel=alternate][hreflang=en]')).toHaveAttribute('href', `${origin}/`)
  await expect(page.locator('link[rel=alternate][hreflang=sk]')).toHaveAttribute('href', `${origin}/sk/`)
  await expect(page.locator('link[rel=alternate][hreflang=x-default]')).toHaveAttribute('href', `${origin}/`)
  await expectAccessible(page)
})

test('a server-rendered page answers in both languages; other prefixes are not pages', async ({ page, request }) => {
  const english = await page.goto('/sign-in')
  expect(english?.headers()['x-request-id']).toBeTruthy() // rendered per request, through the middleware
  await expectPage(page, 'en', en('sign_in_heading'))
  await expectAccessible(page)

  await page.goto('/sk/sign-in')
  await expectPage(page, 'sk', sk('sign_in_heading'))
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute('href', `${new URL(page.url()).origin}/sk/sign-in`)
  await expectAccessible(page)

  for (const path of ['/en/sign-in', '/de/sign-in', '/sk/sk/sign-in']) {
    expect((await request.get(path)).status(), path).toBe(404)
  }
})

// The node adapter serves the prerendered /sk/index.html for /sk itself, before any app code runs
// (trailingSlash 'ignore'); the canonical link names /sk/, so search engines see one URL.
test('/sk is the Slovak home page, canonically /sk/', async ({ request }) => {
  const res = await request.get('/sk', { maxRedirects: 0 })
  expect(res.status()).toBe(200)
  expect(await res.text()).toMatch(/<link rel="canonical" href="[^"]+\/sk\/"/)
})

test('the 404 page is in the language of its URL, without alternates, and the switcher keeps the page', async ({ page }) => {
  const response = await page.goto('/sk/no-such-page?x=1')
  expect(response?.status()).toBe(404)
  await expectPage(page, 'sk', sk('not_found_heading'))
  await expect(page.locator('link[rel=alternate]')).toHaveCount(0)
  await expect(page.locator('link[rel=canonical]')).toHaveCount(0)
  await expectAccessible(page)

  await switcher(page, sk).getByRole('link', { name: en('language_name') }).click()
  await expect(page).toHaveURL(/\/no-such-page\?x=1$/)
  expect(new URL(page.url()).pathname).toBe('/no-such-page')
  await expectPage(page, 'en', en('not_found_heading'))
  await expectAccessible(page)

  await switcher(page, en).getByRole('link', { name: sk('language_name') }).click()
  await expect(page).toHaveURL(/\/sk\/no-such-page\?x=1$/)
  await expectPage(page, 'sk', sk('not_found_heading'))
})

test.describe('a browser that prefers Slovak, without JavaScript', () => {
  test.use({ locale: 'sk-SK', javaScriptEnabled: false })

  test('is never redirected: / is English; the switcher works and remembers the choice', async ({ page, context }) => {
    const response = await page.goto('/')
    expect(response?.request().redirectedFrom()).toBeNull()
    await expectPage(page, 'en', en('home_heading'))

    await switcher(page, en).getByRole('link', { name: sk('language_name') }).click()
    await expect(page).toHaveURL(/\/sk\/$/)
    await expectPage(page, 'sk', sk('home_heading'))
    expect((await context.cookies()).find((c) => c.name === 'locale')?.value).toBe('sk')

    await switcher(page, sk).getByRole('link', { name: en('language_name') }).click()
    expect(new URL(page.url()).pathname).toBe('/')
    await expectPage(page, 'en', en('home_heading'))
    expect((await context.cookies()).find((c) => c.name === 'locale')?.value).toBe('en')
  })
})

test('the switcher endpoint sets the cookie and redirects only to a page of this site', async ({ request }) => {
  const ok = await request.get('/api/locale?to=sk&next=%2Fsign-in%3Fx%3D1', { maxRedirects: 0 })
  expect(ok.status()).toBe(303)
  expect(ok.headers()['location']).toBe('/sk/sign-in?x=1')
  expect(ok.headers()['cache-control']).toBe('no-store')
  const cookie = ok.headers()['set-cookie'] ?? ''
  expect(cookie).toMatch(/^locale=sk;/)
  expect(cookie).toMatch(/Path=\//)
  expect(cookie).toMatch(/SameSite=Lax/i)
  expect(cookie).toMatch(/HttpOnly/i)

  const offsite = await request.get('/api/locale?to=en&next=%2F%2Fevil.test%2Fx', { maxRedirects: 0 })
  expect(offsite.status()).toBe(303)
  expect(offsite.headers()['location']).toBe('/')

  const unknown = await request.get('/api/locale?to=xx&next=%2F', { maxRedirects: 0 })
  expect(unknown.status()).toBe(400)
  expect(unknown.headers()['set-cookie']).toBeUndefined()
})
