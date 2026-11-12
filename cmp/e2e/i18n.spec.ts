import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

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

/** The switcher is an island: wait until it is hydrated, so a click also remembers the choice. */
async function switcher(page: Page) {
  await expect(page.locator('astro-island[ssr]')).toHaveCount(0)
  return page.getByRole('navigation', { name: page.url().includes('/sk/') ? sk('locale_switcher_label') : en('locale_switcher_label') })
}

test('/ is English, /sk/ is Slovak, each with lang and hreflang alternates', async ({ page }) => {
  const errors: string[] = []
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') errors.push(msg.text())
  })
  page.on('pageerror', (error) => errors.push(error.message))

  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en('home_heading'))

  const response = await page.goto('/sk/')
  expect(response?.status()).toBe(200)
  await expect(page.locator('html')).toHaveAttribute('lang', 'sk')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(sk('home_heading'))
  await expect(page.getByRole('link', { name: sk('language_name') })).toHaveAttribute('aria-current', 'true')

  const origin = new URL(page.url()).origin
  await expect(page.locator('link[rel=alternate][hreflang=en]')).toHaveAttribute('href', `${origin}/`)
  await expect(page.locator('link[rel=alternate][hreflang=sk]')).toHaveAttribute('href', `${origin}/sk/`)
  await expect(page.locator('link[rel=alternate][hreflang=x-default]')).toHaveAttribute('href', `${origin}/`)

  // The island hydrates in the page's language (a mismatch would be logged by React).
  await switcher(page)
  expect(errors).toEqual([])
})

test('the switcher keeps the current page', async ({ page }) => {
  const response = await page.goto('/sk/no-such-page?x=1')
  expect(response?.status()).toBe(404)
  await expect(page.locator('html')).toHaveAttribute('lang', 'sk')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(sk('not_found_heading'))

  await (await switcher(page)).getByRole('link', { name: en('language_name') }).click()
  await expect(page).toHaveURL(/\/no-such-page\?x=1$/)
  expect(new URL(page.url()).pathname).toBe('/no-such-page')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(en('not_found_heading'))

  await (await switcher(page)).getByRole('link', { name: sk('language_name') }).click()
  await expect(page).toHaveURL(/\/sk\/no-such-page\?x=1$/)
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(sk('not_found_heading'))
})

test.describe('a browser that prefers Slovak', () => {
  test.use({ locale: 'sk-SK' })

  test('is sent to /sk/, and picking English sticks', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/sk\/$/)
    await expect(page.locator('html')).toHaveAttribute('lang', 'sk')

    await (await switcher(page)).getByRole('link', { name: en('language_name') }).click()
    await expect(page).toHaveURL(/\/$/)
    expect(new URL(page.url()).pathname).toBe('/')
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')

    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(en('home_heading'))
  })
})

test('unprefixed responses vary on the inputs that choose their language; probes are untouched', async ({ request }) => {
  const redirect = await request.get('/?x=1', { headers: { 'Accept-Language': 'sk', Accept: 'text/html' }, maxRedirects: 0 })
  expect(redirect.status()).toBe(307)
  expect(redirect.headers()['location']).toBe('/sk/?x=1')
  expect(redirect.headers()['vary']).toBe('Cookie, Accept-Language')

  const english = await request.get('/', { headers: { Accept: 'text/html' } })
  expect(english.headers()['vary']).toContain('Cookie, Accept-Language')

  const probe = await request.get('/healthz', { headers: { 'Accept-Language': 'sk', Accept: 'text/html' }, maxRedirects: 0 })
  expect(probe.status()).toBe(200)
  expect(probe.headers()['vary']).toBeUndefined()
})
