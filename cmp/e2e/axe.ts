import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

import { expectNoCspViolations, watchCsp } from './csp'

const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']

/**
 * Runs axe (WCAG 2.2 AA) on the current page in the light and the dark theme, and checks that the
 * page reported no CSP violation. Every page an e2e suite visits goes through this. It reloads the
 * page, so call it where a reload is harmless.
 */
export async function expectAccessible(page: Page): Promise<void> {
  await watchCsp(page)
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme })
    await page.reload()
    await page.waitForLoadState('networkidle')
    await expectNoCspViolations(page)
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).toBe(colorScheme === 'dark')
    const { violations } = await new AxeBuilder({ page }).withTags(WCAG).analyze()
    const found = violations.map((v) => `${colorScheme} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)
    expect(found, `${page.url()} (${colorScheme})`).toEqual([])
  }
}
