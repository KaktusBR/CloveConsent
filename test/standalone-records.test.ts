// @vitest-environment-options {"url": "https://site.example/"}
// A records URL that passes config validation (plain http on localhost) but cannot be used from this page: boot keeps running.
import { afterAll, beforeAll, expect, test, vi } from 'vitest'
import * as CC from 'vanilla-cookieconsent'
import { defineConsent, toPublicJson } from '../src/config'
import { youtube } from '../src/catalog'
import { boot } from '../src/standalone'

const config = defineConsent({ locales: ['en'], defaultLocale: 'en', revision: 1, services: [youtube()], records: { url: 'http://localhost:8787/records' } })
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)) }
const fetchMock = vi.fn(async () => new Response(null, { status: 204 }))

beforeAll(() => { vi.stubGlobal('fetch', fetchMock) })
afterAll(() => { CC.reset(false); vi.unstubAllGlobals() })

test('a records URL the page cannot use is logged once; the banner runs without records', async () => {
  document.body.innerHTML = '<div data-cloveconsent-settings id="panel"></div>'
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const consent = boot({ site: 'site-key-1', defaultLocale: 'en', configs: { en: toPublicJson(config, 'en') } })
  await flush()
  expect(consent).not.toBeNull()
  expect(error).toHaveBeenCalledTimes(1)
  error.mockRestore()
  document.querySelector<HTMLElement>('#panel [data-consent-action="accept-all"]')!.click()
  await flush()
  expect(consent!.isAllowed('youtube')).toBe(true)
  expect(fetchMock).not.toHaveBeenCalled()
})
