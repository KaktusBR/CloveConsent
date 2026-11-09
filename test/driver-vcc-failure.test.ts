// A partial failure inside acceptServices must not lose the decision: the real engine, with acceptService made to fail on a later call.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import * as CC from 'vanilla-cookieconsent'
import { defineConsent } from '../src/config'
import { createConsent } from '../src/client'
import { createVccDriver } from '../src/driver-vcc'
import { parseConsent, readCookieValue } from '../src/state'
import { openStreetMap, theme, youtube } from '../src/catalog'
import sk from '../src/locales/sk'

const failing = vi.hoisted(() => ({ on: 0, calls: 0 }))
vi.mock('vanilla-cookieconsent', async (orig) => {
  const real = await orig<typeof import('vanilla-cookieconsent')>()
  const acceptService = (services: string | string[], category: string) => {
    failing.calls++
    if (failing.on && failing.calls === failing.on) throw new Error('engine failed')
    return real.acceptService(services, category)
  }
  // the package is loaded as CommonJS: its named exports live on `default`
  const base = { ...((real as unknown as { default: object }).default) }
  return { ...base, acceptService, default: { ...base, acceptService } }
})

const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)) }
const stored = () => parseConsent(readCookieValue(document.cookie, 'cc_cookie'))
const clearCookie = () => { document.cookie = 'cc_cookie=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT' }

beforeEach(() => { clearCookie(); failing.on = 0; failing.calls = 0 })
afterEach(() => { CC.reset(false); clearCookie(); failing.on = 0 })

describe('acceptServices with a failing engine call', () => {
  test('the categories already written are still persisted, reported and applied; the error is rethrown', async () => {
    CC.reset(false); document.body.innerHTML = ''; document.documentElement.className = ''
    const conf = defineConsent({ locales: ['sk'], defaultLocale: 'sk', packs: [sk], revision: 2, services: [theme(), youtube(), openStreetMap()] })
    const c = createConsent(conf, { driver: createVccDriver() }); c.init()
    await flush()
    const seen: string[] = []
    c.on('decision', (i) => seen.push(`${i.kind}:${i.changed.join(',')}:${i.changedServices.join(',')}`))
    failing.on = 2 // the second category fails after the first was written
    expect(() => c.setServices(['youtube', 'theme'])).toThrow('engine failed')
    await flush()
    // functional (written first, config order) is in the cookie; the decision was reported once and the revisions were persisted
    const st = stored()!
    expect(st.categories).toEqual(['necessary', 'functional'])
    expect(st.siteRevision).toBe(2)
    expect(st.revisions).toMatchObject({ theme: 1, youtube: 1, openstreetmap: 1 })
    expect(seen).toEqual(['first:functional:theme'])
    expect(c.isAllowed('theme')).toBe(true)
    expect(c.isAllowed('youtube')).toBe(false)
  })
})
