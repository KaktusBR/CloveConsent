// Review Focus 2: a tracker placed after the runtime tag, or inserted later by another script, never executes or requests
// before consent, in a real Chromium. The fake tracker host is never resolved: every request to it is recorded and fulfilled
// here, so "no request" means none left the page.
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

const HOST = 'tracker.cloveconsent.test'
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const trackerJs = fixture('tracker.js')
const frameHtml = fixture('frame.html')
const script = (c: string) => `https://${HOST}/tracker.js?case=${c}`
const frame = (c: string) => `https://${HOST}/frame.html?case=${c}`

declare global { interface Window { __trackerRuns?: string[]; __caseDone?: boolean } }

/** Opens a fixture page with the tracker host recorded; returns the live list of requests to it. */
async function open(page: Page, path: string): Promise<string[]> {
  const requests: string[] = []
  // the engine hides its banner from automated browsers (navigator.webdriver); the tests play a visitor
  await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }) })
  page.context().on('request', (r) => { if (new URL(r.url()).hostname === HOST) requests.push(r.url()) })
  await page.context().route(`https://${HOST}/**`, (route) => {
    const u = new URL(route.request().url())
    return u.pathname === '/tracker.js'
      ? route.fulfill({ contentType: 'text/javascript', body: trackerJs })
      : route.fulfill({ contentType: 'text/html', body: frameHtml })
  })
  await page.goto(path)
  await page.waitForFunction(() => window.__caseDone === true)
  // anything a blocked element would fetch has had time to be requested
  await page.waitForLoadState('load')
  await page.waitForTimeout(300)
  return requests
}

async function acceptAll(page: Page): Promise<void> {
  await page.locator('.cm__btn[data-role="all"]').click()
}

const runs = (page: Page) => page.evaluate(() => window.__trackerRuns ?? null)

const scriptCases = [
  { name: '(a) script tags in the HTML after the runtime tag', path: '/parsed.html', cases: ['parsed', 'parsed-body'],
    limit: 'Chromium preload scanner requests a <script src> written in the HTML before any script runs; execution is still blocked (asserted above)' },
  { name: '(b) createElement, src, appendChild', path: '/dynamic.html?case=append', cases: ['append'] },
  { name: '(b) createElement, setAttribute("src"), appendChild', path: '/dynamic.html?case=setattribute', cases: ['setattribute'] },
  { name: '(c) innerHTML of a container', path: '/dynamic.html?case=innerhtml', cases: ['innerhtml'] },
  { name: '(d) insertAdjacentHTML', path: '/dynamic.html?case=adjacent', cases: ['adjacent'] },
]

for (const c of scriptCases) {
  test(`tracker script, ${c.name}: does not execute before consent, runs once after Accept all`, async ({ page }) => {
    await open(page, c.path)
    expect(await runs(page)).toBeNull()
    await expect(page.locator('script[type="text/plain"][data-consent="tracker"][data-consent-auto]')).toHaveCount(c.cases.length)

    await acceptAll(page)
    await page.waitForFunction((n) => (window.__trackerRuns?.length ?? 0) >= n, c.cases.length)
    await page.waitForTimeout(300)
    expect(await runs(page)).toEqual(c.cases)
  })

  test(`tracker script, ${c.name}: no request reaches the tracker host before consent, one after Accept all`, async ({ page }) => {
    // expected failure, measured: see task-3-report (Concern 1, controller ruling option A)
    test.fail(!!c.limit, c.limit)
    const requests = await open(page, c.path)
    expect(requests).toEqual([])

    await acceptAll(page)
    await page.waitForFunction((n) => (window.__trackerRuns?.length ?? 0) >= n, c.cases.length)
    await page.waitForTimeout(300)
    expect(requests.sort()).toEqual(c.cases.map(script).sort())
  })
}

const frameCases = [
  { name: '(e) created with createElement and appended later', path: '/dynamic.html?case=iframe', case: 'iframe' },
  { name: '(e) inserted later by innerHTML', path: '/dynamic.html?case=iframe-html', case: 'iframe-html' },
  { name: 'placed in the HTML after the runtime tag', path: '/parsed-iframe.html', case: 'parsed-iframe',
    limit: 'Chromium sends the request of a parser-inserted <iframe src> before any script runs; its load is still stopped (asserted above)' },
]
const loadedFrame = (page: Page, c: string) => page.frameLocator(`iframe[src="${frame(c)}"]`).locator('#tracker-frame')

for (const c of frameCases) {
  test(`tracker iframe, ${c.name}: a placeholder before consent, loads once after Accept all`, async ({ page }) => {
    await open(page, c.path)
    await expect(page.locator('[data-consent-placeholder-for="tracker"]')).toBeVisible()
    await expect(page.locator('iframe[src]')).toHaveCount(0)

    await acceptAll(page)
    await expect(loadedFrame(page, c.case)).toHaveText('tracker frame')
    await expect(page.locator('[data-consent-placeholder-for="tracker"]')).toHaveCount(0)
    await expect(page.locator('iframe')).toHaveCount(1)
  })

  test(`tracker iframe, ${c.name}: no request reaches the tracker host before consent, one after Accept all`, async ({ page }) => {
    // expected failure, measured: see task-3-report (Concern 1, controller ruling option A)
    test.fail(!!c.limit, c.limit)
    const requests = await open(page, c.path)
    expect(requests).toEqual([])

    await acceptAll(page)
    await expect(loadedFrame(page, c.case)).toHaveText('tracker frame')
    await page.waitForTimeout(300)
    expect(requests).toEqual([frame(c.case)])
  })
}

// a host that no configured service has in its origins never loads: here youtube is configured (www.youtube-nocookie.com)
// and accepted, and an embed from www.youtube.com, a known host of the same id, is inserted after Accept all
test('a known host outside every configured origin stays blocked after Accept all, without a request', async ({ page }) => {
  const outside: string[] = []
  await page.context().route('https://www.youtube.com/**', (route) => {
    outside.push(route.request().url())
    return route.fulfill({ contentType: 'text/html', body: frameHtml })
  })
  await open(page, '/dynamic.html?case=none')
  await acceptAll(page)
  await page.waitForFunction(() => document.cookie.includes('cc_cookie'))
  await page.evaluate(() => {
    const f = document.createElement('iframe')
    f.src = 'https://www.youtube.com/embed/by-code'
    document.body.appendChild(f)
    document.getElementById('box')!.innerHTML = '<iframe src="https://www.youtube.com/embed/by-markup"></iframe>'
  })
  await page.waitForTimeout(300)
  expect(outside).toEqual([])
  await expect(page.locator('iframe[src^="https://www.youtube.com"]')).toHaveCount(0)
})
