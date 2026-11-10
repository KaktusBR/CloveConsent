// @vitest-environment-options { "url": "https://app.example.com/" }
// The real engine on a page whose host is a subdomain of the configured cookie domain (jsdom's default page is localhost).
import { afterEach, describe, expect, test, vi } from 'vitest'
import * as CC from 'vanilla-cookieconsent'
import { defineConsent } from '../src/config'
import { createConsent } from '../src/client'
import { createVccDriver } from '../src/driver-vcc'
import { parseConsent, readCookieValue } from '../src/state'
import { theme, youtube } from '../src/catalog'

const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)) }
const cfg = (cookieDomain?: string) => defineConsent({ locales: ['en'], defaultLocale: 'en', revision: 1, services: [theme(), youtube()], cookieDomain })
// the engine writes the page host as the Domain attribute when none is configured
const domainsWritten = (set: { mock: { calls: unknown[][] } }) =>
  [...new Set(set.mock.calls.map((a) => String(a[0])).filter((s) => s.startsWith('cc_cookie=')).map((s) => /; Domain=([^;]*)/.exec(s)?.[1]))]

afterEach(() => { CC.reset(true); vi.restoreAllMocks() })

async function decide(cookieDomain?: string) {
  const set = vi.spyOn(Document.prototype, 'cookie', 'set')
  const c = createConsent(cfg(cookieDomain), { driver: createVccDriver() }); c.init()
  await flush()
  c.acceptAll()
  await flush()
  return set
}

describe('real engine: cookieDomain', () => {
  test('the page is on app.example.com', () => {
    expect(location.hostname).toBe('app.example.com')
  })
  test('a domain covering the page is passed to the engine: the consent cookie is written for it', async () => {
    const set = await decide('example.com')
    expect(domainsWritten(set)).toEqual(['example.com'])
    expect(parseConsent(readCookieValue(document.cookie, 'cc_cookie'))).not.toBeNull()
  })
  test('a domain that does not cover the page is ignored with a dev warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const set = await decide('other.org')
    expect(domainsWritten(set)).toEqual(['app.example.com'])
    expect(parseConsent(readCookieValue(document.cookie, 'cc_cookie'))).not.toBeNull()
    expect(warn.mock.calls.some((a) => /cookieDomain "other\.org".*app\.example\.com/.test(String(a[0])))).toBe(true)
  })
  test('no cookieDomain: the engine default and no warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const set = await decide()
    expect(domainsWritten(set)).toEqual(['app.example.com'])
    expect(warn.mock.calls.some((a) => /cookieDomain/.test(String(a[0])))).toBe(false)
  })
})
