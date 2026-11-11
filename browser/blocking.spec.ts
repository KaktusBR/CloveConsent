// End to end, in Chromium: one site script (buildSiteScript over the built runtime), first in <head>, on a page with a YouTube
// and a map iframe, marked Google Analytics and Meta Pixel scripts, a widget container with its marked loader, a tracker tag
// copied in unmarked below the snippet, and trackers inserted by the site's own code (one for a configured service, one for a
// host no configured service covers). No tracker host is ever resolved: every request to one is recorded and fulfilled here.
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

const GTM = 'www.googletagmanager.com'
const META = 'connect.facebook.net'
const YOUTUBE = 'www.youtube-nocookie.com'
const MAPS = 'tile.openstreetmap.org'
const WIDGET = 'widget.cloveconsent.test'
const HOTJAR = 'static.hotjar.com'
// the source of a marked iframe naming a service id the configuration does not have
const VIMEO = 'player.vimeo.com'
const SCRIPT_HOSTS = [GTM, META, WIDGET, HOTJAR]
const FRAME_HOSTS = [YOUTUBE, MAPS, VIMEO]
const TRACKER_HOSTS = new Set([...SCRIPT_HOSTS, ...FRAME_HOSTS])
/**
 * The unmarked tracker tag written in the HTML below the snippet. Chromium's preload scanner requests it before any script runs,
 * so no script can stop that request (measured; the strict check is an expected failure in autoblock.spec.ts). Auto-blocking
 * still keeps it from executing, which is asserted. It is the only request excluded from "no request before consent".
 */
const UNMARKED = `https://${GTM}/gtag/js?id=G-TEST1234&case=unmarked`
const CONSENT_COOKIE = 'cc_cookie'
const SERVICES_WITH_PLACEHOLDER = ['youtube', 'openstreetmap', 'widget']
// the minimum placeholder size (consent.css: 16rem by 9rem)
const MIN = { width: 256, height: 144 }

declare global { interface Window { __runs?: string[]; __pageId?: number } }

/** A fake tracker script: records that it ran (host and case), sets a cookie as a tracker would, and the widget renders. */
const fakeScript = (url: URL) => `
;(window.__runs = window.__runs || []).push(${JSON.stringify(`${url.hostname}:${url.searchParams.get('case') ?? 'loader'}`)})
document.cookie = ${JSON.stringify(`fake_${url.hostname.split('.')[0]}=1; path=/`)}
${url.hostname === WIDGET ? `document.querySelector('[data-consent-placeholder="widget"]').insertAdjacentHTML('beforeend', '<p class="widget-rendered">widget</p>')` : ''}`

interface Opened { requests: string[]; reports: string[]; errors: string[] }

/** Opens the fixture site; returns the live lists of tracker requests, blocked-tracker reports and page errors. */
async function open(page: Page): Promise<Opened> {
  const requests: string[] = []
  const reports: string[] = []
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  // the engine hides its banner from automated browsers (navigator.webdriver); the tests play a visitor
  await page.addInitScript(() => { Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }) })
  const ctx: BrowserContext = page.context()
  ctx.on('request', (r) => { if (TRACKER_HOSTS.has(new URL(r.url()).hostname)) requests.push(r.url()) })
  for (const host of SCRIPT_HOSTS) {
    await ctx.route(`https://${host}/**`, (route) => route.fulfill({ contentType: 'text/javascript', body: fakeScript(new URL(route.request().url())) }))
  }
  for (const host of FRAME_HOSTS) {
    await ctx.route(`https://${host}/**`, (route) => route.fulfill({ contentType: 'text/html', body: '<!DOCTYPE html><title>embed</title>' }))
  }
  await ctx.route('**/report', (route) => { reports.push(route.request().postData() ?? ''); return route.fulfill({ status: 204 }) })
  await page.goto('/blocking.html')
  await page.waitForLoadState('load')
  // anything a blocked element would fetch has had time to be requested
  await page.waitForTimeout(300)
  return { requests, reports, errors }
}

const runs = (page: Page) => page.evaluate(() => [...(window.__runs ?? [])].sort())
const hostsOf = (urls: string[]) => [...new Set(urls.map((u) => new URL(u).hostname))].sort()
/** Every tracker request except the one no script can prevent (see UNMARKED). */
const preventable = (requests: string[]) => requests.filter((u) => u !== UNMARKED)
const cookieNames = async (page: Page) => (await page.context().cookies()).map((c) => c.name).sort()
const placeholder = (page: Page, id: string) => page.locator(`[data-consent-placeholder-for="${id}"]`)
const panel = (page: Page) => page.locator('[data-cloveconsent-settings]')

async function expectAllBlocked(page: Page): Promise<void> {
  expect(await runs(page)).toEqual([])
  for (const id of SERVICES_WITH_PLACEHOLDER) await expect(placeholder(page, id)).toBeVisible()
  await expect(page.locator('iframe[src]')).toHaveCount(0)
  await expect(page.locator('.widget-rendered')).toHaveCount(0)
}

/** Settles after a decision: scripts that may run have run. */
async function settle(page: Page, minRuns: number): Promise<void> {
  await page.waitForFunction((n) => (window.__runs?.length ?? 0) >= n, minRuns)
  await page.waitForTimeout(300)
}

const ALL_RUNS = [`${GTM}:loader`, `${GTM}:marked`, `${GTM}:unmarked`, `${META}:inserted`, `${META}:loader`, `${META}:marked`, `${WIDGET}:loader`].sort()

test('before any decision: nothing tracks, nothing is stored, and every blocked element shows a placeholder', async ({ page }) => {
  const { requests, reports, errors } = await open(page)
  await expect(page.locator('#cc-main .cm')).toBeVisible()
  await expectAllBlocked(page)
  // R7: the unmarked tag below the snippet was requested by the preload scanner, but did not run (no __runs above)
  expect(preventable(requests)).toEqual([])
  expect(await cookieNames(page)).toEqual([])
  // R8: the inserted tracker no configured service covers is reported once, and so is the marked iframe naming an unknown
  // service id; with the site key and no visitor data
  const sent = reports.map((r) => JSON.parse(r) as Record<string, string>).sort((a, b) => a.kind!.localeCompare(b.kind!))
  expect(sent).toEqual([
    { kind: 'unconfigured', site: 'blocking-site', service: 'hotjar', path: '/blocking.html', timestamp: expect.any(String) },
    { kind: 'unknown', site: 'blocking-site', service: 'vimeo', path: '/blocking.html', timestamp: expect.any(String) },
  ])
  // the unknown service can never load: never blank space, the "not available on this site" state at the iframe's size, with
  // the settings link and nothing to allow
  await expect(page.locator('iframe[data-consent="vimeo"]')).toHaveCount(0)
  const unavailable = placeholder(page, 'vimeo')
  await expect(unavailable).toBeVisible()
  await expect(unavailable).toHaveAttribute('data-consent-unavailable', '')
  await expect(unavailable.locator('[data-consent-action]')).toHaveCount(0)
  await expect(unavailable.locator('[data-consent-open]')).toBeVisible()
  const size = (await unavailable.boundingBox())!
  expect(Math.abs(size.width - 320)).toBeLessThanOrEqual(1)
  expect(Math.abs(size.height - 180)).toBeLessThanOrEqual(1)
  expect(errors).toEqual([])
})

test('placeholders have the size of the element they stand for, or the minimum size', async ({ page }) => {
  await open(page)
  const box = async (sel: string) => (await page.locator(sel).boundingBox())!
  const before = {
    youtube: await box('[data-consent-placeholder-for="youtube"]'),
    openstreetmap: await box('[data-consent-placeholder-for="openstreetmap"]'),
  }
  // the widget container is left empty, so it has no height: its placeholder fills its width and keeps the minimum height
  await expect(placeholder(page, 'widget')).toHaveClass(/consent-placeholder--min/)
  const container = await box('[data-consent-placeholder="widget"]')
  const widget = await box('[data-consent-placeholder-for="widget"]')
  expect(Math.abs(widget.width - Math.max(container.width, MIN.width))).toBeLessThanOrEqual(1)
  expect(widget.height).toBeGreaterThanOrEqual(MIN.height - 1)

  await page.locator('.cm__btn[data-role="all"]').click()
  await expect(page.locator(`iframe[src^="https://${MAPS}/"]`)).toHaveCount(1)
  const after = { youtube: await box(`iframe[src^="https://${YOUTUBE}/"]`), openstreetmap: await box(`iframe[src^="https://${MAPS}/"]`) }
  for (const id of ['youtube', 'openstreetmap'] as const) {
    expect(Math.abs(before[id].width - after[id].width), `${id} width`).toBeLessThanOrEqual(1)
    expect(Math.abs(before[id].height - after[id].height), `${id} height`).toBeLessThanOrEqual(1)
  }
})

test('Reject all keeps everything blocked; only the consent cookie is stored', async ({ page }) => {
  const { requests, reports, errors } = await open(page)
  await page.locator('.cm__btn[data-role="necessary"]').click()
  await expect(page.locator('#cc-main .cm')).toBeHidden()
  await page.waitForTimeout(300)
  await expectAllBlocked(page)
  expect(preventable(requests)).toEqual([])
  expect(await cookieNames(page)).toEqual([CONSENT_COOKIE])
  expect(reports).toHaveLength(2)
  expect(errors).toEqual([])
})

test('Accept all runs every configured tracker, the unmarked tag included, and never the unconfigured one', async ({ page }) => {
  const { requests, errors } = await open(page)
  await page.locator('.cm__btn[data-role="all"]').click()
  await settle(page, ALL_RUNS.length)
  expect(await runs(page)).toEqual(ALL_RUNS)
  for (const id of SERVICES_WITH_PLACEHOLDER) await expect(placeholder(page, id)).toHaveCount(0)
  await expect(page.locator(`iframe[src="https://${YOUTUBE}/embed/abc"]`)).toHaveCount(1)
  await expect(page.locator(`iframe[src="https://${MAPS}/embed.html?case=map"]`)).toHaveCount(1)
  await expect(page.locator('[data-consent-placeholder="widget"] .widget-rendered')).toHaveCount(1)
  // a marked iframe naming an unknown service id is never loaded
  await expect(page.locator('iframe[data-consent="vimeo"]')).toHaveCount(0)
  await expect(placeholder(page, 'vimeo')).toHaveAttribute('data-consent-unavailable', '')
  // R8: a host no configured service covers stays blocked whatever is allowed
  expect(hostsOf(requests)).toEqual([GTM, META, MAPS, WIDGET, YOUTUBE].sort())
  expect(await cookieNames(page)).toEqual([CONSENT_COOKIE, 'fake_connect', 'fake_widget', 'fake_www'].sort())
  expect(errors).toEqual([])
})

test('allowing YouTube from its placeholder loads it without a reload, and nothing else', async ({ page }) => {
  const { requests, errors } = await open(page)
  await page.evaluate(() => { window.__pageId = 1 })
  await placeholder(page, 'youtube').locator('[data-consent-action="accept"]').click()
  await expect(page.locator(`iframe[src="https://${YOUTUBE}/embed/abc"]`)).toHaveCount(1)
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => window.__pageId)).toBe(1)
  expect(hostsOf(preventable(requests))).toEqual([YOUTUBE])
  expect(await runs(page)).toEqual([])
  await expect(placeholder(page, 'openstreetmap')).toBeVisible()
  await expect(placeholder(page, 'widget')).toBeVisible()
  expect(errors).toEqual([])
})

test('"Load once" is offered for the video only, and loads it for this page view without storing consent', async ({ page }) => {
  const { requests, errors } = await open(page)
  // R6: a one-time allowance is for iframe services; the map tiles and the widget are not
  await expect(placeholder(page, 'openstreetmap').locator('[data-consent-action="once"]')).toHaveCount(0)
  await expect(placeholder(page, 'widget').locator('[data-consent-action="once"]')).toHaveCount(0)
  await placeholder(page, 'youtube').locator('[data-consent-action="once"]').click()
  await expect(page.locator(`iframe[src="https://${YOUTUBE}/embed/abc"]`)).toHaveCount(1)
  await page.waitForTimeout(300)
  expect(hostsOf(preventable(requests))).toEqual([YOUTUBE])
  expect(await cookieNames(page)).toEqual([])
  expect(errors).toEqual([])
})

test('Withdraw puts the placeholders back', async ({ page }) => {
  const { errors } = await open(page)
  await page.locator('.cm__btn[data-role="all"]').click()
  await settle(page, ALL_RUNS.length)
  for (const id of SERVICES_WITH_PLACEHOLDER) await expect(placeholder(page, id)).toHaveCount(0)

  await panel(page).locator('[data-consent-action="withdraw"]').click()
  for (const id of SERVICES_WITH_PLACEHOLDER) await expect(placeholder(page, id)).toBeVisible()
  await expect(page.locator('iframe[src]')).toHaveCount(0)
  await expect(page.locator('.widget-rendered')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('the per-service switch for Google Analytics alone allows only Google Analytics', async ({ page }) => {
  const { requests, errors } = await open(page)
  const settings = panel(page)
  const ga = settings.locator('input[data-consent-service="google-analytics"]')
  // the services of a category start collapsed
  if (!(await ga.isVisible())) await ga.locator('xpath=ancestor::details[1]/summary').click()
  await ga.check()
  const save = settings.locator('[data-consent-action="save"]')
  // the visitor scrolls it clear of the banner bar, which stays at the bottom of the viewport
  await save.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  await save.click()
  await settle(page, 3)
  expect(await runs(page)).toEqual([`${GTM}:loader`, `${GTM}:marked`, `${GTM}:unmarked`])
  expect(hostsOf(requests)).toEqual([GTM])
  for (const id of SERVICES_WITH_PLACEHOLDER) await expect(placeholder(page, id)).toBeVisible()
  await expect(page.locator('#cc-main .cm')).toBeHidden()
  expect(errors).toEqual([])
})
