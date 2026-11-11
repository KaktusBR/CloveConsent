// The real per-site script (buildSiteScript over the built runtime, written in globalSetup), alone and first in <head>: the bottom
// bar, blocking, Accept all and the settings panel, in Chromium, Firefox and WebKit. The fake tracker host and YouTube are never resolved: requests to
// them are recorded and fulfilled here.
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const HOST = 'tracker.cloveconsent.test'
const trackerJs = readFileSync(new URL('./fixtures/tracker.js', import.meta.url), 'utf8')

declare global { interface Window { __trackerRuns?: string[] } }

/** Opens the site fixture; returns the live lists of tracker requests and page errors. */
async function open(page: Page): Promise<{ youtube: string[]; errors: string[] }> {
  const youtube: string[] = []
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  // the engine hides its banner from automated browsers (navigator.webdriver); the tests play a visitor
  await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }) })
  await page.context().route(`https://${HOST}/**`, (route) => route.fulfill({ contentType: 'text/javascript', body: trackerJs }))
  await page.context().route('https://www.youtube-nocookie.com/**', (route) => {
    youtube.push(route.request().url())
    return route.fulfill({ contentType: 'text/html', body: '<!DOCTYPE html><title>video</title>' })
  })
  await page.goto('/site.html')
  await page.waitForLoadState('load')
  return { youtube, errors }
}

const runs = (page: Page) => page.evaluate(() => [...(window.__trackerRuns ?? [])].sort())

test('the site script is a classic script, first in <head>', async ({ page }) => {
  await open(page)
  const first = page.locator('head > script').first()
  await expect(first).toHaveAttribute('src', '/site.js')
  expect(await first.evaluate((s: HTMLScriptElement) => s.defer || s.async || s.type !== '')).toBe(false)
})

test('shows the bottom bar, blocks the tracker and the video, and allows both on Accept all', async ({ page }) => {
  const { youtube, errors } = await open(page)
  await expect(page.locator('#cc-main .cm')).toBeVisible()
  await page.waitForTimeout(300)
  expect(await runs(page)).toEqual([])
  await expect(page.locator('[data-consent-placeholder-for="youtube"]')).toBeVisible()
  expect(youtube).toEqual([])

  await page.locator('.cm__btn[data-role="all"]').click()
  await page.waitForFunction(() => (window.__trackerRuns?.length ?? 0) >= 2)
  await page.waitForTimeout(300)
  expect(await runs(page)).toEqual(['marked', 'parsed'])
  await expect(page.locator('[data-consent-placeholder-for="youtube"]')).toHaveCount(0)
  await expect(page.locator('iframe[src="https://www.youtube-nocookie.com/embed/abc"]')).toHaveCount(1)
  await expect(page.locator('#cc-main .cm')).toBeHidden()
  expect(errors).toEqual([])
})

test('the settings panel allows one category: the tracker runs, the video stays blocked', async ({ page }) => {
  const { youtube, errors } = await open(page)
  const panel = page.locator('[data-cloveconsent-settings]')
  await panel.locator('input[data-consent-group="analytics"]').check()
  const save = panel.locator('[data-consent-action="save"]')
  // the visitor scrolls it clear of the banner bar, which stays at the bottom of the viewport (in WebKit it covers the button)
  await save.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await save.click()
  await page.waitForFunction(() => (window.__trackerRuns?.length ?? 0) >= 2)
  await page.waitForTimeout(300)
  expect(await runs(page)).toEqual(['marked', 'parsed'])
  await expect(page.locator('[data-consent-placeholder-for="youtube"]')).toBeVisible()
  expect(youtube).toEqual([])
  await expect(page.locator('#cc-main .cm')).toBeHidden()
  expect(errors).toEqual([])
})
