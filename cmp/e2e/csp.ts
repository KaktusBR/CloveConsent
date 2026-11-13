import { expect, type Page } from '@playwright/test'

declare global {
  interface Window {
    __cspViolations?: string[]
  }
}

const watched = new WeakSet<Page>()

/**
 * Records every Content-Security-Policy violation the page reports (`securitypolicyviolation`), from
 * the next navigation on. Playwright's init script is not subject to the page's CSP.
 */
export async function watchCsp(page: Page): Promise<void> {
  if (watched.has(page)) return
  watched.add(page)
  await page.addInitScript(() => {
    window.__cspViolations = []
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations?.push(`${e.effectiveDirective} blocked ${e.blockedURI || 'inline'} (${e.sourceFile}:${e.lineNumber})`)
    })
  })
}

/** The page loaded since watchCsp reported no CSP violation. */
export async function expectNoCspViolations(page: Page): Promise<void> {
  const violations = await page.evaluate(() => window.__cspViolations)
  expect(violations, `${page.url()}: CSP violations not watched (call watchCsp before navigating)`).toBeDefined()
  expect(violations, page.url()).toEqual([])
}
